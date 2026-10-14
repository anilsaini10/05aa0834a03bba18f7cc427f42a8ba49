import { Request, Response, NextFunction } from 'express';
import * as examsService from './exams.service';
import {
  createExamSchema,
  updateExamSchema,
  listExamsQuerySchema,
  addExamClassSchema,
  listExamClassStudentsQuerySchema,
  createExamResultSchema,
  updateExamResultSchema,
  createExamScheduleSchema,
  bulkCreateExamScheduleSchema,
  updateExamScheduleSchema,
  listExamScheduleQuerySchema,
  listPaperStudentsQuerySchema,
  saveExamMarksSchema,
} from './exams.validation';
import * as examScheduleService from './examSchedule.service';
import { sendSuccess } from '../../../shared/utils/apiResponse';

const schoolIdOf = (req: Request) => (req as any).user.schoolId;
const userIdOf   = (req: Request) => (req as any).user.sub;

// ════════════════════════════════════════════════════════════
// Exam CRUD
// ════════════════════════════════════════════════════════════

export const createHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input  = createExamSchema.parse(req.body);
    const result = await examsService.createExam(schoolIdOf(req), userIdOf(req), input);
    sendSuccess(res, result, 201);
  } catch (err) {
    next(err);
  }
};

export const listHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query  = listExamsQuerySchema.parse(req.query);
    const result = await examsService.listExams(schoolIdOf(req), query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

export const getByIdHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await examsService.getExamById(schoolIdOf(req), req.params.examId);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

export const updateHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input  = updateExamSchema.parse(req.body);
    const result = await examsService.updateExam(schoolIdOf(req), req.params.examId, input);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

export const deleteHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await examsService.deleteExam(schoolIdOf(req), req.params.examId);
    sendSuccess(res, { message: 'Exam deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// ════════════════════════════════════════════════════════════
// Exam ↔ Class assignment
// ════════════════════════════════════════════════════════════

export const addClassHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input   = addExamClassSchema.parse(req.body);
    const classes = await examsService.addExamClass(schoolIdOf(req), req.params.examId, input);
    sendSuccess(res, { examId: req.params.examId, classes }, 201);
  } catch (err) {
    next(err);
  }
};

export const listClassesHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const classes = await examsService.listExamClasses(schoolIdOf(req), req.params.examId);
    sendSuccess(res, classes);
  } catch (err) {
    next(err);
  }
};

export const removeClassHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await examsService.removeExamClass(schoolIdOf(req), req.params.examId, req.params.classId);
    sendSuccess(res, { message: 'Class unassigned from exam' });
  } catch (err) {
    next(err);
  }
};

// ════════════════════════════════════════════════════════════
// Students within an exam's class
// ════════════════════════════════════════════════════════════

export const listClassStudentsHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query  = listExamClassStudentsQuerySchema.parse(req.query);
    const result = await examsService.listExamClassStudents(
      schoolIdOf(req), req.params.examId, req.params.classId, query,
    );
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ════════════════════════════════════════════════════════════
// Exam results
// ════════════════════════════════════════════════════════════

export const createResultHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input  = createExamResultSchema.parse(req.body);
    const result = await examsService.createExamResult(schoolIdOf(req), req.params.examId, input);
    sendSuccess(res, result, 201);
  } catch (err) {
    next(err);
  }
};

export const getResultHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await examsService.getExamResultById(schoolIdOf(req), req.params.examId, req.params.resultId);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

export const updateResultHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input  = updateExamResultSchema.parse(req.body);
    const result = await examsService.updateExamResult(schoolIdOf(req), req.params.examId, req.params.resultId, input);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

export const deleteResultHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await examsService.deleteExamResult(schoolIdOf(req), req.params.examId, req.params.resultId);
    sendSuccess(res, { message: 'Exam result deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// ════════════════════════════════════════════════════════════
// Exam schedule (date sheet) + per-subject marks
// ════════════════════════════════════════════════════════════

export const createScheduleHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input     = createExamScheduleSchema.parse(req.body);
    const [created] = await examScheduleService.createExamPapers(schoolIdOf(req), req.params.examId, userIdOf(req), [input]);
    sendSuccess(res, created, 201);
  } catch (err) {
    next(err);
  }
};

export const bulkCreateScheduleHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { papers } = bulkCreateExamScheduleSchema.parse(req.body);
    const created    = await examScheduleService.createExamPapers(schoolIdOf(req), req.params.examId, userIdOf(req), papers);
    sendSuccess(res, { items: created }, 201);
  } catch (err) {
    next(err);
  }
};

export const listScheduleHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query  = listExamScheduleQuerySchema.parse(req.query);
    const result = await examScheduleService.listExamPapers(schoolIdOf(req), req.params.examId, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

export const updateScheduleHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input  = updateExamScheduleSchema.parse(req.body);
    const result = await examScheduleService.updateExamPaper(schoolIdOf(req), req.params.examId, req.params.scheduleId, input);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

export const deleteScheduleHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await examScheduleService.deleteExamPaper(schoolIdOf(req), req.params.examId, req.params.scheduleId);
    sendSuccess(res, { message: 'Exam paper deleted successfully' });
  } catch (err) {
    next(err);
  }
};

export const listScheduleStudentsHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query  = listPaperStudentsQuerySchema.parse(req.query);
    const result = await examScheduleService.listExamPaperStudents(
      schoolIdOf(req), req.params.examId, req.params.scheduleId, query,
    );
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

export const saveScheduleMarksHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input  = saveExamMarksSchema.parse(req.body);
    const result = await examScheduleService.saveExamPaperMarks(
      schoolIdOf(req), req.params.examId, req.params.scheduleId, userIdOf(req), input,
    );
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};
