import { Prisma, DayOfWeek } from '@prisma/client';
import { prisma } from '../../config/db';
import { changeOwnPassword } from '../../shared/services/account.service';
import { RECORD_STATUS, SCHOOL_TIMEZONE } from '../../constants';
import { computeHomeworkStatus } from '../../shared/utils/homeworkStatus';
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
  MarkHomeworkSubmissionsSchema,
  ListMyHomeworkQuerySchema,
  ListMyAttendanceRecordsQuerySchema,
  ListLeaveRequestsQuerySchema,
  ReviewLeaveRequestSchema,
  ApplyMyLeaveSchema,
  ListMyLeaveQuerySchema,
  ListMyExamPapersQuerySchema,
  ListPaperStudentsQuerySchema,
  SaveExamMarksSchema,
  CheckInSchema,
  CheckOutSchema,
} from './teacher.validation';
import {
  PAPER_INCLUDE,
  toPaperResponse,
  listPaperStudents,
  saveExamMarks,
} from '../../shared/services/examPaper.service';
import {
  TEACHER_ATTENDANCE_RECORD_INCLUDE,
  toTeacherAttendanceResponse,
} from '../../shared/utils/teacherAttendance';

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

const badRequest = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 400;
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
    username:         teacher.user.username,
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
      prisma.student.count({ where: { sectionId: section.id, status: RECORD_STATUS.ACTIVE } }),
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
// Sorted by startTime, not periodNo — periodNo is only a valid ordering
// *within one section*, and a teacher's day here spans multiple different
// sections/classes, each with their own independent periodNo numbering.
// Sorting by periodNo would interleave them in a meaningless order (e.g.
// another section's "period 1" at 09:00 could sort before this one's
// "period 2" at 08:00). Real clock time is the only thing comparable
// across sections.
export const getTodaySchedule = async (userId: string) => {
  const teacher = await getTeacherByUserId(userId);
  const day = DAY_BY_JS_INDEX[new Date().getDay()];

  const entries = await prisma.classSchedule.findMany({
    where:   { teacherId: teacher.id, day },
    include: MY_SCHEDULE_INCLUDE,
    orderBy: { startTime: 'asc' },
  });

  return {
    day,
    date:    toDateString(new Date()),
    periods: entries.map(toMyScheduleEntry),
  };
};

// ── GET /teacher/schedule/week — Monday to Saturday, grouped by day ──
// Same reasoning as getTodaySchedule above — sort by startTime, not
// periodNo, since this also spans multiple sections per day.
export const getWeekSchedule = async (userId: string) => {
  const teacher = await getTeacherByUserId(userId);

  const entries = await prisma.classSchedule.findMany({
    where:   { teacherId: teacher.id, day: { in: WEEK_DAYS } },
    include: MY_SCHEDULE_INCLUDE,
    orderBy: { startTime: 'asc' },
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
  fromDate:    hw.fromDate,
  dueDate:     hw.dueDate,
  status:      computeHomeworkStatus(hw.fromDate, hw.status),
  isActive:    hw.isActive,
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
      fromDate:    input.fromDate ?? null,
      dueDate:     input.dueDate,
      createdBy:   userId,
    },
    include: HOMEWORK_INCLUDE,
  });

  return toHomeworkResponse(homework);
};

// ── GET /teacher/homework — homework I created ─────────────────
// includeInactive omitted/false -> only non-deleted homework, so a
// soft-deleted one stays out of the default list.
export const listMyHomework = async (userId: string, query: ListMyHomeworkQuerySchema) => {
  const { page, pageSize, search, classId, sectionId, subjectId, includeInactive } = query;

  const where: Prisma.HomeworkWhereInput = {
    createdBy: userId,
    ...(includeInactive ? {} : { isActive: true }),
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
  const teacher  = await getTeacherByUserId(userId);
  const existing = await requireOwnHomework(userId, teacher.schoolId, homeworkId);

  // Cross-check the merged (existing + incoming) date range — zod can only
  // validate fields present in this single request, not against the DB row.
  const fromDate = input.fromDate !== undefined ? input.fromDate : existing.fromDate;
  const dueDate  = input.dueDate  !== undefined ? input.dueDate  : existing.dueDate;
  if (fromDate && dueDate < fromDate) {
    throw badRequest('dueDate must be on or after fromDate', 'INVALID_DATE_RANGE');
  }

  const homework = await prisma.homework.update({
    where:   { id: homeworkId },
    data:    input,
    include: HOMEWORK_INCLUDE,
  });

  return toHomeworkResponse(homework);
};

// ── DELETE /teacher/homework/:homeworkId — soft delete ──────────────
// Never a hard delete — a homework already has HomeworkSubmission rows
// (per-student tracking), so removing it would wreck that history.
// Marking isActive: false drops it out of the default list; GET-by-id
// still resolves it (a teacher can still view/restore their own deleted
// homework), same as the student/teacher soft-delete pattern.
export const deleteHomework = async (userId: string, homeworkId: string) => {
  const teacher = await getTeacherByUserId(userId);
  await requireOwnHomework(userId, teacher.schoolId, homeworkId);

  const homework = await prisma.homework.update({
    where:   { id: homeworkId },
    data:    { isActive: false },
    include: HOMEWORK_INCLUDE,
  });

  return toHomeworkResponse(homework);
};

// ── GET /teacher/homework/:homeworkId/students ──────────────────
// Every student in this homework's section, with their submission
// status. Two queries total regardless of section size (students +
// submissions), merged in memory — no N+1. A student with no
// HomeworkSubmission row yet is "not checked" (status: null), not the
// same as an explicit NOT_SUBMITTED.
export const getHomeworkStudents = async (userId: string, homeworkId: string) => {
  const teacher  = await getTeacherByUserId(userId);
  const homework = await requireOwnHomework(userId, teacher.schoolId, homeworkId);

  const [students, submissions] = await Promise.all([
    prisma.student.findMany({
      where:   { sectionId: homework.sectionId },
      orderBy: { rollNo: 'asc' },
    }),
    prisma.homeworkSubmission.findMany({ where: { homeworkId } }),
  ]);

  const submissionByStudentId = new Map(submissions.map(s => [s.studentId, s]));

  return {
    homeworkId,
    title:       homework.title,
    dueDate:     homework.dueDate,
    sectionId:   homework.sectionId,
    sectionName: homework.section.name,
    students: students.map(s => {
      const submission = submissionByStudentId.get(s.id);
      return {
        studentId:   s.id,
        name:        s.name,
        admissionNo: s.admissionNo,
        rollNo:      s.rollNo,
        status:      submission?.status  ?? null,
        remarks:     submission?.remarks ?? null,
        updatedAt:   submission?.updatedAt ?? null,
      };
    }),
  };
};

// ── PATCH /teacher/homework/:homeworkId/students — bulk mark/update ────
// Same shape as markAttendance: one validation query for all student ids,
// one transaction of upserts. Re-marking a student just overwrites their
// existing status/remarks.
export const markHomeworkSubmissions = async (
  userId: string,
  homeworkId: string,
  input: MarkHomeworkSubmissionsSchema,
) => {
  const teacher  = await getTeacherByUserId(userId);
  const homework = await requireOwnHomework(userId, teacher.schoolId, homeworkId);

  const studentIds = input.records.map(r => r.studentId);
  const validCount = await prisma.student.count({
    where: { id: { in: studentIds }, sectionId: homework.sectionId },
  });
  if (validCount !== new Set(studentIds).size) {
    throw notFound('One or more students do not belong to this homework\'s section', 'STUDENT_NOT_IN_SECTION');
  }

  await prisma.$transaction(
    input.records.map(r =>
      prisma.homeworkSubmission.upsert({
        where: { homeworkId_studentId: { homeworkId, studentId: r.studentId } },
        update: { status: r.status, remarks: r.remarks ?? null, markedBy: userId },
        create: {
          homeworkId,
          studentId: r.studentId,
          status:    r.status,
          remarks:   r.remarks ?? null,
          markedBy:  userId,
        },
      }),
    ),
  );

  return { homeworkId, marked: input.records.length };
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
      include: TEACHER_ATTENDANCE_RECORD_INCLUDE,
      orderBy: { date: 'desc' },
      skip:    (page - 1) * pageSize,
      take:    pageSize,
    }),
    prisma.teacherAttendanceRecord.count({ where }),
  ]);

  return {
    items: items.map(toTeacherAttendanceResponse),
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

// ════════════════════════════════════════════════════════════
// Exams — a paper (class + subject) is graded section by section, by the
// teacher who teaches that subject in that section:
//   • the section has timetable periods for the subject (ClassSchedule)
//     → only the teacher(s) of those periods;
//   • no periods for it yet → teachers assigned the subject for the class
//     (TeacherSubject) — a fallback so schools without a timetable can
//     still grade.
// A teacher also sees papers they invigilate (view-only).
// ════════════════════════════════════════════════════════════

type TeacherWithRefs = Awaited<ReturnType<typeof getTeacherByUserId>>;
type ClassSubjectPair = { classId: string; subjectId: string };

const pairKey = (p: ClassSubjectPair) => `${p.classId}:${p.subjectId}`;

// Sections this teacher may grade, for many class+subject pairs at once.
const getGradableSections = async (teacher: TeacherWithRefs, pairs: ClassSubjectPair[]) => {
  const gradable = new Map<string, { id: string; name: string }[]>();
  if (pairs.length === 0) return gradable;

  const classIds   = [...new Set(pairs.map(p => p.classId))];
  const subjectIds = [...new Set(pairs.map(p => p.subjectId))];

  const [sections, periods] = await Promise.all([
    prisma.section.findMany({
      where:   { classId: { in: classIds } },
      select:  { id: true, name: true, classId: true },
      orderBy: { name: 'asc' },
    }),
    prisma.classSchedule.findMany({
      where:  { classId: { in: classIds }, subjectId: { in: subjectIds }, type: 'CLASS_PERIOD', teacherId: { not: null } },
      select: { sectionId: true, subjectId: true, teacherId: true },
    }),
  ]);

  for (const pair of pairs) {
    const assignedForClass = teacher.subjects.some(
      ts => ts.classId === pair.classId && ts.subjectId === pair.subjectId,
    );
    const mine = sections
      .filter(sec => sec.classId === pair.classId)
      .filter(sec => {
        const sectionTeachers = new Set(
          periods.filter(p => p.sectionId === sec.id && p.subjectId === pair.subjectId).map(p => p.teacherId),
        );
        return sectionTeachers.size > 0 ? sectionTeachers.has(teacher.id) : assignedForClass;
      });
    gradable.set(pairKey(pair), mine.map(sec => ({ id: sec.id, name: sec.name })));
  }

  return gradable;
};

// ── GET /teacher/exams — grouped by exam, papers in date/time order ─
export const listMyExamPapers = async (userId: string, query: ListMyExamPapersQuerySchema) => {
  const teacher = await getTeacherByUserId(userId);

  // Every class+subject this teacher is linked to, via assignment or timetable.
  const myPeriods = await prisma.classSchedule.findMany({
    where:    { teacherId: teacher.id, type: 'CLASS_PERIOD', subjectId: { not: null } },
    select:   { classId: true, subjectId: true },
    distinct: ['classId', 'subjectId'],
  });
  const linkedPairs = new Map<string, ClassSubjectPair>();
  for (const p of [...teacher.subjects, ...myPeriods] as ClassSubjectPair[]) {
    linkedPairs.set(pairKey(p), { classId: p.classId, subjectId: p.subjectId });
  }

  const candidates = await prisma.examSchedule.findMany({
    where: {
      schoolId: teacher.schoolId,
      ...(query.examId ? { examId: query.examId } : {}),
      OR: [...linkedPairs.values(), { invigilatorId: teacher.id }],
    },
    include: PAPER_INCLUDE,
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  });

  const gradable = await getGradableSections(teacher, candidates);
  const papers   = candidates.filter(
    p => (gradable.get(pairKey(p))?.length ?? 0) > 0 || p.invigilatorId === teacher.id,
  );

  const [sectionCounts, marked] = await Promise.all([
    prisma.student.groupBy({
      by:     ['classId', 'sectionId'],
      where:  { classId: { in: [...new Set(papers.map(p => p.classId))] }, status: RECORD_STATUS.ACTIVE },
      _count: { _all: true },
    }),
    prisma.examMark.findMany({
      where:  { examScheduleId: { in: papers.map(p => p.id) }, status: { not: 'PENDING' } },
      select: { examScheduleId: true, student: { select: { sectionId: true, classId: true } } },
    }),
  ]);
  const studentsInSection = new Map(sectionCounts.map(c => [c.sectionId, c._count._all]));
  const studentsInClass   = (classId: string) =>
    sectionCounts.filter(c => c.classId === classId).reduce((sum, c) => sum + c._count._all, 0);

  const exams = new Map<string, {
    examId: string; title: string; startDate: string | null; endDate: string | null; papers: any[];
  }>();
  for (const p of papers) {
    if (!exams.has(p.examId)) {
      exams.set(p.examId, {
        examId:    p.examId,
        title:     p.exam.title,
        startDate: p.exam.startDate ? toDateString(p.exam.startDate) : null,
        endDate:   p.exam.endDate   ? toDateString(p.exam.endDate)   : null,
        papers:    [],
      });
    }

    const mySections    = gradable.get(pairKey(p)) ?? [];
    const canEnterMarks = mySections.length > 0;
    // Counts cover the teacher's own sections; an invigilator-only paper
    // counts the whole class.
    const inScope = (sectionId: string) => !canEnterMarks || mySections.some(s => s.id === sectionId);

    exams.get(p.examId)!.papers.push({
      ...toPaperResponse(p),
      canEnterMarks,
      isInvigilator: p.invigilatorId === teacher.id,
      mySections,
      studentCount: canEnterMarks
        ? mySections.reduce((sum, s) => sum + (studentsInSection.get(s.id) ?? 0), 0)
        : studentsInClass(p.classId),
      markedCount: marked.filter(
        m => m.examScheduleId === p.id && m.student.classId === p.classId && inScope(m.student.sectionId),
      ).length,
    });
  }

  return [...exams.values()];
};

// Returns the paper plus the sections this teacher may see/grade.
// allowedSectionIds is undefined only for an invigilator-only view (whole
// class, read-only).
const requireMyExamPaper = async (userId: string, scheduleId: string, forMarks: boolean) => {
  const teacher = await getTeacherByUserId(userId);

  const paper = await prisma.examSchedule.findFirst({
    where:   { id: scheduleId, schoolId: teacher.schoolId },
    include: PAPER_INCLUDE,
  });
  if (!paper) throw notFound('Exam paper not found', 'EXAM_SCHEDULE_NOT_FOUND');

  const mySections = (await getGradableSections(teacher, [paper])).get(pairKey(paper)) ?? [];
  if (mySections.length > 0) {
    return { paper, allowedSectionIds: mySections.map(s => s.id) };
  }
  if (!forMarks && paper.invigilatorId === teacher.id) {
    return { paper, allowedSectionIds: undefined };
  }

  throw forbidden(
    `You do not teach ${paper.subject.name} in ${paper.class.name}`,
    'SUBJECT_NOT_ASSIGNED',
  );
};

// ── GET /teacher/exams/schedule/:scheduleId/students ────────────
export const getExamPaperStudents = async (
  userId: string, scheduleId: string, query: ListPaperStudentsQuerySchema,
) => {
  const { paper, allowedSectionIds } = await requireMyExamPaper(userId, scheduleId, false);
  return listPaperStudents(paper, query, allowedSectionIds);
};

// ── PUT /teacher/exams/schedule/:scheduleId/marks ───────────────
export const saveExamPaperMarks = async (
  userId: string, scheduleId: string, input: SaveExamMarksSchema,
) => {
  const { paper, allowedSectionIds } = await requireMyExamPaper(userId, scheduleId, true);
  return saveExamMarks(paper, userId, input, allowedSectionIds);
};

// ════════════════════════════════════════════════════════════
// Self check-in — a teacher marks their OWN status (teacherStatus =
// PRESENT) for today, the school's local day (not the server's UTC day).
// It's stored separately from the admin's marking (adminStatus), so
// neither overwrites the other; the final status is adminStatus when the
// admin has marked the day, otherwise teacherStatus. One check-in per day;
// blocked on approved leave or a day the admin marked LEAVE/HOLIDAY.
// ════════════════════════════════════════════════════════════

const schoolTodayString = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHOOL_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

const formatSchoolTime = (d: Date): string =>
  d.toLocaleTimeString('en-IN', { timeZone: SCHOOL_TIMEZONE, hour: '2-digit', minute: '2-digit' });

const loadTodayCheckIn = async (userId: string) => {
  const teacher = await getTeacherByUserId(userId);
  const dateStr = schoolTodayString();
  const date    = new Date(`${dateStr}T00:00:00.000Z`);

  const [record, leave] = await Promise.all([
    prisma.teacherAttendanceRecord.findUnique({
      where:   { teacherId_date: { teacherId: teacher.id, date } },
      include: TEACHER_ATTENDANCE_RECORD_INCLUDE,
    }),
    prisma.teacherLeaveRequest.findFirst({
      where: { teacherId: teacher.id, status: 'APPROVED', fromDate: { lte: date }, toDate: { gte: date } },
    }),
  ]);

  // Why the teacher can't check in right now (null = they can).
  let blocker: { code: string; message: string; statusCode: number } | null = null;
  if (teacher.status !== RECORD_STATUS.ACTIVE || !teacher.user.isActive) {
    blocker = { code: 'TEACHER_INACTIVE', message: 'Your account is inactive — contact your school admin', statusCode: 403 };
  } else if (record?.teacherStatus) {
    blocker = {
      code:       'ALREADY_CHECKED_IN',
      message:    `You have already checked in today${record.teacherMarkedAt ? ` at ${formatSchoolTime(record.teacherMarkedAt)}` : ''}`,
      statusCode: 409,
    };
  } else if (leave || record?.adminStatus === 'LEAVE') {
    blocker = { code: 'ON_LEAVE_TODAY', message: 'You are on leave today', statusCode: 409 };
  } else if (record?.adminStatus === 'HOLIDAY') {
    blocker = { code: 'HOLIDAY_TODAY', message: 'Today is marked as a holiday', statusCode: 409 };
  }

  // Why the teacher can't check out right now (null = they can).
  let checkOutBlocker: { code: string; message: string; statusCode: number } | null = null;
  if (teacher.status !== RECORD_STATUS.ACTIVE || !teacher.user.isActive) {
    checkOutBlocker = { code: 'TEACHER_INACTIVE', message: 'Your account is inactive — contact your school admin', statusCode: 403 };
  } else if (!record?.teacherStatus) {
    checkOutBlocker = { code: 'NOT_CHECKED_IN', message: 'Check in first — you have not checked in today', statusCode: 409 };
  } else if (record.teacherCheckOutAt) {
    checkOutBlocker = {
      code:       'ALREADY_CHECKED_OUT',
      message:    `You have already checked out today at ${formatSchoolTime(record.teacherCheckOutAt)}`,
      statusCode: 409,
    };
  }

  return { teacher, dateStr, date, record, blocker, checkOutBlocker };
};

// ── GET /teacher/my-attendance/today — drives the "Mark attendance" button ─
export const getMyAttendanceToday = async (userId: string) => {
  const { dateStr, record, blocker, checkOutBlocker } = await loadTodayCheckIn(userId);

  return {
    date:            dateStr,
    teacherStatus:   record?.teacherStatus ?? null,
    teacherMarkedAt: record?.teacherMarkedAt ?? null,
    teacherLatitude:  record?.teacherLatitude ?? null,
    teacherLongitude: record?.teacherLongitude ?? null,
    adminStatus:     record?.adminStatus ?? null,
    status:          record?.status ?? null,   // final for the day
    teacherCheckOutAt: record?.teacherCheckOutAt ?? null,
    checkedIn:       !!record?.teacherStatus,
    canCheckIn:      !blocker,
    reason:          blocker ? { code: blocker.code, message: blocker.message } : null,
    checkedOut:      !!record?.teacherCheckOutAt,
    canCheckOut:     !checkOutBlocker,
    checkOutReason:  checkOutBlocker ? { code: checkOutBlocker.code, message: checkOutBlocker.message } : null,
    record:          record ? toTeacherAttendanceResponse(record) : null,
  };
};

// ── POST /teacher/my-attendance/check-in ─────────────────────────
export const checkInMyAttendance = async (userId: string, input: CheckInSchema) => {
  const { teacher, date, record, blocker } = await loadTodayCheckIn(userId);

  const alreadyCheckedIn = async () => {
    const latest = await prisma.teacherAttendanceRecord.findUnique({
      where:   { teacherId_date: { teacherId: teacher.id, date } },
      include: TEACHER_ATTENDANCE_RECORD_INCLUDE,
    });
    const err = new Error('You have already checked in today') as any;
    err.code       = 'ALREADY_CHECKED_IN';
    err.statusCode = 409;
    if (latest) err.details = { record: toTeacherAttendanceResponse(latest) };
    return err;
  };

  if (blocker) {
    const err = new Error(blocker.message) as any;
    err.code       = blocker.code;
    err.statusCode = blocker.statusCode;
    if (record) err.details = { record: toTeacherAttendanceResponse(record) };
    throw err;
  }

  const now      = new Date();
  const location = { teacherLatitude: input.latitude ?? null, teacherLongitude: input.longitude ?? null };

  // No row yet → create it; the teacher's status is also the final one.
  if (!record) {
    try {
      const created = await prisma.teacherAttendanceRecord.create({
        data: {
          schoolId: teacher.schoolId, teacherId: teacher.id, date,
          teacherStatus: 'PRESENT', teacherMarkedAt: now, ...location, status: 'PRESENT',
        },
        include: TEACHER_ATTENDANCE_RECORD_INCLUDE,
      });
      return toTeacherAttendanceResponse(created);
    } catch (err: any) {
      // Another request created the row first — fall through to the update.
      if (err?.code !== 'P2002') throw err;
    }
  }

  // Row exists (admin already marked the day) → add the teacher's own status
  // only; the admin's status stays the final one. The teacherStatus: null
  // condition makes a double tap / second device a no-op.
  const updated = await prisma.teacherAttendanceRecord.updateMany({
    where: { teacherId: teacher.id, date, teacherStatus: null },
    data:  { teacherStatus: 'PRESENT', teacherMarkedAt: now, ...location },
  });
  if (updated.count === 0) throw await alreadyCheckedIn();

  const fresh = await prisma.teacherAttendanceRecord.findUniqueOrThrow({
    where:   { teacherId_date: { teacherId: teacher.id, date } },
    include: TEACHER_ATTENDANCE_RECORD_INCLUDE,
  });
  return toTeacherAttendanceResponse(fresh);
};

// ── POST /teacher/my-attendance/check-out ────────────────────────
// Only after today's check-in, and only once. Records the time (and
// optional location); never changes the day's status.
export const checkOutMyAttendance = async (userId: string, input: CheckOutSchema) => {
  const { teacher, date, record, checkOutBlocker } = await loadTodayCheckIn(userId);

  if (checkOutBlocker) {
    const err = new Error(checkOutBlocker.message) as any;
    err.code       = checkOutBlocker.code;
    err.statusCode = checkOutBlocker.statusCode;
    if (record) err.details = { record: toTeacherAttendanceResponse(record) };
    throw err;
  }

  // teacherCheckOutAt: null makes a double tap / second device a no-op.
  const updated = await prisma.teacherAttendanceRecord.updateMany({
    where: { teacherId: teacher.id, date, teacherStatus: { not: null }, teacherCheckOutAt: null },
    data:  {
      teacherCheckOutAt:        new Date(),
      teacherCheckOutLatitude:  input.latitude ?? null,
      teacherCheckOutLongitude: input.longitude ?? null,
    },
  });

  const fresh = await prisma.teacherAttendanceRecord.findUniqueOrThrow({
    where:   { teacherId_date: { teacherId: teacher.id, date } },
    include: TEACHER_ATTENDANCE_RECORD_INCLUDE,
  });

  if (updated.count === 0) {
    const err = new Error('You have already checked out today') as any;
    err.code       = 'ALREADY_CHECKED_OUT';
    err.statusCode = 409;
    err.details    = { record: toTeacherAttendanceResponse(fresh) };
    throw err;
  }

  return toTeacherAttendanceResponse(fresh);
};
