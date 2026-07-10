import { Request, Response, NextFunction } from 'express';
import * as teacherService from './teacher.service';
import {
  updateProfileSchema,
  resetPasswordSchema,
  listMyStudentsQuerySchema,
} from './teacher.validation';
import { sendSuccess } from '../../shared/utils/apiResponse';

// ── GET /teacher/profile ──────────────────────────────────────
export const getProfileHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const profile = await teacherService.getProfile((req as any).user.sub);
    sendSuccess(res, profile);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /teacher/profile ────────────────────────────────────
export const updateProfileHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input   = updateProfileSchema.parse(req.body);
    const profile = await teacherService.updateProfile((req as any).user.sub, input);
    sendSuccess(res, profile);
  } catch (err) {
    next(err);
  }
};

// ── POST /teacher/reset-password ──────────────────────────────
export const resetPasswordHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { currentPassword, newPassword } = resetPasswordSchema.parse(req.body);
    await teacherService.resetPassword((req as any).user.sub, currentPassword, newPassword);
    sendSuccess(res, { message: 'Password updated successfully. Please log in again on other devices.' });
  } catch (err) {
    next(err);
  }
};

// ── GET /teacher/classes ───────────────────────────────────────
export const listClassesHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const classes = await teacherService.listMyClasses((req as any).user.sub);
    sendSuccess(res, classes);
  } catch (err) {
    next(err);
  }
};

// ── GET /teacher/students ─────────────────────────────────────
export const listStudentsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query  = listMyStudentsQuerySchema.parse(req.query);
    const result = await teacherService.listMyStudents((req as any).user.sub, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};
