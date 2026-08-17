import { Prisma, School, User } from '@prisma/client';
import { prisma } from '../../config/db';
import { hashPassword } from '../../shared/utils/hash';
import { generateDefaultPassword } from '../../shared/utils/defaultPassword';
import {
  CreateSchoolSchema,
  UpdateSchoolSchema,
  CreateAdminSchema,
  UpdateAdminSchema,
  ListSchoolsQuerySchema,
  ListAllAdminsQuerySchema,
} from './superAdmin.validation';

export interface SchoolResponse {
  id:   string;
  name: string;
  code: string | null;

  board:           string | null;
  schoolType:      string | null;
  medium:          string | null;
  establishedYear: number | null;
  logoUrl:         string | null;

  addressLine1: string | null;
  addressLine2: string | null;
  city:         string | null;
  state:        string | null;
  pincode:      string | null;
  country:      string | null;
  latitude:     number | null;
  longitude:    number | null;

  contactEmail:   string | null;
  contactPhone:   string | null;
  alternatePhone: string | null;
  websiteUrl:     string | null;

  principalName:  string | null;
  principalEmail: string | null;
  principalPhone: string | null;

  totalStudentsApprox:       number | null;
  totalStaffApprox:          number | null;
  classesFrom:               string | null;
  classesTo:                 string | null;
  academicSessionStartMonth: number | null;

  createdAt: Date;
}

export interface AdminResponse {
  id:        string;
  name:      string;
  email:     string;
  phone:     string | null;
  schoolId:  string;
  isActive:  boolean;
  createdAt: Date;
}

export interface AdminWithSchoolResponse extends AdminResponse {
  schoolName: string;
  schoolCode: string | null;
}

const notFound = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 404;
  return err;
};

const conflict = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 409;
  return err;
};

const toSchoolResponse = (s: School): SchoolResponse => ({
  id:   s.id,
  name: s.name,
  code: s.code,

  board:           s.board,
  schoolType:      s.schoolType,
  medium:          s.medium,
  establishedYear: s.establishedYear,
  logoUrl:         s.logoUrl,

  addressLine1: s.addressLine1,
  addressLine2: s.addressLine2,
  city:         s.city,
  state:        s.state,
  pincode:      s.pincode,
  country:      s.country,
  latitude:     s.latitude,
  longitude:    s.longitude,

  contactEmail:   s.contactEmail,
  contactPhone:   s.contactPhone,
  alternatePhone: s.alternatePhone,
  websiteUrl:     s.websiteUrl,

  principalName:  s.principalName,
  principalEmail: s.principalEmail,
  principalPhone: s.principalPhone,

  totalStudentsApprox:       s.totalStudentsApprox,
  totalStaffApprox:          s.totalStaffApprox,
  classesFrom:               s.classesFrom,
  classesTo:                 s.classesTo,
  academicSessionStartMonth: s.academicSessionStartMonth,

  createdAt: s.createdAt,
});

// ── Auto-generate a human-friendly school code, e.g. "SCH0001" ────
// Same convention as Teacher.employeeId (teachers.service.ts).
const generateSchoolCode = async (): Promise<string> => {
  const count = await prisma.school.count();
  return `SCH${String(count + 1).padStart(4, '0')}`;
};

const toAdminResponse = (u: User): AdminResponse => ({
  id:        u.id,
  name:      u.name,
  email:     u.email,
  phone:     u.phone,
  schoolId:  u.schoolId as string,
  isActive:  u.isActive,
  createdAt: u.createdAt,
});

// ── Create a school — optionally also its first admin in one call ──
// `admin`, if provided, gets the same fixed default password as
// createAdminForSchool below.
export const createSchool = async (
  input: CreateSchoolSchema,
): Promise<{ school: SchoolResponse; admin?: AdminResponse; defaultPassword?: string }> => {
  const { admin: adminInput, ...schoolData } = input;
  const code = schoolData.code ?? await generateSchoolCode();

  let adminPasswordHash: string | undefined;
  let defaultPassword:   string | undefined;

  if (adminInput) {
    const existingUser = await prisma.user.findUnique({ where: { email: adminInput.email } });
    if (existingUser) throw conflict('Email already registered', 'EMAIL_TAKEN');

    defaultPassword   = generateDefaultPassword(adminInput.email);
    adminPasswordHash = await hashPassword(defaultPassword);
  }

  const result = await prisma.$transaction(async (tx) => {
    const school = await tx.school.create({ data: { ...schoolData, code } });

    if (!adminInput) return { school, admin: null };

    const admin = await tx.user.create({
      data: {
        name:  adminInput.name,
        email: adminInput.email,
        phone: adminInput.phone,
        passwordHash: adminPasswordHash!,
        role:  'ADMIN',
        schoolId: school.id,
      },
    });

    return { school, admin };
  });

  return {
    school: toSchoolResponse(result.school),
    ...(result.admin ? { admin: toAdminResponse(result.admin), defaultPassword } : {}),
  };
};

// ── List schools (paginated, searchable) ─────────────────────────
export const listSchools = async (query: ListSchoolsQuerySchema) => {
  const { page, pageSize, search } = query;

  const where: Prisma.SchoolWhereInput = {
    ...(search ? {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
      ],
    } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.school.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip:    (page - 1) * pageSize,
      take:    pageSize,
    }),
    prisma.school.count({ where }),
  ]);

  return {
    items: items.map(toSchoolResponse),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};

// ── Get a single school ───────────────────────────────────────────
export const getSchoolById = async (schoolId: string): Promise<SchoolResponse> => {
  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school) throw notFound('School not found', 'SCHOOL_NOT_FOUND');
  return toSchoolResponse(school);
};

// ── Update a school ────────────────────────────────────────────────
export const updateSchool = async (
  schoolId: string,
  input: UpdateSchoolSchema,
): Promise<SchoolResponse> => {
  const existing = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!existing) throw notFound('School not found', 'SCHOOL_NOT_FOUND');

  const school = await prisma.school.update({ where: { id: schoolId }, data: input });
  return toSchoolResponse(school);
};

// ── Create an admin user under a school ───────────────────────────
// Default password is fixed (see generateDefaultPassword) — same
// convention as teacher/student account creation.
export const createAdminForSchool = async (
  schoolId: string,
  input: CreateAdminSchema,
): Promise<{ admin: AdminResponse; defaultPassword: string }> => {
  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school) throw notFound('School not found', 'SCHOOL_NOT_FOUND');

  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) throw conflict('Email already registered', 'EMAIL_TAKEN');

  const defaultPassword = generateDefaultPassword(input.email);
  const passwordHash    = await hashPassword(defaultPassword);

  const admin = await prisma.user.create({
    data: {
      name:  input.name,
      email: input.email,
      phone: input.phone,
      passwordHash,
      role:  'ADMIN',
      schoolId,
    },
  });

  return { admin: toAdminResponse(admin), defaultPassword };
};

const findAdminInSchool = async (schoolId: string, adminId: string): Promise<User> => {
  const admin = await prisma.user.findFirst({ where: { id: adminId, schoolId, role: 'ADMIN' } });
  if (!admin) throw notFound('Admin not found', 'ADMIN_NOT_FOUND');
  return admin;
};

// ── Update an admin's profile ─────────────────────────────────────
export const updateAdmin = async (
  schoolId: string,
  adminId: string,
  input: UpdateAdminSchema,
): Promise<AdminResponse> => {
  const admin = await findAdminInSchool(schoolId, adminId);

  if (input.email && input.email !== admin.email) {
    const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
    if (existingUser) throw conflict('Email already registered', 'EMAIL_TAKEN');
  }

  const updated = await prisma.user.update({ where: { id: adminId }, data: input });
  return toAdminResponse(updated);
};

// ── Soft delete / reactivate an admin ─────────────────────────────
// Never hard-deletes — an admin may already have created announcements,
// events, exams, etc. (all FK-restricted to User), so deleting the row
// would either fail outright or silently break that history. isActive
// already blocks login (auth.service) and token refresh; also revoke
// existing refresh tokens so a deactivation takes effect immediately
// instead of waiting for the current session to expire on its own.
export const setAdminStatus = async (
  schoolId: string,
  adminId: string,
  isActive: boolean,
): Promise<AdminResponse> => {
  const admin = await findAdminInSchool(schoolId, adminId);

  const [updated] = await prisma.$transaction([
    prisma.user.update({ where: { id: adminId }, data: { isActive } }),
    prisma.refreshToken.deleteMany({ where: { userId: adminId } }),
  ]);

  return toAdminResponse(updated);
};

// ── List admins of a school ───────────────────────────────────────
export const listAdminsForSchool = async (schoolId: string): Promise<AdminResponse[]> => {
  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school) throw notFound('School not found', 'SCHOOL_NOT_FOUND');

  const admins = await prisma.user.findMany({
    where:   { schoolId, role: 'ADMIN' },
    orderBy: { createdAt: 'asc' },
  });

  return admins.map(toAdminResponse);
};

// ── List every admin across every school (paginated, searchable,
//    optionally narrowed to one school) ───────────────────────────
export const listAllAdmins = async (query: ListAllAdminsQuerySchema) => {
  const { page, pageSize, search, schoolId } = query;

  const where: Prisma.UserWhereInput = {
    role: 'ADMIN',
    ...(schoolId ? { schoolId } : {}),
    ...(search ? {
      OR: [
        { name:  { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ],
    } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: { school: { select: { name: true, code: true } } },
      orderBy: { createdAt: 'desc' },
      skip:    (page - 1) * pageSize,
      take:    pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    items: items.map((u): AdminWithSchoolResponse => ({
      ...toAdminResponse(u),
      schoolName: u.school?.name ?? '',
      schoolCode: u.school?.code ?? null,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};
