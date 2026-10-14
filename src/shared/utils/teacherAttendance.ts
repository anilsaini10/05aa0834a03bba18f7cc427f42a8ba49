import { Prisma } from '@prisma/client';

// ── Teacher attendance: one row per teacher per day, with two independent
//    markings and a final status —
//      teacherStatus / teacherMarkedAt /
//      teacherLatitude / teacherLongitude           teacher's own check-in
//      teacherCheckOutAt / teacherCheckOutLatitude /
//      teacherCheckOutLongitude                     teacher's own check-out
//      adminStatus / adminMarkedBy / adminMarkedAt  admin's marking
//      status                                       final = adminStatus ?? teacherStatus
//    Shared by the admin register and the teacher's own views so both
//    return the same shape. ───────────────────────────────────────────

export const TEACHER_ATTENDANCE_RECORD_INCLUDE = {
  adminMarkedByUser: true,
} satisfies Prisma.TeacherAttendanceRecordInclude;

type RecordWithAdmin = Prisma.TeacherAttendanceRecordGetPayload<{ include: typeof TEACHER_ATTENDANCE_RECORD_INCLUDE }>;

export const toTeacherAttendanceResponse = (r: RecordWithAdmin) => ({
  id:              r.id,
  date:            r.date.toISOString().slice(0, 10),
  status:          r.status,
  teacherStatus:   r.teacherStatus,
  teacherMarkedAt: r.teacherMarkedAt,
  teacherLatitude:  r.teacherLatitude,
  teacherLongitude: r.teacherLongitude,
  teacherCheckOutAt:        r.teacherCheckOutAt,
  teacherCheckOutLatitude:  r.teacherCheckOutLatitude,
  teacherCheckOutLongitude: r.teacherCheckOutLongitude,
  // Minutes between check-in and check-out (null until both exist).
  workedMinutes: r.teacherMarkedAt && r.teacherCheckOutAt
    ? Math.round((r.teacherCheckOutAt.getTime() - r.teacherMarkedAt.getTime()) / 60_000)
    : null,
  adminStatus:     r.adminStatus,
  adminMarkedAt:   r.adminMarkedAt,
  adminMarkedBy:   r.adminMarkedByUser ? { id: r.adminMarkedByUser.id, name: r.adminMarkedByUser.name } : null,
  createdAt:       r.createdAt,
  updatedAt:       r.updatedAt,
});
