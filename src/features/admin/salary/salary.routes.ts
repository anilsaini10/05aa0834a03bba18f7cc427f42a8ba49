import { Router } from 'express';
import {
  generateSalaryHandler, listSalaryHandler, getSalarySummaryHandler, getSalarySlipHandler, updateSalarySlipHandler,
  deleteSalarySlipHandler, creditSalarySlipHandler, bulkCreditSalaryHandler, holdSalarySlipHandler,
  releaseSalarySlipHandler, cancelSalarySlipHandler, listMySalaryHandler, getMySalarySlipHandler,
} from './salary.controller';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';
import { requirePermission } from '../../../middleware/requirePermission';
import { PERMISSION_KEYS } from '../../../constants';

// ── School ADMIN, or STAFF with salaryManage ──────────────────
// Mounted at /api/admin/salary.
export const adminSalaryRouter = Router();
adminSalaryRouter.use(authGuard, requirePermission(PERMISSION_KEYS.SALARY_MANAGE));

adminSalaryRouter.post('/generate',         generateSalaryHandler);
adminSalaryRouter.post('/credit',           bulkCreditSalaryHandler);
adminSalaryRouter.get('/summary',           getSalarySummaryHandler);
adminSalaryRouter.get('/',                  listSalaryHandler);
adminSalaryRouter.get('/:slipId',           getSalarySlipHandler);
adminSalaryRouter.patch('/:slipId',         updateSalarySlipHandler);
adminSalaryRouter.delete('/:slipId',        deleteSalarySlipHandler);
adminSalaryRouter.post('/:slipId/credit',   creditSalarySlipHandler);
adminSalaryRouter.post('/:slipId/hold',     holdSalarySlipHandler);
adminSalaryRouter.post('/:slipId/release',  releaseSalarySlipHandler);
adminSalaryRouter.post('/:slipId/cancel',   cancelSalarySlipHandler);

// ── TEACHER: own slips ────────────────────────────────────────
// Mounted at /api/teacher/salary.
export const teacherSalaryRouter = Router();
teacherSalaryRouter.use(authGuard, roleGuard('TEACHER'));

teacherSalaryRouter.get('/',        listMySalaryHandler);
teacherSalaryRouter.get('/:slipId', getMySalarySlipHandler);
