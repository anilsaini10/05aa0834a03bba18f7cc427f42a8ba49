import { Prisma, Student, Class, Section } from '@prisma/client';
import { prisma } from '../../config/db';
import { hashPassword } from '../../shared/utils/hash';
import { generateDefaultPassword } from '../../shared/utils/defaultPassword';
import { CreateStudentSchema, ListStudentsQuerySchema } from './students.validation';

type StudentWithRefs = Student & { class: Class; section: Section };

export interface StudentResponse {
  id:                   string;
  admissionNo:          string;
  name:                 string;
  gender:               string;
  dateOfBirth:          Date;
  classId:              string;
  className:            string;
  sectionId:            string;
  sectionName:          string;
  rollNo:               number;
  parentName:           string;
  parentPhone:          string;
  parentEmail:          string;
  bloodGroup:           string | null;
  address:              string | null;
  status:               string;
  attendancePercentage: number;
}

interface ParentAccount {
  isNew:           boolean;
  email:           string;
  defaultPassword?: string;
}

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

const toStudentResponse = (student: StudentWithRefs): StudentResponse => ({
  id:                   student.id,
  admissionNo:          student.admissionNo,
  name:                 student.name,
  gender:               student.gender,
  dateOfBirth:          student.dateOfBirth,
  classId:              student.classId,
  className:            student.class.name,
  sectionId:            student.sectionId,
  sectionName:          student.section.name,
  rollNo:               student.rollNo,
  parentName:           student.parentName,
  parentPhone:          student.parentPhone,
  parentEmail:          student.parentEmail,
  bloodGroup:           student.bloodGroup,
  address:              student.address,
  status:               student.status,
  attendancePercentage: student.attendancePercentage,
});

// ── Create a student, reusing or creating the parent's login ────
export const createStudent = async (
  schoolId: string,
  input: CreateStudentSchema,
): Promise<{ student: StudentResponse; parentAccount: ParentAccount }> => {

  const klass = await prisma.class.findFirst({ where: { id: input.classId, schoolId } });
  if (!klass) throw notFound('Class not found', 'CLASS_NOT_FOUND');

  const section = await prisma.section.findFirst({ where: { id: input.sectionId, classId: input.classId } });
  if (!section) throw notFound('Section not found', 'SECTION_NOT_FOUND');

  const existingUser = await prisma.user.findUnique({ where: { email: input.parentEmail } });
  if (existingUser && (existingUser.role !== 'PARENT' || existingUser.schoolId !== schoolId)) {
    throw conflict('Email already registered', 'EMAIL_TAKEN');
  }

  const defaultPassword = existingUser ? null : generateDefaultPassword(input.parentEmail);
  const passwordHash    = defaultPassword ? await hashPassword(defaultPassword) : null;

  const { student, parentAccount } = await prisma.$transaction(async (tx) => {
    let parentUserId: string;
    let parentAccount: ParentAccount;

    if (existingUser) {
      parentUserId  = existingUser.id;
      parentAccount = { isNew: false, email: existingUser.email };
    } else {
      const parentUser = await tx.user.create({
        data: {
          name:         input.parentName,
          email:        input.parentEmail,
          phone:        input.parentPhone,
          passwordHash: passwordHash!,
          role:         'PARENT',
          schoolId,
        },
      });
      parentUserId  = parentUser.id;
      parentAccount = { isNew: true, email: parentUser.email, defaultPassword: defaultPassword! };
    }

    const studentCount = await tx.student.count({ where: { schoolId } });
    const admissionNo  = `ADM${String(studentCount + 1).padStart(4, '0')}`;

    const student = await tx.student.create({
      data: {
        admissionNo,
        name:        input.name,
        gender:      input.gender,
        dateOfBirth: input.dateOfBirth,
        classId:     input.classId,
        sectionId:   input.sectionId,
        rollNo:      input.rollNo,
        parentUserId,
        parentName:  input.parentName,
        parentPhone: input.parentPhone,
        parentEmail: input.parentEmail,
        bloodGroup:  input.bloodGroup ?? null,
        address:     input.address ?? null,
        schoolId,
      },
      include: { class: true, section: true },
    });

    return { student, parentAccount };
  });

  return { student: toStudentResponse(student), parentAccount };
};

// ── List students (paginated, searchable) ────────────────────────
export const listStudents = async (schoolId: string, query: ListStudentsQuerySchema) => {
  const { page, pageSize, search, classId, sectionId } = query;

  const where: Prisma.StudentWhereInput = {
    schoolId,
    ...(classId ? { classId } : {}),
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
      orderBy:  { createdAt: 'desc' },
      skip:     (page - 1) * pageSize,
      take:     pageSize,
    }),
    prisma.student.count({ where }),
  ]);

  return {
    items: items.map(toStudentResponse),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};
