import { z } from 'zod';
import { SYLLABUS_PLAN_STATUS_VALUES, CHAPTER_PROGRESS_STATUS_VALUES } from '../../../constants';

const dateOnly = (label: string) => z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be in YYYY-MM-DD format`)
  .transform(v => new Date(`${v}T00:00:00.000Z`))
  .refine(d => !Number.isNaN(d.getTime()), `${label} is not a valid date`);

// ── Chapter schemas ──────────────────────────────────────────────

export const createChapterSchema = z.object({
  name:                z.string().min(1, 'Chapter name is required').max(200),
  chapterNumber:       z.number().int().min(1, 'Chapter number must be at least 1'),
  description:         z.string().max(1000).optional(),
  subjectId:           z.string().uuid('Invalid subject id'),
  classId:             z.string().uuid('Invalid class id'),
  expectedWorkingDays: z.number().int().min(0).default(0),
  sequenceNumber:      z.number().int().min(1, 'Sequence number must be at least 1'),
});

export type CreateChapterSchema = z.infer<typeof createChapterSchema>;

export const updateChapterSchema = z.object({
  name:                z.string().min(1).max(200).optional(),
  chapterNumber:       z.number().int().min(1).optional(),
  description:         z.string().max(1000).optional(),
  expectedWorkingDays: z.number().int().min(0).optional(),
  sequenceNumber:      z.number().int().min(1).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });

export type UpdateChapterSchema = z.infer<typeof updateChapterSchema>;

export const reorderChaptersSchema = z.object({
  chapters: z.array(z.object({
    id:             z.string().uuid('Invalid chapter id'),
    sequenceNumber: z.number().int().min(1),
  })).min(1, 'At least one chapter is required'),
});

export type ReorderChaptersSchema = z.infer<typeof reorderChaptersSchema>;

export const listChaptersQuerySchema = z.object({
  subjectId: z.string().uuid().optional(),
  classId:   z.string().uuid().optional(),
  isActive:  z.coerce.boolean().optional(),
  page:      z.coerce.number().int().min(1).default(1),
  pageSize:  z.coerce.number().int().min(1).max(100).default(50),
});

export type ListChaptersQuerySchema = z.infer<typeof listChaptersQuerySchema>;

// ── Syllabus Plan schemas ────────────────────────────────────────

export const createSyllabusPlanSchema = z.object({
  sessionYear:     z.number().int().min(2000).max(2100),
  classId:         z.string().uuid('Invalid class id'),
  sectionId:       z.string().uuid('Invalid section id'),
  subjectId:       z.string().uuid('Invalid subject id'),
  teacherId:       z.string().uuid('Invalid teacher id').optional(),
  remarks:         z.string().max(1000).optional(),
  approvalEnabled: z.boolean().default(false),
  chapters: z.array(z.object({
    chapterId:          z.string().uuid('Invalid chapter id'),
    sequenceNumber:     z.number().int().min(1),
    expectedWorkingDays: z.number().int().min(0),
    plannedStartDate:   dateOnly('plannedStartDate').optional(),
    plannedEndDate:     dateOnly('plannedEndDate').optional(),
    adminRemarks:       z.string().max(500).optional(),
  })).min(1, 'At least one chapter is required'),
});

export type CreateSyllabusPlanSchema = z.infer<typeof createSyllabusPlanSchema>;

export const updateSyllabusPlanSchema = z.object({
  teacherId:       z.string().uuid().nullable().optional(),
  status:          z.enum(SYLLABUS_PLAN_STATUS_VALUES).optional(),
  remarks:         z.string().max(1000).optional(),
  approvalEnabled: z.boolean().optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });

export type UpdateSyllabusPlanSchema = z.infer<typeof updateSyllabusPlanSchema>;

export const updatePlanChapterSchema = z.object({
  expectedWorkingDays: z.number().int().min(0).optional(),
  plannedStartDate:    dateOnly('plannedStartDate').optional(),
  plannedEndDate:      dateOnly('plannedEndDate').optional(),
  adminRemarks:        z.string().max(500).optional(),
  sequenceNumber:      z.number().int().min(1).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });

export type UpdatePlanChapterSchema = z.infer<typeof updatePlanChapterSchema>;

export const listPlansQuerySchema = z.object({
  sessionYear: z.coerce.number().int().optional(),
  classId:     z.string().uuid().optional(),
  sectionId:   z.string().uuid().optional(),
  subjectId:   z.string().uuid().optional(),
  teacherId:   z.string().uuid().optional(),
  status:      z.string().optional(),
  page:        z.coerce.number().int().min(1).default(1),
  pageSize:    z.coerce.number().int().min(1).max(100).default(20),
});

export type ListPlansQuerySchema = z.infer<typeof listPlansQuerySchema>;

// ── Monitoring query ─────────────────────────────────────────────

export const monitoringQuerySchema = z.object({
  sessionYear: z.coerce.number().int().min(2000).max(2100),
  classId:     z.string().uuid().optional(),
  sectionId:   z.string().uuid().optional(),
  subjectId:   z.string().uuid().optional(),
  teacherId:   z.string().uuid().optional(),
  status:      z.enum(CHAPTER_PROGRESS_STATUS_VALUES).optional(),
});

export type MonitoringQuerySchema = z.infer<typeof monitoringQuerySchema>;

// ── Approval schemas ─────────────────────────────────────────────

export const reviewApprovalSchema = z.object({
  status:             z.enum(['APPROVED', 'REJECTED'] as const),
  approvedPercentage: z.number().min(0).max(100).optional(),
  rejectionRemarks:   z.string().max(1000).optional(),
})
  .refine(d => d.status !== 'REJECTED' || (d.rejectionRemarks && d.rejectionRemarks.length > 0), {
    message: 'Rejection remarks are required when rejecting', path: ['rejectionRemarks'],
  })
  .refine(d => d.status !== 'APPROVED' || d.approvedPercentage !== undefined, {
    message: 'Approved percentage is required when approving', path: ['approvedPercentage'],
  });

export type ReviewApprovalSchema = z.infer<typeof reviewApprovalSchema>;

export const adminCorrectionSchema = z.object({
  completionPercentage: z.number().min(0).max(100),
  correctionRemarks:    z.string().min(1, 'Correction remarks are required').max(1000),
});

export type AdminCorrectionSchema = z.infer<typeof adminCorrectionSchema>;
