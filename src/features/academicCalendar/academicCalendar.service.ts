import { AnnouncementAudience, EventType, Prisma } from '@prisma/client';
import { prisma } from '../../config/db';
import { SCHOOL_CLOSED_EVENT_TYPES, DEFAULT_ACADEMIC_SESSION_START_MONTH } from '../../constants';
import { AcademicCalendarQuerySchema } from './academicCalendar.validation';

// ════════════════════════════════════════════════════════════
// Academic calendar — one view of a school's year: holidays, government
// holidays, vacations (date ranges), exams, meetings and events, grouped
// by month, with working-day counts. Built from Event rows (admin-created,
// incl. bulk imports) plus Exam date ranges from the exams module.
// Sundays are always off; SCHOOL_CLOSED_EVENT_TYPES close the school.
// ════════════════════════════════════════════════════════════

const DAY_MS  = 86_400_000;
const toDay   = (d: Date) => d.toISOString().slice(0, 10);
const atDay   = (s: string) => new Date(`${s}T00:00:00.000Z`);
const CLOSED  = new Set<string>(SCHOOL_CLOSED_EVENT_TYPES);

const forbidden = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code = code; err.statusCode = 403;
  return err;
};

// ── Which dates the calendar covers ───────────────────────────
const resolveRange = async (schoolId: string, query: AcademicCalendarQuerySchema) => {
  const school     = await prisma.school.findUnique({ where: { id: schoolId }, select: { academicSessionStartMonth: true } });
  const startMonth = school?.academicSessionStartMonth ?? DEFAULT_ACADEMIC_SESSION_START_MONTH;

  if (query.from && query.to) {
    return { from: query.from, to: query.to, session: null, sessionStartMonth: startMonth };
  }

  const today = new Date();
  const year  = query.year ?? (today.getUTCMonth() + 1 >= startMonth ? today.getUTCFullYear() : today.getUTCFullYear() - 1);
  const from  = new Date(Date.UTC(year, startMonth - 1, 1));
  const to    = new Date(Date.UTC(year + 1, startMonth - 1, 0));   // day before the next session starts
  return {
    from, to, sessionStartMonth: startMonth,
    session: { year, label: `${year}-${String((year + 1) % 100).padStart(2, '0')}` },
  };
};

interface CalendarScope {
  schoolId:     string;
  audiences:    AnnouncementAudience[] | null;   // null = every audience (admin)
  examClassId?: string;                          // only exams for this class (parent)
}

// ── Build the calendar for a scope ────────────────────────────
const buildCalendar = async (scope: CalendarScope, query: AcademicCalendarQuerySchema) => {
  const range = await resolveRange(scope.schoolId, query);
  const { from, to } = range;
  const wantExams = !query.eventType || query.eventType === 'EXAM';

  const [events, exams] = await Promise.all([
    prisma.event.findMany({
      where: {
        schoolId:  scope.schoolId,
        startDate: { lte: new Date(to.getTime() + DAY_MS - 1) },
        endDate:   { gte: from },
        ...(scope.audiences ? { audience: { in: scope.audiences } } : {}),
        ...(query.eventType ? { eventType: query.eventType } : {}),
      },
      orderBy: { startDate: 'asc' },
    }),
    wantExams ? prisma.exam.findMany({
      where: {
        schoolId:  scope.schoolId,
        startDate: { not: null, lte: new Date(to.getTime() + DAY_MS - 1) },
        OR:        [{ endDate: { gte: from } }, { endDate: null, startDate: { gte: from } }],
        ...(scope.examClassId ? { classes: { some: { classId: scope.examClassId } } } : {}),
      } satisfies Prisma.ExamWhereInput,
      include: { classes: { include: { class: true }, orderBy: { class: { numericLevel: 'asc' } } } },
      orderBy: { startDate: 'asc' },
    }) : Promise.resolve([]),
  ]);

  const days = (a: string, b: string) => Math.round((atDay(b).getTime() - atDay(a).getTime()) / DAY_MS) + 1;

  const entries = [
    ...events.map(e => {
      const startDate = toDay(e.startDate), endDate = toDay(e.endDate);
      return {
        id: e.id, source: 'EVENT' as const, type: e.eventType as string, title: e.title, description: e.description,
        audience: e.audience as string, startDate, endDate, days: days(startDate, endDate),
        schoolClosed: CLOSED.has(e.eventType), classes: [] as string[],
      };
    }),
    ...exams.map(x => {
      const startDate = toDay(x.startDate!), endDate = toDay(x.endDate ?? x.startDate!);
      return {
        id: x.id, source: 'EXAM' as const, type: 'EXAM', title: x.title, description: x.description,
        audience: 'ALL', startDate, endDate, days: days(startDate, endDate),
        schoolClosed: false, classes: x.classes.map(c => c.class.name),
      };
    }),
  ].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title));

  // ── Mark every date in range ────────────────────────────────
  const fromStr = toDay(from), toStr = toDay(to);
  const covered = (set: Set<string>, start: string, end: string) => {
    for (let t = atDay(start < fromStr ? fromStr : start).getTime(); t <= atDay(end > toStr ? toStr : end).getTime(); t += DAY_MS) {
      set.add(toDay(new Date(t)));
    }
  };
  const closed = new Set<string>(), exam = new Set<string>();
  const byType: Record<string, Set<string>> = { HOLIDAY: new Set(), GOVERNMENT_HOLIDAY: new Set(), VACATION: new Set() };
  for (const e of entries) {
    if (e.schoolClosed) { covered(closed, e.startDate, e.endDate); covered(byType[e.type], e.startDate, e.endDate); }
    if (e.type === 'EXAM') covered(exam, e.startDate, e.endDate);
  }

  const isSunday = (d: string) => atDay(d).getUTCDay() === 0;
  const tally = (start: string, end: string) => {
    let total = 0, sundays = 0, closedDays = 0, examDays = 0;
    for (let t = atDay(start).getTime(); t <= atDay(end).getTime(); t += DAY_MS) {
      const d = toDay(new Date(t));
      total++;
      if (isSunday(d)) sundays++;
      else if (closed.has(d)) closedDays++;      // Sundays aren't double-counted
      if (exam.has(d)) examDays++;
    }
    return { totalDays: total, sundays, schoolClosedDays: closedDays, workingDays: total - sundays - closedDays, examDays };
  };

  // ── Month by month ──────────────────────────────────────────
  const months = [];
  for (let m = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); m <= to; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
    const monthStart = toDay(m) < fromStr ? fromStr : toDay(m);
    const lastDay    = toDay(new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0)));
    const monthEnd   = lastDay > toStr ? toStr : lastDay;
    months.push({
      month:     toDay(m).slice(0, 7),
      label:     m.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      startDate: monthStart,
      endDate:   monthEnd,
      ...tally(monthStart, monthEnd),
      entries:   entries.filter(e => e.startDate <= monthEnd && e.endDate >= monthStart),
    });
  }

  const countBy = (type: string) => entries.filter(e => e.type === type).length;

  return {
    range: { from: fromStr, to: toStr, session: range.session, sessionStartMonth: range.sessionStartMonth },
    summary: {
      ...tally(fromStr, toStr),
      holidayDays:           byType.HOLIDAY.size,
      governmentHolidayDays: byType.GOVERNMENT_HOLIDAY.size,
      vacationDays:          byType.VACATION.size,
      counts: Object.fromEntries(
        [...Object.values(EventType)].map(t => [t, countBy(t)]),
      ),
    },
    months,
    entries,
  };
};

// ── ADMIN: everything ─────────────────────────────────────────
export const getAdminCalendar = (schoolId: string, query: AcademicCalendarQuerySchema) =>
  buildCalendar({ schoolId, audiences: null }, query);

// ── TEACHER: events for ALL / TEACHER, all exams ──────────────
export const getTeacherCalendar = (schoolId: string, query: AcademicCalendarQuerySchema) =>
  buildCalendar({ schoolId, audiences: ['ALL', 'TEACHER'] }, query);

// ── PARENT: events for ALL / PARENT, exams of the child's class ─
export const getParentCalendar = async (parentUserId: string, studentId: string, query: AcademicCalendarQuerySchema) => {
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student || student.parentUserId !== parentUserId) {
    throw forbidden('This student is not linked to your account', 'NOT_YOUR_CHILD');
  }
  return buildCalendar({ schoolId: student.schoolId, audiences: ['ALL', 'PARENT'], examClassId: student.classId }, query);
};
