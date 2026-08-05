import { Request, Response, NextFunction } from 'express';
import * as authService from './auth.service';
import {
  signupSchema, loginSchema, refreshSchema, logoutSchema, resetPasswordSchema,
  forgotPasswordSchema, resetPasswordConfirmSchema,
} from './auth.validation';
import { sendSuccess } from '../../shared/utils/apiResponse';

// ── POST /auth/signup ─────────────────────────────────────────
export const signupHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input             = signupSchema.parse(req.body);
    const { user, tokens }  = await authService.signup(input);
    sendSuccess(res, { user, tokens }, 201);
  } catch (err) {
    next(err);
  }
};

// ── POST /auth/login ──────────────────────────────────────────
export const loginHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input             = loginSchema.parse(req.body);
    const { user, tokens }  = await authService.login(input);
    sendSuccess(res, { user, tokens });
  } catch (err) {
    next(err);
  }
};

// ── POST /auth/refresh ────────────────────────────────────────
export const refreshHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);
    const result           = await authService.refresh(refreshToken);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── POST /auth/logout ─────────────────────────────────────────
export const logoutHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { refreshToken } = logoutSchema.parse(req.body);
    await authService.logout(refreshToken);
    sendSuccess(res, { message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
};

// ── POST /auth/reset-password ─────────────────────────────────
export const resetPasswordHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { currentPassword, newPassword } = resetPasswordSchema.parse(req.body);
    await authService.resetPassword((req as any).user.sub, currentPassword, newPassword);
    sendSuccess(res, { message: 'Password updated successfully. Please log in again on other devices.' });
  } catch (err) {
    next(err);
  }
};

// ── POST /auth/forgot-password ────────────────────────────────
export const forgotPasswordHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    await authService.requestPasswordReset(email);
    sendSuccess(res, { message: 'If an account with that email exists, an OTP has been sent.' });
  } catch (err) {
    next(err);
  }
};

// ── POST /auth/reset-password/confirm ─────────────────────────
export const resetPasswordConfirmHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { email, otp, newPassword } = resetPasswordConfirmSchema.parse(req.body);
    await authService.confirmPasswordReset(email, otp, newPassword);
    sendSuccess(res, { message: 'Password reset successfully. Please log in again.' });
  } catch (err) {
    next(err);
  }
};

// ── GET /auth/me ──────────────────────────────────────────────
export const meHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    sendSuccess(res, { user: (req as any).user });
  } catch (err) {
    next(err);
  }
};
