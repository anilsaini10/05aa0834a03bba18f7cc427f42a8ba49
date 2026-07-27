import { Request, Response, NextFunction } from 'express';
import * as leaveService from './leave.service';
import { listLeaveQuerySchema, reviewLeaveSchema, listTeacherLeaveQuerySchema } from './leave.validation';
import { sendSuccess } from '../../../shared/utils/apiResponse';

// ── GET /admin/leave ─────────────────────────────────────────────
export const listHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query    = listLeaveQuerySchema.parse(req.query);
    const schoolId = (req as any).user.schoolId;
    const result   = await leaveService.listLeaveRequests(schoolId, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /admin/leave/:leaveId ──────────────────────────────────
export const reviewHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input    = reviewLeaveSchema.parse(req.body);
    const schoolId = (req as any).user.schoolId;
    const userId   = (req as any).user.sub;
    const result   = await leaveService.reviewLeaveRequest(schoolId, userId, req.params.leaveId, input);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── GET /admin/leave/teachers ─────────────────────────────────────
export const listTeacherLeaveHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query    = listTeacherLeaveQuerySchema.parse(req.query);
    const schoolId = (req as any).user.schoolId;
    const result   = await leaveService.listTeacherLeaveRequests(schoolId, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /admin/leave/teachers/:leaveId ──────────────────────────
export const reviewTeacherLeaveHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input    = reviewLeaveSchema.parse(req.body);
    const schoolId = (req as any).user.schoolId;
    const userId   = (req as any).user.sub;
    const result   = await leaveService.reviewTeacherLeaveRequest(schoolId, userId, req.params.leaveId, input);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};
