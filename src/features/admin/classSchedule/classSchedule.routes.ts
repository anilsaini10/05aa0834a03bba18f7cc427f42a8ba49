import { Router } from 'express';
import {
  createHandler,
  listHandler,
  getByIdHandler,
  updateHandler,
  deleteHandler,
  getSectionTimetableHandler,
  getTeacherTimetableHandler,
} from './classSchedule.controller';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';

const router = Router();
const admin  = [authGuard, roleGuard('ADMIN')] as const;

router.post('/',                      ...admin, createHandler);
router.get('/',                       ...admin, listHandler);
router.get('/sections/:sectionId',    ...admin, getSectionTimetableHandler);
router.get('/teachers/:teacherId',    ...admin, getTeacherTimetableHandler);
router.get('/:scheduleId',            ...admin, getByIdHandler);
router.patch('/:scheduleId',          ...admin, updateHandler);
router.delete('/:scheduleId',         ...admin, deleteHandler);

export default router;
