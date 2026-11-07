import { Request, Response, NextFunction } from 'express';
import * as roleDisplayService from './roleDisplay.service';
import {
  listLoginRolesQuerySchema,
  listSchoolsQuerySchema,
  updateRoleDisplaySchema,
  bulkUpdateRoleDisplaySchema,
} from './roleDisplay.validation';
import { sendSuccess } from '../../shared/utils/apiResponse';

// ── Public: GET /api/auth/roles?platform=web|mobile[&schoolId=...] ─
export const listLoginRolesHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { platform, schoolId } = listLoginRolesQuerySchema.parse(req.query);
    sendSuccess(res, await roleDisplayService.listLoginRoles(platform, schoolId));
  } catch (err) {
    next(err);
  }
};

// ── Public: GET /api/auth/schools?search=... ────────────────────
export const listSchoolsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { search } = listSchoolsQuerySchema.parse(req.query);
    sendSuccess(res, await roleDisplayService.listSchoolsForLogin(search));
  } catch (err) {
    next(err);
  }
};

// ── Admin / Super Admin: GET role-display ────────────────────────
export const listAllDisplayConfigsHandler = async (
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    sendSuccess(res, await roleDisplayService.listAllDisplayConfigs());
  } catch (err) {
    next(err);
  }
};

// ── Admin / Super Admin: PATCH role-display/:configId ────────────
export const updateDisplayConfigHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input = updateRoleDisplaySchema.parse(req.body);
    sendSuccess(res, await roleDisplayService.updateDisplayConfig(req.params.configId, input));
  } catch (err) {
    next(err);
  }
};

// ── Admin / Super Admin: PUT role-display/bulk ───────────────────
export const bulkUpdateDisplayConfigsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input = bulkUpdateRoleDisplaySchema.parse(req.body);
    sendSuccess(res, await roleDisplayService.bulkUpdateDisplayConfigs(input));
  } catch (err) {
    next(err);
  }
};
