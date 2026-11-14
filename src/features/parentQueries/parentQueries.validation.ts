import { z } from 'zod';

// ── Parent submits a query ───────────────────────────────────
export const createParentQuerySchema = z.object({
  subject: z.string().trim().min(1, 'Subject is required').max(200),
  message: z.string().trim().min(1, 'Message is required').max(5000),
});
export type CreateParentQuerySchema = z.infer<typeof createParentQuerySchema>;

// ── Parent lists own queries ─────────────────────────────────
export const listMyParentQueriesQuerySchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status:   z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
});
export type ListMyParentQueriesQuerySchema = z.infer<typeof listMyParentQueriesQuerySchema>;

// ── Admin lists all parent queries for the school ────────────
export const listParentQueriesQuerySchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status:   z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
  search:   z.string().trim().max(200).optional(),
});
export type ListParentQueriesQuerySchema = z.infer<typeof listParentQueriesQuerySchema>;

// ── Admin replies / updates status ───────────────────────────
export const updateParentQuerySchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
  reply:  z.string().trim().max(5000).nullable().optional(),
});
export type UpdateParentQuerySchema = z.infer<typeof updateParentQuerySchema>;
