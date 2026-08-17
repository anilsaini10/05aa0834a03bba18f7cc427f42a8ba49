import { Prisma, DayOfWeek } from '@prisma/client';
import { prisma } from '../../config/db';
import { changeOwnPassword } from '../../shared/services/account.service';
import {
  UpdateProfileSchema,
  ListMyAnnouncementsQuerySchema,
  ListMyEventsQuerySchema,
  ListMyExamsQuerySchema,
  GetMyExamResultQuerySchema,
  GetMyChildTimetableQuerySchema,
  GetMyDashboardQuerySchema,
  GetMyChildAttendanceQuerySchema,
  ApplyLeaveSchema,
  ListMyLeaveQuerySchema,
  ListMyChildHomeworkQuerySchema,
  GetMyChildHomeworkQuerySchema,
} from './students.validation';

// Attendance is tracked per calendar day; normalize to date-only (midnight UTC)
// to match the DB's @db.Date column and avoid time-of-day mismatches.
const toDateOnly    = (d: Date): Date   => new Date(d.toISOString().slice(0, 10));
const todayDateOnly = (): Date          => toDateOnly(new Date());
const toDateString  = (d: Date): string => d.toISOString().slice(0, 10);
const daysBefore    = (d: Date, n: number): Date => new Date(d.getTime() - n * 86_400_000);

const forbidden = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 403;
  return err;
};

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

const requireOwnChild = async (userId: string, studentId: string) => {
  const student = await prisma.student.findUnique({
    where:   { id: studentId },
    include: {
      class:   true,
      section: { include: { classTeacher: { include: { user: true } } } },
    },
  });
  if (!student || student.parentUserId !== userId) {
    throw forbidden('This student is not linked to your account', 'NOT_YOUR_CHILD');
  }
  return student;
};

// ── GET /students/profile ─────────────────────────────────────
// Returns the logged-in PARENT's own profile plus every child
// (Student row) linked to them — a parent may have multiple children.
export const getProfile = async (userId: string) => {
  const parent = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const children = await prisma.student.findMany({
    where:   { parentUserId: userId },
    include: { class: true, section: true },
    orderBy: { name: 'asc' },
  });

  return {
    parent: {
      id:    parent.id,
      name:  parent.name,
      email: parent.email,
      phone: parent.phone,
    },
    children: children.map(s => ({
      id:                   s.id,
      admissionNo:          s.admissionNo,
      name:                 s.name,
      gender:               s.gender,
      dateOfBirth:          s.dateOfBirth,
      classId:              s.classId,
      className:            s.class.name,
      sectionId:            s.sectionId,
      sectionName:          s.section.name,
      rollNo:               s.rollNo,
      bloodGroup:           s.bloodGroup,
      address:              s.address,
      status:               s.status,
      attendancePercentage: s.attendancePercentage,
    })),
  };
};

// ── GET /students/dashboard ────────────────────────────────────
// Per-child summary for the parent home screen. pendingHomeworkCount
// counts homework for the child's class/section not yet due (there's
// no per-student submission tracking, so "pending" = dueDate >= today).
// upcomingExamsCount counts exams scheduled for the child's class that
// haven't started yet (or have no startDate set).
export const getMyDashboard = async (userId: string, query: GetMyDashboardQuerySchema) => {
  const parent  = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const student = await requireOwnChild(userId, query.studentId);
  const school  = await prisma.school.findUniqueOrThrow({ where: { id: parent.schoolId! } });
  const today   = todayDateOnly();

  const [attendanceRecord, pendingHomeworkCount, upcomingExamsCount] = await Promise.all([
    prisma.attendanceRecord.findUnique({
      where: { studentId_date: { studentId: student.id, date: today } },
    }),
    prisma.homework.count({
      where: { classId: student.classId, sectionId: student.sectionId, dueDate: { gte: today } },
    }),
    prisma.examClass.count({
      where: {
        classId: student.classId,
        OR: [{ exam: { startDate: null } }, { exam: { startDate: { gte: today } } }],
      },
    }),
  ]);

  return {
    parentName:           parent.name,
    schoolName:           school.name,
    studentName:          student.name,
    className:            student.class.name,
    sectionName:          student.section.name,
    classTeacherName:     student.section.classTeacher?.user.name ?? null,
    todayAttendance: {
      date:   toDateString(today),
      status: attendanceRecord?.status ?? null,
    },
    pendingHomeworkCount,
    upcomingExamsCount,
  };
};

// ── PATCH /students/profile ───────────────────────────────────
// Only the parent's own name/phone are self-editable — the child's
// student record (class, roll no, attendance...) is admin/teacher-managed.
export const updateProfile = async (userId: string, input: UpdateProfileSchema) => {
  const user = await prisma.user.update({ where: { id: userId }, data: input });
  return { id: user.id, name: user.name, email: user.email, phone: user.phone };
};

// ── POST /students/reset-password ─────────────────────────────
export const resetPassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> => {
  await changeOwnPassword(userId, currentPassword, newPassword);
};

// ── GET /students/exams — exams scheduled for one child's class ─
// Schedule/details only (title, dates, maxMarks) — not results/marks,
// which live in ExamResult and aren't exposed to parents here.
export const listMyExams = async (userId: string, query: ListMyExamsQuerySchema) => {
  const student = await requireOwnChild(userId, query.studentId);

  const examClasses = await prisma.examClass.findMany({
    where:   { classId: student.classId },
    include: { exam: true },
    orderBy: { exam: { startDate: 'asc' } },
  });

  return examClasses.map(ec => ({
    examId:      ec.exam.id,
    title:       ec.exam.title,
    description: ec.exam.description,
    startDate:   ec.exam.startDate,
    endDate:     ec.exam.endDate,
    maxMarks:    ec.maxMarks,
  }));
};

// ── GET /students/exams/:examId — one child's result for one exam ─
// Always returns a `result` object (never null) — status defaults to
// PENDING with null marks/grade if the admin hasn't recorded a result
// row yet, so the RN app never has to null-check the whole shape.
export const getMyExamResult = async (
  userId: string,
  examId: string,
  query: GetMyExamResultQuerySchema,
) => {
  const student = await requireOwnChild(userId, query.studentId);

  const examClass = await prisma.examClass.findUnique({
    where:   { examId_classId: { examId, classId: student.classId } },
    include: { exam: true },
  });
  if (!examClass) throw notFound('This exam is not scheduled for this student\'s class', 'EXAM_NOT_FOUND');

  const result = await prisma.examResult.findUnique({
    where: { examId_studentId: { examId, studentId: student.id } },
  });

  return {
    examId:      examClass.exam.id,
    title:       examClass.exam.title,
    description: examClass.exam.description,
    startDate:   examClass.exam.startDate,
    endDate:     examClass.exam.endDate,
    maxMarks:    examClass.maxMarks,
    result: {
      marksObtained: result?.marksObtained ?? null,
      grade:         result?.grade ?? null,
      remarks:       result?.remarks ?? null,
      status:        result?.status ?? 'PENDING',
    },
  };
};

// ── GET /students/timetable — one child's weekly class timetable ─
// Read-only for parents — schedule management stays admin-only.
const TIMETABLE_WEEK_DAYS: DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

const toChildScheduleEntry = (s: any) => ({
  id:          s.id,
  day:         s.day,
  type:        s.type,
  periodNo:    s.periodNo,
  subjectId:   s.subjectId,
  subjectName: s.subject?.name ?? null,
  teacherId:   s.teacherId,
  teacherName: s.teacher?.user.name ?? null,
  roomNo:      s.roomNo,
  title:       s.title,
  startTime:   s.startTime,
  endTime:     s.endTime,
});

export const getMyChildTimetable = async (userId: string, query: GetMyChildTimetableQuerySchema) => {
  const student = await requireOwnChild(userId, query.studentId);

  const entries = await prisma.classSchedule.findMany({
    where:   { sectionId: student.sectionId, day: { in: TIMETABLE_WEEK_DAYS } },
    include: { subject: true, teacher: { include: { user: true } } },
    orderBy: { periodNo: 'asc' },
  });

  const timetable: Record<string, ReturnType<typeof toChildScheduleEntry>[]> = {};
  for (const d of TIMETABLE_WEEK_DAYS) timetable[d] = [];
  for (const e of entries) timetable[e.day].push(toChildScheduleEntry(e));

  return {
    studentId:   student.id,
    className:   student.class.name,
    sectionName: student.section.name,
    timetable,
  };
};

// ── GET /students/attendance — one child's attendance history ───
// Read-only for parents — marking/correcting attendance stays with
// the Class Teacher (src/features/teacher). Defaults to last 30 days.
export const getMyChildAttendance = async (userId: string, query: GetMyChildAttendanceQuerySchema) => {
  const student = await requireOwnChild(userId, query.studentId);

  const to   = query.to ? toDateOnly(query.to) : todayDateOnly();
  const from = query.from ? toDateOnly(query.from) : daysBefore(to, 29);

  const records = await prisma.attendanceRecord.findMany({
    where:   { studentId: student.id, date: { gte: from, lte: to } },
    orderBy: { date: 'asc' },
  });

  const summary = { present: 0, absent: 0, late: 0, leave: 0, holiday: 0 };
  for (const r of records) {
    if (r.status === 'PRESENT') summary.present++;
    else if (r.status === 'ABSENT') summary.absent++;
    else if (r.status === 'LATE') summary.late++;
    else if (r.status === 'LEAVE') summary.leave++;
    else summary.holiday++;
  }

  return {
    studentId:   student.id,
    name:        student.name,
    admissionNo: student.admissionNo,
    className:   student.class.name,
    sectionName: student.section.name,
    from:        toDateString(from),
    to:          toDateString(to),
    records: records.map(r => ({ id: r.id, date: toDateString(r.date), status: r.status })),
    summary,
  };
};

// ════════════════════════════════════════════════════════════
// Leave requests — a parent applies on behalf of their child; a
// Class Teacher or Admin approves/rejects (src/features/teacher and
// src/features/admin/leave). Parents can only apply/view/cancel here.
// ════════════════════════════════════════════════════════════

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

// ── POST /students/leave ────────────────────────────────────────
export const applyLeave = async (userId: string, input: ApplyLeaveSchema) => {
  const student = await requireOwnChild(userId, input.studentId);

  const leave = await prisma.leaveRequest.create({
    data: {
      schoolId:  student.schoolId,
      studentId: student.id,
      classId:   student.classId,
      sectionId: student.sectionId,
      fromDate:  toDateOnly(input.fromDate),
      toDate:    toDateOnly(input.toDate),
      reason:    input.reason,
      appliedBy: userId,
    },
    include: LEAVE_INCLUDE,
  });

  return toLeaveResponse(leave);
};

// ── GET /students/leave ──────────────────────────────────────────
export const listMyLeave = async (userId: string, query: ListMyLeaveQuerySchema) => {
  const student = await requireOwnChild(userId, query.studentId);

  const leaves = await prisma.leaveRequest.findMany({
    where:   { studentId: student.id, ...(query.status ? { status: query.status } : {}) },
    include: LEAVE_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });

  return leaves.map(toLeaveResponse);
};

// ── DELETE /students/leave/:leaveId — cancel a still-pending request ─
export const cancelLeave = async (userId: string, leaveId: string): Promise<void> => {
  const leave = await prisma.leaveRequest.findUnique({
    where:   { id: leaveId },
    include: { student: true },
  });
  if (!leave || leave.student.parentUserId !== userId) {
    throw forbidden('This leave request is not linked to your account', 'NOT_YOUR_CHILD');
  }
  if (leave.status !== 'PENDING') {
    throw conflict('Only pending leave requests can be cancelled', 'LEAVE_ALREADY_REVIEWED');
  }

  await prisma.leaveRequest.delete({ where: { id: leaveId } });
};

// ════════════════════════════════════════════════════════════
// Homework — read-only for parents. Homework applies to a whole
// class+section (not per-student), so it's scoped by the child's
// own classId/sectionId, never a teacher's createdBy ownership.
// ════════════════════════════════════════════════════════════

const HOMEWORK_INCLUDE = {
  class:         true,
  section:       true,
  subject:       true,
  createdByUser: true,
};

const toChildHomeworkResponse = (hw: any) => ({
  id:          hw.id,
  classId:     hw.classId,
  className:   hw.class.name,
  sectionId:   hw.sectionId,
  sectionName: hw.section.name,
  subjectId:   hw.subjectId,
  subjectName: hw.subject.name,
  title:       hw.title,
  description: hw.description,
  type:        hw.type,
  dueDate:     hw.dueDate,
  teacherName: hw.createdByUser.name,
  createdAt:   hw.createdAt,
  updatedAt:   hw.updatedAt,
});

// ── GET /students/homework ────────────────────────────────────
export const listMyChildHomework = async (userId: string, query: ListMyChildHomeworkQuerySchema) => {
  const student = await requireOwnChild(userId, query.studentId);
  const { page, pageSize, subjectId } = query;

  const where: Prisma.HomeworkWhereInput = {
    classId:   student.classId,
    sectionId: student.sectionId,
    ...(subjectId ? { subjectId } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.homework.findMany({
      where,
      include:  HOMEWORK_INCLUDE,
      orderBy:  { dueDate: 'asc' },
      skip:     (page - 1) * pageSize,
      take:     pageSize,
    }),
    prisma.homework.count({ where }),
  ]);

  return {
    items: items.map(toChildHomeworkResponse),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};

// ── GET /students/homework/:homeworkId ────────────────────────
export const getMyChildHomework = async (
  userId: string,
  homeworkId: string,
  query: GetMyChildHomeworkQuerySchema,
) => {
  const student = await requireOwnChild(userId, query.studentId);

  const homework = await prisma.homework.findFirst({
    where:   { id: homeworkId, classId: student.classId, sectionId: student.sectionId },
    include: HOMEWORK_INCLUDE,
  });
  if (!homework) throw notFound('Homework not found', 'HOMEWORK_NOT_FOUND');

  return toChildHomeworkResponse(homework);
};

// ── GET /students/announcements ───────────────────────────────
// Only announcements meant for PARENT (or everyone, ALL) — never
// TEACHER-only announcements.
export const listMyAnnouncements = async (userId: string, query: ListMyAnnouncementsQuerySchema) => {
  const parent = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const { page, pageSize, search, from, to } = query;
  const now = new Date();

  const where: Prisma.AnnouncementWhereInput = {
    schoolId: parent.schoolId!,
    audience: { in: ['ALL', 'PARENT'] },
    AND: [
      { OR: [{ publishAt: null }, { publishAt: { lte: now } }] },
      { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
      // Announcements without a specific eventDate (general notices) are never
      // date-filtered out — only ones tied to a date are checked against from/to.
      ...(from ? [{ OR: [{ eventDate: null }, { eventDate: { gte: from } }] }] : []),
      ...(to   ? [{ OR: [{ eventDate: null }, { eventDate: { lte: to } }] }] : []),
    ],
    ...(search ? {
      OR: [
        { title:   { contains: search, mode: 'insensitive' } },
        { message: { contains: search, mode: 'insensitive' } },
      ],
    } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.announcement.findMany({
      where,
      include:  { createdByUser: true },
      orderBy:  { createdAt: 'desc' },
      skip:     (page - 1) * pageSize,
      take:     pageSize,
    }),
    prisma.announcement.count({ where }),
  ]);

  return {
    items: items.map(a => ({
      id:        a.id,
      title:     a.title,
      message:   a.message,
      audience:  a.audience,
      eventDate: a.eventDate,
      createdBy: { id: a.createdByUser.id, name: a.createdByUser.name },
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};

// ── GET /students/events ──────────────────────────────────────
// Only events meant for PARENT (or everyone, ALL) — never TEACHER-only.
export const listMyEvents = async (userId: string, query: ListMyEventsQuerySchema) => {
  const parent = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const { page, pageSize, search, eventType, from, to } = query;

  const where: Prisma.EventWhereInput = {
    schoolId: parent.schoolId!,
    audience: { in: ['ALL', 'PARENT'] },
    ...(eventType ? { eventType } : {}),
    ...(from ? { endDate: { gte: from } } : {}),
    ...(to   ? { startDate: { lte: to } } : {}),
    ...(search ? {
      OR: [
        { title:       { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.event.findMany({
      where,
      include:  { createdByUser: true },
      orderBy:  { startDate: 'asc' },
      skip:     (page - 1) * pageSize,
      take:     pageSize,
    }),
    prisma.event.count({ where }),
  ]);

  return {
    items: items.map(e => ({
      id:          e.id,
      title:       e.title,
      description: e.description,
      eventType:   e.eventType,
      audience:    e.audience,
      startDate:   e.startDate,
      endDate:     e.endDate,
      createdBy:   { id: e.createdByUser.id, name: e.createdByUser.name },
      createdAt:   e.createdAt,
      updatedAt:   e.updatedAt,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};
