import { Role } from '@prisma/client';
import { prisma } from '../../../config/db';
import { resetPasswordToDefault } from '../../../shared/services/account.service';

const notFound = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 404;
  return err;
};

// Roles a school ADMIN may manage logins for. Other admins and the
// super admin are deliberately excluded — admin passwords are reset by
// the super admin (POST /super-admin/schools/:schoolId/admins/:adminId/reset-password).
const ADMIN_MANAGED_ROLES: Role[] = ['TEACHER', 'PARENT'];

// ── POST /admin/users/:userId/reset-password ──────────────────
// One endpoint for every login the admin manages (teacher or parent).
// userId comes from `userId` on teacher responses or `parentUserId` on
// student responses. The user must belong to the admin's own school.
export const resetUserPassword = async (schoolId: string, userId: string) => {
  const user = await prisma.user.findFirst({
    where: { id: userId, schoolId, role: { in: ADMIN_MANAGED_ROLES } },
  });
  if (!user) throw notFound('User not found', 'USER_NOT_FOUND');

  const { defaultPassword } = await resetPasswordToDefault(user.id);
  return {
    userId: user.id,
    name:   user.name,
    role:   user.role,
    defaultPassword,
  };
};
