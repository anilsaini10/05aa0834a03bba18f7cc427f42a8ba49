import { Request, Response, NextFunction } from 'express';
import * as subjectsService from './subjects.service';
import { createSubjectSchema } from './subjects.validation';
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
