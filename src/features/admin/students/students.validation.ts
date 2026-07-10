import { z } from 'zod';
import { Gender } from '@prisma/client';

export const createStudentSchema = z.object({
  name:        z.string().min(2, 'Name must be at least 2 characters').max(100),
  gender:      z.nativeEnum(Gender),
  dateOfBirth: z.coerce.date({ errorMap: () => ({ message: 'Invalid date of birth' }) }),
  classId:     z.string().uuid('Invalid class id'),
  sectionId:   z.string().uuid('Invalid section id'),
  rollNo:      z.coerce.number().int().positive('Roll number must be a positive integer'),
  parentName:  z.string().min(2, 'Parent name must be at least 2 characters').max(100),
  parentPhone: z.string().min(10).max(15),
  parentEmail: z.string().email('Invalid parent email address'),
  bloodGroup:  z.string().max(10).optional(),
  address:     z.string().max(300).optional(),
});

export const listStudentsQuerySchema = z.object({
  page:      z.coerce.number().int().positive().default(1),
  pageSize:  z.coerce.number().int().positive().max(100).default(15),
  search:    z.string().trim().min(1).optional(),
  classId:   z.string().uuid('Invalid class id').optional(),
  sectionId: z.string().uuid('Invalid section id').optional(),
});

export type CreateStudentSchema     = z.infer<typeof createStudentSchema>;
export type ListStudentsQuerySchema = z.infer<typeof listStudentsQuerySchema>;
