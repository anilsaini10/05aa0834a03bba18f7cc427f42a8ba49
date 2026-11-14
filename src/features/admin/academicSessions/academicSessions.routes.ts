import { Router } from 'express';
import {
  createHandler, updateHandler, listHandler, getByIdHandler,
  getCurrentHandler, deleteHandler,
} from './academicSessions.controller';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';

const router = Router();

router.post('/',                authGuard, roleGuard('ADMIN'), createHandler);
router.get('/',                 authGuard, roleGuard('ADMIN'), listHandler);
router.get('/current',          authGuard, roleGuard('ADMIN'), getCurrentHandler);
router.get('/:sessionId',       authGuard, roleGuard('ADMIN'), getByIdHandler);
router.patch('/:sessionId',     authGuard, roleGuard('ADMIN'), updateHandler);
router.delete('/:sessionId',    authGuard, roleGuard('ADMIN'), deleteHandler);

export default router;
