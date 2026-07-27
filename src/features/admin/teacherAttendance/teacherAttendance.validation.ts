import { z } from 'zod';
import { AttendanceStatus } from '@prisma/client';

const attendanceRecordInput = z.object({
  teacherId: z.string().uuid('Invalid teacher id'),
  status:    z.nativeEnum(AttendanceStatus),
});

export const markTeacherAttendanceSchema = z.object({
  date:    z.coerce.date({ errorMap: () => ({ message: 'Invalid date' }) }),
  records: z.array(attendanceRecordInput).min(1, 'At least one record is required'),
});

export const listTeacherAttendanceQuerySchema = z.object({
  page:      z.coerce.number().int().positive().default(1),
  pageSize:  z.coerce.number().int().positive().max(100).default(15),
  date:      z.coerce.date({ errorMap: () => ({ message: 'Invalid date' }) }).optional(),
  from:      z.coerce.date({ errorMap: () => ({ message: 'Invalid from date' }) }).optional(),
  to:        z.coerce.date({ errorMap: () => ({ message: 'Invalid to date' }) }).optional(),
  status:    z.nativeEnum(AttendanceStatus).optional(),
  teacherId: z.string().uuid('Invalid teacher id').optional(),
})
  .refine(data => !data.from || !data.to || data.to >= data.from, {
    message: 'to must be on or after from', path: ['to'],
  })
  .refine(data => !(data.date && (data.from || data.to)), {
    message: 'Use either date or from/to range, not both', path: ['date'],
  });

export const updateTeacherAttendanceSchema = z.object({
  status: z.nativeEnum(AttendanceStatus),
});

export type MarkTeacherAttendanceSchema      = z.infer<typeof markTeacherAttendanceSchema>;
export type ListTeacherAttendanceQuerySchema = z.infer<typeof listTeacherAttendanceQuerySchema>;
export type UpdateTeacherAttendanceSchema    = z.infer<typeof updateTeacherAttendanceSchema>;
