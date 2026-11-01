import { prisma } from '../../../config/db';
import { RECORD_STATUS } from '../../../constants';
import { AnalyticsContext, getSchoolDays, metaOf } from './analytics.context';
import { enrollmentSnapshot } from './enrollment.service';
import { studentAttendanceTotals, teacherAttendanceTotals } from './attendance.service';
import { groupedStats, missingMarkEntries, needsSupportRows, overallPaperStats, studentExamOutcomes } from './academics.service';
import { homeworkRows, homeworkSummary } from './homework.service';
import { buildAlerts } from './alerts.service';
import { TEACHER_NOT_TRACKED } from './teachers.service';
import { alertsQuerySchema } from './analytics.validation';
import { pct } from './analytics.utils';

// ── GET /admin/analytics/overview ─────────────────────────────
// The dashboard in one call. Each block is the same calculation as its
// detailed endpoint (linked in `details`), so numbers always agree.
export const getOverview = async (ctx: AnalyticsContext) => {
  const days = await getSchoolDays(ctx.schoolId, ctx.range, ctx.today);
  const alertDefaults = alertsQuerySchema.parse({});

  const [
    gender, activeTeachers, classes, sections, enrollment, students, teachers, papers, studentExams, missing,
    classStats, support, homework, alerts, pendingStudentLeave, pendingTeacherLeave, pendingRecovery, marked,
  ] = await Promise.all([
    prisma.student.groupBy({
      by: ['gender'],
      where: {
        schoolId: ctx.schoolId, status: RECORD_STATUS.ACTIVE,
        ...(ctx.classId ? { classId: ctx.classId } : {}), ...(ctx.sectionId ? { sectionId: ctx.sectionId } : {}),
      },
      _count: { _all: true },
    }),
    prisma.teacher.count({ where: { schoolId: ctx.schoolId, status: RECORD_STATUS.ACTIVE } }),
    prisma.class.count({ where: { schoolId: ctx.schoolId } }),
    prisma.section.count({ where: { class: { schoolId: ctx.schoolId } } }),
    enrollmentSnapshot(ctx),
    studentAttendanceTotals(ctx, ctx.range, days),
    teacherAttendanceTotals(ctx, ctx.range, days),
    overallPaperStats(ctx),
    studentExamOutcomes(ctx),
    missingMarkEntries(ctx),
    groupedStats(ctx, 'classId'),
    needsSupportRows(ctx, alertDefaults.supportThreshold, alertDefaults.attendanceThreshold),
    homeworkRows(ctx),
    buildAlerts(ctx, alertDefaults),
    prisma.leaveRequest.count({ where: { schoolId: ctx.schoolId, status: 'PENDING' } }),
    prisma.teacherLeaveRequest.count({ where: { schoolId: ctx.schoolId, status: 'PENDING' } }),
    prisma.accountRecoveryRequest.count({ where: { schoolId: ctx.schoolId, status: 'PENDING' } }),
    prisma.attendanceRecord.groupBy({
      by: ['date'],
      where: { schoolId: ctx.schoolId, date: { gte: ctx.range.from, lte: ctx.range.to, notIn: days.nonWorkingDates } },
    }),
  ]);

  const g = (k: 'MALE' | 'FEMALE' | 'OTHER') => gender.find(x => x.gender === k)?._count._all ?? 0;
  const totalStudents = g('MALE') + g('FEMALE') + g('OTHER');
  const hw = homeworkSummary(homework, ctx.today);
  const todayStr = ctx.today.toISOString().slice(0, 10);

  return {
    meta: metaOf(ctx),
    students: {
      totalActive: totalStudents,
      male: g('MALE'), female: g('FEMALE'), other: g('OTHER'),
      malePercentage: pct(g('MALE'), totalStudents), femalePercentage: pct(g('FEMALE'), totalStudents),
    },
    teachers: { totalActive: activeTeachers },
    structure: { classes, sections },
    enrollment: {
      basis: enrollment.basis,
      currentEnrollment:   enrollment.currentEnrollment,
      previousEnrollment:  enrollment.previousEnrollment,
      newAdmissions:       enrollment.newAdmissions,
      exitedSincePreviousPeriod: enrollment.exitedSincePreviousPeriod,
      netEnrollmentChange: enrollment.netEnrollmentChange,
      growthPercentage:    enrollment.growthPercentage,
      retentionRate:       enrollment.retentionRate,
      transfers:           enrollment.transfers,
      withdrawals:         enrollment.withdrawals,
    },
    calendar: {
      scheduledWorkingDays:       days.scheduledWorkingDays,
      scheduledWorkingDaysToDate: days.scheduledWorkingDaysToDate,
      actualWorkingDays:          marked.length,
      sundays:                    days.sundays,
      holidays:                   days.holidayDays + days.governmentHolidayDays,
      vacationDays:               days.vacationDays,
      schoolClosedDays:           days.schoolClosedDays,
    },
    studentAttendance: students,
    teacherAttendance: teachers,
    academics: {
      assessedStudents:  papers.assessedStudents,
      averagePercentage: papers.averagePercentage,
      // Unit: one student's result on one exam.
      ...studentExams,
      pendingAssessments: studentExams.pendingCount,
      missingMarkEntries: missing.missingMarkEntries,
    },
    homework: {
      assigned:               hw.homeworkAssigned,
      completionRate:         hw.completionRate,
      submissionRate:         hw.submissionRate,
      checkingCompletionRate: hw.checkingCompletionRate,
    },
    weeklyTests: TEACHER_NOT_TRACKED.weeklyTests,
    bestPerformingClasses: classStats
      .filter(c => c.averagePercentage !== null)
      .sort((a, b) => b.averagePercentage! - a.averagePercentage!)
      .slice(0, 3)
      .map(c => ({ classId: c.classId, className: c.className, averagePercentage: c.averagePercentage, passPercentage: c.passPercentage })),
    studentsNeedingSupport: {
      count: support.length,
      thresholds: { averageBelow: alertDefaults.supportThreshold, attendanceBelow: alertDefaults.attendanceThreshold },
    },
    teacherIndicators: {
      attendancePercentage: teachers.attendancePercentage,
      homeworkCheckingRate: hw.checkingCompletionRate,
      papersWithMissingMarks: missing.papersWithMissingEntries,
      syllabusCompletion:   TEACHER_NOT_TRACKED.syllabusCompletion,
    },
    pendingTasks: {
      studentLeaveRequests:     pendingStudentLeave,
      teacherLeaveRequests:     pendingTeacherLeave,
      accountRecoveryRequests:  pendingRecovery,
      papersWithMissingMarks:   missing.papersWithMissingEntries,
      overdueUncheckedHomework: hw.overdueUncheckedHomework,
      attendanceNotMarkedToday: days.workingDates.includes(todayStr) && !marked.some(m => m.date.toISOString().slice(0, 10) === todayStr),
    },
    recentAlerts: {
      total: alerts.length,
      high:  alerts.filter(a => a.severity === 'HIGH').length,
      top:   alerts.slice(0, 5).map(a => ({ key: a.key, type: a.type, severity: a.severity, entity: a.entity, evidence: a.evidence })),
    },
    details: {
      enrollment: '/api/admin/analytics/student-growth',
      attendance: '/api/admin/analytics/student-attendance',
      academics:  '/api/admin/analytics/academic-performance',
      homework:   '/api/admin/analytics/homework',
      teachers:   '/api/admin/analytics/teacher-performance',
      alerts:     '/api/admin/analytics/alerts',
    },
  };
};
