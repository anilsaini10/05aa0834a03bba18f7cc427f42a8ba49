import { Request, Response, NextFunction } from 'express';
import * as permissionsService from './permissions.service';
import {
  replacePermissionsSchema, patchPermissionsSchema, schoolIdParamSchema, roleIdParamSchema, schoolRoleParamSchema,
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

// ── SUPER_ADMIN: per-role limits in a school ──────────────────
// Body is { permissions } like everywhere else; it's stored as the role's
// limits (for ADMIN: the school's permissions).

export const getSchoolRolePermissionsHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { schoolId } = schoolIdParamSchema.parse(req.params);
    sendSuccess(res, await permissionsService.listRoleLimits(schoolId));
  } catch (err) {
    next(err);
  }
};

export const getSchoolRoleLimitsHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { schoolId, roleId } = schoolRoleParamSchema.parse(req.params);
    sendSuccess(res, await permissionsService.getRoleLimits(schoolId, roleId));
  } catch (err) {
    next(err);
  }
};

export const replaceSchoolRoleLimitsHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { schoolId, roleId } = schoolRoleParamSchema.parse(req.params);
    const { permissions }      = replacePermissionsSchema.parse(req.body);
    sendSuccess(res, await permissionsService.replaceRoleLimits(schoolId, userOf(req).sub, roleId, permissions));
  } catch (err) {
    next(err);
  }
};

export const patchSchoolRoleLimitsHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { schoolId, roleId } = schoolRoleParamSchema.parse(req.params);
    const { permissions }      = patchPermissionsSchema.parse(req.body);
    sendSuccess(res, await permissionsService.patchRoleLimits(schoolId, userOf(req).sub, roleId, permissions));
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
