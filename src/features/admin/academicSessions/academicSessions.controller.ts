import { Request, Response, NextFunction } from 'express';
import * as service from './academicSessions.service';
import { createSessionSchema, updateSessionSchema } from './academicSessions.validation';
import { sendSuccess } from '../../../shared/utils/apiResponse';

export const createHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = createSessionSchema.parse(req.body);
    const result = await service.createSession((req as any).user.schoolId, input);
    sendSuccess(res, result, 201);
  } catch (err) { next(err); }
};

export const updateHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = updateSessionSchema.parse(req.body);
    const result = await service.updateSession((req as any).user.schoolId, req.params.sessionId, input);
    sendSuccess(res, result);
  } catch (err) { next(err); }
};

export const listHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await service.listSessions((req as any).user.schoolId);
    sendSuccess(res, result);
  } catch (err) { next(err); }
};

export const getByIdHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await service.getSessionById((req as any).user.schoolId, req.params.sessionId);
    sendSuccess(res, result);
  } catch (err) { next(err); }
};

export const getCurrentHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await service.getCurrentSession((req as any).user.schoolId);
    sendSuccess(res, result);
  } catch (err) { next(err); }
};

export const deleteHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await service.deleteSession((req as any).user.schoolId, req.params.sessionId);
    sendSuccess(res, result);
  } catch (err) { next(err); }
};
