import { Router } from 'express';
import {
  createHandler,
  updateHandler,
  listHandler,
  getByIdHandler,
  assignSubjectHandler,
  removeSubjectAssignmentHandler,
  deleteHandler,
  availabilityHandler,
  freeSlotsHandler,
} from './teachers.controller';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';

const router = Router();

router.post('/',             authGuard, roleGuard('ADMIN'), createHandler);
router.get('/',              authGuard, roleGuard('ADMIN'), listHandler);
// Must come before '/:teacherId' so these aren't read as a teacher id.
router.get('/availability',  authGuard, roleGuard('ADMIN'), availabilityHandler);
router.get('/free-slots',    authGuard, roleGuard('ADMIN'), freeSlotsHandler);
router.post('/:teacherId/subjects',                    authGuard, roleGuard('ADMIN'), assignSubjectHandler);
router.delete('/:teacherId/subjects/:subjectId/:classId', authGuard, roleGuard('ADMIN'), removeSubjectAssignmentHandler);
router.get('/:teacherId',    authGuard, roleGuard('ADMIN'), getByIdHandler);
router.patch('/:teacherId',  authGuard, roleGuard('ADMIN'), updateHandler);
router.delete('/:teacherId', authGuard, roleGuard('ADMIN'), deleteHandler);

export default router;
