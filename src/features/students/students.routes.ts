import { Router } from 'express';
import {
  getProfileHandler,
  updateProfileHandler,
  resetPasswordHandler,
  listAnnouncementsHandler,
} from './students.controller';
import { authGuard } from '../../middleware/authGuard';
import { roleGuard } from '../../middleware/roleGuard';

const router = Router();

router.get('/profile',         authGuard, roleGuard('PARENT'), getProfileHandler);
router.patch('/profile',       authGuard, roleGuard('PARENT'), updateProfileHandler);
router.post('/reset-password', authGuard, roleGuard('PARENT'), resetPasswordHandler);
router.get('/announcements',   authGuard, roleGuard('PARENT'), listAnnouncementsHandler);

export default router;
