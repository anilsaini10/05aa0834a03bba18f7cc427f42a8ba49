import { z } from 'zod';
import { AccountRecoveryStatus } from '@prisma/client';
import { normalizePhone } from '../../shared/utils/phone';

// Accepts any common way of typing the number (+91…, 0…, spaces, dashes);
// stored as the national number. Blank strings count as "not given" so
// the app can send all three inputs as-is.
const optionalPhone = (label: string) =>
  z.string().trim().optional().transform((value, ctx) => {
    if (!value) return undefined;
    const phone = normalizePhone(value);
    if (!phone) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} is not a valid mobile number` });
      return z.NEVER;
    }
    return phone;
  });

// ── Public (login screen, no auth) ────────────────────────────
export const createRecoveryRequestSchema = z.object({
  name:   z.string({ required_error: 'Name is required' }).trim()
            .min(1, 'Name is required').max(100, 'Name must be at most 100 characters'),
  email:  z.string().trim().toLowerCase().optional()
            .transform(v => v || undefined)
            .pipe(z.string().email('Invalid email address').optional()),
  phone1: optionalPhone('Mobile number 1'),
  phone2: optionalPhone('Mobile number 2'),
  phone3: optionalPhone('Mobile number 3'),
}).refine(d => d.email || d.phone1 || d.phone2 || d.phone3, {
  message: 'Enter your email or at least one mobile number',
});

// ── ADMIN ─────────────────────────────────────────────────────
export const listRecoveryRequestsQuerySchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status:   z.nativeEnum(AccountRecoveryStatus).optional(),
  search:   z.string().trim().min(1).optional(),   // name / email / phone contains
});

export type CreateRecoveryRequestSchema     = z.infer<typeof createRecoveryRequestSchema>;
export type ListRecoveryRequestsQuerySchema = z.infer<typeof listRecoveryRequestsQuerySchema>;
