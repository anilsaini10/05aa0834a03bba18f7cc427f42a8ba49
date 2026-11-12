import { z } from 'zod';

export const submitCrashReportSchema = z.object({
  appVersion:   z.string().max(50).optional(),
  buildNumber:  z.string().max(50).optional(),
  platform:     z.enum(['ANDROID', 'IOS', 'WEB']).optional(),
  osVersion:    z.string().max(100).optional(),
  deviceModel:  z.string().max(200).optional(),
  errorMessage: z.string().min(1, 'Error message is required').max(5000),
  stackTrace:   z.string().max(50000).optional(),
  errorType:    z.string().max(200).optional(),
  isFatal:      z.boolean().default(true),
  crashedAt:    z.coerce.date().optional(),
  metadata:     z.record(z.unknown()).optional(),
});

export const listCrashReportsQuerySchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  platform: z.enum(['ANDROID', 'IOS', 'WEB']).optional(),
  isFatal:  z.enum(['true', 'false']).transform(v => v === 'true').optional(),
  search:   z.string().trim().max(200).optional(),
});

export type SubmitCrashReportSchema    = z.infer<typeof submitCrashReportSchema>;
export type ListCrashReportsQuerySchema = z.infer<typeof listCrashReportsQuerySchema>;
