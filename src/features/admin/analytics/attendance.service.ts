import { AttendanceStatus, Prisma } from '@prisma/client';
import { prisma } from '../../../config/db';
import { RECORD_STATUS } from '../../../constants';
import { AnalyticsContext, SchoolDays, getSchoolDays, metaOf, sqlIf } from './analytics.context';
import {
  DateRange, StatusCounts, attendanceSummary, emptyCounts, monthsIn, num, pct,
  splitIntoTerms, toDay, weekStart,
} from './analytics.utils';

// ════════════════════════════════════════════════════════════
// Attendance. One AttendanceRecord per student per day (no half days or
// multiple sessions in the schema). Rules:
//   • Rates use marked records only, HOLIDAY rows excluded.
//   • Records on Sundays / school-closed dates (academic calendar) are
//     left out of every rate and reported as recordsOnNonWorkingDays, so
//     a stray "absent" on a holiday never counts against a student.
//   • "Actual working days" = working days on which attendance was taken.
// ════════════════════════════════════════════════════════════

const studentAttendanceWhere = (ctx: AnalyticsContext, range: DateRange, days: SchoolDays): Prisma.AttendanceRecordWhereInput => ({
  schoolId: ctx.schoolId,
  date:     { gte: range.from, lte: range.to, notIn: days.nonWorkingDates },
  ...(ctx.classId   ? { classId:   ctx.classId }   : {}),
  ...(ctx.sectionId ? { sectionId: ctx.sectionId } : {}),
});

const teacherAttendanceWhere = (ctx: AnalyticsContext, range: DateRange, days: SchoolDays): Prisma.TeacherAttendanceRecordWhereInput => ({
  schoolId: ctx.schoolId,
  date:     { gte: range.from, lte: range.to, notIn: days.nonWorkingDates },
  ...(ctx.teacherId ? { teacherId: ctx.teacherId } : {}),
});

const addTo = (counts: StatusCounts, status: AttendanceStatus, n: number) => { counts[status] += n; };

const countsFrom = (rows: { status: AttendanceStatus; _count: { _all: number } }[]) => {
  const c = emptyCounts();
  for (const r of rows) addTo(c, r.status, r._count._all);
  return c;
};

// ── Student attendance totals for a range (reused by overview/comparisons) ─
export const studentAttendanceTotals = async (ctx: AnalyticsContext, range: DateRange = ctx.range, days?: SchoolDays) => {
  const d = days ?? await getSchoolDays(ctx.schoolId, range, ctx.today);
  const rows = await prisma.attendanceRecord.groupBy({
    by: ['status'], where: studentAttendanceWhere(ctx, range, d), _count: { _all: true },
  });
  return attendanceSummary(countsFrom(rows));
};

export const teacherAttendanceTotals = async (ctx: AnalyticsContext, range: DateRange = ctx.range, days?: SchoolDays) => {
  const d = days ?? await getSchoolDays(ctx.schoolId, range, ctx.today);
  const rows = await prisma.teacherAttendanceRecord.groupBy({
    by: ['status'], where: teacherAttendanceWhere(ctx, range, d), _count: { _all: true },
  });
  return attendanceSummary(countsFrom(rows));
};

// Per-date status counts → any bucketing (day/week/month/term) in memory.
// At most ~366 dates × 5 statuses rows, whatever the school size.
const dailyCounts = async (ctx: AnalyticsContext, days: SchoolDays) => {
  const rows = await prisma.attendanceRecord.groupBy({
    by: ['date', 'status'], where: studentAttendanceWhere(ctx, ctx.range, days), _count: { _all: true },
  });
  const byDate = new Map<string, StatusCounts>();
  for (const r of rows) {
    const key = toDay(r.date);
    const c = byDate.get(key) ?? emptyCounts();
    addTo(c, r.status, r._count._all);
    byDate.set(key, c);
  }
  return byDate;
};

const bucket = (byDate: Map<string, StatusCounts>, keyOf: (date: string) => string) => {
  const out = new Map<string, StatusCounts & { markedDays: number }>();
  for (const [date, c] of byDate) {
    const key = keyOf(date);
    const b = out.get(key) ?? { ...emptyCounts(), markedDays: 0 };
    (Object.keys(c) as AttendanceStatus[]).forEach(s => { b[s] += c[s]; });
    b.markedDays++;
    out.set(key, b);
  }
  return [...out.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([period, c]) => ({ period, markedDays: c.markedDays, ...attendanceSummary(c) }));
};

const sumRange = (byDate: Map<string, StatusCounts>, from: string, to: string) => {
  const c = emptyCounts();
  for (const [date, v] of byDate) if (date >= from && date <= to) (Object.keys(v) as AttendanceStatus[]).forEach(s => { c[s] += v[s]; });
  return attendanceSummary(c);
};

// ── GET /admin/analytics/student-attendance ───────────────────
export const getStudentAttendance = async (ctx: AnalyticsContext) => {
  const days = await getSchoolDays(ctx.schoolId, ctx.range, ctx.today);
  const where = studentAttendanceWhere(ctx, ctx.range, days);

  const [byDate, byClassRows, bySectionRows, onNonWorking, classes, sections] = await Promise.all([
    dailyCounts(ctx, days),
    prisma.attendanceRecord.groupBy({ by: ['classId', 'status'],   where, _count: { _all: true } }),
    prisma.attendanceRecord.groupBy({ by: ['sectionId', 'status'], where, _count: { _all: true } }),
    prisma.attendanceRecord.count({
      where: { ...where, date: { gte: ctx.range.from, lte: ctx.range.to, in: days.nonWorkingDates } },
    }),
    prisma.class.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true, numericLevel: true } }),
    prisma.section.findMany({ where: { class: { schoolId: ctx.schoolId } }, select: { id: true, name: true, classId: true } }),
  ]);

  const total = emptyCounts();
  for (const c of byDate.values()) (Object.keys(c) as AttendanceStatus[]).forEach(s => { total[s] += c[s]; });

  const group = <K extends 'classId' | 'sectionId'>(rows: ({ status: AttendanceStatus; _count: { _all: number } } & Record<K, string>)[], key: K) => {
    const m = new Map<string, StatusCounts>();
    for (const r of rows) {
      const c = m.get(r[key]) ?? emptyCounts();
      addTo(c, r.status, r._count._all);
      m.set(r[key], c);
    }
    return m;
  };
  const classMap   = new Map(classes.map(c => [c.id, c]));
  const sectionMap = new Map(sections.map(s => [s.id, s]));

  const today    = toDay(ctx.today);
  const thisWeek = weekStart(ctx.today);
  const thisMonth = today.slice(0, 7);
  const terms = splitIntoTerms(ctx.range, 2);

  return {
    meta: metaOf(ctx),
    calendar: {
      scheduledWorkingDays:       days.scheduledWorkingDays,
      scheduledWorkingDaysToDate: days.scheduledWorkingDaysToDate,
      actualWorkingDays:          byDate.size,
      sundays:                    days.sundays,
      schoolClosedDays:           days.schoolClosedDays,
    },
    summary: { ...attendanceSummary(total), recordsOnNonWorkingDays: onNonWorking },
    today:     byDate.has(today) ? { date: today, ...attendanceSummary(byDate.get(today)!) } : null,
    thisWeek:  { from: thisWeek, ...sumRange(byDate, thisWeek, today) },
    thisMonth: { month: thisMonth, ...sumRange(byDate, `${thisMonth}-01`, today) },
    byMonth:   bucket(byDate, d => d.slice(0, 7)),
    byTerm:    terms.map(t => ({ term: t.term, startDate: toDay(t.from), endDate: toDay(t.to), ...sumRange(byDate, toDay(t.from), toDay(t.to)) })),
    byClass: [...group(byClassRows, 'classId')].map(([id, c]) => ({
      classId: id, className: classMap.get(id)?.name ?? null, numericLevel: classMap.get(id)?.numericLevel ?? null, ...attendanceSummary(c),
    })).sort((a, b) => (a.numericLevel ?? 0) - (b.numericLevel ?? 0)),
    bySection: [...group(bySectionRows, 'sectionId')].map(([id, c]) => {
      const s = sectionMap.get(id);
      return { sectionId: id, sectionName: s?.name ?? null, classId: s?.classId ?? null, className: s ? classMap.get(s.classId)?.name ?? null : null, ...attendanceSummary(c) };
    }),
  };
};

// ── GET /admin/analytics/attendance-trend ─────────────────────
export const getAttendanceTrend = async (ctx: AnalyticsContext, granularity: 'DAY' | 'WEEK' | 'MONTH') => {
  const days   = await getSchoolDays(ctx.schoolId, ctx.range, ctx.today);
  const byDate = await dailyCounts(ctx, days);
  const keyOf  = granularity === 'DAY' ? (d: string) => d
               : granularity === 'WEEK' ? (d: string) => weekStart(new Date(`${d}T00:00:00.000Z`))
               : (d: string) => d.slice(0, 7);
  return { meta: metaOf(ctx, { granularity }), points: bucket(byDate, keyOf) };
};

// ── GET /admin/analytics/teacher-attendance ───────────────────
export const getTeacherAttendance = async (ctx: AnalyticsContext) => {
  const days  = await getSchoolDays(ctx.schoolId, ctx.range, ctx.today);
  const where = teacherAttendanceWhere(ctx, ctx.range, days);

  const [byTeacherRows, totalRows, markedDates, teachers, leaves] = await Promise.all([
    prisma.teacherAttendanceRecord.groupBy({ by: ['teacherId', 'status'], where, _count: { _all: true } }),
    prisma.teacherAttendanceRecord.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.teacherAttendanceRecord.groupBy({ by: ['date'], where }),
    prisma.teacher.findMany({
      where:  { schoolId: ctx.schoolId, ...(ctx.teacherId ? { id: ctx.teacherId } : {}) },
      select: { id: true, employeeId: true, status: true, user: { select: { name: true } } },
    }),
    prisma.teacherLeaveRequest.findMany({
      where: {
        schoolId: ctx.schoolId,
        ...(ctx.teacherId ? { teacherId: ctx.teacherId } : {}),
        fromDate: { lte: ctx.range.to },
        toDate:   { gte: ctx.range.from },
      },
      select: { teacherId: true, status: true, fromDate: true, toDate: true },
    }),
  ]);

  // Leave days that fall on scheduled working days inside the range.
  const working = new Set(days.workingDates);
  const leaveDays = (l: { fromDate: Date; toDate: Date }) => {
    let n = 0;
    for (let d = l.fromDate; d <= l.toDate; d = new Date(d.getTime() + 86_400_000)) if (working.has(toDay(d))) n++;
    return n;
  };
  const leaveByTeacher = new Map<string, { requests: number; approved: number; pending: number; rejected: number; approvedDays: number }>();
  for (const l of leaves) {
    const t = leaveByTeacher.get(l.teacherId) ?? { requests: 0, approved: 0, pending: 0, rejected: 0, approvedDays: 0 };
    t.requests++;
    if (l.status === 'APPROVED') { t.approved++; t.approvedDays += leaveDays(l); }
    if (l.status === 'PENDING')  t.pending++;
    if (l.status === 'REJECTED') t.rejected++;
    leaveByTeacher.set(l.teacherId, t);
  }

  const perTeacher = new Map<string, StatusCounts>();
  for (const r of byTeacherRows) {
    const c = perTeacher.get(r.teacherId) ?? emptyCounts();
    addTo(c, r.status, r._count._all);
    perTeacher.set(r.teacherId, c);
  }

  const activeTeachers = teachers.filter(t => t.status === RECORD_STATUS.ACTIVE).length;
  const summary = attendanceSummary(countsFrom(totalRows));
  const expectedTeacherDays = activeTeachers * days.scheduledWorkingDaysToDate;

  return {
    meta: metaOf(ctx),
    calendar: {
      scheduledWorkingDays:       days.scheduledWorkingDays,
      scheduledWorkingDaysToDate: days.scheduledWorkingDaysToDate,
      actualWorkingDays:          markedDates.length,
    },
    summary: {
      activeTeachers,
      ...summary,
      // How much of the expected register is filled in (unmarked days are
      // NOT counted as absences).
      expectedTeacherDays,
      markingCoveragePercentage: pct(summary.markedRecords, expectedTeacherDays),
      leaveRequests: [...leaveByTeacher.values()].reduce((a, t) => ({
        total: a.total + t.requests, approved: a.approved + t.approved, pending: a.pending + t.pending,
        rejected: a.rejected + t.rejected, approvedLeaveDays: a.approvedLeaveDays + t.approvedDays,
      }), { total: 0, approved: 0, pending: 0, rejected: 0, approvedLeaveDays: 0 }),
    },
    teachers: teachers.map(t => {
      const c = perTeacher.get(t.id) ?? emptyCounts();
      return {
        teacherId:  t.id,
        employeeId: t.employeeId,
        name:       t.user.name,
        status:     t.status,
        ...attendanceSummary(c),
        leave: leaveByTeacher.get(t.id) ?? { requests: 0, approved: 0, pending: 0, rejected: 0, approvedDays: 0 },
      };
    }).sort((a, b) => (a.attendancePercentage ?? 101) - (b.attendancePercentage ?? 101)),
  };
};

// ── GET /admin/analytics/school-calendar ──────────────────────
export const getSchoolCalendar = async (ctx: AnalyticsContext) => {
  const days = await getSchoolDays(ctx.schoolId, ctx.range, ctx.today);
  const [studentDates, teacherDates, examDays] = await Promise.all([
    prisma.attendanceRecord.groupBy({ by: ['date'], where: { schoolId: ctx.schoolId, date: { gte: ctx.range.from, lte: ctx.range.to } } }),
    prisma.teacherAttendanceRecord.groupBy({ by: ['date'], where: { schoolId: ctx.schoolId, date: { gte: ctx.range.from, lte: ctx.range.to } } }),
    prisma.examSchedule.groupBy({ by: ['date'], where: { schoolId: ctx.schoolId, date: { gte: ctx.range.from, lte: ctx.range.to } } }),
  ]);

  const working  = new Set(days.workingDates);
  const marked   = new Set(studentDates.map(r => toDay(r.date)));
  const todayStr = toDay(ctx.today);
  const markedOnWorking    = [...marked].filter(d => working.has(d));
  const markedOnNonWorking = [...marked].filter(d => !working.has(d)).sort();
  // Past working days with no attendance at all — likely missed registers.
  const unmarkedWorkingDays = days.workingDates.filter(d => d <= todayStr && !marked.has(d));

  return {
    meta: metaOf(ctx),
    summary: {
      totalDays:                  days.totalDays,
      sundays:                    days.sundays,
      holidayDays:                days.holidayDays,
      governmentHolidayDays:      days.governmentHolidayDays,
      vacationDays:               days.vacationDays,
      schoolClosedDays:           days.schoolClosedDays,
      scheduledWorkingDays:       days.scheduledWorkingDays,
      scheduledWorkingDaysToDate: days.scheduledWorkingDaysToDate,
      actualWorkingDays:          markedOnWorking.length,
      teacherAttendanceDays:      teacherDates.length,
      examDays:                   examDays.length,
      unmarkedWorkingDays:        unmarkedWorkingDays.length,
      attendanceMarkedOnNonWorkingDays: markedOnNonWorking.length,
    },
    months: monthsIn(ctx.range).map(m => {
      const from = toDay(m.from), to = toDay(m.to);
      const inMonth = (d: string) => d >= from && d <= to;
      return {
        month:                m.month,
        scheduledWorkingDays: days.workingDates.filter(inMonth).length,
        actualWorkingDays:    markedOnWorking.filter(inMonth).length,
        unmarkedWorkingDays:  unmarkedWorkingDays.filter(inMonth).length,
      };
    }),
    unmarkedWorkingDates:             unmarkedWorkingDays.slice(-60),
    attendanceMarkedOnNonWorkingDates: markedOnNonWorking,
  };
};

// ── GET /admin/analytics/low-attendance-students ──────────────
// Per-student totals are aggregated in the DB (one row per student ×
// status); only the requested page is enriched with names.
export const lowAttendanceRows = async (ctx: AnalyticsContext, threshold: number, minMarkedDays: number) => {
  const days = await getSchoolDays(ctx.schoolId, ctx.range, ctx.today);
  const rows = await prisma.$queryRaw<{ studentId: string; present: bigint; late: bigint; absent: bigint; leave: bigint }[]>`
    SELECT ar."studentId",
      COUNT(*) FILTER (WHERE ar.status = 'PRESENT') AS present,
      COUNT(*) FILTER (WHERE ar.status = 'LATE')    AS late,
      COUNT(*) FILTER (WHERE ar.status = 'ABSENT')  AS absent,
      COUNT(*) FILTER (WHERE ar.status = 'LEAVE')   AS leave
    FROM attendance_records ar
    JOIN students s ON s.id = ar."studentId" AND s.status = ${RECORD_STATUS.ACTIVE}
    WHERE ar."schoolId" = ${ctx.schoolId}
      AND ar.date BETWEEN ${ctx.range.from} AND ${ctx.range.to}
      AND ar.status <> 'HOLIDAY'
      ${days.nonWorkingDates.length ? Prisma.sql`AND ar.date NOT IN (${Prisma.join(days.nonWorkingDates)})` : Prisma.empty}
      ${sqlIf(ctx.classId,   Prisma.sql`AND ar."classId"   = ${ctx.classId}`)}
      ${sqlIf(ctx.sectionId, Prisma.sql`AND ar."sectionId" = ${ctx.sectionId}`)}
    GROUP BY ar."studentId"`;

  return rows
    .map(r => {
      const present = num(r.present), late = num(r.late), absent = num(r.absent), leave = num(r.leave);
      const marked = present + late + absent + leave;
      return { studentId: r.studentId, present, late, absent, approvedLeave: leave, markedDays: marked, attendancePercentage: pct(present + late, marked) };
    })
    .filter(r => r.markedDays >= minMarkedDays && r.attendancePercentage !== null && r.attendancePercentage < threshold)
    .sort((a, b) => a.attendancePercentage! - b.attendancePercentage!);
};

export const studentDetails = async (ids: string[]) => {
  const students = await prisma.student.findMany({
    where:  { id: { in: ids } },
    select: {
      id: true, name: true, admissionNo: true, rollNo: true, parentName: true, parentPhone: true,
      class: { select: { id: true, name: true } }, section: { select: { id: true, name: true } },
    },
  });
  const map = new Map(students.map(s => [s.id, s]));
  return (id: string) => {
    const s = map.get(id);
    return s ? {
      studentId: s.id, name: s.name, admissionNo: s.admissionNo, rollNo: s.rollNo,
      classId: s.class.id, className: s.class.name, sectionId: s.section.id, sectionName: s.section.name,
      parentName: s.parentName, parentPhone: s.parentPhone,
    } : { studentId: id };
  };
};

export const getLowAttendanceStudents = async (ctx: AnalyticsContext, q: { threshold: number; minMarkedDays: number; page: number; pageSize: number }) => {
  const all  = await lowAttendanceRows(ctx, q.threshold, q.minMarkedDays);
  const page = all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
  const who  = await studentDetails(page.map(r => r.studentId));
  return {
    meta: metaOf(ctx, { threshold: q.threshold, minMarkedDays: q.minMarkedDays }),
    items: page.map(r => ({ ...who(r.studentId), ...r })),
    page: q.page, pageSize: q.pageSize, total: all.length, totalPages: Math.max(1, Math.ceil(all.length / q.pageSize)),
  };
};

// ── GET /admin/analytics/repeated-absences ────────────────────
// Streaks are over MARKED days (a weekend or holiday in between doesn't
// break or extend a streak). currentStreak = absences in a row up to the
// student's latest marked day; longestStreak = the longest run in range.
export const repeatedAbsenceRows = async (ctx: AnalyticsContext, minConsecutive: number) => {
  const days = await getSchoolDays(ctx.schoolId, ctx.range, ctx.today);
  const rows = await prisma.$queryRaw<{ studentId: string; currentStreak: bigint; longestStreak: bigint; absences: bigint; lastAbsentOn: Date | null }[]>`
    WITH r AS (
      SELECT ar."studentId", ar.date, ar.status,
             ROW_NUMBER() OVER (PARTITION BY ar."studentId" ORDER BY ar.date)      AS rn,
             ROW_NUMBER() OVER (PARTITION BY ar."studentId" ORDER BY ar.date DESC) AS rn_desc
      FROM attendance_records ar
      JOIN students s ON s.id = ar."studentId" AND s.status = ${RECORD_STATUS.ACTIVE}
      WHERE ar."schoolId" = ${ctx.schoolId}
        AND ar.date BETWEEN ${ctx.range.from} AND ${ctx.range.to}
        AND ar.status <> 'HOLIDAY'
        ${days.nonWorkingDates.length ? Prisma.sql`AND ar.date NOT IN (${Prisma.join(days.nonWorkingDates)})` : Prisma.empty}
        ${sqlIf(ctx.classId,   Prisma.sql`AND ar."classId"   = ${ctx.classId}`)}
        ${sqlIf(ctx.sectionId, Prisma.sql`AND ar."sectionId" = ${ctx.sectionId}`)}
    ),
    runs AS (
      SELECT "studentId", COUNT(*) AS len
      FROM (SELECT "studentId", rn - ROW_NUMBER() OVER (PARTITION BY "studentId" ORDER BY date) AS grp
            FROM r WHERE status = 'ABSENT') a
      GROUP BY "studentId", grp
    ),
    cur AS (
      SELECT "studentId",
             COALESCE(MIN(rn_desc) FILTER (WHERE status <> 'ABSENT'), COUNT(*) + 1) - 1 AS streak,
             COUNT(*) FILTER (WHERE status = 'ABSENT') AS absences,
             MAX(date) FILTER (WHERE status = 'ABSENT') AS last_absent
      FROM r GROUP BY "studentId"
    )
    SELECT cur."studentId", cur.streak AS "currentStreak", MAX(runs.len) AS "longestStreak",
           cur.absences, cur.last_absent AS "lastAbsentOn"
    FROM cur JOIN runs ON runs."studentId" = cur."studentId"
    GROUP BY cur."studentId", cur.streak, cur.absences, cur.last_absent
    HAVING MAX(runs.len) >= ${minConsecutive}
    ORDER BY cur.streak DESC, MAX(runs.len) DESC`;

  return rows.map(r => ({
    studentId:     r.studentId,
    currentStreak: num(r.currentStreak),
    longestStreak: num(r.longestStreak),
    absences:      num(r.absences),
    lastAbsentOn:  r.lastAbsentOn ? toDay(r.lastAbsentOn) : null,
    ongoing:       num(r.currentStreak) >= minConsecutive,
  }));
};

export const getRepeatedAbsences = async (ctx: AnalyticsContext, q: { minConsecutive: number; page: number; pageSize: number }) => {
  const all  = await repeatedAbsenceRows(ctx, q.minConsecutive);
  const page = all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
  const who  = await studentDetails(page.map(r => r.studentId));
  return {
    meta: metaOf(ctx, { minConsecutive: q.minConsecutive }),
    summary: { students: all.length, ongoing: all.filter(r => r.ongoing).length },
    items: page.map(r => ({ ...who(r.studentId), ...r })),
    page: q.page, pageSize: q.pageSize, total: all.length, totalPages: Math.max(1, Math.ceil(all.length / q.pageSize)),
  };
};
