import { Request, Response, NextFunction } from 'express';
import * as parentSyllabusService from './parentSyllabus.service';
import { parentSyllabusQuerySchema, parentSubjectProgressQuerySchema } from './parentSyllabus.validation';
import { sendSuccess } from '../../shared/utils/apiResponse';

const userOf = (req: Request): { sub: string } => (req as any).user;

export const getChildSyllabusHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { studentId, sessionYear } = parentSyllabusQuerySchema.parse(req.query);
    const result = await parentSyllabusService.getChildSyllabus(userOf(req).sub, studentId, sessionYear);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

export const getSubjectProgressHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { studentId } = parentSubjectProgressQuerySchema.parse(req.query);
    const result = await parentSyllabusService.getSubjectProgress(userOf(req).sub, studentId, req.params.subjectId);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

export const getChapterDetailHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { studentId } = parentSubjectProgressQuerySchema.parse(req.query);
    const result = await parentSyllabusService.getChapterDetail(userOf(req).sub, studentId, req.params.planChapterId);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

export const getOverallProgressHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { studentId, sessionYear } = parentSyllabusQuerySchema.parse(req.query);
    const result = await parentSyllabusService.getOverallProgress(userOf(req).sub, studentId, sessionYear);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};
