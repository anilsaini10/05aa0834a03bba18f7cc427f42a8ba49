import { Request, Response, NextFunction } from 'express';
import * as service from './admissions.service';
import {
  createAdmissionSchema, updateAdmissionSchema,
  listAdmissionsQuerySchema, enrollAdmissionSchema,
} from './admissions.validation';
import { sendSuccess } from '../../../shared/utils/apiResponse';

export const createHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input  = createAdmissionSchema.parse(req.body);
    const user   = (req as any).user;
    const result = await service.createAdmission(user.schoolId, user.userId, input);
    sendSuccess(res, result, 201);
  } catch (err) { next(err); }
};

export const updateHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input  = updateAdmissionSchema.parse(req.body);
    const result = await service.updateAdmission((req as any).user.schoolId, req.params.admissionId, input);
    sendSuccess(res, result);
  } catch (err) { next(err); }
};

export const getByIdHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await service.getAdmissionById((req as any).user.schoolId, req.params.admissionId);
    sendSuccess(res, result);
  } catch (err) { next(err); }
};

export const listHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query  = listAdmissionsQuerySchema.parse(req.query);
    const result = await service.listAdmissions((req as any).user.schoolId, query);
    sendSuccess(res, result);
  } catch (err) { next(err); }
};

export const enrollHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input  = enrollAdmissionSchema.parse(req.body);
    const result = await service.enrollAdmission((req as any).user.schoolId, req.params.admissionId, input);
    sendSuccess(res, result, 201);
  } catch (err) { next(err); }
};

export const statsHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sessionId = typeof req.query.academicSessionId === 'string' ? req.query.academicSessionId : undefined;
    const result = await service.getAdmissionStats((req as any).user.schoolId, sessionId);
    sendSuccess(res, result);
  } catch (err) { next(err); }
};

export const deleteHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await service.deleteAdmission((req as any).user.schoolId, req.params.admissionId);
    sendSuccess(res, result);
  } catch (err) { next(err); }
};
