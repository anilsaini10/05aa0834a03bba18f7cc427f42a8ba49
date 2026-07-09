import { Router } from 'express';
import {
  registerHandler,
  unregisterHandler,
  sendHandler,
} from './notifications.controller';
import { authGuard } from '../../middleware/authGuard';
import { roleGuard } from '../../middleware/roleGuard';

const router = Router();

router.post('/register',   authGuard, registerHandler);
router.post('/unregister', authGuard, unregisterHandler);
router.post('/send',       authGuard, roleGuard('ADMIN'), sendHandler);

export default router;
