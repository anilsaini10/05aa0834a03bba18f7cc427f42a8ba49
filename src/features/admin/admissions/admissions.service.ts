import { Prisma, AdmissionStatus } from '@prisma/client';
import { prisma } from '../../../config/db';
import { hashPassword } from '../../../shared/utils/hash';
import { generateDefaultPassword } from '../../../shared/utils/defaultPassword';
import { RECORD_STATUS } from '../../../constants';
import {
  CreateAdmissionSchema, UpdateAdmissionSchema,
  ListAdmissionsQuerySchema, EnrollAdmissionSchema,
} from './admissions.validation';

const notFound = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code = code; err.statusCode = 404;
  return err;
};

const badRequest = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code = code; err.statusCode = 400;
  return err;
};

const conflict = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code = code; err.statusCode = 409;
  return err;
};

// ── Create admission entry ──────────────────────────────────────
export const createAdmission = async (
  schoolId: string,
  userId: string,
  input: CreateAdmissionSchema,
) => {
  const klass = await prisma.class.findFirst({ where: { id: input.classId, schoolId } });
  if (!klass) throw notFound('Class not found', 'CLASS_NOT_FOUND');

  if (input.academicSessionId) {
    const session = await prisma.academicSession.findFirst({
      where: { id: input.academicSessionId, schoolId },
    });
    if (!session) throw notFound('Academic session not found', 'SESSION_NOT_FOUND');
  }

  const count = await prisma.admission.count({ where: { schoolId } });
  const applicationNo = `APP${String(count + 1).padStart(4, '0')}`;

  return prisma.admission.create({
    data: {
      schoolId,
      applicationNo,
      studentName:       input.studentName,
      gender:            input.gender,
      dateOfBirth:       input.dateOfBirth,
      classId:           input.classId,
      parentName:        input.parentName,
      parentPhone:       input.parentPhone,
      parentEmail:       input.parentEmail,
      previousSchool:    input.previousSchool ?? null,
      address:           input.address ?? null,
      bloodGroup:        input.bloodGroup ?? null,
      academicSessionId: input.academicSessionId ?? null,
      status:            input.status ?? 'INQUIRY',
      remarks:           input.remarks ?? null,
      createdBy:         userId,
    },
    include: { class: true },
  });
};

// ── Update admission ────────────────────────────────────────────
export const updateAdmission = async (
  schoolId: string,
  admissionId: string,
  input: UpdateAdmissionSchema,
) => {
  const admission = await prisma.admission.findFirst({ where: { id: admissionId, schoolId } });
  if (!admission) throw notFound('Admission not found', 'ADMISSION_NOT_FOUND');
  if (admission.status === 'ENROLLED') {
    throw badRequest('Cannot update an enrolled admission', 'ALREADY_ENROLLED');
  }

  if (input.classId) {
    const klass = await prisma.class.findFirst({ where: { id: input.classId, schoolId } });
    if (!klass) throw notFound('Class not found', 'CLASS_NOT_FOUND');
  }

  return prisma.admission.update({
    where:   { id: admissionId },
    data:    input,
    include: { class: true },
  });
};

// ── Get admission by ID ─────────────────────────────────────────
export const getAdmissionById = async (schoolId: string, admissionId: string) => {
  const admission = await prisma.admission.findFirst({
    where:   { id: admissionId, schoolId },
    include: { class: true, academicSession: true, createdByUser: { select: { id: true, name: true } } },
  });
  if (!admission) throw notFound('Admission not found', 'ADMISSION_NOT_FOUND');
  return admission;
};

// ── List admissions (paginated, filterable) ─────────────────────
export const listAdmissions = async (schoolId: string, query: ListAdmissionsQuerySchema) => {
  const { page, pageSize, search, status, classId, academicSessionId } = query;

  const where: Prisma.AdmissionWhereInput = {
    schoolId,
    ...(status ? { status } : {}),
    ...(classId ? { classId } : {}),
    ...(academicSessionId ? { academicSessionId } : {}),
    ...(search ? {
      OR: [
        { studentName:   { contains: search, mode: 'insensitive' } },
        { applicationNo: { contains: search, mode: 'insensitive' } },
        { parentName:    { contains: search, mode: 'insensitive' } },
        { parentPhone:   { contains: search } },
      ],
    } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.admission.findMany({
      where,
      include:  { class: true },
      orderBy:  { createdAt: 'desc' },
      skip:     (page - 1) * pageSize,
      take:     pageSize,
    }),
    prisma.admission.count({ where }),
  ]);

  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};

// ── Enroll an approved admission → creates Student + Parent ─────
export const enrollAdmission = async (
  schoolId: string,
  admissionId: string,
  input: EnrollAdmissionSchema,
) => {
  const admission = await prisma.admission.findFirst({
    where: { id: admissionId, schoolId },
    include: { class: true },
  });
  if (!admission) throw notFound('Admission not found', 'ADMISSION_NOT_FOUND');
  if (admission.status === 'ENROLLED') {
    throw conflict('This admission is already enrolled', 'ALREADY_ENROLLED');
  }
  if (admission.status !== 'APPROVED') {
    throw badRequest('Only approved admissions can be enrolled. Current status: ' + admission.status, 'NOT_APPROVED');
  }

  const section = await prisma.section.findFirst({
    where: { id: input.sectionId, classId: admission.classId },
  });
  if (!section) throw notFound('Section not found in the selected class', 'SECTION_NOT_FOUND');

  const rollNoClash = await prisma.student.findFirst({
    where: { sectionId: input.sectionId, rollNo: input.rollNo, status: RECORD_STATUS.ACTIVE },
  });
  if (rollNoClash) {
    const maxResult = await prisma.student.aggregate({
      where: { sectionId: input.sectionId, status: RECORD_STATUS.ACTIVE },
      _max:  { rollNo: true },
    });
    const suggested = (maxResult._max.rollNo ?? 0) + 1;
    throw conflict(
      `Roll number ${input.rollNo} is already taken. Next available: ${suggested}`,
      'ROLL_NO_TAKEN',
    );
  }

  // Reuse or create parent account (same logic as student create)
  const existingUser = await prisma.user.findFirst({
    where: { OR: [{ email: admission.parentEmail }, { phone: admission.parentPhone }] },
  });
  if (existingUser && (existingUser.role !== 'PARENT' || existingUser.schoolId !== schoolId)) {
    throw conflict('Parent email or phone already registered to a different account', 'EMAIL_TAKEN');
  }

  const defaultPassword = existingUser ? null : generateDefaultPassword(admission.parentEmail);
  const passwordHash    = defaultPassword ? await hashPassword(defaultPassword) : null;

  const result = await prisma.$transaction(async (tx) => {
    let parentUserId: string;
    let isNewParent = false;

    if (existingUser) {
      parentUserId = existingUser.id;
    } else {
      const parentUser = await tx.user.create({
        data: {
          name:         admission.parentName,
          email:        admission.parentEmail,
          phone:        admission.parentPhone,
          passwordHash: passwordHash!,
          role:         'PARENT',
          schoolId,
        },
      });
      parentUserId = parentUser.id;
      isNewParent  = true;
    }

    const studentCount = await tx.student.count({ where: { schoolId } });
    const admissionNo  = `ADM${String(studentCount + 1).padStart(4, '0')}`;

    const student = await tx.student.create({
      data: {
        admissionNo,
        name:        admission.studentName,
        gender:      admission.gender,
        dateOfBirth: admission.dateOfBirth,
        classId:     admission.classId,
        sectionId:   input.sectionId,
        rollNo:      input.rollNo,
        parentUserId,
        parentName:  admission.parentName,
        parentPhone: admission.parentPhone,
        parentEmail: admission.parentEmail,
        bloodGroup:  admission.bloodGroup,
        address:     admission.address,
        schoolId,
      },
      include: { class: true, section: true },
    });

    await tx.admission.update({
      where: { id: admissionId },
      data:  { status: 'ENROLLED', enrolledStudentId: student.id },
    });

    return { student, isNewParent, parentEmail: admission.parentEmail };
  });

  return {
    student: result.student,
    parentAccount: {
      isNew: result.isNewParent,
      email: result.parentEmail,
      ...(defaultPassword ? { defaultPassword } : {}),
    },
  };
};

// ── Admission stats ─────────────────────────────────────────────
export const getAdmissionStats = async (schoolId: string, academicSessionId?: string) => {
  const where: Prisma.AdmissionWhereInput = {
    schoolId,
    ...(academicSessionId ? { academicSessionId } : {}),
  };

  const statusCounts = await prisma.admission.groupBy({
    by:     ['status'],
    where,
    _count: true,
  });

  const classCounts = await prisma.admission.groupBy({
    by:     ['classId'],
    where,
    _count: true,
  });

  const classes = classCounts.length
    ? await prisma.class.findMany({
        where: { id: { in: classCounts.map(c => c.classId) } },
        select: { id: true, name: true },
      })
    : [];

  const total = statusCounts.reduce((sum, s) => sum + s._count, 0);

  return {
    total,
    byStatus: Object.fromEntries(
      (['INQUIRY', 'APPLIED', 'APPROVED', 'ENROLLED', 'REJECTED', 'WITHDRAWN'] as AdmissionStatus[])
        .map(s => [s, statusCounts.find(sc => sc.status === s)?._count ?? 0]),
    ),
    byClass: classCounts.map(c => ({
      classId:   c.classId,
      className: classes.find(cl => cl.id === c.classId)?.name ?? '',
      count:     c._count,
    })),
  };
};

// ── Delete admission (only INQUIRY/APPLIED/WITHDRAWN/REJECTED) ─
export const deleteAdmission = async (schoolId: string, admissionId: string) => {
  const admission = await prisma.admission.findFirst({ where: { id: admissionId, schoolId } });
  if (!admission) throw notFound('Admission not found', 'ADMISSION_NOT_FOUND');
  if (admission.status === 'ENROLLED') {
    throw badRequest('Cannot delete an enrolled admission', 'CANNOT_DELETE_ENROLLED');
  }
  await prisma.admission.delete({ where: { id: admissionId } });
  return admission;
};
