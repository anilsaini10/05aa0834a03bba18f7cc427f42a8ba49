import { Router } from 'express';
import { listHandler, listLoginRolesHandler } from './schools.controller';

const router = Router();

router.get('/', listHandler);
router.get('/:schoolId/roles', listLoginRolesHandler);

export default router;
