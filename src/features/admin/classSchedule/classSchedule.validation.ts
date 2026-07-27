import { z } from 'zod';
import { DayOfWeek, ScheduleType } from '@prisma/client';

const timeString = z.string().regex(
  /^([01]\d|2[0-3]):[0-5]\d$/,
  'Time must be in 24-hour HH:MM format (e.g. "09:00")',
);

export const createScheduleSchema = z.object({
  classId:   z.string().uuid('Invalid class id'),
  sectionId: z.string().uuid('Invalid section id'),
  day:       z.nativeEnum(DayOfWeek),
  type:      z.nativeEnum(ScheduleType),
  periodNo:  z.coerce.number().int().positive('periodNo must be a positive integer'),
  subjectId: z.string().uuid('Invalid subject id').optional(),
  teacherId: z.string().uuid('Invalid teacher id').optional(),
  roomNo:    z.string().max(50).optional(),
  title:     z.string().max(100).optional(),
  startTime: timeString,
  endTime:   timeString,
})
  .refine(data => data.endTime > data.startTime, {
    message: 'endTime must be after startTime', path: ['endTime'],
  })
  .refine(data => data.type !== 'CLASS_PERIOD' || (data.subjectId && data.teacherId), {
    message: 'subjectId and teacherId are required for a CLASS_PERIOD', path: ['subjectId'],
  })
  .refine(data => data.type !== 'BREAK' || (!data.subjectId && !data.teacherId), {
    message: 'BREAK entries cannot have a subjectId/teacherId', path: ['type'],
  })
  .refine(data => data.type !== 'BREAK' || (!!data.title && data.title.trim().length > 0), {
    message: 'title is required for BREAK entries (e.g. "Lunch Break")', path: ['title'],
  });

export const updateScheduleSchema = z.object({
  day:       z.nativeEnum(DayOfWeek).optional(),
  periodNo:  z.coerce.number().int().positive('periodNo must be a positive integer').optional(),
  subjectId: z.string().uuid('Invalid subject id').optional(),
  teacherId: z.string().uuid('Invalid teacher id').optional(),
  roomNo:    z.string().max(50).optional(),
  title:     z.string().max(100).optional(),
  startTime: timeString.optional(),
  endTime:   timeString.optional(),
})
  .refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' })
  .refine(data => !data.startTime || !data.endTime || data.endTime > data.startTime, {
    message: 'endTime must be after startTime', path: ['endTime'],
  });

export const listScheduleQuerySchema = z.object({
  classId:   z.string().uuid('Invalid class id').optional(),
  sectionId: z.string().uuid('Invalid section id').optional(),
  day:       z.nativeEnum(DayOfWeek).optional(),
  teacherId: z.string().uuid('Invalid teacher id').optional(),
});

export type CreateScheduleSchema     = z.infer<typeof createScheduleSchema>;
export type UpdateScheduleSchema     = z.infer<typeof updateScheduleSchema>;
export type ListScheduleQuerySchema  = z.infer<typeof listScheduleQuerySchema>;
