import { Router } from 'express';
import {
  getChildSyllabusHandler,
  getSubjectProgressHandler,
  getChapterDetailHandler,
  getOverallProgressHandler,
} from './parentSyllabus.controller';
import { authGuard } from '../../middleware/authGuard';
import { roleGuard } from '../../middleware/roleGuard';

export const parentSyllabusRouter = Router();
parentSyllabusRouter.use(authGuard, roleGuard('PARENT'));

parentSyllabusRouter.get('/',                          getChildSyllabusHandler);
parentSyllabusRouter.get('/subject/:subjectId',        getSubjectProgressHandler);
parentSyllabusRouter.get('/chapter/:planChapterId',    getChapterDetailHandler);
parentSyllabusRouter.get('/progress',                  getOverallProgressHandler);
