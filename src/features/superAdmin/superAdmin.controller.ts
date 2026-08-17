import { Request, Response, NextFunction } from 'express';
import * as superAdminService from './superAdmin.service';
import {
  createSchoolSchema,
  updateSchoolSchema,
  createAdminSchema,
  updateAdminSchema,
  updateAdminStatusSchema,
  listSchoolsQuerySchema,
  listAllAdminsQuerySchema,
} from './superAdmin.validation';
import { sendSuccess } from '../../shared/utils/apiResponse';

// ── POST /super-admin/schools ───────────────────────────────────
export const createSchoolHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input  = createSchoolSchema.parse(req.body);
    const result = await superAdminService.createSchool(input);
    sendSuccess(res, result, 201);
  } catch (err) {
    next(err);
  }
};

// ── GET /super-admin/schools ─────────────────────────────────────
export const listSchoolsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query  = listSchoolsQuerySchema.parse(req.query);
    const result = await superAdminService.listSchools(query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── GET /super-admin/schools/:schoolId ────────────────────────────
export const getSchoolByIdHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const school = await superAdminService.getSchoolById(req.params.schoolId);
    sendSuccess(res, school);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /super-admin/schools/:schoolId ──────────────────────────
export const updateSchoolHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input  = updateSchoolSchema.parse(req.body);
    const school = await superAdminService.updateSchool(req.params.schoolId, input);
    sendSuccess(res, school);
  } catch (err) {
    next(err);
  }
};

// ── POST /super-admin/schools/:schoolId/admins ────────────────────
export const createAdminHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input  = createAdminSchema.parse(req.body);
    const result = await superAdminService.createAdminForSchool(req.params.schoolId, input);
    sendSuccess(res, result, 201);
  } catch (err) {
    next(err);
  }
};

// ── GET /super-admin/schools/:schoolId/admins ─────────────────────
export const listAdminsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const admins = await superAdminService.listAdminsForSchool(req.params.schoolId);
    sendSuccess(res, admins);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /super-admin/schools/:schoolId/admins/:adminId ──────────
export const updateAdminHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input = updateAdminSchema.parse(req.body);
    const admin = await superAdminService.updateAdmin(req.params.schoolId, req.params.adminId, input);
    sendSuccess(res, admin);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /super-admin/schools/:schoolId/admins/:adminId/status ───
// Soft delete (isActive: false) / reactivate (isActive: true) — never
// a hard delete, see superAdmin.service.ts for why.
export const setAdminStatusHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { isActive } = updateAdminStatusSchema.parse(req.body);
    const admin = await superAdminService.setAdminStatus(req.params.schoolId, req.params.adminId, isActive);
    sendSuccess(res, admin);
  } catch (err) {
    next(err);
  }
};

// ── GET /super-admin/admins ────────────────────────────────────────
// Every admin across every school (optionally filtered to one via
// ?schoolId=) — distinct from GET /schools/:schoolId/admins above.
export const listAllAdminsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query  = listAllAdminsQuerySchema.parse(req.query);
    const result = await superAdminService.listAllAdmins(query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};
