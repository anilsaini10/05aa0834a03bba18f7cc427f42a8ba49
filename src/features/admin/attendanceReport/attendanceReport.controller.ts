import { Request, Response, NextFunction } from 'express';
import * as attendanceReportService from './attendanceReport.service';
import {
  attendanceDateQuerySchema,
  listClassStudentsAttendanceQuerySchema,
} from './attendanceReport.validation';
import { sendSuccess } from '../../../shared/utils/apiResponse';

// ── GET /admin/attendance/classes ──────────────────────────────
export const listClassSummaryHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query    = attendanceDateQuerySchema.parse(req.query);
    const schoolId = (req as any).user.schoolId;
    const result   = await attendanceReportService.getClassAttendanceSummary(schoolId, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── GET /admin/attendance/classes/:classId/students ────────────
export const listClassStudentsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query    = listClassStudentsAttendanceQuerySchema.parse(req.query);
    const schoolId = (req as any).user.schoolId;
    const result   = await attendanceReportService.listClassStudentsAttendance(schoolId, req.params.classId, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};
