import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/db';
import {
  AttendanceDateQuerySchema,
  ListClassStudentsAttendanceQuerySchema,
} from './attendanceReport.validation';

const notFound = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 404;
  return err;
};

// Normalize any Date to a date-only value (midnight UTC) — attendance is
// tracked per calendar day, and the DB column itself is @db.Date.
const toDateOnly = (d: Date): Date => new Date(d.toISOString().slice(0, 10));
const todayDateOnly = (): Date => toDateOnly(new Date());
const toDateString = (d: Date): string => d.toISOString().slice(0, 10);

// ── Class-wise attendance summary for a given date ────────────────
export const getClassAttendanceSummary = async (
  schoolId: string,
  query: AttendanceDateQuerySchema,
) => {
  const date = query.date ? toDateOnly(query.date) : todayDateOnly();

  const [classes, grouped] = await Promise.all([
    prisma.class.findMany({
      where:   { schoolId },
      include: { _count: { select: { students: true } } },
      orderBy: { numericLevel: 'asc' },
    }),
    prisma.attendanceRecord.groupBy({
      by:     ['classId', 'status'],
      where:  { schoolId, date },
      _count: { _all: true },
    }),
  ]);

  const countsByClass = new Map<string, Partial<Record<string, number>>>();
  for (const g of grouped) {
    const entry = countsByClass.get(g.classId) ?? {};
    entry[g.status] = g._count._all;
    countsByClass.set(g.classId, entry);
  }

  return {
    date: toDateString(date),
    classes: classes.map(c => {
      const counts  = countsByClass.get(c.id) ?? {};
      const present = counts.PRESENT ?? 0;
      const absent  = counts.ABSENT  ?? 0;
      const late    = counts.LATE   ?? 0;
      const leave   = counts.LEAVE  ?? 0;
      const total   = c._count.students;

      return {
        classId:    c.id,
        className:  c.name,
        present,
        absent,
        late,
        leave,
        total,
        percentage: total > 0 ? Math.round((present / total) * 100) : 0,
      };
    }),
  };
};

// ── Students in a class, with their attendance status for a date ──
export const listClassStudentsAttendance = async (
  schoolId: string,
  classId: string,
  query: ListClassStudentsAttendanceQuerySchema,
) => {
  const klass = await prisma.class.findFirst({ where: { id: classId, schoolId } });
  if (!klass) throw notFound('Class not found', 'CLASS_NOT_FOUND');

  const date = query.date ? toDateOnly(query.date) : todayDateOnly();
  const { page, pageSize, search } = query;

  const where: Prisma.StudentWhereInput = {
    classId,
    ...(search ? {
      OR: [
        { name:        { contains: search, mode: 'insensitive' } },
        { admissionNo: { contains: search, mode: 'insensitive' } },
      ],
    } : {}),
  };

  const [students, total] = await Promise.all([
    prisma.student.findMany({
      where,
      include:  { section: true, attendanceRecords: { where: { date } } },
      orderBy:  { rollNo: 'asc' },
      skip:     (page - 1) * pageSize,
      take:     pageSize,
    }),
    prisma.student.count({ where }),
  ]);

  return {
    date:      toDateString(date),
    classId:   klass.id,
    className: klass.name,
    items: students.map(s => ({
      studentId:   s.id,
      name:        s.name,
      admissionNo: s.admissionNo,
      rollNo:      s.rollNo,
      sectionName: s.section.name,
      status:      s.attendanceRecords[0]?.status ?? null,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};
