import { Request, Response, NextFunction } from 'express';
import * as rolesService from './customRoles.service';
import * as roleUsersService from './roleUsers.service';
import {
  createRoleSchema, updateRoleSchema, listRolesQuerySchema,
  createRoleUserSchema, updateRoleUserSchema, listRoleUsersQuerySchema,
} from './customRoles.validation';
import { sendSuccess } from '../../shared/utils/apiResponse';

const userOf = (req: Request): { sub: string; schoolId: string } => (req as any).user;

// ── SUPER_ADMIN: roles ────────────────────────────────────────

export const createRoleHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = createRoleSchema.parse(req.body);
    sendSuccess(res, await rolesService.createRole(userOf(req).sub, input), 201);
  } catch (err) {
    next(err);
  }
};

export const listRolesHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query = listRolesQuerySchema.parse(req.query);
    sendSuccess(res, await rolesService.listRoles(query));
  } catch (err) {
    next(err);
  }
};

export const getRoleHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, await rolesService.getRole(req.params.roleId));
  } catch (err) {
    next(err);
  }
};

export const updateRoleHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = updateRoleSchema.parse(req.body);
    sendSuccess(res, await rolesService.updateRole(req.params.roleId, input));
  } catch (err) {
    next(err);
  }
};

export const deleteRoleHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await rolesService.deleteRole(req.params.roleId);
    sendSuccess(res, { message: 'Role deleted' });
  } catch (err) {
    next(err);
  }
};

// ── ADMIN: roles to choose from ───────────────────────────────

export const listSchoolRolesHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, await rolesService.listRolesForSchool(userOf(req).schoolId));
  } catch (err) {
    next(err);
  }
};

// ── ADMIN: accounts with a custom role ────────────────────────

export const createRoleUserHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = createRoleUserSchema.parse(req.body);
    sendSuccess(res, await roleUsersService.createRoleUser(userOf(req).schoolId, input), 201);
  } catch (err) {
    next(err);
  }
};

export const listRoleUsersHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query = listRoleUsersQuerySchema.parse(req.query);
    sendSuccess(res, await roleUsersService.listRoleUsers(userOf(req).schoolId, query));
  } catch (err) {
    next(err);
  }
};

export const getRoleUserHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, await roleUsersService.getRoleUser(userOf(req).schoolId, req.params.userId));
  } catch (err) {
    next(err);
  }
};

export const updateRoleUserHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = updateRoleUserSchema.parse(req.body);
    sendSuccess(res, await roleUsersService.updateRoleUser(userOf(req).schoolId, req.params.userId, input));
  } catch (err) {
    next(err);
  }
};
