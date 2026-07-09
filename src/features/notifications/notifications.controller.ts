import { Request, Response, NextFunction } from 'express';
import * as notificationsService from './notifications.service';
import {
  registerTokenSchema, unregisterTokenSchema, sendNotificationSchema,
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
