import { Request, Response, NextFunction } from 'express';
import * as announcementsService from './announcements.service';
import {
  createAnnouncementSchema,
  updateAnnouncementSchema,
  listAnnouncementsQuerySchema,
} from './announcements.validation';
import { sendSuccess } from '../../../shared/utils/apiResponse';

// ── POST /admin/announcements ──────────────────────────────────
export const createHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input    = createAnnouncementSchema.parse(req.body);
    const schoolId = (req as any).user.schoolId;
    const userId   = (req as any).user.sub;
    const result   = await announcementsService.createAnnouncement(schoolId, userId, input);
    sendSuccess(res, result, 201);
  } catch (err) {
    next(err);
  }
};

// ── GET /admin/announcements ───────────────────────────────────
export const listHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query    = listAnnouncementsQuerySchema.parse(req.query);
    const schoolId = (req as any).user.schoolId;
    const result   = await announcementsService.listAnnouncements(schoolId, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── GET /admin/announcements/:announcementId ───────────────────
export const getByIdHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const schoolId = (req as any).user.schoolId;
    const result   = await announcementsService.getAnnouncementById(schoolId, req.params.announcementId);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /admin/announcements/:announcementId ─────────────────
export const updateHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input    = updateAnnouncementSchema.parse(req.body);
    const schoolId = (req as any).user.schoolId;
    const result   = await announcementsService.updateAnnouncement(schoolId, req.params.announcementId, input);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── DELETE /admin/announcements/:announcementId ────────────────
export const deleteHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const schoolId = (req as any).user.schoolId;
    await announcementsService.deleteAnnouncement(schoolId, req.params.announcementId);
    sendSuccess(res, { message: 'Announcement deleted successfully' });
  } catch (err) {
    next(err);
  }
};
