import { Router } from 'express';
import {
  listHandler,
  createHandler,
  addSectionHandler,
  addSubjectHandler,
  updateHandler,
  deleteHandler,
  updateSectionHandler,
  deleteSectionHandler,
} from './classes.controller';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';

const router = Router();

router.get('/',                                 authGuard, roleGuard('ADMIN'), listHandler);
router.post('/',                                authGuard, roleGuard('ADMIN'), createHandler);
router.patch('/:classId',                       authGuard, roleGuard('ADMIN'), updateHandler);
router.delete('/:classId',                      authGuard, roleGuard('ADMIN'), deleteHandler);
router.post('/:classId/sections',               authGuard, roleGuard('ADMIN'), addSectionHandler);
router.patch('/:classId/sections/:sectionId',   authGuard, roleGuard('ADMIN'), updateSectionHandler);
router.delete('/:classId/sections/:sectionId',  authGuard, roleGuard('ADMIN'), deleteSectionHandler);
router.post('/:classId/subjects',               authGuard, roleGuard('ADMIN'), addSubjectHandler);

export default router;
