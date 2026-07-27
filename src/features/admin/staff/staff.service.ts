import { Prisma, Staff } from '@prisma/client';
import { prisma } from '../../../config/db';
import { CreateStaffSchema, UpdateStaffSchema, ListStaffQuerySchema } from './staff.validation';

const notFound = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 404;
  return err;
};

export interface StaffResponse {
  id:               string;
  employeeId:       string;
  name:             string;
  email:            string | null;
  phone:            string;
  gender:           string;
  designation:      string;
  salary:           number;
  qualification:    string;
  experienceYears:  number;
  experienceMonths: number;
  joiningDate:      Date;
  status:           string;
  createdAt:        Date;
  updatedAt:        Date;
}

const toStaffResponse = (s: Staff): StaffResponse => ({
  id:               s.id,
  employeeId:       s.employeeId,
  name:             s.name,
  email:            s.email,
  phone:            s.phone,
  gender:           s.gender,
  designation:      s.designation,
  salary:           s.salary,
  qualification:    s.qualification,
  experienceYears:  s.experienceYears,
  experienceMonths: s.experienceMonths,
  joiningDate:      s.joiningDate,
  status:           s.status,
  createdAt:        s.createdAt,
  updatedAt:        s.updatedAt,
});

// ── Create a staff member ────────────────────────────────────────
export const createStaff = async (schoolId: string, input: CreateStaffSchema): Promise<StaffResponse> => {
  const staffCount = await prisma.staff.count({ where: { schoolId } });
  const employeeId = `STF${String(staffCount + 1).padStart(4, '0')}`;

  const staff = await prisma.staff.create({
    data: {
      employeeId,
      name:             input.name,
      email:            input.email ?? null,
      phone:            input.phone,
      gender:           input.gender,
      designation:      input.designation,
      salary:           input.salary,
      qualification:    input.qualification,
      experienceYears:  input.experienceYears,
      experienceMonths: input.experienceMonths,
      joiningDate:      input.joiningDate,
      schoolId,
    },
  });

  return toStaffResponse(staff);
};

// ── Get a single staff member ─────────────────────────────────────
export const getStaffById = async (schoolId: string, staffId: string): Promise<StaffResponse> => {
  const staff = await prisma.staff.findFirst({ where: { id: staffId, schoolId } });
  if (!staff) throw notFound('Staff not found', 'STAFF_NOT_FOUND');
  return toStaffResponse(staff);
};

// ── List staff (paginated, searchable, filterable) ────────────────
export const listStaff = async (schoolId: string, query: ListStaffQuerySchema) => {
  const { page, pageSize, search, designation, status } = query;

  const where: Prisma.StaffWhereInput = {
    schoolId,
    ...(designation ? { designation: { equals: designation, mode: 'insensitive' } } : {}),
    ...(status ? { status } : {}),
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

// ── Update a staff member ─────────────────────────────────────────
export const updateStaff = async (
  schoolId: string,
  staffId: string,
  input: UpdateStaffSchema,
): Promise<StaffResponse> => {
  const staff = await prisma.staff.findFirst({ where: { id: staffId, schoolId } });
  if (!staff) throw notFound('Staff not found', 'STAFF_NOT_FOUND');

  const updated = await prisma.staff.update({ where: { id: staffId }, data: input });
  return toStaffResponse(updated);
};

// ── Delete a staff member ─────────────────────────────────────────
export const deleteStaff = async (schoolId: string, staffId: string): Promise<void> => {
  const staff = await prisma.staff.findFirst({ where: { id: staffId, schoolId } });
  if (!staff) throw notFound('Staff not found', 'STAFF_NOT_FOUND');

  await prisma.staff.delete({ where: { id: staffId } });
};
