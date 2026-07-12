import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db';
import { changeOwnPassword } from '../../shared/services/account.service';
import {
  UpdateProfileSchema,
  ListMyStudentsQuerySchema,
  ListMyAnnouncementsQuerySchema,
} from './teacher.validation';

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
  user:     true,
  subjects: { include: { subject: true, class: true } },
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
