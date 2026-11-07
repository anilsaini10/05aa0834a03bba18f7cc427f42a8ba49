import { FeeStatus, Prisma } from '@prisma/client';
import { prisma } from '../../../config/db';
import { DEFAULT_ACADEMIC_SESSION_START_MONTH, NOTIFICATION_TYPE } from '../../../constants';
import { sessionYearOf, sessionLabel } from '../analytics/analytics.utils';
import { schoolDayStart, toSchoolDay } from '../../../shared/utils/subscriptionStatus';
import { dec, toAmount } from '../../../shared/utils/money';
import { nextSequence } from '../../../shared/utils/sequence';
import { notifyUser } from '../../notifications/notifications.service';
import {
  CreateStructureSchema, UpdateStructureSchema, ListStructuresQuerySchema, AssignStructureSchema,
  CreateStudentFeeSchema, UpdateStudentFeeSchema, ListStudentFeesQuerySchema, CreatePaymentSchema,
  ListPaymentsQuerySchema, SummaryQuerySchema, DefaultersQuerySchema, ParentFeesQuerySchema,
} from './fees.validation';

// ════════════════════════════════════════════════════════════
// Student fees — see the FeeStructure / StudentFee / FeePayment notes in
// schema.prisma for the model.
//
// Status of a StudentFee:
//   PENDING → PARTIAL → PAID      set from paidAmount vs payable on every
//                                 payment, void and edit (settleStatus)
//   PENDING/PARTIAL → WAIVED      school forgives the balance
//   PENDING (nothing paid) → CANCELLED
//   WAIVED/CANCELLED → reopen     back to PENDING/PARTIAL/PAID
// OVERDUE is not stored: a PENDING/PARTIAL fee past its due date (school
// day, IST) is returned with isOverdue = true / displayStatus = OVERDUE.
//
// Every write that touches paidAmount or the amounts locks the fee row
// (SELECT … FOR UPDATE) so two cashiers can't overpay the same fee.
// ════════════════════════════════════════════════════════════

type Tx = Prisma.TransactionClient;

const appError = (message: string, code: string, statusCode: number, details?: Record<string, unknown>) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = statusCode;
  if (details) err.details = details;
  return err;
};

const DUE_STATUSES: FeeStatus[]    = ['PENDING', 'PARTIAL'];
const CLOSED_STATUSES: FeeStatus[] = ['WAIVED', 'CANCELLED'];

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

// Today as a @db.Date value (UTC midnight of the school's calendar day).
const schoolToday = (now = new Date()) => new Date(`${toSchoolDay(now)}T00:00:00.000Z`);

const currentSessionYear = async (schoolId: string): Promise<number> => {
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { academicSessionStartMonth: true } });
  return sessionYearOf(schoolToday(), school?.academicSessionStartMonth ?? DEFAULT_ACADEMIC_SESSION_START_MONTH);
};

export const payableOf = (f: { amount: Prisma.Decimal; discount: Prisma.Decimal; fine: Prisma.Decimal }) =>
  f.amount.minus(f.discount).plus(f.fine);

export const settleStatus = (payable: Prisma.Decimal, paid: Prisma.Decimal): FeeStatus =>
  paid.gte(payable) ? 'PAID' : paid.gt(0) ? 'PARTIAL' : 'PENDING';

const paginate = <T>(items: T[], total: number, page: number, pageSize: number) => ({
  items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)),
});

// ── Views ─────────────────────────────────────────────────────

const STUDENT_SELECT = {
  id: true, name: true, admissionNo: true, rollNo: true, parentUserId: true,
  class: { select: { id: true, name: true } }, section: { select: { id: true, name: true } },
} as const;

const FEE_INCLUDE = { student: { select: STUDENT_SELECT } } as const;
type FeeRow = Prisma.StudentFeeGetPayload<{ include: typeof FEE_INCLUDE }>;

const studentView = (s: FeeRow['student']) => ({
  id: s.id, name: s.name, admissionNo: s.admissionNo, rollNo: s.rollNo, class: s.class, section: s.section,
});

const feeView = (f: FeeRow, today = schoolToday()) => {
  const payable   = payableOf(f);
  const isClosed  = CLOSED_STATUSES.includes(f.status);
  const isOverdue = DUE_STATUSES.includes(f.status) && f.dueDate < today;
  return {
    id:             f.id,
    student:        studentView(f.student),
    feeStructureId: f.feeStructureId,
    title:          f.title,
    category:       f.category,
    sessionYear:    f.sessionYear,
    session:        sessionLabel(f.sessionYear),
    amount:         toAmount(f.amount),
    discount:       toAmount(f.discount),
    fine:           toAmount(f.fine),
    payableAmount:  toAmount(payable),
    paidAmount:     toAmount(f.paidAmount),
    balanceAmount:  isClosed ? 0 : toAmount(payable.minus(f.paidAmount)),
    dueDate:        dateOnly(f.dueDate),
    status:         f.status,
    isOverdue,
    displayStatus:  isOverdue ? 'OVERDUE' : f.status,
    statusReason:   f.statusReason,
    note:           f.note,
    createdAt:      f.createdAt,
    updatedAt:      f.updatedAt,
  };
};

const PAYMENT_INCLUDE = {
  studentFee:      { include: FEE_INCLUDE },
  collectedByUser: { select: { id: true, name: true } },
} as const;
type PaymentRow = Prisma.FeePaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

const paymentView = (p: PaymentRow) => ({
  id:          p.id,
  receiptNo:   p.receiptNo,
  amount:      toAmount(p.amount),
  mode:        p.mode,
  referenceNo: p.referenceNo,
  paidAt:      p.paidAt,
  note:        p.note,
  status:      p.status,
  voidReason:  p.voidReason,
  voidedAt:    p.voidedAt,
  collectedBy: p.collectedByUser,
  student:     studentView(p.studentFee.student),
  fee: {
    id:          p.studentFee.id,
    title:       p.studentFee.title,
    category:    p.studentFee.category,
    sessionYear: p.studentFee.sessionYear,
    session:     sessionLabel(p.studentFee.sessionYear),
  },
  createdAt: p.createdAt,
});

const totalsOf = (fees: FeeRow[], today = schoolToday()) => {
  let payable = dec(0), paid = dec(0), balance = dec(0), overdue = dec(0);
  for (const f of fees) {
    if (f.status === 'CANCELLED') continue;
    payable = payable.plus(payableOf(f));
    paid    = paid.plus(f.paidAmount);
    if (DUE_STATUSES.includes(f.status)) {
      const left = payableOf(f).minus(f.paidAmount);
      balance = balance.plus(left);
      if (f.dueDate < today) overdue = overdue.plus(left);
    }
  }
  return { payableAmount: toAmount(payable), paidAmount: toAmount(paid), balanceAmount: toAmount(balance), overdueAmount: toAmount(overdue) };
};

// ════════════════════════════════════════════════════════════
// Fee structures
// ════════════════════════════════════════════════════════════

const STRUCTURE_INCLUDE = { class: { select: { id: true, name: true } }, _count: { select: { studentFees: true } } } as const;
type StructureRow = Prisma.FeeStructureGetPayload<{ include: typeof STRUCTURE_INCLUDE }>;

const structureView = (s: StructureRow) => ({
  id:            s.id,
  name:          s.name,
  category:      s.category,
  description:   s.description,
  amount:        toAmount(s.amount),
  dueDate:       dateOnly(s.dueDate),
  sessionYear:   s.sessionYear,
  session:       sessionLabel(s.sessionYear),
  class:         s.class,          // null = every class
  isActive:      s.isActive,
  assignedCount: s._count.studentFees,
  createdAt:     s.createdAt,
  updatedAt:     s.updatedAt,
});

const requireClass = async (schoolId: string, classId: string) => {
  const cls = await prisma.class.findFirst({ where: { id: classId, schoolId }, select: { id: true } });
  if (!cls) throw appError('Class not found', 'CLASS_NOT_FOUND', 404);
};

const requireStructure = async (schoolId: string, structureId: string) => {
  const s = await prisma.feeStructure.findFirst({ where: { id: structureId, schoolId }, include: STRUCTURE_INCLUDE });
  if (!s) throw appError('Fee structure not found', 'FEE_STRUCTURE_NOT_FOUND', 404);
  return s;
};

// ── POST /admin/fees/structures ───────────────────────────────
export const createStructure = async (schoolId: string, input: CreateStructureSchema) => {
  if (input.classId) await requireClass(schoolId, input.classId);
  const s = await prisma.feeStructure.create({
    data: {
      schoolId,
      name:        input.name,
      category:    input.category,
      description: input.description ?? null,
      amount:      input.amount,
      dueDate:     input.dueDate,
      sessionYear: input.sessionYear ?? await currentSessionYear(schoolId),
      classId:     input.classId ?? null,
      isActive:    input.isActive ?? true,
    },
    include: STRUCTURE_INCLUDE,
  });
  return structureView(s);
};

// ── GET /admin/fees/structures ────────────────────────────────
export const listStructures = async (schoolId: string, q: ListStructuresQuerySchema) => {
  const where: Prisma.FeeStructureWhereInput = {
    schoolId,
    ...(q.sessionYear ? { sessionYear: q.sessionYear } : {}),
    ...(q.classId ? { classId: q.classId } : {}),
    ...(q.isActive !== undefined ? { isActive: q.isActive } : {}),
    ...(q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { category: { contains: q.search, mode: 'insensitive' } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.feeStructure.findMany({
      where, include: STRUCTURE_INCLUDE, orderBy: [{ sessionYear: 'desc' }, { dueDate: 'asc' }, { name: 'asc' }],
      skip: (q.page - 1) * q.pageSize, take: q.pageSize,
    }),
    prisma.feeStructure.count({ where }),
  ]);
  return paginate(items.map(structureView), total, q.page, q.pageSize);
};

// ── GET /admin/fees/structures/:structureId ───────────────────
export const getStructure = async (schoolId: string, structureId: string) =>
  structureView(await requireStructure(schoolId, structureId));

// ── PATCH /admin/fees/structures/:structureId ─────────────────
// Changes the template only — fees already assigned keep their amounts
// (edit those one by one under /student-fees).
export const updateStructure = async (schoolId: string, structureId: string, input: UpdateStructureSchema) => {
  await requireStructure(schoolId, structureId);
  if (input.classId) await requireClass(schoolId, input.classId);
  const s = await prisma.feeStructure.update({
    where: { id: structureId },
    data: {
      ...(input.name        !== undefined ? { name: input.name } : {}),
      ...(input.category    !== undefined ? { category: input.category } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.amount      !== undefined ? { amount: input.amount } : {}),
      ...(input.dueDate     !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.sessionYear !== undefined ? { sessionYear: input.sessionYear } : {}),
      ...(input.classId     !== undefined ? { classId: input.classId } : {}),
      ...(input.isActive    !== undefined ? { isActive: input.isActive } : {}),
    },
    include: STRUCTURE_INCLUDE,
  });
  return structureView(s);
};

// ── DELETE /admin/fees/structures/:structureId ────────────────
export const deleteStructure = async (schoolId: string, structureId: string) => {
  const s = await requireStructure(schoolId, structureId);
  if (s._count.studentFees > 0) {
    throw appError('This fee is assigned to students — deactivate it instead, or delete the unpaid assignments first',
      'FEE_STRUCTURE_IN_USE', 409, { assignedCount: s._count.studentFees });
  }
  await prisma.feeStructure.delete({ where: { id: structureId } });
  return { deleted: true };
};

// ── POST /admin/fees/structures/:structureId/assign ───────────
// Creates a StudentFee for each matching ACTIVE student. Students who
// already have this fee are skipped, so it's safe to run again after
// new admissions.
export const assignStructure = async (schoolId: string, structureId: string, input: AssignStructureSchema) => {
  const s = await requireStructure(schoolId, structureId);
  if (!s.isActive) throw appError('Fee structure is inactive', 'FEE_STRUCTURE_INACTIVE', 409);
  if (s.classId && input.classId && input.classId !== s.classId) {
    throw appError('This fee is for another class', 'CLASS_MISMATCH', 400);
  }

  const students = await prisma.student.findMany({
    where: {
      schoolId,
      status: 'ACTIVE',
      ...((s.classId ?? input.classId) ? { classId: s.classId ?? input.classId } : {}),
      ...(input.sectionId ? { sectionId: input.sectionId } : {}),
      ...(input.studentIds ? { id: { in: input.studentIds } } : {}),
    },
    select: { id: true },
  });
  if (input.studentIds && students.length !== new Set(input.studentIds).size) {
    throw appError('Some students were not found, are inactive, or are not in this fee\'s class', 'STUDENT_NOT_FOUND', 404);
  }

  const { count } = await prisma.studentFee.createMany({
    data: students.map(st => ({
      schoolId,
      studentId:      st.id,
      feeStructureId: s.id,
      title:          s.name,
      category:       s.category,
      sessionYear:    s.sessionYear,
      amount:         s.amount,
      dueDate:        s.dueDate,
    })),
    skipDuplicates: true,
  });
  return { matchedStudents: students.length, assigned: count, alreadyAssigned: students.length - count };
};

// ════════════════════════════════════════════════════════════
// Student fees
// ════════════════════════════════════════════════════════════

// Lock the row for the rest of the transaction, then read it.
const lockFee = async (tx: Tx, schoolId: string, feeId: string) => {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM student_fees WHERE id = ${feeId} AND "schoolId" = ${schoolId} FOR UPDATE`;
  if (!rows.length) throw appError('Fee not found', 'FEE_NOT_FOUND', 404);
  return tx.studentFee.findUniqueOrThrow({ where: { id: feeId }, include: FEE_INCLUDE });
};

const feeWhere = (schoolId: string, q: Omit<ListStudentFeesQuerySchema, 'page' | 'pageSize'>, today: Date): Prisma.StudentFeeWhereInput => ({
  schoolId,
  ...(q.sessionYear ? { sessionYear: q.sessionYear } : {}),
  ...(q.studentId ? { studentId: q.studentId } : {}),
  ...(q.category ? { category: { equals: q.category, mode: 'insensitive' } } : {}),
  ...(q.classId || q.sectionId ? { student: { ...(q.classId ? { classId: q.classId } : {}), ...(q.sectionId ? { sectionId: q.sectionId } : {}) } } : {}),
  ...(q.status === 'DUE'     ? { status: { in: DUE_STATUSES } }
    : q.status === 'OVERDUE' ? { status: { in: DUE_STATUSES }, dueDate: { lt: today } }
    : q.status               ? { status: q.status }
    : {}),
  ...(q.search ? {
    OR: [
      { title:   { contains: q.search, mode: 'insensitive' } },
      { student: { name:        { contains: q.search, mode: 'insensitive' } } },
      { student: { admissionNo: { contains: q.search, mode: 'insensitive' } } },
    ],
  } : {}),
});

// ── POST /admin/fees/student-fees ─────────────────────────────
// An ad-hoc charge for one student (late fee, lost book, trip…).
export const createStudentFee = async (schoolId: string, input: CreateStudentFeeSchema) => {
  const student = await prisma.student.findFirst({ where: { id: input.studentId, schoolId }, select: { id: true } });
  if (!student) throw appError('Student not found', 'STUDENT_NOT_FOUND', 404);
  const discount = dec(input.discount ?? 0), fine = dec(input.fine ?? 0), amt = dec(input.amount);
  if (discount.gt(amt.plus(fine))) throw appError('Discount cannot be more than amount + fine', 'INVALID_DISCOUNT', 400);

  const f = await prisma.studentFee.create({
    data: {
      schoolId,
      studentId:   input.studentId,
      title:       input.title,
      category:    input.category,
      sessionYear: input.sessionYear ?? await currentSessionYear(schoolId),
      amount:      amt,
      discount,
      fine,
      dueDate:     input.dueDate,
      note:        input.note ?? null,
      status:      settleStatus(amt.minus(discount).plus(fine), dec(0)),
    },
    include: FEE_INCLUDE,
  });
  return feeView(f);
};

// ── GET /admin/fees/student-fees ──────────────────────────────
// Paginated list + totals over the whole filtered set.
export const listStudentFees = async (schoolId: string, q: ListStudentFeesQuerySchema) => {
  const today = schoolToday();
  const where = feeWhere(schoolId, q, today);
  const [items, total, all, due] = await Promise.all([
    prisma.studentFee.findMany({
      where, include: FEE_INCLUDE, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      skip: (q.page - 1) * q.pageSize, take: q.pageSize,
    }),
    prisma.studentFee.count({ where }),
    prisma.studentFee.aggregate({ where: { AND: [where, { status: { not: 'CANCELLED' } }] }, _sum: { amount: true, discount: true, fine: true, paidAmount: true } }),
    prisma.studentFee.aggregate({ where: { AND: [where, { status: { in: DUE_STATUSES } }] }, _sum: { amount: true, discount: true, fine: true, paidAmount: true } }),
  ]);
  const payable = (s: typeof all._sum) => dec(s.amount ?? 0).minus(s.discount ?? 0).plus(s.fine ?? 0);
  return {
    ...paginate(items.map(f => feeView(f, today)), total, q.page, q.pageSize),
    totals: {
      payableAmount: toAmount(payable(all._sum)),
      paidAmount:    toAmount(dec(all._sum.paidAmount ?? 0)),
      balanceAmount: toAmount(payable(due._sum).minus(due._sum.paidAmount ?? 0)),
    },
  };
};

// ── GET /admin/fees/student-fees/:feeId ───────────────────────
export const getStudentFee = async (schoolId: string, feeId: string) => {
  const f = await prisma.studentFee.findFirst({
    where:   { id: feeId, schoolId },
    include: { ...FEE_INCLUDE, payments: { include: PAYMENT_INCLUDE, orderBy: { paidAt: 'desc' } } },
  });
  if (!f) throw appError('Fee not found', 'FEE_NOT_FOUND', 404);
  return { ...feeView(f), payments: f.payments.map(paymentView) };
};

// ── PATCH /admin/fees/student-fees/:feeId ─────────────────────
// Amount / discount / fine / due date; status follows. Can't drop the
// payable below what's already paid.
export const updateStudentFee = async (schoolId: string, feeId: string, input: UpdateStudentFeeSchema) => {
  const f = await prisma.$transaction(async tx => {
    const cur = await lockFee(tx, schoolId, feeId);
    if (CLOSED_STATUSES.includes(cur.status)) {
      throw appError(`Fee is ${cur.status.toLowerCase()} — reopen it first`, 'FEE_CLOSED', 409);
    }
    const amount   = input.amount   !== undefined ? dec(input.amount)   : cur.amount;
    const discount = input.discount !== undefined ? dec(input.discount) : cur.discount;
    const fine     = input.fine     !== undefined ? dec(input.fine)     : cur.fine;
    if (discount.gt(amount.plus(fine))) throw appError('Discount cannot be more than amount + fine', 'INVALID_DISCOUNT', 400);
    const payable = amount.minus(discount).plus(fine);
    if (payable.lt(cur.paidAmount)) {
      throw appError('Payable amount cannot be less than what is already paid — void a payment first',
        'PAYABLE_BELOW_PAID', 409, { paidAmount: toAmount(cur.paidAmount), payableAmount: toAmount(payable) });
    }
    return tx.studentFee.update({
      where: { id: feeId },
      data: {
        amount, discount, fine,
        status: settleStatus(payable, cur.paidAmount),
        ...(input.title    !== undefined ? { title: input.title } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.dueDate  !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.note     !== undefined ? { note: input.note } : {}),
      },
      include: FEE_INCLUDE,
    });
  });
  return feeView(f);
};

// ── DELETE /admin/fees/student-fees/:feeId ────────────────────
// Only a fee that never had a payment (not even a voided one) — receipts
// must stay traceable. Otherwise cancel or waive it.
export const deleteStudentFee = async (schoolId: string, feeId: string) => {
  await prisma.$transaction(async tx => {
    await lockFee(tx, schoolId, feeId);
    const payments = await tx.feePayment.count({ where: { studentFeeId: feeId } });
    if (payments > 0) throw appError('This fee has payments — cancel or waive it instead', 'FEE_HAS_PAYMENTS', 409);
    await tx.studentFee.delete({ where: { id: feeId } });
  });
  return { deleted: true };
};

// ── POST /admin/fees/student-fees/:feeId/waive ────────────────
export const waiveStudentFee = async (schoolId: string, feeId: string, reason: string) => {
  const f = await prisma.$transaction(async tx => {
    const cur = await lockFee(tx, schoolId, feeId);
    if (!DUE_STATUSES.includes(cur.status)) {
      throw appError(`Only a pending or partly paid fee can be waived (this one is ${cur.status})`, 'INVALID_FEE_STATUS', 409);
    }
    return tx.studentFee.update({ where: { id: feeId }, data: { status: 'WAIVED', statusReason: reason }, include: FEE_INCLUDE });
  });
  return feeView(f);
};

// ── POST /admin/fees/student-fees/:feeId/cancel ───────────────
export const cancelStudentFee = async (schoolId: string, feeId: string, reason: string) => {
  const f = await prisma.$transaction(async tx => {
    const cur = await lockFee(tx, schoolId, feeId);
    if (cur.status === 'CANCELLED') throw appError('Fee is already cancelled', 'INVALID_FEE_STATUS', 409);
    if (cur.paidAmount.gt(0)) throw appError('This fee has payments — void them first, or waive the balance', 'FEE_HAS_PAYMENTS', 409);
    return tx.studentFee.update({ where: { id: feeId }, data: { status: 'CANCELLED', statusReason: reason }, include: FEE_INCLUDE });
  });
  return feeView(f);
};

// ── POST /admin/fees/student-fees/:feeId/reopen ───────────────
export const reopenStudentFee = async (schoolId: string, feeId: string) => {
  const f = await prisma.$transaction(async tx => {
    const cur = await lockFee(tx, schoolId, feeId);
    if (!CLOSED_STATUSES.includes(cur.status)) throw appError('Only a waived or cancelled fee can be reopened', 'INVALID_FEE_STATUS', 409);
    return tx.studentFee.update({
      where: { id: feeId },
      data:  { status: settleStatus(payableOf(cur), cur.paidAmount), statusReason: null },
      include: FEE_INCLUDE,
    });
  });
  return feeView(f);
};

// ════════════════════════════════════════════════════════════
// Payments
// ════════════════════════════════════════════════════════════

const receiptNoFor = (sessionYear: number, n: number) => `RCP-${sessionLabel(sessionYear)}-${String(n).padStart(5, '0')}`;

// ── POST /admin/fees/student-fees/:feeId/payments ─────────────
export const recordPayment = async (schoolId: string, collectorId: string, feeId: string, input: CreatePaymentSchema) => {
  const payment = await prisma.$transaction(async tx => {
    const fee = await lockFee(tx, schoolId, feeId);
    if (!DUE_STATUSES.includes(fee.status)) {
      throw appError(fee.status === 'PAID' ? 'This fee is already fully paid' : `Fee is ${fee.status.toLowerCase()}`, 'FEE_NOT_PAYABLE', 409);
    }
    const balance = payableOf(fee).minus(fee.paidAmount);
    const amount  = dec(input.amount);
    if (amount.gt(balance)) {
      throw appError(`Amount is more than the balance (₹${toAmount(balance)})`, 'AMOUNT_EXCEEDS_BALANCE', 409, { balanceAmount: toAmount(balance) });
    }

    const n = await nextSequence(tx, schoolId, `FEE_RECEIPT_${fee.sessionYear}`);
    const created = await tx.feePayment.create({
      data: {
        schoolId,
        studentFeeId: fee.id,
        studentId:    fee.studentId,
        receiptNo:    receiptNoFor(fee.sessionYear, n),
        amount,
        mode:         input.mode,
        referenceNo:  input.referenceNo ?? null,
        paidAt:       input.paidAt ?? new Date(),
        note:         input.note ?? null,
        collectedBy:  collectorId,
      },
    });
    const paid = fee.paidAmount.plus(amount);
    await tx.studentFee.update({ where: { id: fee.id }, data: { paidAmount: paid, status: settleStatus(payableOf(fee), paid) } });
    return tx.feePayment.findUniqueOrThrow({ where: { id: created.id }, include: PAYMENT_INCLUDE });
  });

  // Awaited for serverless (see leave.service); notifyUser never throws.
  await notifyUser(payment.studentFee.student.parentUserId, {
    title: 'Fee payment received',
    body:  `₹${toAmount(payment.amount)} received for ${payment.studentFee.student.name} — ${payment.studentFee.title}. Receipt ${payment.receiptNo}.`,
    data:  { type: NOTIFICATION_TYPE.FEE_PAYMENT, paymentId: payment.id, studentId: payment.studentId },
  });

  const fee = await prisma.studentFee.findUniqueOrThrow({ where: { id: feeId }, include: FEE_INCLUDE });
  return { payment: paymentView(payment), fee: feeView(fee) };
};

// ── POST /admin/fees/payments/:paymentId/void ─────────────────
// A wrong entry is voided, never deleted; the fee's paid amount and
// status are recomputed. A WAIVED fee stays waived.
export const voidPayment = async (schoolId: string, paymentId: string, reason: string) => {
  const result = await prisma.$transaction(async tx => {
    const p = await tx.feePayment.findFirst({ where: { id: paymentId, schoolId } });
    if (!p) throw appError('Payment not found', 'PAYMENT_NOT_FOUND', 404);
    const fee = await lockFee(tx, schoolId, p.studentFeeId);
    // Re-read under the fee lock so a concurrent void can't double-subtract.
    const fresh = await tx.feePayment.findUniqueOrThrow({ where: { id: paymentId } });
    if (fresh.status === 'VOIDED') throw appError('Payment is already voided', 'PAYMENT_ALREADY_VOIDED', 409);

    await tx.feePayment.update({ where: { id: paymentId }, data: { status: 'VOIDED', voidReason: reason, voidedAt: new Date() } });
    const paid = fee.paidAmount.minus(fresh.amount);
    await tx.studentFee.update({
      where: { id: fee.id },
      data:  { paidAmount: paid, ...(fee.status === 'WAIVED' ? {} : { status: settleStatus(payableOf(fee), paid) }) },
    });
    return {
      payment: await tx.feePayment.findUniqueOrThrow({ where: { id: paymentId }, include: PAYMENT_INCLUDE }),
      fee:     await tx.studentFee.findUniqueOrThrow({ where: { id: fee.id }, include: FEE_INCLUDE }),
    };
  });
  return { payment: paymentView(result.payment), fee: feeView(result.fee) };
};

// ── GET /admin/fees/payments ──────────────────────────────────
// Collection report: paginated + total of SUCCESS payments in the filter.
export const listPayments = async (schoolId: string, q: ListPaymentsQuerySchema) => {
  const where: Prisma.FeePaymentWhereInput = {
    schoolId,
    ...(q.status ? { status: q.status } : {}),
    ...(q.mode ? { mode: q.mode } : {}),
    ...(q.studentId ? { studentId: q.studentId } : {}),
    ...(q.classId ? { studentFee: { student: { classId: q.classId } } } : {}),
    ...(q.from || q.to ? {
      paidAt: {
        ...(q.from ? { gte: schoolDayStart(dateOnly(q.from)) } : {}),
        ...(q.to   ? { lt: new Date(schoolDayStart(dateOnly(q.to)).getTime() + 86_400_000) } : {}),
      },
    } : {}),
    ...(q.search ? {
      OR: [
        { receiptNo:   { contains: q.search, mode: 'insensitive' } },
        { referenceNo: { contains: q.search, mode: 'insensitive' } },
        { studentFee:  { student: { name:        { contains: q.search, mode: 'insensitive' } } } },
        { studentFee:  { student: { admissionNo: { contains: q.search, mode: 'insensitive' } } } },
      ],
    } : {}),
  };
  const [items, total, sum] = await Promise.all([
    prisma.feePayment.findMany({ where, include: PAYMENT_INCLUDE, orderBy: { paidAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.feePayment.count({ where }),
    prisma.feePayment.aggregate({ where: { AND: [where, { status: 'SUCCESS' }] }, _sum: { amount: true }, _count: true }),
  ]);
  return {
    ...paginate(items.map(paymentView), total, q.page, q.pageSize),
    totals: { collectedAmount: toAmount(dec(sum._sum.amount ?? 0)), successfulPayments: sum._count },
  };
};

// ── GET /admin/fees/payments/:paymentId (receipt) ─────────────
export const getPayment = async (schoolId: string, paymentId: string) => {
  const p = await prisma.feePayment.findFirst({ where: { id: paymentId, schoolId }, include: PAYMENT_INCLUDE });
  if (!p) throw appError('Payment not found', 'PAYMENT_NOT_FOUND', 404);
  return paymentView(p);
};

// ════════════════════════════════════════════════════════════
// Reports
// ════════════════════════════════════════════════════════════

// ── GET /admin/fees/students/:studentId — one student's ledger ─
export const getStudentLedger = async (schoolId: string, studentId: string, sessionYear?: number) => {
  const student = await prisma.student.findFirst({ where: { id: studentId, schoolId }, select: STUDENT_SELECT });
  if (!student) throw appError('Student not found', 'STUDENT_NOT_FOUND', 404);
  const today = schoolToday();
  const [fees, payments] = await Promise.all([
    prisma.studentFee.findMany({ where: { studentId, ...(sessionYear ? { sessionYear } : {}) }, include: FEE_INCLUDE, orderBy: { dueDate: 'asc' } }),
    prisma.feePayment.findMany({
      where: { studentId, ...(sessionYear ? { studentFee: { sessionYear } } : {}) }, include: PAYMENT_INCLUDE, orderBy: { paidAt: 'desc' },
    }),
  ]);
  return {
    student: studentView(student),
    totals:  totalsOf(fees, today),
    fees:    fees.map(f => feeView(f, today)),
    payments: payments.map(paymentView),
  };
};

// ── GET /admin/fees/summary — dashboard numbers for a session ─
export const getSummary = async (schoolId: string, q: SummaryQuerySchema) => {
  const sessionYear = q.sessionYear ?? await currentSessionYear(schoolId);
  const today = schoolToday();
  const where: Prisma.StudentFeeWhereInput = { schoolId, sessionYear, ...(q.classId ? { student: { classId: q.classId } } : {}) };
  const sums = { amount: true, discount: true, fine: true, paidAmount: true } as const;
  const classFilter = q.classId ? Prisma.sql`AND s."classId" = ${q.classId}` : Prisma.empty;

  const todayStart = schoolDayStart(toSchoolDay(new Date()));
  const monthStart = schoolDayStart(`${toSchoolDay(new Date()).slice(0, 7)}-01`);
  const paymentWhere = (from: Date): Prisma.FeePaymentWhereInput => ({
    schoolId, status: 'SUCCESS', paidAt: { gte: from }, ...(q.classId ? { studentFee: { student: { classId: q.classId } } } : {}),
  });

  const [byStatus, overdue, byClass, collectedToday, collectedThisMonth] = await Promise.all([
    prisma.studentFee.groupBy({ by: ['status'], where, _sum: sums, _count: true }),
    prisma.studentFee.aggregate({ where: { AND: [where, { status: { in: DUE_STATUSES }, dueDate: { lt: today } }] }, _sum: sums, _count: true }),
    prisma.$queryRaw<{ classId: string; className: string; fees: bigint; payable: Prisma.Decimal | null; paid: Prisma.Decimal | null; pending: Prisma.Decimal | null }[]>`
      SELECT c.id AS "classId", c.name AS "className", COUNT(*) AS fees,
             SUM(sf.amount - sf.discount + sf.fine) FILTER (WHERE sf.status <> 'CANCELLED')                   AS payable,
             SUM(sf."paidAmount")                                                                             AS paid,
             SUM(sf.amount - sf.discount + sf.fine - sf."paidAmount") FILTER (WHERE sf.status IN ('PENDING', 'PARTIAL')) AS pending
      FROM student_fees sf
      JOIN students s ON s.id = sf."studentId"
      JOIN classes  c ON c.id = s."classId"
      WHERE sf."schoolId" = ${schoolId} AND sf."sessionYear" = ${sessionYear} ${classFilter}
      GROUP BY c.id, c.name, c."numericLevel"
      ORDER BY c."numericLevel", c.name`,
    prisma.feePayment.aggregate({ where: paymentWhere(todayStart), _sum: { amount: true } }),
    prisma.feePayment.aggregate({ where: paymentWhere(monthStart), _sum: { amount: true } }),
  ]);

  const payable = (s: { amount: Prisma.Decimal | null; discount: Prisma.Decimal | null; fine: Prisma.Decimal | null }) =>
    dec(s.amount ?? 0).minus(s.discount ?? 0).plus(s.fine ?? 0);
  const counts: Record<string, number> = { PENDING: 0, PARTIAL: 0, PAID: 0, WAIVED: 0, CANCELLED: 0 };
  let billed = dec(0), collected = dec(0), pending = dec(0), waived = dec(0);
  for (const g of byStatus) {
    counts[g.status] = g._count;
    if (g.status === 'CANCELLED') continue;
    billed    = billed.plus(payable(g._sum));
    collected = collected.plus(g._sum.paidAmount ?? 0);
    const left = payable(g._sum).minus(g._sum.paidAmount ?? 0);
    if (DUE_STATUSES.includes(g.status)) pending = pending.plus(left);
    if (g.status === 'WAIVED') waived = waived.plus(left);
  }

  return {
    sessionYear,
    session: sessionLabel(sessionYear),
    totals: {
      billedAmount:    toAmount(billed),      // payable on every non-cancelled fee
      collectedAmount: toAmount(collected),
      pendingAmount:   toAmount(pending),     // still to collect (PENDING + PARTIAL)
      overdueAmount:   toAmount(payable(overdue._sum).minus(overdue._sum.paidAmount ?? 0)),
      waivedAmount:    toAmount(waived),
      collectionRate:  billed.gt(0) ? collected.div(billed).times(100).toDecimalPlaces(1).toNumber() : null,
    },
    counts: { ...counts, OVERDUE: overdue._count },
    collectedToday:     toAmount(dec(collectedToday._sum.amount ?? 0)),
    collectedThisMonth: toAmount(dec(collectedThisMonth._sum.amount ?? 0)),
    byClass: byClass.map(c => ({
      classId:       c.classId,
      className:     c.className,
      fees:          Number(c.fees),
      payableAmount: toAmount(c.payable),
      paidAmount:    toAmount(c.paid),
      pendingAmount: toAmount(c.pending),
    })),
  };
};

// ── GET /admin/fees/defaulters — students with money due ──────
export const listDefaulters = async (schoolId: string, q: DefaultersQuerySchema) => {
  const today = schoolToday();
  const filters = Prisma.join([
    Prisma.sql`sf."schoolId" = ${schoolId}`,
    Prisma.sql`sf.status IN ('PENDING', 'PARTIAL')`,
    ...(q.sessionYear ? [Prisma.sql`sf."sessionYear" = ${q.sessionYear}`] : []),
    ...(q.classId     ? [Prisma.sql`s."classId" = ${q.classId}`] : []),
    ...(q.sectionId   ? [Prisma.sql`s."sectionId" = ${q.sectionId}`] : []),
    ...(q.overdueOnly ? [Prisma.sql`sf."dueDate" < ${today}`] : []),
    ...(q.search      ? [Prisma.sql`(s.name ILIKE ${'%' + q.search + '%'} OR s."admissionNo" ILIKE ${'%' + q.search + '%'})`] : []),
  ], ' AND ');

  const rows = await prisma.$queryRaw<{
    studentId: string; name: string; admissionNo: string; rollNo: number; parentName: string; parentPhone: string;
    classId: string; className: string; sectionId: string; sectionName: string;
    dueFees: bigint; pendingAmount: Prisma.Decimal; overdueAmount: Prisma.Decimal | null; oldestDueDate: Date; total: bigint;
  }[]>`
    SELECT s.id AS "studentId", s.name, s."admissionNo", s."rollNo", s."parentName", s."parentPhone",
           c.id AS "classId", c.name AS "className", sec.id AS "sectionId", sec.name AS "sectionName",
           COUNT(*) AS "dueFees",
           SUM(sf.amount - sf.discount + sf.fine - sf."paidAmount") AS "pendingAmount",
           SUM(sf.amount - sf.discount + sf.fine - sf."paidAmount") FILTER (WHERE sf."dueDate" < ${today}) AS "overdueAmount",
           MIN(sf."dueDate") AS "oldestDueDate",
           COUNT(*) OVER () AS total
    FROM student_fees sf
    JOIN students s   ON s.id = sf."studentId"
    JOIN classes  c   ON c.id = s."classId"
    JOIN sections sec ON sec.id = s."sectionId"
    WHERE ${filters}
    GROUP BY s.id, c.id, sec.id
    ORDER BY "pendingAmount" DESC, s.name
    LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`;

  const total = rows.length ? Number(rows[0].total) : 0;
  return paginate(rows.map(r => ({
    student: {
      id: r.studentId, name: r.name, admissionNo: r.admissionNo, rollNo: r.rollNo,
      class: { id: r.classId, name: r.className }, section: { id: r.sectionId, name: r.sectionName },
      parentName: r.parentName, parentPhone: r.parentPhone,
    },
    dueFees:       Number(r.dueFees),
    pendingAmount: toAmount(r.pendingAmount),
    overdueAmount: toAmount(r.overdueAmount),
    oldestDueDate: dateOnly(r.oldestDueDate),
  })), total, q.page, q.pageSize);
};

// ════════════════════════════════════════════════════════════
// Parent — own child's fees (GET /students/fees)
// ════════════════════════════════════════════════════════════

const requireOwnChild = async (parentUserId: string, studentId: string) => {
  const s = await prisma.student.findUnique({ where: { id: studentId }, select: STUDENT_SELECT });
  if (!s || s.parentUserId !== parentUserId) {
    throw appError('This student is not linked to your account', 'NOT_YOUR_CHILD', 403);
  }
  return s;
};

export const getChildFees = async (parentUserId: string, q: ParentFeesQuerySchema) => {
  const student = await requireOwnChild(parentUserId, q.studentId);
  const today = schoolToday();
  const [fees, payments] = await Promise.all([
    prisma.studentFee.findMany({
      where: { studentId: student.id, status: { not: 'CANCELLED' }, ...(q.sessionYear ? { sessionYear: q.sessionYear } : {}) },
      include: FEE_INCLUDE, orderBy: { dueDate: 'asc' },
    }),
    prisma.feePayment.findMany({
      where: { studentId: student.id, status: 'SUCCESS', ...(q.sessionYear ? { studentFee: { sessionYear: q.sessionYear } } : {}) },
      include: PAYMENT_INCLUDE, orderBy: { paidAt: 'desc' },
    }),
  ]);
  return {
    student:  studentView(student),
    totals:   totalsOf(fees, today),
    fees:     fees.map(f => feeView(f, today)),
    payments: payments.map(paymentView),
  };
};

export const getChildReceipt = async (parentUserId: string, paymentId: string) => {
  const p = await prisma.feePayment.findUnique({ where: { id: paymentId }, include: PAYMENT_INCLUDE });
  if (!p || p.status !== 'SUCCESS' || p.studentFee.student.parentUserId !== parentUserId) {
    throw appError('Receipt not found', 'PAYMENT_NOT_FOUND', 404);
  }
  return paymentView(p);
};
