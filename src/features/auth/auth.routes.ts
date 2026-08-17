import { Router } from 'express';
import {
  signupHandler,
  loginHandler,
  refreshHandler,
  logoutHandler,
  meHandler,
  resetPasswordHandler,
  forgotPasswordHandler,
  resetPasswordConfirmHandler,
} from './auth.controller';
import { authGuard } from '../../middleware/authGuard';
import { roleGuard } from '../../middleware/roleGuard';

const router = Router();

router.post('/signup',  signupHandler);
router.post('/login',   loginHandler);
router.post('/refresh', refreshHandler);
router.post('/logout',  logoutHandler);
router.get('/me',       authGuard, meHandler);
router.post('/reset-password', authGuard, roleGuard('ADMIN', 'SUPER_ADMIN'), resetPasswordHandler);
router.post('/forgot-password',        forgotPasswordHandler);
router.post('/reset-password/confirm', resetPasswordConfirmHandler);

export default router;
