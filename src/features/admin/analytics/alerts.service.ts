import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/db';
import { DEFAULT_DELAYED_GRADING_DAYS, RECORD_STATUS } from '../../../constants';
import { AnalyticsContext, metaOf, sqlIf } from './analytics.context';
import { lowAttendanceRows, repeatedAbsenceRows } from './attendance.service';
import { assignmentsCte, getSubjectPerformance, studentExamChanges } from './academics.service';
import { homeworkRows } from './homework.service';
import { TEACHER_NOT_TRACKED } from './teachers.service';
import { addDays, num, pct, round2, toDay } from './analytics.utils';
import { AlertsQuery } from './analytics.validation';

// ════════════════════════════════════════════════════════════
// Smart alerts — computed on request from the same rules as the other
// analytics endpoints, never stored. Each alert carries its evidence and
// a deterministic `key` (type:entity:periodStart). Acting on an alert =
// creating an Intervention with that alertKey; the alert then shows the
// intervention's status and assignee instead of OPEN.
// ════════════════════════════════════════════════════════════

type Severity = 'HIGH' | 'MEDIUM' | 'LOW';
type EntityType = 'STUDENT' | 'TEACHER' | 'SUBJECT' | 'EXAM_PAPER' | 'HOMEWORK';

export interface Alert {
  key:      string;
  type:     string;
  severity: Severity;
  entity:   { type: EntityType; id: string; name: string | null; context?: Record<string, unknown> };
  evidence: Record<string, unknown>;
  recommendedAction: string;
  // Who should normally act (class teacher / subject teacher) — a
  // suggestion only; the real assignee lives on the intervention.
  suggestedOwners: { teacherId: string; userId: string; name: string }[];
}

const SEVERITY_ORDER: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export const ALERT_TYPES = [
  'LOW_ATTENDANCE', 'REPEATED_ABSENCE', 'DECLINING_MARKS', 'LEARNING_GAP', 'MISSING_HOMEWORK',
  'INCOMPLETE_MARKS_ENTRY', 'DELAYED_GRADING', 'HOMEWORK_NOT_CHECKED',
] as const;

// Students → name, class/section and that section's class teacher.
const studentInfo = async (ids: string[]) => {
  const rows = await prisma.student.findMany({
    where:  { id: { in: ids } },
    select: {
      id: true, name: true, admissionNo: true,
      class: { select: { id: true, name: true } },
      section: { select: { id: true, name: true, classTeacher: { select: { id: true, userId: true, user: { select: { name: true } } } } } },
    },
  });
  return new Map(rows.map(s => [s.id, {
    name: s.name,
    context: { admissionNo: s.admissionNo, classId: s.class.id, className: s.class.name, sectionId: s.section.id, sectionName: s.section.name },
    owners: s.section.classTeacher ? [{ teacherId: s.section.classTeacher.id, userId: s.section.classTeacher.userId, name: s.section.classTeacher.user.name }] : [],
  }]));
};

// Held exam papers whose marks aren't complete, with the teachers who
// grade them (same assignment rule as teacher grading).
const incompletePapers = async (ctx: AnalyticsContext) => {
  return prisma.$queryRaw<{
    id: string; examId: string; examTitle: string; classId: string; className: string; subjectId: string; subjectName: string;
    date: Date; expected: bigint; entered: bigint; teachers: { teacherId: string; userId: string; name: string }[] | null;
  }[]>`
    WITH ${assignmentsCte(ctx.schoolId)},
    expected AS (
      SELECT es.id AS "scheduleId", COUNT(st.id) AS expected,
             COUNT(em.id) FILTER (WHERE em.status = 'ABSENT' OR (em.status = 'GRADED' AND em."marksObtained" IS NOT NULL)) AS entered
      FROM exam_schedules es
      JOIN students st ON st."classId" = es."classId" AND st.status = ${RECORD_STATUS.ACTIVE}
        ${sqlIf(ctx.sectionId, Prisma.sql`AND st."sectionId" = ${ctx.sectionId}`)}
      LEFT JOIN exam_marks em ON em."examScheduleId" = es.id AND em."studentId" = st.id
      WHERE es."schoolId" = ${ctx.schoolId}
        AND es.date BETWEEN ${ctx.range.from} AND ${ctx.range.to} AND es.date < ${ctx.today}
        ${sqlIf(ctx.examId,    Prisma.sql`AND es."examId"    = ${ctx.examId}`)}
        ${sqlIf(ctx.classId,   Prisma.sql`AND es."classId"   = ${ctx.classId}`)}
        ${sqlIf(ctx.subjectId, Prisma.sql`AND es."subjectId" = ${ctx.subjectId}`)}
      GROUP BY es.id
    )
    SELECT es.id, es."examId", ex.title AS "examTitle", es."classId", c.name AS "className",
           es."subjectId", sub.name AS "subjectName", es.date, e.expected, e.entered,
           (SELECT json_agg(DISTINCT jsonb_build_object('teacherId', t.id, 'userId', t."userId", 'name', u.name))
              FROM assign a JOIN sections sec ON sec.id = a."sectionId" AND sec."classId" = es."classId"
              JOIN teachers t ON t.id = a."teacherId" JOIN users u ON u.id = t."userId"
              WHERE a."subjectId" = es."subjectId") AS teachers
    FROM expected e
    JOIN exam_schedules es ON es.id = e."scheduleId"
    JOIN exams ex ON ex.id = es."examId"
    JOIN classes c ON c.id = es."classId"
    JOIN subjects sub ON sub.id = es."subjectId"
    WHERE e.entered < e.expected
    ${ctx.teacherId ? Prisma.sql`AND EXISTS (SELECT 1 FROM assign a JOIN sections sec ON sec.id = a."sectionId"
                                             WHERE a."teacherId" = ${ctx.teacherId} AND sec."classId" = es."classId" AND a."subjectId" = es."subjectId")`
                    : Prisma.empty}
    ORDER BY es.date`;
};

// ── Build every alert for the period ──────────────────────────
export const buildAlerts = async (ctx: AnalyticsContext, q: AlertsQuery): Promise<Alert[]> => {
  const ctxNoExam = { ...ctx, examId: undefined };
  const [lowAtt, absences, changes, subjects, homework, papers, teachers] = await Promise.all([
    lowAttendanceRows(ctx, q.attendanceThreshold, 5),
    repeatedAbsenceRows(ctx, q.minConsecutive),
    studentExamChanges(ctxNoExam),
    getSubjectPerformance(ctx),
    homeworkRows(ctx),
    incompletePapers(ctx),
    prisma.teacher.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, userId: true, user: { select: { name: true } } } }),
  ]);

  // Students with NOT_SUBMITTED ≥ missingHomework in the period.
  const hwIds = homework.map(h => h.id);
  const missingHw = hwIds.length ? await prisma.homeworkSubmission.groupBy({
    by: ['studentId'],
    where: { homeworkId: { in: hwIds }, status: 'NOT_SUBMITTED', student: { status: RECORD_STATUS.ACTIVE } },
    _count: { _all: true },
    having: { studentId: { _count: { gte: q.missingHomework } } },
  }) : [];

  const declining = changes.filter(c => Number(c.latest) - Number(c.previous) <= -q.declineThreshold);
  const studentIds = [...new Set([
    ...lowAtt.map(r => r.studentId), ...absences.filter(a => a.ongoing).map(a => a.studentId),
    ...declining.map(d => d.studentId), ...missingHw.map(m => m.studentId),
  ])];
  const students = await studentInfo(studentIds);
  const periodKey = toDay(ctx.range.from);
  const studentEntity = (id: string) => {
    const s = students.get(id);
    return { entity: { type: 'STUDENT' as const, id, name: s?.name ?? null, context: s?.context }, suggestedOwners: s?.owners ?? [] };
  };
  const teacherByUser = new Map(teachers.map(t => [t.userId, { teacherId: t.id, userId: t.userId, name: t.user.name }]));

  const alerts: Alert[] = [];

  for (const r of lowAtt) {
    alerts.push({
      key: `LOW_ATTENDANCE:${r.studentId}:${periodKey}`, type: 'LOW_ATTENDANCE',
      severity: r.attendancePercentage! < q.attendanceThreshold - 15 ? 'HIGH' : 'MEDIUM',
      ...studentEntity(r.studentId),
      evidence: { attendancePercentage: r.attendancePercentage, threshold: q.attendanceThreshold, absent: r.absent, markedDays: r.markedDays },
      recommendedAction: 'Contact the parent, find the cause of absences and agree an attendance plan.',
    });
  }

  for (const a of absences.filter(x => x.ongoing)) {
    alerts.push({
      key: `REPEATED_ABSENCE:${a.studentId}:${a.lastAbsentOn ?? periodKey}`, type: 'REPEATED_ABSENCE',
      severity: a.currentStreak >= q.minConsecutive * 2 ? 'HIGH' : 'MEDIUM',
      ...studentEntity(a.studentId),
      evidence: { consecutiveAbsences: a.currentStreak, lastAbsentOn: a.lastAbsentOn, absencesInPeriod: a.absences },
      recommendedAction: 'Call the parent today to check on the student.',
    });
  }

  for (const d of declining) {
    const latest = round2(Number(d.latest)), previous = round2(Number(d.previous));
    alerts.push({
      key: `DECLINING_MARKS:${d.studentId}:${d.latestExamId}`, type: 'DECLINING_MARKS',
      severity: latest < ctx.passPercentage ? 'HIGH' : 'MEDIUM',
      ...studentEntity(d.studentId),
      evidence: { latestAveragePercentage: latest, previousAveragePercentage: previous, dropPoints: round2(previous - latest), latestExamId: d.latestExamId, previousExamId: d.previousExamId },
      recommendedAction: 'Review the student\'s papers with subject teachers and plan remedial support.',
    });
  }

  for (const s of subjects.subjects.filter(x => x.learningGap)) {
    alerts.push({
      key: `LEARNING_GAP:${s.subjectId}:${periodKey}`, type: 'LEARNING_GAP',
      severity: (s.passPercentage ?? 100) < 50 ? 'HIGH' : 'MEDIUM',
      entity: { type: 'SUBJECT', id: s.subjectId, name: s.subjectName ?? null },
      evidence: { averagePercentage: s.averagePercentage, passPercentage: s.passPercentage, gapVsOverallAverage: s.gapVsOverallAverage, reasons: s.learningGapReasons },
      recommendedAction: 'Review teaching of this subject and schedule revision / remedial classes.',
      suggestedOwners: [],
    });
  }

  for (const m of missingHw) {
    alerts.push({
      key: `MISSING_HOMEWORK:${m.studentId}:${periodKey}`, type: 'MISSING_HOMEWORK',
      severity: m._count._all >= q.missingHomework * 2 ? 'MEDIUM' : 'LOW',
      ...studentEntity(m.studentId),
      evidence: { notSubmittedCount: m._count._all, threshold: q.missingHomework },
      recommendedAction: 'Inform the parent and check whether the student needs help with homework.',
    });
  }

  const graceCutoff = addDays(ctx.today, -DEFAULT_DELAYED_GRADING_DAYS);
  for (const p of papers) {
    const delayed = p.date < graceCutoff;
    const expected = num(p.expected), entered = num(p.entered);
    alerts.push({
      key: `${delayed ? 'DELAYED_GRADING' : 'INCOMPLETE_MARKS_ENTRY'}:${p.id}`, type: delayed ? 'DELAYED_GRADING' : 'INCOMPLETE_MARKS_ENTRY',
      severity: delayed ? 'HIGH' : 'LOW',
      entity: { type: 'EXAM_PAPER', id: p.id, name: `${p.examTitle} — ${p.className} ${p.subjectName}`, context: { examId: p.examId, classId: p.classId, subjectId: p.subjectId, paperDate: toDay(p.date) } },
      evidence: { expectedEntries: expected, enteredEntries: entered, missingEntries: expected - entered, completionPercentage: pct(entered, expected), daysSincePaper: Math.round((ctx.today.getTime() - p.date.getTime()) / 86_400_000), graceDays: DEFAULT_DELAYED_GRADING_DAYS },
      recommendedAction: 'Ask the subject teacher to complete marks entry.',
      suggestedOwners: p.teachers ?? [],
    });
  }

  for (const h of homework) {
    const open = h.eligible - (h.submitted + h.notSubmitted);
    if (open <= 0 || h.dueDate >= graceCutoff) continue;
    const owner = teacherByUser.get(h.createdBy);
    alerts.push({
      key: `HOMEWORK_NOT_CHECKED:${h.id}`, type: 'HOMEWORK_NOT_CHECKED', severity: 'LOW',
      entity: { type: 'HOMEWORK', id: h.id, name: null, context: { classId: h.classId, sectionId: h.sectionId, subjectId: h.subjectId, dueDate: toDay(h.dueDate) } },
      evidence: { eligibleStudents: h.eligible, notCheckedYet: open, daysOverdue: Math.round((ctx.today.getTime() - h.dueDate.getTime()) / 86_400_000) },
      recommendedAction: 'Remind the teacher to mark submissions for this homework.',
      suggestedOwners: owner ? [owner] : [],
    });
  }

  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.type.localeCompare(b.type));
};

// Attach intervention status/assignee to alerts (one query).
const withInterventions = async (schoolId: string, alerts: Alert[]) => {
  const keys = alerts.map(a => a.key);
  const interventions = keys.length ? await prisma.intervention.findMany({
    where:   { schoolId, alertKey: { in: keys } },
    select:  { id: true, alertKey: true, status: true, dueDate: true, assignedToUser: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  }) : [];
  const latest = new Map<string, (typeof interventions)[number]>();
  for (const i of interventions) if (!latest.has(i.alertKey!)) latest.set(i.alertKey!, i);
  return alerts.map(a => {
    const i = latest.get(a.key);
    return {
      ...a,
      status:     i ? i.status : 'OPEN',
      assignedTo: i?.assignedToUser ?? null,
      intervention: i ? { id: i.id, status: i.status, dueDate: i.dueDate ? toDay(i.dueDate) : null } : null,
    };
  });
};

const NOT_AVAILABLE = {
  WEEKLY_TEST_NOT_CONDUCTED: TEACHER_NOT_TRACKED.weeklyTests,
  INCOMPLETE_SYLLABUS:       TEACHER_NOT_TRACKED.syllabusCompletion,
};

// ── GET /admin/analytics/alerts ───────────────────────────────
export const getAlerts = async (ctx: AnalyticsContext, q: AlertsQuery) => {
  let alerts = await buildAlerts(ctx, q);
  if (q.type)     alerts = alerts.filter(a => a.type === q.type);
  if (q.severity) alerts = alerts.filter(a => a.severity === q.severity);
  const total = alerts.length;
  const items = await withInterventions(ctx.schoolId, alerts.slice(0, q.limit));
  return {
    meta: metaOf(ctx, { thresholds: {
      attendanceThreshold: q.attendanceThreshold, minConsecutive: q.minConsecutive,
      declineThreshold: q.declineThreshold, missingHomework: q.missingHomework, delayedGradingDays: DEFAULT_DELAYED_GRADING_DAYS,
    } }),
    total,
    returned: items.length,
    alerts: items,
    notAvailable: NOT_AVAILABLE,
  };
};

// ── GET /admin/analytics/risk-summary ─────────────────────────
export const getRiskSummary = async (ctx: AnalyticsContext, q: AlertsQuery) => {
  const [alerts, interventions, overdue] = await Promise.all([
    buildAlerts(ctx, q),
    prisma.intervention.groupBy({ by: ['status'], where: { schoolId: ctx.schoolId }, _count: { _all: true } }),
    prisma.intervention.count({ where: { schoolId: ctx.schoolId, status: { in: ['OPEN', 'IN_PROGRESS'] }, dueDate: { lt: ctx.today } } }),
  ]);

  const studentTypes = new Map<string, Set<string>>();
  for (const a of alerts) if (a.entity.type === 'STUDENT') {
    studentTypes.set(a.entity.id, (studentTypes.get(a.entity.id) ?? new Set()).add(a.type));
  }
  const multiRisk = [...studentTypes.entries()].filter(([, t]) => t.size >= 2);
  const students  = await studentInfo(multiRisk.slice(0, 20).map(([id]) => id));

  return {
    meta: metaOf(ctx),
    alerts: {
      total: alerts.length,
      bySeverity: { HIGH: 0, MEDIUM: 0, LOW: 0, ...Object.fromEntries((['HIGH', 'MEDIUM', 'LOW'] as const).map(s => [s, alerts.filter(a => a.severity === s).length])) },
      byType: Object.fromEntries(ALERT_TYPES.map(t => [t, alerts.filter(a => a.type === t).length])),
    },
    students: {
      atRisk: studentTypes.size,
      withMultipleRisks: multiRisk.length,
      // Students flagged by 2+ different alert types — the first to look at.
      topMultipleRisk: multiRisk.slice(0, 20).map(([id, types]) => ({ studentId: id, name: students.get(id)?.name ?? null, ...students.get(id)?.context, riskTypes: [...types] })),
    },
    interventions: {
      byStatus: Object.fromEntries((['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const).map(s => [s, interventions.find(i => i.status === s)?._count._all ?? 0])),
      overdue,
    },
    notAvailable: NOT_AVAILABLE,
  };
};
