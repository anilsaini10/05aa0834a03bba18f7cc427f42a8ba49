import { z } from 'zod';

export const attendanceDateQuerySchema = z.object({
  date: z.coerce.date({ errorMap: () => ({ message: 'Invalid date' }) }).optional(),
});

export const listClassStudentsAttendanceQuerySchema = z.object({
  date:     z.coerce.date({ errorMap: () => ({ message: 'Invalid date' }) }).optional(),
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search:   z.string().trim().min(1).optional(),
});

export type AttendanceDateQuerySchema             = z.infer<typeof attendanceDateQuerySchema>;
export type ListClassStudentsAttendanceQuerySchema = z.infer<typeof listClassStudentsAttendanceQuerySchema>;
