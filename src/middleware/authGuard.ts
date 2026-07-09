import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../shared/utils/jwt';
import { sendError }         from '../shared/utils/apiResponse';

export const authGuard = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      sendError(res, 'No token provided', 'UNAUTHORIZED', 401);
      return;
    }

    const token   = authHeader.split(' ')[1];
    const payload = verifyAccessToken(token);

    (req as any).user = payload;
    next();
  } catch {
    sendError(res, 'Invalid or expired token', 'UNAUTHORIZED', 401);
  }
};
