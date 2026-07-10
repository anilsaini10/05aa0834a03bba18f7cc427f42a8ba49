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

export type CreateClassSchema      = z.infer<typeof createClassSchema>;
export type AddSectionSchema       = z.infer<typeof addSectionSchema>;
export type AddClassSubjectSchema  = z.infer<typeof addClassSubjectSchema>;
