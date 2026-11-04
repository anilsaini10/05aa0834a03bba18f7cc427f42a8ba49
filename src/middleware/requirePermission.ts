import { Request, Response, NextFunction } from 'express';
import { getMyPermissions } from '../features/permissions/permissions.service';
import { sendError } from '../shared/utils/apiResponse';

// Opens a school-admin route to custom-role staff (Accountant, …) whose
// role has the permission key. Use after authGuard:
//   router.post('/fees', authGuard, requirePermission('feesManage'), handler);
// ADMIN passes unless the super admin switched the key off for the school.
// STAFF needs the key true in their effective permissions (see
// permissions.service). Every other role is refused.
export const requirePermission = (key: string) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = (req as any).user;
    if (!user) {
      sendError(res, 'Unauthorized', 'UNAUTHORIZED', 401);
      return;
    }
    if (user.role !== 'ADMIN' && user.role !== 'STAFF') {
      sendError(res, 'Access denied. Required roles: ADMIN, STAFF', 'FORBIDDEN', 403);
      return;
    }
    try {
      const mine = await getMyPermissions(user);
      const allowed = user.role === 'ADMIN'
        ? mine.schoolPermissions?.[key] !== false
        : (mine.permissions as Record<string, unknown>)[key] === true;
      if (!allowed) {
        sendError(res, `You don't have the "${key}" permission`, 'PERMISSION_DENIED', 403);
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
