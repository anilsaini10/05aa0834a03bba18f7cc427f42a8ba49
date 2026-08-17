import { z } from 'zod';
import { Board, SchoolType } from '@prisma/client';

// city/contactEmail are required on create; every other detail field is
// optional. `admin`, if present, also creates the school's first ADMIN
// in the same call (same default-password convention as createAdmin).
export const createSchoolSchema = z.object({
  name: z.string().min(2, 'School name must be at least 2 characters').max(150),
  code: z.string().max(20).optional(),

  board:           z.nativeEnum(Board).optional(),
  schoolType:      z.nativeEnum(SchoolType).optional(),
  medium:          z.string().max(50).optional(),
  establishedYear: z.coerce.number().int().min(1800).max(2100).optional(),
  logoUrl:         z.string().url('Invalid logo URL').optional(),

  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city:         z.string().max(100),
  state:        z.string().max(100).optional(),
  pincode:      z.string().max(20).optional(),
  country:      z.string().max(100).optional(),
  latitude:     z.coerce.number().min(-90).max(90).optional(),
  longitude:    z.coerce.number().min(-180).max(180).optional(),

  contactEmail:   z.string().email('Invalid contact email'),
  contactPhone:   z.string().min(10).max(15).optional(),
  alternatePhone: z.string().min(10).max(15).optional(),
  websiteUrl:     z.string().url('Invalid website URL').optional(),

  principalName:  z.string().max(100).optional(),
  principalEmail: z.string().email('Invalid principal email').optional(),
  principalPhone: z.string().min(10).max(15).optional(),

  totalStudentsApprox:       z.coerce.number().int().min(0).optional(),
  totalStaffApprox:          z.coerce.number().int().min(0).optional(),
  classesFrom:               z.string().max(20).optional(),
  classesTo:                 z.string().max(20).optional(),
  academicSessionStartMonth: z.coerce.number().int().min(1).max(12).optional(),

  admin: z.object({
    name:  z.string().min(2, 'Name must be at least 2 characters').max(100),
    email: z.string().email('Invalid email address'),
    phone: z.string().min(10).max(15).optional(),
  }).optional(),
});

// Same detail fields, all optional — code is deliberately excluded,
// it's immutable once assigned.
export const updateSchoolSchema = z.object({
  name: z.string().min(2, 'School name must be at least 2 characters').max(150).optional(),

  board:           z.nativeEnum(Board).optional(),
  schoolType:      z.nativeEnum(SchoolType).optional(),
  medium:          z.string().max(50).optional(),
  establishedYear: z.coerce.number().int().min(1800).max(2100).optional(),
  logoUrl:         z.string().url('Invalid logo URL').optional(),

  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city:         z.string().max(100).optional(),
  state:        z.string().max(100).optional(),
  pincode:      z.string().max(20).optional(),
  country:      z.string().max(100).optional(),
  latitude:     z.coerce.number().min(-90).max(90).optional(),
  longitude:    z.coerce.number().min(-180).max(180).optional(),

  contactEmail:   z.string().email('Invalid contact email').optional(),
  contactPhone:   z.string().min(10).max(15).optional(),
  alternatePhone: z.string().min(10).max(15).optional(),
  websiteUrl:     z.string().url('Invalid website URL').optional(),

  principalName:  z.string().max(100).optional(),
  principalEmail: z.string().email('Invalid principal email').optional(),
  principalPhone: z.string().min(10).max(15).optional(),

  totalStudentsApprox:       z.coerce.number().int().min(0).optional(),
  totalStaffApprox:          z.coerce.number().int().min(0).optional(),
  classesFrom:               z.string().max(20).optional(),
  classesTo:                 z.string().max(20).optional(),
  academicSessionStartMonth: z.coerce.number().int().min(1).max(12).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const createAdminSchema = z.object({
  name:  z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Invalid email address'),
  phone: z.string().min(10).max(15).optional(),
});

export const updateAdminSchema = z.object({
  name:  z.string().min(2, 'Name must be at least 2 characters').max(100).optional(),
  email: z.string().email('Invalid email address').optional(),
  phone: z.string().min(10).max(15).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const updateAdminStatusSchema = z.object({
  isActive: z.boolean(),
});

export const listSchoolsQuerySchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search:   z.string().trim().min(1).optional(),
});

// GET /super-admin/admins — every admin across every school, optionally
// narrowed to one school.
export const listAllAdminsQuerySchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search:   z.string().trim().min(1).optional(),
  schoolId: z.string().uuid('Invalid school id').optional(),
});

export type CreateSchoolSchema      = z.infer<typeof createSchoolSchema>;
export type UpdateSchoolSchema      = z.infer<typeof updateSchoolSchema>;
export type CreateAdminSchema       = z.infer<typeof createAdminSchema>;
export type UpdateAdminSchema       = z.infer<typeof updateAdminSchema>;
export type UpdateAdminStatusSchema = z.infer<typeof updateAdminStatusSchema>;
export type ListSchoolsQuerySchema  = z.infer<typeof listSchoolsQuerySchema>;
export type ListAllAdminsQuerySchema = z.infer<typeof listAllAdminsQuerySchema>;
