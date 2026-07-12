import { z } from 'zod';

export const updateProfileSchema = z.object({
  name:  z.string().min(2, 'Name must be at least 2 characters').max(100).optional(),
  phone: z.string().min(10).max(15).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const resetPasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword:     z.string().min(8, 'New password must be at least 8 characters').max(100),
});

export const listMyStudentsQuerySchema = z.object({
  classId:   z.string().uuid('classId is required'),
  sectionId: z.string().uuid('Invalid section id').optional(),
  page:      z.coerce.number().int().positive().default(1),
  pageSize:  z.coerce.number().int().positive().max(100).default(15),
  search:    z.string().trim().min(1).optional(),
});

export const listMyAnnouncementsQuerySchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(15),
  search:   z.string().trim().min(1).optional(),
});

export type UpdateProfileSchema           = z.infer<typeof updateProfileSchema>;
export type ResetPasswordSchema           = z.infer<typeof resetPasswordSchema>;
export type ListMyStudentsQuerySchema      = z.infer<typeof listMyStudentsQuerySchema>;
export type ListMyAnnouncementsQuerySchema = z.infer<typeof listMyAnnouncementsQuerySchema>;
