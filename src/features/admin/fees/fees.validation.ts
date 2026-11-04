import { z } from 'zod';
import { FeeStatus, FeePaymentStatus, PaymentMode } from '@prisma/client';

// ── Shared fields ─────────────────────────────────────────────
// Rupees, rounded to paise.
const round2 = (v: number) => Math.round(v * 100) / 100;
const amount = z.coerce.number({ invalid_type_error: 'Amount must be a number' })
  .finite().min(0, 'Amount cannot be negative').max(100_000_000, 'Amount is too large').transform(round2);
const positiveAmount = amount.refine(v => v > 0, 'Amount must be greater than 0');

const date        = z.coerce.date({ errorMap: () => ({ message: 'Invalid date (use YYYY-MM-DD)' }) });
const sessionYear = z.coerce.number().int().min(2000).max(2100);
const id          = (label: string) => z.string().uuid(`Invalid ${label} id`);
const text        = (max: number) => z.string().trim().min(1).max(max);
const reason      = z.object({ reason: text(500) });
const bool        = z.enum(['true', 'false']).transform(v => v === 'true');

const page = {
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
};

// DUE = PENDING or PARTIAL; OVERDUE = DUE and past its due date.
export const FEE_STATUS_FILTERS = ['PENDING', 'PARTIAL', 'PAID', 'WAIVED', 'CANCELLED', 'DUE', 'OVERDUE'] as const satisfies readonly (FeeStatus | 'DUE' | 'OVERDUE')[];

// ── Fee structures ────────────────────────────────────────────
export const createStructureSchema = z.object({
  name:        text(100),
  category:    text(50),
  description: z.string().trim().max(500).optional(),
  amount:      positiveAmount,
  dueDate:     date,
  sessionYear: sessionYear.optional(),            // default: current session
  classId:     id('class').nullable().optional(), // null / missing = every class
  isActive:    z.boolean().optional(),
});

export const updateStructureSchema = createStructureSchema.partial()
  .refine(d => Object.keys(d).length > 0, 'At least one field is required');

export const listStructuresQuerySchema = z.object({
  ...page,
  sessionYear: sessionYear.optional(),
  classId:     id('class').optional(),
  isActive:    bool.optional(),
  search:      z.string().trim().min(1).optional(),
});

// No filter = every active student the structure applies to.
export const assignStructureSchema = z.object({
  classId:    id('class').optional(),
  sectionId:  id('section').optional(),
  studentIds: z.array(id('student')).min(1).max(2000).optional(),
});

// ── Student fees ──────────────────────────────────────────────
export const createStudentFeeSchema = z.object({
  studentId:   id('student'),
  title:       text(100),
  category:    text(50),
  amount:      positiveAmount,
  discount:    amount.optional(),
  fine:        amount.optional(),
  dueDate:     date,
  sessionYear: sessionYear.optional(),
  note:        z.string().trim().max(500).optional(),
});

export const updateStudentFeeSchema = z.object({
  title:    text(100).optional(),
  category: text(50).optional(),
  amount:   positiveAmount.optional(),
  discount: amount.optional(),
  fine:     amount.optional(),
  dueDate:  date.optional(),
  note:     z.string().trim().max(500).nullable().optional(),
}).refine(d => Object.keys(d).length > 0, 'At least one field is required');

export const listStudentFeesQuerySchema = z.object({
  ...page,
  sessionYear: sessionYear.optional(),
  classId:     id('class').optional(),
  sectionId:   id('section').optional(),
  studentId:   id('student').optional(),
  status:      z.enum(FEE_STATUS_FILTERS).optional(),
  category:    z.string().trim().min(1).optional(),
  search:      z.string().trim().min(1).optional(),   // student name / admission no / fee title
});

export const feeReasonSchema = reason;

// ── Payments ──────────────────────────────────────────────────
export const createPaymentSchema = z.object({
  amount:      positiveAmount,
  mode:        z.nativeEnum(PaymentMode),
  referenceNo: z.string().trim().max(100).optional(),   // UTR / cheque no. / txn id
  paidAt:      z.coerce.date().refine(d => d.getTime() <= Date.now() + 5 * 60_000, 'paidAt cannot be in the future').optional(),
  note:        z.string().trim().max(500).optional(),
});

export const listPaymentsQuerySchema = z.object({
  ...page,
  from:      date.optional(),
  to:        date.optional(),
  mode:      z.nativeEnum(PaymentMode).optional(),
  status:    z.nativeEnum(FeePaymentStatus).optional(),
  studentId: id('student').optional(),
  classId:   id('class').optional(),
  search:    z.string().trim().min(1).optional(),   // receipt no / student name / admission no
});

export const voidPaymentSchema = reason;

// ── Reports ───────────────────────────────────────────────────
export const summaryQuerySchema = z.object({
  sessionYear: sessionYear.optional(),
  classId:     id('class').optional(),
});

export const defaultersQuerySchema = z.object({
  ...page,
  sessionYear: sessionYear.optional(),
  classId:     id('class').optional(),
  sectionId:   id('section').optional(),
  overdueOnly: bool.optional(),
  search:      z.string().trim().min(1).optional(),
});

export const ledgerQuerySchema = z.object({ sessionYear: sessionYear.optional() });

// ── Parent ────────────────────────────────────────────────────
export const parentFeesQuerySchema = z.object({
  studentId:   id('student'),
  sessionYear: sessionYear.optional(),
});

// ── Params ────────────────────────────────────────────────────
export const structureIdParamSchema = z.object({ structureId: id('fee structure') });
export const feeIdParamSchema       = z.object({ feeId: id('fee') });
export const paymentIdParamSchema   = z.object({ paymentId: id('payment') });
export const studentIdParamSchema   = z.object({ studentId: id('student') });

export type CreateStructureSchema      = z.infer<typeof createStructureSchema>;
export type UpdateStructureSchema      = z.infer<typeof updateStructureSchema>;
export type ListStructuresQuerySchema  = z.infer<typeof listStructuresQuerySchema>;
export type AssignStructureSchema      = z.infer<typeof assignStructureSchema>;
export type CreateStudentFeeSchema     = z.infer<typeof createStudentFeeSchema>;
export type UpdateStudentFeeSchema     = z.infer<typeof updateStudentFeeSchema>;
export type ListStudentFeesQuerySchema = z.infer<typeof listStudentFeesQuerySchema>;
export type CreatePaymentSchema        = z.infer<typeof createPaymentSchema>;
export type ListPaymentsQuerySchema    = z.infer<typeof listPaymentsQuerySchema>;
export type SummaryQuerySchema         = z.infer<typeof summaryQuerySchema>;
export type DefaultersQuerySchema      = z.infer<typeof defaultersQuerySchema>;
export type ParentFeesQuerySchema      = z.infer<typeof parentFeesQuerySchema>;
