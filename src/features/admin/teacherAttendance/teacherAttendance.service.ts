import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/db';
import {
  MarkTeacherAttendanceSchema,
  ListTeacherAttendanceQuerySchema,
  UpdateTeacherAttendanceSchema,
} from './teacherAttendance.validation';

// Attendance is tracked per calendar day; normalize to date-only (midnight UTC)
// to match the DB's @db.Date column and avoid time-of-day mismatches.
const toDateOnly   = (d: Date): Date   => new Date(d.toISOString().slice(0, 10));
const toDateString = (d: Date): string => d.toISOString().slice(0, 10);

const notFound = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 404;
  return err;
};

const TEACHER_ATTENDANCE_INCLUDE = {
  teacher:      { include: { user: true } },
  markedByUser: true,
};

const toRecordResponse = (r: any) => ({
  id:          r.id,
  teacherId:   r.teacherId,
  teacherName: r.teacher.user.name,
  employeeId:  r.teacher.employeeId,
  date:        toDateString(r.date),
  status:      r.status,
  markedBy:    { id: r.markedByUser.id, name: r.markedByUser.name },
  createdAt:   r.createdAt,
  updatedAt:   r.updatedAt,
});

// ── POST /admin/teacher-attendance — bulk mark/update (upsert) for a date ─
// One call handles both "mark today's attendance" and "correct it" —
// re-submitting the same teacher+date just overwrites the status.
export const markTeacherAttendance = async (
  schoolId: string,
  userId: string,
  input: MarkTeacherAttendanceSchema,
) => {
  const teacherIds = input.records.map(r => r.teacherId);
  const validCount = await prisma.teacher.count({ where: { id: { in: teacherIds }, schoolId } });
  if (validCount !== new Set(teacherIds).size) {
    throw notFound('One or more teachers do not belong to this school', 'TEACHER_NOT_IN_SCHOOL');
  }

  const date = toDateOnly(input.date);

  await prisma.$transaction(
    input.records.map(r =>
      prisma.teacherAttendanceRecord.upsert({
        where:  { teacherId_date: { teacherId: r.teacherId, date } },
        update: { status: r.status, markedBy: userId },
        create: { teacherId: r.teacherId, date, status: r.status, markedBy: userId, schoolId },
      }),
    ),
  );

  return { date: toDateString(date), marked: input.records.length };
};

// ── GET /admin/teacher-attendance — paginated register with filters ────────
export const listTeacherAttendance = async (schoolId: string, query: ListTeacherAttendanceQuerySchema) => {
  const { page, pageSize, date, from, to, status, teacherId } = query;

  const dateFilter = date
    ? toDateOnly(date)
    : (from || to)
      ? {
          ...(from ? { gte: toDateOnly(from) } : {}),
          ...(to   ? { lte: toDateOnly(to) }   : {}),
        }
      : undefined;

  const where: Prisma.TeacherAttendanceRecordWhereInput = {
    schoolId,
    ...(teacherId ? { teacherId } : {}),
    ...(status ? { status } : {}),
    ...(dateFilter ? { date: dateFilter } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.teacherAttendanceRecord.findMany({
      where,
      include: TEACHER_ATTENDANCE_INCLUDE,
      orderBy: { date: 'desc' },
      skip:    (page - 1) * pageSize,
      take:    pageSize,
    }),
    prisma.teacherAttendanceRecord.count({ where }),
  ]);

  return {
    items: items.map(toRecordResponse),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};

// ── PATCH /admin/teacher-attendance/:recordId — correct a single record ────
export const updateTeacherAttendance = async (
  schoolId: string,
  userId: string,
  recordId: string,
  input: UpdateTeacherAttendanceSchema,
) => {
  const record = await prisma.teacherAttendanceRecord.findFirst({ where: { id: recordId, schoolId } });
  if (!record) throw notFound('Attendance record not found', 'RECORD_NOT_FOUND');

  const updated = await prisma.teacherAttendanceRecord.update({
    where:   { id: recordId },
    data:    { status: input.status, markedBy: userId },
    include: TEACHER_ATTENDANCE_INCLUDE,
  });

  return toRecordResponse(updated);
};
