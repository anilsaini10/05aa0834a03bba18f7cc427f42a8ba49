import { z } from 'zod';
import { LeaveStatus } from '@prisma/client';

export const listLeaveQuerySchema = z.object({
  status:    z.nativeEnum(LeaveStatus).optional(),
  classId:   z.string().uuid('Invalid class id').optional(),
  sectionId: z.string().uuid('Invalid section id').optional(),
});

export const reviewLeaveSchema = z.object({
  status:        z.enum(['APPROVED', 'REJECTED']),
  reviewRemarks: z.string().max(500).optional(),
});

export const listTeacherLeaveQuerySchema = z.object({
  status: z.nativeEnum(LeaveStatus).optional(),
});

export type ListLeaveQuerySchema        = z.infer<typeof listLeaveQuerySchema>;
export type ReviewLeaveSchema           = z.infer<typeof reviewLeaveSchema>;
export type ListTeacherLeaveQuerySchema = z.infer<typeof listTeacherLeaveQuerySchema>;
