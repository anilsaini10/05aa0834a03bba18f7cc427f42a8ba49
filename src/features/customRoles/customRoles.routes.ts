import { Router } from 'express';
import {
  createRoleHandler, listRolesHandler, getRoleHandler, updateRoleHandler, deleteRoleHandler,
  listSchoolRolesHandler,
  createRoleUserHandler, listRoleUsersHandler, getRoleUserHandler, updateRoleUserHandler,
} from './customRoles.controller';
import { authGuard } from '../../middleware/authGuard';
import { roleGuard } from '../../middleware/roleGuard';

// ── SUPER_ADMIN: define roles ─────────────────────────────────
// Mounted at /api/super-admin/roles.
export const superAdminRolesRouter = Router();
superAdminRolesRouter.use(authGuard, roleGuard('SUPER_ADMIN'));

superAdminRolesRouter.post('/',           createRoleHandler);
superAdminRolesRouter.get('/',            listRolesHandler);
superAdminRolesRouter.get('/:roleId',     getRoleHandler);
superAdminRolesRouter.patch('/:roleId',   updateRoleHandler);
superAdminRolesRouter.delete('/:roleId',  deleteRoleHandler);

// ── School ADMIN: pick a role ─────────────────────────────────
// Mounted at /api/admin/roles.
export const adminRolesRouter = Router();
adminRolesRouter.get('/', authGuard, roleGuard('ADMIN'), listSchoolRolesHandler);

// ── School ADMIN: accounts with a custom role ─────────────────
// Mounted at /api/admin/role-users.
export const adminRoleUsersRouter = Router();
adminRoleUsersRouter.use(authGuard, roleGuard('ADMIN'));

adminRoleUsersRouter.post('/',           createRoleUserHandler);
adminRoleUsersRouter.get('/',            listRoleUsersHandler);
adminRoleUsersRouter.get('/:userId',     getRoleUserHandler);
adminRoleUsersRouter.patch('/:userId',   updateRoleUserHandler);
