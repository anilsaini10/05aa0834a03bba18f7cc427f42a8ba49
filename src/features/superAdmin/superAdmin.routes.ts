import { Router } from 'express';
import {
  createSchoolHandler,
  listSchoolsHandler,
  getSchoolByIdHandler,
  updateSchoolHandler,
  createAdminHandler,
  listAdminsHandler,
  updateAdminHandler,
  setAdminStatusHandler,
  listAllAdminsHandler,
} from './superAdmin.controller';
import { authGuard } from '../../middleware/authGuard';
import { roleGuard } from '../../middleware/roleGuard';

const router = Router();

router.use(authGuard, roleGuard('SUPER_ADMIN'));

router.post('/schools',                                  createSchoolHandler);
router.get('/schools',                                   listSchoolsHandler);
router.get('/schools/:schoolId',                         getSchoolByIdHandler);
router.patch('/schools/:schoolId',                       updateSchoolHandler);
router.post('/schools/:schoolId/admins',                 createAdminHandler);
router.get('/schools/:schoolId/admins',                  listAdminsHandler);
router.patch('/schools/:schoolId/admins/:adminId',       updateAdminHandler);
router.patch('/schools/:schoolId/admins/:adminId/status', setAdminStatusHandler);
router.get('/admins',                                    listAllAdminsHandler);

export default router;
