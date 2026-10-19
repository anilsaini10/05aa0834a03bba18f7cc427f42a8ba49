import { Request, Response, NextFunction } from 'express';
import * as calendarService from './academicCalendar.service';
import { academicCalendarQuerySchema, parentAcademicCalendarQuerySchema } from './academicCalendar.validation';
import { sendSuccess } from '../../shared/utils/apiResponse';

// ── GET /admin/academic-calendar ──────────────────────────────
export const getAdminCalendarHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query = academicCalendarQuerySchema.parse(req.query);
    sendSuccess(res, await calendarService.getAdminCalendar((req as any).user.schoolId, query));
  } catch (err) {
    next(err);
  }
};

// ── GET /teacher/academic-calendar ────────────────────────────
export const getTeacherCalendarHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query = academicCalendarQuerySchema.parse(req.query);
    sendSuccess(res, await calendarService.getTeacherCalendar((req as any).user.schoolId, query));
  } catch (err) {
    next(err);
  }
};

// ── GET /students/academic-calendar?studentId= ────────────────
export const getParentCalendarHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { studentId, ...query } = parentAcademicCalendarQuerySchema.parse(req.query);
    sendSuccess(res, await calendarService.getParentCalendar((req as any).user.sub, studentId, query));
  } catch (err) {
    next(err);
  }
};
