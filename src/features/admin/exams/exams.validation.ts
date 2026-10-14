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

// ── Exam schedule (date sheet) ───────────────────────────────
const timeString = z.string().regex(
  /^([01]\d|2[0-3]):[0-5]\d$/,
  'Time must be in 24-hour HH:MM format (e.g. "09:00")',
);

// Date-only "YYYY-MM-DD" → midnight UTC, matching the @db.Date column.
// A plain string (not z.coerce.date) so a client's timezone can't shift
// the paper onto the previous/next day.
const dateOnlyString = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .transform((value, ctx) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid date' });
      return z.NEVER;
    }
    return date;
  });

const roomNoField = z.string().trim().min(1, 'roomNo cannot be empty').max(50);

export const examPaperInput = z.object({
  classId:       z.string().uuid('Invalid class id'),
  subjectId:     z.string().uuid('Invalid subject id'),
  date:          dateOnlyString,
  startTime:     timeString,
  endTime:       timeString,
  // Defaults to the class's maxMarks on this exam (ExamClass.maxMarks).
  maxMarks:      z.coerce.number().positive('maxMarks must be a positive number').optional(),
  roomNo:        roomNoField.optional(),
  invigilatorId: z.string().uuid('Invalid invigilator id').optional(),
}).refine(data => data.endTime > data.startTime, {
  message: 'endTime must be after startTime', path: ['endTime'],
});

export const createExamScheduleSchema = examPaperInput;

export const bulkCreateExamScheduleSchema = z.object({
  papers: z.array(examPaperInput)
    .min(1, 'At least one paper is required')
    .max(100, 'At most 100 papers per request'),
});

// roomNo / invigilatorId accept null to clear them.
export const updateExamScheduleSchema = z.object({
  classId:       z.string().uuid('Invalid class id').optional(),
  subjectId:     z.string().uuid('Invalid subject id').optional(),
  date:          dateOnlyString.optional(),
  startTime:     timeString.optional(),
  endTime:       timeString.optional(),
  maxMarks:      z.coerce.number().positive('maxMarks must be a positive number').optional(),
  roomNo:        roomNoField.nullable().optional(),
  invigilatorId: z.string().uuid('Invalid invigilator id').nullable().optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const listExamScheduleQuerySchema = z.object({
  classId: z.string().uuid('Invalid class id').optional(),
});

// ── Per-subject marks (shared by admin + teacher endpoints) ──
export const listPaperStudentsQuerySchema = z.object({
  sectionId: z.string().uuid('Invalid section id').optional(),
  search:    z.string().trim().min(1).optional(),
});

const examMarkEntry = z.object({
  studentId:     z.string().uuid('Invalid student id'),
  status:        z.nativeEnum(ResultStatus).default('GRADED'),
  marksObtained: z.coerce.number().min(0, 'marksObtained cannot be negative').nullable().optional(),
  grade:         z.string().trim().max(10).nullable().optional(),
  remarks:       z.string().trim().max(500).nullable().optional(),
})
  .refine(m => m.status !== 'GRADED' || (m.marksObtained !== undefined && m.marksObtained !== null), {
    message: 'marksObtained is required when status is GRADED', path: ['marksObtained'],
  })
  .refine(m => m.status === 'GRADED' || m.marksObtained === undefined || m.marksObtained === null, {
    message: 'marksObtained must be empty when status is ABSENT or PENDING', path: ['marksObtained'],
  });

export const saveExamMarksSchema = z.object({
  marks: z.array(examMarkEntry)
    .min(1, 'At least one entry is required')
    .max(300, 'At most 300 entries per request')
    .refine(list => new Set(list.map(m => m.studentId)).size === list.length, {
      message: 'Each student can appear only once',
    }),
});

export type CreateExamSchema                 = z.infer<typeof createExamSchema>;
export type UpdateExamSchema                 = z.infer<typeof updateExamSchema>;
export type ListExamsQuerySchema             = z.infer<typeof listExamsQuerySchema>;
export type AddExamClassSchema               = z.infer<typeof addExamClassSchema>;
export type ListExamClassStudentsQuerySchema = z.infer<typeof listExamClassStudentsQuerySchema>;
export type CreateExamResultSchema           = z.infer<typeof createExamResultSchema>;
export type UpdateExamResultSchema           = z.infer<typeof updateExamResultSchema>;
export type CreateExamScheduleSchema         = z.infer<typeof createExamScheduleSchema>;
export type BulkCreateExamScheduleSchema     = z.infer<typeof bulkCreateExamScheduleSchema>;
export type UpdateExamScheduleSchema         = z.infer<typeof updateExamScheduleSchema>;
export type ListExamScheduleQuerySchema      = z.infer<typeof listExamScheduleQuerySchema>;
export type ListPaperStudentsQuerySchema     = z.infer<typeof listPaperStudentsQuerySchema>;
export type SaveExamMarksSchema              = z.infer<typeof saveExamMarksSchema>;
