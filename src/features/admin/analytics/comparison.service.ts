import { prisma } from '../../../config/db';
import { AnalyticsContext, getSchoolDays, metaOf, withRange } from './analytics.context';
import { enrolledInRange, enrollmentSnapshot } from './enrollment.service';
import { studentAttendanceTotals, teacherAttendanceTotals } from './attendance.service';
import { groupedStats, monthlyPaperStats, overallPaperStats } from './academics.service';
import { homeworkRows, homeworkSummary } from './homework.service';
import { PARTICIPATION_NOT_TRACKED } from './engagement.service';
import { TEACHER_NOT_TRACKED } from './teachers.service';
import {
  DateRange, attendanceSummary, compare, emptyCounts, monthsIn, previousYearWindow, splitIntoTerms, toDay,
} from './analytics.utils';

// ════════════════════════════════════════════════════════════
// Period comparisons. Every metric comes back as
//   { currentValue, previousValue, absoluteChange, percentageChange,
//     percentagePointChange, trendDirection, comparable }
// `comparable` is false when either side has no data — the app should
// show "not enough data" rather than a 100% jump from nothing.
// Year-on-year compares equivalent windows: an in-progress session is
// compared with the same elapsed stretch of last session.
// ════════════════════════════════════════════════════════════

// Core numbers for one period, all filters applied.
const periodMetrics = async (ctx: AnalyticsContext, range: DateRange) => {
  const c = withRange({ ...ctx, examId: undefined }, range);
  const days = await getSchoolDays(ctx.schoolId, range, ctx.today);
  const [enrollment, students, teachers, academics, homework] = await Promise.all([
    enrolledInRange(c, range),
    studentAttendanceTotals(c, range, days),
    teacherAttendanceTotals(c, range, days),
    overallPaperStats(c, range),
    homeworkRows(c, range),
  ]);
  const hw = homeworkSummary(homework, ctx.today);
  return {
    enrollment,
    studentAttendancePercentage: students.attendancePercentage,
    teacherAttendancePercentage: teachers.attendancePercentage,
    academicAveragePercentage:   academics.averagePercentage,
    passPercentage:              academics.passPercentage,
    homeworkAssigned:            hw.homeworkAssigned,
    homeworkSubmissionRate:      hw.submissionRate,
    homeworkCompletionRate:      hw.completionRate,
    homeworkCheckingRate:        hw.checkingCompletionRate,
    // presence flags for `comparable`
    _has: {
      enrollment: enrollment > 0,
      attendance: students.markedRecords > 0,
      teacherAttendance: teachers.markedRecords > 0,
      academics: academics.gradedPapers > 0,
      homework: hw.homeworkAssigned > 0,
    },
  };
};

type Metrics = Awaited<ReturnType<typeof periodMetrics>>;

const METRICS: { key: Exclude<keyof Metrics, '_has'>; has: keyof Metrics['_has']; isPercentage: boolean }[] = [
  { key: 'enrollment',                  has: 'enrollment',        isPercentage: false },
  { key: 'studentAttendancePercentage', has: 'attendance',        isPercentage: true },
  { key: 'teacherAttendancePercentage', has: 'teacherAttendance', isPercentage: true },
  { key: 'academicAveragePercentage',   has: 'academics',         isPercentage: true },
  { key: 'passPercentage',              has: 'academics',         isPercentage: true },
  { key: 'homeworkAssigned',            has: 'homework',          isPercentage: false },
  { key: 'homeworkSubmissionRate',      has: 'homework',          isPercentage: true },
  { key: 'homeworkCompletionRate',      has: 'homework',          isPercentage: true },
  { key: 'homeworkCheckingRate',        has: 'homework',          isPercentage: true },
];

const compareMetrics = (cur: Metrics, prev: Metrics) =>
  Object.fromEntries(METRICS.map(m => [m.key, {
    ...compare(cur[m.key] as number | null, prev[m.key] as number | null, m.isPercentage),
    comparable: cur._has[m.has] && prev._has[m.has],
  }]));

const period = (r: DateRange) => ({ startDate: toDay(r.from), endDate: toDay(r.to) });

// ── GET /admin/analytics/year-comparison ──────────────────────
export const getYearComparison = async (ctx: AnalyticsContext) => {
  const w = previousYearWindow(ctx.range, ctx.today);
  const [cur, prev, enrollment] = await Promise.all([
    periodMetrics(ctx, w.current),
    periodMetrics(ctx, w.previous),
    enrollmentSnapshot(ctx),
  ]);
  return {
    meta: metaOf(ctx),
    comparisonPeriod: { current: period(w.current), previous: period(w.previous), truncatedToElapsed: w.truncated },
    metrics: {
      ...compareMetrics(cur, prev),
      retentionRate: { currentValue: enrollment.retentionRate, comparable: enrollment.previousEnrollment > 0, note: 'Share of last session\'s students enrolled again this session' },
    },
    notComparable: {
      teacherWorkload:        { reason: 'The timetable has no history — only the current workload is known (see teacher-workload)' },
      weeklyTestCompletion:   TEACHER_NOT_TRACKED.weeklyTests,
      coCurricularParticipation: PARTICIPATION_NOT_TRACKED.activityParticipation,
    },
  };
};

// ── GET /admin/analytics/term-comparison ──────────────────────
// No Term table: the selected session/range is split into `terms`
// month-aligned parts; each term is compared with the one before it.
export const getTermComparison = async (ctx: AnalyticsContext, terms: number) => {
  const parts = splitIntoTerms(ctx.range, terms);
  const metrics = await Promise.all(parts.map(t => periodMetrics(ctx, t)));
  return {
    meta: metaOf(ctx, { termBasis: 'SESSION_SPLIT', terms }),
    terms: parts.map((t, i) => {
      const { _has, ...values } = metrics[i];
      return {
        term: t.term, ...period(t),
        started: t.from <= ctx.today,
        inProgress: t.from <= ctx.today && t.to > ctx.today,
        values,
        vsPreviousTerm: i === 0 ? null : compareMetrics(metrics[i], metrics[i - 1]),
      };
    }),
  };
};

// ── GET /admin/analytics/monthly-trends ───────────────────────
// Bucketed in memory from grouped queries — no per-month query fan-out.
export const getMonthlyTrends = async (ctx: AnalyticsContext) => {
  const days = await getSchoolDays(ctx.schoolId, ctx.range, ctx.today);
  const [attendance, papers, homework, admissions] = await Promise.all([
    prisma.attendanceRecord.groupBy({
      by: ['date', 'status'],
      where: {
        schoolId: ctx.schoolId,
        date: { gte: ctx.range.from, lte: ctx.range.to, notIn: days.nonWorkingDates },
        ...(ctx.classId   ? { classId: ctx.classId }     : {}),
        ...(ctx.sectionId ? { sectionId: ctx.sectionId } : {}),
      },
      _count: { _all: true },
    }),
    monthlyPaperStats(ctx),
    homeworkRows(ctx),
    prisma.student.findMany({
      where: {
        schoolId: ctx.schoolId,
        createdAt: { gte: ctx.range.from, lt: new Date(ctx.range.to.getTime() + 86_400_000) },
        ...(ctx.classId   ? { classId: ctx.classId }     : {}),
        ...(ctx.sectionId ? { sectionId: ctx.sectionId } : {}),
      },
      select: { createdAt: true },
    }),
  ]);

  return {
    meta: metaOf(ctx),
    months: monthsIn(ctx.range).map(m => {
      const counts = emptyCounts();
      for (const a of attendance) if (toDay(a.date).slice(0, 7) === m.month) counts[a.status] += a._count._all;
      const hw = homeworkSummary(homework.filter(h => toDay(h.dueDate).slice(0, 7) === m.month), ctx.today);
      const p  = papers.get(m.month);
      return {
        month: m.month,
        scheduledWorkingDays: days.workingDates.filter(d => d.slice(0, 7) === m.month).length,
        attendancePercentage: attendanceSummary(counts).attendancePercentage,
        academicAveragePercentage: p?.averagePercentage ?? null,
        passPercentage:            p?.passPercentage ?? null,
        gradedPapers:              p?.gradedPapers ?? 0,
        homeworkAssigned:          hw.homeworkAssigned,
        homeworkSubmissionRate:    hw.submissionRate,
        newAdmissions:             admissions.filter(s => toDay(s.createdAt).slice(0, 7) === m.month).length,
      };
    }),
  };
};

// ── GET /admin/analytics/class-comparison ─────────────────────
// Classes side by side for the period, each vs the same window last year.
export const getClassComparison = async (ctx: AnalyticsContext) => {
  const w = previousYearWindow(ctx.range, ctx.today);
  const c = withRange({ ...ctx, examId: undefined }, w.current);
  const p = withRange({ ...ctx, examId: undefined }, w.previous);
  const [daysCur, daysPrev] = await Promise.all([
    getSchoolDays(ctx.schoolId, w.current, ctx.today),
    getSchoolDays(ctx.schoolId, w.previous, ctx.today),
  ]);
  const attendanceByClass = (range: DateRange, nonWorking: Date[]) => prisma.attendanceRecord.groupBy({
    by: ['classId', 'status'],
    where: { schoolId: ctx.schoolId, date: { gte: range.from, lte: range.to, notIn: nonWorking }, ...(ctx.classId ? { classId: ctx.classId } : {}) },
    _count: { _all: true },
  });

  const [classes, attCur, attPrev, acadCur, acadPrev, hwCur, students] = await Promise.all([
    prisma.class.findMany({ where: { schoolId: ctx.schoolId, ...(ctx.classId ? { id: ctx.classId } : {}) }, select: { id: true, name: true, numericLevel: true }, orderBy: { numericLevel: 'asc' } }),
    attendanceByClass(w.current, daysCur.nonWorkingDates),
    attendanceByClass(w.previous, daysPrev.nonWorkingDates),
    groupedStats(c, 'classId', w.current),
    groupedStats(p, 'classId', w.previous),
    homeworkRows(c, w.current),
    prisma.student.groupBy({ by: ['classId'], where: { schoolId: ctx.schoolId, status: 'ACTIVE' }, _count: { _all: true } }),
  ]);

  const attPct = (rows: typeof attCur, classId: string) => {
    const counts = emptyCounts();
    for (const r of rows) if (r.classId === classId) counts[r.status] += r._count._all;
    return attendanceSummary(counts).attendancePercentage;
  };
  const acad = (rows: typeof acadCur, classId: string) => rows.find(r => r.classId === classId);
  const size = new Map(students.map(s => [s.classId, s._count._all]));

  return {
    meta: metaOf(ctx),
    comparisonPeriod: { current: period(w.current), previous: period(w.previous), truncatedToElapsed: w.truncated },
    classes: classes.map(k => ({
      classId: k.id, className: k.name, numericLevel: k.numericLevel,
      activeStudents: size.get(k.id) ?? 0,
      attendancePercentage:      compare(attPct(attCur, k.id), attPct(attPrev, k.id), true),
      academicAveragePercentage: compare(acad(acadCur, k.id)?.averagePercentage ?? null, acad(acadPrev, k.id)?.averagePercentage ?? null, true),
      passPercentage:            compare(acad(acadCur, k.id)?.passPercentage ?? null, acad(acadPrev, k.id)?.passPercentage ?? null, true),
      homeworkSubmissionRate:    homeworkSummary(hwCur.filter(h => h.classId === k.id), ctx.today).submissionRate,
    })),
  };
};

// ── GET /admin/analytics/subject-comparison ───────────────────
export const getSubjectComparison = async (ctx: AnalyticsContext) => {
  const w = previousYearWindow(ctx.range, ctx.today);
  const [cur, prev] = await Promise.all([
    groupedStats(withRange({ ...ctx, examId: undefined }, w.current), 'subjectId', w.current),
    groupedStats(withRange({ ...ctx, examId: undefined }, w.previous), 'subjectId', w.previous),
  ]);
  const prevBy = new Map(prev.map(p => [p.subjectId, p]));
  return {
    meta: metaOf(ctx),
    comparisonPeriod: { current: period(w.current), previous: period(w.previous), truncatedToElapsed: w.truncated },
    subjects: cur.map(s => {
      const p = prevBy.get(s.subjectId);
      return {
        subjectId: s.subjectId, subjectName: s.subjectName,
        gradedPapers: s.gradedPapers,
        averagePercentage: { ...compare(s.averagePercentage, p?.averagePercentage ?? null, true), comparable: !!p && p.gradedPapers > 0 },
        passPercentage:    { ...compare(s.passPercentage, p?.passPercentage ?? null, true),       comparable: !!p && p.gradedPapers > 0 },
      };
    }).sort((a, b) => (b.averagePercentage.currentValue ?? -1) - (a.averagePercentage.currentValue ?? -1)),
  };
};
