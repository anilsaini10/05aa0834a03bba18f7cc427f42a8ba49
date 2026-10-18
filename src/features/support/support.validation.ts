import { z } from 'zod';
import { SupportQueryStatus } from '@prisma/client';
import { SUPPORT_QUERY_CATEGORIES } from '../../constants';
import { sanitizeRichText, hasVisibleText } from '../../shared/utils/sanitizeHtml';

const MAX_HTML_LENGTH = 20_000;

// Rich-text HTML field: length-checked on the raw input, then sanitized;
// the sanitized result must still show visible text. Handlers receive the
// sanitized HTML, so it's what gets stored.
const richTextField = (label: string) =>
  z.string({ required_error: `${label} is required`, invalid_type_error: `${label} must be a string` })
    .max(MAX_HTML_LENGTH, `${label} must be at most ${MAX_HTML_LENGTH} characters`)
    .transform((value, ctx) => {
      const clean = sanitizeRichText(value);
      if (!hasVisibleText(clean)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} cannot be empty` });
        return z.NEVER;
      }
      return clean;
    });

// ── ADMIN / TEACHER / PARENT ─────────────────────────────────
// Unknown fields are stripped (zod's default).
export const createSupportQuerySchema = z.object({
  subject:  z.string({ required_error: 'Subject is required' }).trim()
              .min(1, 'Subject is required').max(150, 'Subject must be at most 150 characters'),
  category: z.enum(SUPPORT_QUERY_CATEGORIES, {
              errorMap: () => ({ message: `category must be one of: ${SUPPORT_QUERY_CATEGORIES.join(', ')}` }),
            }).nullable().optional(),
  message:  richTextField('Message'),
});

export const listMySupportQueriesQuerySchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(10),
  status:   z.nativeEnum(SupportQueryStatus).optional(),
});

// ── SUPER_ADMIN ───────────────────────────────────────────────
export const listAllSupportQueriesQuerySchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status:   z.nativeEnum(SupportQueryStatus).optional(),
  schoolId: z.string().uuid('Invalid school id').optional(),
  role:     z.enum(['ADMIN', 'TEACHER', 'PARENT']).optional(),
  category: z.enum(SUPPORT_QUERY_CATEGORIES).optional(),
  search:   z.string().trim().min(1).optional(),   // subject contains
});

// reply: null clears it.
export const updateSupportQuerySchema = z.object({
  status: z.nativeEnum(SupportQueryStatus).optional(),
  reply:  richTextField('Reply').nullable().optional(),
}).refine(data => data.status !== undefined || data.reply !== undefined, {
  message: 'Send status and/or reply',
});

export type CreateSupportQuerySchema         = z.infer<typeof createSupportQuerySchema>;
export type ListMySupportQueriesQuerySchema  = z.infer<typeof listMySupportQueriesQuerySchema>;
export type ListAllSupportQueriesQuerySchema = z.infer<typeof listAllSupportQueriesQuerySchema>;
export type UpdateSupportQuerySchema         = z.infer<typeof updateSupportQuerySchema>;
