import { Request, Response, NextFunction } from 'express';
import * as classScheduleService from './classSchedule.service';
import {
  createScheduleSchema,
  updateScheduleSchema,
  listScheduleQuerySchema,
} from './classSchedule.validation';
import { sendSuccess } from '../../../shared/utils/apiResponse';

const schoolIdOf = (req: Request) => (req as any).user.schoolId;
const userIdOf   = (req: Request) => (req as any).user.sub;

// ── POST /admin/schedule ────────────────────────────────────────
export const createHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input  = createScheduleSchema.parse(req.body);
    const result = await classScheduleService.createSchedule(schoolIdOf(req), userIdOf(req), input);
    sendSuccess(res, result, 201);
  } catch (err) {
    next(err);
  }
};

// ── GET /admin/schedule ─────────────────────────────────────────
export const listHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query  = listScheduleQuerySchema.parse(req.query);
    const result = await classScheduleService.listSchedule(schoolIdOf(req), query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── GET /admin/schedule/:scheduleId ─────────────────────────────
export const getByIdHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await classScheduleService.getScheduleById(schoolIdOf(req), req.params.scheduleId);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /admin/schedule/:scheduleId ───────────────────────────
export const updateHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input  = updateScheduleSchema.parse(req.body);
    const result = await classScheduleService.updateSchedule(schoolIdOf(req), req.params.scheduleId, input);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── DELETE /admin/schedule/:scheduleId ──────────────────────────
export const deleteHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await classScheduleService.deleteSchedule(schoolIdOf(req), req.params.scheduleId);
    sendSuccess(res, { message: 'Schedule entry deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// ── GET /admin/schedule/sections/:sectionId ─────────────────────
export const getSectionTimetableHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await classScheduleService.getSectionTimetable(schoolIdOf(req), req.params.sectionId);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── GET /admin/schedule/teachers/:teacherId ─────────────────────
export const getTeacherTimetableHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await classScheduleService.getTeacherTimetable(schoolIdOf(req), req.params.teacherId);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};
