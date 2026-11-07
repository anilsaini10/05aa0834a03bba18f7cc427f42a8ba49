import { z } from 'zod';

export const createSubjectSchema = z.object({
  name:        z.string().min(1, 'Subject name is required').max(100),
  description: z.string().max(500).optional(),
  classIds:    z.array(z.string().uuid('Invalid class id')).optional(),
});

export type CreateSubjectSchema = z.infer<typeof createSubjectSchema>;

export const updateSubjectSchema = z.object({
  name:        z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });

export type UpdateSubjectSchema = z.infer<typeof updateSubjectSchema>;

export const assignSubjectClassesSchema = z.object({
  classIds: z.array(z.string().uuid('Invalid class id')).min(1, 'At least one class is required'),
});

export type AssignSubjectClassesSchema = z.infer<typeof assignSubjectClassesSchema>;
