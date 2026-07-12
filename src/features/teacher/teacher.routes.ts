import { Router } from 'express';
import {
  getProfileHandler,
  updateProfileHandler,
  resetPasswordHandler,
  listClassesHandler,
  listStudentsHandler,
  listAnnouncementsHandler,
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

export default router;
