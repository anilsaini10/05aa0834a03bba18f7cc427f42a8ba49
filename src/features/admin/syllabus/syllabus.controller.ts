import { Request, Response, NextFunction } from 'express';
import * as syllabusService from './syllabus.service';
import {
  createChapterSchema, updateChapterSchema, reorderChaptersSchema, listChaptersQuerySchema,
  createSyllabusPlanSchema, updateSyllabusPlanSchema, updatePlanChapterSchema, listPlansQuerySchema,
  monitoringQuerySchema,
  reviewApprovalSchema, adminCorrectionSchema,
} from './syllabus.validation';
import { sendSuccess } from '../../../shared/utils/apiResponse';

const userOf = (req: Request) => (req as any).user as { sub: string; schoolId: string };

// ── Chapter handlers ─────────────────────────────────────────────

export const createChapterHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = createChapterSchema.parse(req.body);
    const { sub, schoolId } = userOf(req);
    sendSuccess(res, await syllabusService.createChapter(schoolId, sub, input), 201);
  } catch (err) { next(err); }
};

export const listChaptersHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query = listChaptersQuerySchema.parse(req.query);
    sendSuccess(res, await syllabusService.listChapters(userOf(req).schoolId, query));
  } catch (err) { next(err); }
};

export const getChapterHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, await syllabusService.getChapterById(userOf(req).schoolId, req.params.chapterId));
  } catch (err) { next(err); }
};

export const updateChapterHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = updateChapterSchema.parse(req.body);
    sendSuccess(res, await syllabusService.updateChapter(userOf(req).schoolId, req.params.chapterId, input));
  } catch (err) { next(err); }
};

export const deleteChapterHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await syllabusService.deleteChapter(userOf(req).schoolId, req.params.chapterId);
    sendSuccess(res, { message: 'Chapter deactivated successfully' });
  } catch (err) { next(err); }
};

export const toggleChapterStatusHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, await syllabusService.toggleChapterStatus(userOf(req).schoolId, req.params.chapterId));
  } catch (err) { next(err); }
};

export const reorderChaptersHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = reorderChaptersSchema.parse(req.body);
    sendSuccess(res, await syllabusService.reorderChapters(userOf(req).schoolId, input));
  } catch (err) { next(err); }
};

// ── Plan handlers ────────────────────────────────────────────────

export const createPlanHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = createSyllabusPlanSchema.parse(req.body);
    const { sub, schoolId } = userOf(req);
    sendSuccess(res, await syllabusService.createSyllabusPlan(schoolId, sub, input), 201);
  } catch (err) { next(err); }
};

export const listPlansHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query = listPlansQuerySchema.parse(req.query);
    sendSuccess(res, await syllabusService.listSyllabusPlans(userOf(req).schoolId, query));
  } catch (err) { next(err); }
};

export const getPlanHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, await syllabusService.getSyllabusPlanById(userOf(req).schoolId, req.params.planId));
  } catch (err) { next(err); }
};

export const updatePlanHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = updateSyllabusPlanSchema.parse(req.body);
    sendSuccess(res, await syllabusService.updateSyllabusPlan(userOf(req).schoolId, req.params.planId, input));
  } catch (err) { next(err); }
};

export const updatePlanChapterHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = updatePlanChapterSchema.parse(req.body);
    sendSuccess(res, await syllabusService.updatePlanChapter(userOf(req).schoolId, req.params.planId, req.params.chapterId, input));
  } catch (err) { next(err); }
};

export const deletePlanHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await syllabusService.deleteSyllabusPlan(userOf(req).schoolId, req.params.planId);
    sendSuccess(res, { message: 'Syllabus plan deleted successfully' });
  } catch (err) { next(err); }
};

// ── Monitoring handlers ──────────────────────────────────────────

export const getDashboardHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query = monitoringQuerySchema.parse(req.query);
    sendSuccess(res, await syllabusService.getSyllabusDashboard(userOf(req).schoolId, query.sessionYear));
  } catch (err) { next(err); }
};

export const getClassProgressHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query = monitoringQuerySchema.parse(req.query);
    sendSuccess(res, await syllabusService.getClassWiseProgress(userOf(req).schoolId, query));
  } catch (err) { next(err); }
};

export const getTeacherProgressHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query = monitoringQuerySchema.parse(req.query);
    sendSuccess(res, await syllabusService.getTeacherWiseProgress(userOf(req).schoolId, query));
  } catch (err) { next(err); }
};

export const getDelayedChaptersHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query = monitoringQuerySchema.parse(req.query);
    sendSuccess(res, await syllabusService.getDelayedChapters(userOf(req).schoolId, query));
  } catch (err) { next(err); }
};

// ── Approval handlers ────────────────────────────────────────────

export const listApprovalsHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query = monitoringQuerySchema.parse(req.query);
    sendSuccess(res, await syllabusService.listPendingApprovals(userOf(req).schoolId, query));
  } catch (err) { next(err); }
};

export const reviewApprovalHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = reviewApprovalSchema.parse(req.body);
    const { sub, schoolId } = userOf(req);
    sendSuccess(res, await syllabusService.reviewApproval(schoolId, sub, req.params.approvalId, input));
  } catch (err) { next(err); }
};

export const adminCorrectionHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = adminCorrectionSchema.parse(req.body);
    const { sub, schoolId } = userOf(req);
    sendSuccess(res, await syllabusService.adminCorrection(schoolId, sub, req.params.planChapterId, input));
  } catch (err) { next(err); }
};
