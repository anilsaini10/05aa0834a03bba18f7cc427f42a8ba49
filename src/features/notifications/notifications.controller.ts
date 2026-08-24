import { Request, Response, NextFunction } from 'express';
import * as notificationsService from './notifications.service';
import {
  registerTokenSchema, unregisterTokenSchema, sendNotificationSchema,
  listNotificationsQuerySchema,
} from './notifications.validation';
import { sendSuccess } from '../../shared/utils/apiResponse';

// ── POST /notifications/register ─────────────────────────────
export const registerHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { token, platform } = registerTokenSchema.parse(req.body);
    const userId              = (req as any).user.sub;
    const deviceToken         = await notificationsService.registerDeviceToken(userId, token, platform);
    sendSuccess(res, { deviceToken }, 201);
  } catch (err) {
    next(err);
  }
};

// ── POST /notifications/unregister ───────────────────────────
export const unregisterHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { token } = unregisterTokenSchema.parse(req.body);
    await notificationsService.unregisterDeviceToken(token);
    sendSuccess(res, { message: 'Device token unregistered' });
  } catch (err) {
    next(err);
  }
};

// ── POST /notifications/send ─────────────────────────────────
export const sendHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { userId, title, body, data } = sendNotificationSchema.parse(req.body);
    const result = await notificationsService.sendToUser(userId, { title, body, data });
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── GET /notifications — my own inbox, paginated + filterable ────
export const listMyNotificationsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query  = listNotificationsQuerySchema.parse(req.query);
    const userId = (req as any).user.sub;
    const result = await notificationsService.listMyNotifications(userId, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── GET /notifications/unread-count ───────────────────────────
export const getUnreadCountHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = (req as any).user.sub;
    const count  = await notificationsService.getUnreadCount(userId);
    sendSuccess(res, { unreadCount: count });
  } catch (err) {
    next(err);
  }
};

// ── PATCH /notifications/:id/read ─────────────────────────────
export const markNotificationReadHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId       = (req as any).user.sub;
    const notification = await notificationsService.markNotificationRead(userId, req.params.id);
    sendSuccess(res, notification);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /notifications/read-all ─────────────────────────────
export const markAllNotificationsReadHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = (req as any).user.sub;
    const result = await notificationsService.markAllNotificationsRead(userId);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};
