import { Request, Response, NextFunction } from 'express';
import * as teachersService from './teachers.service';
import { createTeacherSchema, listTeachersQuerySchema } from './teachers.validation';
import { sendSuccess } from '../../shared/utils/apiResponse';

// ── POST /admin/teachers ──────────────────────────────────────
export const createHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input    = createTeacherSchema.parse(req.body);
    const schoolId = (req as any).user.schoolId;
    const result   = await teachersService.createTeacher(schoolId, input);
    sendSuccess(res, result, 201);
  } catch (err) {
    next(err);
  }
};

// ── GET /admin/teachers ───────────────────────────────────────
export const listHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query    = listTeachersQuerySchema.parse(req.query);
    const schoolId = (req as any).user.schoolId;
    const result   = await teachersService.listTeachers(schoolId, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};
