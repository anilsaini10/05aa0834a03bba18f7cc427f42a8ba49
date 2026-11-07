import { z } from 'zod';

export const parentSyllabusQuerySchema = z.object({
  studentId:   z.string().uuid('Invalid student id'),
  sessionYear: z.coerce.number().int().min(2000).max(2100).optional(),
});

export type ParentSyllabusQuerySchema = z.infer<typeof parentSyllabusQuerySchema>;

export const parentSubjectProgressQuerySchema = z.object({
  studentId: z.string().uuid('Invalid student id'),
});

export type ParentSubjectProgressQuerySchema = z.infer<typeof parentSubjectProgressQuerySchema>;
