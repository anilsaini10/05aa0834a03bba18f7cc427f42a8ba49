import { Router } from 'express';
import {
  getDashboardHandler,
  getProfileHandler,
  updateProfileHandler,
  resetPasswordHandler,
  listClassesHandler,
  listStudentsHandler,
  listAnnouncementsHandler,
  listEventsHandler,
  getTodayScheduleHandler,
  getWeekScheduleHandler,
  getSectionAttendanceHandler,
  markAttendanceHandler,
  getStudentAttendanceHistoryHandler,
  updateAttendanceRecordHandler,
  createHomeworkHandler,
  listHomeworkHandler,
  getHomeworkHandler,
  updateHomeworkHandler,
  deleteHomeworkHandler,
  getHomeworkStudentsHandler,
  markHomeworkSubmissionsHandler,
  listMyAttendanceRecordsHandler,
  listLeaveRequestsHandler,
  reviewLeaveRequestHandler,
  applyMyLeaveHandler,
  listMyLeaveHandler,
  cancelMyLeaveHandler,
} from './teacher.controller';
import { authGuard } from '../../middleware/authGuard';
import { roleGuard } from '../../middleware/roleGuard';

const router = Router();

router.get('/dashboard',       authGuard, roleGuard('TEACHER'), getDashboardHandler);
router.get('/profile',         authGuard, roleGuard('TEACHER'), getProfileHandler);
router.patch('/profile',       authGuard, roleGuard('TEACHER'), updateProfileHandler);
router.post('/reset-password', authGuard, roleGuard('TEACHER'), resetPasswordHandler);
router.get('/classes',         authGuard, roleGuard('TEACHER'), listClassesHandler);
router.get('/students',        authGuard, roleGuard('TEACHER'), listStudentsHandler);
router.get('/announcements',   authGuard, roleGuard('TEACHER'), listAnnouncementsHandler);
router.get('/events',          authGuard, roleGuard('TEACHER'), listEventsHandler);

router.get('/schedule/today',  authGuard, roleGuard('TEACHER'), getTodayScheduleHandler);
router.get('/schedule/week',   authGuard, roleGuard('TEACHER'), getWeekScheduleHandler);

router.get('/attendance',                     authGuard, roleGuard('TEACHER'), getSectionAttendanceHandler);
router.post('/attendance',                    authGuard, roleGuard('TEACHER'), markAttendanceHandler);
router.get('/attendance/students/:studentId', authGuard, roleGuard('TEACHER'), getStudentAttendanceHistoryHandler);
router.patch('/attendance/:recordId',         authGuard, roleGuard('TEACHER'), updateAttendanceRecordHandler);

router.post('/homework',              authGuard, roleGuard('TEACHER'), createHomeworkHandler);
router.get('/homework',               authGuard, roleGuard('TEACHER'), listHomeworkHandler);
router.get('/homework/:homeworkId',   authGuard, roleGuard('TEACHER'), getHomeworkHandler);
router.patch('/homework/:homeworkId', authGuard, roleGuard('TEACHER'), updateHomeworkHandler);
router.delete('/homework/:homeworkId', authGuard, roleGuard('TEACHER'), deleteHomeworkHandler);
router.get('/homework/:homeworkId/students',   authGuard, roleGuard('TEACHER'), getHomeworkStudentsHandler);
router.patch('/homework/:homeworkId/students', authGuard, roleGuard('TEACHER'), markHomeworkSubmissionsHandler);

router.get('/my-attendance',     authGuard, roleGuard('TEACHER'), listMyAttendanceRecordsHandler);

router.get('/leave',             authGuard, roleGuard('TEACHER'), listLeaveRequestsHandler);
router.patch('/leave/:leaveId',  authGuard, roleGuard('TEACHER'), reviewLeaveRequestHandler);

router.post('/my-leave',            authGuard, roleGuard('TEACHER'), applyMyLeaveHandler);
router.get('/my-leave',             authGuard, roleGuard('TEACHER'), listMyLeaveHandler);
router.delete('/my-leave/:leaveId', authGuard, roleGuard('TEACHER'), cancelMyLeaveHandler);

export default router;
