import { z } from 'zod';

export const createSubjectSchema = z.object({
  name:      z.string().min(1, 'Subject name is required').max(100),
  classIds:  z.array(z.string().uuid('Invalid class id')).optional(),
});

export type CreateSubjectSchema = z.infer<typeof createSubjectSchema>;
