import { HomeworkType, Prisma } from '@prisma/client';
import { prisma } from '../../../config/db';
import { RECORD_STATUS } from '../../../constants';
import { AnalyticsContext, metaOf, sqlIf } from './analytics.context';
import { studentDetails } from './attendance.service';
import { DateRange, num, pct, unavailable } from './analytics.utils';

// ════════════════════════════════════════════════════════════
// Homework. A homework belongs to one section; its eligible students are
// that section's ACTIVE students (there's no per-student assignment, and
// no enrollment history — so a student who changed section is counted in
// their current one). HomeworkSubmission rows exist only once a teacher
// has marked a student, so per homework:
//   submitted + notSubmitted = checked, eligible − checked = not checked yet.
// Rates are always over eligible/checked students, never all enrolled.
// Homework is in the period when its dueDate is.
// ════════════════════════════════════════════════════════════

export const NO_SUBMISSION_TIME = unavailable(
  'Submissions record only SUBMITTED / NOT_SUBMITTED, not when the work was handed in',
  ['HomeworkSubmission.submittedAt', 'HomeworkSubmission status LATE'],
);

interface HomeworkRow {
  id: string; type: HomeworkType; status: string; classId: string; sectionId: string; subjectId: string;
  createdBy: string; dueDate: Date; eligible: bigint; submitted: bigint; notSubmitted: bigint;
}

// One row per homework in range, with eligible/submitted counts — every
// homework metric is a fold over these.
export const homeworkRows = async (ctx: AnalyticsContext, range: DateRange = ctx.range, types?: HomeworkType[]) => {
  const teacherUserId = ctx.teacherId
    ? (await prisma.teacher.findFirst({ where: { id: ctx.teacherId, schoolId: ctx.schoolId }, select: { userId: true } }))?.userId
    : undefined;

  const rows = await prisma.$queryRaw<HomeworkRow[]>`
    SELECT h.id, h.type, h.status, h."classId", h."sectionId", h."subjectId", h."createdBy", h."dueDate",
           COALESCE(e.n, 0)                                          AS eligible,
           COUNT(hs.id) FILTER (WHERE hs.status = 'SUBMITTED')       AS submitted,
           COUNT(hs.id) FILTER (WHERE hs.status = 'NOT_SUBMITTED')   AS "notSubmitted"
    FROM homework h
    LEFT JOIN (
      SELECT "sectionId", COUNT(*) AS n FROM students
      WHERE "schoolId" = ${ctx.schoolId} AND status = ${RECORD_STATUS.ACTIVE}
      GROUP BY "sectionId"
    ) e ON e."sectionId" = h."sectionId"
    LEFT JOIN homework_submissions hs ON hs."homeworkId" = h.id
    WHERE h."schoolId" = ${ctx.schoolId} AND h."isActive" = true
      AND h."dueDate" >= ${range.from} AND h."dueDate" < ${new Date(range.to.getTime() + 86_400_000)}
      ${sqlIf(ctx.classId,   Prisma.sql`AND h."classId"   = ${ctx.classId}`)}
      ${sqlIf(ctx.sectionId, Prisma.sql`AND h."sectionId" = ${ctx.sectionId}`)}
      ${sqlIf(ctx.subjectId, Prisma.sql`AND h."subjectId" = ${ctx.subjectId}`)}
      ${sqlIf(ctx.teacherId, Prisma.sql`AND h."createdBy" = ${teacherUserId ?? ''}`)}
      ${types?.length ? Prisma.sql`AND h.type::text IN (${Prisma.join(types)})` : Prisma.empty}
    GROUP BY h.id, e.n`;

  return rows.map(r => ({
    ...r,
    eligible:     num(r.eligible),
    submitted:    num(r.submitted),
    notSubmitted: num(r.notSubmitted),
  }));
};

export type HomeworkFact = Awaited<ReturnType<typeof homeworkRows>>[number];

export const homeworkSummary = (rows: HomeworkFact[], today: Date) => {
  let eligible = 0, submitted = 0, notSubmitted = 0, unchecked = 0, fullyChecked = 0, overdueUnchecked = 0, completedByTeacher = 0;
  for (const r of rows) {
    const checked = r.submitted + r.notSubmitted;
    const open    = Math.max(0, r.eligible - checked);
    eligible += r.eligible; submitted += r.submitted; notSubmitted += r.notSubmitted; unchecked += open;
    if (open === 0) fullyChecked++;
    else if (r.dueDate < today) overdueUnchecked++;
    if (r.status === 'COMPLETED') completedByTeacher++;
  }
  const checked = submitted + notSubmitted;
  return {
    homeworkAssigned:      rows.length,
    expectedSubmissions:   eligible,
    submitted,
    notSubmitted,
    notCheckedYet:         unchecked,
    // Of the students a teacher has checked, how many handed it in.
    submissionRate:        pct(submitted, checked),
    // Of every eligible student, how many are confirmed submitted.
    completionRate:        pct(submitted, eligible),
    checkingCompletionRate: pct(checked, eligible),
    fullyCheckedHomework:  fullyChecked,
    overdueUncheckedHomework: overdueUnchecked,
    markedCompletedByTeacher: completedByTeacher,
  };
};

const groupRows = (rows: HomeworkFact[], key: (r: HomeworkFact) => string) => {
  const m = new Map<string, HomeworkFact[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return m;
};

const names = async (schoolId: string) => {
  const [classes, sections, subjects] = await Promise.all([
    prisma.class.findMany({ where: { schoolId }, select: { id: true, name: true, numericLevel: true } }),
    prisma.section.findMany({ where: { class: { schoolId } }, select: { id: true, name: true, classId: true } }),
    prisma.subject.findMany({ where: { schoolId }, select: { id: true, name: true } }),
  ]);
  return {
    klass:   new Map(classes.map(c => [c.id, c])),
    section: new Map(sections.map(s => [s.id, s])),
    subject: new Map(subjects.map(s => [s.id, s.name])),
  };
};

// ── GET /admin/analytics/homework ─────────────────────────────
export const getHomework = async (ctx: AnalyticsContext) => {
  const [rows, n] = await Promise.all([homeworkRows(ctx), names(ctx.schoolId)]);
  return {
    meta: metaOf(ctx),
    summary: homeworkSummary(rows, ctx.today),
    byType: Object.values(HomeworkType).map(t => ({ type: t, ...homeworkSummary(rows.filter(r => r.type === t), ctx.today) })),
    bySubject: [...groupRows(rows, r => r.subjectId)].map(([id, rs]) => ({ subjectId: id, subjectName: n.subject.get(id) ?? null, ...homeworkSummary(rs, ctx.today) })),
    byClass: [...groupRows(rows, r => r.classId)].map(([id, rs]) => ({ classId: id, className: n.klass.get(id)?.name ?? null, numericLevel: n.klass.get(id)?.numericLevel ?? null, ...homeworkSummary(rs, ctx.today) }))
      .sort((a, b) => (a.numericLevel ?? 0) - (b.numericLevel ?? 0)),
    lateSubmissions: NO_SUBMISSION_TIME,
  };
};

// ── GET /admin/analytics/homework-submissions ─────────────────
export const getHomeworkSubmissions = async (ctx: AnalyticsContext) => {
  const [rows, n] = await Promise.all([homeworkRows(ctx), names(ctx.schoolId)]);
  const ids = rows.map(r => r.id);

  // Students marked NOT_SUBMITTED most often in the period.
  const missing = ids.length ? await prisma.homeworkSubmission.groupBy({
    by: ['studentId'],
    where: { homeworkId: { in: ids }, status: 'NOT_SUBMITTED', student: { status: RECORD_STATUS.ACTIVE } },
    _count: { _all: true },
    orderBy: { _count: { studentId: 'desc' } },
    take: 20,
  }) : [];
  const who = await studentDetails(missing.map(m => m.studentId));

  return {
    meta: metaOf(ctx),
    summary: homeworkSummary(rows, ctx.today),
    bySection: [...groupRows(rows, r => r.sectionId)].map(([id, rs]) => {
      const s = n.section.get(id);
      return { sectionId: id, sectionName: s?.name ?? null, classId: s?.classId ?? null, className: s ? n.klass.get(s.classId)?.name ?? null : null, ...homeworkSummary(rs, ctx.today) };
    }),
    studentsMostMissing: missing.map(m => ({ ...who(m.studentId), notSubmittedCount: m._count._all })),
    lateSubmissions: NO_SUBMISSION_TIME,
  };
};

// ── GET /admin/analytics/assignment-completion ────────────────
export const getAssignmentCompletion = async (ctx: AnalyticsContext) => {
  const rows = await homeworkRows(ctx, ctx.range, ['ASSIGNMENT', 'PROJECT']);
  return {
    meta: metaOf(ctx, { types: ['ASSIGNMENT', 'PROJECT'] }),
    summary: homeworkSummary(rows, ctx.today),
    assignments: homeworkSummary(rows.filter(r => r.type === 'ASSIGNMENT'), ctx.today),
    projects:    homeworkSummary(rows.filter(r => r.type === 'PROJECT'), ctx.today),
    onTimeRate:  NO_SUBMISSION_TIME,
  };
};

// ── GET /admin/analytics/project-practical ────────────────────
export const getProjectPractical = async (ctx: AnalyticsContext) => {
  const rows = await homeworkRows(ctx, ctx.range, ['PROJECT']);
  return {
    meta: metaOf(ctx),
    projects: homeworkSummary(rows, ctx.today),
    projectScores: unavailable('Project homework is marked submitted / not submitted only — no marks or quality rating', ['HomeworkSubmission.marks / rubric score']),
    practicals:    unavailable('Practical / lab work is not recorded', ['Practical marks on ExamMark (component marks)', 'Lab session / participation records']),
  };
};

// ── GET /admin/analytics/teacher-homework ─────────────────────
export const getTeacherHomework = async (ctx: AnalyticsContext) => {
  const [rows, teachers] = await Promise.all([
    homeworkRows(ctx),
    prisma.teacher.findMany({
      where:  { schoolId: ctx.schoolId, ...(ctx.teacherId ? { id: ctx.teacherId } : {}) },
      select: { id: true, userId: true, employeeId: true, status: true, user: { select: { name: true } } },
    }),
  ]);
  const byCreator = groupRows(rows, r => r.createdBy);
  const teacherUsers = new Set(teachers.map(t => t.userId));
  return {
    meta: metaOf(ctx),
    teachers: teachers.map(t => ({
      teacherId: t.id, employeeId: t.employeeId, name: t.user.name, status: t.status,
      ...homeworkSummary(byCreator.get(t.userId) ?? [], ctx.today),
    })).sort((a, b) => b.homeworkAssigned - a.homeworkAssigned),
    // Homework created by admins (not a teacher account).
    otherCreators: homeworkSummary(rows.filter(r => !teacherUsers.has(r.createdBy)), ctx.today),
  };
};
