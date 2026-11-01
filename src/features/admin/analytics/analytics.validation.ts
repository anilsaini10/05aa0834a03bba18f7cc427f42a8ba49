import { z } from 'zod';
import {
  DEFAULT_PASS_PERCENTAGE,
  DEFAULT_ATTENDANCE_THRESHOLD,
  DEFAULT_SUPPORT_THRESHOLD,
  DEFAULT_REPEATED_ABSENCE_STREAK,
} from '../../../constants';

const dateOnly = (label: string) => z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be in YYYY-MM-DD format`)
  .transform(v => new Date(`${v}T00:00:00.000Z`))
  .refine(d => !Number.isNaN(d.getTime()), `${label} is not a valid date`);

const id = (label: string) => z.string().uuid(`Invalid ${label} id`).optional();

// ── Shared filters (every analytics endpoint) ─────────────────
// Period: `year` = academic session start year (2026 → 2026-27), or an
// explicit startDate/endDate. Neither → the current session.
// Every id is checked against the admin's school before use
// (see analytics.context.ts) — a foreign id is a 404, never a leak.
const baseShape = {
  year:           z.coerce.number().int().min(2000).max(2100).optional(),
  startDate:      dateOnly('startDate').optional(),
  endDate:        dateOnly('endDate').optional(),
  classId:        id('class'),
  sectionId:      id('section'),
  subjectId:      id('subject'),
  teacherId:      id('teacher'),
  examId:         id('exam'),
  passPercentage: z.coerce.number().min(0).max(100).default(DEFAULT_PASS_PERCENTAGE),
};

const periodRules = <T extends z.ZodTypeAny>(schema: T) => schema
  .refine((q: any) => (q.startDate === undefined) === (q.endDate === undefined), {
    message: 'Send both startDate and endDate', path: ['startDate'],
  })
  .refine((q: any) => !(q.year !== undefined && q.startDate), {
    message: 'Use either year or startDate/endDate, not both', path: ['year'],
  })
  .refine((q: any) => !q.startDate || !q.endDate || q.endDate >= q.startDate, {
    message: 'endDate must be on or after startDate', path: ['endDate'],
  })
  .refine((q: any) => !q.startDate || !q.endDate || (q.endDate.getTime() - q.startDate.getTime()) / 86_400_000 <= 400, {
    message: 'Range can be at most 400 days', path: ['endDate'],
  });

export const analyticsQuerySchema = periodRules(z.object(baseShape));

// Ranked / listed students or teachers.
export const analyticsListQuerySchema = periodRules(z.object({
  ...baseShape,
  page:      z.coerce.number().int().positive().default(1),
  pageSize:  z.coerce.number().int().positive().max(100).default(20),
  threshold: z.coerce.number().min(0).max(100).optional(),
}));

export const attendanceTrendQuerySchema = periodRules(z.object({
  ...baseShape,
  granularity: z.enum(['DAY', 'WEEK', 'MONTH']).default('MONTH'),
}));

export const lowAttendanceQuerySchema = periodRules(z.object({
  ...baseShape,
  page:       z.coerce.number().int().positive().default(1),
  pageSize:   z.coerce.number().int().positive().max(100).default(20),
  threshold:  z.coerce.number().min(0).max(100).default(DEFAULT_ATTENDANCE_THRESHOLD),
  // Students with fewer marked days than this are skipped — 1 absence
  // out of 1 marked day isn't "low attendance".
  minMarkedDays: z.coerce.number().int().min(1).max(365).default(5),
}));

export const repeatedAbsenceQuerySchema = periodRules(z.object({
  ...baseShape,
  page:          z.coerce.number().int().positive().default(1),
  pageSize:      z.coerce.number().int().positive().max(100).default(20),
  minConsecutive: z.coerce.number().int().min(2).max(60).default(DEFAULT_REPEATED_ABSENCE_STREAK),
}));

export const supportQuerySchema = periodRules(z.object({
  ...baseShape,
  page:      z.coerce.number().int().positive().default(1),
  pageSize:  z.coerce.number().int().positive().max(100).default(20),
  threshold: z.coerce.number().min(0).max(100).default(DEFAULT_SUPPORT_THRESHOLD),
  attendanceThreshold: z.coerce.number().min(0).max(100).default(DEFAULT_ATTENDANCE_THRESHOLD),
}));

export const topPerformersQuerySchema = periodRules(z.object({
  ...baseShape,
  limit:     z.coerce.number().int().positive().max(100).default(10),
  // Students graded on fewer papers than this aren't ranked.
  minPapers: z.coerce.number().int().min(1).max(100).default(1),
}));

export const enrollmentTrendQuerySchema = periodRules(z.object({
  ...baseShape,
  sessions: z.coerce.number().int().min(2).max(10).default(3),
}));

export const termComparisonQuerySchema = periodRules(z.object({
  ...baseShape,
  // There's no Term table — the session is split into this many
  // month-aligned terms (2 → Apr–Sep / Oct–Mar for an April start).
  terms: z.coerce.number().int().min(2).max(4).default(2),
}));

export const alertsQuerySchema = periodRules(z.object({
  ...baseShape,
  attendanceThreshold: z.coerce.number().min(0).max(100).default(DEFAULT_ATTENDANCE_THRESHOLD),
  supportThreshold:    z.coerce.number().min(0).max(100).default(DEFAULT_SUPPORT_THRESHOLD),
  minConsecutive:      z.coerce.number().int().min(2).max(60).default(DEFAULT_REPEATED_ABSENCE_STREAK),
  // Drop in average marks (percentage points) between a student's last
  // two exams that counts as "declining".
  declineThreshold:    z.coerce.number().min(1).max(100).default(15),
  // Homework marked NOT_SUBMITTED at least this many times in the period.
  missingHomework:     z.coerce.number().int().min(1).max(100).default(3),
  type:     z.string().trim().optional(),
  severity: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
  limit:    z.coerce.number().int().positive().max(500).default(100),
}));

export const teacherIdParamSchema = z.object({ teacherId: z.string().uuid('Invalid teacher id') });

export type AnalyticsQuery          = z.infer<typeof analyticsQuerySchema>;
export type AnalyticsListQuery      = z.infer<typeof analyticsListQuerySchema>;
export type AttendanceTrendQuery    = z.infer<typeof attendanceTrendQuerySchema>;
export type LowAttendanceQuery      = z.infer<typeof lowAttendanceQuerySchema>;
export type RepeatedAbsenceQuery    = z.infer<typeof repeatedAbsenceQuerySchema>;
export type SupportQuery            = z.infer<typeof supportQuerySchema>;
export type TopPerformersQuery      = z.infer<typeof topPerformersQuerySchema>;
export type EnrollmentTrendQuery    = z.infer<typeof enrollmentTrendQuerySchema>;
export type TermComparisonQuery     = z.infer<typeof termComparisonQuerySchema>;
export type AlertsQuery             = z.infer<typeof alertsQuerySchema>;
