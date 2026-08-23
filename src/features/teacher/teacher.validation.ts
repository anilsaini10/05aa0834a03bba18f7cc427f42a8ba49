import { z } from 'zod';
import { AttendanceStatus, HomeworkType, HomeworkSubmissionStatus, LeaveStatus, EventType } from '@prisma/client';

export const updateProfileSchema = z.object({
  name:  z.string().min(2, 'Name must be at least 2 characters').max(100).optional(),
  phone: z.string().min(10).max(15).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const resetPasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword:     z.string().min(6, 'New password must be at least 6 characters').max(100),
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
  from:     z.coerce.date({ errorMap: () => ({ message: 'Invalid from date' }) }).optional(),
  to:       z.coerce.date({ errorMap: () => ({ message: 'Invalid to date' }) }).optional(),
});

export const listMyEventsQuerySchema = z.object({
  page:      z.coerce.number().int().positive().default(1),
  pageSize:  z.coerce.number().int().positive().max(100).default(15),
  search:    z.string().trim().min(1).optional(),
  eventType: z.nativeEnum(EventType).optional(),
  from:      z.coerce.date({ errorMap: () => ({ message: 'Invalid from date' }) }).optional(),
  to:        z.coerce.date({ errorMap: () => ({ message: 'Invalid to date' }) }).optional(),
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

// ── My own attendance (read-only — Admin marks/corrects it) ──────
export const listMyAttendanceRecordsQuerySchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(15),
  date:     z.coerce.date({ errorMap: () => ({ message: 'Invalid date' }) }).optional(),
  from:     z.coerce.date({ errorMap: () => ({ message: 'Invalid from date' }) }).optional(),
  to:       z.coerce.date({ errorMap: () => ({ message: 'Invalid to date' }) }).optional(),
  status:   z.nativeEnum(AttendanceStatus).optional(),
})
  .refine(data => !data.from || !data.to || data.to >= data.from, {
    message: 'to must be on or after from', path: ['to'],
  })
  .refine(data => !(data.date && (data.from || data.to)), {
    message: 'Use either date or from/to range, not both', path: ['date'],
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

const homeworkSubmissionInput = z.object({
  studentId: z.string().uuid('Invalid student id'),
  status:    z.nativeEnum(HomeworkSubmissionStatus),
  remarks:   z.string().max(500).optional(),
});

export const markHomeworkSubmissionsSchema = z.object({
  records: z.array(homeworkSubmissionInput).min(1, 'At least one record is required'),
});

export const listMyHomeworkQuerySchema = z.object({
  page:      z.coerce.number().int().positive().default(1),
  pageSize:  z.coerce.number().int().positive().max(100).default(15),
  search:    z.string().trim().min(1).optional(),
  classId:   z.string().uuid('Invalid class id').optional(),
  sectionId: z.string().uuid('Invalid section id').optional(),
  subjectId: z.string().uuid('Invalid subject id').optional(),
});

// ── Leave requests (review only — applying is a parent action) ──
export const listLeaveRequestsQuerySchema = z.object({
  status: z.nativeEnum(LeaveStatus).optional(),
});

export const reviewLeaveRequestSchema = z.object({
  status:        z.enum(['APPROVED', 'REJECTED']),
  reviewRemarks: z.string().max(500).optional(),
});

// ── My own leave (teacher applying for themselves — Admin reviews) ─
export const applyMyLeaveSchema = z.object({
  fromDate: z.coerce.date({ errorMap: () => ({ message: 'Invalid from date' }) }),
  toDate:   z.coerce.date({ errorMap: () => ({ message: 'Invalid to date' }) }),
  reason:   z.string().min(2, 'Reason is required').max(500),
}).refine(
  data => data.toDate >= data.fromDate,
  { message: 'toDate must be on or after fromDate', path: ['toDate'] },
);

export const listMyLeaveQuerySchema = z.object({
  status: z.nativeEnum(LeaveStatus).optional(),
});

export type UpdateProfileSchema                  = z.infer<typeof updateProfileSchema>;
export type ResetPasswordSchema                  = z.infer<typeof resetPasswordSchema>;
export type ListMyStudentsQuerySchema             = z.infer<typeof listMyStudentsQuerySchema>;
export type ListMyAnnouncementsQuerySchema        = z.infer<typeof listMyAnnouncementsQuerySchema>;
export type ListMyEventsQuerySchema                = z.infer<typeof listMyEventsQuerySchema>;
export type GetSectionAttendanceQuerySchema       = z.infer<typeof getSectionAttendanceQuerySchema>;
export type MarkAttendanceSchema                  = z.infer<typeof markAttendanceSchema>;
export type StudentAttendanceHistoryQuerySchema   = z.infer<typeof studentAttendanceHistoryQuerySchema>;
export type UpdateAttendanceRecordSchema          = z.infer<typeof updateAttendanceRecordSchema>;
export type CreateHomeworkSchema                  = z.infer<typeof createHomeworkSchema>;
export type MarkHomeworkSubmissionsSchema         = z.infer<typeof markHomeworkSubmissionsSchema>;
export type UpdateHomeworkSchema                  = z.infer<typeof updateHomeworkSchema>;
export type ListMyHomeworkQuerySchema              = z.infer<typeof listMyHomeworkQuerySchema>;
export type ListMyAttendanceRecordsQuerySchema     = z.infer<typeof listMyAttendanceRecordsQuerySchema>;
export type ListLeaveRequestsQuerySchema           = z.infer<typeof listLeaveRequestsQuerySchema>;
export type ReviewLeaveRequestSchema               = z.infer<typeof reviewLeaveRequestSchema>;
export type ApplyMyLeaveSchema                     = z.infer<typeof applyMyLeaveSchema>;
export type ListMyLeaveQuerySchema                 = z.infer<typeof listMyLeaveQuerySchema>;
