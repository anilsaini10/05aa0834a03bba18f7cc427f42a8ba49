import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/db';
import { hashPassword } from '../../../shared/utils/hash';
import { generateDefaultPassword } from '../../../shared/utils/defaultPassword';
import { assertUsernameAvailable } from '../../../shared/utils/username';
import { CreateStaffSchema, UpdateStaffSchema, ListStaffQuerySchema } from './staff.validation';

const appError = (message: string, code: string, statusCode: number) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = statusCode;
  return err;
};

const notFound = (message: string, code: string) => appError(message, code, 404);
const conflict = (message: string, code: string) => appError(message, code, 409);

const STAFF_INCLUDE = {
  customRole: { select: { id: true, key: true, name: true } },
  user:       { select: { id: true, username: true, isActive: true } },
} as const;

type StaffRow = Prisma.StaffGetPayload<{ include: typeof STAFF_INCLUDE }>;

export interface StaffResponse {
  id:               string;
  employeeId:       string;
  userId:           string | null;
  name:             string;
  email:            string | null;
  phone:            string;
  username:         string | null;
  gender:           string;
  designation:      string;
  customRoleId:     string;
  customRole:       { id: string; key: string; name: string } | null;
  salary:           number;
  qualification:    string;
  experienceYears:  number;
  experienceMonths: number;
  joiningDate:      Date;
  status:           string;
  isActive:         boolean;
  createdAt:        Date;
  updatedAt:        Date;
}

const toStaffResponse = (s: StaffRow): StaffResponse => ({
  id:               s.id,
  employeeId:       s.employeeId,
  userId:           s.userId,
  name:             s.name,
  email:            s.email,
  phone:            s.phone,
  username:         s.user?.username ?? null,
  gender:           s.gender,
  designation:      s.designation,
  customRoleId:     s.customRoleId!,
  customRole:       s.customRole,
  salary:           s.salary,
  qualification:    s.qualification,
  experienceYears:  s.experienceYears,
  experienceMonths: s.experienceMonths,
  joiningDate:      s.joiningDate,
  status:           s.status,
  isActive:         s.user?.isActive ?? true,
  createdAt:        s.createdAt,
  updatedAt:        s.updatedAt,
});

const assertRoleExists = async (customRoleId: string) => {
  const role = await prisma.customRole.findUnique({ where: { id: customRoleId }, select: { id: true, isActive: true, name: true } });
  if (!role) throw appError('Role not found', 'ROLE_NOT_FOUND', 404);
  if (!role.isActive) throw appError('Role is inactive', 'ROLE_INACTIVE', 400);
  return role;
};

const mapUniqueError = (err: unknown): never => {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const target = String((err.meta as any)?.target ?? '');
    if (target.includes('email'))    throw conflict('Email already registered', 'EMAIL_TAKEN');
    if (target.includes('phone'))    throw conflict('Mobile number already registered', 'PHONE_TAKEN');
    if (target.includes('username')) throw conflict('Username already taken', 'USERNAME_TAKEN');
  }
  throw err;
};

// ── Create a staff member + login account ────────────────────────
export const createStaff = async (
  schoolId: string,
  input: CreateStaffSchema,
): Promise<{ staff: StaffResponse; defaultPassword: string }> => {

  await assertRoleExists(input.customRoleId);

  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) throw conflict('Email already registered', 'EMAIL_TAKEN');
  await assertUsernameAvailable(input.username ?? null);

  const defaultPassword = generateDefaultPassword(input.email);
  const passwordHash    = await hashPassword(defaultPassword);

  const staff = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name:         input.name,
        email:        input.email,
        phone:        input.phone,
        username:     input.username ?? null,
        passwordHash,
        role:         'STAFF',
        customRoleId: input.customRoleId,
        schoolId,
      },
    });

    const staffCount = await tx.staff.count({ where: { schoolId } });
    const employeeId = `STF${String(staffCount + 1).padStart(4, '0')}`;

    return tx.staff.create({
      data: {
        employeeId,
        userId:           user.id,
        name:             input.name,
        email:            input.email,
        phone:            input.phone,
        gender:           input.gender,
        designation:      input.designation,
        customRoleId:     input.customRoleId,
        salary:           input.salary,
        qualification:    input.qualification,
        experienceYears:  input.experienceYears,
        experienceMonths: input.experienceMonths,
        joiningDate:      input.joiningDate,
        schoolId,
      },
      include: STAFF_INCLUDE,
    });
  }).catch(mapUniqueError);

  return { staff: toStaffResponse(staff), defaultPassword };
};

// ── Get a single staff member ─────────────────────────────────────
export const getStaffById = async (schoolId: string, staffId: string): Promise<StaffResponse> => {
  const staff = await prisma.staff.findFirst({ where: { id: staffId, schoolId }, include: STAFF_INCLUDE });
  if (!staff) throw notFound('Staff not found', 'STAFF_NOT_FOUND');
  return toStaffResponse(staff);
};

// ── List staff (paginated, searchable, filterable) ────────────────
export const listStaff = async (schoolId: string, query: ListStaffQuerySchema) => {
  const { page, pageSize, search, designation, customRoleId, status } = query;

  const where: Prisma.StaffWhereInput = {
    schoolId,
    ...(customRoleId  ? { customRoleId }                                            : {}),
    ...(designation   ? { designation: { equals: designation, mode: 'insensitive' } } : {}),
    ...(status        ? { status }                                                    : {}),
    ...(search ? {
      OR: [
        { employeeId:  { contains: search, mode: 'insensitive' } },
        { name:        { contains: search, mode: 'insensitive' } },
        { designation: { contains: search, mode: 'insensitive' } },
      ],
    } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.staff.findMany({
      where,
      include: STAFF_INCLUDE,
      orderBy: { employeeId: 'asc' },
      skip:    (page - 1) * pageSize,
      take:    pageSize,
    }),
    prisma.staff.count({ where }),
  ]);

  return {
    items: items.map(toStaffResponse),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};

// ── Update a staff member (and linked user) ───────────────────────
export const updateStaff = async (
  schoolId: string,
  staffId: string,
  input: UpdateStaffSchema,
): Promise<StaffResponse> => {
  const staff = await prisma.staff.findFirst({ where: { id: staffId, schoolId }, include: { user: { select: { id: true } } } });
  if (!staff) throw notFound('Staff not found', 'STAFF_NOT_FOUND');

  if (input.customRoleId) await assertRoleExists(input.customRoleId);
  if (input.username !== undefined) await assertUsernameAvailable(input.username ?? null, staff.userId ?? undefined);

  const { isActive, username, ...staffFields } = input;

  const userUpdate: Record<string, unknown> = {};
  if (input.name         !== undefined) userUpdate.name         = input.name;
  if (input.email        !== undefined) userUpdate.email        = input.email;
  if (input.phone        !== undefined) userUpdate.phone        = input.phone;
  if (username           !== undefined) userUpdate.username     = username;
  if (input.customRoleId !== undefined) userUpdate.customRoleId = input.customRoleId;
  if (isActive           !== undefined) userUpdate.isActive     = isActive;

  const needsUserUpdate = staff.userId && Object.keys(userUpdate).length > 0;
  const revokeSessions  = staff.userId && (isActive === false || (input.customRoleId !== undefined && input.customRoleId !== staff.customRoleId));

  const [updated] = await prisma.$transaction([
    prisma.staff.update({ where: { id: staffId }, data: staffFields, include: STAFF_INCLUDE }),
    ...(needsUserUpdate ? [prisma.user.update({ where: { id: staff.userId! }, data: userUpdate })] : []),
    ...(revokeSessions  ? [prisma.refreshToken.deleteMany({ where: { userId: staff.userId! } })] : []),
  ]).catch(mapUniqueError);

  return toStaffResponse(updated);
};

// ── Delete a staff member (and deactivate linked user) ────────────
export const deleteStaff = async (schoolId: string, staffId: string): Promise<void> => {
  const staff = await prisma.staff.findFirst({ where: { id: staffId, schoolId }, include: { user: { select: { id: true } } } });
  if (!staff) throw notFound('Staff not found', 'STAFF_NOT_FOUND');

  await prisma.$transaction([
    ...(staff.userId ? [
      prisma.user.update({ where: { id: staff.userId }, data: { isActive: false } }),
      prisma.refreshToken.deleteMany({ where: { userId: staff.userId } }),
    ] : []),
    prisma.staff.delete({ where: { id: staffId } }),
  ]);
};
