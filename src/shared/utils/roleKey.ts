// ── Custom role names → keys ──────────────────────────────────
// Whatever the super admin types ("accountant", "Accountant ", "ACCOUNTANT",
// "head-clerk", "Head  Clerk") becomes one stable key: uppercase, words
// joined by "_" ("ACCOUNTANT", "HEAD_CLERK"). Two names with the same key
// are the same role, so case/spacing can never create duplicates.

export const ROLE_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/;

// Built-in roles (and close spellings) a custom role may not shadow.
export const RESERVED_ROLE_KEYS = new Set([
  'SUPER_ADMIN', 'SUPERADMIN', 'ADMIN', 'TEACHER', 'PARENT', 'STAFF', 'STUDENT',
]);

export const normalizeRoleKey = (raw: string): string =>
  raw
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // é → e
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

// Display label: spacing cleaned up; a name typed in all-lower or
// all-upper case is title-cased ("ACCOUNTANT" → "Accountant"), while
// deliberate mixed case ("HR Manager") is kept.
export const normalizeRoleName = (raw: string): string => {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name !== name.toLowerCase() && name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s\-_/])([a-z])/g, (_, sep, c) => sep + c.toUpperCase());
};
