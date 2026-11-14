import { Router } from 'express';
import {
  createQueryHandler,
  listMyQueriesHandler,
  getMyQueryHandler,
  listAllQueriesHandler,
  getQueryHandler,
  updateQueryHandler,
} from './parentQueries.controller';
import { authGuard } from '../../middleware/authGuard';
import { roleGuard } from '../../middleware/roleGuard';

// ── Parent: submit & view own queries ────────────────────────
// Mounted at /api/students/parent-queries
export const parentQueryRouter = Router();
const parent = [authGuard, roleGuard('PARENT')] as const;

parentQueryRouter.post('/',          ...parent, createQueryHandler);
parentQueryRouter.get('/',           ...parent, listMyQueriesHandler);
parentQueryRouter.get('/:queryId',   ...parent, getMyQueryHandler);

// ── Admin / Principal: view & reply to parent queries ────────
// Mounted at /api/admin/parent-queries
export const adminParentQueryRouter = Router();
const admin = [authGuard, roleGuard('ADMIN')] as const;

adminParentQueryRouter.get('/',             ...admin, listAllQueriesHandler);
adminParentQueryRouter.get('/:queryId',     ...admin, getQueryHandler);
adminParentQueryRouter.patch('/:queryId',   ...admin, updateQueryHandler);
