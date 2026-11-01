import { DayOfWeek, Prisma } from '@prisma/client';
import { prisma } from '../../../config/db';
import { RECORD_STATUS } from '../../../constants';
import { AnalyticsContext, getSchoolDays, metaOf, withRange } from './analytics.context';
import { assignmentsCte, groupedStats, paperStats, PaperStats } from './academics.service';
import { getTeacherAttendance } from './attendance.service';
import { homeworkRows, homeworkSummary } from './homework.service';
import { DateRange, atDay, compare, num, pct, precedingWindow, toDay, unavailable } from './analytics.utils';

// ════════════════════════════════════════════════════════════
// Teacher analytics. Deliberately NO composite "teacher score": the
// indicators are reported side by side with their context (class size,
// the same classes' previous-period results as a baseline), because pass
// counts alone say more about the class than the teacher.
//
// A teacher's classes = the (section, subject) pairs they teach — the same
// rule teachers grade by (timetable first, TeacherSubject fallback).
// ════════════════════════════════════════════════════════════

const NOT_TRACKED = {
  completedPeriods:     unavailable('Only the timetable is stored — not whether each period was actually taught', ['Period / lesson log (date, period, teacher, taught?)']),
  syllabusCompletion:   unavailable('No syllabus or chapter plan is stored', ['Syllabus units per class+subject', 'Unit completion records']),
  lessonPlans:          unavailable('No lesson plans are stored', ['LessonPlan (teacher, class, subject, date, status)']),
  classroomObservations: unavailable('No classroom observation records exist', ['Observation (observer, teacher, date, rubric scores)']),
  remedialSessions:     unavailable('No remedial / extra-class records exist', ['RemedialSession (teacher, students, date, outcome)']),
  weeklyTests:          unavailable('Exams have no type, so weekly tests can\'t be told apart from term exams', ['Exam.examType (WEEKLY_TEST / UNIT_TEST / TERM …)', 'Exam.status (PLANNED / CONDUCTED / CANCELLED / RESCHEDULED)']),
};

const WEEKDAYS: DayOfWeek[] = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

// Timetable load + scheduled periods inside the range (working days up to
// today only), per teacher.
const workloadByTeacher = async (ctx: AnalyticsContext, range: DateRange) => {
  const [periods, days, assignments, classTeacherOf, invigilations] = await Promise.all([
    prisma.classSchedule.groupBy({
      by: ['teacherId', 'day'],
      where: { schoolId: ctx.schoolId, type: 'CLASS_PERIOD', teacherId: ctx.teacherId ?? { not: null } },
      _count: { _all: true },
    }),
    getSchoolDays(ctx.schoolId, range, ctx.today),
    prisma.$queryRaw<{ teacherId: string; sections: bigint; subjects: bigint; classes: bigint; students: bigint }[]>`
      WITH ${assignmentsCte(ctx.schoolId)}
      SELECT a."teacherId",
             COUNT(DISTINCT a."sectionId") AS sections,
             COUNT(DISTINCT a."subjectId") AS subjects,
             COUNT(DISTINCT sec."classId") AS classes,
             -- each student once, even if taught several subjects
             (SELECT COUNT(*) FROM students s
              WHERE s.status = ${RECORD_STATUS.ACTIVE}
                AND s."sectionId" IN (SELECT b."sectionId" FROM assign b WHERE b."teacherId" = a."teacherId")) AS students
      FROM assign a
      JOIN sections sec ON sec.id = a."sectionId"
      ${ctx.teacherId ? Prisma.sql`WHERE a."teacherId" = ${ctx.teacherId}` : Prisma.empty}
      GROUP BY a."teacherId"`,
    prisma.section.groupBy({
      by: ['classTeacherId'],
      where: { class: { schoolId: ctx.schoolId }, classTeacherId: ctx.teacherId ?? { not: null } },
      _count: { _all: true },
    }),
    prisma.examSchedule.groupBy({
      by: ['invigilatorId'],
      where: { schoolId: ctx.schoolId, date: { gte: range.from, lte: range.to }, invigilatorId: ctx.teacherId ?? { not: null } },
      _count: { _all: true },
    }),
  ]);

  const todayStr = toDay(ctx.today);
  const weekdayCount = new Map<DayOfWeek, number>();
  for (const d of days.workingDates) {
    if (d > todayStr) continue;
    const wd = WEEKDAYS[atDay(d).getUTCDay()];
    weekdayCount.set(wd, (weekdayCount.get(wd) ?? 0) + 1);
  }

  const out = new Map<string, { periodsPerWeek: number; scheduledPeriodsToDate: number; sections: number; subjects: number; classes: number; studentsTaught: number; classTeacherOfSections: number; invigilationDuties: number }>();
  const get = (id: string) => {
    if (!out.has(id)) out.set(id, { periodsPerWeek: 0, scheduledPeriodsToDate: 0, sections: 0, subjects: 0, classes: 0, studentsTaught: 0, classTeacherOfSections: 0, invigilationDuties: 0 });
    return out.get(id)!;
  };
  for (const p of periods) {
    const t = get(p.teacherId!);
    t.periodsPerWeek += p._count._all;
    t.scheduledPeriodsToDate += p._count._all * (weekdayCount.get(p.day) ?? 0);
  }
  for (const a of assignments) Object.assign(get(a.teacherId), { sections: num(a.sections), subjects: num(a.subjects), classes: num(a.classes), studentsTaught: num(a.students) });
  for (const c of classTeacherOf) get(c.classTeacherId!).classTeacherOfSections = c._count._all;
  for (const i of invigilations) get(i.invigilatorId!).invigilationDuties = i._count._all;
  return out;
};

// Marks a teacher is responsible for that aren't entered yet (paper held,
// active student, no ExamMark row), per teacher.
const missingEntriesByTeacher = async (ctx: AnalyticsContext, range: DateRange) => {
  const rows = await prisma.$queryRaw<{ teacherId: string; missing: bigint }[]>`
    WITH ${assignmentsCte(ctx.schoolId)}
    SELECT a."teacherId", COUNT(*) AS missing
    FROM exam_schedules es
    JOIN students st ON st."classId" = es."classId" AND st.status = ${RECORD_STATUS.ACTIVE}
    JOIN assign a    ON a."sectionId" = st."sectionId" AND a."subjectId" = es."subjectId"
    LEFT JOIN exam_marks em ON em."examScheduleId" = es.id AND em."studentId" = st.id
    WHERE es."schoolId" = ${ctx.schoolId} AND em.id IS NULL
      AND es.date BETWEEN ${range.from} AND ${range.to} AND es.date <= ${ctx.today}
      ${ctx.teacherId ? Prisma.sql`AND a."teacherId" = ${ctx.teacherId}` : Prisma.empty}
    GROUP BY a."teacherId"`;
  return new Map(rows.map(r => [r.teacherId, num(r.missing)]));
};

const academicView = (s: PaperStats | undefined, missing: number) => ({
  assessedStudents:  s?.assessedStudents ?? 0,
  gradedPapers:      s?.gradedPapers ?? 0,
  averagePercentage: s?.averagePercentage ?? null,
  passPercentage:    s?.passPercentage ?? null,
  passCount:         s?.passCount ?? 0,
  failCount:         s?.failCount ?? 0,
  absentCount:       s?.absentCount ?? 0,
  pendingCount:      s?.pendingCount ?? 0,
  missingMarkEntries: missing,
  // Share of this teacher's expected marks that are entered (graded or
  // marked absent).
  assessmentCompletionRate: pct(
    (s?.gradedPapers ?? 0) + (s?.absentCount ?? 0),
    (s?.papers ?? 0) + missing,
  ),
});

// Everything for a set of teachers, current period vs the preceding one.
const teacherIndicators = async (ctx: AnalyticsContext) => {
  const previous = precedingWindow(ctx.range);
  const prevCtx  = withRange(ctx, previous);

  const [teachers, attendance, workload, academics, prevAcademics, missing, homework, prevHomework, prevAttendance] = await Promise.all([
    prisma.teacher.findMany({
      where:   { schoolId: ctx.schoolId, ...(ctx.teacherId ? { id: ctx.teacherId } : {}) },
      select:  { id: true, userId: true, employeeId: true, status: true, performanceScore: true, experienceYears: true, user: { select: { name: true } } },
      orderBy: { user: { name: 'asc' } },
    }),
    getTeacherAttendance(ctx),
    workloadByTeacher(ctx, ctx.range),
    paperStats({ ...ctx, examId: undefined }, 'teacherId'),
    paperStats({ ...prevCtx, examId: undefined }, 'teacherId', previous),
    missingEntriesByTeacher(ctx, ctx.range),
    homeworkRows(ctx),
    homeworkRows(prevCtx, previous),
    getTeacherAttendance(prevCtx),
  ]);

  const att     = new Map(attendance.teachers.map(t => [t.teacherId, t]));
  const prevAtt = new Map(prevAttendance.teachers.map(t => [t.teacherId, t]));
  const acad    = new Map(academics.map(a => [a.key!, a]));
  const prevAcad = new Map(prevAcademics.map(a => [a.key!, a]));
  const hwBy = (rows: typeof homework, userId: string) => homeworkSummary(rows.filter(r => r.createdBy === userId), ctx.today);

  return {
    previous,
    rows: teachers.map(t => {
      const w   = workload.get(t.id);
      const a   = att.get(t.id);
      const cur = academicView(acad.get(t.id), missing.get(t.id) ?? 0);
      const prv = prevAcad.get(t.id);
      const hw  = hwBy(homework, t.userId);
      const prevHw = hwBy(prevHomework, t.userId);
      return {
        teacherId:  t.id,
        employeeId: t.employeeId,
        name:       t.user.name,
        status:     t.status,
        experienceYears: t.experienceYears,
        // Stored on the teacher record (entered by the school) — not computed here.
        recordedPerformanceScore: t.performanceScore,
        attendance: a ? {
          attendancePercentage: a.attendancePercentage, present: a.present, absent: a.absent, late: a.late,
          approvedLeave: a.approvedLeave, markedRecords: a.markedRecords, approvedLeaveDays: a.leave.approvedDays,
        } : null,
        workload: w ?? null,
        academics: cur,
        homework: {
          assigned: hw.homeworkAssigned, submissionRate: hw.submissionRate,
          checkingCompletionRate: hw.checkingCompletionRate, overdueUncheckedHomework: hw.overdueUncheckedHomework,
        },
        context: {
          averageClassSize: w && w.sections ? Math.round(w.studentsTaught / w.sections) : null,
          // Baseline: the same teacher's classes in the preceding period.
          baselineAveragePercentage: prv?.averagePercentage ?? null,
        },
        vsPreviousPeriod: {
          attendancePercentage:   compare(a?.attendancePercentage ?? null, prevAtt.get(t.id)?.attendancePercentage ?? null, true),
          averagePercentage:      compare(cur.averagePercentage, prv?.averagePercentage ?? null, true),
          passPercentage:         compare(cur.passPercentage, prv?.passPercentage ?? null, true),
          homeworkSubmissionRate: compare(hw.submissionRate, prevHw.submissionRate, true),
          homeworkCheckingRate:   compare(hw.checkingCompletionRate, prevHw.checkingCompletionRate, true),
        },
      };
    }),
  };
};

// ── GET /admin/analytics/teacher-performance ──────────────────
export const getTeacherPerformance = async (ctx: AnalyticsContext) => {
  const { previous, rows } = await teacherIndicators(ctx);
  return {
    meta: metaOf(ctx, {
      previousPeriod: { startDate: toDay(previous.from), endDate: toDay(previous.to) },
      note: 'No composite teacher score is calculated — compare indicators together with their context.',
    }),
    teachers: rows,
    ...NOT_TRACKED,
  };
};

// ── GET /admin/analytics/teacher-performance/:teacherId ───────
export const getTeacherPerformanceDetail = async (ctx: AnalyticsContext) => {
  const [{ previous, rows }, bySubject, byClass, bySection] = await Promise.all([
    teacherIndicators(ctx),
    groupedStats({ ...ctx, examId: undefined }, 'subjectId'),
    groupedStats({ ...ctx, examId: undefined }, 'classId'),
    groupedStats({ ...ctx, examId: undefined }, 'sectionId'),
  ]);
  return {
    meta: metaOf(ctx, { previousPeriod: { startDate: toDay(previous.from), endDate: toDay(previous.to) } }),
    teacher: rows[0] ?? null,
    academicsBySubject: bySubject,
    academicsByClass:   byClass,
    academicsBySection: bySection,
    ...NOT_TRACKED,
  };
};

// ── GET /admin/analytics/teacher-growth ───────────────────────
export const getTeacherGrowth = async (ctx: AnalyticsContext) => {
  const { previous, rows } = await teacherIndicators(ctx);
  return {
    meta: metaOf(ctx, { previousPeriod: { startDate: toDay(previous.from), endDate: toDay(previous.to) } }),
    teachers: rows.map(r => ({ teacherId: r.teacherId, employeeId: r.employeeId, name: r.name, ...r.vsPreviousPeriod })),
  };
};

// ── GET /admin/analytics/teacher-workload ─────────────────────
export const getTeacherWorkload = async (ctx: AnalyticsContext) => {
  const [teachers, workload] = await Promise.all([
    prisma.teacher.findMany({
      where:   { schoolId: ctx.schoolId, ...(ctx.teacherId ? { id: ctx.teacherId } : {}) },
      select:  { id: true, employeeId: true, status: true, user: { select: { name: true } } },
      orderBy: { user: { name: 'asc' } },
    }),
    workloadByTeacher(ctx, ctx.range),
  ]);
  const rows = teachers.map(t => ({ teacherId: t.id, employeeId: t.employeeId, name: t.user.name, status: t.status, ...(workload.get(t.id) ?? {
    periodsPerWeek: 0, scheduledPeriodsToDate: 0, sections: 0, subjects: 0, classes: 0, studentsTaught: 0, classTeacherOfSections: 0, invigilationDuties: 0,
  }) }));
  const active = rows.filter(r => r.status === RECORD_STATUS.ACTIVE);
  const total  = active.reduce((a, r) => a + r.periodsPerWeek, 0);
  return {
    meta: metaOf(ctx),
    summary: {
      activeTeachers: active.length,
      totalPeriodsPerWeek: total,
      averagePeriodsPerWeek: active.length ? Math.round((total / active.length) * 10) / 10 : null,
      teachersWithoutTimetable: active.filter(r => r.periodsPerWeek === 0).length,
    },
    teachers: rows.sort((a, b) => b.periodsPerWeek - a.periodsPerWeek),
    completedPeriods: NOT_TRACKED.completedPeriods,
  };
};

// ── GET /admin/analytics/teacher-weekly-tests ─────────────────
export const getTeacherWeeklyTests = async (ctx: AnalyticsContext) => ({ meta: metaOf(ctx), ...NOT_TRACKED.weeklyTests });

// ── GET /admin/analytics/teacher-syllabus-progress ────────────
export const getTeacherSyllabusProgress = async (ctx: AnalyticsContext) => ({
  meta: metaOf(ctx),
  syllabusCompletion: NOT_TRACKED.syllabusCompletion,
  lessonPlans:        NOT_TRACKED.lessonPlans,
});

export { NOT_TRACKED as TEACHER_NOT_TRACKED };
