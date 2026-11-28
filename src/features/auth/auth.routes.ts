import { Router } from 'express';
import {
  signupHandler,
  loginHandler,
  sendLoginOtpHandler,
  verifyLoginOtpHandler,
  sendEmailLoginOtpHandler,
  verifyEmailLoginOtpHandler,
  refreshHandler,
  logoutHandler,
  meHandler,
  resetPasswordHandler,
  updateUsernameHandler,
  forgotPasswordHandler,
  resetPasswordConfirmHandler,
  updateProfilePhotoHandler,
} from './auth.controller';
import { authGuard } from '../../middleware/authGuard';
import { roleGuard } from '../../middleware/roleGuard';
import { imageUpload } from '../../middleware/upload';

const router = Router();

router.post('/signup',  signupHandler);
router.post('/login',   loginHandler);
router.post('/login/otp/send',   sendLoginOtpHandler);
router.post('/login/otp/verify', verifyLoginOtpHandler);
router.post('/login/email-otp/send',   sendEmailLoginOtpHandler);
router.post('/login/email-otp/verify', verifyEmailLoginOtpHandler);
router.post('/refresh', refreshHandler);
router.post('/logout',  logoutHandler);
router.get('/me',       authGuard, meHandler);
router.post('/reset-password', authGuard, roleGuard('ADMIN', 'SUPER_ADMIN'), resetPasswordHandler);
router.patch('/username', authGuard, roleGuard('ADMIN', 'SUPER_ADMIN'), updateUsernameHandler);
router.patch('/profile-photo', authGuard, imageUpload.single('profilePhoto'), updateProfilePhotoHandler);
router.post('/forgot-password',        forgotPasswordHandler);
router.post('/reset-password/confirm', resetPasswordConfirmHandler);

export default router;
