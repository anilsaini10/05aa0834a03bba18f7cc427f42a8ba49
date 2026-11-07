import { Router } from 'express';
import {
  listLoginRolesHandler,
  listSchoolsHandler,
  listAllDisplayConfigsHandler,
  updateDisplayConfigHandler,
  bulkUpdateDisplayConfigsHandler,
} from './roleDisplay.controller';
import { authGuard } from '../../middleware/authGuard';
import { roleGuard } from '../../middleware/roleGuard';

// ── Public: login screen role picker ─────────────────────────────
// Mounted at /api/auth/roles — no auth needed.
export const publicRolesRouter = Router();
publicRolesRouter.get('/', listLoginRolesHandler);

// ── Public: school picker for "Other" login flow ─────────────────
// Mounted at /api/auth/schools — no auth needed.
export const publicSchoolsRouter = Router();
publicSchoolsRouter.get('/', listSchoolsHandler);

// ── Super Admin: manage role display config ──────────────────────
// Mounted at /api/super-admin/role-display.
export const superAdminRoleDisplayRouter = Router();
superAdminRoleDisplayRouter.use(authGuard, roleGuard('SUPER_ADMIN'));

superAdminRoleDisplayRouter.get('/',             listAllDisplayConfigsHandler);
superAdminRoleDisplayRouter.patch('/:configId',  updateDisplayConfigHandler);
superAdminRoleDisplayRouter.put('/bulk',          bulkUpdateDisplayConfigsHandler);

// ── Admin: manage role display config ────────────────────────────
// Mounted at /api/admin/role-display — same endpoints, ADMIN access.
export const adminRoleDisplayRouter = Router();
adminRoleDisplayRouter.use(authGuard, roleGuard('ADMIN'));

adminRoleDisplayRouter.get('/',             listAllDisplayConfigsHandler);
adminRoleDisplayRouter.patch('/:configId',  updateDisplayConfigHandler);
adminRoleDisplayRouter.put('/bulk',          bulkUpdateDisplayConfigsHandler);
