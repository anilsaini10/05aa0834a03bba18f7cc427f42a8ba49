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

export type RegisterTokenSchema    = z.infer<typeof registerTokenSchema>;
export type UnregisterTokenSchema  = z.infer<typeof unregisterTokenSchema>;
export type SendNotificationSchema = z.infer<typeof sendNotificationSchema>;
