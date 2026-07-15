import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db';
import { changeOwnPassword } from '../../shared/services/account.service';
import {
  UpdateProfileSchema,
  ListMyStudentsQuerySchema,
  ListMyAnnouncementsQuerySchema,
  GetSectionAttendanceQuerySchema,
  MarkAttendanceSchema,
  StudentAttendanceHistoryQuerySchema,
  UpdateAttendanceRecordSchema,
  CreateHomeworkSchema,
  UpdateHomeworkSchema,
  ListMyHomeworkQuerySchema,
} from './teacher.validation';

// Attendance is tracked per calendar day; normalize to date-only (midnight UTC)
// to match the DB's @db.Date column and avoid time-of-day mismatches.
const toDateOnly     = (d: Date): Date   => new Date(d.toISOString().slice(0, 10));
const todayDateOnly  = (): Date          => toDateOnly(new Date());
const toDateString   = (d: Date): string => d.toISOString().slice(0, 10);
const daysBefore     = (d: Date, n: number): Date => new Date(d.getTime() - n * 86_400_000);

const notFound = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 404;
  return err;
};

const forbidden = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 403;
  return err;
};

const TEACHER_INCLUDE = {
  user:              true,
  subjects:          { include: { subject: true, class: true } },
  sectionsAsTeacher: true,
};

const getTeacherByUserId = async (userId: string) => {
  const teacher = await prisma.teacher.findUnique({
    where:   { userId },
    include: TEACHER_INCLUDE,
  });
  if (!teacher) throw notFound('Teacher profile not found', 'TEACHER_NOT_FOUND');
  return teacher;
};

// ── GET /teacher/profile ──────────────────────────────────────
export const getProfile = async (userId: string) => {
  const teacher = await getTeacherByUserId(userId);

  return {
    id:               teacher.id,
    employeeId:       teacher.employeeId,
    name:             teacher.user.name,
    email:            teacher.user.email,
    phone:            teacher.user.phone,
    gender:           teacher.gender,
    subjects: teacher.subjects.map(ts => ({
      subjectId: ts.subject.id,
      name:      ts.subject.name,
      classId:   ts.class.id,
      className: ts.class.name,
    })),
    joiningDate:      teacher.joiningDate,
    salary:           teacher.salary,
    status:           teacher.status,
    performanceScore: teacher.performanceScore,
  };
};

// ── PATCH /teacher/profile ────────────────────────────────────
// Only name/phone are self-editable — email is the login identifier
// and everything else (subjects, salary, status...) is admin-managed.
export const updateProfile = async (userId: string, input: UpdateProfileSchema) => {
  const user = await prisma.user.update({ where: { id: userId }, data: input });
  return { id: user.id, name: user.name, email: user.email, phone: user.phone };
};

// ── POST /teacher/reset-password ──────────────────────────────
export const resetPassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> => {
  await changeOwnPassword(userId, currentPassword, newPassword);
};

// ── GET /teacher/classes ──────────────────────────────────────
// Only the classes this teacher actually teaches in (via TeacherSubject) —
// never the whole school's class list.
export const listMyClasses = async (userId: string) => {
  const teacher   = await getTeacherByUserId(userId);
  const classIds  = [...new Set(teacher.subjects.map(ts => ts.classId))];

  const classes = await prisma.class.findMany({
    where:   { id: { in: classIds } },
    include: {
      _count:   { select: { students: true } },
      sections: {
        include: { classTeacher: { include: { user: true } }, _count: { select: { students: true } } },
        orderBy: { name: 'asc' },
      },
    },
    orderBy: { numericLevel: 'asc' },
  });

  const mySubjectsByClass = new Map<string, { subjectId: string; name: string }[]>();
  for (const ts of teacher.subjects) {
    const list = mySubjectsByClass.get(ts.classId) ?? [];
    list.push({ subjectId: ts.subject.id, name: ts.subject.name });
    mySubjectsByClass.set(ts.classId, list);
  }

  return classes.map(c => ({
    id:            c.id,
    name:          c.name,
    numericLevel:  c.numericLevel,
    totalStudents: c._count.students,
    sections: c.sections.map(s => ({
      id:               s.id,
      name:             s.name,
      classId:          s.classId,
      classTeacherId:   s.classTeacherId,
      classTeacherName: s.classTeacher?.user.name ?? null,
      capacity:         s.capacity,
      studentCount:     s._count.students,
    })),
    mySubjects: mySubjectsByClass.get(c.id) ?? [],
  }));
};

// ── GET /teacher/students ─────────────────────────────────────
// classId is required and MUST be one of this teacher's own classes —
// never trust a client-supplied classId as proof of access.
export const listMyStudents = async (userId: string, query: ListMyStudentsQuerySchema) => {
  const teacher    = await getTeacherByUserId(userId);
  const myClassIds = new Set(teacher.subjects.map(ts => ts.classId));

  if (!myClassIds.has(query.classId)) {
    throw forbidden('You are not assigned to this class', 'CLASS_NOT_ASSIGNED');
  }

  const { page, pageSize, search, classId, sectionId } = query;

  const where: Prisma.StudentWhereInput = {
    classId,
    ...(sectionId ? { sectionId } : {}),
    ...(search ? {
      OR: [
        { name:        { contains: search, mode: 'insensitive' } },
        { admissionNo: { contains: search, mode: 'insensitive' } },
        { parentName:  { contains: search, mode: 'insensitive' } },
      ],
    } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.student.findMany({
      where,
      include:  { class: true, section: true },
      orderBy:  { rollNo: 'asc' },
      skip:     (page - 1) * pageSize,
      take:     pageSize,
    }),
    prisma.student.count({ where }),
  ]);

  return {
    items: items.map(s => ({
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
      parentName:           s.parentName,
      parentPhone:          s.parentPhone,
      parentEmail:          s.parentEmail,
      bloodGroup:           s.bloodGroup,
      address:              s.address,
      status:               s.status,
      attendancePercentage: s.attendancePercentage,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};

// ── GET /teacher/announcements ────────────────────────────────
// Only announcements meant for TEACHER (or everyone, ALL) — never
// PARENT-only announcements.
export const listMyAnnouncements = async (userId: string, query: ListMyAnnouncementsQuerySchema) => {
  const teacher = await getTeacherByUserId(userId);
  const { page, pageSize, search } = query;
  const now = new Date();

  const where: Prisma.AnnouncementWhereInput = {
    schoolId: teacher.schoolId,
    audience: { in: ['ALL', 'TEACHER'] },
    AND: [
      { OR: [{ publishAt: null }, { publishAt: { lte: now } }] },
      { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
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

// ════════════════════════════════════════════════════════════
// Attendance — ONLY for sections this teacher is the Class Teacher
// of (Section.classTeacherId), never just any class they teach a
// subject in. This is a stricter check than listMyClasses/listMyStudents.
// ════════════════════════════════════════════════════════════

const requireClassTeacherOfSection = async (userId: string, sectionId: string) => {
  const teacher = await getTeacherByUserId(userId);
  const section = teacher.sectionsAsTeacher.find(s => s.id === sectionId);
  if (!section) {
    throw forbidden('You are not the Class Teacher of this section', 'NOT_CLASS_TEACHER');
  }
  return { teacher, section };
};

// ── GET /teacher/attendance — section's students + today's/given date's status ─
// Lets the marking UI pre-fill existing statuses before submitting changes.
export const getSectionAttendance = async (userId: string, query: GetSectionAttendanceQuerySchema) => {
  const { section } = await requireClassTeacherOfSection(userId, query.sectionId);
  const date = query.date ? toDateOnly(query.date) : todayDateOnly();

  const students = await prisma.student.findMany({
    where:   { sectionId: section.id },
    include: { attendanceRecords: { where: { date } } },
    orderBy: { rollNo: 'asc' },
  });

  return {
    date:      toDateString(date),
    sectionId: section.id,
    students: students.map(s => ({
      studentId:   s.id,
      name:        s.name,
      admissionNo: s.admissionNo,
      rollNo:      s.rollNo,
      recordId:    s.attendanceRecords[0]?.id ?? null,
      status:      s.attendanceRecords[0]?.status ?? null,
    })),
  };
};

// ── POST /teacher/attendance — bulk mark/update (upsert) for a date ────
// One call handles both "mark today's attendance" and "correct today's
// attendance" — re-submitting the same student+date just overwrites the status.
export const markAttendance = async (userId: string, input: MarkAttendanceSchema) => {
  const { teacher, section } = await requireClassTeacherOfSection(userId, input.sectionId);

  const studentIds = input.records.map(r => r.studentId);
  const validCount = await prisma.student.count({ where: { id: { in: studentIds }, sectionId: section.id } });
  if (validCount !== new Set(studentIds).size) {
    throw notFound('One or more students do not belong to this section', 'STUDENT_NOT_IN_SECTION');
  }

  const date = toDateOnly(input.date);

  await prisma.$transaction(
    input.records.map(r =>
      prisma.attendanceRecord.upsert({
        where:  { studentId_date: { studentId: r.studentId, date } },
        update: { status: r.status, markedBy: userId },
        create: {
          studentId: r.studentId,
          date,
          status:    r.status,
          markedBy:  userId,
          classId:   section.classId,
          sectionId: section.id,
          schoolId:  teacher.schoolId,
        },
      }),
    ),
  );

  return { date: toDateString(date), sectionId: section.id, marked: input.records.length };
};

// ── GET /teacher/attendance/students/:studentId — one student's history ─
export const getStudentAttendanceHistory = async (
  userId: string,
  studentId: string,
  query: StudentAttendanceHistoryQuerySchema,
) => {
  const teacher = await getTeacherByUserId(userId);
  const mySectionIds = new Set(teacher.sectionsAsTeacher.map(s => s.id));

  const student = await prisma.student.findUnique({
    where:   { id: studentId },
    include: { class: true, section: true },
  });
  if (!student || !mySectionIds.has(student.sectionId)) {
    throw forbidden('This student is not in a section you are the Class Teacher of', 'NOT_CLASS_TEACHER');
  }

  const to   = query.to ? toDateOnly(query.to) : todayDateOnly();
  const from = query.from ? toDateOnly(query.from) : daysBefore(to, 29); // default: last 30 days

  const records = await prisma.attendanceRecord.findMany({
    where:   { studentId, date: { gte: from, lte: to } },
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

// ── PATCH /teacher/attendance/:recordId — correct a single record ───────
export const updateAttendanceRecord = async (
  userId: string,
  recordId: string,
  input: UpdateAttendanceRecordSchema,
) => {
  const teacher = await getTeacherByUserId(userId);
  const mySectionIds = new Set(teacher.sectionsAsTeacher.map(s => s.id));

  const record = await prisma.attendanceRecord.findUnique({ where: { id: recordId } });
  if (!record) throw notFound('Attendance record not found', 'RECORD_NOT_FOUND');
  if (!mySectionIds.has(record.sectionId)) {
    throw forbidden('You are not the Class Teacher of this section', 'NOT_CLASS_TEACHER');
  }

  const updated = await prisma.attendanceRecord.update({
    where: { id: recordId },
    data:  { status: input.status, markedBy: userId },
  });

  return {
    id:        updated.id,
    studentId: updated.studentId,
    date:      toDateString(updated.date),
    status:    updated.status,
  };
};

// ════════════════════════════════════════════════════════════
// Homework — created by whichever teacher teaches that subject in
// that class (via TeacherSubject), NOT restricted to the Class
// Teacher (unlike attendance — homework is a subject-teacher's call).
// ════════════════════════════════════════════════════════════

const HOMEWORK_INCLUDE = {
  class:         true,
  section:       true,
  subject:       true,
  createdByUser: true,
};

const toHomeworkResponse = (hw: any) => ({
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
  createdBy:   { id: hw.createdByUser.id, name: hw.createdByUser.name },
  createdAt:   hw.createdAt,
  updatedAt:   hw.updatedAt,
});

// ── POST /teacher/homework ─────────────────────────────────────
export const createHomework = async (userId: string, input: CreateHomeworkSchema) => {
  const teacher = await getTeacherByUserId(userId);

  const teachesThis = teacher.subjects.some(
    ts => ts.classId === input.classId && ts.subjectId === input.subjectId,
  );
  if (!teachesThis) {
    throw forbidden('You do not teach this subject in this class', 'SUBJECT_NOT_ASSIGNED');
  }

  const section = await prisma.section.findFirst({
    where: { id: input.sectionId, classId: input.classId },
  });
  if (!section) throw notFound('Section not found', 'SECTION_NOT_FOUND');

  const homework = await prisma.homework.create({
    data: {
      schoolId:    teacher.schoolId,
      classId:     input.classId,
      sectionId:   input.sectionId,
      subjectId:   input.subjectId,
      title:       input.title,
      description: input.description ?? null,
      type:        input.type,
      dueDate:     input.dueDate,
      createdBy:   userId,
    },
    include: HOMEWORK_INCLUDE,
  });

  return toHomeworkResponse(homework);
};

// ── GET /teacher/homework — homework I created ─────────────────
export const listMyHomework = async (userId: string, query: ListMyHomeworkQuerySchema) => {
  const { page, pageSize, search, classId, sectionId, subjectId } = query;

  const where: Prisma.HomeworkWhereInput = {
    createdBy: userId,
    ...(classId ? { classId } : {}),
    ...(sectionId ? { sectionId } : {}),
    ...(subjectId ? { subjectId } : {}),
    ...(search ? {
      OR: [
        { title:       { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    } : {}),
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
    items: items.map(toHomeworkResponse),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};

// ── Shared ownership check for get/update/delete ────────────────
const requireOwnHomework = async (userId: string, schoolId: string, homeworkId: string) => {
  const homework = await prisma.homework.findFirst({
    where:   { id: homeworkId, schoolId },
    include: HOMEWORK_INCLUDE,
  });
  if (!homework) throw notFound('Homework not found', 'HOMEWORK_NOT_FOUND');
  if (homework.createdBy !== userId) {
    throw forbidden('You did not create this homework', 'NOT_HOMEWORK_OWNER');
  }
  return homework;
};

// ── GET /teacher/homework/:homeworkId ───────────────────────────
export const getHomeworkById = async (userId: string, homeworkId: string) => {
  const teacher  = await getTeacherByUserId(userId);
  const homework = await requireOwnHomework(userId, teacher.schoolId, homeworkId);
  return toHomeworkResponse(homework);
};

// ── PATCH /teacher/homework/:homeworkId ─────────────────────────
export const updateHomework = async (
  userId: string,
  homeworkId: string,
  input: UpdateHomeworkSchema,
) => {
  const teacher = await getTeacherByUserId(userId);
  await requireOwnHomework(userId, teacher.schoolId, homeworkId);

  const homework = await prisma.homework.update({
    where:   { id: homeworkId },
    data:    input,
    include: HOMEWORK_INCLUDE,
  });

  return toHomeworkResponse(homework);
};

// ── DELETE /teacher/homework/:homeworkId ────────────────────────
export const deleteHomework = async (userId: string, homeworkId: string): Promise<void> => {
  const teacher = await getTeacherByUserId(userId);
  await requireOwnHomework(userId, teacher.schoolId, homeworkId);

  await prisma.homework.delete({ where: { id: homeworkId } });
};
