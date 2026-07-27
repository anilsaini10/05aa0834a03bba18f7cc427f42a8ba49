import { Request, Response, NextFunction } from 'express';
import * as teacherService from './teacher.service';
import {
  updateProfileSchema,
  resetPasswordSchema,
  listMyStudentsQuerySchema,
  listMyAnnouncementsQuerySchema,
  listMyEventsQuerySchema,
  getSectionAttendanceQuerySchema,
  markAttendanceSchema,
  studentAttendanceHistoryQuerySchema,
  updateAttendanceRecordSchema,
  createHomeworkSchema,
  updateHomeworkSchema,
  listMyHomeworkQuerySchema,
  listLeaveRequestsQuerySchema,
  reviewLeaveRequestSchema,
  applyMyLeaveSchema,
  listMyLeaveQuerySchema,
  listMyAttendanceRecordsQuerySchema,
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

// ── GET /teacher/dashboard ─────────────────────────────────────
export const getDashboardHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const stats = await teacherService.getDashboardStats((req as any).user.sub);
    sendSuccess(res, stats);
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

// ── GET /teacher/announcements ─────────────────────────────────
export const listAnnouncementsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query  = listMyAnnouncementsQuerySchema.parse(req.query);
    const result = await teacherService.listMyAnnouncements((req as any).user.sub, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── GET /teacher/events ────────────────────────────────────────
export const listEventsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query  = listMyEventsQuerySchema.parse(req.query);
    const result = await teacherService.listMyEvents((req as any).user.sub, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── GET /teacher/schedule/today ──────────────────────────────────
export const getTodayScheduleHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const result = await teacherService.getTodaySchedule((req as any).user.sub);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── GET /teacher/schedule/week ────────────────────────────────────
export const getWeekScheduleHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const result = await teacherService.getWeekSchedule((req as any).user.sub);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── GET /teacher/attendance ─────────────────────────────────────
export const getSectionAttendanceHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query  = getSectionAttendanceQuerySchema.parse(req.query);
    const result = await teacherService.getSectionAttendance((req as any).user.sub, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── POST /teacher/attendance ────────────────────────────────────
export const markAttendanceHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input  = markAttendanceSchema.parse(req.body);
    const result = await teacherService.markAttendance((req as any).user.sub, input);
    sendSuccess(res, result, 201);
  } catch (err) {
    next(err);
  }
};

// ── GET /teacher/attendance/students/:studentId ─────────────────
export const getStudentAttendanceHistoryHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query  = studentAttendanceHistoryQuerySchema.parse(req.query);
    const result = await teacherService.getStudentAttendanceHistory(
      (req as any).user.sub, req.params.studentId, query,
    );
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /teacher/attendance/:recordId ──────────────────────────
export const updateAttendanceRecordHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input  = updateAttendanceRecordSchema.parse(req.body);
    const result = await teacherService.updateAttendanceRecord(
      (req as any).user.sub, req.params.recordId, input,
    );
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── POST /teacher/homework ──────────────────────────────────────
export const createHomeworkHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input  = createHomeworkSchema.parse(req.body);
    const result = await teacherService.createHomework((req as any).user.sub, input);
    sendSuccess(res, result, 201);
  } catch (err) {
    next(err);
  }
};

// ── GET /teacher/homework ───────────────────────────────────────
export const listHomeworkHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query  = listMyHomeworkQuerySchema.parse(req.query);
    const result = await teacherService.listMyHomework((req as any).user.sub, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── GET /teacher/homework/:homeworkId ───────────────────────────
export const getHomeworkHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const result = await teacherService.getHomeworkById((req as any).user.sub, req.params.homeworkId);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /teacher/homework/:homeworkId ─────────────────────────
export const updateHomeworkHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input  = updateHomeworkSchema.parse(req.body);
    const result = await teacherService.updateHomework((req as any).user.sub, req.params.homeworkId, input);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── DELETE /teacher/homework/:homeworkId ────────────────────────
export const deleteHomeworkHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    await teacherService.deleteHomework((req as any).user.sub, req.params.homeworkId);
    sendSuccess(res, { message: 'Homework deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// ── GET /teacher/my-attendance ────────────────────────────────────
export const listMyAttendanceRecordsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query  = listMyAttendanceRecordsQuerySchema.parse(req.query);
    const result = await teacherService.listMyAttendanceRecords((req as any).user.sub, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── GET /teacher/leave ────────────────────────────────────────────
export const listLeaveRequestsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query  = listLeaveRequestsQuerySchema.parse(req.query);
    const result = await teacherService.listLeaveRequests((req as any).user.sub, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /teacher/leave/:leaveId ─────────────────────────────────
export const reviewLeaveRequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input  = reviewLeaveRequestSchema.parse(req.body);
    const result = await teacherService.reviewLeaveRequest((req as any).user.sub, req.params.leaveId, input);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── POST /teacher/my-leave ─────────────────────────────────────────
export const applyMyLeaveHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input  = applyMyLeaveSchema.parse(req.body);
    const result = await teacherService.applyMyLeave((req as any).user.sub, input);
    sendSuccess(res, result, 201);
  } catch (err) {
    next(err);
  }
};

// ── GET /teacher/my-leave ───────────────────────────────────────────
export const listMyLeaveHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query  = listMyLeaveQuerySchema.parse(req.query);
    const result = await teacherService.listMyLeaveHistory((req as any).user.sub, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── DELETE /teacher/my-leave/:leaveId ────────────────────────────────
export const cancelMyLeaveHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    await teacherService.cancelMyLeave((req as any).user.sub, req.params.leaveId);
    sendSuccess(res, { message: 'Leave request cancelled successfully' });
  } catch (err) {
    next(err);
  }
};
