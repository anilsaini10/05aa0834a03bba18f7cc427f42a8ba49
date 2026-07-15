import { Request, Response, NextFunction } from 'express';
import * as eventsService from './events.service';
import {
  createEventSchema,
  updateEventSchema,
  listEventsQuerySchema,
} from './events.validation';
import { sendSuccess } from '../../shared/utils/apiResponse';

// ── POST /admin/events ─────────────────────────────────────────
export const createHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input    = createEventSchema.parse(req.body);
    const schoolId = (req as any).user.schoolId;
    const userId   = (req as any).user.sub;
    const result   = await eventsService.createEvent(schoolId, userId, input);
    sendSuccess(res, result, 201);
  } catch (err) {
    next(err);
  }
};

// ── GET /admin/events ──────────────────────────────────────────
export const listHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query    = listEventsQuerySchema.parse(req.query);
    const schoolId = (req as any).user.schoolId;
    const result   = await eventsService.listEvents(schoolId, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── GET /admin/events/:eventId ─────────────────────────────────
export const getByIdHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const schoolId = (req as any).user.schoolId;
    const result   = await eventsService.getEventById(schoolId, req.params.eventId);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /admin/events/:eventId ───────────────────────────────
export const updateHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input    = updateEventSchema.parse(req.body);
    const schoolId = (req as any).user.schoolId;
    const result   = await eventsService.updateEvent(schoolId, req.params.eventId, input);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── DELETE /admin/events/:eventId ──────────────────────────────
export const deleteHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const schoolId = (req as any).user.schoolId;
    await eventsService.deleteEvent(schoolId, req.params.eventId);
    sendSuccess(res, { message: 'Event deleted successfully' });
  } catch (err) {
    next(err);
  }
};
