import { z } from 'zod';

export const searchSchoolsSchema = z.object({
  search: z.string().trim().min(1).max(150).optional(),
});

export type SearchSchoolsSchema = z.infer<typeof searchSchoolsSchema>;
