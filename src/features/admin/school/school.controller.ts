import { Request, Response, NextFunction } from 'express';
import * as schoolService from './school.service';
import { updateMySchoolSchema } from './school.validation';
import { sendSuccess } from '../../../shared/utils/apiResponse';

const schoolIdOf = (req: Request) => (req as any).user.schoolId;

// ── GET /admin/school ─────────────────────────────────────────
export const getMySchoolHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await schoolService.getMySchool(schoolIdOf(req));
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /admin/school ───────────────────────────────────────
export const updateMySchoolHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input  = updateMySchoolSchema.parse(req.body);
    const result = await schoolService.updateMySchool(schoolIdOf(req), input);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};
