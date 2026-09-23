import { Prisma, Student, Class, Section } from '@prisma/client';
import { prisma } from '../../../config/db';
import { hashPassword } from '../../../shared/utils/hash';
import { generateDefaultPassword } from '../../../shared/utils/defaultPassword';
import { RECORD_STATUS, RECORD_STATUS_FILTER_ALL } from '../../../constants';
import { CreateStudentSchema, UpdateStudentSchema, ListStudentsQuerySchema } from './students.validation';

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

// Next free roll number in a section — max ACTIVE rollNo + 1, or 1 if the
// section has no active students yet. Surfaced in the ROLL_NO_TAKEN
// message so the admin has a ready-to-use suggestion instead of guessing.
const getSuggestedNextRollNo = async (sectionId: string): Promise<number> => {
  const result = await prisma.student.aggregate({
    where: { sectionId, status: RECORD_STATUS.ACTIVE },
    _max:  { rollNo: true },
  });
  return (result._max.rollNo ?? 0) + 1;
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

  // Only an ACTIVE student occupies a roll number — one freed up by a
  // soft-deleted (INACTIVE) student is reusable.
  const rollNoClash = await prisma.student.findFirst({
    where: { sectionId: input.sectionId, rollNo: input.rollNo, status: RECORD_STATUS.ACTIVE },
  });
  if (rollNoClash) {
    const suggested = await getSuggestedNextRollNo(input.sectionId);
    throw conflict(`This roll number is already taken in this section. Next available roll number: ${suggested}`, 'ROLL_NO_TAKEN');
  }

  // Match by email OR phone — a parent enrolling a second child very
  // commonly reuses the same phone with a different/new email (or vice
  // versa). Only matching by email would miss that, then crash later on
  // User.phone's unique constraint when trying to INSERT a duplicate.
  const existingUser = await prisma.user.findFirst({
    where: { OR: [{ email: input.parentEmail }, { phone: input.parentPhone }] },
  });
  if (existingUser && (existingUser.role !== 'PARENT' || existingUser.schoolId !== schoolId)) {
    throw conflict('Email or phone number already registered to a different account', 'EMAIL_TAKEN');
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

// ── Update a student's profile (+ synced parent User fields) ───────
// classId requires sectionId together (enforced at the Zod layer) —
// the target section is re-validated against the target class, and
// rollNo is checked for a clash in the target section either way.
export const updateStudent = async (
  schoolId: string,
  studentId: string,
  input: UpdateStudentSchema,
): Promise<StudentResponse> => {

  const student = await prisma.student.findFirst({ where: { id: studentId, schoolId } });
  if (!student) throw notFound('Student not found', 'STUDENT_NOT_FOUND');

  const targetClassId   = input.classId   ?? student.classId;
  const targetSectionId = input.sectionId ?? student.sectionId;

  if (input.classId || input.sectionId) {
    const section = await prisma.section.findFirst({ where: { id: targetSectionId, classId: targetClassId } });
    if (!section) throw notFound('Section not found', 'SECTION_NOT_FOUND');
  }

  if (input.classId || input.sectionId || input.rollNo !== undefined) {
    const targetRollNo = input.rollNo ?? student.rollNo;
    // Only an ACTIVE student occupies a roll number — one freed up by a
    // soft-deleted (INACTIVE) student is reusable.
    const clash = await prisma.student.findFirst({
      where: { sectionId: targetSectionId, rollNo: targetRollNo, status: RECORD_STATUS.ACTIVE, NOT: { id: studentId } },
    });
    if (clash) {
      const suggested = await getSuggestedNextRollNo(targetSectionId);
      throw conflict(`This roll number is already taken in the target section. Next available roll number: ${suggested}`, 'ROLL_NO_TAKEN');
    }
  }

  // Same email-or-phone check as createStudent — otherwise changing just
  // the phone to one already used by a different account would crash on
  // User.phone's unique constraint instead of a clean error.
  const emailChanged = input.parentEmail && input.parentEmail !== student.parentEmail;
  const phoneChanged = input.parentPhone && input.parentPhone !== student.parentPhone;
  if (emailChanged || phoneChanged) {
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          ...(emailChanged ? [{ email: input.parentEmail! }] : []),
          ...(phoneChanged ? [{ phone: input.parentPhone! }] : []),
        ],
      },
    });
    if (existingUser && existingUser.id !== student.parentUserId) {
      throw conflict('Email or phone number already registered to a different account', 'EMAIL_TAKEN');
    }
  }

  const { parentName, parentPhone, parentEmail } = input;

  const updated = await prisma.$transaction(async (tx) => {
    if (parentName !== undefined || parentPhone !== undefined || parentEmail !== undefined) {
      await tx.user.update({
        where: { id: student.parentUserId },
        data: {
          ...(parentName  !== undefined ? { name: parentName }   : {}),
          ...(parentPhone !== undefined ? { phone: parentPhone } : {}),
          ...(parentEmail !== undefined ? { email: parentEmail } : {}),
        },
      });
    }

    return tx.student.update({
      where:   { id: studentId },
      data:    input,
      include: { class: true, section: true },
    });
  });

  return toStudentResponse(updated);
};

// ── Get a single student's details ────────────────────────────────
export const getStudentById = async (schoolId: string, studentId: string): Promise<StudentResponse> => {
  const student = await prisma.student.findFirst({
    where:   { id: studentId, schoolId },
    include: { class: true, section: true },
  });
  if (!student) throw notFound('Student not found', 'STUDENT_NOT_FOUND');
  return toStudentResponse(student);
};

// ── List students (paginated, searchable) ────────────────────────
// status omitted/undefined -> ACTIVE only, so a soft-deleted student
// stays out of the default list; pass status=INACTIVE or status=ALL to see them.
export const listStudents = async (schoolId: string, query: ListStudentsQuerySchema) => {
  const { page, pageSize, search, classId, sectionId, status } = query;

  const where: Prisma.StudentWhereInput = {
    schoolId,
    ...(status === RECORD_STATUS_FILTER_ALL ? {} : { status: status ?? RECORD_STATUS.ACTIVE }),
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

// ── DELETE /admin/students/:studentId — soft delete ────────────────
// Never a hard delete — a student already has examResults,
// attendanceRecords, leaveRequests, homeworkSubmissions, etc. (all
// FK-linked), so removing the row would either fail outright or wreck
// that history. Marking INACTIVE drops it out of the default list and
// frees up its roll number for reuse in that section. The PARENT
// account itself is untouched (not logged out, not deactivated) — they
// may well have other active children under the same login.
export const deleteStudent = async (schoolId: string, studentId: string): Promise<StudentResponse> => {
  const student = await prisma.student.findFirst({ where: { id: studentId, schoolId } });
  if (!student) throw notFound('Student not found', 'STUDENT_NOT_FOUND');

  const updated = await prisma.student.update({
    where:   { id: studentId },
    data:    { status: RECORD_STATUS.INACTIVE },
    include: { class: true, section: true },
  });

  return toStudentResponse(updated);
};
