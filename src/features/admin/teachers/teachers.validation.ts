import { z } from 'zod';
import { Gender } from '@prisma/client';

export const createTeacherSchema = z.object({
  name:                  z.string().min(2, 'Name must be at least 2 characters').max(100),
  email:                 z.string().email('Invalid email address'),
  phone:                 z.string().min(10).max(15),
  gender:                z.nativeEnum(Gender),
  subject:               z.string().min(1, 'Subject is required').max(100),
  classId:               z.string().uuid('classId is required — which class does this teacher teach this subject in?'),
  salary:                z.coerce.number().positive('Salary must be a positive number'),
  joiningDate:           z.coerce.date({ errorMap: () => ({ message: 'Invalid joining date' }) }),
  // Optional: make this teacher the Class Teacher (homeroom in-charge) of a section.
  classTeacherSectionId: z.string().uuid('Invalid section id').optional(),
});

export const listTeachersQuerySchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(15),
  search:   z.string().trim().min(1).optional(),
  subject:  z.string().trim().min(1).optional(),
  classId:  z.string().uuid('Invalid class id').optional(),
});

export type CreateTeacherSchema     = z.infer<typeof createTeacherSchema>;
export type ListTeachersQuerySchema = z.infer<typeof listTeachersQuerySchema>;
