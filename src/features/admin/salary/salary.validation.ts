import { z } from 'zod';
import { PaymentMode, SalaryStatus, EmployeeType } from '@prisma/client';

const round2 = (v: number) => Math.round(v * 100) / 100;
const amount = z.coerce.number({ invalid_type_error: 'Amount must be a number' })
  .finite().min(0, 'Amount cannot be negative').max(100_000_000, 'Amount is too large').transform(round2);

const month  = z.coerce.number().int().min(1).max(12);
const year   = z.coerce.number().int().min(2000).max(2100);
const id     = (label: string) => z.string().uuid(`Invalid ${label} id`);
const reason = z.string().trim().min(1).max(500);

// [{ label: "HRA", amount: 2000 }, …]
const lineItems = z.array(z.object({ label: z.string().trim().min(1).max(60), amount })).max(20);

const page = {
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
};

// No ids = every ACTIVE employee of that type who had joined by the end
// of the month and has no slip for it yet.
export const generateSalarySchema = z.object({
  month,
  year,
  employeeType: z.enum(['TEACHER', 'STAFF', 'ALL']).default('ALL'),
  teacherIds:   z.array(id('teacher')).min(1).max(1000).optional(),
  staffIds:     z.array(id('staff')).min(1).max(1000).optional(),
});

export const listSalaryQuerySchema = z.object({
  ...page,
  month:        month.optional(),
  year:         year.optional(),
  status:       z.nativeEnum(SalaryStatus).optional(),
  employeeType: z.nativeEnum(EmployeeType).optional(),
  search:       z.string().trim().min(1).optional(),   // name / employee code / slip no
});

export const updateSalarySchema = z.object({
  baseSalary: amount.optional(),
  allowances: lineItems.optional(),
  deductions: lineItems.optional(),
  note:       z.string().trim().max(500).nullable().optional(),
}).refine(d => Object.keys(d).length > 0, 'At least one field is required');

const creditFields = {
  paymentMode: z.nativeEnum(PaymentMode),
  referenceNo: z.string().trim().max(100).optional(),
  creditedAt:  z.coerce.date().refine(d => d.getTime() <= Date.now() + 5 * 60_000, 'creditedAt cannot be in the future').optional(),
};

export const creditSalarySchema     = z.object(creditFields);
export const bulkCreditSalarySchema = z.object({ slipIds: z.array(id('salary slip')).min(1).max(500), ...creditFields });
export const salaryReasonSchema     = z.object({ reason });

export const salarySummaryQuerySchema = z.object({ month: month.optional(), year: year.optional() });
export const mySalaryQuerySchema      = z.object({ year: year.optional() });

export const slipIdParamSchema = z.object({ slipId: id('salary slip') });

export type GenerateSalarySchema     = z.infer<typeof generateSalarySchema>;
export type ListSalaryQuerySchema    = z.infer<typeof listSalaryQuerySchema>;
export type UpdateSalarySchema       = z.infer<typeof updateSalarySchema>;
export type CreditSalarySchema       = z.infer<typeof creditSalarySchema>;
export type BulkCreditSalarySchema   = z.infer<typeof bulkCreditSalarySchema>;
export type SalarySummaryQuerySchema = z.infer<typeof salarySummaryQuerySchema>;
export type LineItem                 = z.infer<typeof lineItems>[number];
