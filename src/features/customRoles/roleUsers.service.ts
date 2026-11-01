import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db';
import { hashPassword } from '../../shared/utils/hash';
import { generateDefaultPassword } from '../../shared/utils/defaultPassword';
import { assertUsernameAvailable } from '../../shared/utils/username';
import { CreateRoleUserSchema, UpdateRoleUserSchema, ListRoleUsersQuerySchema } from './customRoles.validation';

// ════════════════════════════════════════════════════════════
// School ADMIN: login accounts with a super-admin-defined role.
// Stored as User { role: STAFF, customRoleId }, scoped to the admin's
// school. Password starts as the default (same as teachers); the admin
// resets it with POST /admin/users/:userId/reset-password.
// ════════════════════════════════════════════════════════════

const appError = (message: string, code: string, statusCode: number) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = statusCode;
  return err;
};

const notFound = () => appError('Account not found', 'ROLE_USER_NOT_FOUND', 404);

const INCLUDE = { customRole: { select: { id: true, key: true, name: true, isActive: true } } } satisfies Prisma.UserInclude;
type UserRow = Prisma.UserGetPayload<{ include: typeof INCLUDE }>;

const toItem = (u: UserRow) => ({
  id:         u.id,
  name:       u.name,
  email:      u.email,
  phone:      u.phone,
  username:   u.username,
  role:       u.role,
  customRole: u.customRole,
  isActive:   u.isActive,
  createdAt:  u.createdAt,
  updatedAt:  u.updatedAt,
});

const requireActiveRole = async (customRoleId: string) => {
  const role = await prisma.customRole.findUnique({ where: { id: customRoleId } });
  if (!role || !role.isActive) throw appError('Role not found or inactive', 'ROLE_NOT_FOUND', 404);
  return role;
};

// Email / phone / username are unique across ALL users (they're login ids).
const assertContactsFree = async (input: { email?: string; phone?: string | null; username?: string | null }, exceptUserId?: string) => {
  const or: Prisma.UserWhereInput[] = [
    ...(input.email ? [{ email: { equals: input.email, mode: 'insensitive' as const } }] : []),
    ...(input.phone ? [{ phone: input.phone }] : []),
  ];
  if (or.length) {
    const clash = await prisma.user.findFirst({
      where:  { OR: or, ...(exceptUserId ? { id: { not: exceptUserId } } : {}) },
      select: { email: true, phone: true },
    });
    if (clash && input.email && clash.email.toLowerCase() === input.email) throw appError('Email already registered', 'EMAIL_TAKEN', 409);
    if (clash) throw appError('Mobile number already registered', 'PHONE_TAKEN', 409);
  }
  await assertUsernameAvailable(input.username ?? null, exceptUserId);
};

// Unique-index race after the checks above → same 409s.
const mapUniqueError = (err: unknown): never => {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const target = String((err.meta as any)?.target ?? '');
    if (target.includes('email'))    throw appError('Email already registered', 'EMAIL_TAKEN', 409);
    if (target.includes('phone'))    throw appError('Mobile number already registered', 'PHONE_TAKEN', 409);
    if (target.includes('username')) throw appError('Username already taken', 'USERNAME_TAKEN', 409);
  }
  throw err;
};

// ── POST /admin/role-users ────────────────────────────────────
export const createRoleUser = async (schoolId: string, input: CreateRoleUserSchema) => {
  await requireActiveRole(input.customRoleId);
  await assertContactsFree(input);

  const defaultPassword = generateDefaultPassword(input.email);
  const passwordHash    = await hashPassword(defaultPassword);

  const user = await prisma.user.create({
    data: {
      name:         input.name,
      email:        input.email,
      phone:        input.phone ?? null,
      username:     input.username ?? null,
      passwordHash,
      role:         'STAFF',
      customRoleId: input.customRoleId,
      schoolId,
    },
    include: INCLUDE,
  }).catch(mapUniqueError);

  return { ...toItem(user), defaultPassword };
};

// ── GET /admin/role-users ─────────────────────────────────────
export const listRoleUsers = async (schoolId: string, q: ListRoleUsersQuerySchema) => {
  const where: Prisma.UserWhereInput = {
    schoolId,
    role: 'STAFF',
    ...(q.customRoleId ? { customRoleId: q.customRoleId } : {}),
    ...(q.status !== 'ALL' ? { isActive: q.status === 'ACTIVE' } : {}),
    ...(q.search ? {
      OR: [
        { name:     { contains: q.search, mode: 'insensitive' } },
        { email:    { contains: q.search, mode: 'insensitive' } },
        { phone:    { contains: q.search } },
        { username: { contains: q.search.toLowerCase() } },
      ],
    } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where, include: INCLUDE, orderBy: { name: 'asc' },
      skip: (q.page - 1) * q.pageSize, take: q.pageSize,
    }),
    prisma.user.count({ where }),
  ]);
  return { items: items.map(toItem), page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
};

const findInSchool = async (schoolId: string, userId: string) => {
  const user = await prisma.user.findFirst({ where: { id: userId, schoolId, role: 'STAFF' }, include: INCLUDE });
  if (!user) throw notFound();
  return user;
};

// ── GET /admin/role-users/:userId ─────────────────────────────
export const getRoleUser = async (schoolId: string, userId: string) => toItem(await findInSchool(schoolId, userId));

// ── PATCH /admin/role-users/:userId ───────────────────────────
// Deactivating (or changing the role) logs the user out everywhere.
export const updateRoleUser = async (schoolId: string, userId: string, input: UpdateRoleUserSchema) => {
  const existing = await findInSchool(schoolId, userId);
  if (input.customRoleId && input.customRoleId !== existing.customRoleId) await requireActiveRole(input.customRoleId);
  await assertContactsFree({ email: input.email, phone: input.phone, username: input.username }, userId);

  const revokeSessions =
    (input.isActive === false && existing.isActive) ||
    (input.customRoleId !== undefined && input.customRoleId !== existing.customRoleId);

  const [user] = await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.name         !== undefined ? { name: input.name }                 : {}),
        ...(input.email        !== undefined ? { email: input.email }               : {}),
        ...(input.phone        !== undefined ? { phone: input.phone }               : {}),
        ...(input.username     !== undefined ? { username: input.username }         : {}),
        ...(input.isActive     !== undefined ? { isActive: input.isActive }         : {}),
        ...(input.customRoleId !== undefined ? { customRoleId: input.customRoleId } : {}),
      },
      include: INCLUDE,
    }),
    ...(revokeSessions ? [prisma.refreshToken.deleteMany({ where: { userId } })] : []),
  ]).catch(mapUniqueError);

  return toItem(user);
};
