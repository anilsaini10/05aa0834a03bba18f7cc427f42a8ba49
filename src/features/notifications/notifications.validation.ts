import { z } from 'zod';

export const registerTokenSchema = z.object({
  token:    z.string().min(1, 'Token is required'),
  platform: z.enum(['ANDROID', 'IOS', 'WEB']).optional(),
});

export const unregisterTokenSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export const sendNotificationSchema = z.object({
  userId: z.string().uuid('Invalid user id'),
  title:  z.string().min(1, 'Title is required').max(200),
  body:   z.string().min(1, 'Body is required').max(1000),
  data:   z.record(z.string()).optional(),
});

// GET /notifications — the logged-in user's own inbox.
// isRead is parsed from an explicit 'true'/'false' string, not
// z.coerce.boolean() — that coerces ANY non-empty string (including
// the literal text "false") to true, which would silently break this filter.
export const listNotificationsQuerySchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  isRead:   z.enum(['true', 'false']).transform(v => v === 'true').optional(),
  type:     z.string().trim().min(1).optional(),
});

export type RegisterTokenSchema        = z.infer<typeof registerTokenSchema>;
export type UnregisterTokenSchema      = z.infer<typeof unregisterTokenSchema>;
export type SendNotificationSchema     = z.infer<typeof sendNotificationSchema>;
export type ListNotificationsQuerySchema = z.infer<typeof listNotificationsQuerySchema>;
