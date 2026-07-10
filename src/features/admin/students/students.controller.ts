import { Request, Response, NextFunction } from 'express';
import * as studentsService from './students.service';
import { createStudentSchema, listStudentsQuerySchema } from './students.validation';
import { sendSuccess } from '../../../shared/utils/apiResponse';

// ── POST /admin/students ──────────────────────────────────────
export const createHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input     = createStudentSchema.parse(req.body);
    const schoolId  = (req as any).user.schoolId;
    const result    = await studentsService.createStudent(schoolId, input);
    sendSuccess(res, result, 201);
  } catch (err) {
    next(err);
  }
};

// ── GET /admin/students ───────────────────────────────────────
export const listHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query    = listStudentsQuerySchema.parse(req.query);
    const schoolId = (req as any).user.schoolId;
    const result   = await studentsService.listStudents(schoolId, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};
