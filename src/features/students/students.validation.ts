import { z } from 'zod';

export const updateProfileSchema = z.object({
  name:  z.string().min(2, 'Name must be at least 2 characters').max(100).optional(),
  phone: z.string().min(10).max(15).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const resetPasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword:     z.string().min(8, 'New password must be at least 8 characters').max(100),
});

export type UpdateProfileSchema = z.infer<typeof updateProfileSchema>;
export type ResetPasswordSchema = z.infer<typeof resetPasswordSchema>;
