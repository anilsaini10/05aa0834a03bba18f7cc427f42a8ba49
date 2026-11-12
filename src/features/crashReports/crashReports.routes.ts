import { Router } from 'express';
import {
  submitHandler,
  listHandler,
  statsHandler,
  getByIdHandler,
} from './crashReports.controller';
import { authGuard } from '../../middleware/authGuard';
import { roleGuard } from '../../middleware/roleGuard';

// ── Public route — any logged-in user can submit a crash report ──
export const crashReportSubmitRouter = Router();
crashReportSubmitRouter.post('/', authGuard, submitHandler);

// ── Super admin routes — view/analyze crash reports ──
export const superAdminCrashReportsRouter = Router();
superAdminCrashReportsRouter.use(authGuard, roleGuard('SUPER_ADMIN'));
superAdminCrashReportsRouter.get('/stats', statsHandler);
superAdminCrashReportsRouter.get('/:id',   getByIdHandler);
superAdminCrashReportsRouter.get('/',       listHandler);
