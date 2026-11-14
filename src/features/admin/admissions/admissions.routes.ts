import { Router } from 'express';
import {
  createHandler, updateHandler, getByIdHandler,
  listHandler, enrollHandler, statsHandler, deleteHandler,
} from './admissions.controller';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';

const router = Router();

router.post('/',                        authGuard, roleGuard('ADMIN'), createHandler);
router.get('/',                         authGuard, roleGuard('ADMIN'), listHandler);
router.get('/stats',                    authGuard, roleGuard('ADMIN'), statsHandler);
router.get('/:admissionId',             authGuard, roleGuard('ADMIN'), getByIdHandler);
router.patch('/:admissionId',           authGuard, roleGuard('ADMIN'), updateHandler);
router.post('/:admissionId/enroll',     authGuard, roleGuard('ADMIN'), enrollHandler);
router.delete('/:admissionId',          authGuard, roleGuard('ADMIN'), deleteHandler);

export default router;
