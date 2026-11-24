import { prisma } from '../../config/db';
import { Prisma } from '@prisma/client';

// ── GET /api/public/schools — Search schools with summary ───────
export const listSchools = async (opts: {
  search?: string;
  city?: string;
  board?: string;
  page: number;
  limit: number;
}) => {
  const where: Prisma.SchoolWhereInput = {};

  if (opts.search) {
    where.name = { contains: opts.search, mode: 'insensitive' };
  }
  if (opts.city) {
    where.city = { contains: opts.city, mode: 'insensitive' };
  }
  if (opts.board) {
    where.board = opts.board as any;
  }

  const skip = (opts.page - 1) * opts.limit;

  const [schools, total] = await Promise.all([
    prisma.school.findMany({
      where,
      select: {
        id: true,
        name: true,
        code: true,
        logoUrl: true,
        city: true,
        state: true,
        board: true,
        schoolType: true,
        medium: true,
        establishedYear: true,
        principalName: true,
        contactEmail: true,
        contactPhone: true,
        _count: {
          select: {
            students: { where: { status: 'ACTIVE' } },
            teachers: { where: { status: 'ACTIVE' } },
          },
        },
      },
      orderBy: { name: 'asc' },
      skip,
      take: opts.limit,
    }),
    prisma.school.count({ where }),
  ]);

  return {
    schools: schools.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      logoUrl: s.logoUrl,
      city: s.city,
      state: s.state,
      board: s.board,
      schoolType: s.schoolType,
      medium: s.medium,
      establishedYear: s.establishedYear,
      principalName: s.principalName,
      contactEmail: s.contactEmail,
      contactPhone: s.contactPhone,
      totalStudents: s._count.students,
      totalTeachers: s._count.teachers,
    })),
    pagination: {
      page: opts.page,
      limit: opts.limit,
      total,
      totalPages: Math.ceil(total / opts.limit),
    },
  };
};

// ── GET /api/public/schools/:schoolId — Full school detail ──────
export const getSchoolDetail = async (schoolId: string) => {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: {
      id: true,
      name: true,
      code: true,
      logoUrl: true,
      board: true,
      schoolType: true,
      medium: true,
      establishedYear: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      pincode: true,
      country: true,
      contactEmail: true,
      contactPhone: true,
      websiteUrl: true,
      principalName: true,
      principalEmail: true,
      principalPhone: true,
      classesFrom: true,
      classesTo: true,
      _count: {
        select: {
          students: { where: { status: 'ACTIVE' } },
          teachers: { where: { status: 'ACTIVE' } },
          staff:    { where: { status: 'ACTIVE' } },
        },
      },
    },
  });

  if (!school) {
    const err = new Error('School not found') as any;
    err.code = 'SCHOOL_NOT_FOUND';
    err.statusCode = 404;
    throw err;
  }

  const leadership = await prisma.staff.findMany({
    where: {
      schoolId,
      status: 'ACTIVE',
      designation: { in: ['Director', 'Vice Principal', 'Vice-Principal'] },
    },
    select: { name: true, designation: true },
  });

  const directorName = leadership.find(
    (s) => s.designation === 'Director',
  )?.name ?? null;

  const vicePrincipalName = leadership.find(
    (s) => s.designation === 'Vice Principal' || s.designation === 'Vice-Principal',
  )?.name ?? null;

  return {
    id: school.id,
    name: school.name,
    code: school.code,
    logoUrl: school.logoUrl,
    board: school.board,
    schoolType: school.schoolType,
    medium: school.medium,
    establishedYear: school.establishedYear,
    address: {
      addressLine1: school.addressLine1,
      addressLine2: school.addressLine2,
      city: school.city,
      state: school.state,
      pincode: school.pincode,
      country: school.country,
    },
    contact: {
      email: school.contactEmail,
      phone: school.contactPhone,
      website: school.websiteUrl,
    },
    leadership: {
      principalName: school.principalName,
      principalEmail: school.principalEmail,
      principalPhone: school.principalPhone,
      directorName,
      vicePrincipalName,
    },
    academics: {
      classesFrom: school.classesFrom,
      classesTo: school.classesTo,
    },
    strength: {
      totalStudents: school._count.students,
      totalTeachers: school._count.teachers,
      totalStaff: school._count.staff,
    },
  };
};

// ── GET /api/public/schools/:schoolId/teachers — Teacher list ───
export const listTeachers = async (
  schoolId: string,
  opts: { page: number; limit: number },
) => {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true },
  });

  if (!school) {
    const err = new Error('School not found') as any;
    err.code = 'SCHOOL_NOT_FOUND';
    err.statusCode = 404;
    throw err;
  }

  const skip = (opts.page - 1) * opts.limit;
  const where: Prisma.TeacherWhereInput = {
    schoolId,
    status: 'ACTIVE',
  };

  const [teachers, total] = await Promise.all([
    prisma.teacher.findMany({
      where,
      select: {
        id: true,
        qualification: true,
        experienceYears: true,
        experienceMonths: true,
        subjectsTaught: true,
        user: {
          select: { name: true, profilePhoto: true },
        },
      },
      orderBy: { user: { name: 'asc' } },
      skip,
      take: opts.limit,
    }),
    prisma.teacher.count({ where }),
  ]);

  return {
    teachers: teachers.map((t) => ({
      id: t.id,
      name: t.user.name,
      profilePhoto: t.user.profilePhoto,
      qualification: t.qualification,
      experienceYears: t.experienceYears,
      experienceMonths: t.experienceMonths,
      subjectsTaught: t.subjectsTaught,
    })),
    pagination: {
      page: opts.page,
      limit: opts.limit,
      total,
      totalPages: Math.ceil(total / opts.limit),
    },
  };
};
