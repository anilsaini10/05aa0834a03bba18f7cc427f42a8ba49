import { z } from 'zod';

const dateOnly = (label: string) => z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be in YYYY-MM-DD format`)
  .transform(v => new Date(`${v}T00:00:00.000Z`))
  .refine(d => !Number.isNaN(d.getTime()), `${label} is not a valid date`);

export const assignedSyllabusQuerySchema = z.object({
  sessionYear: z.coerce.number().int().min(2000).max(2100).optional(),
  classId:     z.string().uuid('Invalid class id').optional(),
  subjectId:   z.string().uuid('Invalid subject id').optional(),
});

export type AssignedSyllabusQuerySchema = z.infer<typeof assignedSyllabusQuerySchema>;

export const submitProgressSchema = z.object({
  completionPercentage: z.number().min(0).max(100),
  workingDaysAdded:     z.number().int().min(0).default(1),
  remarks:              z.string().max(500).optional(),
  progressDate:         dateOnly('progressDate'),
});

export type SubmitProgressSchema = z.infer<typeof submitProgressSchema>;

export const overallProgressQuerySchema = z.object({
  sessionYear: z.coerce.number().int().min(2000).max(2100).optional(),
});

export type OverallProgressQuerySchema = z.infer<typeof overallProgressQuerySchema>;
