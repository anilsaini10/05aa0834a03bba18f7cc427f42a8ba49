import { randomUUID } from 'crypto';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../../config/db';
import {
  Permissions, PatchPermissionsSchema, BUILT_IN_PERMISSION_ROLES, BuiltInPermissionRole, isBuiltInPermissionRole,
} from './permissions.validation';

// ════════════════════════════════════════════════════════════
// Permissions.
//   School level — School.permissions, written by SUPER_ADMIN only.
//   Role level   — SchoolRolePermission (school × custom role) and
//                  SchoolBuiltInRolePermission (school × TEACHER/PARENT),
//                  written by that school's ADMIN.
//   Role limits  — the `limits` column on those rows, written by SUPER_ADMIN:
//                  a per-school cap for one role. ADMIN's cap is the school level.
// Effective permissions for a STAFF / TEACHER / PARENT user = their role's
// permissions, except that any key the school or the role's limits set to
// false is false — a school admin can never grant what the super admin
// switched off.
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

// A key is false when the school or the role's limit has it false.
export const effectivePermissions = (role: Permissions, school: Permissions, limits: Permissions = {}) => {
  const blockedBySchool: string[] = [];
  const blockedByRoleLimit: string[] = [];
  const permissions = Object.fromEntries(Object.entries(role).map(([k, v]) => {
    if (v === false) return [k, v];
    const bySchool = school[k] === false;
    const byLimit  = limits[k] === false;
    if (bySchool) blockedBySchool.push(k);
    if (byLimit)  blockedByRoleLimit.push(k);
    return [k, bySchool || byLimit ? false : v];
  })) as Permissions;
  return { permissions, blockedBySchool, blockedByRoleLimit };
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
//   Custom roles (Accountant, Vice Principal…) are addressed by id and
//   stored in SchoolRolePermission; TEACHER / PARENT by name, stored in
//   SchoolBuiltInRolePermission. Both give the same response shape.
// ════════════════════════════════════════════════════════════

type RoleRef = { id: string; key: string; name: string; isBuiltIn: boolean };
type RoleRow = { permissions: Prisma.JsonValue; limits: Prisma.JsonValue; updatedAt: Date };
type RoleColumn = 'permissions' | 'limits';

const BUILT_IN_NAMES: Record<BuiltInPermissionRole, string> = { TEACHER: 'Teacher', PARENT: 'Parent' };
const builtInRef = (role: BuiltInPermissionRole): RoleRef => ({ id: role, key: role, name: BUILT_IN_NAMES[role], isBuiltIn: true });
const ADMIN_REF: RoleRef = { id: 'ADMIN', key: 'ADMIN', name: 'Admin', isBuiltIn: true };

// roleId is a custom role's id or a built-in role name (validated upstream).
const requireActiveRole = async (roleId: string): Promise<RoleRef> => {
  if (isBuiltInPermissionRole(roleId)) return builtInRef(roleId);
  const role = await prisma.customRole.findUnique({ where: { id: roleId }, select: { id: true, key: true, name: true, isActive: true } });
  if (!role || !role.isActive) throw appError('Role not found or inactive', 'ROLE_NOT_FOUND', 404);
  return { id: role.id, key: role.key, name: role.name, isBuiltIn: false };
};

const findRoleRow = (schoolId: string, role: RoleRef): Promise<RoleRow | null> =>
  role.isBuiltIn
    ? prisma.schoolBuiltInRolePermission.findUnique({ where: { schoolId_role: { schoolId, role: role.id as BuiltInPermissionRole } } })
    : prisma.schoolRolePermission.findUnique({ where: { schoolId_customRoleId: { schoolId, customRoleId: role.id } } });

// PUT — sets one column (admin: permissions, super admin: limits).
const replaceRoleColumn = (schoolId: string, userId: string, role: RoleRef, column: RoleColumn, value: Permissions): Promise<RoleRow> => {
  const data = { [column]: value, updatedBy: userId };
  return role.isBuiltIn
    ? prisma.schoolBuiltInRolePermission.upsert({
        where:  { schoolId_role: { schoolId, role: role.id as BuiltInPermissionRole } },
        create: { schoolId, role: role.id as BuiltInPermissionRole, ...data },
        update: data,
      })
    : prisma.schoolRolePermission.upsert({
        where:  { schoolId_customRoleId: { schoolId, customRoleId: role.id } },
        create: { schoolId, customRoleId: role.id, ...data },
        update: data,
      });
};

// PATCH — merged in SQL, see the note at the top. Table/column names are
// fixed strings, never user input.
const patchRoleColumn = async (schoolId: string, userId: string, role: RoleRef, column: RoleColumn, patch: PatchPermissionsSchema['permissions']): Promise<RoleRow> => {
  const { set, remove } = splitPatch(patch);
  const table  = Prisma.raw(role.isBuiltIn ? 'school_builtin_role_permissions' : 'school_role_permissions');
  const keyCol = Prisma.raw(role.isBuiltIn ? 'role' : '"customRoleId"');
  const keyVal = role.isBuiltIn ? Prisma.sql`${role.id}::"Role"` : Prisma.sql`${role.id}`;
  const col    = Prisma.raw(column);
  const [row] = await prisma.$queryRaw<RoleRow[]>`
    INSERT INTO ${table} (id, "schoolId", ${keyCol}, ${col}, "updatedBy", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${schoolId}, ${keyVal}, ${set}::jsonb - ${remove}::text[], ${userId}, now(), now())
    ON CONFLICT ("schoolId", ${keyCol}) DO UPDATE
      SET ${col} = (${table}.${col} || ${set}::jsonb) - ${remove}::text[],
          "updatedBy" = EXCLUDED."updatedBy",
          "updatedAt" = now()
    RETURNING permissions, limits, "updatedAt"`;
  return row;
};

const roleView = (role: RoleRef, row: RoleRow | null, schoolPermissions: Permissions) => {
  const permissions = asObject(row?.permissions);
  const limits      = asObject(row?.limits);
  const effective   = effectivePermissions(permissions, schoolPermissions, limits);
  return {
    role:                 role,
    permissions,                                   // exactly what the admin saved
    limits,                                        // super admin's cap for this role
    effectivePermissions: effective.permissions,   // after the school's and the role's limits
    blockedBySchool:      effective.blockedBySchool,
    blockedByRoleLimit:   effective.blockedByRoleLimit,
    updatedAt:            row?.updatedAt ?? null,
  };
};

// ADMIN in the super admin's role list: its cap and its permissions are
// both the school's permissions.
const adminRoleView = (schoolPermissions: Permissions) => ({
  role: ADMIN_REF, permissions: schoolPermissions, limits: schoolPermissions, effectivePermissions: schoolPermissions,
  blockedBySchool: [] as string[], blockedByRoleLimit: [] as string[], updatedAt: null,
});

// ── GET /admin/permissions/roles/:roleId ──────────────────────
export const getRolePermissions = async (schoolId: string, roleId: string) => {
  const role = await requireActiveRole(roleId);
  const [row, school] = await Promise.all([findRoleRow(schoolId, role), requireSchool(schoolId)]);
  return roleView(role, row, asObject(school.permissions));
};

// ── GET /admin/permissions/roles ──────────────────────────────
// TEACHER, PARENT, then every active custom role with this school's
// permissions — the checkbox matrix.
export const listRolePermissions = async (schoolId: string, includeInactive = false) => {
  const [roles, rows, builtInRows, school] = await Promise.all([
    prisma.customRole.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: { name: 'asc' } }),
    prisma.schoolRolePermission.findMany({ where: { schoolId } }),
    prisma.schoolBuiltInRolePermission.findMany({ where: { schoolId } }),
    requireSchool(schoolId),
  ]);
  const byRole        = new Map(rows.map(r => [r.customRoleId, r]));
  const byBuiltInRole = new Map(builtInRows.map(r => [r.role as string, r]));
  const schoolPermissions = asObject(school.permissions);
  return {
    schoolPermissions,
    roles: [
      ...BUILT_IN_PERMISSION_ROLES.map(r => ({ ...roleView(builtInRef(r), byBuiltInRole.get(r) ?? null, schoolPermissions), isActive: true })),
      ...roles.map(r => ({
        ...roleView({ id: r.id, key: r.key, name: r.name, isBuiltIn: false }, byRole.get(r.id) ?? null, schoolPermissions),
        isActive: r.isActive,
      })),
    ],
  };
};

// ── PUT /admin/permissions/roles/:roleId ──────────────────────
export const replaceRolePermissions = async (schoolId: string, adminId: string, roleId: string, permissions: Permissions) => {
  const role = await requireActiveRole(roleId);
  const row = await replaceRoleColumn(schoolId, adminId, role, 'permissions', permissions);
  const school = await requireSchool(schoolId);
  return roleView(role, row, asObject(school.permissions));
};

// ── PATCH /admin/permissions/roles/:roleId ────────────────────
export const patchRolePermissions = async (schoolId: string, adminId: string, roleId: string, patch: PatchPermissionsSchema['permissions']) => {
  const role = await requireActiveRole(roleId);
  const row = await patchRoleColumn(schoolId, adminId, role, 'permissions', patch);
  const school = await requireSchool(schoolId);
  return roleView(role, row, asObject(school.permissions));
};

// ════════════════════════════════════════════════════════════
// Role limits (SUPER_ADMIN, per school)
//   roleId ADMIN reads/writes the school's permissions; any other role
//   reads/writes the `limits` column of its row.
// ════════════════════════════════════════════════════════════

// ── GET /super-admin/schools/:schoolId/role-permissions ───────
// ADMIN, TEACHER, PARENT, then every custom role (inactive too).
export const listRoleLimits = async (schoolId: string) => {
  const list = await listRolePermissions(schoolId, true);
  return { ...list, roles: [{ ...adminRoleView(list.schoolPermissions), isActive: true }, ...list.roles] };
};

// ── GET /super-admin/schools/:schoolId/role-permissions/:roleId
export const getRoleLimits = async (schoolId: string, roleId: string) => {
  if (roleId === 'ADMIN') return adminRoleView(asObject((await requireSchool(schoolId)).permissions));
  return getRolePermissions(schoolId, roleId);
};

// ── PUT /super-admin/schools/:schoolId/role-permissions/:roleId
export const replaceRoleLimits = async (schoolId: string, superAdminId: string, roleId: string, limits: Permissions) => {
  if (roleId === 'ADMIN') return adminRoleView((await replaceSchoolPermissions(schoolId, limits)).permissions);
  const [role, school] = await Promise.all([requireActiveRole(roleId), requireSchool(schoolId)]);
  const row = await replaceRoleColumn(schoolId, superAdminId, role, 'limits', limits);
  return roleView(role, row, asObject(school.permissions));
};

// ── PATCH /super-admin/schools/:schoolId/role-permissions/:roleId
export const patchRoleLimits = async (schoolId: string, superAdminId: string, roleId: string, patch: PatchPermissionsSchema['permissions']) => {
  if (roleId === 'ADMIN') return adminRoleView((await patchSchoolPermissions(schoolId, patch)).permissions);
  const [role, school] = await Promise.all([requireActiveRole(roleId), requireSchool(schoolId)]);
  const row = await patchRoleColumn(schoolId, superAdminId, role, 'limits', patch);
  return roleView(role, row, asObject(school.permissions));
};

// ════════════════════════════════════════════════════════════
// The logged-in user's own permissions — GET /auth/permissions
//   ADMIN                  → everything the school is allowed.
//   TEACHER / PARENT       → what the admin gave that built-in role.
//   STAFF (custom role)    → what the admin gave their custom role.
// Role permissions are always capped by the school's and the role's
// limits (effectivePermissions).
// ════════════════════════════════════════════════════════════

export const getMyPermissions = async (user: { sub: string; role: Role; schoolId: string | null }) => {
  if (user.role === 'SUPER_ADMIN' || !user.schoolId) {
    return { role: user.role, customRole: null, schoolPermissions: null, rolePermissions: null, permissions: {}, blockedBySchool: [], blockedByRoleLimit: [], isSuperAdmin: true };
  }

  const schoolId = user.schoolId;
  const [school, roleRef] = await Promise.all([
    requireSchool(schoolId),
    user.role === 'STAFF'
      ? prisma.user.findUnique({ where: { id: user.sub }, select: { customRole: { select: { id: true, key: true, name: true } } } })
          .then(me => (me?.customRole ? { ...me.customRole, isBuiltIn: false } : null))
      : Promise.resolve(isBuiltInPermissionRole(user.role) ? builtInRef(user.role) : null),
  ]);
  const schoolPermissions = asObject(school.permissions);

  if (!roleRef) {
    // ADMIN: what the school is allowed.
    return { role: user.role, customRole: null, schoolPermissions, rolePermissions: null, permissions: schoolPermissions, blockedBySchool: [], blockedByRoleLimit: [], isSuperAdmin: false };
  }

  const row = await findRoleRow(schoolId, roleRef);
  const rolePermissions = asObject(row?.permissions);
  const effective = effectivePermissions(rolePermissions, schoolPermissions, asObject(row?.limits));
  return {
    role: user.role,
    customRole: roleRef.isBuiltIn ? null : { id: roleRef.id, key: roleRef.key, name: roleRef.name },
    schoolPermissions, rolePermissions,
    permissions: effective.permissions, blockedBySchool: effective.blockedBySchool,
    blockedByRoleLimit: effective.blockedByRoleLimit, isSuperAdmin: false,
  };
};
