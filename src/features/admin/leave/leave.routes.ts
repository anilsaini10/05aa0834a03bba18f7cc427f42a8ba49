import { Router } from 'express';
import {
  listHandler,
  reviewHandler,
  listTeacherLeaveHandler,
  reviewTeacherLeaveHandler,
} from './leave.controller';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';

const router = Router();
const admin  = [authGuard, roleGuard('ADMIN')] as const;

router.get('/teachers',            ...admin, listTeacherLeaveHandler);
router.patch('/teachers/:leaveId', ...admin, reviewTeacherLeaveHandler);

router.get('/',            ...admin, listHandler);
router.patch('/:leaveId',  ...admin, reviewHandler);

export default router;
