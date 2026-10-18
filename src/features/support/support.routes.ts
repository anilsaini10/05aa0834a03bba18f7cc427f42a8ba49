import { Router } from 'express';
import {
  createQueryHandler,
  listMyQueriesHandler,
  getMyQueryHandler,
  listAllQueriesHandler,
  getQueryHandler,
  updateQueryHandler,
} from './support.controller';
import { authGuard } from '../../middleware/authGuard';
import { roleGuard } from '../../middleware/roleGuard';

// ── Senders: school ADMIN, TEACHER, PARENT (own queries only) ─
// Mounted at /api/support and /api/admin/support.
export const supportRouter = Router();
const sender = [authGuard, roleGuard('ADMIN', 'TEACHER', 'PARENT')] as const;

supportRouter.post('/queries',          ...sender, createQueryHandler);
supportRouter.get('/queries',           ...sender, listMyQueriesHandler);
supportRouter.get('/queries/:queryId',  ...sender, getMyQueryHandler);

// ── SUPER_ADMIN: all schools ─────────────────────────────────
// Mounted at /api/super-admin/support.
export const superAdminSupportRouter = Router();
const superAdmin = [authGuard, roleGuard('SUPER_ADMIN')] as const;

superAdminSupportRouter.get('/queries',             ...superAdmin, listAllQueriesHandler);
superAdminSupportRouter.get('/queries/:queryId',    ...superAdmin, getQueryHandler);
superAdminSupportRouter.patch('/queries/:queryId',  ...superAdmin, updateQueryHandler);
