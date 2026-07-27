import { Request, Response, NextFunction } from 'express';
import * as teacherAttendanceService from './teacherAttendance.service';
import {
  markTeacherAttendanceSchema,
  listTeacherAttendanceQuerySchema,
  updateTeacherAttendanceSchema,
} from './teacherAttendance.validation';
import { sendSuccess } from '../../../shared/utils/apiResponse';

// ── POST /admin/teacher-attendance ──────────────────────────────
export const markHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input    = markTeacherAttendanceSchema.parse(req.body);
    const schoolId = (req as any).user.schoolId;
    const userId   = (req as any).user.sub;
    const result   = await teacherAttendanceService.markTeacherAttendance(schoolId, userId, input);
    sendSuccess(res, result, 201);
  } catch (err) {
    next(err);
  }
};

// ── GET /admin/teacher-attendance ───────────────────────────────
export const listHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query    = listTeacherAttendanceQuerySchema.parse(req.query);
    const schoolId = (req as any).user.schoolId;
    const result   = await teacherAttendanceService.listTeacherAttendance(schoolId, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /admin/teacher-attendance/:recordId ───────────────────
export const updateHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input    = updateTeacherAttendanceSchema.parse(req.body);
    const schoolId = (req as any).user.schoolId;
    const userId   = (req as any).user.sub;
    const result   = await teacherAttendanceService.updateTeacherAttendance(schoolId, userId, req.params.recordId, input);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};
