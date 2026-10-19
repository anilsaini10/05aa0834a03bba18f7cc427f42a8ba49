import { z } from 'zod';
import { EventType } from '@prisma/client';

const dateOnly = (label: string) => z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be in YYYY-MM-DD format`)
  .transform(v => new Date(`${v}T00:00:00.000Z`))
  .refine(d => !Number.isNaN(d.getTime()), `${label} is not a valid date`);

// Either an academic session (`year` = the year it starts in, e.g. 2026 for
// 2026-27; omitted → the current session) or an explicit from/to range.
export const academicCalendarQuerySchema = z.object({
  year:      z.coerce.number().int().min(2000).max(2100).optional(),
  from:      dateOnly('from').optional(),
  to:        dateOnly('to').optional(),
  eventType: z.nativeEnum(EventType).optional(),
})
  .refine(q => (q.from === undefined) === (q.to === undefined), { message: 'Send both from and to', path: ['from'] })
  .refine(q => !(q.year !== undefined && q.from), { message: 'Use either year or from/to, not both', path: ['year'] })
  .refine(q => !q.from || !q.to || q.to >= q.from, { message: 'to must be on or after from', path: ['to'] })
  .refine(q => !q.from || !q.to || (q.to.getTime() - q.from.getTime()) / 86_400_000 <= 400, {
    message: 'Range can be at most 400 days', path: ['to'],
  });

export const parentAcademicCalendarQuerySchema = z.object({
  studentId: z.string().uuid('Invalid student id'),
}).and(academicCalendarQuerySchema);

export type AcademicCalendarQuerySchema = z.infer<typeof academicCalendarQuerySchema>;
