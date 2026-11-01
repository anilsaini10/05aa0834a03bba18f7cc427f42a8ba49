import { Request, Response, NextFunction } from 'express';
import * as interventionsService from './interventions.service';
import {
  createInterventionSchema, updateInterventionSchema, listInterventionsQuerySchema,
} from './interventions.validation';
import { sendSuccess } from '../../../shared/utils/apiResponse';

const userOf = (req: Request): { sub: string; schoolId: string } => (req as any).user;

export const createHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input  = createInterventionSchema.parse(req.body);
    const { sub, schoolId } = userOf(req);
    sendSuccess(res, await interventionsService.createIntervention(schoolId, sub, input), 201);
  } catch (err) {
    next(err);
  }
};

export const listHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query = listInterventionsQuerySchema.parse(req.query);
    sendSuccess(res, await interventionsService.listInterventions(userOf(req).schoolId, query));
  } catch (err) {
    next(err);
  }
};

export const getHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, await interventionsService.getIntervention(userOf(req).schoolId, req.params.id));
  } catch (err) {
    next(err);
  }
};

export const updateHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = updateInterventionSchema.parse(req.body);
    const { sub, schoolId } = userOf(req);
    sendSuccess(res, await interventionsService.updateIntervention(schoolId, sub, req.params.id, input));
  } catch (err) {
    next(err);
  }
};
