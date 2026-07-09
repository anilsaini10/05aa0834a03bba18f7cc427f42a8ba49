import { Request, Response, NextFunction } from 'express';
import * as authService from './auth.service';
import {
  signupSchema, loginSchema, refreshSchema, logoutSchema,
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
