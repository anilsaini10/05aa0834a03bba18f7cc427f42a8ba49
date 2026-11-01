import { Prisma, Role } from '@prisma/client';
import { prisma } from '../../config/db';
import { resetPasswordToDefault } from '../../shared/services/account.service';
import { CreateRecoveryRequestSchema, ListRecoveryRequestsQuerySchema } from './accountRecovery.validation';

const appError = (message: string, code: string, statusCode: number) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = statusCode;
  return err;
};

const notFound = () => appError('Recovery request not found', 'RECOVERY_REQUEST_NOT_FOUND', 404);

// Same roles a school ADMIN may reset (see admin/users). Admins who are
// locked out go to the super admin instead.
const RECOVERABLE_ROLES: Role[] = ['TEACHER', 'PARENT'];

// ── Response shape ────────────────────────────────────────────
const REQUEST_INCLUDE = {
  user:           { select: { id: true, name: true, role: true, email: true, phone: true, username: true, isActive: true } },
  resolvedByUser: { select: { id: true, name: true } },
} satisfies Prisma.AccountRecoveryRequestInclude;

type RequestWithRefs = Prisma.AccountRecoveryRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;

// `submitted` is what the requester typed; `account` is the login it
// matched — the admin compares the two before resetting.
const toItem = (r: RequestWithRefs) => ({
  id:     r.id,
  status: r.status,
  submitted: {
    name:   r.name,
    email:  r.email,
    phones: r.phones,
  },
  account:    r.user,
  resolvedBy: r.resolvedByUser,
  resolvedAt: r.resolvedAt,
  createdAt:  r.createdAt,
  updatedAt:  r.updatedAt,
});

const paginate = <T>(items: T[], page: number, pageSize: number, total: number) => ({
  items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)),
});

// ════════════════════════════════════════════════════════════
// Public — POST /account-recovery/requests
// Always resolves the same way whether or not anything matched, so the
// endpoint can't be used to find out which emails/phones are registered.
// ════════════════════════════════════════════════════════════

export const createRecoveryRequest = async (input: CreateRecoveryRequestSchema): Promise<void> => {
  const phones = [...new Set([input.phone1, input.phone2, input.phone3].filter((p): p is string => !!p))];

  const userMatch: Prisma.UserWhereInput[] = [
    ...(input.email   ? [{ email: { equals: input.email, mode: 'insensitive' as const } }] : []),
    ...(phones.length ? [{ phone: { in: phones } }] : []),
  ];
  // A parent's login can differ from the contact details on their
  // child's record, so match those too.
  const studentMatch: Prisma.StudentWhereInput[] = [
    ...(input.email   ? [{ parentEmail: { equals: input.email, mode: 'insensitive' as const } }] : []),
    ...(phones.length ? [{ parentPhone: { in: phones } }] : []),
  ];

  const users = await prisma.user.findMany({
    where: {
      role:     { in: RECOVERABLE_ROLES },
      isActive: true,
      schoolId: { not: null },
      OR: [
        ...userMatch,
        { role: 'PARENT', parentOfStudents: { some: { OR: studentMatch } } },
      ],
    },
    select: { id: true, schoolId: true },
  });

  for (const user of users) {
    const data = { name: input.name, email: input.email ?? null, phones };
    const pending = await prisma.accountRecoveryRequest.findFirst({
      where:  { userId: user.id, status: 'PENDING' },
      select: { id: true },
    });
    // One open request per user — a re-submit just refreshes it.
    if (pending) {
      await prisma.accountRecoveryRequest.update({ where: { id: pending.id }, data });
    } else {
      await prisma.accountRecoveryRequest.create({ data: { ...data, userId: user.id, schoolId: user.schoolId! } });
    }
  }
};

// ════════════════════════════════════════════════════════════
// ADMIN — own school's requests only.
// ════════════════════════════════════════════════════════════

const findInSchool = async (schoolId: string, requestId: string) => {
  const r = await prisma.accountRecoveryRequest.findFirst({
    where:   { id: requestId, schoolId },
    include: REQUEST_INCLUDE,
  });
  if (!r) throw notFound();
  return r;
};

const requirePending = (r: RequestWithRefs) => {
  if (r.status !== 'PENDING') {
    throw appError(`This request is already ${r.status.toLowerCase()}`, 'RECOVERY_REQUEST_NOT_PENDING', 409);
  }
};

// ── GET /admin/account-recovery/requests ──────────────────────
export const listRecoveryRequests = async (schoolId: string, query: ListRecoveryRequestsQuerySchema) => {
  const where: Prisma.AccountRecoveryRequestWhereInput = {
    schoolId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.search ? {
      OR: [
        { name:   { contains: query.search, mode: 'insensitive' } },
        { email:  { contains: query.search, mode: 'insensitive' } },
        { phones: { has: query.search } },
        { user:   { name: { contains: query.search, mode: 'insensitive' } } },
      ],
    } : {}),
  };

  const [items, total, statusCounts] = await Promise.all([
    prisma.accountRecoveryRequest.findMany({
      where,
      include: REQUEST_INCLUDE,
      orderBy: { updatedAt: 'desc' },
      skip:    (query.page - 1) * query.pageSize,
      take:    query.pageSize,
    }),
    prisma.accountRecoveryRequest.count({ where }),
    prisma.accountRecoveryRequest.groupBy({ by: ['status'], where: { schoolId }, _count: { _all: true } }),
  ]);

  return {
    ...paginate(items.map(toItem), query.page, query.pageSize, total),
    // Totals for this school (ignores filters) — for the status tabs / badge.
    statusCounts: Object.fromEntries(
      (['PENDING', 'RESOLVED', 'REJECTED'] as const).map(s => [
        s, statusCounts.find(c => c.status === s)?._count._all ?? 0,
      ]),
    ),
  };
};

// ── GET /admin/account-recovery/requests/:requestId ───────────
export const getRecoveryRequest = async (schoolId: string, requestId: string) =>
  toItem(await findInSchool(schoolId, requestId));

// ── POST /admin/account-recovery/requests/:requestId/reset ────
// Hard reset: password back to the default and every session logged out.
export const resetFromRecoveryRequest = async (schoolId: string, adminId: string, requestId: string) => {
  const r = await findInSchool(schoolId, requestId);
  requirePending(r);

  const { defaultPassword } = await resetPasswordToDefault(r.userId);
  const updated = await prisma.accountRecoveryRequest.update({
    where:   { id: r.id },
    data:    { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: adminId },
    include: REQUEST_INCLUDE,
  });
  return { ...toItem(updated), defaultPassword };
};

// ── POST /admin/account-recovery/requests/:requestId/reject ───
export const rejectRecoveryRequest = async (schoolId: string, adminId: string, requestId: string) => {
  const r = await findInSchool(schoolId, requestId);
  requirePending(r);

  const updated = await prisma.accountRecoveryRequest.update({
    where:   { id: r.id },
    data:    { status: 'REJECTED', resolvedAt: new Date(), resolvedBy: adminId },
    include: REQUEST_INCLUDE,
  });
  return toItem(updated);
};
