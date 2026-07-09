import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { JwtPayload } from '../types/common';

// ── Access Token ──────────────────────────────────────────────
export const signAccessToken = (payload: JwtPayload): string =>
  jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES as any,
  });

export const verifyAccessToken = (token: string): JwtPayload =>
  jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;

// ── Refresh Token ─────────────────────────────────────────────
export const signRefreshToken = (payload: JwtPayload): string =>
  jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES as any,
  });

export const verifyRefreshToken = (token: string): JwtPayload =>
  jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtPayload;

// ── Refresh token expiry date ─────────────────────────────────
export const getRefreshTokenExpiry = (): Date => {
  const days = parseInt(env.JWT_REFRESH_EXPIRES.replace('d', ''), 10) || 7;
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
};

// ── Access token expiry date ──────────────────────────────────
const DURATION_MULTIPLIERS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export const getAccessTokenExpiry = (): Date => {
  const match = env.JWT_ACCESS_EXPIRES.match(/^(\d+)([smhd])$/);
  const ms    = match ? parseInt(match[1], 10) * DURATION_MULTIPLIERS[match[2]] : 15 * 60_000;
  return new Date(Date.now() + ms);
};
