import { Prisma, SalaryStatus } from '@prisma/client';
import { prisma } from '../../../config/db';
import { NOTIFICATION_TYPE } from '../../../constants';
import { toSchoolDay } from '../../../shared/utils/subscriptionStatus';
import { dec, sumAmounts, toAmount } from '../../../shared/utils/money';
import { nextSequence } from '../../../shared/utils/sequence';
import { notifyUser } from '../../notifications/notifications.service';
import {
  GenerateSalarySchema, ListSalaryQuerySchema, UpdateSalarySchema, CreditSalarySchema,
  BulkCreditSalarySchema, SalarySummaryQuerySchema, LineItem,
} from './salary.validation';

// ════════════════════════════════════════════════════════════
// Salary slips — see SalarySlip in schema.prisma.
//
//   generate ──► PENDING ──credit──► CREDITED   (final)
//                  │  ▲
//             hold │  │ release
//                  ▼  │
//                ON_HOLD
//   PENDING / ON_HOLD ──cancel──► CANCELLED
//
// Amounts are editable only while PENDING / ON_HOLD. A CREDITED slip is
// never changed or deleted. Every status change is a conditional UPDATE
// (WHERE status IN …), so two admins can't both credit the same slip.
// ════════════════════════════════════════════════════════════

const appError = (message: string, code: string, statusCode: number, details?: Record<string, unknown>) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = statusCode;
  if (details) err.details = details;
  return err;
};

const EDITABLE: SalaryStatus[] = ['PENDING', 'ON_HOLD'];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const paginate = <T>(items: T[], total: number, page: number, pageSize: number) => ({
  items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)),
});

// Current month on the school's calendar.
const currentPeriod = () => {
  const [y, m] = toSchoolDay(new Date()).split('-').map(Number);
  return { year: y, month: m };
};

const asLineItems = (v: Prisma.JsonValue): LineItem[] => (Array.isArray(v) ? (v as LineItem[]) : []);

export const computeSalary = (baseSalary: Prisma.Decimal.Value, allowances: LineItem[], deductions: LineItem[]) => {
  const gross           = dec(baseSalary).plus(sumAmounts(allowances.map(a => a.amount)));
  const totalDeductions = sumAmounts(deductions.map(d => d.amount));
  if (totalDeductions.gt(gross)) {
    throw appError('Deductions cannot be more than base salary + allowances', 'DEDUCTIONS_EXCEED_GROSS', 400,
      { grossAmount: toAmount(gross), totalDeductions: toAmount(totalDeductions) });
  }
  return { grossAmount: gross, totalDeductions, netAmount: gross.minus(totalDeductions) };
};

// ── View ──────────────────────────────────────────────────────

const SLIP_INCLUDE = {
  teacher:        { select: { userId: true } },
  creditedByUser: { select: { id: true, name: true } },
} as const;
type SlipRow = Prisma.SalarySlipGetPayload<{ include: typeof SLIP_INCLUDE }>;

const slipView = (s: SlipRow) => ({
  id:           s.id,
  slipNo:       s.slipNo,
  employee: {
    type: s.employeeType,
    id:   s.teacherId ?? s.staffId,
    name: s.employeeName,
    code: s.employeeCode,
  },
  month:           s.month,
  year:            s.year,
  period:          `${MONTH_NAMES[s.month - 1]} ${s.year}`,
  baseSalary:      toAmount(s.baseSalary),
  allowances:      asLineItems(s.allowances),
  deductions:      asLineItems(s.deductions),
  grossAmount:     toAmount(s.grossAmount),
  totalDeductions: toAmount(s.totalDeductions),
  netAmount:       toAmount(s.netAmount),
  status:          s.status,
  statusReason:    s.statusReason,
  note:            s.note,
  paymentMode:     s.paymentMode,
  referenceNo:     s.referenceNo,
  creditedAt:      s.creditedAt,
  creditedBy:      s.creditedByUser,
  createdAt:       s.createdAt,
  updatedAt:       s.updatedAt,
});

const requireSlip = async (schoolId: string, slipId: string) => {
  const s = await prisma.salarySlip.findFirst({ where: { id: slipId, schoolId }, include: SLIP_INCLUDE });
  if (!s) throw appError('Salary slip not found', 'SALARY_SLIP_NOT_FOUND', 404);
  return s;
};

// Moves a slip from one of `from` to `data.status`; 409 if it's in any
// other status (checked in the same UPDATE, so it's race-free).
const transition = async (schoolId: string, slipId: string, from: SalaryStatus[], data: Prisma.SalarySlipUncheckedUpdateManyInput) => {
  const { count } = await prisma.salarySlip.updateMany({ where: { id: slipId, schoolId, status: { in: from } }, data });
  const slip = await requireSlip(schoolId, slipId);
  if (count === 0) {
    throw appError(`Salary slip is ${slip.status} — this action needs ${from.join(' or ')}`, 'INVALID_SALARY_STATUS', 409, { status: slip.status });
  }
  return slip;
};

const notifyCredited = async (slips: SlipRow[]) => {
  // Awaited for serverless (see leave.service); notifyUser never throws.
  for (const s of slips) {
    if (!s.teacher) continue;
    await notifyUser(s.teacher.userId, {
      title: 'Salary credited',
      body:  `Your salary of ₹${toAmount(s.netAmount)} for ${MONTH_NAMES[s.month - 1]} ${s.year} has been credited.`,
      data:  { type: NOTIFICATION_TYPE.SALARY, slipId: s.id },
    });
  }
};

// ════════════════════════════════════════════════════════════
// Admin
// ════════════════════════════════════════════════════════════

// ── POST /admin/salary/generate ───────────────────────────────
// One PENDING slip per employee for the month, at their current salary.
// Employees who already have a slip for the month are skipped, so it's
// safe to run again (e.g. after a new joiner).
export const generateSalary = async (schoolId: string, input: GenerateSalarySchema) => {
  const now = currentPeriod();
  if (input.year * 12 + input.month > now.year * 12 + now.month) {
    throw appError('Salary can\'t be generated for a future month', 'FUTURE_PERIOD', 400);
  }
  const monthEnd = new Date(Date.UTC(input.year, input.month, 0, 23, 59, 59));
  const wantTeachers = input.employeeType !== 'STAFF' && !(input.staffIds && !input.teacherIds);
  const wantStaff    = input.employeeType !== 'TEACHER' && !(input.teacherIds && !input.staffIds);

  const [teachers, staff, existing] = await Promise.all([
    wantTeachers ? prisma.teacher.findMany({
      where:  { schoolId, status: 'ACTIVE', joiningDate: { lte: monthEnd }, ...(input.teacherIds ? { id: { in: input.teacherIds } } : {}) },
      select: { id: true, employeeId: true, salary: true, user: { select: { name: true } } },
    }) : [],
    wantStaff ? prisma.staff.findMany({
      where:  { schoolId, status: 'ACTIVE', joiningDate: { lte: monthEnd }, ...(input.staffIds ? { id: { in: input.staffIds } } : {}) },
      select: { id: true, employeeId: true, salary: true, name: true },
    }) : [],
    prisma.salarySlip.findMany({ where: { schoolId, month: input.month, year: input.year }, select: { teacherId: true, staffId: true } }),
  ]);
  if (input.teacherIds && teachers.length !== new Set(input.teacherIds).size) {
    throw appError('Some teachers were not found, are inactive, or joined after this month', 'TEACHER_NOT_FOUND', 404);
  }
  if (input.staffIds && staff.length !== new Set(input.staffIds).size) {
    throw appError('Some staff were not found, are inactive, or joined after this month', 'STAFF_NOT_FOUND', 404);
  }

  const has = new Set(existing.flatMap(e => [e.teacherId, e.staffId]).filter(Boolean));
  const rows = [
    ...teachers.filter(t => !has.has(t.id)).map(t => ({ employeeType: 'TEACHER' as const, teacherId: t.id, staffId: null, employeeName: t.user.name, employeeCode: t.employeeId, salary: t.salary })),
    ...staff.filter(s => !has.has(s.id)).map(s => ({ employeeType: 'STAFF' as const, teacherId: null, staffId: s.id, employeeName: s.name, employeeCode: s.employeeId, salary: s.salary })),
  ];

  const created = rows.length === 0 ? 0 : await prisma.$transaction(async tx => {
    const first = await nextSequence(tx, schoolId, `SALARY_SLIP_${input.year}`, rows.length);
    const { count } = await tx.salarySlip.createMany({
      data: rows.map(({ salary, ...r }, i) => {
        const base = dec(salary).toDecimalPlaces(2);
        return {
          ...r,
          schoolId,
          slipNo:          `SAL-${input.year}-${String(input.month).padStart(2, '0')}-${String(first + i).padStart(5, '0')}`,
          month:           input.month,
          year:            input.year,
          baseSalary:      base,
          grossAmount:     base,
          totalDeductions: 0,
          netAmount:       base,
        };
      }),
      skipDuplicates: true,   // a concurrent generate already made some
    });
    return count;
  });

  return {
    month: input.month, year: input.year,
    eligibleEmployees: teachers.length + staff.length,
    created,
    alreadyGenerated: teachers.length + staff.length - created,
  };
};

// ── GET /admin/salary ─────────────────────────────────────────
export const listSalary = async (schoolId: string, q: ListSalaryQuerySchema) => {
  const where: Prisma.SalarySlipWhereInput = {
    schoolId,
    ...(q.month ? { month: q.month } : {}),
    ...(q.year ? { year: q.year } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.employeeType ? { employeeType: q.employeeType } : {}),
    ...(q.search ? {
      OR: [
        { employeeName: { contains: q.search, mode: 'insensitive' } },
        { employeeCode: { contains: q.search, mode: 'insensitive' } },
        { slipNo:       { contains: q.search, mode: 'insensitive' } },
      ],
    } : {}),
  };
  const [items, total, byStatus] = await Promise.all([
    prisma.salarySlip.findMany({
      where, include: SLIP_INCLUDE, orderBy: [{ year: 'desc' }, { month: 'desc' }, { employeeName: 'asc' }],
      skip: (q.page - 1) * q.pageSize, take: q.pageSize,
    }),
    prisma.salarySlip.count({ where }),
    prisma.salarySlip.groupBy({ by: ['status'], where, _sum: { netAmount: true }, _count: true }),
  ]);
  return {
    ...paginate(items.map(slipView), total, q.page, q.pageSize),
    totals: Object.fromEntries((['PENDING', 'ON_HOLD', 'CREDITED', 'CANCELLED'] as SalaryStatus[]).map(st => {
      const g = byStatus.find(b => b.status === st);
      return [st, { count: g?._count ?? 0, netAmount: toAmount(g?._sum.netAmount ?? null) }];
    })),
  };
};

// ── GET /admin/salary/summary — one month at a glance ─────────
export const getSalarySummary = async (schoolId: string, q: SalarySummaryQuerySchema) => {
  const { month, year } = { ...currentPeriod(), ...q };
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  const active = { schoolId, status: 'ACTIVE', joiningDate: { lte: monthEnd } };
  const [byStatus, teachers, staff, slips] = await Promise.all([
    prisma.salarySlip.groupBy({ by: ['status'], where: { schoolId, month, year }, _sum: { netAmount: true }, _count: true }),
    prisma.teacher.findMany({ where: active, select: { id: true } }),
    prisma.staff.findMany({ where: active, select: { id: true } }),
    prisma.salarySlip.findMany({ where: { schoolId, month, year }, select: { teacherId: true, staffId: true } }),
  ]);
  const has = new Set(slips.flatMap(s => [s.teacherId, s.staffId]).filter(Boolean));
  const notGenerated = [...teachers, ...staff].filter(e => !has.has(e.id)).length;

  const statuses = Object.fromEntries((['PENDING', 'ON_HOLD', 'CREDITED', 'CANCELLED'] as SalaryStatus[]).map(st => {
    const g = byStatus.find(b => b.status === st);
    return [st, { count: g?._count ?? 0, netAmount: toAmount(g?._sum.netAmount ?? null) }];
  }));
  return {
    month, year, period: `${MONTH_NAMES[month - 1]} ${year}`,
    activeEmployees: teachers.length + staff.length,
    generated:       slips.length,
    notGenerated,
    statuses,
    payableAmount:   toAmount(dec(statuses.PENDING.netAmount).plus(statuses.ON_HOLD.netAmount)),   // still to pay
    creditedAmount:  statuses.CREDITED.netAmount,
  };
};

// ── GET /admin/salary/:slipId ─────────────────────────────────
export const getSalarySlip = async (schoolId: string, slipId: string) => slipView(await requireSlip(schoolId, slipId));

// ── PATCH /admin/salary/:slipId ───────────────────────────────
// Base salary, allowances (HRA, bonus…) and deductions (PF, loss of
// pay…). Totals are recomputed.
export const updateSalarySlip = async (schoolId: string, slipId: string, input: UpdateSalarySchema) => {
  const cur = await requireSlip(schoolId, slipId);
  const baseSalary = input.baseSalary ?? cur.baseSalary;
  const allowances = input.allowances ?? asLineItems(cur.allowances);
  const deductions = input.deductions ?? asLineItems(cur.deductions);
  const totals = computeSalary(baseSalary, allowances, deductions);

  // Conditional on status AND updatedAt, so an edit made in between
  // (or a credit) isn't silently overwritten.
  const { count } = await prisma.salarySlip.updateMany({
    where: { id: slipId, schoolId, status: { in: EDITABLE }, updatedAt: cur.updatedAt },
    data:  {
      baseSalary, allowances, deductions, ...totals,
      ...(input.note !== undefined ? { note: input.note } : {}),
    },
  });
  const slip = await requireSlip(schoolId, slipId);
  if (count === 0) {
    throw EDITABLE.includes(slip.status)
      ? appError('The slip was changed by someone else — reload and try again', 'SALARY_SLIP_CHANGED', 409)
      : appError(`A ${slip.status} slip can't be edited`, 'INVALID_SALARY_STATUS', 409, { status: slip.status });
  }
  return slipView(slip);
};

// ── DELETE /admin/salary/:slipId ──────────────────────────────
// Anything not CREDITED — the slip can then be generated again.
export const deleteSalarySlip = async (schoolId: string, slipId: string) => {
  const { count } = await prisma.salarySlip.deleteMany({ where: { id: slipId, schoolId, status: { not: 'CREDITED' } } });
  if (count === 0) {
    await requireSlip(schoolId, slipId);   // 404 if missing
    throw appError('A credited salary slip can\'t be deleted', 'INVALID_SALARY_STATUS', 409, { status: 'CREDITED' });
  }
  return { deleted: true };
};

// ── POST /admin/salary/:slipId/credit ─────────────────────────
export const creditSalarySlip = async (schoolId: string, adminId: string, slipId: string, input: CreditSalarySchema) => {
  const slip = await transition(schoolId, slipId, ['PENDING'], {
    status: 'CREDITED', statusReason: null, paymentMode: input.paymentMode, referenceNo: input.referenceNo ?? null,
    creditedAt: input.creditedAt ?? new Date(), creditedBy: adminId,
  });
  await notifyCredited([slip]);
  return slipView(slip);
};

// ── POST /admin/salary/credit — many slips at once ────────────
// Credits the ones that are PENDING; the rest are reported as skipped.
export const bulkCreditSalary = async (schoolId: string, adminId: string, input: BulkCreditSalarySchema) => {
  const ids = [...new Set(input.slipIds)];
  const credited = await prisma.$transaction(async tx => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM salary_slips
      WHERE id IN (${Prisma.join(ids)}) AND "schoolId" = ${schoolId} AND status = 'PENDING'
      FOR UPDATE`;
    const lockedIds = locked.map(r => r.id);
    if (lockedIds.length) {
      await tx.salarySlip.updateMany({
        where: { id: { in: lockedIds } },
        data:  {
          status: 'CREDITED', statusReason: null, paymentMode: input.paymentMode, referenceNo: input.referenceNo ?? null,
          creditedAt: input.creditedAt ?? new Date(), creditedBy: adminId,
        },
      });
    }
    return tx.salarySlip.findMany({ where: { id: { in: lockedIds } }, include: SLIP_INCLUDE });
  });
  await notifyCredited(credited);
  const creditedIds = new Set(credited.map(s => s.id));
  return {
    credited:       credited.length,
    creditedAmount: toAmount(sumAmounts(credited.map(s => s.netAmount))),
    skipped:        ids.filter(i => !creditedIds.has(i)),   // not found, or not PENDING
  };
};

// ── POST /admin/salary/:slipId/hold | release | cancel ────────
export const holdSalarySlip = async (schoolId: string, slipId: string, reason: string) =>
  slipView(await transition(schoolId, slipId, ['PENDING'], { status: 'ON_HOLD', statusReason: reason }));

export const releaseSalarySlip = async (schoolId: string, slipId: string) =>
  slipView(await transition(schoolId, slipId, ['ON_HOLD'], { status: 'PENDING', statusReason: null }));

export const cancelSalarySlip = async (schoolId: string, slipId: string, reason: string) =>
  slipView(await transition(schoolId, slipId, EDITABLE, { status: 'CANCELLED', statusReason: reason }));

// ════════════════════════════════════════════════════════════
// Teacher — own slips (GET /teacher/salary)
// ════════════════════════════════════════════════════════════

const requireTeacher = async (userId: string) => {
  const t = await prisma.teacher.findUnique({ where: { userId }, select: { id: true } });
  if (!t) throw appError('Teacher profile not found', 'TEACHER_NOT_FOUND', 404);
  return t;
};

export const listMySalary = async (userId: string, year?: number) => {
  const t = await requireTeacher(userId);
  const slips = await prisma.salarySlip.findMany({
    where:   { teacherId: t.id, status: { not: 'CANCELLED' }, ...(year ? { year } : {}) },
    include: SLIP_INCLUDE,
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });
  const credited = slips.filter(s => s.status === 'CREDITED');
  return {
    totals: {
      creditedAmount: toAmount(sumAmounts(credited.map(s => s.netAmount))),
      pendingAmount:  toAmount(sumAmounts(slips.filter(s => EDITABLE.includes(s.status)).map(s => s.netAmount))),
    },
    items: slips.map(slipView),
  };
};

export const getMySalarySlip = async (userId: string, slipId: string) => {
  const t = await requireTeacher(userId);
  const s = await prisma.salarySlip.findFirst({ where: { id: slipId, teacherId: t.id, status: { not: 'CANCELLED' } }, include: SLIP_INCLUDE });
  if (!s) throw appError('Salary slip not found', 'SALARY_SLIP_NOT_FOUND', 404);
  return slipView(s);
};
