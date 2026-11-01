import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/db';
import { RECORD_STATUS } from '../../../constants';
import { AnalyticsContext, metaOf, sqlIf } from './analytics.context';
import { DateRange, growthPercentage, pct, num, sessionLabel, sessionRange, sessionYearOf, unavailable } from './analytics.utils';

// ════════════════════════════════════════════════════════════
// Enrollment.
//
// The schema keeps no enrollment history — a Student row has only its
// current class/section, a status (ACTIVE / INACTIVE) and createdAt. So:
//   • "Enrolled in a session" = distinct students with at least one
//     attendance record in that session. Attendance rows snapshot the
//     class/section at marking time, so this is historically accurate
//     and counts each student once however many rows they have.
//   • "New admissions" = students whose record was created in the period
//     (basis: createdAt — bulk-imported students count on their import date).
//   • "Exited" = students enrolled last session who are INACTIVE now.
//     Transfer vs withdrawal can't be told apart (no reason/date is stored).
// ════════════════════════════════════════════════════════════

const ENROLLMENT_BASIS = 'ATTENDANCE_RECORDS' as const;

const studentWhere = (ctx: AnalyticsContext, extra: Prisma.StudentWhereInput = {}): Prisma.StudentWhereInput => ({
  schoolId: ctx.schoolId,
  ...(ctx.classId   ? { classId:   ctx.classId }   : {}),
  ...(ctx.sectionId ? { sectionId: ctx.sectionId } : {}),
  ...extra,
});

const attendanceFilterSql = (ctx: AnalyticsContext, alias = 'ar') => Prisma.sql`
  ${Prisma.raw(alias)}."schoolId" = ${ctx.schoolId}
  ${sqlIf(ctx.classId,   Prisma.sql`AND ${Prisma.raw(alias)}."classId"   = ${ctx.classId}`)}
  ${sqlIf(ctx.sectionId, Prisma.sql`AND ${Prisma.raw(alias)}."sectionId" = ${ctx.sectionId}`)}
`;

// Distinct students with attendance in a range.
export const enrolledInRange = async (ctx: AnalyticsContext, range: DateRange): Promise<number> => {
  const [row] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(DISTINCT ar."studentId") AS n
    FROM attendance_records ar
    WHERE ${attendanceFilterSql(ctx)} AND ar.date BETWEEN ${range.from} AND ${range.to}`;
  return num(row?.n);
};

// Of the students enrolled in `previous`, how many were enrolled again in
// `current`, and how many are INACTIVE now.
const retentionBetween = async (ctx: AnalyticsContext, previous: DateRange, current: DateRange) => {
  const [row] = await prisma.$queryRaw<{ previous: bigint; retained: bigint; exited: bigint }[]>`
    WITH prev AS (
      SELECT DISTINCT ar."studentId" FROM attendance_records ar
      WHERE ${attendanceFilterSql(ctx)} AND ar.date BETWEEN ${previous.from} AND ${previous.to}
    ),
    cur AS (
      SELECT DISTINCT ar."studentId" FROM attendance_records ar
      WHERE ar."schoolId" = ${ctx.schoolId} AND ar.date BETWEEN ${current.from} AND ${current.to}
    )
    SELECT
      (SELECT COUNT(*) FROM prev)                                                   AS previous,
      (SELECT COUNT(*) FROM prev p JOIN cur c ON c."studentId" = p."studentId")     AS retained,
      (SELECT COUNT(*) FROM prev p JOIN students s ON s.id = p."studentId"
         WHERE s.status = ${RECORD_STATUS.INACTIVE})                                AS exited`;
  return { previous: num(row?.previous), retained: num(row?.retained), exited: num(row?.exited) };
};

// Active students per section × gender, plus each section's capacity —
// the building block for strength, gender and grade distribution.
const sectionBreakdown = async (ctx: AnalyticsContext) => {
  const [sections, grouped] = await Promise.all([
    prisma.section.findMany({
      where: {
        class: { schoolId: ctx.schoolId },
        ...(ctx.classId   ? { classId: ctx.classId } : {}),
        ...(ctx.sectionId ? { id: ctx.sectionId }    : {}),
      },
      select:  { id: true, name: true, capacity: true, class: { select: { id: true, name: true, numericLevel: true } } },
      orderBy: [{ class: { numericLevel: 'asc' } }, { name: 'asc' }],
    }),
    prisma.student.groupBy({
      by:     ['sectionId', 'gender'],
      where:  studentWhere(ctx, { status: RECORD_STATUS.ACTIVE }),
      _count: { _all: true },
    }),
  ]);

  const counts = new Map<string, { MALE: number; FEMALE: number; OTHER: number }>();
  for (const g of grouped) {
    const c = counts.get(g.sectionId) ?? { MALE: 0, FEMALE: 0, OTHER: 0 };
    c[g.gender] += g._count._all;
    counts.set(g.sectionId, c);
  }

  return sections.map(s => {
    const c = counts.get(s.id) ?? { MALE: 0, FEMALE: 0, OTHER: 0 };
    const students = c.MALE + c.FEMALE + c.OTHER;
    return {
      sectionId:   s.id,
      sectionName: s.name,
      classId:     s.class.id,
      className:   s.class.name,
      numericLevel: s.class.numericLevel,
      students,
      male:   c.MALE,
      female: c.FEMALE,
      other:  c.OTHER,
      capacity:    s.capacity,
      utilizationPercentage: pct(students, s.capacity),
    };
  });
};

type SectionRow = Awaited<ReturnType<typeof sectionBreakdown>>[number];

const rollUpClasses = (sections: SectionRow[]) => {
  const byClass = new Map<string, { classId: string; className: string; numericLevel: number; students: number; male: number; female: number; other: number; capacity: number; sections: SectionRow[] }>();
  for (const s of sections) {
    const c = byClass.get(s.classId) ?? {
      classId: s.classId, className: s.className, numericLevel: s.numericLevel,
      students: 0, male: 0, female: 0, other: 0, capacity: 0, sections: [],
    };
    c.students += s.students; c.male += s.male; c.female += s.female; c.other += s.other; c.capacity += s.capacity;
    c.sections.push(s);
    byClass.set(s.classId, c);
  }
  return [...byClass.values()].map(c => ({
    ...c,
    sectionCount: c.sections.length,
    utilizationPercentage: pct(c.students, c.capacity),
  }));
};

const genderTotals = (rows: { male: number; female: number; other: number }[]) => {
  const male   = rows.reduce((a, r) => a + r.male, 0);
  const female = rows.reduce((a, r) => a + r.female, 0);
  const other  = rows.reduce((a, r) => a + r.other, 0);
  const total  = male + female + other;
  return {
    total, male, female, other,
    malePercentage:   pct(male, total),
    femalePercentage: pct(female, total),
    otherPercentage:  pct(other, total),
  };
};

// Current vs previous session enrollment + movement. Used by overview,
// student-growth and comparisons.
export const enrollmentSnapshot = async (ctx: AnalyticsContext) => {
  const currentYear = ctx.session?.year;
  const current  = ctx.range;
  const previous = currentYear !== undefined
    ? sessionRange(currentYear - 1, ctx.sessionStartMonth)
    : { from: new Date(Date.UTC(current.from.getUTCFullYear() - 1, current.from.getUTCMonth(), current.from.getUTCDate())),
        to:   new Date(Date.UTC(current.to.getUTCFullYear() - 1, current.to.getUTCMonth(), current.to.getUTCDate())) };

  const [currentEnrollment, retention, newAdmissions, activeStudents, inactiveStudents] = await Promise.all([
    enrolledInRange(ctx, current),
    retentionBetween(ctx, previous, current),
    prisma.student.count({ where: studentWhere(ctx, { createdAt: { gte: current.from, lt: new Date(current.to.getTime() + 86_400_000) } }) }),
    prisma.student.count({ where: studentWhere(ctx, { status: RECORD_STATUS.ACTIVE }) }),
    prisma.student.count({ where: studentWhere(ctx, { status: RECORD_STATUS.INACTIVE }) }),
  ]);

  const previousEnrollment = retention.previous;
  return {
    basis: ENROLLMENT_BASIS,
    activeStudents,
    inactiveStudents,
    currentEnrollment,
    previousEnrollment,
    currentPeriodInProgress: current.to > ctx.today,
    newAdmissions,
    newAdmissionsBasis: 'STUDENT_CREATED_AT' as const,
    exitedSincePreviousPeriod: retention.exited,
    netEnrollmentChange: currentEnrollment - previousEnrollment,
    growthPercentage:    growthPercentage(currentEnrollment, previousEnrollment || null),
    retainedStudents:    retention.retained,
    retentionRate:       pct(retention.retained, previousEnrollment),
    transfers:   unavailable('Student exits are not recorded with a reason or date', ['Student.leftAt', 'Student.leftReason (TRANSFER / WITHDRAWAL)']),
    withdrawals: unavailable('Student exits are not recorded with a reason or date', ['Student.leftAt', 'Student.leftReason (TRANSFER / WITHDRAWAL)']),
    previousPeriod: { startDate: previous.from.toISOString().slice(0, 10), endDate: previous.to.toISOString().slice(0, 10) },
  };
};

// ── GET /admin/analytics/student-strength ─────────────────────
export const getStudentStrength = async (ctx: AnalyticsContext) => {
  const [sections, enrollment] = await Promise.all([sectionBreakdown(ctx), enrollmentSnapshot(ctx)]);
  const classes = rollUpClasses(sections);
  const capacity = sections.reduce((a, s) => a + s.capacity, 0);
  return {
    meta: metaOf(ctx),
    summary: {
      ...genderTotals(sections),
      classes:  classes.length,
      sections: sections.length,
      capacity,
      utilizationPercentage: pct(enrollment.activeStudents, capacity),
    },
    enrollment,
    classes: classes.map(({ sections: secs, ...c }) => ({ ...c, sections: secs.map(({ classId, className, numericLevel, ...s }) => s) })),
  };
};

// ── GET /admin/analytics/gender-distribution ──────────────────
export const getGenderDistribution = async (ctx: AnalyticsContext) => {
  const sections = await sectionBreakdown(ctx);
  const classes  = rollUpClasses(sections);
  return {
    meta:    metaOf(ctx, { basis: 'ACTIVE_STUDENTS' }),
    overall: genderTotals(sections),
    byClass: classes.map(c => ({ classId: c.classId, className: c.className, ...genderTotals([c]) })),
    bySection: sections.map(s => ({ classId: s.classId, className: s.className, sectionId: s.sectionId, sectionName: s.sectionName, ...genderTotals([s]) })),
  };
};

// ── GET /admin/analytics/grade-distribution ───────────────────
// "Grade" = class level (Class.numericLevel), not exam grades.
export const getGradeDistribution = async (ctx: AnalyticsContext) => {
  const sections = await sectionBreakdown(ctx);
  const classes  = rollUpClasses(sections);
  const total    = classes.reduce((a, c) => a + c.students, 0);
  return {
    meta: metaOf(ctx, { basis: 'ACTIVE_STUDENTS' }),
    totalStudents: total,
    grades: classes.map(c => ({
      classId:      c.classId,
      className:    c.className,
      numericLevel: c.numericLevel,
      students:     c.students,
      shareOfSchoolPercentage: pct(c.students, total),
      capacity:     c.capacity,
      utilizationPercentage: c.utilizationPercentage,
      sections: c.sections.map(s => ({
        sectionId: s.sectionId, sectionName: s.sectionName, students: s.students,
        capacity: s.capacity, utilizationPercentage: s.utilizationPercentage,
      })),
    })),
  };
};

// ── GET /admin/analytics/student-growth ───────────────────────
export const getStudentGrowth = async (ctx: AnalyticsContext) => ({
  meta: metaOf(ctx),
  ...(await enrollmentSnapshot(ctx)),
});

// ── GET /admin/analytics/enrollment-trend ─────────────────────
// One row per session, oldest first, ending at the selected session.
// Two grouped queries cover every session at once.
export const getEnrollmentTrend = async (ctx: AnalyticsContext, sessions: number) => {
  const lastYear  = ctx.session?.year ?? sessionYearOf(ctx.range.to, ctx.sessionStartMonth);
  const firstYear = lastYear - sessions + 1;
  const from = sessionRange(firstYear, ctx.sessionStartMonth).from;
  const to   = sessionRange(lastYear,  ctx.sessionStartMonth).to;
  const sm   = ctx.sessionStartMonth;

  const sessionYearSql = (col: Prisma.Sql) =>
    Prisma.sql`(EXTRACT(YEAR FROM ${col})::int - CASE WHEN EXTRACT(MONTH FROM ${col}) < ${sm} THEN 1 ELSE 0 END)`;

  const [enrolled, admitted] = await Promise.all([
    prisma.$queryRaw<{ sy: number; n: bigint }[]>`
      SELECT ${sessionYearSql(Prisma.sql`ar.date`)} AS sy, COUNT(DISTINCT ar."studentId") AS n
      FROM attendance_records ar
      WHERE ${attendanceFilterSql(ctx)} AND ar.date BETWEEN ${from} AND ${to}
      GROUP BY sy`,
    prisma.$queryRaw<{ sy: number; n: bigint }[]>`
      SELECT ${sessionYearSql(Prisma.sql`s."createdAt"`)} AS sy, COUNT(*) AS n
      FROM students s
      WHERE s."schoolId" = ${ctx.schoolId}
        ${sqlIf(ctx.classId,   Prisma.sql`AND s."classId"   = ${ctx.classId}`)}
        ${sqlIf(ctx.sectionId, Prisma.sql`AND s."sectionId" = ${ctx.sectionId}`)}
        AND s."createdAt" >= ${from} AND s."createdAt" < ${new Date(to.getTime() + 86_400_000)}
      GROUP BY sy`,
  ]);

  const enrolledBy = new Map(enrolled.map(r => [Number(r.sy), num(r.n)]));
  const admittedBy = new Map(admitted.map(r => [Number(r.sy), num(r.n)]));

  const rows = [];
  let prev: number | null = null;
  for (let y = firstYear; y <= lastYear; y++) {
    const r = sessionRange(y, sm);
    const enrollment = enrolledBy.get(y) ?? 0;
    rows.push({
      session:   { year: y, label: sessionLabel(y) },
      startDate: r.from.toISOString().slice(0, 10),
      endDate:   r.to.toISOString().slice(0, 10),
      enrollment,
      newAdmissions: admittedBy.get(y) ?? 0,
      growthPercentage: growthPercentage(enrollment, prev || null),
      inProgress: r.to > ctx.today,
    });
    prev = enrollment;
  }

  return { meta: metaOf(ctx, { basis: ENROLLMENT_BASIS }), sessions: rows };
};
