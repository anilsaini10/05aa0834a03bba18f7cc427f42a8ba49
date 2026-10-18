import { Request, Response, NextFunction } from 'express';
import * as supportService from './support.service';
import {
  createSupportQuerySchema,
  listMySupportQueriesQuerySchema,
  listAllSupportQueriesQuerySchema,
  updateSupportQuerySchema,
} from './support.validation';
import { sendSuccess } from '../../shared/utils/apiResponse';

const userOf = (req: Request): supportService.RequestUser => (req as any).user;

// ── ADMIN / TEACHER / PARENT ─────────────────────────────────

export const createQueryHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input  = createSupportQuerySchema.parse(req.body);
    const result = await supportService.createSupportQuery(userOf(req), input);
    sendSuccess(res, result, 201);
  } catch (err) {
    next(err);
  }
};

export const listMyQueriesHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query  = listMySupportQueriesQuerySchema.parse(req.query);
    const result = await supportService.listMySupportQueries(userOf(req), query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

export const getMyQueryHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await supportService.getMySupportQuery(userOf(req), req.params.queryId);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── SUPER_ADMIN ───────────────────────────────────────────────

export const listAllQueriesHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query  = listAllSupportQueriesQuerySchema.parse(req.query);
    const result = await supportService.listAllSupportQueries(query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

export const getQueryHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await supportService.getSupportQueryById(req.params.queryId);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

export const updateQueryHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input  = updateSupportQuerySchema.parse(req.body);
    const result = await supportService.updateSupportQuery(req.params.queryId, userOf(req).sub, input);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};
