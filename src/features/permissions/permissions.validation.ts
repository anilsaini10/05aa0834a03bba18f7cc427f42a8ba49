import { z } from 'zod';

// ── Permission objects ────────────────────────────────────────
// A flat JSON object the UI owns: camelCase keys (the UI shares the key
// names), values boolean / number / string or an array of those —
// e.g. { "feesCollect": true, "maxDiscountPercent": 10, "reportFormat": "pdf" }.
// The backend doesn't interpret keys; it validates the shape and stores it.

export const PERMISSION_KEY_PATTERN = /^[a-z][a-zA-Z0-9]{0,63}$/;
const MAX_KEYS = 300;
const FORBIDDEN_KEYS = new Set(['constructor', 'prototype']);

// "can_edit-fees" / "Can Edit Fees" → "canEditFees" — used only to
// suggest a fix in the error message.
export const toCamelCase = (raw: string): string => {
  const words = raw.trim().replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^a-zA-Z0-9]+/).filter(Boolean);
  return words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
};

const primitive = z.union([
  z.boolean(),
  z.number().finite(),
  z.string().max(500, 'String values must be at most 500 characters'),
]);
const value = z.union([primitive, z.array(primitive).max(100, 'Arrays can have at most 100 items')]);

const checkKeys = (obj: Record<string, unknown>, ctx: z.RefinementCtx) => {
  const keys = Object.keys(obj);
  if (keys.length > MAX_KEYS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `At most ${MAX_KEYS} permission keys allowed` });
  }
  for (const key of keys) {
    if (!PERMISSION_KEY_PATTERN.test(key) || FORBIDDEN_KEYS.has(key)) {
      const suggestion = toCamelCase(key);
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `"${key}" is not a valid camelCase key` +
          (suggestion && suggestion !== key && PERMISSION_KEY_PATTERN.test(suggestion) ? ` — use "${suggestion}"` : ''),
      });
    }
  }
};

// PUT — the complete object (replaces what's stored).
export const replacePermissionsSchema = z.object({
  permissions: z.record(z.string(), value, { invalid_type_error: 'permissions must be a JSON object' }).superRefine(checkKeys),
});

// PATCH — only the keys sent change; a key set to null is removed.
export const patchPermissionsSchema = z.object({
  permissions: z.record(z.string(), value.nullable(), { invalid_type_error: 'permissions must be a JSON object' })
    .superRefine(checkKeys)
    .refine(p => Object.keys(p).length > 0, 'Send at least one permission key'),
});

export const schoolIdParamSchema = z.object({ schoolId: z.string().uuid('Invalid school id') });

// Built-in roles the school admin sets permissions for, addressed by name
// in place of a custom role's id: /admin/permissions/roles/TEACHER.
export const BUILT_IN_PERMISSION_ROLES = ['TEACHER', 'PARENT'] as const;
export type BuiltInPermissionRole = typeof BUILT_IN_PERMISSION_ROLES[number];
export const isBuiltInPermissionRole = (v: string): v is BuiltInPermissionRole =>
  (BUILT_IN_PERMISSION_ROLES as readonly string[]).includes(v);

const roleIdField = (builtIns: readonly string[]) => z.string()
  .transform(v => (builtIns.includes(v.toUpperCase()) ? v.toUpperCase() : v))
  .refine(v => builtIns.includes(v) || z.string().uuid().safeParse(v).success,
    `Invalid role id — use a custom role's id or one of ${builtIns.join(', ')}`);

export const roleIdParamSchema = z.object({ roleId: roleIdField(BUILT_IN_PERMISSION_ROLES) });

// Super admin also addresses ADMIN, whose cap is the school's permissions.
export const schoolRoleParamSchema = z.object({
  schoolId: z.string().uuid('Invalid school id'),
  roleId:   roleIdField(['ADMIN', ...BUILT_IN_PERMISSION_ROLES]),
});

export type PermissionValue           = z.infer<typeof value>;
export type Permissions               = Record<string, PermissionValue>;
export type ReplacePermissionsSchema  = z.infer<typeof replacePermissionsSchema>;
export type PatchPermissionsSchema    = z.infer<typeof patchPermissionsSchema>;
