import { Router } from 'express';
import {
  getDashboardHandler,
  getProfileHandler,
  updateProfileHandler,
  resetPasswordHandler,
  listAnnouncementsHandler,
  listEventsHandler,
  listExamsHandler,
  getExamResultHandler,
  getTimetableHandler,
  getAttendanceHandler,
  applyLeaveHandler,
  listLeaveHandler,
  cancelLeaveHandler,
  listHomeworkHandler,
  getHomeworkHandler,
} from './students.controller';
import { authGuard } from '../../middleware/authGuard';
import { roleGuard } from '../../middleware/roleGuard';

const router = Router();

router.get('/dashboard',       authGuard, roleGuard('PARENT'), getDashboardHandler);
router.get('/profile',         authGuard, roleGuard('PARENT'), getProfileHandler);
router.patch('/profile',       authGuard, roleGuard('PARENT'), updateProfileHandler);
router.post('/reset-password', authGuard, roleGuard('PARENT'), resetPasswordHandler);
router.get('/announcements',   authGuard, roleGuard('PARENT'), listAnnouncementsHandler);
router.get('/events',          authGuard, roleGuard('PARENT'), listEventsHandler);
router.get('/exams',           authGuard, roleGuard('PARENT'), listExamsHandler);
router.get('/exams/:examId',   authGuard, roleGuard('PARENT'), getExamResultHandler);
router.get('/timetable',       authGuard, roleGuard('PARENT'), getTimetableHandler);
router.get('/attendance',      authGuard, roleGuard('PARENT'), getAttendanceHandler);

router.post('/leave',           authGuard, roleGuard('PARENT'), applyLeaveHandler);
router.get('/leave',            authGuard, roleGuard('PARENT'), listLeaveHandler);
router.delete('/leave/:leaveId', authGuard, roleGuard('PARENT'), cancelLeaveHandler);

router.get('/homework',            authGuard, roleGuard('PARENT'), listHomeworkHandler);
router.get('/homework/:homeworkId', authGuard, roleGuard('PARENT'), getHomeworkHandler);

export default router;
