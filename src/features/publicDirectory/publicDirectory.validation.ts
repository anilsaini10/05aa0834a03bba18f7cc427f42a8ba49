import { z } from 'zod';

export const listSchoolsSchema = z.object({
  search: z.string().trim().min(1).max(150).optional(),
  city:   z.string().trim().min(1).max(100).optional(),
  board:  z.enum(['CBSE', 'ICSE', 'STATE_BOARD', 'IB', 'OTHER']).optional(),
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(50).default(20),
});

export const schoolIdParamSchema = z.object({
  schoolId: z.string().uuid('Invalid school id'),
});

export const teacherListSchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
