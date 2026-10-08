import { Router } from 'express';
import { createHandler, updateHandler, listHandler, getByIdHandler, deleteHandler } from './students.controller';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';

const router = Router();

router.post('/',             authGuard, roleGuard('ADMIN'), createHandler);
router.get('/',              authGuard, roleGuard('ADMIN'), listHandler);
router.get('/:studentId',    authGuard, roleGuard('ADMIN'), getByIdHandler);
router.patch('/:studentId',  authGuard, roleGuard('ADMIN'), updateHandler);
router.delete('/:studentId', authGuard, roleGuard('ADMIN'), deleteHandler);

export default router;