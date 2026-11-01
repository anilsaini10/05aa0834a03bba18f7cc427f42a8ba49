import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/db';
import { DEFAULT_ACADEMIC_SESSION_START_MONTH, SCHOOL_CLOSED_EVENT_TYPES } from '../../../constants';
import {
  DateRange, DAY_MS, addDays, atDay, toDay, schoolToday,
  sessionRange, sessionYearOf, sessionLabel,
} from './analytics.utils';

const appError = (message: string, code: string, statusCode: number) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = statusCode;
  return err;
};

// Filters every analytics query understands. All ids are already
// verified to belong to ctx.schoolId by resolveContext.
export interface AnalyticsFilterInput {
  year?:      number;
  startDate?: Date;
  endDate?:   Date;
  classId?:   string;
  sectionId?: string;
  subjectId?: string;
  teacherId?: string;
  examId?:    string;
  passPercentage: number;
}

export interface AnalyticsContext {
  schoolId:          string;
  range:             DateRange;
  today:             Date;
  sessionStartMonth: number;
  session:           { year: number; label: string } | null;   // null for a custom range
  classId?:          string;
  sectionId?:        string;
  subjectId?:        string;
  teacherId?:        string;
  examId?:           string;
  passPercentage:    number;
}

// ── Period + filter resolution ────────────────────────────────
// Every id is looked up WITH the admin's schoolId, so an id from another
// school is indistinguishable from one that doesn't exist (404).
export const resolveContext = async (schoolId: string, q: AnalyticsFilterInput): Promise<AnalyticsContext> => {
  const [school, klass, section, subject, teacher, exam] = await Promise.all([
    prisma.school.findUnique({ where: { id: schoolId }, select: { academicSessionStartMonth: true } }),
    q.classId   ? prisma.class.findFirst({ where: { id: q.classId, schoolId }, select: { id: true } }) : null,
    q.sectionId ? prisma.section.findFirst({ where: { id: q.sectionId, class: { schoolId } }, select: { id: true, classId: true } }) : null,
    q.subjectId ? prisma.subject.findFirst({ where: { id: q.subjectId, schoolId }, select: { id: true } }) : null,
    q.teacherId ? prisma.teacher.findFirst({ where: { id: q.teacherId, schoolId }, select: { id: true } }) : null,
    q.examId    ? prisma.exam.findFirst({ where: { id: q.examId, schoolId }, select: { id: true } }) : null,
  ]);
  if (!school) throw appError('Your account is not linked to a school', 'FORBIDDEN', 403);
  if (q.classId   && !klass)   throw appError('Class not found',   'CLASS_NOT_FOUND',   404);
  if (q.sectionId && !section) throw appError('Section not found', 'SECTION_NOT_FOUND', 404);
  if (q.subjectId && !subject) throw appError('Subject not found', 'SUBJECT_NOT_FOUND', 404);
  if (q.teacherId && !teacher) throw appError('Teacher not found', 'TEACHER_NOT_FOUND', 404);
  if (q.examId    && !exam)    throw appError('Exam not found',    'EXAM_NOT_FOUND',    404);
  if (section && q.classId && section.classId !== q.classId) {
    throw appError('Section does not belong to this class', 'SECTION_CLASS_MISMATCH', 400);
  }

  const startMonth = school.academicSessionStartMonth ?? DEFAULT_ACADEMIC_SESSION_START_MONTH;
  const today      = schoolToday();
  let range: DateRange, session: AnalyticsContext['session'] = null;
  if (q.startDate && q.endDate) {
    range = { from: q.startDate, to: q.endDate };
  } else {
    const year = q.year ?? sessionYearOf(today, startMonth);
    range   = sessionRange(year, startMonth);
    session = { year, label: sessionLabel(year) };
  }

  return {
    schoolId, range, today, sessionStartMonth: startMonth, session,
    // A section implies its class, so class-level tables (exams) filter too.
    classId:   q.classId ?? section?.classId,
    sectionId: q.sectionId,
    subjectId: q.subjectId,
    teacherId: q.teacherId,
    examId:    q.examId,
    passPercentage: q.passPercentage,
  };
};

// Same filters, different period — for comparisons.
export const withRange = (ctx: AnalyticsContext, range: DateRange, session: AnalyticsContext['session'] = null): AnalyticsContext =>
  ({ ...ctx, range, session });

// The session one year before ctx's (or the same window a year earlier).
export const sessionFor = (ctx: AnalyticsContext, year: number): AnalyticsContext =>
  withRange(ctx, sessionRange(year, ctx.sessionStartMonth), { year, label: sessionLabel(year) });

// Echoed back in every response so the app knows exactly what was counted.
export const metaOf = (ctx: AnalyticsContext, extra: Record<string, unknown> = {}) => ({
  period: {
    startDate: toDay(ctx.range.from),
    endDate:   toDay(ctx.range.to),
    session:   ctx.session,
  },
  filters: {
    classId:   ctx.classId   ?? null,
    sectionId: ctx.sectionId ?? null,
    subjectId: ctx.subjectId ?? null,
    teacherId: ctx.teacherId ?? null,
    examId:    ctx.examId    ?? null,
  },
  passPercentage: ctx.passPercentage,
  generatedAt:    new Date().toISOString(),
  ...extra,
});

// ── School days ───────────────────────────────────────────────
// Same rules as the academic calendar: Sundays are off and
// SCHOOL_CLOSED_EVENT_TYPES events close the school. Scheduled working
// days are counted only up to today — future days aren't "missed".
export const getSchoolDays = async (schoolId: string, range: DateRange, today: Date) => {
  const events = await prisma.event.findMany({
    where: {
      schoolId,
      eventType: { in: [...SCHOOL_CLOSED_EVENT_TYPES] },
      startDate: { lte: new Date(range.to.getTime() + DAY_MS - 1) },
      endDate:   { gte: range.from },
    },
    select: { eventType: true, startDate: true, endDate: true },
  });

  const fromStr = toDay(range.from), toStr = toDay(range.to);
  const closedByType: Record<string, Set<string>> = Object.fromEntries(SCHOOL_CLOSED_EVENT_TYPES.map(t => [t, new Set<string>()]));
  const closed = new Set<string>();
  for (const e of events) {
    const start = toDay(e.startDate) < fromStr ? fromStr : toDay(e.startDate);
    const end   = toDay(e.endDate)   > toStr   ? toStr   : toDay(e.endDate);
    for (let d = atDay(start); toDay(d) <= end; d = addDays(d, 1)) {
      closed.add(toDay(d));
      closedByType[e.eventType].add(toDay(d));
    }
  }

  const todayStr = toDay(today);
  let totalDays = 0, sundays = 0, closedDays = 0, workingDays = 0, workingDaysToDate = 0;
  const nonWorkingDates: Date[] = [];
  const workingDates: string[] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
    const s = toDay(d);
    totalDays++;
    if (d.getUTCDay() === 0)  { sundays++;    nonWorkingDates.push(d); continue; }
    if (closed.has(s))        { closedDays++; nonWorkingDates.push(d); continue; }
    workingDays++;
    workingDates.push(s);
    if (s <= todayStr) workingDaysToDate++;
  }

  return {
    totalDays,
    sundays,
    schoolClosedDays:      closedDays,     // closed days that aren't Sundays
    holidayDays:           closedByType.HOLIDAY.size,
    governmentHolidayDays: closedByType.GOVERNMENT_HOLIDAY.size,
    vacationDays:          closedByType.VACATION.size,
    scheduledWorkingDays:  workingDays,
    scheduledWorkingDaysToDate: workingDaysToDate,
    workingDates,
    // Passed to attendance queries as `date: { notIn }` — anything marked
    // on a Sunday/holiday is excluded from rates rather than counted.
    nonWorkingDates,
  };
};

export type SchoolDays = Awaited<ReturnType<typeof getSchoolDays>>;

// ── SQL fragment helpers (raw queries only) ───────────────────
export const sqlIf = (cond: unknown, frag: Prisma.Sql): Prisma.Sql => (cond ? frag : Prisma.empty);
