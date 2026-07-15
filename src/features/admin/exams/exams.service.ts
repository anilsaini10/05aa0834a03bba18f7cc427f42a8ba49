import { Prisma, Exam, ExamClass, ExamResult, Class, Student, User } from '@prisma/client';
import { prisma } from '../../../config/db';
import {
  CreateExamSchema,
  UpdateExamSchema,
  ListExamsQuerySchema,
  AddExamClassSchema,
  ListExamClassStudentsQuerySchema,
  CreateExamResultSchema,
  UpdateExamResultSchema,
} from './exams.validation';

// ── Error helpers ──────────────────────────────────────────────
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

const badRequest = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 400;
  return err;
};

// ── Response shapes ────────────────────────────────────────────
type ExamWithRefs = Exam & { classes: (ExamClass & { class: Class })[]; createdByUser: User };

export interface ExamClassRef {
  classId:   string;
  className: string;
  maxMarks:  number;
}

export interface ExamResponse {
  id:          string;
  title:       string;
  description: string | null;
  startDate:   Date | null;
  endDate:     Date | null;
  classes:     ExamClassRef[];
  createdBy:   { id: string; name: string };
  createdAt:   Date;
  updatedAt:   Date;
}

const toExamResponse = (exam: ExamWithRefs): ExamResponse => ({
  id:          exam.id,
  title:       exam.title,
  description: exam.description,
  startDate:   exam.startDate,
  endDate:     exam.endDate,
  classes: exam.classes.map(ec => ({
    classId:   ec.classId,
    className: ec.class.name,
    maxMarks:  ec.maxMarks,
  })),
  createdBy: { id: exam.createdByUser.id, name: exam.createdByUser.name },
  createdAt: exam.createdAt,
  updatedAt: exam.updatedAt,
});

const EXAM_INCLUDE = {
  classes:       { include: { class: true } },
  createdByUser: true,
};

// ── Ensure an exam exists in this school, or throw 404 ─────────
const requireExam = async (schoolId: string, examId: string) => {
  const exam = await prisma.exam.findFirst({ where: { id: examId, schoolId } });
  if (!exam) throw notFound('Exam not found', 'EXAM_NOT_FOUND');
  return exam;
};

// ── Ensure a class is assigned to this exam, or throw 404 ──────
const requireExamClass = async (examId: string, classId: string) => {
  const examClass = await prisma.examClass.findUnique({ where: { examId_classId: { examId, classId } } });
  if (!examClass) throw notFound('This class is not assigned to this exam', 'EXAM_CLASS_NOT_FOUND');
  return examClass;
};

// ════════════════════════════════════════════════════════════
// Exam CRUD
// ════════════════════════════════════════════════════════════

// ── Create an exam + assign its classes (with per-class maxMarks) ─
export const createExam = async (
  schoolId: string,
  createdBy: string,
  input: CreateExamSchema,
): Promise<ExamResponse> => {

  const classIds = input.classes.map(c => c.classId);
  const classes  = await prisma.class.findMany({ where: { id: { in: classIds }, schoolId } });
  if (classes.length !== new Set(classIds).size) {
    throw notFound('One or more classIds not found for this school', 'CLASS_NOT_FOUND');
  }

  const exam = await prisma.exam.create({
    data: {
      schoolId,
      createdBy,
      title:       input.title,
      description: input.description ?? null,
      startDate:   input.startDate ?? null,
      endDate:     input.endDate ?? null,
      classes: {
        create: input.classes.map(c => ({ classId: c.classId, maxMarks: c.maxMarks })),
      },
    },
    include: EXAM_INCLUDE,
  });

  return toExamResponse(exam);
};

// ── List exams (paginated, searchable) ─────────────────────────
export const listExams = async (schoolId: string, query: ListExamsQuerySchema) => {
  const { page, pageSize, search } = query;

  const where: Prisma.ExamWhereInput = {
    schoolId,
    ...(search ? {
      OR: [
        { title:       { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.exam.findMany({
      where,
      include:  EXAM_INCLUDE,
      orderBy:  { createdAt: 'desc' },
      skip:     (page - 1) * pageSize,
      take:     pageSize,
    }),
    prisma.exam.count({ where }),
  ]);

  return {
    items: items.map(toExamResponse),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};

// ── Get one exam ────────────────────────────────────────────────
export const getExamById = async (schoolId: string, examId: string): Promise<ExamResponse> => {
  const exam = await prisma.exam.findFirst({ where: { id: examId, schoolId }, include: EXAM_INCLUDE });
  if (!exam) throw notFound('Exam not found', 'EXAM_NOT_FOUND');
  return toExamResponse(exam);
};

// ── Update exam metadata (title/description/dates — not classes) ─
export const updateExam = async (
  schoolId: string,
  examId: string,
  input: UpdateExamSchema,
): Promise<ExamResponse> => {
  const existing = await requireExam(schoolId, examId);

  const startDate = input.startDate !== undefined ? input.startDate : existing.startDate;
  const endDate    = input.endDate !== undefined ? input.endDate : existing.endDate;
  if (startDate && endDate && endDate < startDate) {
    throw badRequest('endDate must be on or after startDate', 'INVALID_DATE_RANGE');
  }

  const exam = await prisma.exam.update({
    where:   { id: examId },
    data:    input,
    include: EXAM_INCLUDE,
  });

  return toExamResponse(exam);
};

// ── Delete exam (cascades ExamClass + ExamResult rows) ──────────
export const deleteExam = async (schoolId: string, examId: string): Promise<void> => {
  await requireExam(schoolId, examId);
  await prisma.exam.delete({ where: { id: examId } });
};

// ════════════════════════════════════════════════════════════
// Exam ↔ Class assignment
// ════════════════════════════════════════════════════════════

// ── Assign an additional class to an exam ───────────────────────
export const addExamClass = async (
  schoolId: string,
  examId: string,
  input: AddExamClassSchema,
): Promise<ExamClassRef[]> => {
  await requireExam(schoolId, examId);

  const klass = await prisma.class.findFirst({ where: { id: input.classId, schoolId } });
  if (!klass) throw notFound('Class not found', 'CLASS_NOT_FOUND');

  const existing = await prisma.examClass.findUnique({
    where: { examId_classId: { examId, classId: input.classId } },
  });
  if (existing) throw conflict('This class is already assigned to this exam', 'EXAM_CLASS_ALREADY_ASSIGNED');

  await prisma.examClass.create({
    data: { examId, classId: input.classId, maxMarks: input.maxMarks },
  });

  const classes = await prisma.examClass.findMany({ where: { examId }, include: { class: true } });
  return classes.map(ec => ({ classId: ec.classId, className: ec.class.name, maxMarks: ec.maxMarks }));
};

// ── List classes assigned to an exam, with grading progress ─────
export const listExamClasses = async (schoolId: string, examId: string) => {
  await requireExam(schoolId, examId);

  const [examClasses, gradedCounts] = await Promise.all([
    prisma.examClass.findMany({
      where:   { examId },
      include: { class: { include: { _count: { select: { students: true } } } } },
      orderBy: { class: { numericLevel: 'asc' } },
    }),
    prisma.examResult.groupBy({
      by:     ['classId'],
      where:  { examId, status: 'GRADED' },
      _count: { _all: true },
    }),
  ]);

  const gradedMap = new Map(gradedCounts.map(g => [g.classId, g._count._all]));

  return examClasses.map(ec => ({
    classId:      ec.classId,
    className:    ec.class.name,
    maxMarks:     ec.maxMarks,
    studentCount: ec.class._count.students,
    gradedCount:  gradedMap.get(ec.classId) ?? 0,
  }));
};

// ── Remove a class from an exam (blocked if results already exist) ─
export const removeExamClass = async (schoolId: string, examId: string, classId: string): Promise<void> => {
  await requireExam(schoolId, examId);
  await requireExamClass(examId, classId);

  const resultCount = await prisma.examResult.count({ where: { examId, classId } });
  if (resultCount > 0) {
    throw conflict(
      'This class already has exam results recorded — delete them first',
      'EXAM_CLASS_HAS_RESULTS',
    );
  }

  await prisma.examClass.delete({ where: { examId_classId: { examId, classId } } });
};

// ════════════════════════════════════════════════════════════
// Students within an exam's class (+ their result, if any)
// ════════════════════════════════════════════════════════════

export const listExamClassStudents = async (
  schoolId: string,
  examId: string,
  classId: string,
  query: ListExamClassStudentsQuerySchema,
) => {
  await requireExam(schoolId, examId);
  const examClass = await requireExamClass(examId, classId);

  const { page, pageSize, search } = query;

  const where: Prisma.StudentWhereInput = {
    classId,
    ...(search ? {
      OR: [
        { name:        { contains: search, mode: 'insensitive' } },
        { admissionNo: { contains: search, mode: 'insensitive' } },
      ],
    } : {}),
  };

  const [students, total] = await Promise.all([
    prisma.student.findMany({
      where,
      include:  { examResults: { where: { examId } } },
      orderBy:  { rollNo: 'asc' },
      skip:     (page - 1) * pageSize,
      take:     pageSize,
    }),
    prisma.student.count({ where }),
  ]);

  return {
    maxMarks: examClass.maxMarks,
    items: students.map(s => {
      const result = s.examResults[0];
      return {
        studentId:   s.id,
        name:        s.name,
        admissionNo: s.admissionNo,
        rollNo:      s.rollNo,
        result: result ? {
          id:            result.id,
          marksObtained: result.marksObtained,
          grade:         result.grade,
          remarks:       result.remarks,
          status:        result.status,
        } : null,
      };
    }),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};

// ════════════════════════════════════════════════════════════
// Exam results (marks/grade per student)
// ════════════════════════════════════════════════════════════

export interface ExamResultResponse {
  id:            string;
  examId:        string;
  studentId:     string;
  studentName:   string;
  classId:       string;
  className:     string;
  maxMarks:      number;
  marksObtained: number | null;
  grade:         string | null;
  remarks:       string | null;
  status:        string;
  createdAt:     Date;
  updatedAt:     Date;
}

type ExamResultWithRefs = ExamResult & { student: Student; class: Class };

const toExamResultResponse = (r: ExamResultWithRefs, maxMarks: number): ExamResultResponse => ({
  id:            r.id,
  examId:        r.examId,
  studentId:     r.studentId,
  studentName:   r.student.name,
  classId:       r.classId,
  className:     r.class.name,
  maxMarks,
  marksObtained: r.marksObtained,
  grade:         r.grade,
  remarks:       r.remarks,
  status:        r.status,
  createdAt:     r.createdAt,
  updatedAt:     r.updatedAt,
});

const validateMarks = (marksObtained: number | undefined, maxMarks: number) => {
  if (marksObtained !== undefined && marksObtained > maxMarks) {
    throw badRequest(`marksObtained cannot exceed maxMarks (${maxMarks})`, 'INVALID_MARKS');
  }
};

// ── Create a result for a student ───────────────────────────────
export const createExamResult = async (
  schoolId: string,
  examId: string,
  input: CreateExamResultSchema,
): Promise<ExamResultResponse> => {
  await requireExam(schoolId, examId);

  const student = await prisma.student.findFirst({ where: { id: input.studentId, schoolId } });
  if (!student) throw notFound('Student not found', 'STUDENT_NOT_FOUND');

  const examClass = await requireExamClass(examId, student.classId);

  const existing = await prisma.examResult.findUnique({
    where: { examId_studentId: { examId, studentId: input.studentId } },
  });
  if (existing) {
    throw conflict('A result already exists for this student on this exam — use update instead', 'RESULT_ALREADY_EXISTS');
  }

  validateMarks(input.marksObtained, examClass.maxMarks);

  const result = await prisma.examResult.create({
    data: {
      examId,
      studentId: input.studentId,
      classId:   student.classId,
      marksObtained: input.marksObtained ?? null,
      grade:         input.grade ?? null,
      remarks:       input.remarks ?? null,
      status:        input.status,
    },
    include: { student: true, class: true },
  });

  return toExamResultResponse(result, examClass.maxMarks);
};

// ── Get one result ───────────────────────────────────────────────
export const getExamResultById = async (
  schoolId: string,
  examId: string,
  resultId: string,
): Promise<ExamResultResponse> => {
  await requireExam(schoolId, examId);

  const result = await prisma.examResult.findFirst({
    where:   { id: resultId, examId },
    include: { student: true, class: true },
  });
  if (!result) throw notFound('Exam result not found', 'RESULT_NOT_FOUND');

  const examClass = await requireExamClass(examId, result.classId);
  return toExamResultResponse(result, examClass.maxMarks);
};

// ── Update a result (marks/grade/remarks/status) ─────────────────
export const updateExamResult = async (
  schoolId: string,
  examId: string,
  resultId: string,
  input: UpdateExamResultSchema,
): Promise<ExamResultResponse> => {
  await requireExam(schoolId, examId);

  const existing = await prisma.examResult.findFirst({ where: { id: resultId, examId } });
  if (!existing) throw notFound('Exam result not found', 'RESULT_NOT_FOUND');

  const examClass = await requireExamClass(examId, existing.classId);
  const marksObtained = input.marksObtained !== undefined ? input.marksObtained : existing.marksObtained ?? undefined;
  validateMarks(marksObtained, examClass.maxMarks);

  const result = await prisma.examResult.update({
    where:   { id: resultId },
    data:    input,
    include: { student: true, class: true },
  });

  return toExamResultResponse(result, examClass.maxMarks);
};

// ── Delete a result ────────────────────────────────────────────
export const deleteExamResult = async (schoolId: string, examId: string, resultId: string): Promise<void> => {
  await requireExam(schoolId, examId);

  const existing = await prisma.examResult.findFirst({ where: { id: resultId, examId } });
  if (!existing) throw notFound('Exam result not found', 'RESULT_NOT_FOUND');

  await prisma.examResult.delete({ where: { id: resultId } });
};
