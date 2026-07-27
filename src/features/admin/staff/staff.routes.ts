import { Router } from 'express';
import { createHandler, listHandler, getByIdHandler, updateHandler, deleteHandler } from './staff.controller';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';

const router = Router();
const admin  = [authGuard, roleGuard('ADMIN')] as const;

router.post('/',             ...admin, createHandler);
router.get('/',              ...admin, listHandler);
router.get('/:staffId',      ...admin, getByIdHandler);
router.patch('/:staffId',    ...admin, updateHandler);
router.delete('/:staffId',   ...admin, deleteHandler);

export default router;
