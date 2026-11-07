import { Router } from 'express';
import {
  createStructureHandler, listStructuresHandler, getStructureHandler, updateStructureHandler, deleteStructureHandler,
  assignStructureHandler, createStudentFeeHandler, listStudentFeesHandler, getStudentFeeHandler, updateStudentFeeHandler,
  deleteStudentFeeHandler, waiveStudentFeeHandler, cancelStudentFeeHandler, reopenStudentFeeHandler, recordPaymentHandler,
  listPaymentsHandler, getPaymentHandler, voidPaymentHandler, getStudentLedgerHandler, getSummaryHandler,
  listDefaultersHandler, getChildFeesHandler, getChildReceiptHandler,
} from './fees.controller';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';
import { requirePermission } from '../../../middleware/requirePermission';
import { PERMISSION_KEYS } from '../../../constants';

// ── School ADMIN, or STAFF with feesManage (Accountant…) ──────
// Mounted at /api/admin/fees.
export const adminFeesRouter = Router();
adminFeesRouter.use(authGuard, requirePermission(PERMISSION_KEYS.FEES_MANAGE));

adminFeesRouter.get('/summary',                         getSummaryHandler);
adminFeesRouter.get('/defaulters',                      listDefaultersHandler);
adminFeesRouter.get('/students/:studentId',             getStudentLedgerHandler);

adminFeesRouter.post('/structures',                     createStructureHandler);
adminFeesRouter.get('/structures',                      listStructuresHandler);
adminFeesRouter.get('/structures/:structureId',         getStructureHandler);
adminFeesRouter.patch('/structures/:structureId',       updateStructureHandler);
adminFeesRouter.delete('/structures/:structureId',      deleteStructureHandler);
adminFeesRouter.post('/structures/:structureId/assign', assignStructureHandler);

adminFeesRouter.post('/student-fees',                   createStudentFeeHandler);
adminFeesRouter.get('/student-fees',                    listStudentFeesHandler);
adminFeesRouter.get('/student-fees/:feeId',             getStudentFeeHandler);
adminFeesRouter.patch('/student-fees/:feeId',           updateStudentFeeHandler);
adminFeesRouter.delete('/student-fees/:feeId',          deleteStudentFeeHandler);
adminFeesRouter.post('/student-fees/:feeId/waive',      waiveStudentFeeHandler);
adminFeesRouter.post('/student-fees/:feeId/cancel',     cancelStudentFeeHandler);
adminFeesRouter.post('/student-fees/:feeId/reopen',     reopenStudentFeeHandler);
adminFeesRouter.post('/student-fees/:feeId/payments',   recordPaymentHandler);

adminFeesRouter.get('/payments',                        listPaymentsHandler);
adminFeesRouter.get('/payments/:paymentId',             getPaymentHandler);
adminFeesRouter.post('/payments/:paymentId/void',       voidPaymentHandler);

// ── PARENT: own child's fees ──────────────────────────────────
// Mounted at /api/students/fees.
export const parentFeesRouter = Router();
parentFeesRouter.use(authGuard, roleGuard('PARENT'));

parentFeesRouter.get('/',                    getChildFeesHandler);
parentFeesRouter.get('/receipts/:paymentId', getChildReceiptHandler);
