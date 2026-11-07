import { prisma } from '../../../config/db';
import { CreateSubjectSchema, UpdateSubjectSchema, AssignSubjectClassesSchema } from './subjects.validation';

export interface ClassRef {
  id:   string;
  name: string;
}

export interface SubjectListItem {
  id:          string;
  name:        string;
  description: string | null;
  isActive:    boolean;
  classes:     ClassRef[];
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

const badRequest = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 400;
  return err;
};

const SUBJECT_INCLUDE = {
  classes: { include: { class: true }, orderBy: { class: { numericLevel: 'asc' as const } } },
};

const toSubjectListItem = (s: any): SubjectListItem => ({
  id:          s.id,
  name:        s.name,
  description: s.description ?? null,
  isActive:    s.isActive,
  classes:     s.classes.map((cs: any) => ({ id: cs.class.id, name: cs.class.name })),
});

// ── List all subjects for a school (with the classes they're taught in) ─
export const listSubjects = async (schoolId: string): Promise<SubjectListItem[]> => {
  const subjects = await prisma.subject.findMany({
    where:   { schoolId },
    include: SUBJECT_INCLUDE,
    orderBy: { name: 'asc' },
  });

  return subjects.map(toSubjectListItem);
};

// ── Get a single subject ─────────────────────────────────────────
export const getSubjectById = async (schoolId: string, subjectId: string): Promise<SubjectListItem> => {
  const subject = await prisma.subject.findFirst({
    where: { id: subjectId, schoolId },
    include: SUBJECT_INCLUDE,
  });
  if (!subject) throw notFound('Subject not found', 'SUBJECT_NOT_FOUND');
  return toSubjectListItem(subject);
};

// ── Create a Subject, optionally linking it to classes right away ──
export const createSubject = async (
  schoolId: string,
  input: CreateSubjectSchema,
): Promise<SubjectListItem> => {

  const existing = await prisma.subject.findUnique({
    where: { schoolId_name: { schoolId, name: input.name } },
  });
  if (existing) throw conflict('A subject with this name already exists', 'SUBJECT_ALREADY_EXISTS');

  const classIds = input.classIds ?? [];
  if (classIds.length) {
    const classes = await prisma.class.findMany({ where: { id: { in: classIds }, schoolId } });
    if (classes.length !== classIds.length) {
      throw notFound('One or more classIds not found for this school', 'CLASS_NOT_FOUND');
    }
  }

  const subject = await prisma.subject.create({
    data: {
      name: input.name,
      description: input.description,
      schoolId,
      classes: { create: classIds.map(classId => ({ classId })) },
    },
    include: SUBJECT_INCLUDE,
  });

  return toSubjectListItem(subject);
};

// ── Update a subject ─────────────────────────────────────────────
export const updateSubject = async (
  schoolId: string,
  subjectId: string,
  input: UpdateSubjectSchema,
): Promise<SubjectListItem> => {
  const subject = await prisma.subject.findFirst({ where: { id: subjectId, schoolId } });
  if (!subject) throw notFound('Subject not found', 'SUBJECT_NOT_FOUND');

  if (input.name && input.name !== subject.name) {
    const dup = await prisma.subject.findUnique({ where: { schoolId_name: { schoolId, name: input.name } } });
    if (dup) throw conflict('A subject with this name already exists', 'SUBJECT_ALREADY_EXISTS');
  }

  const updated = await prisma.subject.update({
    where: { id: subjectId },
    data: input,
    include: SUBJECT_INCLUDE,
  });
  return toSubjectListItem(updated);
};

// ── Delete (soft-delete) a subject ───────────────────────────────
export const deleteSubject = async (schoolId: string, subjectId: string): Promise<void> => {
  const subject = await prisma.subject.findFirst({ where: { id: subjectId, schoolId } });
  if (!subject) throw notFound('Subject not found', 'SUBJECT_NOT_FOUND');

  const deps = await prisma.chapter.count({ where: { subjectId, isActive: true } });
  if (deps > 0) throw badRequest('Cannot delete subject with active chapters. Deactivate chapters first.', 'SUBJECT_HAS_DEPENDENTS');

  await prisma.subject.update({ where: { id: subjectId }, data: { isActive: false } });
};

// ── Toggle active status ─────────────────────────────────────────
export const toggleSubjectStatus = async (schoolId: string, subjectId: string): Promise<SubjectListItem> => {
  const subject = await prisma.subject.findFirst({ where: { id: subjectId, schoolId } });
  if (!subject) throw notFound('Subject not found', 'SUBJECT_NOT_FOUND');

  const updated = await prisma.subject.update({
    where: { id: subjectId },
    data: { isActive: !subject.isActive },
    include: SUBJECT_INCLUDE,
  });
  return toSubjectListItem(updated);
};

// ── Assign subject to multiple classes ───────────────────────────
export const assignSubjectToClasses = async (
  schoolId: string,
  subjectId: string,
  input: AssignSubjectClassesSchema,
): Promise<SubjectListItem> => {
  const subject = await prisma.subject.findFirst({ where: { id: subjectId, schoolId } });
  if (!subject) throw notFound('Subject not found', 'SUBJECT_NOT_FOUND');

  const classes = await prisma.class.findMany({ where: { id: { in: input.classIds }, schoolId } });
  if (classes.length !== input.classIds.length) {
    throw notFound('One or more classIds not found for this school', 'CLASS_NOT_FOUND');
  }

  const existing = await prisma.classSubject.findMany({
    where: { subjectId, classId: { in: input.classIds } },
    select: { classId: true },
  });
  const existingIds = new Set(existing.map(e => e.classId));
  const newClassIds = input.classIds.filter(id => !existingIds.has(id));

  if (newClassIds.length > 0) {
    await prisma.classSubject.createMany({
      data: newClassIds.map(classId => ({ subjectId, classId })),
    });
  }

  const updated = await prisma.subject.findUnique({
    where: { id: subjectId },
    include: SUBJECT_INCLUDE,
  });
  return toSubjectListItem(updated);
};

// ── Get subjects by class ────────────────────────────────────────
export const getSubjectsByClass = async (schoolId: string, classId: string): Promise<SubjectListItem[]> => {
  const cls = await prisma.class.findFirst({ where: { id: classId, schoolId } });
  if (!cls) throw notFound('Class not found', 'CLASS_NOT_FOUND');

  const subjects = await prisma.subject.findMany({
    where: { schoolId, isActive: true, classes: { some: { classId } } },
    include: SUBJECT_INCLUDE,
    orderBy: { name: 'asc' },
  });
  return subjects.map(toSubjectListItem);
};
