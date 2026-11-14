import { Request, Response, NextFunction } from 'express';
import * as service from './promotions.service';
import {
  promotionPreviewSchema, promotionExecuteSchema, listPromotionHistorySchema,
} from './promotions.validation';
import { sendSuccess } from '../../../shared/utils/apiResponse';

export const previewHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input  = promotionPreviewSchema.parse(req.body);
    const result = await service.previewPromotion((req as any).user.schoolId, input);
    sendSuccess(res, result);
  } catch (err) { next(err); }
};

export const executeHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input  = promotionExecuteSchema.parse(req.body);
    const user   = (req as any).user;
    const result = await service.executePromotion(user.schoolId, user.userId, input);
    sendSuccess(res, result, 201);
  } catch (err) { next(err); }
};

export const rollbackHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await service.rollbackPromotion((req as any).user.schoolId, req.params.batchId);
    sendSuccess(res, result);
  } catch (err) { next(err); }
};

export const listHistoryHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query  = listPromotionHistorySchema.parse(req.query);
    const result = await service.listPromotionHistory((req as any).user.schoolId, query);
    sendSuccess(res, result);
  } catch (err) { next(err); }
};

export const getBatchHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await service.getBatchDetails((req as any).user.schoolId, req.params.batchId);
    sendSuccess(res, result);
  } catch (err) { next(err); }
};
