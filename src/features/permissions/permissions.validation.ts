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
export const roleIdParamSchema   = z.object({ roleId: z.string().uuid('Invalid role id') });

export type PermissionValue           = z.infer<typeof value>;
export type Permissions               = Record<string, PermissionValue>;
export type ReplacePermissionsSchema  = z.infer<typeof replacePermissionsSchema>;
export type PatchPermissionsSchema    = z.infer<typeof patchPermissionsSchema>;
