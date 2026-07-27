import { z } from 'zod';
import { Gender } from '@prisma/client';

export const createTeacherSchema = z.object({
  name:                  z.string().min(2, 'Name must be at least 2 characters').max(100),
  email:                 z.string().email('Invalid email address'),
  phone:                 z.string().min(10).max(15),
  gender:                z.nativeEnum(Gender),
  salary:                z.coerce.number().positive('Salary must be a positive number'),
  qualification:         z.string().min(1, 'Qualification is required').max(200),
  experienceYears:       z.coerce.number().int().min(0, 'experienceYears cannot be negative'),
  experienceMonths:      z.coerce.number().int().min(0, 'experienceMonths cannot be negative').max(11, 'experienceMonths must be between 0 and 11'),
  // General subject expertise (names only) — not tied to any class. To
  // actually schedule this teacher for a subject in a specific class,
  // use POST /admin/teachers/:teacherId/subjects afterward.
  subjects:              z.array(z.string().min(1).max(100)).min(1, 'At least one subject is required'),
  joiningDate:           z.coerce.date({ errorMap: () => ({ message: 'Invalid joining date' }) }),
  // Optional: make this teacher the Class Teacher (homeroom in-charge) of a section.
  classTeacherSectionId: z.string().uuid('Invalid section id').optional(),
});

export const updateTeacherSchema = z.object({
  name:             z.string().min(2, 'Name must be at least 2 characters').max(100).optional(),
  email:            z.string().email('Invalid email address').optional(),
  phone:            z.string().min(10).max(15).optional(),
  gender:           z.nativeEnum(Gender).optional(),
  joiningDate:      z.coerce.date({ errorMap: () => ({ message: 'Invalid joining date' }) }).optional(),
  salary:           z.coerce.number().positive('Salary must be a positive number').optional(),
  qualification:    z.string().min(1, 'Qualification is required').max(200).optional(),
  experienceYears:  z.coerce.number().int().min(0, 'experienceYears cannot be negative').optional(),
  experienceMonths: z.coerce.number().int().min(0, 'experienceMonths cannot be negative').max(11, 'experienceMonths must be between 0 and 11').optional(),
  subjectsTaught:   z.array(z.string().min(1).max(100)).min(1, 'At least one subject is required').optional(),
  status:           z.enum(['ACTIVE', 'INACTIVE']).optional(),
  // Optional: make this teacher the Class Teacher (homeroom in-charge) of a section.
  classTeacherSectionId: z.string().uuid('Invalid section id').optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const assignSubjectSchema = z.object({
  subject: z.string().min(1, 'Subject is required').max(100),
  classId: z.string().uuid('classId is required — which class will this teacher teach this subject in?'),
});

export const listTeachersQuerySchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(15),
  search:   z.string().trim().min(1).optional(),
  subject:  z.string().trim().min(1).optional(),
  classId:  z.string().uuid('Invalid class id').optional(),
});

export type CreateTeacherSchema     = z.infer<typeof createTeacherSchema>;
export type UpdateTeacherSchema     = z.infer<typeof updateTeacherSchema>;
export type AssignSubjectSchema     = z.infer<typeof assignSubjectSchema>;
export type ListTeachersQuerySchema = z.infer<typeof listTeachersQuerySchema>;
