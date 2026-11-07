import { Router } from 'express';
import {
  createChapterHandler, listChaptersHandler, getChapterHandler,
  updateChapterHandler, deleteChapterHandler, toggleChapterStatusHandler, reorderChaptersHandler,
  createPlanHandler, listPlansHandler, getPlanHandler,
  updatePlanHandler, updatePlanChapterHandler, deletePlanHandler,
  getDashboardHandler, getClassProgressHandler, getTeacherProgressHandler, getDelayedChaptersHandler,
  listApprovalsHandler, reviewApprovalHandler, adminCorrectionHandler,
} from './syllabus.controller';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';

const router = Router();
const guard = [authGuard, roleGuard('ADMIN')] as const;

// ── Chapters ─────────────────────────────────────────────────────
router.post('/chapters',                    ...guard, createChapterHandler);
router.get('/chapters',                     ...guard, listChaptersHandler);
router.patch('/chapters/reorder',           ...guard, reorderChaptersHandler);
router.get('/chapters/:chapterId',          ...guard, getChapterHandler);
router.patch('/chapters/:chapterId',        ...guard, updateChapterHandler);
router.delete('/chapters/:chapterId',       ...guard, deleteChapterHandler);
router.patch('/chapters/:chapterId/status', ...guard, toggleChapterStatusHandler);

// ── Plans ────────────────────────────────────────────────────────
router.post('/plans',                                ...guard, createPlanHandler);
router.get('/plans',                                 ...guard, listPlansHandler);
router.get('/plans/:planId',                         ...guard, getPlanHandler);
router.patch('/plans/:planId',                       ...guard, updatePlanHandler);
router.delete('/plans/:planId',                      ...guard, deletePlanHandler);
router.patch('/plans/:planId/chapters/:chapterId',   ...guard, updatePlanChapterHandler);

// ── Monitoring ───────────────────────────────────────────────────
router.get('/dashboard',                    ...guard, getDashboardHandler);
router.get('/reports/class-progress',       ...guard, getClassProgressHandler);
router.get('/reports/teacher-progress',     ...guard, getTeacherProgressHandler);
router.get('/reports/delayed-chapters',     ...guard, getDelayedChaptersHandler);

// ── Approval ─────────────────────────────────────────────────────
router.get('/approvals',                              ...guard, listApprovalsHandler);
router.patch('/approvals/:approvalId',                ...guard, reviewApprovalHandler);
router.patch('/approvals/correct/:planChapterId',     ...guard, adminCorrectionHandler);

export default router;
