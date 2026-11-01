import { Router } from 'express';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';
import { analyticsHandler as h, teacherAnalyticsHandler } from './analytics.controller';
import {
  analyticsQuerySchema, attendanceTrendQuerySchema, lowAttendanceQuerySchema, repeatedAbsenceQuerySchema,
  supportQuerySchema, topPerformersQuerySchema, enrollmentTrendQuerySchema, termComparisonQuerySchema, alertsQuerySchema,
} from './analytics.validation';
import { getOverview } from './overview.service';
import {
  getStudentStrength, getEnrollmentTrend, getGenderDistribution, getGradeDistribution, getStudentGrowth,
} from './enrollment.service';
import {
  getStudentAttendance, getTeacherAttendance, getAttendanceTrend, getLowAttendanceStudents, getRepeatedAbsences, getSchoolCalendar,
} from './attendance.service';
import {
  getAcademicPerformance, getPassFail, getSubjectPerformance, getClassPerformance, getExamPerformance,
  getTopPerformers, getNeedsSupport, getAcademicGrowth,
} from './academics.service';
import {
  getTeacherPerformance, getTeacherPerformanceDetail, getTeacherGrowth, getTeacherWorkload,
  getTeacherWeeklyTests, getTeacherSyllabusProgress,
} from './teachers.service';
import {
  getHomework, getHomeworkSubmissions, getAssignmentCompletion, getProjectPractical, getTeacherHomework,
} from './homework.service';
import { getStudentEngagement, getCoCurricular, getStudentParticipation } from './engagement.service';
import {
  getYearComparison, getTermComparison, getMonthlyTrends, getClassComparison, getSubjectComparison,
} from './comparison.service';
import { getAlerts, getRiskSummary } from './alerts.service';
import { TEACHER_NOT_TRACKED } from './teachers.service';
import { metaOf } from './analytics.context';

// Mounted at /api/admin/analytics. School ADMIN only, own school only.
const router = Router();
router.use(authGuard, roleGuard('ADMIN'));

const q = analyticsQuerySchema;

// ── Dashboard ─────────────────────────────────────────────────
router.get('/overview', h(q, ctx => getOverview(ctx)));

// ── Enrollment ────────────────────────────────────────────────
router.get('/student-strength',    h(q, ctx => getStudentStrength(ctx)));
router.get('/enrollment-trend',    h(enrollmentTrendQuerySchema, (ctx, x) => getEnrollmentTrend(ctx, x.sessions)));
router.get('/gender-distribution', h(q, ctx => getGenderDistribution(ctx)));
router.get('/grade-distribution',  h(q, ctx => getGradeDistribution(ctx)));
router.get('/student-growth',      h(q, ctx => getStudentGrowth(ctx)));

// ── Attendance & calendar ─────────────────────────────────────
router.get('/student-attendance',      h(q, ctx => getStudentAttendance(ctx)));
router.get('/teacher-attendance',      h(q, ctx => getTeacherAttendance(ctx)));
router.get('/attendance-trend',        h(attendanceTrendQuerySchema, (ctx, x) => getAttendanceTrend(ctx, x.granularity)));
router.get('/low-attendance-students', h(lowAttendanceQuerySchema, (ctx, x) => getLowAttendanceStudents(ctx, x)));
router.get('/repeated-absences',       h(repeatedAbsenceQuerySchema, (ctx, x) => getRepeatedAbsences(ctx, x)));
router.get('/school-calendar',         h(q, ctx => getSchoolCalendar(ctx)));

// ── Academic performance ──────────────────────────────────────
router.get('/academic-performance', h(q, ctx => getAcademicPerformance(ctx)));
router.get('/pass-fail',            h(q, ctx => getPassFail(ctx)));
router.get('/subject-performance',  h(q, ctx => getSubjectPerformance(ctx)));
router.get('/class-performance',    h(q, ctx => getClassPerformance(ctx)));
router.get('/exam-performance',     h(q, ctx => getExamPerformance(ctx)));
router.get('/top-performers',       h(topPerformersQuerySchema, (ctx, x) => getTopPerformers(ctx, x)));
router.get('/needs-support',        h(supportQuerySchema, (ctx, x) => getNeedsSupport(ctx, x)));
router.get('/academic-growth',      h(q, ctx => getAcademicGrowth(ctx)));

// ── Teachers ──────────────────────────────────────────────────
router.get('/teacher-performance',            h(q, ctx => getTeacherPerformance(ctx)));
router.get('/teacher-performance/:teacherId', teacherAnalyticsHandler(q, ctx => getTeacherPerformanceDetail(ctx)));
router.get('/teacher-growth',                 h(q, ctx => getTeacherGrowth(ctx)));
router.get('/teacher-workload',               h(q, ctx => getTeacherWorkload(ctx)));
router.get('/teacher-homework',               h(q, ctx => getTeacherHomework(ctx)));
router.get('/teacher-weekly-tests',           h(q, ctx => getTeacherWeeklyTests(ctx)));
router.get('/teacher-syllabus-progress',      h(q, ctx => getTeacherSyllabusProgress(ctx)));

// ── Homework, assignments, tests ──────────────────────────────
router.get('/homework',                h(q, ctx => getHomework(ctx)));
router.get('/homework-submissions',    h(q, ctx => getHomeworkSubmissions(ctx)));
router.get('/assignment-completion',   h(q, ctx => getAssignmentCompletion(ctx)));
router.get('/project-practical',       h(q, ctx => getProjectPractical(ctx)));
// Weekly tests aren't distinguishable from other exams yet (no Exam type).
router.get('/weekly-tests',            h(q, async ctx => ({ meta: metaOf(ctx), ...TEACHER_NOT_TRACKED.weeklyTests })));
router.get('/weekly-test-performance', h(q, async ctx => ({ meta: metaOf(ctx), ...TEACHER_NOT_TRACKED.weeklyTests })));

// ── Engagement ────────────────────────────────────────────────
router.get('/student-engagement',    h(q, ctx => getStudentEngagement(ctx)));
router.get('/co-curricular',         h(q, ctx => getCoCurricular(ctx)));
router.get('/student-participation', h(q, ctx => getStudentParticipation(ctx)));

// ── Comparisons ───────────────────────────────────────────────
router.get('/year-comparison',    h(q, ctx => getYearComparison(ctx)));
router.get('/term-comparison',    h(termComparisonQuerySchema, (ctx, x) => getTermComparison(ctx, x.terms)));
router.get('/monthly-trends',     h(q, ctx => getMonthlyTrends(ctx)));
router.get('/class-comparison',   h(q, ctx => getClassComparison(ctx)));
router.get('/subject-comparison', h(q, ctx => getSubjectComparison(ctx)));

// ── Alerts ────────────────────────────────────────────────────
router.get('/alerts',       h(alertsQuerySchema, (ctx, x) => getAlerts(ctx, x)));
router.get('/risk-summary', h(alertsQuerySchema, (ctx, x) => getRiskSummary(ctx, x)));

export default router;
