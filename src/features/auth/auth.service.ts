import { User, Role } from '@prisma/client';
import { prisma }              from '../../config/db';
import { hashPassword, comparePassword } from '../../shared/utils/hash';
import { generateOtp } from '../../shared/utils/otp';
import { sendMail } from '../../config/mailer';
import { sendSms } from '../../config/sms';
import { toE164, normalizePhone } from '../../shared/utils/phone';
import { looksLikeUsername, assertUsernameAvailable } from '../../shared/utils/username';
import { env } from '../../config/env';
import { changeOwnPassword } from '../../shared/services/account.service';
import { uploadFile } from '../../config/storage';
import { notifyUser } from '../notifications/notifications.service';
import { NOTIFICATION_TYPE } from '../../constants';
import { addInterval } from '../../shared/utils/subscriptionStatus';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  getRefreshTokenExpiry,
  getAccessTokenExpiry,
} from '../../shared/utils/jwt';
import {
  SignupInput, LoginInput, AuthTokens, UserPublic,
  SendLoginOtpInput, VerifyLoginOtpInput,
  SendEmailLoginOtpInput, VerifyEmailLoginOtpInput,
} from './auth.types';

type CustomRoleRef = { id: string; key: string; name: string; isActive: boolean };
type SessionUser   = User & { customRole?: CustomRoleRef | null };

// Load with every user that can start a session.
const CUSTOM_ROLE_SELECT = { select: { id: true, key: true, name: true, isActive: true } } as const;

// ── Helper — strip password ───────────────────────────────────
const toPublic = (user: SessionUser, schoolName: string | null): UserPublic => ({
  id:           user.id,
  name:         user.name,
  email:        user.email,
  username:     user.username,
  phone:        user.phone,
  role:         user.role,
  customRole:   user.customRole ? { id: user.customRole.id, key: user.customRole.key, name: user.customRole.name } : null,
  schoolId:     user.schoolId,
  schoolName,
  profilePhoto: user.profilePhoto,
});

// ── Build JWT payload ─────────────────────────────────────────
const buildPayload = (user: { id: string; email: string; role: any; schoolId: string | null; customRole?: { key: string } | null }) => ({
  sub:        user.id,
  email:      user.email,
  role:       user.role,
  schoolId:   user.schoolId,
  customRole: user.customRole?.key ?? null,
});

// A STAFF account works only while its custom role is active — the super
// admin deactivating a role locks out everyone who has it.
const assertCustomRoleActive = (user: SessionUser) => {
  if (user.role === 'STAFF' && !user.customRole?.isActive) {
    const err = new Error('Your role has been disabled. Please contact your school admin.') as any;
    err.code       = 'ROLE_INACTIVE';
    err.statusCode = 403;
    throw err;
  }
};

// ── Build error helper ─────────────────────────────────────────
const invalidCredentials = () => {
  const err = new Error('Invalid credentials') as any;
  err.code       = 'INVALID_CREDENTIALS';
  err.statusCode = 401;
  return err;
};

// ── Issue tokens + shape response for an authenticated user ────
const issueSession = async (
  user: SessionUser,
  schoolName: string | null,
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

const FREE_TRIAL_PLAN_CODE = 'FREE_TRIAL';
const FREE_TRIAL_MONTHS    = 1;

// ── Grant a 1-month free trial subscription on self-signup ───────
const grantFreeTrial = async (schoolId: string, userId: string) => {
  const plan = await prisma.subscriptionPlan.findUnique({
    where:   { code: FREE_TRIAL_PLAN_CODE },
    include: { prices: { where: { isActive: true }, take: 1 } },
  });
  if (!plan || !plan.isActive || plan.prices.length === 0) return;

  const price     = plan.prices[0];
  const now       = new Date();
  const startDate = now;
  const endDate   = addInterval(startDate, 'MONTH', FREE_TRIAL_MONTHS);

  await prisma.subscription.create({
    data: {
      subscriberType: 'SCHOOL',
      schoolId,
      role:          'ADMIN',
      paidByUserId:  userId,
      planId:        plan.id,
      planPriceId:   price.id,
      amount:        0,
      currency:      price.currency,
      intervalUnit:  'MONTH',
      intervalCount: FREE_TRIAL_MONTHS,
      status:        'ACTIVE',
      startDate,
      endDate,
      activatedAt:   now,
      note:          'Auto-granted free trial on self-signup',
      payments: {
        create: {
          userId,
          schoolId,
          amount:   0,
          currency: price.currency,
          status:   'SUCCESS',
          gateway:  'MANUAL',
          paidAt:   now,
          reference: 'Free trial — self-signup',
        },
      },
    },
  });
};

// ── Notify all super admins about a new school signup ────────────
const notifySuperAdmins = async (schoolName: string, adminName: string) => {
  const superAdmins = await prisma.user.findMany({
    where: { role: 'SUPER_ADMIN', isActive: true },
    select: { id: true },
  });

  for (const sa of superAdmins) {
    await notifyUser(sa.id, {
      title: 'New School Registered',
      body:  `${schoolName} has signed up. Admin: ${adminName}`,
      data:  { type: NOTIFICATION_TYPE.SCHOOL_SIGNUP },
    });
  }
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

  grantFreeTrial(school.id, user.id).catch(() => {});
  notifySuperAdmins(school.name, user.name).catch(() => {});

  return issueSession(user, school.name);
};

// ── TEACHER/PARENT logins are school-scoped and need a schoolId;
//    ADMIN/SUPER_ADMIN are global. Returns whether the role is scoped. ─
const assertSchoolScope = (role: Role, schoolId?: string): boolean => {
  const isSchoolScoped = role !== 'ADMIN' && role !== 'SUPER_ADMIN';

  if (isSchoolScoped && !schoolId) {
    const err = new Error('schoolId is required for this role') as any;
    err.code       = 'SCHOOL_ID_REQUIRED';
    err.statusCode = 400;
    throw err;
  }

  return isSchoolScoped;
};

// ── `identifier` is an email, a username or a mobile number. Emails
//    match case-insensitively; usernames are stored lowercase and always
//    start with a letter; a mobile number in any common format (+91…, 0…,
//    spaces, dashes) is normalized to the stored 10-digit form, same as the
//    OTP login. The raw value is also tried so phones saved before
//    normalization existed still match. ────────────────────────────
const identifierMatchers = (identifier: string) => {
  const value = identifier.trim();
  if (value.includes('@')) {
    return [{ email: { equals: value, mode: 'insensitive' as const } }];
  }
  if (looksLikeUsername(value)) {
    return [{ username: value.toLowerCase() }];
  }
  const phone = normalizePhone(value);
  return phone && phone !== value ? [{ phone }, { phone: value }] : [{ phone: value }];
};

// ── Login — school-scoped for TEACHER/PARENT, global for ADMIN/SUPER_ADMIN ─
export const login = async (
  input: LoginInput,
): Promise<{ user: UserPublic; tokens: AuthTokens }> => {

  const { identifier, password, role, schoolId, customRoleId } = input;
  const isSchoolScoped = assertSchoolScope(role, schoolId);

  const user = await prisma.user.findFirst({
    where: {
      role,
      ...(isSchoolScoped ? { schoolId } : {}),
      ...(customRoleId ? { customRoleId } : {}),   // wrong role → same "Invalid credentials"
      OR: identifierMatchers(identifier),
    },
    include: { school: true, customRole: CUSTOM_ROLE_SELECT },
  });

  if (!user || !user.isActive) {
    throw invalidCredentials();
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    throw invalidCredentials();
  }
  assertCustomRoleActive(user);

  return issueSession(user, user.school?.name ?? null);
};

// ════════════════════════════════════════════════════════════
// Login with mobile number + OTP (passwordless). The OTP is delivered
// via sendSms(), so switching from the console provider to a real SMS
// gateway needs no change here.
// ════════════════════════════════════════════════════════════

const LOGIN_OTP_TTL_MS          = 5 * 60 * 1000;
const LOGIN_OTP_RESEND_AFTER_MS = 60 * 1000;
const LOGIN_OTP_MAX_PER_HOUR    = 5;
const LOGIN_OTP_MAX_ATTEMPTS    = 5;

// Dev-only: prints the OTP to the server terminal so it can be read
// locally whatever SMS provider is configured. Never logs in production.
const devOtpLog = (input: SendLoginOtpInput, otp: string): void => {
  if (env.NODE_ENV === 'production') return;
  const who = `${input.phone} (${input.role}${input.schoolId ? `, school ${input.schoolId}` : ''})`;
  console.log(`\n🔐 [DEV] Login OTP for ${who}: ${otp}  (valid ${LOGIN_OTP_TTL_MS / 60000} min)\n`);
};

// ── Login-OTP errors — each has its own code so the app can show a
//    specific message; `details` carries numbers the UI needs. ─────────
const otpError = (
  message:    string,
  code:       string,
  statusCode: number,
  details?:   Record<string, unknown>,
) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = statusCode;
  if (details) err.details = details;
  return err;
};

const findOtpLoginUser = async ({ phone, role, schoolId, customRoleId }: SendLoginOtpInput) => {
  const isSchoolScoped = assertSchoolScope(role, schoolId);

  const user = await prisma.user.findFirst({
    where: {
      phone,
      role,
      ...(isSchoolScoped ? { schoolId } : {}),
      ...(customRoleId ? { customRoleId } : {}),
    },
    include: { school: true, customRole: CUSTOM_ROLE_SELECT },
  });

  if (!user) {
    throw otpError(
      'This mobile number is not registered. Please check the number or contact your school.',
      'PHONE_NOT_REGISTERED', 404,
    );
  }
  if (!user.isActive) {
    throw otpError(
      'Your account is inactive. Please contact your school admin.',
      'ACCOUNT_INACTIVE', 403,
    );
  }
  assertCustomRoleActive(user);

  return user;
};

// ── Request a login OTP ─────────────────────────────────────────
export const sendLoginOtp = async (
  input: SendLoginOtpInput,
): Promise<{ resendAfterSeconds: number; expiresInSeconds: number }> => {

  const user   = await findOtpLoginUser(input);
  const now    = Date.now();
  const hourMs = 60 * 60 * 1000;

  const recent = await prisma.loginOtp.findMany({
    where:   { userId: user.id, createdAt: { gt: new Date(now - hourMs) } },
    orderBy: { createdAt: 'desc' },
    select:  { createdAt: true },
  });

  if (recent.length >= LOGIN_OTP_MAX_PER_HOUR) {
    const oldest = recent[recent.length - 1].createdAt.getTime();
    throw otpError(
      'Too many OTP requests. Please try again later.',
      'OTP_LIMIT_REACHED', 429,
      { retryAfterSeconds: Math.ceil((oldest + hourMs - now) / 1000) },
    );
  }

  const sinceLastMs = recent[0] ? now - recent[0].createdAt.getTime() : Infinity;
  if (sinceLastMs < LOGIN_OTP_RESEND_AFTER_MS) {
    const retryAfterSeconds = Math.ceil((LOGIN_OTP_RESEND_AFTER_MS - sinceLastMs) / 1000);
    throw otpError(
      `Please wait ${retryAfterSeconds} seconds before requesting a new OTP.`,
      'OTP_RESEND_COOLDOWN', 429,
      { retryAfterSeconds },
    );
  }

  const otp      = generateOtp();
  const codeHash = await hashPassword(otp);

  const [, created] = await prisma.$transaction([
    prisma.loginOtp.updateMany({ where: { userId: user.id, used: false }, data: { used: true } }),
    prisma.loginOtp.create({
      data: {
        userId:    user.id,
        codeHash,
        expiresAt: new Date(now + LOGIN_OTP_TTL_MS),
      },
    }),
  ]);

  devOtpLog(input, otp);

  try {
    await sendSms(
      toE164(user.phone!),
      `${otp} is your Arise login OTP. It expires in ${LOGIN_OTP_TTL_MS / 60000} minutes. Do not share it with anyone.`,
    );
  } catch (err) {
    console.error('sendLoginOtp: failed to send OTP SMS:', err);
    // Undelivered OTP shouldn't count towards cooldown / hourly limit.
    await prisma.loginOtp.delete({ where: { id: created.id } });
    throw otpError(
      'Could not send OTP right now. Please try again in a moment.',
      'OTP_SEND_FAILED', 503,
    );
  }

  return {
    resendAfterSeconds: LOGIN_OTP_RESEND_AFTER_MS / 1000,
    expiresInSeconds:   LOGIN_OTP_TTL_MS / 1000,
  };
};

// ── Verify a login OTP and issue a session ──────────────────────
export const verifyLoginOtp = async (
  input: VerifyLoginOtpInput,
): Promise<{ user: UserPublic; tokens: AuthTokens }> => {

  const user = await findOtpLoginUser(input);

  const otpExpired = () => otpError(
    'OTP has expired or is no longer valid. Please request a new OTP.',
    'OTP_EXPIRED', 400,
  );

  // Only one OTP is ever active per user — sending a new one invalidates the rest.
  const active = await prisma.loginOtp.findFirst({
    where:   { userId: user.id, used: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!active) throw otpExpired();

  if (!(await comparePassword(input.otp, active.codeHash))) {
    const attempts     = active.attempts + 1;
    const attemptsLeft = LOGIN_OTP_MAX_ATTEMPTS - attempts;

    await prisma.loginOtp.update({
      where: { id: active.id },
      data:  { attempts, ...(attemptsLeft <= 0 ? { used: true } : {}) },
    });

    if (attemptsLeft <= 0) {
      throw otpError(
        'Too many incorrect attempts. Please request a new OTP.',
        'OTP_ATTEMPTS_EXCEEDED', 429,
      );
    }
    throw otpError(
      `Incorrect OTP. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left.`,
      'INVALID_OTP', 400,
      { attemptsLeft },
    );
  }

  // Conditional update so two concurrent verifies can't both consume the same OTP.
  const consumed = await prisma.loginOtp.updateMany({
    where: { id: active.id, used: false },
    data:  { used: true },
  });
  if (consumed.count !== 1) throw otpExpired();

  return issueSession(user, user.school?.name ?? null);
};

// ════════════════════════════════════════════════════════════
// Login with email + OTP. The OTP is delivered via email (sendMail),
// reuses the same LoginOtp table as the phone-based flow.
// ════════════════════════════════════════════════════════════

const EMAIL_LOGIN_OTP_TTL_MS          = 5 * 60 * 1000;
const EMAIL_LOGIN_OTP_RESEND_AFTER_MS = 60 * 1000;
const EMAIL_LOGIN_OTP_MAX_PER_HOUR    = 5;
const EMAIL_LOGIN_OTP_MAX_ATTEMPTS    = 5;

const devEmailOtpLog = (input: SendEmailLoginOtpInput, otp: string): void => {
  if (env.NODE_ENV === 'production') return;
  const who = `${input.email} (${input.role}${input.schoolId ? `, school ${input.schoolId}` : ''})`;
  console.log(`\n🔐 [DEV] Email Login OTP for ${who}: ${otp}  (valid ${EMAIL_LOGIN_OTP_TTL_MS / 60000} min)\n`);
};

const loginOtpEmailHtml = (name: string, otp: string): string => `
  <p>Hi ${name},</p>
  <p>Your login OTP is:</p>
  <h2 style="letter-spacing: 4px;">${otp}</h2>
  <p>This code expires in ${EMAIL_LOGIN_OTP_TTL_MS / 60000} minutes. Do not share it with anyone.</p>
`;

const findEmailOtpLoginUser = async ({ email, role, schoolId, customRoleId }: SendEmailLoginOtpInput) => {
  const isSchoolScoped = assertSchoolScope(role, schoolId);

  const user = await prisma.user.findFirst({
    where: {
      email: { equals: email, mode: 'insensitive' },
      role,
      ...(isSchoolScoped ? { schoolId } : {}),
      ...(customRoleId ? { customRoleId } : {}),
    },
    include: { school: true, customRole: CUSTOM_ROLE_SELECT },
  });

  if (!user) {
    throw otpError(
      'This email is not registered. Please check the email or contact your school.',
      'EMAIL_NOT_REGISTERED', 404,
    );
  }
  if (!user.isActive) {
    throw otpError(
      'Your account is inactive. Please contact your school admin.',
      'ACCOUNT_INACTIVE', 403,
    );
  }
  assertCustomRoleActive(user);

  return user;
};

// ── Request a login OTP via email ──────────────────────────────
export const sendEmailLoginOtp = async (
  input: SendEmailLoginOtpInput,
): Promise<{ resendAfterSeconds: number; expiresInSeconds: number }> => {

  const user   = await findEmailOtpLoginUser(input);
  const now    = Date.now();
  const hourMs = 60 * 60 * 1000;

  const recent = await prisma.loginOtp.findMany({
    where:   { userId: user.id, createdAt: { gt: new Date(now - hourMs) } },
    orderBy: { createdAt: 'desc' },
    select:  { createdAt: true },
  });

  if (recent.length >= EMAIL_LOGIN_OTP_MAX_PER_HOUR) {
    const oldest = recent[recent.length - 1].createdAt.getTime();
    throw otpError(
      'Too many OTP requests. Please try again later.',
      'OTP_LIMIT_REACHED', 429,
      { retryAfterSeconds: Math.ceil((oldest + hourMs - now) / 1000) },
    );
  }

  const sinceLastMs = recent[0] ? now - recent[0].createdAt.getTime() : Infinity;
  if (sinceLastMs < EMAIL_LOGIN_OTP_RESEND_AFTER_MS) {
    const retryAfterSeconds = Math.ceil((EMAIL_LOGIN_OTP_RESEND_AFTER_MS - sinceLastMs) / 1000);
    throw otpError(
      `Please wait ${retryAfterSeconds} seconds before requesting a new OTP.`,
      'OTP_RESEND_COOLDOWN', 429,
      { retryAfterSeconds },
    );
  }

  const otp      = generateOtp();
  const codeHash = await hashPassword(otp);

  const [, created] = await prisma.$transaction([
    prisma.loginOtp.updateMany({ where: { userId: user.id, used: false }, data: { used: true } }),
    prisma.loginOtp.create({
      data: {
        userId:    user.id,
        codeHash,
        expiresAt: new Date(now + EMAIL_LOGIN_OTP_TTL_MS),
      },
    }),
  ]);

  devEmailOtpLog(input, otp);

  try {
    await sendMail(
      user.email,
      'Your Arise Login OTP',
      loginOtpEmailHtml(user.name, otp),
    );
  } catch (err) {
    console.error('sendEmailLoginOtp: failed to send OTP email:', err);
    await prisma.loginOtp.delete({ where: { id: created.id } });
    throw otpError(
      'Could not send OTP right now. Please try again in a moment.',
      'OTP_SEND_FAILED', 503,
    );
  }

  return {
    resendAfterSeconds: EMAIL_LOGIN_OTP_RESEND_AFTER_MS / 1000,
    expiresInSeconds:   EMAIL_LOGIN_OTP_TTL_MS / 1000,
  };
};

// ── Verify an email login OTP and issue a session ──────────────
export const verifyEmailLoginOtp = async (
  input: VerifyEmailLoginOtpInput,
): Promise<{ user: UserPublic; tokens: AuthTokens }> => {

  const user = await findEmailOtpLoginUser(input);

  const otpExpired = () => otpError(
    'OTP has expired or is no longer valid. Please request a new OTP.',
    'OTP_EXPIRED', 400,
  );

  const active = await prisma.loginOtp.findFirst({
    where:   { userId: user.id, used: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!active) throw otpExpired();

  if (!(await comparePassword(input.otp, active.codeHash))) {
    const attempts     = active.attempts + 1;
    const attemptsLeft = EMAIL_LOGIN_OTP_MAX_ATTEMPTS - attempts;

    await prisma.loginOtp.update({
      where: { id: active.id },
      data:  { attempts, ...(attemptsLeft <= 0 ? { used: true } : {}) },
    });

    if (attemptsLeft <= 0) {
      throw otpError(
        'Too many incorrect attempts. Please request a new OTP.',
        'OTP_ATTEMPTS_EXCEEDED', 429,
      );
    }
    throw otpError(
      `Incorrect OTP. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left.`,
      'INVALID_OTP', 400,
      { attemptsLeft },
    );
  }

  const consumed = await prisma.loginOtp.updateMany({
    where: { id: active.id, used: false },
    data:  { used: true },
  });
  if (consumed.count !== 1) throw otpExpired();

  return issueSession(user, user.school?.name ?? null);
};

// ── Refresh ───────────────────────────────────────────────────
export const refresh = async (
  token: string,
): Promise<{ accessToken: string }> => {

  // Verify signature first
  try {
    verifyRefreshToken(token);
  } catch {
    const err = new Error('Invalid or expired refresh token') as any;
    err.code       = 'INVALID_REFRESH_TOKEN';
    err.statusCode = 401;
    throw err;
  }

  // Check DB
  const stored = await prisma.refreshToken.findUnique({
    where: { token },
    include: { user: { include: { customRole: CUSTOM_ROLE_SELECT } } },
  });

  if (
    !stored || stored.expiresAt < new Date() || !stored.user.isActive ||
    (stored.user.role === 'STAFF' && !stored.user.customRole?.isActive)
  ) {
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

// ── Set / clear own username (ADMIN, SUPER_ADMIN) ──────────────
export const updateOwnUsername = async (userId: string, username: string | null) => {
  await assertUsernameAvailable(username, userId);
  const user = await prisma.user.update({ where: { id: userId }, data: { username }, include: { school: true, customRole: CUSTOM_ROLE_SELECT } });
  return toPublic(user, user.school?.name ?? null);
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

// ── Update profile photo ──────────────────────────────────────
export const updateProfilePhoto = async (
  userId: string,
  file: { buffer: Buffer; originalname: string; mimetype: string },
): Promise<UserPublic> => {
  const imageUrl = await uploadFile(file.buffer, file.originalname, file.mimetype);

  const user = await prisma.user.update({
    where: { id: userId },
    data:  { profilePhoto: imageUrl },
    include: { school: true, customRole: CUSTOM_ROLE_SELECT },
  });

  return toPublic(user, user.school?.name ?? null);
};
