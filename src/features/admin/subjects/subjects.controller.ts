import { Request, Response, NextFunction } from 'express';
import * as subjectsService from './subjects.service';
import { createSubjectSchema, updateSubjectSchema, assignSubjectClassesSchema } from './subjects.validation';
import { sendSuccess } from '../../../shared/utils/apiResponse';

// ── GET /subjects ─────────────────────────────────────────────
export const listHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const schoolId = (req as any).user.schoolId;
    const subjects = await subjectsService.listSubjects(schoolId);
    sendSuccess(res, subjects);
  } catch (err) {
    next(err);
  }
};

// ── GET /subjects/:subjectId ──────────────────────────────────
export const getByIdHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const schoolId = (req as any).user.schoolId;
    sendSuccess(res, await subjectsService.getSubjectById(schoolId, req.params.subjectId));
  } catch (err) {
    next(err);
  }
};

// ── POST /subjects ────────────────────────────────────────────
export const createHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input    = createSubjectSchema.parse(req.body);
    const schoolId = (req as any).user.schoolId;
    const subject  = await subjectsService.createSubject(schoolId, input);
    sendSuccess(res, subject, 201);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /subjects/:subjectId ────────────────────────────────
export const updateHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input    = updateSubjectSchema.parse(req.body);
    const schoolId = (req as any).user.schoolId;
    sendSuccess(res, await subjectsService.updateSubject(schoolId, req.params.subjectId, input));
  } catch (err) {
    next(err);
  }
};

// ── DELETE /subjects/:subjectId ───────────────────────────────
export const deleteHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const schoolId = (req as any).user.schoolId;
    await subjectsService.deleteSubject(schoolId, req.params.subjectId);
    sendSuccess(res, { message: 'Subject deactivated successfully' });
  } catch (err) {
    next(err);
  }
};

// ── PATCH /subjects/:subjectId/status ─────────────────────────
export const toggleStatusHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const schoolId = (req as any).user.schoolId;
    sendSuccess(res, await subjectsService.toggleSubjectStatus(schoolId, req.params.subjectId));
  } catch (err) {
    next(err);
  }
};

// ── POST /subjects/:subjectId/classes ─────────────────────────
export const assignClassesHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input    = assignSubjectClassesSchema.parse(req.body);
    const schoolId = (req as any).user.schoolId;
    sendSuccess(res, await subjectsService.assignSubjectToClasses(schoolId, req.params.subjectId, input));
  } catch (err) {
    next(err);
  }
};

// ── GET /subjects/by-class/:classId ───────────────────────────
export const getByClassHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const schoolId = (req as any).user.schoolId;
    sendSuccess(res, await subjectsService.getSubjectsByClass(schoolId, req.params.classId));
  } catch (err) {
    next(err);
  }
};
