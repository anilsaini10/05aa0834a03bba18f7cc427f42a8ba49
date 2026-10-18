import { Request, Response, NextFunction } from 'express';
import * as usersService from './users.service';
import { sendSuccess } from '../../../shared/utils/apiResponse';

// ── POST /admin/users/:userId/reset-password ──────────────────
export const resetPasswordHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await usersService.resetUserPassword((req as any).user.schoolId, req.params.userId);
    sendSuccess(res, { message: 'Password reset to the default. The user must log in again.', ...result });
  } catch (err) {
    next(err);
  }
};
