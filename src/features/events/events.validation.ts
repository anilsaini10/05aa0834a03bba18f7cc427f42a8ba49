import { z } from 'zod';
import { EventType, AnnouncementAudience } from '@prisma/client';

export const createEventSchema = z.object({
  title:       z.string().min(2, 'Title must be at least 2 characters').max(200),
  description: z.string().max(2000).optional(),
  eventType:   z.nativeEnum(EventType),
  audience:    z.nativeEnum(AnnouncementAudience).default('ALL'),
  startDate:   z.coerce.date({ errorMap: () => ({ message: 'Invalid start date' }) }),
  endDate:     z.coerce.date({ errorMap: () => ({ message: 'Invalid end date' }) }).optional(),
})
  .transform(data => ({ ...data, endDate: data.endDate ?? data.startDate }))
  .refine(data => data.endDate >= data.startDate, {
    message: 'endDate must be on or after startDate',
    path:    ['endDate'],
  });

export const updateEventSchema = z.object({
  title:       z.string().min(2, 'Title must be at least 2 characters').max(200).optional(),
  description: z.string().max(2000).optional(),
  eventType:   z.nativeEnum(EventType).optional(),
  audience:    z.nativeEnum(AnnouncementAudience).optional(),
  startDate:   z.coerce.date({ errorMap: () => ({ message: 'Invalid start date' }) }).optional(),
  endDate:     z.coerce.date({ errorMap: () => ({ message: 'Invalid end date' }) }).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const listEventsQuerySchema = z.object({
  page:      z.coerce.number().int().positive().default(1),
  pageSize:  z.coerce.number().int().positive().max(100).default(15),
  search:    z.string().trim().min(1).optional(),
  eventType: z.nativeEnum(EventType).optional(),
  audience:  z.nativeEnum(AnnouncementAudience).optional(),
  from:      z.coerce.date({ errorMap: () => ({ message: 'Invalid from date' }) }).optional(),
  to:        z.coerce.date({ errorMap: () => ({ message: 'Invalid to date' }) }).optional(),
});

export type CreateEventSchema     = z.infer<typeof createEventSchema>;
export type UpdateEventSchema     = z.infer<typeof updateEventSchema>;
export type ListEventsQuerySchema = z.infer<typeof listEventsQuerySchema>;
