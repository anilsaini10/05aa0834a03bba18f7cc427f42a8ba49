import { Request, Response, NextFunction } from 'express';
import * as schoolsService from './schools.service';
import { searchSchoolsSchema } from './schools.validation';
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
