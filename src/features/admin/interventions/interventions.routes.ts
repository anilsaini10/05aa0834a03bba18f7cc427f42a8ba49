import { Router } from 'express';
import { createHandler, listHandler, getHandler, updateHandler } from './interventions.controller';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';

// Mounted at /api/admin/interventions.
const router = Router();
const admin = [authGuard, roleGuard('ADMIN')] as const;

router.post('/',      ...admin, createHandler);
router.get('/',       ...admin, listHandler);
router.get('/:id',    ...admin, getHandler);
router.patch('/:id',  ...admin, updateHandler);

export default router;
