import { Request, Response, NextFunction } from 'express';
import * as permissionsService from './permissions.service';
import {
  replacePermissionsSchema, patchPermissionsSchema, schoolIdParamSchema, roleIdParamSchema,
} from './permissions.validation';
import { sendSuccess } from '../../shared/utils/apiResponse';

const userOf = (req: Request): { sub: string; role: any; schoolId: string } => (req as any).user;

// ── SUPER_ADMIN: a school's permissions ───────────────────────

export const getSchoolPermissionsHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { schoolId } = schoolIdParamSchema.parse(req.params);
    sendSuccess(res, await permissionsService.getSchoolPermissions(schoolId));
  } catch (err) {
    next(err);
  }
};

export const replaceSchoolPermissionsHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { schoolId }    = schoolIdParamSchema.parse(req.params);
    const { permissions } = replacePermissionsSchema.parse(req.body);
    sendSuccess(res, await permissionsService.replaceSchoolPermissions(schoolId, permissions));
  } catch (err) {
    next(err);
  }
};

export const patchSchoolPermissionsHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { schoolId }    = schoolIdParamSchema.parse(req.params);
    const { permissions } = patchPermissionsSchema.parse(req.body);
    sendSuccess(res, await permissionsService.patchSchoolPermissions(schoolId, permissions));
  } catch (err) {
    next(err);
  }
};

// Read-only: what this school's admin gave each role.
export const getSchoolRolePermissionsHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { schoolId } = schoolIdParamSchema.parse(req.params);
    sendSuccess(res, await permissionsService.listRolePermissions(schoolId, true));
  } catch (err) {
    next(err);
  }
};

// ── ADMIN: own school (read) + role permissions ───────────────

export const getMySchoolPermissionsHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, await permissionsService.getSchoolPermissions(userOf(req).schoolId));
  } catch (err) {
    next(err);
  }
};

export const listRolePermissionsHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, await permissionsService.listRolePermissions(userOf(req).schoolId));
  } catch (err) {
    next(err);
  }
};

export const getRolePermissionsHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { roleId } = roleIdParamSchema.parse(req.params);
    sendSuccess(res, await permissionsService.getRolePermissions(userOf(req).schoolId, roleId));
  } catch (err) {
    next(err);
  }
};

export const replaceRolePermissionsHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { roleId }      = roleIdParamSchema.parse(req.params);
    const { permissions } = replacePermissionsSchema.parse(req.body);
    const { sub, schoolId } = userOf(req);
    sendSuccess(res, await permissionsService.replaceRolePermissions(schoolId, sub, roleId, permissions));
  } catch (err) {
    next(err);
  }
};

export const patchRolePermissionsHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { roleId }      = roleIdParamSchema.parse(req.params);
    const { permissions } = patchPermissionsSchema.parse(req.body);
    const { sub, schoolId } = userOf(req);
    sendSuccess(res, await permissionsService.patchRolePermissions(schoolId, sub, roleId, permissions));
  } catch (err) {
    next(err);
  }
};

// ── Any logged-in user: own effective permissions ─────────────

export const getMyPermissionsHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, await permissionsService.getMyPermissions(userOf(req)));
  } catch (err) {
    next(err);
  }
};
