import { Request, Response, NextFunction } from 'express';
import * as publicDirectoryService from './publicDirectory.service';
import {
  listSchoolsSchema,
  schoolIdParamSchema,
  teacherListSchema,
} from './publicDirectory.validation';
import { sendSuccess } from '../../shared/utils/apiResponse';

// ── GET /public/schools ──────────────────────────────────────────
export const listSchoolsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query = listSchoolsSchema.parse(req.query);
    const data = await publicDirectoryService.listSchools(query);
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
};

// ── GET /public/schools/:schoolId ────────────────────────────────
export const getSchoolDetailHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { schoolId } = schoolIdParamSchema.parse(req.params);
    const data = await publicDirectoryService.getSchoolDetail(schoolId);
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
};

// ── GET /public/schools/:schoolId/teachers ───────────────────────
export const listTeachersHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { schoolId } = schoolIdParamSchema.parse(req.params);
    const query = teacherListSchema.parse(req.query);
    const data = await publicDirectoryService.listTeachers(schoolId, query);
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
};
