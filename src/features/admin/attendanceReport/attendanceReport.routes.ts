import { Router } from 'express';
import {
  listClassSummaryHandler,
  listClassStudentsHandler,
} from './attendanceReport.controller';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';

const router = Router();

router.get('/classes',                    authGuard, roleGuard('ADMIN'), listClassSummaryHandler);
router.get('/classes/:classId/students',  authGuard, roleGuard('ADMIN'), listClassStudentsHandler);

export default router;
