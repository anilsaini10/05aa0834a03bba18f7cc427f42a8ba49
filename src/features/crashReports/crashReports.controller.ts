import { Request, Response, NextFunction } from 'express';
import * as crashReportsService from './crashReports.service';
import {
  submitCrashReportSchema,
  listCrashReportsQuerySchema,
} from './crashReports.validation';
import { sendSuccess } from '../../shared/utils/apiResponse';

// ── POST /crash-reports — any authenticated user submits a crash ──
export const submitHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input  = submitCrashReportSchema.parse(req.body);
    const userId = (req as any).user.sub;
    const report = await crashReportsService.submitCrashReport(userId, input);
    sendSuccess(res, { report }, 201);
  } catch (err) {
    next(err);
  }
};

// ── GET /super-admin/crash-reports — paginated list ──
export const listHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query  = listCrashReportsQuerySchema.parse(req.query);
    const result = await crashReportsService.listCrashReports(query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── GET /super-admin/crash-reports/stats — summary counts ──
export const statsHandler = async (
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const stats = await crashReportsService.getCrashReportStats();
    sendSuccess(res, stats);
  } catch (err) {
    next(err);
  }
};

// ── GET /super-admin/crash-reports/:id — single report detail ──
export const getByIdHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const report = await crashReportsService.getCrashReportById(req.params.id);
    sendSuccess(res, report);
  } catch (err) {
    next(err);
  }
};
