import { Router } from 'express';
import {
  createRequestHandler,
  listRequestsHandler,
  getRequestHandler,
  resetRequestHandler,
  rejectRequestHandler,
} from './accountRecovery.controller';
import { authGuard } from '../../middleware/authGuard';
import { roleGuard } from '../../middleware/roleGuard';

// ── Public: "Request admin" on the login screen (no auth) ─────
// Mounted at /api/account-recovery.
export const accountRecoveryRouter = Router();

accountRecoveryRouter.post('/requests', createRequestHandler);

// ── School ADMIN: own school's requests ───────────────────────
// Mounted at /api/admin/account-recovery.
export const adminAccountRecoveryRouter = Router();
const admin = [authGuard, roleGuard('ADMIN')] as const;

adminAccountRecoveryRouter.get('/requests',                     ...admin, listRequestsHandler);
adminAccountRecoveryRouter.get('/requests/:requestId',          ...admin, getRequestHandler);
adminAccountRecoveryRouter.post('/requests/:requestId/reset',   ...admin, resetRequestHandler);
adminAccountRecoveryRouter.post('/requests/:requestId/reject',  ...admin, rejectRequestHandler);
