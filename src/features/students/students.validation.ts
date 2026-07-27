import { z } from 'zod';
import { LeaveStatus, EventType } from '@prisma/client';

export const updateProfileSchema = z.object({
  name:  z.string().min(2, 'Name must be at least 2 characters').max(100).optional(),
  phone: z.string().min(10).max(15).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const resetPasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword:     z.string().min(6, 'New password must be at least 6 characters').max(100),
});

export const listMyAnnouncementsQuerySchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(15),
  search:   z.string().trim().min(1).optional(),
  from:     z.coerce.date({ errorMap: () => ({ message: 'Invalid from date' }) }).optional(),
  to:       z.coerce.date({ errorMap: () => ({ message: 'Invalid to date' }) }).optional(),
});

export const listMyEventsQuerySchema = z.object({
  page:      z.coerce.number().int().positive().default(1),
  pageSize:  z.coerce.number().int().positive().max(100).default(15),
  search:    z.string().trim().min(1).optional(),
  eventType: z.nativeEnum(EventType).optional(),
  from:      z.coerce.date({ errorMap: () => ({ message: 'Invalid from date' }) }).optional(),
  to:        z.coerce.date({ errorMap: () => ({ message: 'Invalid to date' }) }).optional(),
});

export const listMyExamsQuerySchema = z.object({
  studentId: z.string().uuid('Invalid student id'),
});

export const getMyExamResultQuerySchema = z.object({
  studentId: z.string().uuid('Invalid student id'),
});

export const getMyChildTimetableQuerySchema = z.object({
  studentId: z.string().uuid('Invalid student id'),
});

export const getMyDashboardQuerySchema = z.object({
  studentId: z.string().uuid('Invalid student id'),
});

export const getMyChildAttendanceQuerySchema = z.object({
  studentId: z.string().uuid('Invalid student id'),
  from: z.coerce.date({ errorMap: () => ({ message: 'Invalid from date' }) }).optional(),
  to:   z.coerce.date({ errorMap: () => ({ message: 'Invalid to date' }) }).optional(),
}).refine(
  data => !data.from || !data.to || data.to >= data.from,
  { message: 'to must be on or after from', path: ['to'] },
);

export const applyLeaveSchema = z.object({
  studentId: z.string().uuid('Invalid student id'),
  fromDate:  z.coerce.date({ errorMap: () => ({ message: 'Invalid from date' }) }),
  toDate:    z.coerce.date({ errorMap: () => ({ message: 'Invalid to date' }) }),
  reason:    z.string().min(2, 'Reason is required').max(500),
}).refine(
  data => data.toDate >= data.fromDate,
  { message: 'toDate must be on or after fromDate', path: ['toDate'] },
);

export const listMyLeaveQuerySchema = z.object({
  studentId: z.string().uuid('Invalid student id'),
  status:    z.nativeEnum(LeaveStatus).optional(),
});

export const listMyChildHomeworkQuerySchema = z.object({
  studentId: z.string().uuid('Invalid student id'),
  subjectId: z.string().uuid('Invalid subject id').optional(),
  page:      z.coerce.number().int().positive().default(1),
  pageSize:  z.coerce.number().int().positive().max(100).default(15),
});

export const getMyChildHomeworkQuerySchema = z.object({
  studentId: z.string().uuid('Invalid student id'),
});

export type UpdateProfileSchema           = z.infer<typeof updateProfileSchema>;
export type ResetPasswordSchema           = z.infer<typeof resetPasswordSchema>;
export type ListMyAnnouncementsQuerySchema = z.infer<typeof listMyAnnouncementsQuerySchema>;
export type ListMyEventsQuerySchema        = z.infer<typeof listMyEventsQuerySchema>;
export type ListMyExamsQuerySchema        = z.infer<typeof listMyExamsQuerySchema>;
export type GetMyExamResultQuerySchema    = z.infer<typeof getMyExamResultQuerySchema>;
export type GetMyChildTimetableQuerySchema  = z.infer<typeof getMyChildTimetableQuerySchema>;
export type GetMyDashboardQuerySchema       = z.infer<typeof getMyDashboardQuerySchema>;
export type GetMyChildAttendanceQuerySchema = z.infer<typeof getMyChildAttendanceQuerySchema>;
export type ApplyLeaveSchema              = z.infer<typeof applyLeaveSchema>;
export type ListMyLeaveQuerySchema        = z.infer<typeof listMyLeaveQuerySchema>;
export type ListMyChildHomeworkQuerySchema = z.infer<typeof listMyChildHomeworkQuerySchema>;
export type GetMyChildHomeworkQuerySchema  = z.infer<typeof getMyChildHomeworkQuerySchema>;
