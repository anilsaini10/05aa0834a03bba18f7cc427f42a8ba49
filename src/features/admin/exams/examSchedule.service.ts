import { Prisma, Exam } from '@prisma/client';
import { prisma } from '../../../config/db';
import { RECORD_STATUS } from '../../../constants';
import {
  PAPER_INCLUDE,
  PaperWithRefs,
  toPaperResponse,
  toDateString,
  listPaperStudents,
  saveExamMarks,
} from '../../../shared/services/examPaper.service';
import {
  CreateExamScheduleSchema,
  UpdateExamScheduleSchema,
  ListExamScheduleQuerySchema,
  ListPaperStudentsQuerySchema,
  SaveExamMarksSchema,
} from './exams.validation';

// ════════════════════════════════════════════════════════════
// Exam schedule (date sheet) — one row per paper: exam + class +
// subject on a date/time, with max marks, room and invigilator.
//
// Every write runs inside a transaction holding a per-school advisory
// lock, so two admins saving papers at the same moment can't both pass
// the overlap checks and create a clash.
// ════════════════════════════════════════════════════════════

const appError = (message: string, code: string, statusCode: number, details?: Record<string, unknown>) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = statusCode;
  if (details) err.details = details;
  return err;
};

const timesOverlap = (aStart: string, aEnd: string, bStart: string, bEnd: string): boolean =>
  aStart < bEnd && aEnd > bStart;

const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

const lockSchoolExamSchedule = (tx: Prisma.TransactionClient, schoolId: string) =>
  tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`exam-schedule:${schoolId}`}))::text`;

// What a conflicting paper looks like in error `details`, so the admin UI
// can say exactly which paper is in the way.
const conflictDetails = (p: PaperWithRefs) => ({
  conflictWith: {
    scheduleId:      p.id,
    examId:          p.examId,
    examTitle:       p.exam.title,
    className:       p.class.name,
    subjectName:     p.subject.name,
    date:            toDateString(p.date),
    startTime:       p.startTime,
    endTime:         p.endTime,
    roomNo:          p.roomNo,
    invigilatorName: p.invigilator?.user.name ?? null,
  },
});

const describe = (p: PaperWithRefs) =>
  `${p.class.name} ${p.subject.name} (${p.exam.title}, ${toDateString(p.date)} ${p.startTime}–${p.endTime})`;

const requireExamTx = async (tx: Prisma.TransactionClient, schoolId: string, examId: string) => {
  const exam = await tx.exam.findFirst({ where: { id: examId, schoolId } });
  if (!exam) throw appError('Exam not found', 'EXAM_NOT_FOUND', 404);
  return exam;
};

interface PaperFields {
  classId:       string;
  subjectId:     string;
  date:          Date;
  startTime:     string;
  endTime:       string;
  roomNo:        string | null;
  invigilatorId: string | null;
}

// ── Every rule a paper must satisfy. Returns the ExamClass row (for the
//    default maxMarks). excludeId = the paper being updated. ────────────
const checkPaper = async (
  tx:        Prisma.TransactionClient,
  schoolId:  string,
  exam:      Exam,
  paper:     PaperFields,
  excludeId?: string,
) => {
  const notSelf = excludeId ? { NOT: { id: excludeId } } : {};
  const dateStr = toDateString(paper.date);

  // 1. Class must be assigned to this exam.
  const examClass = await tx.examClass.findUnique({
    where:   { examId_classId: { examId: exam.id, classId: paper.classId } },
    include: { class: true },
  });
  if (!examClass || examClass.class.schoolId !== schoolId) {
    throw appError('This class is not assigned to this exam', 'EXAM_CLASS_NOT_FOUND', 404);
  }

  // 2. Subject must exist in this school and be taught in this class.
  const subject = await tx.subject.findFirst({ where: { id: paper.subjectId, schoolId } });
  if (!subject) throw appError('Subject not found', 'SUBJECT_NOT_FOUND', 404);

  const inClass = await tx.classSubject.findUnique({
    where: { classId_subjectId: { classId: paper.classId, subjectId: paper.subjectId } },
  });
  if (!inClass) {
    throw appError(
      `${subject.name} is not a subject of ${examClass.class.name} — add it to the class first`,
      'SUBJECT_NOT_IN_CLASS', 400,
    );
  }

  // 3. Date must fall inside the exam's date range (when the exam has one).
  const startStr = exam.startDate ? toDateString(exam.startDate) : null;
  const endStr   = exam.endDate   ? toDateString(exam.endDate)   : null;
  if ((startStr && dateStr < startStr) || (endStr && dateStr > endStr)) {
    throw appError(
      `Paper date must be within the exam dates (${startStr ?? '…'} to ${endStr ?? '…'})`,
      'DATE_OUTSIDE_EXAM_RANGE', 400,
      { startDate: startStr, endDate: endStr },
    );
  }

  // 4. One paper per subject per class in an exam.
  const duplicate = await tx.examSchedule.findFirst({
    where:   { examId: exam.id, classId: paper.classId, subjectId: paper.subjectId, ...notSelf },
    include: PAPER_INCLUDE,
  });
  if (duplicate) {
    throw appError(
      `${subject.name} is already scheduled for ${examClass.class.name} in this exam`,
      'SUBJECT_ALREADY_SCHEDULED', 409,
      conflictDetails(duplicate),
    );
  }

  // 5. A class can't sit two papers at overlapping times (across ALL exams).
  const classPapers = await tx.examSchedule.findMany({
    where:   { classId: paper.classId, date: paper.date, ...notSelf },
    include: PAPER_INCLUDE,
  });
  const classClash = classPapers.find(p => timesOverlap(p.startTime, p.endTime, paper.startTime, paper.endTime));
  if (classClash) {
    throw appError(
      `${examClass.class.name} already has a paper at this time: ${describe(classClash)}`,
      'CLASS_TIME_CONFLICT', 409,
      conflictDetails(classClash),
    );
  }

  // 6. Invigilator: same school, active, not on approved leave, and not
  //    invigilating another paper at an overlapping time.
  if (paper.invigilatorId) {
    const teacher = await tx.teacher.findFirst({
      where:   { id: paper.invigilatorId, schoolId },
      include: { user: true },
    });
    if (!teacher) throw appError('Invigilator (teacher) not found', 'INVIGILATOR_NOT_FOUND', 404);
    if (teacher.status !== RECORD_STATUS.ACTIVE || !teacher.user.isActive) {
      throw appError(`${teacher.user.name} is inactive and can't be assigned`, 'INVIGILATOR_INACTIVE', 400);
    }

    const leave = await tx.teacherLeaveRequest.findFirst({
      where: { teacherId: teacher.id, status: 'APPROVED', fromDate: { lte: paper.date }, toDate: { gte: paper.date } },
    });
    if (leave) {
      throw appError(
        `${teacher.user.name} is on approved leave on ${dateStr}`,
        'INVIGILATOR_ON_LEAVE', 409,
        { leave: { id: leave.id, fromDate: toDateString(leave.fromDate), toDate: toDateString(leave.toDate) } },
      );
    }

    const duties = await tx.examSchedule.findMany({
      where:   { invigilatorId: teacher.id, date: paper.date, ...notSelf },
      include: PAPER_INCLUDE,
    });
    const dutyClash = duties.find(p => timesOverlap(p.startTime, p.endTime, paper.startTime, paper.endTime));
    if (dutyClash) {
      throw appError(
        `${teacher.user.name} is already invigilating at this time: ${describe(dutyClash)}`,
        'INVIGILATOR_TIME_CONFLICT', 409,
        conflictDetails(dutyClash),
      );
    }
  }

  // 7. A room can host only one paper at a time (room names compared
  //    case-insensitively, so "Hall 1" and "hall 1" are the same room).
  if (paper.roomNo) {
    const roomPapers = await tx.examSchedule.findMany({
      where:   { schoolId, date: paper.date, roomNo: { equals: paper.roomNo, mode: 'insensitive' }, ...notSelf },
      include: PAPER_INCLUDE,
    });
    const roomClash = roomPapers.find(p => timesOverlap(p.startTime, p.endTime, paper.startTime, paper.endTime));
    if (roomClash) {
      throw appError(
        `Room ${paper.roomNo} is already booked at this time: ${describe(roomClash)}`,
        'ROOM_TIME_CONFLICT', 409,
        conflictDetails(roomClash),
      );
    }
  }

  return examClass;
};

// ── Create one or many papers — all-or-nothing. Papers in the same
//    request are checked against each other too (each insert is visible
//    to the next paper's checks inside the transaction). ──────────────
export const createExamPapers = async (
  schoolId:  string,
  examId:    string,
  createdBy: string,
  papers:    CreateExamScheduleSchema[],
) => {
  const created = await prisma.$transaction(async (tx) => {
    await lockSchoolExamSchedule(tx, schoolId);
    const exam = await requireExamTx(tx, schoolId, examId);

    const rows: PaperWithRefs[] = [];
    for (const [index, input] of papers.entries()) {
      try {
        const fields: PaperFields = {
          classId:       input.classId,
          subjectId:     input.subjectId,
          date:          input.date,
          startTime:     input.startTime,
          endTime:       input.endTime,
          roomNo:        input.roomNo ?? null,
          invigilatorId: input.invigilatorId ?? null,
        };
        const examClass = await checkPaper(tx, schoolId, exam, fields);

        rows.push(await tx.examSchedule.create({
          data:    { ...fields, schoolId, examId, createdBy, maxMarks: input.maxMarks ?? examClass.maxMarks },
          include: PAPER_INCLUDE,
        }));
      } catch (err: any) {
        // In a bulk request, say which paper failed.
        if (papers.length > 1 && err?.code && err?.statusCode) {
          err.message = `Paper #${index + 1}: ${err.message}`;
          err.details = { ...(err.details ?? {}), paperIndex: index };
        }
        throw err;
      }
    }
    return rows;
  }, TX_OPTIONS);

  return created.map(toPaperResponse);
};

// ── Date sheet of an exam (optionally one class), in date/time order ─
export const listExamPapers = async (schoolId: string, examId: string, query: ListExamScheduleQuerySchema) => {
  const exam = await prisma.exam.findFirst({ where: { id: examId, schoolId } });
  if (!exam) throw appError('Exam not found', 'EXAM_NOT_FOUND', 404);

  const papers = await prisma.examSchedule.findMany({
    where:   { examId, ...(query.classId ? { classId: query.classId } : {}) },
    include: PAPER_INCLUDE,
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }, { class: { numericLevel: 'asc' } }],
  });

  const markedCounts = await prisma.examMark.groupBy({
    by:     ['examScheduleId'],
    where:  { examScheduleId: { in: papers.map(p => p.id) }, status: { not: 'PENDING' } },
    _count: { _all: true },
  });
  const markedMap = new Map(markedCounts.map(m => [m.examScheduleId, m._count._all]));

  return {
    exam: {
      id:        exam.id,
      title:     exam.title,
      startDate: exam.startDate ? toDateString(exam.startDate) : null,
      endDate:   exam.endDate   ? toDateString(exam.endDate)   : null,
    },
    items: papers.map(p => ({ ...toPaperResponse(p), markedCount: markedMap.get(p.id) ?? 0 })),
  };
};

// ── Update a paper — re-runs every check against its new values ─────
export const updateExamPaper = async (
  schoolId:   string,
  examId:     string,
  scheduleId: string,
  input:      UpdateExamScheduleSchema,
) => {
  const updated = await prisma.$transaction(async (tx) => {
    await lockSchoolExamSchedule(tx, schoolId);
    const exam = await requireExamTx(tx, schoolId, examId);

    const existing = await tx.examSchedule.findFirst({ where: { id: scheduleId, examId, schoolId } });
    if (!existing) throw appError('Exam paper not found', 'EXAM_SCHEDULE_NOT_FOUND', 404);

    const fields: PaperFields = {
      classId:       input.classId   ?? existing.classId,
      subjectId:     input.subjectId ?? existing.subjectId,
      date:          input.date      ?? existing.date,
      startTime:     input.startTime ?? existing.startTime,
      endTime:       input.endTime   ?? existing.endTime,
      roomNo:        input.roomNo        !== undefined ? input.roomNo        : existing.roomNo,
      invigilatorId: input.invigilatorId !== undefined ? input.invigilatorId : existing.invigilatorId,
    };
    if (fields.endTime <= fields.startTime) {
      throw appError('endTime must be after startTime', 'INVALID_TIME_RANGE', 400);
    }

    // Marks belong to a specific class+subject — moving the paper would
    // silently attach them to the wrong one.
    const movesPaper = fields.classId !== existing.classId || fields.subjectId !== existing.subjectId;
    if (movesPaper && await tx.examMark.count({ where: { examScheduleId: existing.id } }) > 0) {
      throw appError(
        'Marks are already entered for this paper — its class/subject can no longer be changed',
        'EXAM_SCHEDULE_HAS_MARKS', 409,
      );
    }

    if (input.maxMarks !== undefined) {
      const { _max } = await tx.examMark.aggregate({
        where: { examScheduleId: existing.id },
        _max:  { marksObtained: true },
      });
      if (_max.marksObtained !== null && _max.marksObtained > input.maxMarks) {
        throw appError(
          `A student already has ${_max.marksObtained} marks — maxMarks can't be lower than that`,
          'MAX_MARKS_BELOW_EXISTING', 409,
          { highestMarks: _max.marksObtained },
        );
      }
    }

    await checkPaper(tx, schoolId, exam, fields, existing.id);

    return tx.examSchedule.update({
      where:   { id: existing.id },
      data:    { ...fields, ...(input.maxMarks !== undefined ? { maxMarks: input.maxMarks } : {}) },
      include: PAPER_INCLUDE,
    });
  }, TX_OPTIONS);

  return toPaperResponse(updated);
};

// ── Delete a paper — blocked once any student has been graded/marked absent ─
export const deleteExamPaper = async (schoolId: string, examId: string, scheduleId: string): Promise<void> => {
  const existing = await prisma.examSchedule.findFirst({ where: { id: scheduleId, examId, schoolId } });
  if (!existing) throw appError('Exam paper not found', 'EXAM_SCHEDULE_NOT_FOUND', 404);

  const marked = await prisma.examMark.count({ where: { examScheduleId: existing.id, status: { not: 'PENDING' } } });
  if (marked > 0) {
    throw appError(
      `Marks are already entered for ${marked} student(s) on this paper — it can't be deleted`,
      'EXAM_SCHEDULE_HAS_MARKS', 409,
      { markedCount: marked },
    );
  }

  await prisma.examSchedule.delete({ where: { id: existing.id } });
};

// ── Admin view / entry of marks for one paper ─────────────────────
const requirePaper = async (schoolId: string, examId: string, scheduleId: string) => {
  const paper = await prisma.examSchedule.findFirst({
    where:   { id: scheduleId, examId, schoolId },
    include: PAPER_INCLUDE,
  });
  if (!paper) throw appError('Exam paper not found', 'EXAM_SCHEDULE_NOT_FOUND', 404);
  return paper;
};

export const listExamPaperStudents = async (
  schoolId: string, examId: string, scheduleId: string, query: ListPaperStudentsQuerySchema,
) => listPaperStudents(await requirePaper(schoolId, examId, scheduleId), query);

export const saveExamPaperMarks = async (
  schoolId: string, examId: string, scheduleId: string, userId: string, input: SaveExamMarksSchema,
) => saveExamMarks(await requirePaper(schoolId, examId, scheduleId), userId, input);
