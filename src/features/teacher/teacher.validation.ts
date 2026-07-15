import { z } from 'zod';
import { AttendanceStatus, HomeworkType } from '@prisma/client';

export const updateProfileSchema = z.object({
  name:  z.string().min(2, 'Name must be at least 2 characters').max(100).optional(),
  phone: z.string().min(10).max(15).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const resetPasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword:     z.string().min(8, 'New password must be at least 8 characters').max(100),
});

export const listMyStudentsQuerySchema = z.object({
  classId:   z.string().uuid('classId is required'),
  sectionId: z.string().uuid('Invalid section id').optional(),
  page:      z.coerce.number().int().positive().default(1),
  pageSize:  z.coerce.number().int().positive().max(100).default(15),
  search:    z.string().trim().min(1).optional(),
});

export const listMyAnnouncementsQuerySchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(15),
  search:   z.string().trim().min(1).optional(),
});

// ── Attendance ──────────────────────────────────────────────────
export const getSectionAttendanceQuerySchema = z.object({
  sectionId: z.string().uuid('Invalid section id'),
  date:      z.coerce.date({ errorMap: () => ({ message: 'Invalid date' }) }).optional(),
});

const attendanceRecordInput = z.object({
  studentId: z.string().uuid('Invalid student id'),
  status:    z.nativeEnum(AttendanceStatus),
});

export const markAttendanceSchema = z.object({
  sectionId: z.string().uuid('Invalid section id'),
  date:      z.coerce.date({ errorMap: () => ({ message: 'Invalid date' }) }),
  records:   z.array(attendanceRecordInput).min(1, 'At least one record is required'),
});

export const studentAttendanceHistoryQuerySchema = z.object({
  from: z.coerce.date({ errorMap: () => ({ message: 'Invalid from date' }) }).optional(),
  to:   z.coerce.date({ errorMap: () => ({ message: 'Invalid to date' }) }).optional(),
}).refine(
  data => !data.from || !data.to || data.to >= data.from,
  { message: 'to must be on or after from', path: ['to'] },
);

export const updateAttendanceRecordSchema = z.object({
  status: z.nativeEnum(AttendanceStatus),
});

// ── Homework ──────────────────────────────────────────────────
export const createHomeworkSchema = z.object({
  classId:     z.string().uuid('Invalid class id'),
  sectionId:   z.string().uuid('Invalid section id'),
  subjectId:   z.string().uuid('Invalid subject id'),
  title:       z.string().min(2, 'Title must be at least 2 characters').max(200),
  description: z.string().max(2000).optional(),
  type:        z.nativeEnum(HomeworkType).default('ASSIGNMENT'),
  dueDate:     z.coerce.date({ errorMap: () => ({ message: 'Invalid due date' }) }),
});

export const updateHomeworkSchema = z.object({
  title:       z.string().min(2, 'Title must be at least 2 characters').max(200).optional(),
  description: z.string().max(2000).optional(),
  type:        z.nativeEnum(HomeworkType).optional(),
  dueDate:     z.coerce.date({ errorMap: () => ({ message: 'Invalid due date' }) }).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const listMyHomeworkQuerySchema = z.object({
  page:      z.coerce.number().int().positive().default(1),
  pageSize:  z.coerce.number().int().positive().max(100).default(15),
  search:    z.string().trim().min(1).optional(),
  classId:   z.string().uuid('Invalid class id').optional(),
  sectionId: z.string().uuid('Invalid section id').optional(),
  subjectId: z.string().uuid('Invalid subject id').optional(),
});

export type UpdateProfileSchema                  = z.infer<typeof updateProfileSchema>;
export type ResetPasswordSchema                  = z.infer<typeof resetPasswordSchema>;
export type ListMyStudentsQuerySchema             = z.infer<typeof listMyStudentsQuerySchema>;
export type ListMyAnnouncementsQuerySchema        = z.infer<typeof listMyAnnouncementsQuerySchema>;
export type GetSectionAttendanceQuerySchema       = z.infer<typeof getSectionAttendanceQuerySchema>;
export type MarkAttendanceSchema                  = z.infer<typeof markAttendanceSchema>;
export type StudentAttendanceHistoryQuerySchema   = z.infer<typeof studentAttendanceHistoryQuerySchema>;
export type UpdateAttendanceRecordSchema          = z.infer<typeof updateAttendanceRecordSchema>;
export type CreateHomeworkSchema                  = z.infer<typeof createHomeworkSchema>;
export type UpdateHomeworkSchema                  = z.infer<typeof updateHomeworkSchema>;
export type ListMyHomeworkQuerySchema              = z.infer<typeof listMyHomeworkQuerySchema>;
