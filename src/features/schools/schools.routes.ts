import { Router } from 'express';
import { listHandler } from './schools.controller';

const router = Router();

router.get('/', listHandler);

export default router;
