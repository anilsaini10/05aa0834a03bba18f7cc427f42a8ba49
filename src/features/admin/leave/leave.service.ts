import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/db';
import { notifyUser } from '../../notifications/notifications.service';
import { ListLeaveQuerySchema, ReviewLeaveSchema, ListTeacherLeaveQuerySchema } from './leave.validation';

const toDateOnly   = (d: Date): Date   => new Date(d.toISOString().slice(0, 10));
const toDateString = (d: Date): string => d.toISOString().slice(0, 10);

const notFound = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 404;
  return err;
};

const conflict = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 409;
  return err;
};

const datesInRange = (from: Date, to: Date): Date[] => {
  const dates: Date[] = [];
  for (let d = from; d <= to; d = new Date(d.getTime() + 86_400_000)) dates.push(d);
  return dates;
};

const LEAVE_INCLUDE = {
  student:        true,
  class:          true,
  section:        true,
  appliedByUser:  true,
  reviewedByUser: true,
};

const toLeaveResponse = (l: any) => ({
  id:            l.id,
  studentId:     l.studentId,
  studentName:   l.student.name,
  classId:       l.classId,
  className:     l.class.name,
  sectionId:     l.sectionId,
  sectionName:   l.section.name,
  fromDate:      toDateString(l.fromDate),
  toDate:        toDateString(l.toDate),
  reason:        l.reason,
  status:        l.status,
  appliedBy:     { id: l.appliedByUser.id, name: l.appliedByUser.name },
  reviewedBy:    l.reviewedByUser ? { id: l.reviewedByUser.id, name: l.reviewedByUser.name } : null,
  reviewedAt:    l.reviewedAt,
  reviewRemarks: l.reviewRemarks,
  createdAt:     l.createdAt,
  updatedAt:     l.updatedAt,
});

// ── GET /admin/leave — every leave request in the school ────────
export const listLeaveRequests = async (schoolId: string, query: ListLeaveQuerySchema) => {
  const where: Prisma.LeaveRequestWhereInput = {
    schoolId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.classId ? { classId: query.classId } : {}),
    ...(query.sectionId ? { sectionId: query.sectionId } : {}),
  };

  const leaves = await prisma.leaveRequest.findMany({
    where,
    include: LEAVE_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });

  return leaves.map(toLeaveResponse);
};

// ── PATCH /admin/leave/:leaveId — approve/reject (any section) ──
// Same "correction" semantics as the teacher-side review: approving
// auto-marks AttendanceRecord as LEAVE for every date in the range,
// overwriting whatever was there before.
export const reviewLeaveRequest = async (
  schoolId: string,
  userId: string,
  leaveId: string,
  input: ReviewLeaveSchema,
) => {
  const leave = await prisma.leaveRequest.findFirst({ where: { id: leaveId, schoolId } });
  if (!leave) throw notFound('Leave request not found', 'LEAVE_NOT_FOUND');
  if (leave.status !== 'PENDING') {
    throw conflict('This leave request has already been reviewed', 'LEAVE_ALREADY_REVIEWED');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.leaveRequest.update({
      where: { id: leaveId },
      data: {
        status:        input.status,
        reviewedBy:    userId,
        reviewedAt:    new Date(),
        reviewRemarks: input.reviewRemarks ?? null,
      },
      include: LEAVE_INCLUDE,
    });

    if (input.status === 'APPROVED') {
      const dates = datesInRange(toDateOnly(leave.fromDate), toDateOnly(leave.toDate));
      await Promise.all(dates.map(date =>
        tx.attendanceRecord.upsert({
          where:  { studentId_date: { studentId: leave.studentId, date } },
          update: { status: 'LEAVE', markedBy: userId },
          create: {
            studentId: leave.studentId,
            date,
            status:    'LEAVE',
            markedBy:  userId,
            classId:   leave.classId,
            sectionId: leave.sectionId,
            schoolId:  leave.schoolId,
          },
        }),
      ));
    }

    return result;
  });

  // Fire-and-forget, single user only (the parent who applied) — never
  // awaited, never throws (see notifyUser).
  notifyUser(updated.appliedBy, {
    title: `Leave Request ${input.status === 'APPROVED' ? 'Approved' : 'Rejected'}`,
    body:  `${updated.student.name}'s leave (${toDateString(updated.fromDate)} - ${toDateString(updated.toDate)}) has been ${input.status.toLowerCase()}.`,
    data:  { type: 'LEAVE_REQUEST', leaveId: updated.id },
  });

  return toLeaveResponse(updated);
};

// ════════════════════════════════════════════════════════════
// Teacher leave — a teacher's own time off (src/features/teacher
// handles applying). Only Admin reviews this — no attendance to
// auto-mark since staff attendance isn't tracked in this system.
// ════════════════════════════════════════════════════════════

const TEACHER_LEAVE_INCLUDE = {
  teacher:        { include: { user: true } },
  reviewedByUser: true,
};

const toTeacherLeaveResponse = (l: any) => ({
  id:            l.id,
  teacherId:     l.teacherId,
  teacherName:   l.teacher.user.name,
  fromDate:      toDateString(l.fromDate),
  toDate:        toDateString(l.toDate),
  reason:        l.reason,
  status:        l.status,
  reviewedBy:    l.reviewedByUser ? { id: l.reviewedByUser.id, name: l.reviewedByUser.name } : null,
  reviewedAt:    l.reviewedAt,
  reviewRemarks: l.reviewRemarks,
  createdAt:     l.createdAt,
  updatedAt:     l.updatedAt,
});

// ── GET /admin/leave/teachers ─────────────────────────────────────
export const listTeacherLeaveRequests = async (schoolId: string, query: ListTeacherLeaveQuerySchema) => {
  const leaves = await prisma.teacherLeaveRequest.findMany({
    where:   { schoolId, ...(query.status ? { status: query.status } : {}) },
    include: TEACHER_LEAVE_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });

  return leaves.map(toTeacherLeaveResponse);
};

// ── PATCH /admin/leave/teachers/:leaveId ──────────────────────────
export const reviewTeacherLeaveRequest = async (
  schoolId: string,
  userId: string,
  leaveId: string,
  input: ReviewLeaveSchema,
) => {
  const leave = await prisma.teacherLeaveRequest.findFirst({ where: { id: leaveId, schoolId } });
  if (!leave) throw notFound('Leave request not found', 'LEAVE_NOT_FOUND');
  if (leave.status !== 'PENDING') {
    throw conflict('This leave request has already been reviewed', 'LEAVE_ALREADY_REVIEWED');
  }

  const updated = await prisma.teacherLeaveRequest.update({
    where: { id: leaveId },
    data: {
      status:        input.status,
      reviewedBy:    userId,
      reviewedAt:    new Date(),
      reviewRemarks: input.reviewRemarks ?? null,
    },
    include: TEACHER_LEAVE_INCLUDE,
  });

  // Fire-and-forget, single user only (the teacher whose leave this is) —
  // never awaited, never throws (see notifyUser).
  notifyUser(updated.teacher.userId, {
    title: `Leave Request ${input.status === 'APPROVED' ? 'Approved' : 'Rejected'}`,
    body:  `Your leave (${toDateString(updated.fromDate)} - ${toDateString(updated.toDate)}) has been ${input.status.toLowerCase()}.`,
    data:  { type: 'TEACHER_LEAVE_REQUEST', leaveId: updated.id },
  });

  return toTeacherLeaveResponse(updated);
};
