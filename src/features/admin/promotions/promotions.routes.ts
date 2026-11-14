import { Router } from 'express';
import {
  previewHandler, executeHandler, rollbackHandler,
  listHistoryHandler, getBatchHandler,
} from './promotions.controller';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';

const router = Router();

router.post('/preview',            authGuard, roleGuard('ADMIN'), previewHandler);
router.post('/execute',            authGuard, roleGuard('ADMIN'), executeHandler);
router.post('/rollback/:batchId',  authGuard, roleGuard('ADMIN'), rollbackHandler);
router.get('/history',             authGuard, roleGuard('ADMIN'), listHistoryHandler);
router.get('/history/:batchId',    authGuard, roleGuard('ADMIN'), getBatchHandler);

export default router;
