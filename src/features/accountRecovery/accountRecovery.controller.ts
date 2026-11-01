import { Request, Response, NextFunction } from 'express';
import * as recoveryService from './accountRecovery.service';
import { createRecoveryRequestSchema, listRecoveryRequestsQuerySchema } from './accountRecovery.validation';
import { sendSuccess } from '../../shared/utils/apiResponse';

const userOf = (req: Request): { sub: string; schoolId: string } => (req as any).user;

// ── Public ────────────────────────────────────────────────────

export const createRequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = createRecoveryRequestSchema.parse(req.body);
    await recoveryService.createRecoveryRequest(input);
    sendSuccess(res, {
      message: 'If your details match an account, your request has been sent to your school admin.',
    }, 201);
  } catch (err) {
    next(err);
  }
};

// ── ADMIN ─────────────────────────────────────────────────────

export const listRequestsHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query  = listRecoveryRequestsQuerySchema.parse(req.query);
    const result = await recoveryService.listRecoveryRequests(userOf(req).schoolId, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

export const getRequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await recoveryService.getRecoveryRequest(userOf(req).schoolId, req.params.requestId);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

export const resetRequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { sub, schoolId } = userOf(req);
    const result = await recoveryService.resetFromRecoveryRequest(schoolId, sub, req.params.requestId);
    sendSuccess(res, { message: 'Password reset to the default. The user must log in again.', ...result });
  } catch (err) {
    next(err);
  }
};

export const rejectRequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { sub, schoolId } = userOf(req);
    const result = await recoveryService.rejectRecoveryRequest(schoolId, sub, req.params.requestId);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};
