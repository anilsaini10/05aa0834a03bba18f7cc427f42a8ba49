import { Request, Response, NextFunction } from 'express';
import * as studentsService from './students.service';
import {
  updateProfileSchema,
  resetPasswordSchema,
  listMyAnnouncementsQuerySchema,
  listMyEventsQuerySchema,
  listMyExamsQuerySchema,
  getMyExamResultQuerySchema,
  getMyChildTimetableQuerySchema,
  getMyDashboardQuerySchema,
  getMyChildAttendanceQuerySchema,
  applyLeaveSchema,
  listMyLeaveQuerySchema,
  listMyChildHomeworkQuerySchema,
  getMyChildHomeworkQuerySchema,
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

// ── GET /students/dashboard ────────────────────────────────────
export const getDashboardHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query  = getMyDashboardQuerySchema.parse(req.query);
    const result = await studentsService.getMyDashboard((req as any).user.sub, query);
    sendSuccess(res, result);
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

// ── GET /students/events ──────────────────────────────────────
export const listEventsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query  = listMyEventsQuerySchema.parse(req.query);
    const result = await studentsService.listMyEvents((req as any).user.sub, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── GET /students/exams ─────────────────────────────────────────
export const listExamsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query  = listMyExamsQuerySchema.parse(req.query);
    const result = await studentsService.listMyExams((req as any).user.sub, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── GET /students/exams/:examId ──────────────────────────────────
export const getExamResultHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query  = getMyExamResultQuerySchema.parse(req.query);
    const result = await studentsService.getMyExamResult((req as any).user.sub, req.params.examId, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── GET /students/timetable ────────────────────────────────────────
export const getTimetableHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query  = getMyChildTimetableQuerySchema.parse(req.query);
    const result = await studentsService.getMyChildTimetable((req as any).user.sub, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── GET /students/attendance ──────────────────────────────────────
export const getAttendanceHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query  = getMyChildAttendanceQuerySchema.parse(req.query);
    const result = await studentsService.getMyChildAttendance((req as any).user.sub, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── POST /students/leave ────────────────────────────────────────
export const applyLeaveHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input  = applyLeaveSchema.parse(req.body);
    const result = await studentsService.applyLeave((req as any).user.sub, input);
    sendSuccess(res, result, 201);
  } catch (err) {
    next(err);
  }
};

// ── GET /students/leave ──────────────────────────────────────────
export const listLeaveHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query  = listMyLeaveQuerySchema.parse(req.query);
    const result = await studentsService.listMyLeave((req as any).user.sub, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── DELETE /students/leave/:leaveId ───────────────────────────────
export const cancelLeaveHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    await studentsService.cancelLeave((req as any).user.sub, req.params.leaveId);
    sendSuccess(res, { message: 'Leave request cancelled successfully' });
  } catch (err) {
    next(err);
  }
};

// ── GET /students/homework ────────────────────────────────────────
export const listHomeworkHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query  = listMyChildHomeworkQuerySchema.parse(req.query);
    const result = await studentsService.listMyChildHomework((req as any).user.sub, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── GET /students/homework/:homeworkId ────────────────────────────
export const getHomeworkHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query  = getMyChildHomeworkQuerySchema.parse(req.query);
    const result = await studentsService.getMyChildHomework((req as any).user.sub, req.params.homeworkId, query);
    sendSuccess(res, result);
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
