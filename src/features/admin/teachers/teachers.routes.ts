import { Router } from 'express';
import {
  createHandler,
  updateHandler,
  listHandler,
  getByIdHandler,
  assignSubjectHandler,
  removeSubjectAssignmentHandler,
} from './teachers.controller';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';

const router = Router();

router.post('/',             authGuard, roleGuard('ADMIN'), createHandler);
router.get('/',              authGuard, roleGuard('ADMIN'), listHandler);
router.post('/:teacherId/subjects',                    authGuard, roleGuard('ADMIN'), assignSubjectHandler);
router.delete('/:teacherId/subjects/:subjectId/:classId', authGuard, roleGuard('ADMIN'), removeSubjectAssignmentHandler);
router.get('/:teacherId',    authGuard, roleGuard('ADMIN'), getByIdHandler);
router.patch('/:teacherId',  authGuard, roleGuard('ADMIN'), updateHandler);

export default router;
