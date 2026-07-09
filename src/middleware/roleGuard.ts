import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { sendError } from '../shared/utils/apiResponse';

export const roleGuard = (...roles: Role[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as any).user;

    if (!user) {
      sendError(res, 'Unauthorized', 'UNAUTHORIZED', 401);
      return;
    }

    if (!roles.includes(user.role)) {
      sendError(
        res,
        `Access denied. Required roles: ${roles.join(', ')}`,
        'FORBIDDEN',
        403,
      );
      return;
    }

    next();
  };

// ── Usage example ─────────────────────────────────────────────
// router.get('/admin-only', authGuard, roleGuard('ADMIN'), handler);
// router.get('/owner-staff', authGuard, roleGuard('OWNER', 'STAFF'), handler);
