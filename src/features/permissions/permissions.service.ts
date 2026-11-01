import { randomUUID } from 'crypto';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../../config/db';
import { Permissions, PatchPermissionsSchema } from './permissions.validation';

// ════════════════════════════════════════════════════════════
// Permissions.
//   School level — School.permissions, written by SUPER_ADMIN only.
//   Role level   — SchoolRolePermission (school × custom role), written
//                  by that school's ADMIN.
// Effective permissions for a STAFF user = their role's permissions,
// except that any key the school has set to false is false — a school
// admin can never grant what the super admin switched off for the school.
// PATCH merges are done in SQL (jsonb ||, -) so two admins toggling
// different checkboxes at once don't overwrite each other.
// ════════════════════════════════════════════════════════════

const appError = (message: string, code: string, statusCode: number) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = statusCode;
  return err;
};

const asObject = (v: Prisma.JsonValue | null | undefined): Permissions =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Permissions) : {};

// Keys sent as null are removals; the rest are set.
const splitPatch = (patch: PatchPermissionsSchema['permissions']) => {
  const set: Permissions = {};
  const remove: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) remove.push(k);
    else set[k] = v;
  }
  return { set: JSON.stringify(set), remove };
};

export const effectivePermissions = (role: Permissions, school: Permissions) => {
  const blockedBySchool: string[] = [];
  const permissions = Object.fromEntries(Object.entries(role).map(([k, v]) => {
    if (school[k] === false && v !== false) {
      blockedBySchool.push(k);
      return [k, false];
    }
    return [k, v];
  })) as Permissions;
  return { permissions, blockedBySchool };
};

// ════════════════════════════════════════════════════════════
// School permissions
// ════════════════════════════════════════════════════════════

const requireSchool = async (schoolId: string) => {
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true, name: true, permissions: true } });
  if (!school) throw appError('School not found', 'SCHOOL_NOT_FOUND', 404);
  return school;
};

const schoolView = (s: { id: string; name: string; permissions: Prisma.JsonValue }) => ({
  schoolId: s.id, schoolName: s.name, permissions: asObject(s.permissions),
});

// ── GET  /super-admin/schools/:schoolId/permissions
// ── GET  /admin/permissions/school (own school, read-only)
export const getSchoolPermissions = async (schoolId: string) => schoolView(await requireSchool(schoolId));

// ── PUT /super-admin/schools/:schoolId/permissions ────────────
export const replaceSchoolPermissions = async (schoolId: string, permissions: Permissions) => {
  await requireSchool(schoolId);
  const s = await prisma.school.update({
    where: { id: schoolId }, data: { permissions }, select: { id: true, name: true, permissions: true },
  });
  return schoolView(s);
};

// ── PATCH /super-admin/schools/:schoolId/permissions ──────────
export const patchSchoolPermissions = async (schoolId: string, patch: PatchPermissionsSchema['permissions']) => {
  const { set, remove } = splitPatch(patch);
  const rows = await prisma.$queryRaw<{ id: string; name: string; permissions: Prisma.JsonValue }[]>`
    UPDATE schools
    SET permissions = (permissions || ${set}::jsonb) - ${remove}::text[]
    WHERE id = ${schoolId}
    RETURNING id, name, permissions`;
  if (!rows[0]) throw appError('School not found', 'SCHOOL_NOT_FOUND', 404);
  return schoolView(rows[0]);
};

// ════════════════════════════════════════════════════════════
// Role permissions (per school)
// ════════════════════════════════════════════════════════════

const requireActiveRole = async (roleId: string) => {
  const role = await prisma.customRole.findUnique({ where: { id: roleId }, select: { id: true, key: true, name: true, isActive: true } });
  if (!role || !role.isActive) throw appError('Role not found or inactive', 'ROLE_NOT_FOUND', 404);
  return role;
};

const roleView = (
  role: { id: string; key: string; name: string },
  row: { permissions: Prisma.JsonValue; updatedAt: Date } | null,
  schoolPermissions: Permissions,
) => {
  const permissions = asObject(row?.permissions);
  const effective   = effectivePermissions(permissions, schoolPermissions);
  return {
    role:                 { id: role.id, key: role.key, name: role.name },
    permissions,                                   // exactly what the admin saved
    effectivePermissions: effective.permissions,   // after the school's limits
    blockedBySchool:      effective.blockedBySchool,
    updatedAt:            row?.updatedAt ?? null,
  };
};

// ── GET /admin/permissions/roles/:roleId ──────────────────────
export const getRolePermissions = async (schoolId: string, roleId: string) => {
  const [role, row, school] = await Promise.all([
    requireActiveRole(roleId),
    prisma.schoolRolePermission.findUnique({ where: { schoolId_customRoleId: { schoolId, customRoleId: roleId } } }),
    requireSchool(schoolId),
  ]);
  return roleView(role, row, asObject(school.permissions));
};

// ── GET /admin/permissions/roles ──────────────────────────────
// Every active role with this school's permissions — the checkbox matrix.
export const listRolePermissions = async (schoolId: string, includeInactive = false) => {
  const [roles, rows, school] = await Promise.all([
    prisma.customRole.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: { name: 'asc' } }),
    prisma.schoolRolePermission.findMany({ where: { schoolId } }),
    requireSchool(schoolId),
  ]);
  const byRole = new Map(rows.map(r => [r.customRoleId, r]));
  const schoolPermissions = asObject(school.permissions);
  return {
    schoolPermissions,
    roles: roles.map(r => ({ ...roleView(r, byRole.get(r.id) ?? null, schoolPermissions), isActive: r.isActive })),
  };
};

// ── PUT /admin/permissions/roles/:roleId ──────────────────────
export const replaceRolePermissions = async (schoolId: string, adminId: string, roleId: string, permissions: Permissions) => {
  const role = await requireActiveRole(roleId);
  const row = await prisma.schoolRolePermission.upsert({
    where:  { schoolId_customRoleId: { schoolId, customRoleId: roleId } },
    create: { schoolId, customRoleId: roleId, permissions, updatedBy: adminId },
    update: { permissions, updatedBy: adminId },
  });
  const school = await requireSchool(schoolId);
  return roleView(role, row, asObject(school.permissions));
};

// ── PATCH /admin/permissions/roles/:roleId ────────────────────
export const patchRolePermissions = async (schoolId: string, adminId: string, roleId: string, patch: PatchPermissionsSchema['permissions']) => {
  const role = await requireActiveRole(roleId);
  const { set, remove } = splitPatch(patch);
  const [row] = await prisma.$queryRaw<{ permissions: Prisma.JsonValue; updatedAt: Date }[]>`
    INSERT INTO school_role_permissions (id, "schoolId", "customRoleId", permissions, "updatedBy", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${schoolId}, ${roleId}, ${set}::jsonb - ${remove}::text[], ${adminId}, now(), now())
    ON CONFLICT ("schoolId", "customRoleId") DO UPDATE
      SET permissions = (school_role_permissions.permissions || ${set}::jsonb) - ${remove}::text[],
          "updatedBy" = EXCLUDED."updatedBy",
          "updatedAt" = now()
    RETURNING permissions, "updatedAt"`;
  const school = await requireSchool(schoolId);
  return roleView(role, row, asObject(school.permissions));
};

// ════════════════════════════════════════════════════════════
// The logged-in user's own permissions — GET /auth/permissions
// ════════════════════════════════════════════════════════════

export const getMyPermissions = async (user: { sub: string; role: Role; schoolId: string | null }) => {
  if (user.role === 'SUPER_ADMIN' || !user.schoolId) {
    return { role: user.role, customRole: null, schoolPermissions: null, rolePermissions: null, permissions: {}, blockedBySchool: [], isSuperAdmin: true };
  }

  const [school, me] = await Promise.all([
    requireSchool(user.schoolId),
    user.role === 'STAFF'
      ? prisma.user.findUnique({ where: { id: user.sub }, select: { customRole: { select: { id: true, key: true, name: true } } } })
      : null,
  ]);
  const schoolPermissions = asObject(school.permissions);

  if (user.role !== 'STAFF' || !me?.customRole) {
    // ADMIN / TEACHER / PARENT: what the school is allowed.
    return { role: user.role, customRole: null, schoolPermissions, rolePermissions: null, permissions: schoolPermissions, blockedBySchool: [], isSuperAdmin: false };
  }

  const row = await prisma.schoolRolePermission.findUnique({
    where: { schoolId_customRoleId: { schoolId: user.schoolId, customRoleId: me.customRole.id } },
  });
  const rolePermissions = asObject(row?.permissions);
  const effective = effectivePermissions(rolePermissions, schoolPermissions);
  return {
    role: user.role, customRole: me.customRole, schoolPermissions, rolePermissions,
    permissions: effective.permissions, blockedBySchool: effective.blockedBySchool, isSuperAdmin: false,
  };
};
