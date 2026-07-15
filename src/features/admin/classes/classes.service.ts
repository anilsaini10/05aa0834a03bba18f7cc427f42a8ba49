import { prisma } from '../../../config/db';
import {
  CreateClassSchema,
  AddSectionSchema,
  UpdateClassSchema,
  UpdateSectionSchema,
} from './classes.validation';

export interface SectionListItem {
  id:               string;
  name:             string;
  classId:          string;
  classTeacherId:   string | null;
  classTeacherName: string | null;
  capacity:         number;
  studentCount:     number;
}

export interface SubjectRef {
  id:   string;
  name: string;
}

export interface ClassListItem {
  id:            string;
  name:          string;
  numericLevel:  number;
  totalStudents: number;
  sections:      SectionListItem[];
  subjects:      SubjectRef[];
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

const CLASS_INCLUDE = {
  _count:  { select: { students: true } },
  sections: {
    include: {
      classTeacher: { include: { user: true } },
      _count:       { select: { students: true } },
    },
    orderBy: { name: 'asc' as const },
  },
  subjects: { include: { subject: true }, orderBy: { subject: { name: 'asc' as const } } },
};

const toClassListItem = (c: any): ClassListItem => ({
  id:            c.id,
  name:          c.name,
  numericLevel:  c.numericLevel,
  totalStudents: c._count.students,
  sections: c.sections.map((s: any) => ({
    id:               s.id,
    name:             s.name,
    classId:          s.classId,
    classTeacherId:   s.classTeacherId,
    classTeacherName: s.classTeacher?.user.name ?? null,
    capacity:         s.capacity,
    studentCount:     s._count.students,
  })),
  subjects: c.subjects.map((cs: any) => ({ id: cs.subject.id, name: cs.subject.name })),
});

// ── List all classes (with sections + curriculum subjects) ──────
export const listClasses = async (schoolId: string): Promise<ClassListItem[]> => {
  const classes = await prisma.class.findMany({
    where:   { schoolId },
    include: CLASS_INCLUDE,
    orderBy: { numericLevel: 'asc' },
  });

  return classes.map(toClassListItem);
};

// ── Create a Class with its initial Sections ─────────────────────
export const createClass = async (
  schoolId: string,
  input: CreateClassSchema,
): Promise<ClassListItem> => {

  const existing = await prisma.class.findUnique({
    where: { schoolId_name: { schoolId, name: input.name } },
  });
  if (existing) throw conflict('A class with this name already exists', 'CLASS_NAME_TAKEN');

  const sectionNames = input.sections.map(s => s.name.toLowerCase());
  if (new Set(sectionNames).size !== sectionNames.length) {
    throw conflict('Duplicate section names in request', 'SECTION_NAME_TAKEN');
  }

  const klass = await prisma.class.create({
    data: {
      name:         input.name,
      numericLevel: input.numericLevel,
      schoolId,
      sections: { create: input.sections.map(s => ({ name: s.name, capacity: s.capacity })) },
    },
    include: CLASS_INCLUDE,
  });

  return toClassListItem(klass);
};

// ── Add a Section to an existing Class ───────────────────────────
export const addSection = async (
  schoolId: string,
  classId: string,
  input: AddSectionSchema,
): Promise<SectionListItem> => {

  const klass = await prisma.class.findFirst({ where: { id: classId, schoolId } });
  if (!klass) throw notFound('Class not found', 'CLASS_NOT_FOUND');

  const existing = await prisma.section.findUnique({
    where: { classId_name: { classId, name: input.name } },
  });
  if (existing) throw conflict('A section with this name already exists in this class', 'SECTION_NAME_TAKEN');

  const section = await prisma.section.create({
    data: { name: input.name, capacity: input.capacity, classId },
    include: { classTeacher: { include: { user: true } }, _count: { select: { students: true } } },
  });

  return {
    id:               section.id,
    name:             section.name,
    classId:          section.classId,
    classTeacherId:   section.classTeacherId,
    classTeacherName: section.classTeacher?.user.name ?? null,
    capacity:         section.capacity,
    studentCount:     section._count.students,
  };
};

// ── Link an existing Subject to a Class (idempotent) ─────────────
export const addSubjectToClass = async (
  schoolId: string,
  classId: string,
  subjectId: string,
): Promise<SubjectRef[]> => {

  const klass = await prisma.class.findFirst({ where: { id: classId, schoolId } });
  if (!klass) throw notFound('Class not found', 'CLASS_NOT_FOUND');

  const subject = await prisma.subject.findFirst({ where: { id: subjectId, schoolId } });
  if (!subject) throw notFound('Subject not found', 'SUBJECT_NOT_FOUND');

  await prisma.classSubject.upsert({
    where:  { classId_subjectId: { classId, subjectId } },
    update: {},
    create: { classId, subjectId },
  });

  const links = await prisma.classSubject.findMany({
    where:   { classId },
    include: { subject: true },
    orderBy: { subject: { name: 'asc' } },
  });

  return links.map(l => ({ id: l.subject.id, name: l.subject.name }));
};

// ── Update a Class (name / numericLevel) ──────────────────────
export const updateClass = async (
  schoolId: string,
  classId: string,
  input: UpdateClassSchema,
): Promise<ClassListItem> => {

  const existing = await prisma.class.findFirst({ where: { id: classId, schoolId } });
  if (!existing) throw notFound('Class not found', 'CLASS_NOT_FOUND');

  if (input.name) {
    const nameTaken = await prisma.class.findFirst({
      where: { schoolId, name: input.name, NOT: { id: classId } },
    });
    if (nameTaken) throw conflict('A class with this name already exists', 'CLASS_NAME_TAKEN');
  }

  const klass = await prisma.class.update({
    where:   { id: classId },
    data:    input,
    include: CLASS_INCLUDE,
  });

  return toClassListItem(klass);
};

// ── Delete a Class ─────────────────────────────────────────────
// Blocked if it has enrolled students. Otherwise cascades its own
// Sections + curriculum/teacher links (ExamResult can't reference this
// class without a student, so if there are no students there are no
// results to worry about either).
export const deleteClass = async (schoolId: string, classId: string): Promise<void> => {
  const existing = await prisma.class.findFirst({ where: { id: classId, schoolId } });
  if (!existing) throw notFound('Class not found', 'CLASS_NOT_FOUND');

  const studentCount = await prisma.student.count({ where: { classId } });
  if (studentCount > 0) {
    throw conflict('This class has enrolled students — remove/reassign them first', 'CLASS_HAS_STUDENTS');
  }

  await prisma.$transaction([
    prisma.teacherSubject.deleteMany({ where: { classId } }),
    prisma.examClass.deleteMany({ where: { classId } }),
    prisma.classSubject.deleteMany({ where: { classId } }),
    prisma.section.deleteMany({ where: { classId } }),
    prisma.class.delete({ where: { id: classId } }),
  ]);
};

// ── Update a Section (name / capacity / classTeacherId) ───────
export const updateSection = async (
  schoolId: string,
  classId: string,
  sectionId: string,
  input: UpdateSectionSchema,
): Promise<SectionListItem> => {

  const klass = await prisma.class.findFirst({ where: { id: classId, schoolId } });
  if (!klass) throw notFound('Class not found', 'CLASS_NOT_FOUND');

  const existing = await prisma.section.findFirst({ where: { id: sectionId, classId } });
  if (!existing) throw notFound('Section not found', 'SECTION_NOT_FOUND');

  if (input.name) {
    const nameTaken = await prisma.section.findFirst({
      where: { classId, name: input.name, NOT: { id: sectionId } },
    });
    if (nameTaken) throw conflict('A section with this name already exists in this class', 'SECTION_NAME_TAKEN');
  }

  if (input.classTeacherId) {
    const teacher = await prisma.teacher.findFirst({ where: { id: input.classTeacherId, schoolId } });
    if (!teacher) throw notFound('Teacher not found', 'TEACHER_NOT_FOUND');

    const assignedElsewhere = await prisma.section.findFirst({
      where: { classTeacherId: input.classTeacherId, NOT: { id: sectionId } },
    });
    if (assignedElsewhere) {
      throw conflict('This teacher is already the Class Teacher of another section', 'TEACHER_ALREADY_CLASS_TEACHER');
    }
  }

  const section = await prisma.section.update({
    where:   { id: sectionId },
    data:    input,
    include: { classTeacher: { include: { user: true } }, _count: { select: { students: true } } },
  });

  return {
    id:               section.id,
    name:             section.name,
    classId:          section.classId,
    classTeacherId:   section.classTeacherId,
    classTeacherName: section.classTeacher?.user.name ?? null,
    capacity:         section.capacity,
    studentCount:     section._count.students,
  };
};

// ── Delete a Section ───────────────────────────────────────────
// Blocked if it has enrolled students.
export const deleteSection = async (schoolId: string, classId: string, sectionId: string): Promise<void> => {
  const klass = await prisma.class.findFirst({ where: { id: classId, schoolId } });
  if (!klass) throw notFound('Class not found', 'CLASS_NOT_FOUND');

  const existing = await prisma.section.findFirst({ where: { id: sectionId, classId } });
  if (!existing) throw notFound('Section not found', 'SECTION_NOT_FOUND');

  const studentCount = await prisma.student.count({ where: { sectionId } });
  if (studentCount > 0) {
    throw conflict('This section has enrolled students — remove/reassign them first', 'SECTION_HAS_STUDENTS');
  }

  await prisma.section.delete({ where: { id: sectionId } });
};
