import { Request, Response, NextFunction } from 'express';
import * as service from './parentQueries.service';
import {
  createParentQuerySchema,
  listMyParentQueriesQuerySchema,
  listParentQueriesQuerySchema,
  updateParentQuerySchema,
} from './parentQueries.validation';
import { sendSuccess } from '../../shared/utils/apiResponse';

// ── PARENT handlers ──────────────────────────────────────────

export const createQueryHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = createParentQuerySchema.parse(req.body);
    const user  = (req as any).user;
    const query = await service.createParentQuery(user, input);
    sendSuccess(res, query, 201);
  } catch (err) { next(err); }
};

export const listMyQueriesHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query  = listMyParentQueriesQuerySchema.parse(req.query);
    const user   = (req as any).user;
    const result = await service.listMyParentQueries(user, query);
    sendSuccess(res, result);
  } catch (err) { next(err); }
};

export const getMyQueryHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user   = (req as any).user;
    const result = await service.getMyParentQuery(user, req.params.queryId);
    sendSuccess(res, result);
  } catch (err) { next(err); }
};

// ── ADMIN handlers ───────────────────────────────────────────

export const listAllQueriesHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query  = listParentQueriesQuerySchema.parse(req.query);
    const user   = (req as any).user;
    const result = await service.listParentQueries(user, query);
    sendSuccess(res, result);
  } catch (err) { next(err); }
};

export const getQueryHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user   = (req as any).user;
    const result = await service.getParentQueryById(user, req.params.queryId);
    sendSuccess(res, result);
  } catch (err) { next(err); }
};

export const updateQueryHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input  = updateParentQuerySchema.parse(req.body);
    const user   = (req as any).user;
    const result = await service.updateParentQuery(user, req.params.queryId, input);
    sendSuccess(res, result);
  } catch (err) { next(err); }
};
