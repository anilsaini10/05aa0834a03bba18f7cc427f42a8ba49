import { prisma } from '../../../config/db';
import { AnalyticsContext, metaOf } from './analytics.context';
import { getStudentAttendance } from './attendance.service';
import { homeworkRows, homeworkSummary } from './homework.service';
import { monthsIn, toDay, unavailable } from './analytics.utils';

// ════════════════════════════════════════════════════════════
// Engagement & co-curricular. The schema records no participation,
// observation rubric, club/sport/competition or award data, so these
// endpoints report only what IS recorded (attendance, homework, activity
// events held) and mark the rest unavailable — no synthetic scores.
// ════════════════════════════════════════════════════════════

export const PARTICIPATION_NOT_TRACKED = {
  classroomParticipation: unavailable('No classroom participation / observation rubric is recorded', ['ParticipationObservation (student, date, rubric scores)']),
  labParticipation:       unavailable('Practical / lab sessions are not recorded', ['Lab session attendance or practical marks']),
  activityParticipation:  unavailable('Events have no participant list', ['EventParticipant (event, student, role, result)']),
  achievements:           unavailable('Achievements and awards are not recorded', ['StudentAchievement (student, title, level, date)']),
};

// ── GET /admin/analytics/student-engagement ───────────────────
// Recorded engagement indicators per class: attendance and homework.
export const getStudentEngagement = async (ctx: AnalyticsContext) => {
  const [attendance, homework] = await Promise.all([getStudentAttendance(ctx), homeworkRows(ctx)]);
  const hwByClass = new Map<string, typeof homework>();
  for (const r of homework) hwByClass.set(r.classId, [...(hwByClass.get(r.classId) ?? []), r]);

  return {
    meta: metaOf(ctx),
    summary: {
      attendancePercentage:   attendance.summary.attendancePercentage,
      homeworkSubmissionRate: homeworkSummary(homework, ctx.today).submissionRate,
      homeworkCompletionRate: homeworkSummary(homework, ctx.today).completionRate,
    },
    byClass: attendance.byClass.map(c => {
      const hw = homeworkSummary(hwByClass.get(c.classId) ?? [], ctx.today);
      return {
        classId: c.classId, className: c.className,
        attendancePercentage:   c.attendancePercentage,
        homeworkSubmissionRate: hw.submissionRate,
        homeworkCompletionRate: hw.completionRate,
      };
    }),
    ...PARTICIPATION_NOT_TRACKED,
  };
};

// ── GET /admin/analytics/co-curricular ────────────────────────
// What's recorded: ACTIVITY events on the calendar.
export const getCoCurricular = async (ctx: AnalyticsContext) => {
  const events = await prisma.event.findMany({
    where: { schoolId: ctx.schoolId, eventType: 'ACTIVITY', startDate: { lte: ctx.range.to }, endDate: { gte: ctx.range.from } },
    select: { id: true, title: true, startDate: true, endDate: true, audience: true },
    orderBy: { startDate: 'asc' },
  });
  return {
    meta: metaOf(ctx),
    activitiesHeld: events.length,
    byMonth: monthsIn(ctx.range).map(m => ({
      month: m.month,
      activities: events.filter(e => toDay(e.startDate).slice(0, 7) === m.month).length,
    })),
    activities: events.map(e => ({ id: e.id, title: e.title, startDate: toDay(e.startDate), endDate: toDay(e.endDate), audience: e.audience })),
    categories: unavailable('Activity events have no category (sports, club, arts, cultural, competition)', ['Event.activityCategory']),
    participation: PARTICIPATION_NOT_TRACKED.activityParticipation,
    achievements:  PARTICIPATION_NOT_TRACKED.achievements,
  };
};

// ── GET /admin/analytics/student-participation ────────────────
export const getStudentParticipation = async (ctx: AnalyticsContext) => ({
  meta: metaOf(ctx),
  ...PARTICIPATION_NOT_TRACKED,
});
