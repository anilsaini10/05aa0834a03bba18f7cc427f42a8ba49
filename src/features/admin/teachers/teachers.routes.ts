import { Router } from 'express';
import { createHandler, listHandler, getByIdHandler } from './teachers.controller';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';

const router = Router();

router.post('/',             authGuard, roleGuard('ADMIN'), createHandler);
router.get('/',              authGuard, roleGuard('ADMIN'), listHandler);
router.get('/:teacherId',    authGuard, roleGuard('ADMIN'), getByIdHandler);

export default router;
