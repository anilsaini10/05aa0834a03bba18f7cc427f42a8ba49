import { Router } from 'express';
import { getStatsHandler } from './dashboard.controller';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';

const router = Router();

router.get('/', authGuard, roleGuard('ADMIN'), getStatsHandler);

export default router;
