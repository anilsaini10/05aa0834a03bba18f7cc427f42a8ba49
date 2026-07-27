import { z } from 'zod';
import { Gender } from '@prisma/client';

export const createStaffSchema = z.object({
  name:             z.string().min(2, 'Name must be at least 2 characters').max(100),
  email:            z.string().email('Invalid email address').optional(),
  phone:            z.string().min(10).max(15),
  gender:           z.nativeEnum(Gender),
  designation:      z.string().min(1, 'Designation is required').max(100),
  salary:           z.coerce.number().positive('Salary must be a positive number'),
  qualification:    z.string().min(1, 'Qualification is required').max(200),
  experienceYears:  z.coerce.number().int().min(0, 'experienceYears cannot be negative'),
  experienceMonths: z.coerce.number().int().min(0, 'experienceMonths cannot be negative').max(11, 'experienceMonths must be between 0 and 11'),
  joiningDate:      z.coerce.date({ errorMap: () => ({ message: 'Invalid joining date' }) }),
});

export const updateStaffSchema = z.object({
  name:             z.string().min(2, 'Name must be at least 2 characters').max(100).optional(),
  email:            z.string().email('Invalid email address').optional(),
  phone:            z.string().min(10).max(15).optional(),
  gender:           z.nativeEnum(Gender).optional(),
  designation:      z.string().min(1, 'Designation is required').max(100).optional(),
  salary:           z.coerce.number().positive('Salary must be a positive number').optional(),
  qualification:    z.string().min(1, 'Qualification is required').max(200).optional(),
  experienceYears:  z.coerce.number().int().min(0, 'experienceYears cannot be negative').optional(),
  experienceMonths: z.coerce.number().int().min(0, 'experienceMonths cannot be negative').max(11, 'experienceMonths must be between 0 and 11').optional(),
  joiningDate:      z.coerce.date({ errorMap: () => ({ message: 'Invalid joining date' }) }).optional(),
  status:           z.enum(['ACTIVE', 'INACTIVE']).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const listStaffQuerySchema = z.object({
  page:        z.coerce.number().int().positive().default(1),
  pageSize:    z.coerce.number().int().positive().max(100).default(15),
  search:      z.string().trim().min(1).optional(),
  designation: z.string().trim().min(1).optional(),
  status:      z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export type CreateStaffSchema     = z.infer<typeof createStaffSchema>;
export type UpdateStaffSchema     = z.infer<typeof updateStaffSchema>;
export type ListStaffQuerySchema  = z.infer<typeof listStaffQuerySchema>;
