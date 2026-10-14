import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db';
import {
  ListPaperStudentsQuerySchema,
  SaveExamMarksSchema,
} from '../../features/admin/exams/exams.validation';

// ════════════════════════════════════════════════════════════
// Exam papers (ExamSchedule rows) + per-subject marks (ExamMark).
// Shared by the admin date-sheet endpoints and the teacher marks
// endpoints — callers do their own access checks first, then hand
// the already-authorized paper to these helpers.
// ════════════════════════════════════════════════════════════

const appError = (message: string, code: string, statusCode: number, details?: Record<string, unknown>) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = statusCode;
  if (details) err.details = details;
  return err;
};

export const toDateString = (d: Date): string => d.toISOString().slice(0, 10);

export const PAPER_INCLUDE = {
  exam:        true,
  class:       true,
  subject:     true,
  invigilator: { include: { user: true } },
} satisfies Prisma.ExamScheduleInclude;

export type PaperWithRefs = Prisma.ExamScheduleGetPayload<{ include: typeof PAPER_INCLUDE }>;

export const toPaperResponse = (p: PaperWithRefs) => ({
  id:          p.id,
  examId:      p.examId,
  examTitle:   p.exam.title,
  classId:     p.classId,
  className:   p.class.name,
  subjectId:   p.subjectId,
  subjectName: p.subject.name,
  date:        toDateString(p.date),
  startTime:   p.startTime,
  endTime:     p.endTime,
  maxMarks:    p.maxMarks,
  roomNo:      p.roomNo,
  invigilator: p.invigilator ? { id: p.invigilator.id, name: p.invigilator.user.name } : null,
  createdAt:   p.createdAt,
  updatedAt:   p.updatedAt,
});

const toMarkResponse = (m: {
  id: string; marksObtained: number | null; grade: string | null; remarks: string | null;
  status: string; updatedAt: Date;
}) => ({
  id:            m.id,
  marksObtained: m.marksObtained,
  grade:         m.grade,
  remarks:       m.remarks,
  status:        m.status,
  updatedAt:     m.updatedAt,
});

// ── Students of the paper's class, each with their mark (if any) ──
// Lists ACTIVE students of the class as it is today; optionally narrowed
// to one section (all sections sit a paper together, but teachers often
// enter marks section by section). `allowedSectionIds` limits the list to
// the sections the caller may see (a subject teacher's own sections);
// omit it for full access (admin).
export const listPaperStudents = async (
  paper:              PaperWithRefs,
  query:              ListPaperStudentsQuerySchema,
  allowedSectionIds?: string[],
) => {
  if (query.sectionId) {
    const section = await prisma.section.findFirst({ where: { id: query.sectionId, classId: paper.classId } });
    if (!section) throw appError('Section not found in this class', 'SECTION_NOT_FOUND', 404);
    if (allowedSectionIds && !allowedSectionIds.includes(query.sectionId)) {
      throw appError(
        `You do not teach ${paper.subject.name} in section ${section.name}`,
        'NOT_YOUR_SECTION', 403,
      );
    }
  }

  const sectionFilter = query.sectionId
    ? { sectionId: query.sectionId }
    : allowedSectionIds ? { sectionId: { in: allowedSectionIds } } : {};

  const students = await prisma.student.findMany({
    where: {
      classId:  paper.classId,
      schoolId: paper.schoolId,
      status:   'ACTIVE',
      ...sectionFilter,
      ...(query.search ? {
        OR: [
          { name:        { contains: query.search, mode: 'insensitive' } },
          { admissionNo: { contains: query.search, mode: 'insensitive' } },
        ],
      } : {}),
    },
    include: { section: true, examMarks: { where: { examScheduleId: paper.id } } },
    orderBy: [{ section: { name: 'asc' } }, { rollNo: 'asc' }],
  });

  const items = students.map(s => ({
    studentId:   s.id,
    name:        s.name,
    admissionNo: s.admissionNo,
    rollNo:      s.rollNo,
    sectionId:   s.sectionId,
    sectionName: s.section.name,
    mark:        s.examMarks[0] ? toMarkResponse(s.examMarks[0]) : null,
  }));

  const count = (status: string) => items.filter(i => i.mark?.status === status).length;

  return {
    paper: toPaperResponse(paper),
    summary: {
      totalStudents: items.length,
      graded:        count('GRADED'),
      absent:        count('ABSENT'),
      pending:       items.length - count('GRADED') - count('ABSENT'),
    },
    items,
  };
};

// ── Save (upsert) marks for many students on one paper ──────────
// Only fields present in an entry are changed on an existing mark, so
// re-sending marks without remarks doesn't wipe earlier remarks.
// `allowedSectionIds` (subject teacher) rejects students outside those
// sections; omit it for full access (admin).
export const saveExamMarks = async (
  paper:              PaperWithRefs,
  gradedBy:           string,
  input:              SaveExamMarksSchema,
  allowedSectionIds?: string[],
) => {
  const today = toDateString(new Date());
  if (toDateString(paper.date) > today) {
    throw appError(
      `Marks can be entered only on or after the exam date (${toDateString(paper.date)})`,
      'EXAM_NOT_HELD_YET', 400,
      { date: toDateString(paper.date) },
    );
  }

  const overMax = input.marks.filter(m => m.marksObtained != null && m.marksObtained > paper.maxMarks);
  if (overMax.length > 0) {
    throw appError(
      `marksObtained cannot exceed maxMarks (${paper.maxMarks})`,
      'INVALID_MARKS', 400,
      { maxMarks: paper.maxMarks, studentIds: overMax.map(m => m.studentId) },
    );
  }

  const studentIds = input.marks.map(m => m.studentId);
  const students   = await prisma.student.findMany({
    where:  { id: { in: studentIds }, classId: paper.classId, schoolId: paper.schoolId },
    select: { id: true, sectionId: true },
  });
  if (students.length !== studentIds.length) {
    const found = new Set(students.map(s => s.id));
    throw appError(
      'One or more students are not in this class',
      'STUDENT_NOT_IN_CLASS', 400,
      { studentIds: studentIds.filter(id => !found.has(id)) },
    );
  }

  if (allowedSectionIds) {
    const outside = students.filter(s => !allowedSectionIds.includes(s.sectionId));
    if (outside.length > 0) {
      throw appError(
        `You can enter ${paper.subject.name} marks only for the sections you teach`,
        'STUDENT_NOT_IN_YOUR_SECTION', 403,
        { studentIds: outside.map(s => s.id) },
      );
    }
  }

  await prisma.$transaction(input.marks.map(m => {
    const marksObtained = m.status === 'GRADED' ? m.marksObtained! : null;
    return prisma.examMark.upsert({
      where:  { examScheduleId_studentId: { examScheduleId: paper.id, studentId: m.studentId } },
      create: {
        examScheduleId: paper.id,
        studentId:      m.studentId,
        status:         m.status,
        marksObtained,
        grade:          m.grade ?? null,
        remarks:        m.remarks ?? null,
        gradedBy,
      },
      update: {
        status:  m.status,
        marksObtained,
        grade:   m.grade,
        remarks: m.remarks,
        gradedBy,
      },
    });
  }));

  return { savedCount: input.marks.length, ...(await listPaperStudents(paper, {}, allowedSectionIds)) };
};
