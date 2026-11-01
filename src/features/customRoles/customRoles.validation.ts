import { z } from 'zod';
import { normalizePhone } from '../../shared/utils/phone';
import { optionalUsernameField } from '../../shared/utils/username';
import { ROLE_KEY_PATTERN, RESERVED_ROLE_KEYS, normalizeRoleKey, normalizeRoleName } from '../../shared/utils/roleKey';

// Role name → { name (display), key (normalized) }. Rejects names that
// normalize to nothing, to a bad key, or to a built-in role.
const roleNameField = z.string({ required_error: 'Role name is required' })
  .trim()
  .min(2, 'Role name must be at least 2 characters')
  .max(50, 'Role name must be at most 50 characters')
  .transform((raw, ctx) => {
    const key = normalizeRoleKey(raw);
    if (!ROLE_KEY_PATTERN.test(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Role name must start with a letter and contain letters or numbers' });
      return z.NEVER;
    }
    if (RESERVED_ROLE_KEYS.has(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${raw}" is a built-in role and can't be created` });
      return z.NEVER;
    }
    return { name: normalizeRoleName(raw), key };
  });

const description = z.string().trim().max(300, 'Description must be at most 300 characters');

// ── SUPER_ADMIN ───────────────────────────────────────────────
export const createRoleSchema = z.object({
  name:        roleNameField,
  description: description.optional(),
});

// The key never changes after creation (apps route on it) — `name`
// only changes the display label.
export const updateRoleSchema = z.object({
  name:        roleNameField.optional(),
  description: description.nullable().optional(),
  isActive:    z.boolean().optional(),
}).refine(d => d.name !== undefined || d.description !== undefined || d.isActive !== undefined, {
  message: 'Send name, description and/or isActive',
});

export const listRolesQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE', 'ALL']).default('ALL'),
  search: z.string().trim().min(1).optional(),
});

// ── ADMIN: accounts with a custom role ────────────────────────
const phoneField = z.string().transform((value, ctx) => {
  const phone = normalizePhone(value);
  if (!phone) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid 10-digit mobile number' });
    return z.NEVER;
  }
  return phone;
});

export const createRoleUserSchema = z.object({
  customRoleId: z.string({ required_error: 'customRoleId is required' }).uuid('Invalid role id'),
  name:         z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  email:        z.string().trim().toLowerCase().email('Invalid email address'),
  phone:        phoneField.optional(),
  username:     optionalUsernameField,
});

// null clears phone / username.
export const updateRoleUserSchema = z.object({
  customRoleId: z.string().uuid('Invalid role id').optional(),
  name:         z.string().trim().min(2, 'Name must be at least 2 characters').max(100).optional(),
  email:        z.string().trim().toLowerCase().email('Invalid email address').optional(),
  phone:        phoneField.nullable().optional(),
  username:     optionalUsernameField,
  isActive:     z.boolean().optional(),
}).refine(d => Object.values(d).some(v => v !== undefined), { message: 'Send at least one field to update' });

export const listRoleUsersQuerySchema = z.object({
  page:         z.coerce.number().int().positive().default(1),
  pageSize:     z.coerce.number().int().positive().max(100).default(20),
  customRoleId: z.string().uuid('Invalid role id').optional(),
  status:       z.enum(['ACTIVE', 'INACTIVE', 'ALL']).default('ALL'),
  search:       z.string().trim().min(1).optional(),   // name / email / phone / username
});

export type CreateRoleSchema         = z.infer<typeof createRoleSchema>;
export type UpdateRoleSchema         = z.infer<typeof updateRoleSchema>;
export type ListRolesQuerySchema     = z.infer<typeof listRolesQuerySchema>;
export type CreateRoleUserSchema     = z.infer<typeof createRoleUserSchema>;
export type UpdateRoleUserSchema     = z.infer<typeof updateRoleUserSchema>;
export type ListRoleUsersQuerySchema = z.infer<typeof listRoleUsersQuerySchema>;
