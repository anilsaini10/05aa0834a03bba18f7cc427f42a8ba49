import { Prisma, DayOfWeek } from '@prisma/client';
import { prisma } from '../../config/db';
import { changeOwnPassword } from '../../shared/services/account.service';
import {
  UpdateProfileSchema,
  ListMyStudentsQuerySchema,
  ListMyAnnouncementsQuerySchema,
  ListMyEventsQuerySchema,
  GetSectionAttendanceQuerySchema,
  MarkAttendanceSchema,
  StudentAttendanceHistoryQuerySchema,
  UpdateAttendanceRecordSchema,
  CreateHomeworkSchema,
  UpdateHomeworkSchema,
  ListMyHomeworkQuerySchema,
  ListMyAttendanceRecordsQuerySchema,
  ListLeaveRequestsQuerySchema,
  ReviewLeaveRequestSchema,
  ApplyMyLeaveSchema,
  ListMyLeaveQuerySchema,
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

const conflict = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 409;
  return err;
};

const datesInRange = (from: Date, to: Date): Date[] => {
  const dates: Date[] = [];
  for (let d = from; d <= to; d = daysBefore(d, -1)) dates.push(d);
  return dates;
};

const TEACHER_INCLUDE = {
  user:              true,
  subjects:          { include: { subject: true, class: true } },
  sectionsAsTeacher: { include: { class: true } },
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
    classTeacherOf: teacher.sectionsAsTeacher.map(s => ({
      sectionId:   s.id,
      sectionName: s.name,
      classId:     s.classId,
      className:   s.class.name,
    })),
    joiningDate:      teacher.joiningDate,
    salary:           teacher.salary,
    qualification:    teacher.qualification,
    experienceYears:  teacher.experienceYears,
    experienceMonths: teacher.experienceMonths,
    subjectsTaught:   teacher.subjectsTaught,
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
  const { page, pageSize, search, from, to } = query;
  const now = new Date();

  const where: Prisma.AnnouncementWhereInput = {
    schoolId: teacher.schoolId,
    audience: { in: ['ALL', 'TEACHER'] },
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

// ── GET /teacher/events ────────────────────────────────────────
// Only events meant for TEACHER (or everyone, ALL) — never PARENT-only.
export const listMyEvents = async (userId: string, query: ListMyEventsQuerySchema) => {
  const teacher = await getTeacherByUserId(userId);
  const { page, pageSize, search, eventType, from, to } = query;

  const where: Prisma.EventWhereInput = {
    schoolId: teacher.schoolId,
    audience: { in: ['ALL', 'TEACHER'] },
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

// ════════════════════════════════════════════════════════════
// My Schedule — the logged-in teacher's own periods, wherever they
// teach (any section/class via ClassSchedule.teacherId), never scoped
// by class-teacher-of-section like Attendance is.
// ════════════════════════════════════════════════════════════

const WEEK_DAYS: DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const DAY_BY_JS_INDEX: DayOfWeek[] = [
  'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY',
];

const MY_SCHEDULE_INCLUDE = { class: true, section: true, subject: true };

const toMyScheduleEntry = (s: any) => ({
  id:          s.id,
  day:         s.day,
  type:        s.type,
  periodNo:    s.periodNo,
  classId:     s.classId,
  className:   s.class.name,
  sectionId:   s.sectionId,
  sectionName: s.section.name,
  subjectId:   s.subjectId,
  subjectName: s.subject?.name ?? null,
  roomNo:      s.roomNo,
  title:       s.title,
  startTime:   s.startTime,
  endTime:     s.endTime,
});

// ── GET /teacher/dashboard ───────────────────────────────────────
// attendance[] covers only sections this teacher is Class Teacher of
// (same scope as the attendance-marking endpoints below) — a teacher
// who just teaches a subject period, without being homeroom in-charge,
// never marks attendance for that section, so it's excluded here too.
export const getDashboardStats = async (userId: string) => {
  const teacher = await getTeacherByUserId(userId);
  const day  = DAY_BY_JS_INDEX[new Date().getDay()];
  const date = todayDateOnly();

  const todayClassesCount = await prisma.classSchedule.count({
    where: { teacherId: teacher.id, day },
  });

  const attendance = await Promise.all(teacher.sectionsAsTeacher.map(async (section) => {
    const [totalStudents, markedCount] = await Promise.all([
      prisma.student.count({ where: { sectionId: section.id, status: 'ACTIVE' } }),
      prisma.attendanceRecord.count({ where: { sectionId: section.id, date } }),
    ]);
    return {
      sectionId:   section.id,
      sectionName: section.name,
      classId:     section.classId,
      className:   section.class.name,
      totalStudents,
      markedCount,
      isMarked:    totalStudents > 0 && markedCount >= totalStudents,
    };
  }));

  return { date: toDateString(date), todayClassesCount, attendance };
};

// ── GET /teacher/schedule/today ─────────────────────────────────
export const getTodaySchedule = async (userId: string) => {
  const teacher = await getTeacherByUserId(userId);
  const day = DAY_BY_JS_INDEX[new Date().getDay()];

  const entries = await prisma.classSchedule.findMany({
    where:   { teacherId: teacher.id, day },
    include: MY_SCHEDULE_INCLUDE,
    orderBy: { periodNo: 'asc' },
  });

  return {
    day,
    date:    toDateString(new Date()),
    periods: entries.map(toMyScheduleEntry),
  };
};

// ── GET /teacher/schedule/week — Monday to Saturday, grouped by day ──
export const getWeekSchedule = async (userId: string) => {
  const teacher = await getTeacherByUserId(userId);

  const entries = await prisma.classSchedule.findMany({
    where:   { teacherId: teacher.id, day: { in: WEEK_DAYS } },
    include: MY_SCHEDULE_INCLUDE,
    orderBy: { periodNo: 'asc' },
  });

  const timetable: Record<string, ReturnType<typeof toMyScheduleEntry>[]> = {};
  for (const d of WEEK_DAYS) timetable[d] = [];
  for (const e of entries) timetable[e.day].push(toMyScheduleEntry(e));

  return { teacherId: teacher.id, timetable };
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

// ════════════════════════════════════════════════════════════
// My own attendance — read-only. Admin marks/corrects staff
// attendance (src/features/admin/teacherAttendance); a teacher can
// only view their own history here, never anyone else's.
// ════════════════════════════════════════════════════════════

// ── GET /teacher/my-attendance ────────────────────────────────────
export const listMyAttendanceRecords = async (userId: string, query: ListMyAttendanceRecordsQuerySchema) => {
  const teacher = await getTeacherByUserId(userId);
  const { page, pageSize, date, from, to, status } = query;

  const dateFilter = date
    ? toDateOnly(date)
    : (from || to)
      ? {
          ...(from ? { gte: toDateOnly(from) } : {}),
          ...(to   ? { lte: toDateOnly(to) }   : {}),
        }
      : undefined;

  const where: Prisma.TeacherAttendanceRecordWhereInput = {
    teacherId: teacher.id,
    ...(status ? { status } : {}),
    ...(dateFilter ? { date: dateFilter } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.teacherAttendanceRecord.findMany({
      where,
      include: { markedByUser: true },
      orderBy: { date: 'desc' },
      skip:    (page - 1) * pageSize,
      take:    pageSize,
    }),
    prisma.teacherAttendanceRecord.count({ where }),
  ]);

  return {
    items: items.map(r => ({
      id:        r.id,
      date:      toDateString(r.date),
      status:    r.status,
      markedBy:  { id: r.markedByUser.id, name: r.markedByUser.name },
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};

// ════════════════════════════════════════════════════════════
// Leave requests — review only (applying is a parent action, in
// src/features/students). Scoped to sections this teacher is the
// Class Teacher of, same restriction as Attendance marking.
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

// ── GET /teacher/leave — requests for sections I'm Class Teacher of ─
export const listLeaveRequests = async (userId: string, query: ListLeaveRequestsQuerySchema) => {
  const teacher = await getTeacherByUserId(userId);
  const mySectionIds = teacher.sectionsAsTeacher.map(s => s.id);

  const leaves = await prisma.leaveRequest.findMany({
    where:   { sectionId: { in: mySectionIds }, ...(query.status ? { status: query.status } : {}) },
    include: LEAVE_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });

  return leaves.map(toLeaveResponse);
};

// ── PATCH /teacher/leave/:leaveId — approve/reject ───────────────
// Approving auto-marks AttendanceRecord as LEAVE for every date in
// [fromDate, toDate], overwriting whatever was there before — the
// same "correction" semantics markAttendance already uses.
export const reviewLeaveRequest = async (
  userId: string,
  leaveId: string,
  input: ReviewLeaveRequestSchema,
) => {
  const teacher = await getTeacherByUserId(userId);
  const mySectionIds = new Set(teacher.sectionsAsTeacher.map(s => s.id));

  const leave = await prisma.leaveRequest.findUnique({ where: { id: leaveId } });
  if (!leave) throw notFound('Leave request not found', 'LEAVE_NOT_FOUND');
  if (!mySectionIds.has(leave.sectionId)) {
    throw forbidden('You are not the Class Teacher of this section', 'NOT_CLASS_TEACHER');
  }
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

  return toLeaveResponse(updated);
};

// ════════════════════════════════════════════════════════════
// My own leave — a teacher applying for their own time off. Only
// Admin reviews this (no "class teacher of the teacher" concept),
// and there's no attendance record to auto-mark since staff
// attendance isn't tracked in this system.
// ════════════════════════════════════════════════════════════

const MY_LEAVE_INCLUDE = { reviewedByUser: true };

const toMyLeaveResponse = (l: any) => ({
  id:            l.id,
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

// ── POST /teacher/my-leave ───────────────────────────────────────
export const applyMyLeave = async (userId: string, input: ApplyMyLeaveSchema) => {
  const teacher = await getTeacherByUserId(userId);

  const leave = await prisma.teacherLeaveRequest.create({
    data: {
      schoolId:  teacher.schoolId,
      teacherId: teacher.id,
      fromDate:  toDateOnly(input.fromDate),
      toDate:    toDateOnly(input.toDate),
      reason:    input.reason,
    },
    include: MY_LEAVE_INCLUDE,
  });

  return toMyLeaveResponse(leave);
};

// ── GET /teacher/my-leave ─────────────────────────────────────────
export const listMyLeaveHistory = async (userId: string, query: ListMyLeaveQuerySchema) => {
  const teacher = await getTeacherByUserId(userId);

  const leaves = await prisma.teacherLeaveRequest.findMany({
    where:   { teacherId: teacher.id, ...(query.status ? { status: query.status } : {}) },
    include: MY_LEAVE_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });

  return leaves.map(toMyLeaveResponse);
};

// ── DELETE /teacher/my-leave/:leaveId — cancel while still PENDING ──
export const cancelMyLeave = async (userId: string, leaveId: string): Promise<void> => {
  const teacher = await getTeacherByUserId(userId);

  const leave = await prisma.teacherLeaveRequest.findFirst({ where: { id: leaveId, teacherId: teacher.id } });
  if (!leave) throw notFound('Leave request not found', 'LEAVE_NOT_FOUND');
  if (leave.status !== 'PENDING') {
    throw conflict('Only pending leave requests can be cancelled', 'LEAVE_ALREADY_REVIEWED');
  }

  await prisma.teacherLeaveRequest.delete({ where: { id: leaveId } });
};
