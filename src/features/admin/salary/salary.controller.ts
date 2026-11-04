import { Request, Response, NextFunction } from 'express';
import * as salaryService from './salary.service';
import {
  generateSalarySchema, listSalaryQuerySchema, updateSalarySchema, creditSalarySchema, bulkCreditSalarySchema,
  salaryReasonSchema, salarySummaryQuerySchema, mySalaryQuerySchema, slipIdParamSchema,
} from './salary.validation';
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

const slipIdOf = (req: Request) => slipIdParamSchema.parse(req.params).slipId;

// ── Admin ─────────────────────────────────────────────────────
export const generateSalaryHandler = handle(req =>
  salaryService.generateSalary(userOf(req).schoolId, generateSalarySchema.parse(req.body)), 201);

export const listSalaryHandler = handle(req =>
  salaryService.listSalary(userOf(req).schoolId, listSalaryQuerySchema.parse(req.query)));

export const getSalarySummaryHandler = handle(req =>
  salaryService.getSalarySummary(userOf(req).schoolId, salarySummaryQuerySchema.parse(req.query)));

export const getSalarySlipHandler = handle(req =>
  salaryService.getSalarySlip(userOf(req).schoolId, slipIdOf(req)));

export const updateSalarySlipHandler = handle(req =>
  salaryService.updateSalarySlip(userOf(req).schoolId, slipIdOf(req), updateSalarySchema.parse(req.body)));

export const deleteSalarySlipHandler = handle(req =>
  salaryService.deleteSalarySlip(userOf(req).schoolId, slipIdOf(req)));

export const creditSalarySlipHandler = handle(req => {
  const { sub, schoolId } = userOf(req);
  return salaryService.creditSalarySlip(schoolId, sub, slipIdOf(req), creditSalarySchema.parse(req.body));
});

export const bulkCreditSalaryHandler = handle(req => {
  const { sub, schoolId } = userOf(req);
  return salaryService.bulkCreditSalary(schoolId, sub, bulkCreditSalarySchema.parse(req.body));
});

export const holdSalarySlipHandler = handle(req =>
  salaryService.holdSalarySlip(userOf(req).schoolId, slipIdOf(req), salaryReasonSchema.parse(req.body).reason));

export const releaseSalarySlipHandler = handle(req =>
  salaryService.releaseSalarySlip(userOf(req).schoolId, slipIdOf(req)));

export const cancelSalarySlipHandler = handle(req =>
  salaryService.cancelSalarySlip(userOf(req).schoolId, slipIdOf(req), salaryReasonSchema.parse(req.body).reason));

// ── Teacher ───────────────────────────────────────────────────
export const listMySalaryHandler = handle(req =>
  salaryService.listMySalary(userOf(req).sub, mySalaryQuerySchema.parse(req.query).year));

export const getMySalarySlipHandler = handle(req =>
  salaryService.getMySalarySlip(userOf(req).sub, slipIdOf(req)));
