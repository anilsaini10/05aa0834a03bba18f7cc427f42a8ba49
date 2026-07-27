import { Prisma, Teacher, User, TeacherSubject, Subject, Class, Section } from '@prisma/client';
import { prisma } from '../../../config/db';
import { hashPassword } from '../../../shared/utils/hash';
import { generateDefaultPassword } from '../../../shared/utils/defaultPassword';
import {
  CreateTeacherSchema,
  UpdateTeacherSchema,
  AssignSubjectSchema,
  ListTeachersQuerySchema,
} from './teachers.validation';

type TeacherWithRefs = Teacher & {
  user: User;
  subjects: (TeacherSubject & { subject: Subject; class: Class })[];
  sectionsAsTeacher: (Section & { class: Class })[];
};

export interface TeacherSubjectRef {
  subjectId:   string;
  name:        string;
  classId:     string;
  className:   string;
}

export interface ClassTeacherSectionRef {
  sectionId:   string;
  sectionName: string;
  classId:     string;
  className:   string;
}

export interface TeacherResponse {
  id:               string;
  employeeId:       string;
  name:             string;
  gender:           string;
  email:            string;
  phone:            string | null;
  subjects:         TeacherSubjectRef[];
  classTeacherOf:   ClassTeacherSectionRef[];
  joiningDate:      Date;
  salary:           number;
  qualification:    string;
  experienceYears:  number;
  experienceMonths: number;
  subjectsTaught:   string[];
  status:           string;
  performanceScore: number;
}

const conflict = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 409;
  return err;
};

const notFound = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 404;
  return err;
};

const TEACHER_INCLUDE = {
  user:              true,
  subjects:          { include: { subject: true, class: true } },
  sectionsAsTeacher: { include: { class: true } },
};

const toTeacherResponse = (teacher: TeacherWithRefs): TeacherResponse => ({
  id:               teacher.id,
  employeeId:       teacher.employeeId,
  name:             teacher.user.name,
  gender:           teacher.gender,
  email:            teacher.user.email,
  phone:            teacher.user.phone,
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
});

// ── Create a teacher (user account + Teacher profile, optionally also
//    making them the Class Teacher of one section) ──────────────────
// Subject+class teaching assignments are NOT set here — a freshly
// created teacher has zero TeacherSubject rows; use assignSubject
// below (POST /admin/teachers/:teacherId/subjects) to add them.
export const createTeacher = async (
  schoolId: string,
  input: CreateTeacherSchema,
): Promise<{ teacher: TeacherResponse; defaultPassword: string }> => {

  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) {
    throw conflict('Email already registered', 'EMAIL_TAKEN');
  }

  if (input.classTeacherSectionId) {
    const section = await prisma.section.findFirst({
      where:   { id: input.classTeacherSectionId },
      include: { class: true },
    });
    if (!section || section.class.schoolId !== schoolId) {
      throw notFound('Section not found', 'SECTION_NOT_FOUND');
    }
    if (section.classTeacherId) {
      throw conflict('This section already has a class teacher assigned', 'SECTION_ALREADY_HAS_CLASS_TEACHER');
    }
  }

  const defaultPassword = generateDefaultPassword(input.email);
  const passwordHash    = await hashPassword(defaultPassword);

  const teacher = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name:  input.name,
        email: input.email,
        phone: input.phone,
        passwordHash,
        role:  'TEACHER',
        schoolId,
      },
    });

    const teacherCount = await tx.teacher.count({ where: { schoolId } });
    const employeeId   = `EMP${String(teacherCount + 1).padStart(4, '0')}`;

    const created = await tx.teacher.create({
      data: {
        employeeId,
        userId:           user.id,
        gender:           input.gender,
        joiningDate:      input.joiningDate,
        salary:           input.salary,
        qualification:    input.qualification,
        experienceYears:  input.experienceYears,
        experienceMonths: input.experienceMonths,
        subjectsTaught:   input.subjects,
        schoolId,
      },
    });

    if (input.classTeacherSectionId) {
      // Re-check inside the transaction to close the race window between the
      // pre-check above and this write — only one class teacher per section.
      const section = await tx.section.findUnique({ where: { id: input.classTeacherSectionId } });
      if (section?.classTeacherId) {
        throw conflict('This section already has a class teacher assigned', 'SECTION_ALREADY_HAS_CLASS_TEACHER');
      }
      await tx.section.update({
        where: { id: input.classTeacherSectionId },
        data:  { classTeacherId: created.id },
      });
    }

    return tx.teacher.findUniqueOrThrow({ where: { id: created.id }, include: TEACHER_INCLUDE });
  });

  return { teacher: toTeacherResponse(teacher), defaultPassword };
};

// ── Update a teacher's profile (User + Teacher fields) ──────────────
// Admin can edit any field here — email included (kept separate from
// TEACHER's own self-service updateProfile, which never allows email
// since it's the login identifier there).
export const updateTeacher = async (
  schoolId: string,
  teacherId: string,
  input: UpdateTeacherSchema,
): Promise<TeacherResponse> => {

  const teacher = await prisma.teacher.findFirst({ where: { id: teacherId, schoolId }, include: { user: true } });
  if (!teacher) throw notFound('Teacher not found', 'TEACHER_NOT_FOUND');

  if (input.email && input.email !== teacher.user.email) {
    const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
    if (existingUser) throw conflict('Email already registered', 'EMAIL_TAKEN');
  }

  if (input.classTeacherSectionId) {
    const section = await prisma.section.findFirst({
      where:   { id: input.classTeacherSectionId },
      include: { class: true },
    });
    if (!section || section.class.schoolId !== schoolId) {
      throw notFound('Section not found', 'SECTION_NOT_FOUND');
    }
    if (section.classTeacherId && section.classTeacherId !== teacherId) {
      throw conflict('This section already has a class teacher assigned', 'SECTION_ALREADY_HAS_CLASS_TEACHER');
    }
  }

  const { name, email, phone, classTeacherSectionId, ...teacherFields } = input;

  await prisma.$transaction(async (tx) => {
    if (name !== undefined || email !== undefined || phone !== undefined) {
      await tx.user.update({
        where: { id: teacher.userId },
        data: {
          ...(name  !== undefined ? { name }  : {}),
          ...(email !== undefined ? { email } : {}),
          ...(phone !== undefined ? { phone } : {}),
        },
      });
    }

    if (Object.keys(teacherFields).length > 0) {
      await tx.teacher.update({ where: { id: teacherId }, data: teacherFields });
    }

    if (classTeacherSectionId) {
      // Re-check inside the transaction to close the race window between the
      // pre-check above and this write — only one class teacher per section.
      const section = await tx.section.findUnique({ where: { id: classTeacherSectionId } });
      if (section?.classTeacherId && section.classTeacherId !== teacherId) {
        throw conflict('This section already has a class teacher assigned', 'SECTION_ALREADY_HAS_CLASS_TEACHER');
      }
      await tx.section.update({
        where: { id: classTeacherSectionId },
        data:  { classTeacherId: teacherId },
      });
    }
  });

  const updated = await prisma.teacher.findUniqueOrThrow({ where: { id: teacherId }, include: TEACHER_INCLUDE });
  return toTeacherResponse(updated);
};

// ── Assign an existing teacher to an additional subject+class ──────
// A teacher can teach multiple subjects (across multiple classes) —
// createTeacher only sets up the first one; use this to add more later.
export const assignSubject = async (
  schoolId: string,
  teacherId: string,
  input: AssignSubjectSchema,
): Promise<TeacherResponse> => {

  const teacher = await prisma.teacher.findFirst({ where: { id: teacherId, schoolId } });
  if (!teacher) throw notFound('Teacher not found', 'TEACHER_NOT_FOUND');

  const klass = await prisma.class.findFirst({ where: { id: input.classId, schoolId } });
  if (!klass) throw notFound('Class not found', 'CLASS_NOT_FOUND');

  await prisma.$transaction(async (tx) => {
    const subject = await tx.subject.upsert({
      where:  { schoolId_name: { schoolId, name: input.subject } },
      update: {},
      create: { schoolId, name: input.subject },
    });

    await tx.classSubject.upsert({
      where:  { classId_subjectId: { classId: input.classId, subjectId: subject.id } },
      update: {},
      create: { classId: input.classId, subjectId: subject.id },
    });

    const existing = await tx.teacherSubject.findUnique({
      where: { teacherId_subjectId_classId: { teacherId, subjectId: subject.id, classId: input.classId } },
    });
    if (existing) {
      throw conflict('This teacher is already assigned to this subject in this class', 'SUBJECT_ALREADY_ASSIGNED');
    }

    await tx.teacherSubject.create({
      data: { teacherId, subjectId: subject.id, classId: input.classId },
    });
  });

  const updated = await prisma.teacher.findUniqueOrThrow({ where: { id: teacherId }, include: TEACHER_INCLUDE });
  return toTeacherResponse(updated);
};

// ── Remove a teacher's subject+class assignment ─────────────────────
// Blocked if any ClassSchedule period already uses this exact
// teacher+subject+class combo — admin must reassign/delete those
// periods first, so a schedule entry never silently loses meaning.
export const removeSubjectAssignment = async (
  schoolId: string,
  teacherId: string,
  subjectId: string,
  classId: string,
): Promise<TeacherResponse> => {

  const teacher = await prisma.teacher.findFirst({ where: { id: teacherId, schoolId } });
  if (!teacher) throw notFound('Teacher not found', 'TEACHER_NOT_FOUND');

  const assignment = await prisma.teacherSubject.findUnique({
    where: { teacherId_subjectId_classId: { teacherId, subjectId, classId } },
  });
  if (!assignment) throw notFound('This subject-class assignment was not found for this teacher', 'ASSIGNMENT_NOT_FOUND');

  const inUse = await prisma.classSchedule.count({
    where: { teacherId, subjectId, classId },
  });
  if (inUse > 0) {
    throw conflict(
      'This teacher has scheduled periods for this subject in this class — remove or reassign those periods first',
      'SUBJECT_ASSIGNMENT_IN_USE',
    );
  }

  await prisma.teacherSubject.delete({
    where: { teacherId_subjectId_classId: { teacherId, subjectId, classId } },
  });

  const updated = await prisma.teacher.findUniqueOrThrow({ where: { id: teacherId }, include: TEACHER_INCLUDE });
  return toTeacherResponse(updated);
};

// ── Get a single teacher's details ────────────────────────────────
export const getTeacherById = async (schoolId: string, teacherId: string): Promise<TeacherResponse> => {
  const teacher = await prisma.teacher.findFirst({
    where:   { id: teacherId, schoolId },
    include: TEACHER_INCLUDE,
  });
  if (!teacher) throw notFound('Teacher not found', 'TEACHER_NOT_FOUND');
  return toTeacherResponse(teacher);
};

// ── List teachers (paginated, searchable) ────────────────────────
export const listTeachers = async (schoolId: string, query: ListTeachersQuerySchema) => {
  const { page, pageSize, search, subject, classId } = query;

  const where: Prisma.TeacherWhereInput = {
    schoolId,
    ...(subject ? { subjects: { some: { subject: { name: subject } } } } : {}),
    ...(classId ? { subjects: { some: { classId } } } : {}),
    ...(search ? {
      OR: [
        { employeeId: { contains: search, mode: 'insensitive' } },
        { user: { name:  { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ],
    } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.teacher.findMany({
      where,
      include:  TEACHER_INCLUDE,
      orderBy:  { employeeId: 'asc' },
      skip:     (page - 1) * pageSize,
      take:     pageSize,
    }),
    prisma.teacher.count({ where }),
  ]);

  return {
    items: items.map(toTeacherResponse),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};
