import { Request, Response, NextFunction } from 'express';
import * as dashboardService from './dashboard.service';
import { sendSuccess } from '../../../shared/utils/apiResponse';

// ── GET /admin/dashboard ───────────────────────────────────────
export const getStatsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const schoolId = (req as any).user.schoolId;
    const stats    = await dashboardService.getDashboardStats(schoolId);
    sendSuccess(res, stats);
  } catch (err) {
    next(err);
  }
};
