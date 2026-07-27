import { Request, Response, NextFunction } from 'express';
import * as staffService from './staff.service';
import { createStaffSchema, updateStaffSchema, listStaffQuerySchema } from './staff.validation';
import { sendSuccess } from '../../../shared/utils/apiResponse';

// ── POST /admin/staff ────────────────────────────────────────────
export const createHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input    = createStaffSchema.parse(req.body);
    const schoolId = (req as any).user.schoolId;
    const result   = await staffService.createStaff(schoolId, input);
    sendSuccess(res, result, 201);
  } catch (err) {
    next(err);
  }
};

// ── GET /admin/staff ─────────────────────────────────────────────
export const listHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query    = listStaffQuerySchema.parse(req.query);
    const schoolId = (req as any).user.schoolId;
    const result   = await staffService.listStaff(schoolId, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── GET /admin/staff/:staffId ────────────────────────────────────
export const getByIdHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const schoolId = (req as any).user.schoolId;
    const result   = await staffService.getStaffById(schoolId, req.params.staffId);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /admin/staff/:staffId ───────────────────────────────────
export const updateHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input    = updateStaffSchema.parse(req.body);
    const schoolId = (req as any).user.schoolId;
    const result   = await staffService.updateStaff(schoolId, req.params.staffId, input);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── DELETE /admin/staff/:staffId ──────────────────────────────────
export const deleteHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const schoolId = (req as any).user.schoolId;
    await staffService.deleteStaff(schoolId, req.params.staffId);
    sendSuccess(res, { message: 'Staff member deleted successfully' });
  } catch (err) {
    next(err);
  }
};
