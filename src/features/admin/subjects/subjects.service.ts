import { prisma } from '../../../config/db';
import { CreateSubjectSchema } from './subjects.validation';

export interface ClassRef {
  id:   string;
  name: string;
}

export interface SubjectListItem {
  id:      string;
  name:    string;
  classes: ClassRef[];
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

const SUBJECT_INCLUDE = {
  classes: { include: { class: true }, orderBy: { class: { numericLevel: 'asc' as const } } },
};

const toSubjectListItem = (s: any): SubjectListItem => ({
  id:      s.id,
  name:    s.name,
  classes: s.classes.map((cs: any) => ({ id: cs.class.id, name: cs.class.name })),
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
      schoolId,
      classes: { create: classIds.map(classId => ({ classId })) },
    },
    include: SUBJECT_INCLUDE,
  });

  return toSubjectListItem(subject);
};
