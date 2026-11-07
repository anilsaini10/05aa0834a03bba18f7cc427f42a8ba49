import { Router } from 'express';
import {
  listHandler, getByIdHandler, createHandler, updateHandler,
  deleteHandler, toggleStatusHandler, assignClassesHandler, getByClassHandler,
} from './subjects.controller';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';

const router = Router();

router.get('/',                          authGuard, roleGuard('ADMIN'), listHandler);
router.get('/by-class/:classId',         authGuard, roleGuard('ADMIN'), getByClassHandler);
router.get('/:subjectId',               authGuard, roleGuard('ADMIN'), getByIdHandler);
router.post('/',                         authGuard, roleGuard('ADMIN'), createHandler);
router.patch('/:subjectId',             authGuard, roleGuard('ADMIN'), updateHandler);
router.delete('/:subjectId',            authGuard, roleGuard('ADMIN'), deleteHandler);
router.patch('/:subjectId/status',      authGuard, roleGuard('ADMIN'), toggleStatusHandler);
router.post('/:subjectId/classes',      authGuard, roleGuard('ADMIN'), assignClassesHandler);

export default router;
