import { prisma } from '../../config/db';

const RESULT_LIMIT = 20;

export interface SchoolListItem {
  id:   string;
  name: string;
  city: string | null;
}

// ── Search the school directory ─────────────────────────────────
export const searchSchools = async (search?: string): Promise<SchoolListItem[]> => {
  return prisma.school.findMany({
    where:   search ? { name: { contains: search, mode: 'insensitive' } } : undefined,
    select:  { id: true, name: true, city: true },
    orderBy: { name: 'asc' },
    take:    RESULT_LIMIT,
  });
};

// ── Roles a school's staff can log in with (login screen) ─────
// Public, like the school search: active custom roles that at least one
// active STAFF account in this school has. Only names are exposed.
export const listLoginRoles = async (schoolId: string) => {
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true, name: true } });
  if (!school) {
    const err = new Error('School not found') as any;
    err.code       = 'SCHOOL_NOT_FOUND';
    err.statusCode = 404;
    throw err;
  }

  const users = await prisma.user.findMany({
  where: {
    schoolId: school.id,
    isActive: true
  },
  include: {
    customRole: true
  }
});

console.log(JSON.stringify(users, null, 2));

  console.log('listLoginRoles school => ', school);
  const roles = await prisma.customRole.findMany({
    where:   { isActive: true, users: { some: { schoolId: school.id, isActive: true } } },
    select:  { id: true, key: true, name: true },
    orderBy: { name: 'asc' },
  });
  console.log('listLoginRoles roles => ', roles);
  return {
    schoolId:   school.id,
    schoolName: school.name,
    // Send role + customRoleId as-is to POST /auth/login.
    roles: roles
    // .map(r => ({ 
    //   // role: 'STAFF' as const,
    //    customRoleId: r.id, key: r.key, name: r.name })),
  };
};
