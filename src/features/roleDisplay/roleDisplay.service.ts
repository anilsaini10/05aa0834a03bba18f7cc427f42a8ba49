import { Role } from '@prisma/client';
import { prisma } from '../../config/db';
import { UpdateRoleDisplaySchema, BulkUpdateRoleDisplaySchema } from './roleDisplay.validation';

const appError = (message: string, code: string, statusCode: number) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = statusCode;
  return err;
};

// Roles that log in WITHOUT a schoolId.
const GLOBAL_ROLES: ReadonlySet<string> = new Set<string>(['SUPER_ADMIN', 'ADMIN']);

type RoleItem = {
  key:          string;
  label:        string;
  type:         'built_in' | 'custom';
  customRoleId: string | null;
  loginRole:    Role;
  needsSchool:  boolean;
};

// ══════════════════════════════════════════════════════════════════
// Public APIs — no auth
// ══════════════════════════════════════════════════════════════════

// ── GET /api/auth/roles?platform=web|mobile[&schoolId=...] ──────
// Without schoolId: returns ALL platform-visible roles (frontend
//   groups needsSchool:false as direct options, needsSchool:true
//   under "Other").
// With schoolId: returns only the school-scoped roles (TEACHER,
//   PARENT, custom) for the "Other" dropdown after a school is picked.
export const listLoginRoles = async (
  platform: 'web' | 'mobile',
  schoolId?: string,
) => {
  const platformFilter = platform === 'web' ? { showOnWeb: true } : { showOnMobile: true };

  const configs = await prisma.roleDisplayConfig.findMany({
    where: platformFilter,
    include: { customRole: { select: { id: true, key: true, name: true, isActive: true } } },
    orderBy: { displayOrder: 'asc' },
  });

  const items: RoleItem[] = [];

  for (const c of configs) {
    if (c.builtInRole) {
      const needsSchool = !GLOBAL_ROLES.has(c.builtInRole);
      if (schoolId && !needsSchool) continue;
      items.push({
        key:          c.builtInRole,
        label:        c.label,
        type:         'built_in',
        customRoleId: null,
        loginRole:    c.builtInRole as Role,
        needsSchool,
      });
    } else if (c.customRole && c.customRole.isActive) {
      items.push({
        key:          c.customRole.key,
        label:        c.label,
        type:         'custom',
        customRoleId: c.customRole.id,
        loginRole:    'STAFF' as Role,
        needsSchool:  true,
      });
    }
  }

  return { items };
};

// ── GET /api/auth/schools?search=... ────────────────────────────
// Lightweight list for the login school-picker dropdown.
export const listSchoolsForLogin = async (search?: string) => {
  const schools = await prisma.school.findMany({
    where: search
      ? { name: { contains: search, mode: 'insensitive' } }
      : undefined,
    select: { id: true, name: true, code: true, city: true },
    orderBy: { name: 'asc' },
    take: 50,
  });

  return { items: schools };
};

// ══════════════════════════════════════════════════════════════════
// Admin / Super Admin — manage display configs
// ══════════════════════════════════════════════════════════════════

const toConfigItem = (c: any) => ({
  id:            c.id,
  builtInRole:   c.builtInRole,
  customRoleId:  c.customRoleId,
  customRoleKey: c.customRole?.key ?? null,
  label:         c.label,
  type:          (c.builtInRole ? 'built_in' : 'custom') as 'built_in' | 'custom',
  isActive:      c.customRole ? c.customRole.isActive : true,
  showOnWeb:     c.showOnWeb,
  showOnMobile:  c.showOnMobile,
  displayOrder:  c.displayOrder,
});

const INCLUDE_CUSTOM = { customRole: { select: { id: true, key: true, name: true, isActive: true } } } as const;

export const listAllDisplayConfigs = async () => {
  const configs = await prisma.roleDisplayConfig.findMany({
    include: INCLUDE_CUSTOM,
    orderBy: { displayOrder: 'asc' },
  });
  return { items: configs.map(toConfigItem) };
};

export const updateDisplayConfig = async (configId: string, input: UpdateRoleDisplaySchema) => {
  const existing = await prisma.roleDisplayConfig.findUnique({ where: { id: configId } });
  if (!existing) throw appError('Role display config not found', 'CONFIG_NOT_FOUND', 404);

  const config = await prisma.roleDisplayConfig.update({
    where: { id: configId },
    data: {
      ...(input.showOnWeb    !== undefined ? { showOnWeb:    input.showOnWeb }    : {}),
      ...(input.showOnMobile !== undefined ? { showOnMobile: input.showOnMobile } : {}),
      ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
    },
    include: INCLUDE_CUSTOM,
  });
  return toConfigItem(config);
};

export const bulkUpdateDisplayConfigs = async (input: BulkUpdateRoleDisplaySchema) => {
  await prisma.$transaction(
    input.items.map(item =>
      prisma.roleDisplayConfig.update({
        where: { id: item.id },
        data: {
          ...(item.showOnWeb    !== undefined ? { showOnWeb:    item.showOnWeb }    : {}),
          ...(item.showOnMobile !== undefined ? { showOnMobile: item.showOnMobile } : {}),
          ...(item.displayOrder !== undefined ? { displayOrder: item.displayOrder } : {}),
        },
      }),
    ),
  );
  return listAllDisplayConfigs();
};

// ── Called when a new CustomRole is created ─────────────────────
export const ensureDisplayConfig = async (customRoleId: string, label: string) => {
  const existing = await prisma.roleDisplayConfig.findUnique({ where: { customRoleId } });
  if (existing) return;

  const maxOrder = await prisma.roleDisplayConfig.aggregate({ _max: { displayOrder: true } });
  await prisma.roleDisplayConfig.create({
    data: {
      customRoleId,
      label,
      showOnWeb:    true,
      showOnMobile: true,
      displayOrder: (maxOrder._max.displayOrder ?? 0) + 1,
    },
  });
};
