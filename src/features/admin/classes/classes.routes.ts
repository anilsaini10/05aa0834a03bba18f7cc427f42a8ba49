import { Router } from 'express';
import {
  listHandler,
  createHandler,
  addSectionHandler,
  addSubjectHandler,
} from './classes.controller';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';

const router = Router();

router.get('/',                     authGuard, roleGuard('ADMIN'), listHandler);
router.post('/',                    authGuard, roleGuard('ADMIN'), createHandler);
router.post('/:classId/sections',   authGuard, roleGuard('ADMIN'), addSectionHandler);
router.post('/:classId/subjects',   authGuard, roleGuard('ADMIN'), addSubjectHandler);

export default router;
