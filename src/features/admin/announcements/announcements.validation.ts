import { z } from 'zod';
import { AnnouncementAudience } from '@prisma/client';

export const createAnnouncementSchema = z.object({
  title:     z.string().min(2, 'Title must be at least 2 characters').max(200),
  message:   z.string().min(1, 'Message is required').max(2000),
  audience:  z.nativeEnum(AnnouncementAudience).default('ALL'),
  eventDate: z.coerce.date({ errorMap: () => ({ message: 'Invalid event date' }) }).optional(),
  publishAt: z.coerce.date({ errorMap: () => ({ message: 'Invalid publish date' }) }).optional(),
  expiresAt: z.coerce.date({ errorMap: () => ({ message: 'Invalid expiry date' }) }).optional(),
}).refine(
  data => !data.publishAt || !data.expiresAt || data.expiresAt > data.publishAt,
  { message: 'expiresAt must be after publishAt', path: ['expiresAt'] },
);

export const updateAnnouncementSchema = z.object({
  title:     z.string().min(2, 'Title must be at least 2 characters').max(200).optional(),
  message:   z.string().min(1, 'Message is required').max(2000).optional(),
  audience:  z.nativeEnum(AnnouncementAudience).optional(),
  eventDate: z.coerce.date({ errorMap: () => ({ message: 'Invalid event date' }) }).optional(),
  publishAt: z.coerce.date({ errorMap: () => ({ message: 'Invalid publish date' }) }).optional(),
  expiresAt: z.coerce.date({ errorMap: () => ({ message: 'Invalid expiry date' }) }).optional(),
})
  .refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' })
  .refine(
    data => !data.publishAt || !data.expiresAt || data.expiresAt > data.publishAt,
    { message: 'expiresAt must be after publishAt', path: ['expiresAt'] },
  );

export const listAnnouncementsQuerySchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(15),
  search:   z.string().trim().min(1).optional(),
  audience: z.nativeEnum(AnnouncementAudience).optional(),
});

export type CreateAnnouncementSchema      = z.infer<typeof createAnnouncementSchema>;
export type UpdateAnnouncementSchema      = z.infer<typeof updateAnnouncementSchema>;
export type ListAnnouncementsQuerySchema  = z.infer<typeof listAnnouncementsQuerySchema>;
