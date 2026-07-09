import { Role } from '@prisma/client';
import { Request } from 'express';

// ── JWT Payload ───────────────────────────────────────────────
export interface JwtPayload {
  sub:      string;   // user id
  email:    string;
  role:     Role;
  schoolId: string;
  iat?:     number;
  exp?:     number;
}

// ── Authenticated Request ─────────────────────────────────────
export interface AuthRequest extends Request {
  user?: JwtPayload;
}

// ── API Response ──────────────────────────────────────────────
export interface ApiSuccess<T = unknown> {
  success: true;
  data:    T;
}

export interface ApiError {
  success: false;
  error: {
    message: string;
    code:    string;
  };
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;
