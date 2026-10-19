import { prisma } from '../../config/db';
import { hashPassword, comparePassword } from '../utils/hash';
import { generateDefaultPassword } from '../utils/defaultPassword';

const badRequest = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 400;
  return err;
};

// ── Change your own password (requires knowing the current one) ──
// Revokes all existing refresh tokens on success, forcing re-login
// on every other device/session.
export const changeOwnPassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> => {

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const valid = await comparePassword(currentPassword, user.passwordHash);
  if (!valid) {
    throw badRequest('Current password is incorrect', 'INVALID_CURRENT_PASSWORD');
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.refreshToken.deleteMany({ where: { userId } }),
  ]);
};

// ── Reset someone else's password back to the default ─────────────
// For "forgot password" help desks: an ADMIN resets a teacher/parent,
// a SUPER_ADMIN resets a school admin. Callers check the target is
// theirs to reset first. Revokes every refresh token so the user must
// log in again with the default password on all devices.
export const resetPasswordToDefault = async (userId: string): Promise<{ defaultPassword: string }> => {
  const user            = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const defaultPassword = generateDefaultPassword(user.email);
  const passwordHash    = await hashPassword(defaultPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.refreshToken.deleteMany({ where: { userId } }),
  ]);

  return { defaultPassword };
};
