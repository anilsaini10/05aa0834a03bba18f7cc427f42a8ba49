import { z } from 'zod';

export const createSessionSchema = z.object({
  name:      z.string().min(3, 'Name is required (e.g. "2025-26")').max(20),
  startDate: z.coerce.date({ errorMap: () => ({ message: 'Invalid start date' }) }),
  endDate:   z.coerce.date({ errorMap: () => ({ message: 'Invalid end date' }) }),
  isCurrent: z.boolean().optional(),
}).refine(d => d.endDate > d.startDate, {
  message: 'End date must be after start date', path: ['endDate'],
});

export const updateSessionSchema = z.object({
  name:      z.string().min(3).max(20).optional(),
  startDate: z.coerce.date().optional(),
  endDate:   z.coerce.date().optional(),
  isCurrent: z.boolean().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'At least one field is required' });

export type CreateSessionSchema = z.infer<typeof createSessionSchema>;
export type UpdateSessionSchema = z.infer<typeof updateSessionSchema>;
