import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db';
import { CreateRoleSchema, UpdateRoleSchema, ListRolesQuerySchema } from './customRoles.validation';
import { ensureDisplayConfig } from '../roleDisplay/roleDisplay.service';

const appError = (message: string, code: string, statusCode: number, details?: Record<string, unknown>) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = statusCode;
  if (details) err.details = details;
  return err;
};

const notFound = () => appError('Role not found', 'ROLE_NOT_FOUND', 404);

type RoleRow = Prisma.CustomRoleGetPayload<{ include: { _count: { select: { users: true } } } }>;

const toItem = (r: RoleRow) => ({
  id:          r.id,
  key:         r.key,
  name:        r.name,
  description: r.description,
  isActive:    r.isActive,
  usersCount:  r._count.users,
  createdAt:   r.createdAt,
  updatedAt:   r.updatedAt,
});

const WITH_COUNT = { _count: { select: { users: true } } } as const;

// A name whose key matches a different existing role is a duplicate,
// whatever its case or spacing.
const assertKeyFree = async (key: string, exceptId?: string) => {
  const existing = await prisma.customRole.findUnique({ where: { key } });
  if (existing && existing.id !== exceptId) {
    throw appError(
      existing.isActive
        ? `Role "${existing.name}" already exists`
        : `Role "${existing.name}" already exists but is inactive — reactivate it instead`,
      'ROLE_ALREADY_EXISTS', 409,
      { roleId: existing.id, key: existing.key, isActive: existing.isActive },
    );
  }
};

// ════════════════════════════════════════════════════════════
// SUPER_ADMIN — roles are global (offered to every school).
// ════════════════════════════════════════════════════════════

// ── POST /super-admin/roles ───────────────────────────────────
export const createRole = async (superAdminId: string, input: CreateRoleSchema) => {
  await assertKeyFree(input.name.key);
  try {
    const role = await prisma.customRole.create({
      data: {
        key:         input.name.key,
        name:        input.name.name,
        description: input.description ?? null,
        createdBy:   superAdminId,
      },
      include: WITH_COUNT,
    });
    await ensureDisplayConfig(role.id, role.name);
    return toItem(role);
  } catch (err) {
    // Two creates racing past assertKeyFree — the unique index decides.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') await assertKeyFree(input.name.key);
    throw err;
  }
};

// ── GET /super-admin/roles ────────────────────────────────────
export const listRoles = async (query: ListRolesQuerySchema) => {
  const roles = await prisma.customRole.findMany({
    where: {
      ...(query.status !== 'ALL' ? { isActive: query.status === 'ACTIVE' } : {}),
      ...(query.search ? {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { key:  { contains: query.search.toUpperCase().replace(/\s+/g, '_') } },
        ],
      } : {}),
    },
    include: WITH_COUNT,
    orderBy: { name: 'asc' },
  });
  return { items: roles.map(toItem) };
};

// ── GET /super-admin/roles/:roleId ────────────────────────────
export const getRole = async (roleId: string) => {
  const role = await prisma.customRole.findUnique({ where: { id: roleId }, include: WITH_COUNT });
  if (!role) throw notFound();
  return toItem(role);
};

// ── PATCH /super-admin/roles/:roleId ──────────────────────────
// Renaming changes the label only; the key stays. Deactivating hides the
// role from school admins and blocks its users' logins (they're kept).
export const updateRole = async (roleId: string, input: UpdateRoleSchema) => {
  const existing = await prisma.customRole.findUnique({ where: { id: roleId } });
  if (!existing) throw notFound();
  if (input.name) await assertKeyFree(input.name.key, roleId);

  const role = await prisma.customRole.update({
    where: { id: roleId },
    data: {
      ...(input.name                    ? { name: input.name.name }          : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.isActive !== undefined    ? { isActive: input.isActive }       : {}),
    },
    include: WITH_COUNT,
  });
  return toItem(role);
};

// ── DELETE /super-admin/roles/:roleId ─────────────────────────
// Only a role nobody uses can be deleted — otherwise deactivate it.
export const deleteRole = async (roleId: string) => {
  const role = await prisma.customRole.findUnique({ where: { id: roleId }, include: WITH_COUNT });
  if (!role) throw notFound();
  if (role._count.users > 0) {
    throw appError(
      `${role._count.users} account(s) use this role — deactivate it instead`,
      'ROLE_IN_USE', 409, { usersCount: role._count.users },
    );
  }
  await prisma.customRole.delete({ where: { id: roleId } });
};

// ════════════════════════════════════════════════════════════
// ADMIN — active roles to choose from, with this school's usage.
// ════════════════════════════════════════════════════════════

// ── GET /admin/roles ──────────────────────────────────────────
export const listRolesForSchool = async (schoolId: string) => {
  const [roles, counts] = await Promise.all([
    prisma.customRole.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
    prisma.user.groupBy({
      by: ['customRoleId'],
      where: { schoolId, role: 'STAFF', customRoleId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const used = new Map(counts.map(c => [c.customRoleId, c._count._all]));
  return {
    items: roles.map(r => ({
      id: r.id, key: r.key, name: r.name, description: r.description,
      usersInSchool: used.get(r.id) ?? 0,
    })),
  };
};
