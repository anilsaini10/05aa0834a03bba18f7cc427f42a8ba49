import { Router } from 'express';
import {
  registerHandler,
  unregisterHandler,
  sendHandler,
  listMyNotificationsHandler,
  getUnreadCountHandler,
  markNotificationReadHandler,
  markAllNotificationsReadHandler,
} from './notifications.controller';
import { authGuard } from '../../middleware/authGuard';
import { roleGuard } from '../../middleware/roleGuard';

const router = Router();

router.post('/register',   authGuard, registerHandler);
router.post('/unregister', authGuard, unregisterHandler);
router.post('/send',       authGuard, roleGuard('ADMIN'), sendHandler);

// In-app inbox — any authenticated role reads/manages only their own.
router.get('/',             authGuard, listMyNotificationsHandler);
router.get('/unread-count', authGuard, getUnreadCountHandler);
router.patch('/read-all',   authGuard, markAllNotificationsReadHandler);
router.patch('/:id/read',   authGuard, markNotificationReadHandler);

export default router;
