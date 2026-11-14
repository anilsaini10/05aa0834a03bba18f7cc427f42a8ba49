import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/db';
import { RECORD_STATUS } from '../../../constants';
import {
  PromotionPreviewSchema, PromotionExecuteSchema, ListPromotionHistorySchema,
} from './promotions.validation';

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

// Resolve and validate the from/to classes and sections.
const resolveClasses = async (schoolId: string, input: PromotionPreviewSchema) => {
  const fromClass = await prisma.class.findFirst({
    where: { id: input.fromClassId, schoolId },
    include: { sections: true },
  });
  if (!fromClass) throw notFound('Source class not found', 'FROM_CLASS_NOT_FOUND');

  const toClass = await prisma.class.findFirst({
    where: { id: input.toClassId, schoolId },
    include: { sections: true },
  });
  if (!toClass) throw notFound('Target class not found', 'TO_CLASS_NOT_FOUND');

  if (toClass.numericLevel <= fromClass.numericLevel) {
    throw badRequest('Target class must be higher than source class', 'INVALID_PROMOTION_TARGET');
  }

  const toSection = toClass.sections.find(s => s.id === input.toSectionId);
  if (!toSection) throw notFound('Target section not found in target class', 'TO_SECTION_NOT_FOUND');

  const session = await prisma.academicSession.findFirst({
    where: { id: input.academicSessionId, schoolId },
  });
  if (!session) throw notFound('Academic session not found', 'SESSION_NOT_FOUND');

  return { fromClass, toClass, toSection, session };
};

// Get the students that will be promoted.
const getStudentsToPromote = async (
  schoolId: string,
  input: PromotionPreviewSchema,
) => {
  const where: Prisma.StudentWhereInput = {
    schoolId,
    classId: input.fromClassId,
    status:  RECORD_STATUS.ACTIVE,
    ...(input.fromSectionId ? { sectionId: input.fromSectionId } : {}),
    ...(input.studentIds?.length ? { id: { in: input.studentIds } } : {}),
  };

  return prisma.student.findMany({
    where,
    include: { class: true, section: true },
    orderBy: { rollNo: 'asc' },
  });
};

// ── Preview promotion (no changes) ──────────────────────────────
export const previewPromotion = async (schoolId: string, input: PromotionPreviewSchema) => {
  const { fromClass, toClass, toSection } = await resolveClasses(schoolId, input);
  const students = await getStudentsToPromote(schoolId, input);

  if (students.length === 0) {
    throw badRequest('No active students found in the source class/section', 'NO_STUDENTS');
  }

  // Check existing students in target section to calculate new roll numbers
  const existingMaxRoll = await prisma.student.aggregate({
    where: { sectionId: toSection.id, status: RECORD_STATUS.ACTIVE },
    _max:  { rollNo: true },
  });
  const startRollNo = (existingMaxRoll._max.rollNo ?? 0) + 1;

  return {
    fromClass:   { id: fromClass.id, name: fromClass.name },
    toClass:     { id: toClass.id, name: toClass.name },
    toSection:   { id: toSection.id, name: toSection.name },
    studentsCount: students.length,
    startRollNo,
    students: students.map((s, i) => ({
      id:            s.id,
      name:          s.name,
      admissionNo:   s.admissionNo,
      currentClass:  s.class.name,
      currentSection: s.section.name,
      currentRollNo: s.rollNo,
      newRollNo:     startRollNo + i,
    })),
  };
};

// ── Execute promotion ───────────────────────────────────────────
export const executePromotion = async (
  schoolId: string,
  userId: string,
  input: PromotionExecuteSchema,
) => {
  const { fromClass, toClass, toSection, session } = await resolveClasses(schoolId, input);
  const students = await getStudentsToPromote(schoolId, input);

  if (students.length === 0) {
    throw badRequest('No active students found in the source class/section', 'NO_STUDENTS');
  }

  // Check for students already promoted in this session
  const alreadyPromoted = await prisma.promotionRecord.findMany({
    where: {
      studentId: { in: students.map(s => s.id) },
      batch: { academicSessionId: session.id, status: 'COMPLETED' },
    },
    select: { studentId: true },
  });
  if (alreadyPromoted.length > 0) {
    throw conflict(
      `${alreadyPromoted.length} student(s) already promoted in this session`,
      'ALREADY_PROMOTED',
    );
  }

  const existingMaxRoll = await prisma.student.aggregate({
    where: { sectionId: toSection.id, status: RECORD_STATUS.ACTIVE },
    _max:  { rollNo: true },
  });
  const startRollNo = (existingMaxRoll._max.rollNo ?? 0) + 1;

  const result = await prisma.$transaction(async (tx) => {
    const batch = await tx.promotionBatch.create({
      data: {
        schoolId,
        academicSessionId: session.id,
        fromClassId:       fromClass.id,
        toClassId:         toClass.id,
        promotedCount:     students.length,
        promotedBy:        userId,
      },
    });

    const records = students.map((s, i) => ({
      batchId:       batch.id,
      studentId:     s.id,
      fromClassId:   s.classId,
      fromSectionId: s.sectionId,
      fromRollNo:    s.rollNo,
      toClassId:     toClass.id,
      toSectionId:   toSection.id,
      toRollNo:      startRollNo + i,
    }));

    await tx.promotionRecord.createMany({ data: records });

    // Update each student's class, section, and roll number
    for (let i = 0; i < students.length; i++) {
      await tx.student.update({
        where: { id: students[i].id },
        data: {
          classId:   toClass.id,
          sectionId: toSection.id,
          rollNo:    startRollNo + i,
        },
      });
    }

    return batch;
  }, { maxWait: 10_000, timeout: 120_000 });

  return {
    batchId:       result.id,
    fromClass:     { id: fromClass.id, name: fromClass.name },
    toClass:       { id: toClass.id, name: toClass.name },
    toSection:     { id: toSection.id, name: toSection.name },
    promotedCount: students.length,
    startRollNo,
  };
};

// ── Rollback a promotion batch ──────────────────────────────────
export const rollbackPromotion = async (schoolId: string, batchId: string) => {
  const batch = await prisma.promotionBatch.findFirst({
    where:   { id: batchId, schoolId },
    include: { records: true, fromClass: true, toClass: true },
  });
  if (!batch) throw notFound('Promotion batch not found', 'BATCH_NOT_FOUND');
  if (batch.status === 'ROLLED_BACK') {
    throw conflict('This promotion has already been rolled back', 'ALREADY_ROLLED_BACK');
  }

  await prisma.$transaction(async (tx) => {
    for (const record of batch.records) {
      await tx.student.update({
        where: { id: record.studentId },
        data: {
          classId:   record.fromClassId,
          sectionId: record.fromSectionId,
          rollNo:    record.fromRollNo,
        },
      });
    }

    await tx.promotionBatch.update({
      where: { id: batchId },
      data:  { status: 'ROLLED_BACK', rolledBackAt: new Date() },
    });
  }, { maxWait: 10_000, timeout: 120_000 });

  return {
    batchId:      batch.id,
    fromClass:    { id: batch.fromClass.id, name: batch.fromClass.name },
    toClass:      { id: batch.toClass.id, name: batch.toClass.name },
    rolledBack:   batch.records.length,
  };
};

// ── History (paginated) ─────────────────────────────────────────
export const listPromotionHistory = async (
  schoolId: string,
  query: ListPromotionHistorySchema,
) => {
  const { page, pageSize, academicSessionId } = query;

  const where: Prisma.PromotionBatchWhereInput = {
    schoolId,
    ...(academicSessionId ? { academicSessionId } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.promotionBatch.findMany({
      where,
      include: {
        fromClass:       { select: { id: true, name: true } },
        toClass:         { select: { id: true, name: true } },
        academicSession: { select: { id: true, name: true } },
        promotedByUser:  { select: { id: true, name: true } },
        _count:          { select: { records: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip:    (page - 1) * pageSize,
      take:    pageSize,
    }),
    prisma.promotionBatch.count({ where }),
  ]);

  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};

// ── Get batch details (with all student records) ────────────────
export const getBatchDetails = async (schoolId: string, batchId: string) => {
  const batch = await prisma.promotionBatch.findFirst({
    where: { id: batchId, schoolId },
    include: {
      fromClass:       { select: { id: true, name: true } },
      toClass:         { select: { id: true, name: true } },
      academicSession: { select: { id: true, name: true } },
      promotedByUser:  { select: { id: true, name: true } },
      records: {
        include: { student: { select: { id: true, name: true, admissionNo: true } } },
        orderBy: { toRollNo: 'asc' },
      },
    },
  });
  if (!batch) throw notFound('Promotion batch not found', 'BATCH_NOT_FOUND');
  return batch;
};
