// Central home for hardcoded string literals (status/type values, etc.)
// that are NOT already backed by a Prisma-generated enum. Role, Gender,
// LeaveStatus, AttendanceStatus, AnnouncementAudience, EventType,
// HomeworkSubmissionStatus, Board, SchoolType, Platform, ResultStatus,
// etc. already live in @prisma/client (import those from there — don't
// duplicate them here). This file is only for the plain `String` columns
// and ad-hoc literals that Prisma doesn't type-check for us.
//
// Add a new constant here whenever a magic string is about to be typed
// in more than one place, instead of re-typing the literal.

// ── Active/Inactive record status ─────────────────────────────────
// Student, Teacher, and Staff each have a plain `status: String` column
// in schema.prisma (not a Prisma enum) — this is the single source of
// truth for those literal values across the app.
export const RECORD_STATUS = {
  ACTIVE:   'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;

export type RecordStatus = (typeof RECORD_STATUS)[keyof typeof RECORD_STATUS];

// Tuple form for zod schemas: z.enum(RECORD_STATUS_VALUES)
export const RECORD_STATUS_VALUES = [RECORD_STATUS.ACTIVE, RECORD_STATUS.INACTIVE] as const;

// Some list endpoints (e.g. GET /admin/students) also accept an explicit
// "no filter" value on top of the two real statuses — it's never itself
// a stored value, just a query-param meta-option.
export const RECORD_STATUS_FILTER_ALL = 'ALL';
export const RECORD_STATUS_FILTER_VALUES = [...RECORD_STATUS_VALUES, RECORD_STATUS_FILTER_ALL] as const;

// ── Announcement lifecycle status ─────────────────────────────────
// Computed on the fly from publishAt/expiresAt (see announcements.service.ts)
// — never stored on the row, but still worth a single source of truth
// since the same three values are returned from multiple places.
export const ANNOUNCEMENT_STATUS = {
  SCHEDULED: 'SCHEDULED',
  ACTIVE:    'ACTIVE',
  EXPIRED:   'EXPIRED',
} as const;

export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUS)[keyof typeof ANNOUNCEMENT_STATUS];

// ── Homework lifecycle status ─────────────────────────────────────
// SCHEDULED is COMPUTED, never stored — a homework with a future
// `fromDate` is SCHEDULED regardless of what's in the `status` column
// (mirrors ANNOUNCEMENT_STATUS's computeStatus pattern). The DB column
// only ever holds one of HOMEWORK_MANUAL_STATUS_VALUES; teachers set
// those manually (via update), SCHEDULED is derived at read-time by
// computeHomeworkStatus (src/shared/utils/homeworkStatus.ts).
export const HOMEWORK_STATUS = {
  SCHEDULED:   'SCHEDULED',
  ACTIVE:      'ACTIVE',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED:   'COMPLETED',
} as const;

export type HomeworkStatus = (typeof HOMEWORK_STATUS)[keyof typeof HOMEWORK_STATUS];

export const HOMEWORK_MANUAL_STATUS_VALUES = [
  HOMEWORK_STATUS.ACTIVE,
  HOMEWORK_STATUS.IN_PROGRESS,
  HOMEWORK_STATUS.COMPLETED,
] as const;

// ── Notification `type` values ────────────────────────────────────
// Notification.type is a plain string column ON PURPOSE (see
// notifications.service.ts) — new features can introduce a new type
// without a schema migration. This object is a registry of the values
// currently in use, not an enforced/exhaustive enum — feel free to add
// a new key here when a new feature starts sending its own type, rather
// than inlining a fresh literal at the call site.
export const NOTIFICATION_TYPE = {
  GENERAL:               'GENERAL',
  ANNOUNCEMENT:          'ANNOUNCEMENT',
  EVENT:                 'EVENT',
  LEAVE_REQUEST:         'LEAVE_REQUEST',
  TEACHER_LEAVE_REQUEST: 'TEACHER_LEAVE_REQUEST',
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPE)[keyof typeof NOTIFICATION_TYPE];
