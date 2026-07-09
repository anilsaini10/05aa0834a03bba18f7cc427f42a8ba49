import { Router } from 'express';
import {
  signupHandler,
  loginHandler,
  refreshHandler,
  logoutHandler,
  meHandler,
} from './auth.controller';
import { authGuard } from '../../middleware/authGuard';

const router = Router();

router.post('/signup',  signupHandler);
router.post('/login',   loginHandler);
router.post('/refresh', refreshHandler);
router.post('/logout',  logoutHandler);
router.get('/me',       authGuard, meHandler);

export default router;
