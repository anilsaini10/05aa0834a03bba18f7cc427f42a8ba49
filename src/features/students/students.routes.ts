import { Router } from 'express';
import {
  getProfileHandler,
  updateProfileHandler,
  resetPasswordHandler,
} from './students.controller';
import { authGuard } from '../../middleware/authGuard';
import { roleGuard } from '../../middleware/roleGuard';

const router = Router();

router.get('/profile',         authGuard, roleGuard('PARENT'), getProfileHandler);
router.patch('/profile',       authGuard, roleGuard('PARENT'), updateProfileHandler);
router.post('/reset-password', authGuard, roleGuard('PARENT'), resetPasswordHandler);

export default router;
