import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/db';
import { RECORD_STATUS } from '../../../constants';
import { AnalyticsContext, metaOf, sqlIf, withRange } from './analytics.context';
import { lowAttendanceRows, studentDetails } from './attendance.service';
import {
  DateRange, SCORE_BANDS, compare, num, numOrNull, passFailSummary, pct, previousYearWindow, round2, toDay, unavailable,
} from './analytics.utils';

// ════════════════════════════════════════════════════════════
// Academic performance — built on ExamMark (one student × one paper),
// with ExamSchedule.maxMarks as the paper's maximum. Every score is
// normalized to a percentage (marks / maxMarks × 100) before averaging
// or comparing, so a paper out of 20 and one out of 100 weigh the same.
//
// Outcomes (same as paperOutcome/examOutcome in analytics.utils):
//   GRADED with marks: PASS if ≥ passPercentage, else FAIL
//   ABSENT: reported separately, never a fail
//   PENDING / no marks: pending, never a fail
// Papers held (date ≤ today) with NO ExamMark row for an active student
// of the class are counted as "marks not entered".
//
// Filters: examId (when set, the date range is ignored — the whole exam
// counts), classId, sectionId (student's current section — ExamMark has
// no section snapshot), subjectId, teacherId (papers of the sections and
// subjects the teacher teaches — same rule as teacher grading: timetable
// periods first, TeacherSubject when a section has no periods for it).
// ════════════════════════════════════════════════════════════

const NOT_TRACKED = {
  componentMarks: unavailable(
    'Marks are stored as one total per paper',
    ['ExamMark.theoryMarks / practicalMarks / projectMarks (or a component table)', 'ExamSchedule max marks per component'],
  ),
  eligibility: unavailable(
    'No exemption / result-eligibility rules are stored; ABSENT and PENDING are already excluded from pass/fail',
    ['ExamMark status EXEMPTED (or an exemption table)'],
  ),
};

// Teacher ↔ (section, subject) assignments, mirroring getGradableSections
// in teacher.service.ts.
export const assignmentsCte = (schoolId: string) => Prisma.sql`
  sched AS (
    SELECT DISTINCT cs."teacherId", cs."sectionId", cs."subjectId"
    FROM class_schedules cs
    WHERE cs."schoolId" = ${schoolId} AND cs.type = 'CLASS_PERIOD'
      AND cs."teacherId" IS NOT NULL AND cs."subjectId" IS NOT NULL
  ),
  assign AS (
    SELECT * FROM sched
    UNION
    SELECT ts."teacherId", sec.id AS "sectionId", ts."subjectId"
    FROM teacher_subjects ts
    JOIN teachers t   ON t.id = ts."teacherId" AND t."schoolId" = ${schoolId}
    JOIN sections sec ON sec."classId" = ts."classId"
    WHERE NOT EXISTS (
      SELECT 1 FROM sched x WHERE x."sectionId" = sec.id AND x."subjectId" = ts."subjectId"
    )
  )`;

// `m` = the filtered mark rows, with the normalized percentage `p`.
// `withTeacher` adds a teacherId column (rows repeat per teacher — only
// for per-teacher grouping).
const marksCte = (ctx: AnalyticsContext, range: DateRange = ctx.range, withTeacher = false) => Prisma.sql`
  WITH ${assignmentsCte(ctx.schoolId)},
  m AS (
    SELECT em."studentId", em.status, em."marksObtained", em.grade,
           es."examId", es."classId", es."subjectId", es.date, es."maxMarks", st."sectionId",
           ${withTeacher ? Prisma.sql`a."teacherId",` : Prisma.empty}
           CASE WHEN em.status = 'GRADED' AND em."marksObtained" IS NOT NULL AND es."maxMarks" > 0
                THEN em."marksObtained" * 100.0 / es."maxMarks" END AS p
    FROM exam_marks em
    JOIN exam_schedules es ON es.id = em."examScheduleId"
    JOIN students st       ON st.id = em."studentId"
    ${withTeacher ? Prisma.sql`JOIN assign a ON a."sectionId" = st."sectionId" AND a."subjectId" = es."subjectId"` : Prisma.empty}
    WHERE es."schoolId" = ${ctx.schoolId}
      ${ctx.examId ? Prisma.sql`AND es."examId" = ${ctx.examId}` : Prisma.sql`AND es.date BETWEEN ${range.from} AND ${range.to}`}
      ${sqlIf(ctx.classId,   Prisma.sql`AND es."classId"   = ${ctx.classId}`)}
      ${sqlIf(ctx.sectionId, Prisma.sql`AND st."sectionId" = ${ctx.sectionId}`)}
      ${sqlIf(ctx.subjectId, Prisma.sql`AND es."subjectId" = ${ctx.subjectId}`)}
      ${sqlIf(ctx.teacherId, Prisma.sql`AND EXISTS (SELECT 1 FROM assign t WHERE t."teacherId" = ${ctx.teacherId}
                                                    AND t."sectionId" = st."sectionId" AND t."subjectId" = es."subjectId")`)}
      ${sqlIf(withTeacher && ctx.teacherId, Prisma.sql`AND a."teacherId" = ${ctx.teacherId}`)}
  )`;

const statsSelect = (pass: number) => Prisma.sql`
  COUNT(*)                                                    AS papers,
  COUNT(*) FILTER (WHERE p IS NOT NULL)                       AS graded,
  COUNT(*) FILTER (WHERE p >= ${pass})                        AS passed,
  COUNT(*) FILTER (WHERE p <  ${pass})                        AS failed,
  COUNT(*) FILTER (WHERE status = 'ABSENT')                   AS absent,
  COUNT(*) FILTER (WHERE p IS NULL AND status <> 'ABSENT')    AS pending,
  COUNT(DISTINCT "studentId") FILTER (WHERE p IS NOT NULL)    AS students,
  AVG(p)                                                      AS average,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY p)              AS median,
  MAX(p)                                                      AS highest,
  MIN(p)                                                      AS lowest`;

interface StatsRow {
  papers: bigint; graded: bigint; passed: bigint; failed: bigint; absent: bigint; pending: bigint; students: bigint;
  average: number | null; median: number | null; highest: number | null; lowest: number | null;
}

const toStats = (r: StatsRow | undefined) => ({
  papers:            num(r?.papers),
  gradedPapers:      num(r?.graded),
  assessedStudents:  num(r?.students),
  averagePercentage: numOrNull(r?.average),
  medianPercentage:  numOrNull(r?.median),
  highestPercentage: numOrNull(r?.highest),
  lowestPercentage:  numOrNull(r?.lowest),
  ...passFailSummary(num(r?.passed), num(r?.failed), num(r?.absent), num(r?.pending)),
});

export type PaperStats = ReturnType<typeof toStats>;

type GroupKey = 'examId' | 'classId' | 'sectionId' | 'subjectId' | 'studentId' | 'teacherId';

// Paper-level stats, overall (key = null) or grouped by one column.
export const paperStats = async (ctx: AnalyticsContext, key: GroupKey | null = null, range: DateRange = ctx.range) => {
  const col = key ? Prisma.raw(`"${key}"`) : null;
  const rows = await prisma.$queryRaw<(StatsRow & { key: string | null })[]>`
    ${marksCte(ctx, range, key === 'teacherId')}
    SELECT ${col ? Prisma.sql`${col} AS key,` : Prisma.sql`NULL AS key,`} ${statsSelect(ctx.passPercentage)}
    FROM m ${col ? Prisma.sql`GROUP BY ${col}` : Prisma.empty}`;
  return rows.map(r => ({ key: r.key, ...toStats(r) }));
};

export const overallPaperStats = async (ctx: AnalyticsContext, range: DateRange = ctx.range) =>
  (await paperStats(ctx, null, range))[0] ?? toStats(undefined);

// Student × exam outcomes (a student passes an exam when every assessed
// paper is a pass and none is pending).
export const studentExamOutcomes = async (ctx: AnalyticsContext, range: DateRange = ctx.range) => {
  const pass = ctx.passPercentage;
  const [row] = await prisma.$queryRaw<{ pass: bigint; fail: bigint; absent: bigint; pending: bigint }[]>`
    ${marksCte(ctx, range)},
    se AS (
      SELECT "studentId", "examId",
        CASE WHEN COUNT(*) FILTER (WHERE p IS NULL AND status <> 'ABSENT') > 0 THEN 'PENDING'
             WHEN COUNT(*) FILTER (WHERE p < ${pass}) > 0                     THEN 'FAIL'
             WHEN COUNT(*) FILTER (WHERE p >= ${pass}) > 0                    THEN 'PASS'
             ELSE 'ABSENT' END AS outcome
      FROM m GROUP BY "studentId", "examId"
    )
    SELECT COUNT(*) FILTER (WHERE outcome = 'PASS')    AS pass,
           COUNT(*) FILTER (WHERE outcome = 'FAIL')    AS fail,
           COUNT(*) FILTER (WHERE outcome = 'ABSENT')  AS absent,
           COUNT(*) FILTER (WHERE outcome = 'PENDING') AS pending
    FROM se`;
  return passFailSummary(num(row?.pass), num(row?.fail), num(row?.absent), num(row?.pending));
};

// Papers already held (date ≤ today) that are missing an ExamMark row for
// an active student of the class.
export const missingMarkEntries = async (ctx: AnalyticsContext, range: DateRange = ctx.range) => {
  const [row] = await prisma.$queryRaw<{ missing: bigint; papers: bigint }[]>`
    WITH ${assignmentsCte(ctx.schoolId)}
    SELECT COUNT(*) AS missing, COUNT(DISTINCT es.id) AS papers
    FROM exam_schedules es
    JOIN students st ON st."classId" = es."classId" AND st.status = ${RECORD_STATUS.ACTIVE}
    LEFT JOIN exam_marks em ON em."examScheduleId" = es.id AND em."studentId" = st.id
    WHERE es."schoolId" = ${ctx.schoolId} AND em.id IS NULL AND es.date <= ${ctx.today}
      ${ctx.examId ? Prisma.sql`AND es."examId" = ${ctx.examId}` : Prisma.sql`AND es.date BETWEEN ${range.from} AND ${range.to}`}
      ${sqlIf(ctx.classId,   Prisma.sql`AND es."classId"   = ${ctx.classId}`)}
      ${sqlIf(ctx.sectionId, Prisma.sql`AND st."sectionId" = ${ctx.sectionId}`)}
      ${sqlIf(ctx.subjectId, Prisma.sql`AND es."subjectId" = ${ctx.subjectId}`)}
      ${sqlIf(ctx.teacherId, Prisma.sql`AND EXISTS (SELECT 1 FROM assign t WHERE t."teacherId" = ${ctx.teacherId}
                                                    AND t."sectionId" = st."sectionId" AND t."subjectId" = es."subjectId")`)}`;
  return { missingMarkEntries: num(row?.missing), papersWithMissingEntries: num(row?.papers) };
};

// Students by their average-percentage band + teacher-entered grades.
const gradeDistribution = async (ctx: AnalyticsContext) => {
  const bandCase = Prisma.raw(
    `CASE ${SCORE_BANDS.map(b => `WHEN a >= ${b.min} THEN '${b.band}'`).join(' ')} END`,
  );
  const [bands, grades] = await Promise.all([
    prisma.$queryRaw<{ band: string; n: bigint }[]>`
      ${marksCte(ctx)}
      SELECT ${bandCase} AS band, COUNT(*) AS n
      FROM (SELECT "studentId", AVG(p) AS a FROM m WHERE p IS NOT NULL GROUP BY "studentId") s
      GROUP BY band`,
    prisma.$queryRaw<{ grade: string; n: bigint }[]>`
      ${marksCte(ctx)}
      SELECT TRIM(grade) AS grade, COUNT(*) AS n FROM m
      WHERE p IS NOT NULL AND grade IS NOT NULL AND TRIM(grade) <> ''
      GROUP BY TRIM(grade) ORDER BY TRIM(grade)`,
  ]);
  const byBand = new Map(bands.map(b => [b.band, num(b.n)]));
  const total  = [...byBand.values()].reduce((a, b) => a + b, 0);
  return {
    basis: 'STUDENT_AVERAGE_PERCENTAGE',
    bands: SCORE_BANDS.map(b => ({ band: b.band, students: byBand.get(b.band) ?? 0, percentage: pct(byBand.get(b.band) ?? 0, total) })),
    enteredGrades: grades.map(g => ({ grade: g.grade, papers: num(g.n) })),
  };
};

// Names for grouped rows, fetched in one query per entity type.
const nameLookup = async (schoolId: string, key: GroupKey, ids: string[]) => {
  const valid = ids.filter(Boolean);
  switch (key) {
    case 'examId': {
      const rows = await prisma.exam.findMany({ where: { id: { in: valid }, schoolId }, select: { id: true, title: true, startDate: true, endDate: true } });
      return new Map(rows.map(r => [r.id, { examTitle: r.title, startDate: r.startDate ? toDay(r.startDate) : null, endDate: r.endDate ? toDay(r.endDate) : null }]));
    }
    case 'classId': {
      const rows = await prisma.class.findMany({ where: { id: { in: valid }, schoolId }, select: { id: true, name: true, numericLevel: true } });
      return new Map(rows.map(r => [r.id, { className: r.name, numericLevel: r.numericLevel }]));
    }
    case 'sectionId': {
      const rows = await prisma.section.findMany({ where: { id: { in: valid } }, select: { id: true, name: true, class: { select: { id: true, name: true } } } });
      return new Map(rows.map(r => [r.id, { sectionName: r.name, classId: r.class.id, className: r.class.name }]));
    }
    case 'subjectId': {
      const rows = await prisma.subject.findMany({ where: { id: { in: valid }, schoolId }, select: { id: true, name: true } });
      return new Map(rows.map(r => [r.id, { subjectName: r.name }]));
    }
    case 'teacherId': {
      const rows = await prisma.teacher.findMany({ where: { id: { in: valid }, schoolId }, select: { id: true, employeeId: true, user: { select: { name: true } } } });
      return new Map(rows.map(r => [r.id, { teacherName: r.user.name, employeeId: r.employeeId }]));
    }
    default:
      return new Map<string, Record<string, unknown>>();
  }
};

// Rows carry the group id under its own name (classId, subjectId…) plus
// that entity's display fields (className, subjectName…).
export type GroupedStats = PaperStats & Record<string, any>;

export const groupedStats = async (ctx: AnalyticsContext, key: GroupKey, range: DateRange = ctx.range): Promise<GroupedStats[]> => {
  const rows  = await paperStats(ctx, key, range);
  const names = await nameLookup(ctx.schoolId, key, rows.map(r => r.key!));
  return rows.map(({ key: id, ...s }) => ({ [key]: id, ...(names.get(id!) ?? {}), ...s }));
};

const byAverageDesc = <T extends { averagePercentage: number | null }>(a: T, b: T) =>
  (b.averagePercentage ?? -1) - (a.averagePercentage ?? -1);

// ── GET /admin/analytics/academic-performance ─────────────────
export const getAcademicPerformance = async (ctx: AnalyticsContext) => {
  const [summary, studentOutcomes, missing, distribution, bySubject, byClass] = await Promise.all([
    overallPaperStats(ctx),
    studentExamOutcomes(ctx),
    missingMarkEntries(ctx),
    gradeDistribution(ctx),
    groupedStats(ctx, 'subjectId'),
    groupedStats(ctx, 'classId'),
  ]);
  return {
    meta: metaOf(ctx),
    summary: { ...summary, ...missing },
    studentExamOutcomes: studentOutcomes,
    gradeDistribution: distribution,
    bySubject: bySubject.sort(byAverageDesc),
    byClass:   byClass.sort(byAverageDesc),
    ...NOT_TRACKED,
  };
};

// ── GET /admin/analytics/pass-fail ────────────────────────────
export const getPassFail = async (ctx: AnalyticsContext) => {
  const [papers, students, missing, byClass, bySection] = await Promise.all([
    overallPaperStats(ctx),
    studentExamOutcomes(ctx),
    missingMarkEntries(ctx),
    groupedStats(ctx, 'classId'),
    groupedStats(ctx, 'sectionId'),
  ]);
  const pick = ({ passCount, failCount, absentCount, pendingCount, assessedCount, passPercentage, failPercentage }: PaperStats) =>
    ({ passCount, failCount, absentCount, pendingCount, assessedCount, passPercentage, failPercentage });
  return {
    meta: metaOf(ctx),
    // Unit = one student's result on one exam (all its papers).
    studentExams: students,
    // Unit = one student's marks on one paper.
    papers: { ...pick(papers), ...missing },
    byClass:   byClass.map(c => ({ classId: c.classId, className: c.className, ...pick(c) })),
    bySection: bySection.map(s => ({ sectionId: s.sectionId, sectionName: s.sectionName, className: s.className, ...pick(s) })),
    eligibility: NOT_TRACKED.eligibility,
  };
};

// ── GET /admin/analytics/subject-performance ──────────────────
// A subject is flagged as a learning gap when its pass rate is below 75%
// or its average is 10+ points under the overall average.
export const getSubjectPerformance = async (ctx: AnalyticsContext) => {
  const [overall, subjects] = await Promise.all([overallPaperStats(ctx), groupedStats(ctx, 'subjectId')]);
  return {
    meta: metaOf(ctx),
    overallAveragePercentage: overall.averagePercentage,
    subjects: subjects.sort(byAverageDesc).map(s => {
      const gapVsOverall = s.averagePercentage !== null && overall.averagePercentage !== null
        ? round2(s.averagePercentage - overall.averagePercentage) : null;
      const reasons = [
        ...(s.passPercentage !== null && s.passPercentage < 75 ? ['PASS_RATE_BELOW_75'] : []),
        ...(gapVsOverall !== null && gapVsOverall <= -10 ? ['AVERAGE_10_POINTS_BELOW_SCHOOL'] : []),
      ];
      return {
        ...s,
        subjectId:   s.subjectId as string,
        subjectName: (s.subjectName ?? null) as string | null,
        gapVsOverallAverage: gapVsOverall, learningGap: reasons.length > 0, learningGapReasons: reasons,
      };
    }),
    componentMarks: NOT_TRACKED.componentMarks,
  };
};

// ── GET /admin/analytics/class-performance ────────────────────
export const getClassPerformance = async (ctx: AnalyticsContext) => {
  const [classes, sections] = await Promise.all([groupedStats(ctx, 'classId'), groupedStats(ctx, 'sectionId')]);
  const ranked = classes.sort(byAverageDesc).map((c, i) => ({ rank: c.averagePercentage === null ? null : i + 1, ...c }));
  return {
    meta: metaOf(ctx),
    classes:  ranked,
    sections: sections.sort(byAverageDesc),
    bestPerforming: ranked.filter(c => c.averagePercentage !== null).slice(0, 3),
  };
};

// ── GET /admin/analytics/exam-performance ─────────────────────
export const getExamPerformance = async (ctx: AnalyticsContext) => {
  const [exams, papers] = await Promise.all([
    groupedStats(ctx, 'examId'),
    prisma.examSchedule.groupBy({
      by: ['examId'],
      where: {
        schoolId: ctx.schoolId,
        ...(ctx.examId ? { examId: ctx.examId } : { date: { gte: ctx.range.from, lte: ctx.range.to } }),
        ...(ctx.classId   ? { classId: ctx.classId }     : {}),
        ...(ctx.subjectId ? { subjectId: ctx.subjectId } : {}),
      },
      _count: { _all: true }, _min: { date: true }, _max: { date: true },
    }),
  ]);
  const schedule = new Map(papers.map(p => [p.examId, p]));
  const rows = exams
    .map(e => {
      const s = schedule.get(e.examId as string);
      return {
        ...e,
        examId:          e.examId as string,
        examTitle:       (e.examTitle ?? null) as string | null,
        scheduledPapers: s?._count._all ?? 0,
        firstPaperDate:  s?._min.date ? toDay(s._min.date) : null,
        lastPaperDate:   s?._max.date ? toDay(s._max.date) : null,
      };
    })
    .sort((a, b) => (a.firstPaperDate ?? '').localeCompare(b.firstPaperDate ?? ''));

  // Each exam vs the one before it (normalized averages, so different
  // max marks compare fairly).
  return {
    meta: metaOf(ctx),
    exams: rows.map((e, i) => ({
      ...e,
      vsPreviousExam: i === 0 ? null : {
        examId: rows[i - 1].examId,
        average: compare(e.averagePercentage, rows[i - 1].averagePercentage, true),
        passPercentage: compare(e.passPercentage, rows[i - 1].passPercentage, true),
      },
    })),
  };
};

// Per-student averages for the period (DB-side), optionally with the
// subjects they failed.
const studentAverages = async (ctx: AnalyticsContext) => {
  const pass = ctx.passPercentage;
  return prisma.$queryRaw<{ studentId: string; average: number; graded: bigint; failed: bigint; absent: bigint; failedSubjects: string[] | null }[]>`
    ${marksCte(ctx)}
    SELECT m."studentId", AVG(p) AS average,
           COUNT(*) FILTER (WHERE p IS NOT NULL) AS graded,
           COUNT(*) FILTER (WHERE p < ${pass})   AS failed,
           COUNT(*) FILTER (WHERE m.status = 'ABSENT') AS absent,
           ARRAY_AGG(DISTINCT m."subjectId") FILTER (WHERE p < ${pass}) AS "failedSubjects"
    FROM m JOIN students s ON s.id = m."studentId" AND s.status = ${RECORD_STATUS.ACTIVE}
    GROUP BY m."studentId"
    HAVING COUNT(*) FILTER (WHERE p IS NOT NULL) > 0`;
};

// ── GET /admin/analytics/top-performers ───────────────────────
export const getTopPerformers = async (ctx: AnalyticsContext, q: { limit: number; minPapers: number }) => {
  const rows = await prisma.$queryRaw<{ studentId: string; average: number; graded: bigint; highest: number }[]>`
    ${marksCte(ctx)}
    SELECT m."studentId", AVG(p) AS average, COUNT(*) FILTER (WHERE p IS NOT NULL) AS graded, MAX(p) AS highest
    FROM m JOIN students s ON s.id = m."studentId" AND s.status = ${RECORD_STATUS.ACTIVE}
    GROUP BY m."studentId"
    HAVING COUNT(*) FILTER (WHERE p IS NOT NULL) >= ${q.minPapers}
    ORDER BY AVG(p) DESC
    LIMIT ${q.limit}`;
  const who = await studentDetails(rows.map(r => r.studentId));
  return {
    meta: metaOf(ctx, { minPapers: q.minPapers }),
    students: rows.map((r, i) => {
      const { parentName, parentPhone, ...student } = who(r.studentId) as any;
      return { rank: i + 1, ...student, averagePercentage: round2(Number(r.average)), highestPercentage: round2(Number(r.highest)), gradedPapers: num(r.graded) };
    }),
  };
};

// ── GET /admin/analytics/needs-support ────────────────────────
// Explainable: every student comes with the reasons they're listed.
export const needsSupportRows = async (ctx: AnalyticsContext, threshold: number, attendanceThreshold: number) => {
  const [averages, lowAttendance, subjects] = await Promise.all([
    studentAverages(ctx),
    lowAttendanceRows(ctx, attendanceThreshold, 5),
    prisma.subject.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true } }),
  ]);
  const subjectName = new Map(subjects.map(s => [s.id, s.name]));
  const attendance  = new Map(lowAttendance.map(a => [a.studentId, a.attendancePercentage]));

  return averages
    .map(r => {
      const average = round2(Number(r.average));
      const failed  = num(r.failed);
      const reasons = [
        ...(average < threshold ? ['LOW_AVERAGE'] : []),
        ...(failed > 0 ? ['FAILED_PAPERS'] : []),
        ...(attendance.has(r.studentId) ? ['LOW_ATTENDANCE'] : []),
      ];
      return {
        studentId: r.studentId,
        averagePercentage: average,
        gradedPapers: num(r.graded),
        failedPapers: failed,
        absentPapers: num(r.absent),
        failedSubjects: (r.failedSubjects ?? []).map(id => ({ subjectId: id, subjectName: subjectName.get(id) ?? null })),
        attendancePercentage: attendance.get(r.studentId) ?? null,
        reasons,
      };
    })
    .filter(r => r.reasons.includes('LOW_AVERAGE') || r.reasons.includes('FAILED_PAPERS'))
    .sort((a, b) => b.reasons.length - a.reasons.length || a.averagePercentage - b.averagePercentage);
};

export const getNeedsSupport = async (ctx: AnalyticsContext, q: { threshold: number; attendanceThreshold: number; page: number; pageSize: number }) => {
  const all  = await needsSupportRows(ctx, q.threshold, q.attendanceThreshold);
  const page = all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
  const who  = await studentDetails(page.map(r => r.studentId));
  return {
    meta: metaOf(ctx, { threshold: q.threshold, attendanceThreshold: q.attendanceThreshold }),
    summary: {
      students:       all.length,
      lowAverage:     all.filter(r => r.reasons.includes('LOW_AVERAGE')).length,
      failedPapers:   all.filter(r => r.reasons.includes('FAILED_PAPERS')).length,
      alsoLowAttendance: all.filter(r => r.reasons.includes('LOW_ATTENDANCE')).length,
    },
    items: page.map(r => ({ ...who(r.studentId), ...r })),
    page: q.page, pageSize: q.pageSize, total: all.length, totalPages: Math.max(1, Math.ceil(all.length / q.pageSize)),
  };
};

// Each student's average on their last two exams in the period → how
// many improved / declined. A change under 5 points counts as stable.
export const studentExamChanges = async (ctx: AnalyticsContext) => {
  return prisma.$queryRaw<{ studentId: string; latest: number; previous: number; latestExamId: string; previousExamId: string }[]>`
    ${marksCte(ctx)},
    per_exam AS (
      SELECT "studentId", "examId", AVG(p) AS avg_p, MIN(date) AS first_date
      FROM m WHERE p IS NOT NULL GROUP BY "studentId", "examId"
    ),
    ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY "studentId" ORDER BY first_date DESC) AS rn FROM per_exam
    )
    SELECT a."studentId", a.avg_p AS latest, b.avg_p AS previous, a."examId" AS "latestExamId", b."examId" AS "previousExamId"
    FROM ranked a JOIN ranked b ON b."studentId" = a."studentId" AND b.rn = 2
    WHERE a.rn = 1`;
};

// ── GET /admin/analytics/academic-growth ──────────────────────
export const getAcademicGrowth = async (ctx: AnalyticsContext) => {
  const window = previousYearWindow(ctx.range, ctx.today);
  const [exams, changes, current, previous] = await Promise.all([
    getExamPerformance({ ...ctx, examId: undefined }),
    studentExamChanges({ ...ctx, examId: undefined }),
    overallPaperStats({ ...ctx, examId: undefined }, window.current),
    overallPaperStats(withRange({ ...ctx, examId: undefined }, window.previous), window.previous),
  ]);

  const deltas = changes.map(c => Number(c.latest) - Number(c.previous));
  return {
    meta: metaOf(ctx, { note: 'examId is ignored here — growth compares exams with each other' }),
    examTrend: exams.exams.map(e => ({
      examId: e.examId, examTitle: e.examTitle, firstPaperDate: e.firstPaperDate,
      averagePercentage: e.averagePercentage, passPercentage: e.passPercentage, vsPreviousExam: e.vsPreviousExam,
    })),
    studentProgress: {
      comparedStudents: deltas.length,
      improved: deltas.filter(d => d >= 5).length,
      declined: deltas.filter(d => d <= -5).length,
      stable:   deltas.filter(d => d > -5 && d < 5).length,
      averageChangePoints: deltas.length ? round2(deltas.reduce((a, b) => a + b, 0) / deltas.length) : null,
    },
    yearOnYear: {
      currentPeriod:  { startDate: toDay(window.current.from),  endDate: toDay(window.current.to) },
      previousPeriod: { startDate: toDay(window.previous.from), endDate: toDay(window.previous.to) },
      truncatedToElapsed: window.truncated,
      averagePercentage: compare(current.averagePercentage, previous.averagePercentage, true),
      passPercentage:    compare(current.passPercentage, previous.passPercentage, true),
      comparable: current.gradedPapers > 0 && previous.gradedPapers > 0,
    },
  };
};

// Paper stats per calendar month (paper date) — for monthly trends.
export const monthlyPaperStats = async (ctx: AnalyticsContext) => {
  const rows = await prisma.$queryRaw<(StatsRow & { month: string })[]>`
    ${marksCte({ ...ctx, examId: undefined })}
    SELECT to_char(date, 'YYYY-MM') AS month, ${statsSelect(ctx.passPercentage)}
    FROM m GROUP BY to_char(date, 'YYYY-MM')`;
  return new Map(rows.map(r => [r.month, toStats(r)]));
};
