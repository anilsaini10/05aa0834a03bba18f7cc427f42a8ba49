import { Prisma, Teacher, User, TeacherSubject, Subject, Class } from '@prisma/client';
import { prisma } from '../../../config/db';
import { hashPassword } from '../../../shared/utils/hash';
import { generateDefaultPassword } from '../../../shared/utils/defaultPassword';
import { CreateTeacherSchema, ListTeachersQuerySchema } from './teachers.validation';

type TeacherWithRefs = Teacher & {
  user: User;
  subjects: (TeacherSubject & { subject: Subject; class: Class })[];
};

export interface TeacherSubjectRef {
  subjectId:   string;
  name:        string;
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
  joiningDate:      Date;
  salary:           number;
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
  user:     true,
  subjects: { include: { subject: true, class: true } },
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
  joiningDate:      teacher.joiningDate,
  salary:           teacher.salary,
  status:           teacher.status,
  performanceScore: teacher.performanceScore,
});

// ── Create a teacher (user account + Teacher profile + subject-in-class link) ─
export const createTeacher = async (
  schoolId: string,
  input: CreateTeacherSchema,
): Promise<{ teacher: TeacherResponse; defaultPassword: string }> => {

  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) {
    throw conflict('Email already registered', 'EMAIL_TAKEN');
  }

  const klass = await prisma.class.findFirst({ where: { id: input.classId, schoolId } });
  if (!klass) throw notFound('Class not found', 'CLASS_NOT_FOUND');

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

    const subject = await tx.subject.upsert({
      where:  { schoolId_name: { schoolId, name: input.subject } },
      update: {},
      create: { schoolId, name: input.subject },
    });

    // Ensure this subject is part of the class's curriculum.
    await tx.classSubject.upsert({
      where:  { classId_subjectId: { classId: input.classId, subjectId: subject.id } },
      update: {},
      create: { classId: input.classId, subjectId: subject.id },
    });

    const teacherCount = await tx.teacher.count({ where: { schoolId } });
    const employeeId   = `EMP${String(teacherCount + 1).padStart(4, '0')}`;

    return tx.teacher.create({
      data: {
        employeeId,
        userId:      user.id,
        gender:      input.gender,
        joiningDate: input.joiningDate,
        salary:      input.salary,
        schoolId,
        subjects: { create: { subjectId: subject.id, classId: input.classId } },
      },
      include: TEACHER_INCLUDE,
    });
  });

  return { teacher: toTeacherResponse(teacher), defaultPassword };
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
