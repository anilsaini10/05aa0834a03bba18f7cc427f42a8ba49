import { Request, Response, NextFunction } from 'express';
import * as feesService from './fees.service';
import {
  createStructureSchema, updateStructureSchema, listStructuresQuerySchema, assignStructureSchema,
  createStudentFeeSchema, updateStudentFeeSchema, listStudentFeesQuerySchema, feeReasonSchema,
  createPaymentSchema, listPaymentsQuerySchema, voidPaymentSchema, summaryQuerySchema, defaultersQuerySchema,
  ledgerQuerySchema, parentFeesQuerySchema,
  structureIdParamSchema, feeIdParamSchema, paymentIdParamSchema, studentIdParamSchema,
} from './fees.validation';
import { sendSuccess } from '../../../shared/utils/apiResponse';

const userOf = (req: Request): { sub: string; schoolId: string } => (req as any).user;

// Wraps a handler: runs fn, sends its result, forwards errors.
const handle = (fn: (req: Request) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      sendSuccess(res, await fn(req), status);
    } catch (err) {
      next(err);
    }
  };

// ── Fee structures ────────────────────────────────────────────
export const createStructureHandler = handle(req =>
  feesService.createStructure(userOf(req).schoolId, createStructureSchema.parse(req.body)), 201);

export const listStructuresHandler = handle(req =>
  feesService.listStructures(userOf(req).schoolId, listStructuresQuerySchema.parse(req.query)));

export const getStructureHandler = handle(req =>
  feesService.getStructure(userOf(req).schoolId, structureIdParamSchema.parse(req.params).structureId));

export const updateStructureHandler = handle(req =>
  feesService.updateStructure(userOf(req).schoolId, structureIdParamSchema.parse(req.params).structureId, updateStructureSchema.parse(req.body)));

export const deleteStructureHandler = handle(req =>
  feesService.deleteStructure(userOf(req).schoolId, structureIdParamSchema.parse(req.params).structureId));

export const assignStructureHandler = handle(req =>
  feesService.assignStructure(userOf(req).schoolId, structureIdParamSchema.parse(req.params).structureId, assignStructureSchema.parse(req.body ?? {})));

// ── Student fees ──────────────────────────────────────────────
export const createStudentFeeHandler = handle(req =>
  feesService.createStudentFee(userOf(req).schoolId, createStudentFeeSchema.parse(req.body)), 201);

export const listStudentFeesHandler = handle(req =>
  feesService.listStudentFees(userOf(req).schoolId, listStudentFeesQuerySchema.parse(req.query)));

export const getStudentFeeHandler = handle(req =>
  feesService.getStudentFee(userOf(req).schoolId, feeIdParamSchema.parse(req.params).feeId));

export const updateStudentFeeHandler = handle(req =>
  feesService.updateStudentFee(userOf(req).schoolId, feeIdParamSchema.parse(req.params).feeId, updateStudentFeeSchema.parse(req.body)));

export const deleteStudentFeeHandler = handle(req =>
  feesService.deleteStudentFee(userOf(req).schoolId, feeIdParamSchema.parse(req.params).feeId));

export const waiveStudentFeeHandler = handle(req =>
  feesService.waiveStudentFee(userOf(req).schoolId, feeIdParamSchema.parse(req.params).feeId, feeReasonSchema.parse(req.body).reason));

export const cancelStudentFeeHandler = handle(req =>
  feesService.cancelStudentFee(userOf(req).schoolId, feeIdParamSchema.parse(req.params).feeId, feeReasonSchema.parse(req.body).reason));

export const reopenStudentFeeHandler = handle(req =>
  feesService.reopenStudentFee(userOf(req).schoolId, feeIdParamSchema.parse(req.params).feeId));

// ── Payments ──────────────────────────────────────────────────
export const recordPaymentHandler = handle(req => {
  const { sub, schoolId } = userOf(req);
  return feesService.recordPayment(schoolId, sub, feeIdParamSchema.parse(req.params).feeId, createPaymentSchema.parse(req.body));
}, 201);

export const listPaymentsHandler = handle(req =>
  feesService.listPayments(userOf(req).schoolId, listPaymentsQuerySchema.parse(req.query)));

export const getPaymentHandler = handle(req =>
  feesService.getPayment(userOf(req).schoolId, paymentIdParamSchema.parse(req.params).paymentId));

export const voidPaymentHandler = handle(req =>
  feesService.voidPayment(userOf(req).schoolId, paymentIdParamSchema.parse(req.params).paymentId, voidPaymentSchema.parse(req.body).reason));

// ── Reports ───────────────────────────────────────────────────
export const getStudentLedgerHandler = handle(req =>
  feesService.getStudentLedger(userOf(req).schoolId, studentIdParamSchema.parse(req.params).studentId, ledgerQuerySchema.parse(req.query).sessionYear));

export const getSummaryHandler = handle(req =>
  feesService.getSummary(userOf(req).schoolId, summaryQuerySchema.parse(req.query)));

export const listDefaultersHandler = handle(req =>
  feesService.listDefaulters(userOf(req).schoolId, defaultersQuerySchema.parse(req.query)));

// ── Parent ────────────────────────────────────────────────────
export const getChildFeesHandler = handle(req =>
  feesService.getChildFees(userOf(req).sub, parentFeesQuerySchema.parse(req.query)));

export const getChildReceiptHandler = handle(req =>
  feesService.getChildReceipt(userOf(req).sub, paymentIdParamSchema.parse(req.params).paymentId));
