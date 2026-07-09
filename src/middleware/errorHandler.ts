import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { env }      from '../config/env';

interface AppError extends Error {
  statusCode?: number;
  code?:       string;
}

export const errorHandler = (
  err:  AppError,
  req:  Request,
  res:  Response,
  _next: NextFunction,
): void => {

  // ── Zod validation error ──────────────────────────────────
  if (err instanceof ZodError) {
    const messages = err.errors.map(e => `${e.path.join('.')}: ${e.message}`);
    res.status(400).json({
      success: false,
      error: {
        message: messages.join(', '),
        code:    'VALIDATION_ERROR',
      },
    });
    return;
  }

  // ── Known app errors ──────────────────────────────────────
  const statusCode = err.statusCode ?? 500;
  const code       = err.code       ?? 'INTERNAL_ERROR';
  const message    = err.message    ?? 'Something went wrong';

  // ── Log in development ────────────────────────────────────
  if (env.NODE_ENV === 'development') {
    console.error(`[${code}]`, err.stack ?? err.message);
  }

  res.status(statusCode).json({
    success: false,
    error: {
      message: statusCode === 500 && env.NODE_ENV === 'production'
        ? 'Internal server error'
        : message,
      code,
    },
  });
};
