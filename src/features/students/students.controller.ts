import { Request, Response, NextFunction } from 'express';
import * as studentsService from './students.service';
import {
  updateProfileSchema,
  resetPasswordSchema,
  listMyAnnouncementsQuerySchema,
} from './students.validation';
import { sendSuccess } from '../../shared/utils/apiResponse';

// ── GET /students/profile ─────────────────────────────────────
export const getProfileHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const profile = await studentsService.getProfile((req as any).user.sub);
    sendSuccess(res, profile);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /students/profile ───────────────────────────────────
export const updateProfileHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input   = updateProfileSchema.parse(req.body);
    const profile = await studentsService.updateProfile((req as any).user.sub, input);
    sendSuccess(res, profile);
  } catch (err) {
    next(err);
  }
};

// ── POST /students/reset-password ─────────────────────────────
export const resetPasswordHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { currentPassword, newPassword } = resetPasswordSchema.parse(req.body);
    await studentsService.resetPassword((req as any).user.sub, currentPassword, newPassword);
    sendSuccess(res, { message: 'Password updated successfully. Please log in again on other devices.' });
  } catch (err) {
    next(err);
  }
};

// ── GET /students/announcements ────────────────────────────────
export const listAnnouncementsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query  = listMyAnnouncementsQuerySchema.parse(req.query);
    const result = await studentsService.listMyAnnouncements((req as any).user.sub, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};
