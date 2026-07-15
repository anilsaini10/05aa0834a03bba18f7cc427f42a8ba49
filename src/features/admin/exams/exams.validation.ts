import { z } from 'zod';
import { ResultStatus } from '@prisma/client';

// ── Exam ──────────────────────────────────────────────────────
export const examClassInput = z.object({
  classId:  z.string().uuid('Invalid class id'),
  maxMarks: z.coerce.number().positive('maxMarks must be a positive number'),
});

export const createExamSchema = z.object({
  title:       z.string().min(2, 'Title must be at least 2 characters').max(200),
  description: z.string().max(2000).optional(),
  startDate:   z.coerce.date({ errorMap: () => ({ message: 'Invalid start date' }) }).optional(),
  endDate:     z.coerce.date({ errorMap: () => ({ message: 'Invalid end date' }) }).optional(),
  classes:     z.array(examClassInput).min(1, 'At least one class is required'),
}).refine(
  data => !data.startDate || !data.endDate || data.endDate >= data.startDate,
  { message: 'endDate must be on or after startDate', path: ['endDate'] },
);

export const updateExamSchema = z.object({
  title:       z.string().min(2, 'Title must be at least 2 characters').max(200).optional(),
  description: z.string().max(2000).optional(),
  startDate:   z.coerce.date({ errorMap: () => ({ message: 'Invalid start date' }) }).optional(),
  endDate:     z.coerce.date({ errorMap: () => ({ message: 'Invalid end date' }) }).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const listExamsQuerySchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(15),
  search:   z.string().trim().min(1).optional(),
});

// ── Exam ↔ Class assignment ──────────────────────────────────
export const addExamClassSchema = examClassInput;

// ── Students-in-exam-class listing ───────────────────────────
export const listExamClassStudentsQuerySchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(15),
  search:   z.string().trim().min(1).optional(),
});

// ── Exam results ──────────────────────────────────────────────
export const createExamResultSchema = z.object({
  studentId:     z.string().uuid('Invalid student id'),
  marksObtained: z.coerce.number().min(0, 'marksObtained cannot be negative').optional(),
  grade:         z.string().max(10).optional(),
  remarks:       z.string().max(500).optional(),
  status:        z.nativeEnum(ResultStatus).default('PENDING'),
});

export const updateExamResultSchema = z.object({
  marksObtained: z.coerce.number().min(0, 'marksObtained cannot be negative').optional(),
  grade:         z.string().max(10).optional(),
  remarks:       z.string().max(500).optional(),
  status:        z.nativeEnum(ResultStatus).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });

export type CreateExamSchema                 = z.infer<typeof createExamSchema>;
export type UpdateExamSchema                 = z.infer<typeof updateExamSchema>;
export type ListExamsQuerySchema             = z.infer<typeof listExamsQuerySchema>;
export type AddExamClassSchema               = z.infer<typeof addExamClassSchema>;
export type ListExamClassStudentsQuerySchema = z.infer<typeof listExamClassStudentsQuerySchema>;
export type CreateExamResultSchema           = z.infer<typeof createExamResultSchema>;
export type UpdateExamResultSchema           = z.infer<typeof updateExamResultSchema>;
