import { z } from 'zod';
import { DayOfWeek } from '@prisma/client';
import { prisma } from '../../../config/db';
import { RECORD_STATUS, SCHOOL_CLOSED_EVENT_TYPES } from '../../../constants';

// ════════════════════════════════════════════════════════════
// Teacher availability — when is a teacher free?
//   busy = weekly timetable periods (ClassSchedule, by day of week)
//        + exam invigilation duties on that date (ExamSchedule)
//        + the whole day if on approved leave, or marked ABSENT/LEAVE that day
// With a `date`, all of the above apply; with only a `day` (MONDAY…),
// just the weekly timetable does. School-closed days (calendar holiday /
// vacation, Sunday) are reported separately — teachers aren't "busy" then,
// the school is shut.
// ════════════════════════════════════════════════════════════

const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be in 24-hour HH:MM format (e.g. "09:00")');
const dateOnly   = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format')
  .refine(v => !Number.isNaN(new Date(`${v}T00:00:00.000Z`).getTime()), 'Invalid date');

// ── Validation ────────────────────────────────────────────────
export const availabilityQuerySchema = z.object({
  date:      dateOnly.optional(),
  day:       z.nativeEnum(DayOfWeek).optional(),
  startTime: timeString,
  endTime:   timeString,
  onlyFree:  z.enum(['true', 'false']).optional().transform(v => v === 'true'),
  search:    z.string().trim().min(1).optional(),
})
  .refine(q => !!q.date !== !!q.day, { message: 'Send either date or day', path: ['date'] })
  .refine(q => q.endTime > q.startTime, { message: 'endTime must be after startTime', path: ['endTime'] });

export const freeSlotsQuerySchema = z.object({
  teacherId:  z.string().uuid('Invalid teacher id').optional(),
  date:       dateOnly.optional(),
  day:        z.nativeEnum(DayOfWeek).optional(),
  from:       timeString.optional(),   // window start (default: the school's first period that day)
  to:         timeString.optional(),   // window end   (default: the school's last period that day)
  minMinutes: z.coerce.number().int().min(1).max(600).optional().default(1), // hide gaps shorter than this
})
  .refine(q => !(q.date && q.day), { message: 'Send either date or day, not both', path: ['date'] })
  .refine(q => !q.from || !q.to || q.to > q.from, { message: 'to must be after from', path: ['to'] });

export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
export type FreeSlotsQuery    = z.infer<typeof freeSlotsQuerySchema>;

// ── Helpers ───────────────────────────────────────────────────
const DAY_BY_INDEX: DayOfWeek[] = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const WEEK: DayOfWeek[]         = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const DEFAULT_WINDOW            = { from: '08:00', to: '14:00' };

const atDay        = (s: string) => new Date(`${s}T00:00:00.000Z`);
const dayOfDate    = (s: string) => DAY_BY_INDEX[atDay(s).getUTCDay()];
const overlaps     = (aS: string, aE: string, bS: string, bE: string) => aS < bE && aE > bS;
const toMinutes    = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

interface BusyBlock {
  type:         'CLASS' | 'INVIGILATION' | 'LEAVE' | 'ABSENT';
  title:        string;
  startTime:    string;
  endTime:      string;
  className?:   string;
  sectionName?: string;
  subjectName?: string | null;
  roomNo?:      string | null;
}

// Everything that makes the given teachers busy on one day (or weekday).
const loadBusy = async (schoolId: string, teacherIds: string[], day: DayOfWeek, date?: string) => {
  const busy = new Map<string, BusyBlock[]>(teacherIds.map(id => [id, []]));
  const push = (id: string, b: BusyBlock) => busy.get(id)?.push(b);

  const periods = await prisma.classSchedule.findMany({
    where:   { schoolId, day, type: 'CLASS_PERIOD', teacherId: { in: teacherIds } },
    include: { class: true, section: true, subject: true },
  });
  for (const p of periods) push(p.teacherId!, {
    type: 'CLASS', title: `${p.class.name} - ${p.section.name} · ${p.subject?.name ?? 'Class'}`,
    startTime: p.startTime, endTime: p.endTime,
    className: p.class.name, sectionName: p.section.name, subjectName: p.subject?.name ?? null, roomNo: p.roomNo,
  });

  if (date) {
    const d = atDay(date);
    const [duties, leaves, attendance] = await Promise.all([
      prisma.examSchedule.findMany({
        where:   { schoolId, date: d, invigilatorId: { in: teacherIds } },
        include: { exam: true, class: true, subject: true },
      }),
      prisma.teacherLeaveRequest.findMany({
        where: { teacherId: { in: teacherIds }, status: 'APPROVED', fromDate: { lte: d }, toDate: { gte: d } },
      }),
      prisma.teacherAttendanceRecord.findMany({
        where: { teacherId: { in: teacherIds }, date: d, status: { in: ['ABSENT', 'LEAVE'] } },
      }),
    ]);
    for (const x of duties) push(x.invigilatorId!, {
      type: 'INVIGILATION', title: `Exam duty · ${x.class.name} ${x.subject.name} (${x.exam.title})`,
      startTime: x.startTime, endTime: x.endTime, className: x.class.name, subjectName: x.subject.name, roomNo: x.roomNo,
    });
    for (const l of leaves) push(l.teacherId, { type: 'LEAVE', title: `On leave: ${l.reason}`, startTime: '00:00', endTime: '23:59' });
    for (const a of attendance) {
      if (busy.get(a.teacherId)?.some(b => b.type === 'LEAVE')) continue;
      push(a.teacherId, { type: a.status === 'LEAVE' ? 'LEAVE' : 'ABSENT', title: `Marked ${a.status} today`, startTime: '00:00', endTime: '23:59' });
    }
  }

  for (const list of busy.values()) list.sort((a, b) => a.startTime.localeCompare(b.startTime));
  return busy;
};

// Is the school shut on this date (Sunday, or a calendar holiday / vacation)?
const schoolClosedOn = async (schoolId: string, date?: string, day?: DayOfWeek) => {
  if ((date ? dayOfDate(date) : day) === 'SUNDAY') return { reason: 'SUNDAY', title: 'Sunday' };
  if (!date) return null;
  const d = atDay(date);
  const event = await prisma.event.findFirst({
    where: { schoolId, eventType: { in: [...SCHOOL_CLOSED_EVENT_TYPES] }, startDate: { lte: new Date(d.getTime() + 86_399_999) }, endDate: { gte: d } },
  });
  return event ? { reason: event.eventType, title: event.title } : null;
};

const activeTeachers = (schoolId: string, extra: object = {}) => prisma.teacher.findMany({
  where:   { schoolId, status: RECORD_STATUS.ACTIVE, user: { isActive: true }, ...extra },
  include: { user: true },
  orderBy: { user: { name: 'asc' } },
});

const teacherRef = (t: Awaited<ReturnType<typeof activeTeachers>>[number]) => ({
  teacherId:  t.id,
  userId:     t.userId,
  name:       t.user.name,
  employeeId: t.employeeId,
  phone:      t.user.phone,
  subjects:   t.subjectsTaught,
});

// ── GET /admin/teachers/availability — who is free in a time range? ─
export const getTeacherAvailability = async (schoolId: string, q: AvailabilityQuery) => {
  const day      = q.date ? dayOfDate(q.date) : q.day!;
  const teachers = await activeTeachers(schoolId, q.search ? { user: { isActive: true, name: { contains: q.search, mode: 'insensitive' } } } : {});
  const [busy, schoolClosed] = await Promise.all([
    loadBusy(schoolId, teachers.map(t => t.id), day, q.date),
    schoolClosedOn(schoolId, q.date, q.day),
  ]);

  let items = teachers.map(t => {
    const conflicts = (busy.get(t.id) ?? []).filter(b => overlaps(b.startTime, b.endTime, q.startTime, q.endTime));
    return { ...teacherRef(t), free: conflicts.length === 0, busy: conflicts };
  });
  const freeCount = items.filter(i => i.free).length;
  if (q.onlyFree) items = items.filter(i => i.free);
  items.sort((a, b) => Number(b.free) - Number(a.free) || a.name.localeCompare(b.name));

  return {
    query:        { date: q.date ?? null, day, startTime: q.startTime, endTime: q.endTime },
    schoolClosed,
    summary:      { total: teachers.length, free: freeCount, busy: teachers.length - freeCount },
    items,
  };
};

// The school's working window for a weekday, from its own timetable.
const schoolWindow = async (schoolId: string, day: DayOfWeek) => {
  const agg = await prisma.classSchedule.aggregate({
    where: { schoolId, day },
    _min:  { startTime: true },
    _max:  { endTime: true },
  });
  return agg._min.startTime && agg._max.endTime
    ? { from: agg._min.startTime, to: agg._max.endTime, source: 'TIMETABLE' as const }
    : { ...DEFAULT_WINDOW, source: 'DEFAULT' as const };
};

// Free gaps inside [from, to] once the busy blocks are removed.
const freeGaps = (from: string, to: string, busy: BusyBlock[], minMinutes: number) => {
  const gaps: { startTime: string; endTime: string; minutes: number }[] = [];
  let cursor = from;
  for (const b of [...busy].sort((x, y) => x.startTime.localeCompare(y.startTime))) {
    if (b.endTime <= cursor || b.startTime >= to) continue;
    if (b.startTime > cursor) gaps.push({ startTime: cursor, endTime: b.startTime, minutes: 0 });
    if (b.endTime > cursor) cursor = b.endTime;
  }
  if (cursor < to) gaps.push({ startTime: cursor, endTime: to, minutes: 0 });
  return gaps
    .map(g => ({ ...g, minutes: toMinutes(g.endTime) - toMinutes(g.startTime) }))
    .filter(g => g.minutes >= minMinutes);
};

// ── GET /admin/teachers/free-slots — when is each teacher free? ──
// One teacher (teacherId) or all; one date, one weekday, or the whole
// week (no date/day → MONDAY…SATURDAY by the weekly timetable).
export const getTeacherFreeSlots = async (schoolId: string, q: FreeSlotsQuery) => {
  const teachers = await activeTeachers(schoolId, q.teacherId ? { id: q.teacherId } : {});
  if (q.teacherId && teachers.length === 0) {
    const err = new Error('Teacher not found') as any;
    err.code = 'TEACHER_NOT_FOUND'; err.statusCode = 404;
    throw err;
  }

  const targets = q.date ? [{ day: dayOfDate(q.date), date: q.date }]
                : q.day  ? [{ day: q.day, date: undefined }]
                : WEEK.map(day => ({ day, date: undefined as string | undefined }));

  const days = await Promise.all(targets.map(async ({ day, date }) => {
    const [busy, closed, auto] = await Promise.all([
      loadBusy(schoolId, teachers.map(t => t.id), day, date),
      schoolClosedOn(schoolId, date, day),
      schoolWindow(schoolId, day),
    ]);
    const window = { from: q.from ?? auto.from, to: q.to ?? auto.to, source: q.from || q.to ? 'QUERY' : auto.source };
    return { day, date: date ?? null, window, schoolClosed: closed, busy };
  }));

  return {
    days: days.map(d => ({ day: d.day, date: d.date, window: d.window, schoolClosed: d.schoolClosed })),
    teachers: teachers.map(t => ({
      ...teacherRef(t),
      days: days.map(d => {
        const busy    = d.busy.get(t.id) ?? [];
        const offDuty = busy.find(b => b.type === 'LEAVE' || b.type === 'ABSENT');
        const inWindow = busy.filter(b => overlaps(b.startTime, b.endTime, d.window.from, d.window.to));
        const free    = d.schoolClosed || offDuty ? [] : freeGaps(d.window.from, d.window.to, inWindow, q.minMinutes);
        return {
          day:          d.day,
          date:         d.date,
          unavailable:  offDuty ? { type: offDuty.type, title: offDuty.title } : null,
          busy:         inWindow,
          free,
          freeMinutes:  free.reduce((sum, g) => sum + g.minutes, 0),
        };
      }),
    })),
  };
};
