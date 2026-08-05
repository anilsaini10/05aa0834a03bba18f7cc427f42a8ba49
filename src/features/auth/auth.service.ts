import { User } from '@prisma/client';
import { prisma }              from '../../config/db';
import { hashPassword, comparePassword } from '../../shared/utils/hash';
import { generateOtp } from '../../shared/utils/otp';
import { sendMail } from '../../config/mailer';
import { changeOwnPassword } from '../../shared/services/account.service';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  getRefreshTokenExpiry,
  getAccessTokenExpiry,
} from '../../shared/utils/jwt';
import {
  SignupInput, LoginInput, AuthTokens, UserPublic,
} from './auth.types';

// ── Helper — strip password ───────────────────────────────────
const toPublic = (user: User, schoolName: string): UserPublic => ({
  id:         user.id,
  name:       user.name,
  email:      user.email,
  phone:      user.phone,
  role:       user.role,
  schoolId:   user.schoolId,
  schoolName,
});

// ── Build JWT payload ─────────────────────────────────────────
const buildPayload = (user: { id: string; email: string; role: any; schoolId: string }) => ({
  sub:      user.id,
  email:    user.email,
  role:     user.role,
  schoolId: user.schoolId,
});

// ── Build error helper ─────────────────────────────────────────
const invalidCredentials = () => {
  const err = new Error('Invalid credentials') as any;
  err.code       = 'INVALID_CREDENTIALS';
  err.statusCode = 401;
  return err;
};

// ── Issue tokens + shape response for an authenticated user ────
const issueSession = async (
  user: User,
  schoolName: string,
): Promise<{ user: UserPublic; tokens: AuthTokens }> => {

  const payload      = buildPayload(user);
  const accessToken  = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  await prisma.refreshToken.create({
    data: {
      userId:    user.id,
      token:     refreshToken,
      expiresAt: getRefreshTokenExpiry(),
    },
  });

  return {
    user:   toPublic(user, schoolName),
    tokens: {
      accessToken,
      refreshToken,
      expiresAt: getAccessTokenExpiry().toISOString(),
    },
  };
};

// ── Signup — ADMIN-only, creates a School too ───────────────────
export const signup = async (
  input: SignupInput,
): Promise<{ user: UserPublic; tokens: AuthTokens }> => {

  const existing = await prisma.user.findUnique({
    where: { email: input.email },
  });
  if (existing) {
    const err = new Error('Email already registered') as any;
    err.code       = 'EMAIL_TAKEN';
    err.statusCode = 409;
    throw err;
  }

  const passwordHash = await hashPassword(input.password);

  const { user, school } = await prisma.$transaction(async (tx) => {
    const school = await tx.school.create({
      data: { name: input.schoolName },
    });

    const user = await tx.user.create({
      data: {
        name:         input.name,
        email:        input.email,
        phone:        input.phone,
        passwordHash,
        role:         'ADMIN',
        schoolId:     school.id,
      },
    });

    return { user, school };
  });

  return issueSession(user, school.name);
};

// ── Login — school-scoped for TEACHER/PARENT, global for ADMIN ─
export const login = async (
  input: LoginInput,
): Promise<{ user: UserPublic; tokens: AuthTokens }> => {

  const { identifier, password, role, schoolId } = input;

  if (role !== 'ADMIN' && !schoolId) {
    const err = new Error('schoolId is required for this role') as any;
    err.code       = 'SCHOOL_ID_REQUIRED';
    err.statusCode = 400;
    throw err;
  }

  const user = await prisma.user.findFirst({
    where: {
      role,
      ...(role === 'ADMIN' ? {} : { schoolId }),
      OR: [{ email: identifier }, { phone: identifier }],
    },
    include: { school: true },
  });

  if (!user || !user.isActive) {
    throw invalidCredentials();
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    throw invalidCredentials();
  }

  return issueSession(user, user.school.name);
};

// ── Refresh ───────────────────────────────────────────────────
export const refresh = async (
  token: string,
): Promise<{ accessToken: string }> => {

  // Verify signature first
  let payload: any;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    const err = new Error('Invalid or expired refresh token') as any;
    err.code       = 'INVALID_REFRESH_TOKEN';
    err.statusCode = 401;
    throw err;
  }

  // Check DB
  const stored = await prisma.refreshToken.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!stored || stored.expiresAt < new Date() || !stored.user.isActive) {
    const err = new Error('Invalid or expired refresh token') as any;
    err.code       = 'INVALID_REFRESH_TOKEN';
    err.statusCode = 401;
    throw err;
  }

  const accessToken = signAccessToken(buildPayload(stored.user));
  return { accessToken };
};

// ── Logout ────────────────────────────────────────────────────
export const logout = async (token: string): Promise<void> => {
  await prisma.refreshToken.deleteMany({ where: { token } });
};

// ── Reset own password (ADMIN) ─────────────────────────────────
export const resetPassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> => {
  await changeOwnPassword(userId, currentPassword, newPassword);
};

// ════════════════════════════════════════════════════════════
// Forgot password (OTP over email) — works for any role, since
// User.email is globally unique.
// ════════════════════════════════════════════════════════════

const OTP_TTL_MS = 10 * 60 * 1000;

const invalidOtp = () => {
  const err = new Error('Invalid or expired OTP') as any;
  err.code       = 'INVALID_OTP';
  err.statusCode = 400;
  return err;
};

const otpEmailHtml = (name: string, otp: string): string => `
  <p>Hi ${name},</p>
  <p>Your password reset OTP is:</p>
  <h2 style="letter-spacing: 4px;">${otp}</h2>
  <p>This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
`;

// ── Request an OTP — always resolves the same way whether or not the
//    email exists, so callers can't use this to enumerate accounts ───
export const requestPasswordReset = async (email: string): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return;

  const otp      = generateOtp();
  const codeHash = await hashPassword(otp);

  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId: user.id, used: false } }),
    prisma.passwordResetToken.create({
      data: {
        userId:    user.id,
        codeHash,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    }),
  ]);

  try {
    await sendMail(user.email, 'Your password reset OTP', otpEmailHtml(user.name, otp));
  } catch (err) {
    console.error('requestPasswordReset: failed to send OTP email:', err);
  }
};

// ── Confirm an OTP and set the new password ─────────────────────
// Revokes all existing refresh tokens on success, same as changeOwnPassword.
export const confirmPasswordReset = async (
  email: string,
  otp: string,
  newPassword: string,
): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw invalidOtp();

  const candidates = await prisma.passwordResetToken.findMany({
    where:   { userId: user.id, used: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });

  let matched: (typeof candidates)[number] | undefined;
  for (const candidate of candidates) {
    if (await comparePassword(otp, candidate.codeHash)) {
      matched = candidate;
      break;
    }
  }
  if (!matched) throw invalidOtp();

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
    prisma.passwordResetToken.update({ where: { id: matched.id }, data: { used: true } }),
  ]);
};
