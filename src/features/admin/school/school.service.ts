import { prisma } from '../../../config/db';
import { getSchoolById } from '../../superAdmin/superAdmin.service';
import { UpdateMySchoolSchema } from './school.validation';

// The admin's school always comes from their token (schoolId), never from
// the request — an admin can only ever read/update their own school.
// Responses use the same shape as the super-admin school endpoints.

// ── GET /admin/school ─────────────────────────────────────────
export const getMySchool = (schoolId: string) => getSchoolById(schoolId);

// ── PATCH /admin/school ───────────────────────────────────────
export const updateMySchool = async (schoolId: string, input: UpdateMySchoolSchema) => {
  await getSchoolById(schoolId); // 404 SCHOOL_NOT_FOUND if missing
  await prisma.school.update({ where: { id: schoolId }, data: input });
  return getSchoolById(schoolId);
};
