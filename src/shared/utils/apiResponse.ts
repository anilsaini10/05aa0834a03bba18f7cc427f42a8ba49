import { Response } from 'express';

export const sendSuccess = <T>(
  res: Response,
  data: T,
  statusCode = 200,
): Response =>
  res.status(statusCode).json({ success: true, data });

export const sendError = (
  res:        Response,
  message:    string,
  code:       string,
  statusCode = 400,
): Response =>
  res.status(statusCode).json({
    success: false,
    error: { message, code },
  });
