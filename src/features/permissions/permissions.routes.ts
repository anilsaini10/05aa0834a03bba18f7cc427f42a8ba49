import { Router } from 'express';
import {
  getSchoolPermissionsHandler, replaceSchoolPermissionsHandler, patchSchoolPermissionsHandler, getSchoolRolePermissionsHandler,
  getSchoolRoleLimitsHandler, replaceSchoolRoleLimitsHandler, patchSchoolRoleLimitsHandler,
  getMySchoolPermissionsHandler, listRolePermissionsHandler, getRolePermissionsHandler,
  replaceRolePermissionsHandler, patchRolePermissionsHandler, getMyPermissionsHandler,
} from './permissions.controller';
import { authGuard } from '../../middleware/authGuard';
import { roleGuard } from '../../middleware/roleGuard';

// ── SUPER_ADMIN: what a school may do ─────────────────────────
// Mounted at /api/super-admin/schools/:schoolId — guards are per route
// (not router.use) so the rest of /schools/:schoolId/* passes through
// untouched to the main super-admin router.
export const superAdminSchoolPermissionsRouter = Router({ mergeParams: true });
const superAdmin = [authGuard, roleGuard('SUPER_ADMIN')] as const;

superAdminSchoolPermissionsRouter.get('/permissions',       ...superAdmin, getSchoolPermissionsHandler);
superAdminSchoolPermissionsRouter.put('/permissions',       ...superAdmin, replaceSchoolPermissionsHandler);
superAdminSchoolPermissionsRouter.patch('/permissions',     ...superAdmin, patchSchoolPermissionsHandler);
superAdminSchoolPermissionsRouter.get('/role-permissions',  ...superAdmin, getSchoolRolePermissionsHandler);
// Per-role limits; :roleId is ADMIN / TEACHER / PARENT or a custom role's id.
superAdminSchoolPermissionsRouter.get('/role-permissions/:roleId',   ...superAdmin, getSchoolRoleLimitsHandler);
superAdminSchoolPermissionsRouter.put('/role-permissions/:roleId',   ...superAdmin, replaceSchoolRoleLimitsHandler);
superAdminSchoolPermissionsRouter.patch('/role-permissions/:roleId', ...superAdmin, patchSchoolRoleLimitsHandler);

// ── School ADMIN: own school (read-only) + per-role permissions ─
// Mounted at /api/admin/permissions.
export const adminPermissionsRouter = Router();
adminPermissionsRouter.use(authGuard, roleGuard('ADMIN'));

adminPermissionsRouter.get('/school',          getMySchoolPermissionsHandler);
adminPermissionsRouter.get('/roles',           listRolePermissionsHandler);
adminPermissionsRouter.get('/roles/:roleId',   getRolePermissionsHandler);
adminPermissionsRouter.put('/roles/:roleId',   replaceRolePermissionsHandler);
adminPermissionsRouter.patch('/roles/:roleId', patchRolePermissionsHandler);

// ── Anyone logged in: own effective permissions ───────────────
// Mounted at /api/auth/permissions.
export const myPermissionsRouter = Router();
myPermissionsRouter.get('/', authGuard, getMyPermissionsHandler);
