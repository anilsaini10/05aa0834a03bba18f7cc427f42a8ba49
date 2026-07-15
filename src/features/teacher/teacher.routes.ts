import { Router } from 'express';
import {
  getProfileHandler,
  updateProfileHandler,
  resetPasswordHandler,
  listClassesHandler,
  listStudentsHandler,
  listAnnouncementsHandler,
  getSectionAttendanceHandler,
  markAttendanceHandler,
  getStudentAttendanceHistoryHandler,
  updateAttendanceRecordHandler,
  createHomeworkHandler,
  listHomeworkHandler,
  getHomeworkHandler,
  updateHomeworkHandler,
  deleteHomeworkHandler,
} from './teacher.controller';
import { authGuard } from '../../middleware/authGuard';
import { roleGuard } from '../../middleware/roleGuard';

const router = Router();

router.get('/profile',         authGuard, roleGuard('TEACHER'), getProfileHandler);
router.patch('/profile',       authGuard, roleGuard('TEACHER'), updateProfileHandler);
router.post('/reset-password', authGuard, roleGuard('TEACHER'), resetPasswordHandler);
router.get('/classes',         authGuard, roleGuard('TEACHER'), listClassesHandler);
router.get('/students',        authGuard, roleGuard('TEACHER'), listStudentsHandler);
router.get('/announcements',   authGuard, roleGuard('TEACHER'), listAnnouncementsHandler);

router.get('/attendance',                     authGuard, roleGuard('TEACHER'), getSectionAttendanceHandler);
router.post('/attendance',                    authGuard, roleGuard('TEACHER'), markAttendanceHandler);
router.get('/attendance/students/:studentId', authGuard, roleGuard('TEACHER'), getStudentAttendanceHistoryHandler);
router.patch('/attendance/:recordId',         authGuard, roleGuard('TEACHER'), updateAttendanceRecordHandler);

router.post('/homework',              authGuard, roleGuard('TEACHER'), createHomeworkHandler);
router.get('/homework',               authGuard, roleGuard('TEACHER'), listHomeworkHandler);
router.get('/homework/:homeworkId',   authGuard, roleGuard('TEACHER'), getHomeworkHandler);
router.patch('/homework/:homeworkId', authGuard, roleGuard('TEACHER'), updateHomeworkHandler);
router.delete('/homework/:homeworkId', authGuard, roleGuard('TEACHER'), deleteHomeworkHandler);

export default router;
