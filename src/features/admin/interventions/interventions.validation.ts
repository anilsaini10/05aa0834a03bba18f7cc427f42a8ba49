import { z } from 'zod';
import { InterventionStatus } from '@prisma/client';

const dateOnly = (label: string) => z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be in YYYY-MM-DD format`)
  .transform(v => new Date(`${v}T00:00:00.000Z`))
  .refine(d => !Number.isNaN(d.getTime()), `${label} is not a valid date`);

const text = (label: string, max: number) =>
  z.string().trim().min(1, `${label} cannot be empty`).max(max, `${label} must be at most ${max} characters`);

export const INTERVENTION_ENTITY_TYPES = ['STUDENT', 'TEACHER', 'CLASS', 'SECTION', 'SUBJECT', 'EXAM_PAPER', 'HOMEWORK'] as const;

// alertKey/alertType come from GET /admin/analytics/alerts when the
// intervention is opened from an alert; both optional for a manual one.
export const createInterventionSchema = z.object({
  alertKey:     z.string().trim().max(200).optional(),
  alertType:    z.string().trim().max(50).optional(),
  entityType:   z.enum(INTERVENTION_ENTITY_TYPES, { errorMap: () => ({ message: `entityType must be one of: ${INTERVENTION_ENTITY_TYPES.join(', ')}` }) }),
  entityId:     z.string().uuid('Invalid entity id'),
  title:        text('Title', 200),
  description:  text('Description', 5000).optional(),
  actionTaken:  text('Action taken', 5000).optional(),
  status:       z.nativeEnum(InterventionStatus).default('OPEN'),
  assignedTo:   z.string().uuid('Invalid user id').optional(),   // a TEACHER or ADMIN user of this school
  dueDate:      dateOnly('dueDate').optional(),
  followUpDate: dateOnly('followUpDate').optional(),
});

// null clears an optional field. Entity/alert links can't change.
export const updateInterventionSchema = z.object({
  title:        text('Title', 200).optional(),
  description:  text('Description', 5000).nullable().optional(),
  actionTaken:  text('Action taken', 5000).nullable().optional(),
  status:       z.nativeEnum(InterventionStatus).optional(),
  assignedTo:   z.string().uuid('Invalid user id').nullable().optional(),
  dueDate:      dateOnly('dueDate').nullable().optional(),
  followUpDate: dateOnly('followUpDate').nullable().optional(),
  outcome:      text('Outcome', 5000).nullable().optional(),
}).refine(d => Object.values(d).some(v => v !== undefined), { message: 'Send at least one field to update' });

export const listInterventionsQuerySchema = z.object({
  page:       z.coerce.number().int().positive().default(1),
  pageSize:   z.coerce.number().int().positive().max(100).default(20),
  status:     z.nativeEnum(InterventionStatus).optional(),
  entityType: z.enum(INTERVENTION_ENTITY_TYPES).optional(),
  entityId:   z.string().uuid('Invalid entity id').optional(),
  alertType:  z.string().trim().optional(),
  alertKey:   z.string().trim().optional(),
  assignedTo: z.string().uuid('Invalid user id').optional(),
  overdue:    z.enum(['true', 'false']).transform(v => v === 'true').optional(),
});

export type CreateInterventionSchema     = z.infer<typeof createInterventionSchema>;
export type UpdateInterventionSchema     = z.infer<typeof updateInterventionSchema>;
export type ListInterventionsQuerySchema = z.infer<typeof listInterventionsQuerySchema>;
