import { z } from 'zod';
import { Gender, AdmissionStatus } from '@prisma/client';

export const createAdmissionSchema = z.object({
  studentName:       z.string().min(2).max(100),
  gender:            z.nativeEnum(Gender),
  dateOfBirth:       z.coerce.date({ errorMap: () => ({ message: 'Invalid date of birth' }) }),
  classId:           z.string().uuid('Invalid class id'),
  parentName:        z.string().min(2).max(100),
  parentPhone:       z.string().min(10).max(15),
  parentEmail:       z.string().email('Invalid parent email'),
  previousSchool:    z.string().max(200).optional(),
  address:           z.string().max(300).optional(),
  bloodGroup:        z.string().max(10).optional(),
  academicSessionId: z.string().uuid().optional(),
  status:            z.nativeEnum(AdmissionStatus).optional(),
  remarks:           z.string().max(500).optional(),
});

export const updateAdmissionSchema = z.object({
  studentName:       z.string().min(2).max(100).optional(),
  gender:            z.nativeEnum(Gender).optional(),
  dateOfBirth:       z.coerce.date().optional(),
  classId:           z.string().uuid().optional(),
  parentName:        z.string().min(2).max(100).optional(),
  parentPhone:       z.string().min(10).max(15).optional(),
  parentEmail:       z.string().email().optional(),
  previousSchool:    z.string().max(200).optional(),
  address:           z.string().max(300).optional(),
  bloodGroup:        z.string().max(10).optional(),
  academicSessionId: z.string().uuid().optional(),
  status:            z.nativeEnum(AdmissionStatus).optional(),
  remarks:           z.string().max(500).optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'At least one field is required' });

export const listAdmissionsQuerySchema = z.object({
  page:              z.coerce.number().int().positive().default(1),
  pageSize:          z.coerce.number().int().positive().max(100).default(15),
  search:            z.string().trim().min(1).optional(),
  status:            z.nativeEnum(AdmissionStatus).optional(),
  classId:           z.string().uuid().optional(),
  academicSessionId: z.string().uuid().optional(),
});

// For enrolling — requires sectionId and rollNo to place the student
export const enrollAdmissionSchema = z.object({
  sectionId: z.string().uuid('Invalid section id'),
  rollNo:    z.coerce.number().int().positive('Roll number must be a positive integer'),
});

export type CreateAdmissionSchema     = z.infer<typeof createAdmissionSchema>;
export type UpdateAdmissionSchema     = z.infer<typeof updateAdmissionSchema>;
export type ListAdmissionsQuerySchema = z.infer<typeof listAdmissionsQuerySchema>;
export type EnrollAdmissionSchema     = z.infer<typeof enrollAdmissionSchema>;
