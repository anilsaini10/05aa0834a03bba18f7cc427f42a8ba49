import { Router } from 'express';
import { getMySchoolHandler, updateMySchoolHandler } from './school.controller';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';

const router = Router();

router.get('/',   authGuard, roleGuard('ADMIN'), getMySchoolHandler);
router.patch('/', authGuard, roleGuard('ADMIN'), updateMySchoolHandler);

export default router;
