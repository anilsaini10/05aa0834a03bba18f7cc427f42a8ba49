import { Router } from 'express';
import { resetPasswordHandler } from './users.controller';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';

const router = Router();

router.post('/:userId/reset-password', authGuard, roleGuard('ADMIN'), resetPasswordHandler);

export default router;
