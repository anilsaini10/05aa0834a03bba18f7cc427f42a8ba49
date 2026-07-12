import { Router } from 'express';
import {
  createHandler,
  listHandler,
  getByIdHandler,
  updateHandler,
  deleteHandler,
} from './announcements.controller';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';

const router = Router();

router.post('/',                    authGuard, roleGuard('ADMIN'), createHandler);
router.get('/',                     authGuard, roleGuard('ADMIN'), listHandler);
router.get('/:announcementId',      authGuard, roleGuard('ADMIN'), getByIdHandler);
router.patch('/:announcementId',    authGuard, roleGuard('ADMIN'), updateHandler);
router.delete('/:announcementId',   authGuard, roleGuard('ADMIN'), deleteHandler);

export default router;
