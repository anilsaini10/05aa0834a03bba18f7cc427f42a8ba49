import { Router } from 'express';
import {
  createHandler,
  listHandler,
  getByIdHandler,
  updateHandler,
  deleteHandler,
} from './events.controller';
import { authGuard } from '../../middleware/authGuard';
import { roleGuard } from '../../middleware/roleGuard';

const router = Router();

router.post('/',            authGuard, roleGuard('ADMIN'), createHandler);
router.get('/',              authGuard, roleGuard('ADMIN'), listHandler);
router.get('/:eventId',      authGuard, roleGuard('ADMIN'), getByIdHandler);
router.patch('/:eventId',    authGuard, roleGuard('ADMIN'), updateHandler);
router.delete('/:eventId',   authGuard, roleGuard('ADMIN'), deleteHandler);

export default router;
