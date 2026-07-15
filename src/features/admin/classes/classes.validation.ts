import { z } from 'zod';

export const createSectionInput = z.object({
  name:     z.string().min(1, 'Section name is required').max(20),
  capacity: z.coerce.number().int().positive('Capacity must be a positive integer'),
});

export const createClassSchema = z.object({
  name:         z.string().min(1, 'Class name is required').max(50),
  numericLevel: z.coerce.number().int().positive('Numeric level must be a positive integer'),
  sections:     z.array(createSectionInput).min(1, 'At least one section is required'),
});

export const addSectionSchema = createSectionInput;

export const addClassSubjectSchema = z.object({
  subjectId: z.string().uuid('Invalid subject id'),
});

export const updateClassSchema = z.object({
  name:         z.string().min(1, 'Class name is required').max(50).optional(),
  numericLevel: z.coerce.number().int().positive('Numeric level must be a positive integer').optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const updateSectionSchema = z.object({
  name:           z.string().min(1, 'Section name is required').max(20).optional(),
  capacity:       z.coerce.number().int().positive('Capacity must be a positive integer').optional(),
  classTeacherId: z.string().uuid('Invalid teacher id').nullable().optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });

export type CreateClassSchema      = z.infer<typeof createClassSchema>;
export type AddSectionSchema       = z.infer<typeof addSectionSchema>;
export type AddClassSubjectSchema  = z.infer<typeof addClassSubjectSchema>;
export type UpdateClassSchema      = z.infer<typeof updateClassSchema>;
export type UpdateSectionSchema    = z.infer<typeof updateSectionSchema>;
