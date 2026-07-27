import { Router } from 'express';
import { markHandler, listHandler, updateHandler } from './teacherAttendance.controller';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';

const router = Router();
const admin  = [authGuard, roleGuard('ADMIN')] as const;

router.post('/',           ...admin, markHandler);
router.get('/',             ...admin, listHandler);
router.patch('/:recordId',  ...admin, updateHandler);

export default router;
