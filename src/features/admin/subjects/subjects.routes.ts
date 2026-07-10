import { Router } from 'express';
import { listHandler, createHandler } from './subjects.controller';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';

const router = Router();

router.get('/',  authGuard, roleGuard('ADMIN'), listHandler);
router.post('/', authGuard, roleGuard('ADMIN'), createHandler);

export default router;
