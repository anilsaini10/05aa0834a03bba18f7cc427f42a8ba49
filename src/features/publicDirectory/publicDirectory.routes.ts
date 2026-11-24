import { Router } from 'express';
import {
  listSchoolsHandler,
  getSchoolDetailHandler,
  listTeachersHandler,
} from './publicDirectory.controller';

const router = Router();

router.get('/', listSchoolsHandler);
router.get('/:schoolId', getSchoolDetailHandler);
router.get('/:schoolId/teachers', listTeachersHandler);

export default router;
