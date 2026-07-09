import { z } from 'zod';
import { Role } from '@prisma/client';

export const signupSchema = z.object({
  schoolName: z.string().min(2, 'School name must be at least 2 characters').max(150),
  name:       z.string().min(2, 'Name must be at least 2 characters').max(100),
  email:      z.string().email('Invalid email address'),
  phone:      z.string().min(10).max(15),
  password:   z.string().min(8, 'Password must be at least 8 characters').max(100),
});

export const loginSchema = z.object({
  identifier: z.string().min(1, 'Identifier is required'),
  password:   z.string().min(1, 'Password is required'),
  role:       z.nativeEnum(Role),
  schoolId:   z.string().uuid('Invalid school id').optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type SignupSchema  = z.infer<typeof signupSchema>;
export type LoginSchema   = z.infer<typeof loginSchema>;
export type RefreshSchema = z.infer<typeof refreshSchema>;
export type LogoutSchema  = z.infer<typeof logoutSchema>;
