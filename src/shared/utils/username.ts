import { z } from 'zod';
import { prisma } from '../../config/db';

// Optional login id for ADMIN / SUPER_ADMIN / TEACHER accounts. Always
// starts with a letter and never contains "@", so the login identifier
// can tell it apart from an email or a mobile number. Stored lowercase —
// matching is case-insensitive.
export const USERNAME_PATTERN = /^[a-z][a-z0-9._]{2,29}$/;

export const looksLikeUsername = (value: string): boolean => /^[a-z]/i.test(value) && !value.includes('@');

const usernameString = z.string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_PATTERN, 'Username must be 3-30 characters, start with a letter, and use only letters, digits, "." or "_"');

// Optional field: missing → untouched, "" or null → no username (clears it on update).
export const optionalUsernameField = z.preprocess(
  v => (typeof v === 'string' && v.trim() === '' ? null : v),
  usernameString.nullable(),
).optional();

export const assertUsernameAvailable = async (username: string | null | undefined, exceptUserId?: string) => {
  if (!username) return;
  const existing = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (existing && existing.id !== exceptUserId) {
    const err = new Error('Username already taken') as any;
    err.code       = 'USERNAME_TAKEN';
    err.statusCode = 409;
    throw err;
  }
};
