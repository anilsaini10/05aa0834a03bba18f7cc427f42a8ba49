import { Router } from 'express';
import {
  getAssignedSyllabusHandler,
  getMyClassesAndSubjectsHandler,
  getOverallProgressHandler,
  getPlanDetailHandler,
  getChapterDetailHandler,
  startChapterHandler,
  submitProgressHandler,
  completeChapterHandler,
} from './teacherSyllabus.controller';
import { authGuard } from '../../middleware/authGuard';
import { roleGuard } from '../../middleware/roleGuard';

export const teacherSyllabusRouter = Router();

teacherSyllabusRouter.use(authGuard, roleGuard('TEACHER'));

teacherSyllabusRouter.get('/',                getAssignedSyllabusHandler);
teacherSyllabusRouter.get('/classes-subjects', getMyClassesAndSubjectsHandler);
teacherSyllabusRouter.get('/progress',         getOverallProgressHandler);

teacherSyllabusRouter.get('/plan/:planId',                                          getPlanDetailHandler);
teacherSyllabusRouter.get('/plan/:planId/chapter/:planChapterId',                   getChapterDetailHandler);
teacherSyllabusRouter.post('/plan/:planId/chapter/:planChapterId/start',            startChapterHandler);
teacherSyllabusRouter.post('/plan/:planId/chapter/:planChapterId/progress',         submitProgressHandler);
teacherSyllabusRouter.post('/plan/:planId/chapter/:planChapterId/complete',         completeChapterHandler);
