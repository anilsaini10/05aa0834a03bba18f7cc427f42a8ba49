import { Request, Response, NextFunction } from 'express';
import * as schoolsService from './schools.service';
import { searchSchoolsSchema, schoolIdParamSchema } from './schools.validation';
import { sendSuccess } from '../../shared/utils/apiResponse';

// ── GET /schools ──────────────────────────────────────────────
export const listHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { search } = searchSchoolsSchema.parse(req.query);
    const schools     = await schoolsService.searchSchools(search);
    sendSuccess(res, schools);
  } catch (err) {
    next(err);
  }
};

// ── GET /schools/:schoolId/roles ──────────────────────────────
export const listLoginRolesHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { schoolId } = schoolIdParamSchema.parse(req.params);
    sendSuccess(res, await schoolsService.listLoginRoles(schoolId));
  } catch (err) {
    next(err);
  }
};
