import { Prisma, Role } from '@prisma/client';
import { prisma } from '../../config/db';
import {
  CreateSupportQuerySchema,
  ListMySupportQueriesQuerySchema,
  ListAllSupportQueriesQuerySchema,
  UpdateSupportQuerySchema,
} from './support.validation';

const appError = (message: string, code: string, statusCode: number, details?: Record<string, unknown>) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = statusCode;
  if (details) err.details = details;
  return err;
};

const notFound = () => appError('Support query not found', 'SUPPORT_QUERY_NOT_FOUND', 404);

const MAX_QUERIES_PER_HOUR = 10;
const HOUR_MS              = 60 * 60 * 1000;

export interface RequestUser { sub: string; role: Role; schoolId: string | null }

// ── Response shapes ───────────────────────────────────────────
const QUERY_INCLUDE = {
  school:        true,
  createdByUser: true,
  repliedByUser: true,
} satisfies Prisma.SupportQueryInclude;

type QueryWithRefs = Prisma.SupportQueryGetPayload<{ include: typeof QUERY_INCLUDE }>;

// What the sender sees.
const toItem = (q: QueryWithRefs) => ({
  id:        q.id,
  subject:   q.subject,
  category:  q.category,
  message:   q.message,
  status:    q.status,
  reply:     q.reply,
  repliedAt: q.repliedAt,
  createdAt: q.createdAt,
  updatedAt: q.updatedAt,
});

// What the super admin sees — plus who/where it came from.
const toSuperAdminItem = (q: QueryWithRefs) => ({
  ...toItem(q),
  schoolId:   q.schoolId,
  schoolName: q.school.name,
  createdBy: {
    id:    q.createdByUser.id,
    name:  q.createdByUser.name,
    role:  q.createdByRole,
    email: q.createdByUser.email,
    phone: q.createdByUser.phone,
  },
  repliedBy: q.repliedByUser ? { id: q.repliedByUser.id, name: q.repliedByUser.name } : null,
});

const paginate = <T>(items: T[], page: number, pageSize: number, total: number) => ({
  items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)),
});

// ════════════════════════════════════════════════════════════
// ADMIN / TEACHER / PARENT — own queries only. schoolId and createdBy
// always come from the token, never from the request.
// ════════════════════════════════════════════════════════════

const requireSchool = (user: RequestUser): string => {
  if (!user.schoolId) throw appError('Your account is not linked to a school', 'FORBIDDEN', 403);
  return user.schoolId;
};

// ── POST /support/queries ─────────────────────────────────────
export const createSupportQuery = async (user: RequestUser, input: CreateSupportQuerySchema) => {
  const schoolId = requireSchool(user);

  const recent = await prisma.supportQuery.findMany({
    where:   { createdBy: user.sub, createdAt: { gt: new Date(Date.now() - HOUR_MS) } },
    orderBy: { createdAt: 'asc' },
    select:  { createdAt: true },
  });
  if (recent.length >= MAX_QUERIES_PER_HOUR) {
    const retryAfterSeconds = Math.ceil((recent[0].createdAt.getTime() + HOUR_MS - Date.now()) / 1000);
    throw appError(
      `You can send up to ${MAX_QUERIES_PER_HOUR} queries per hour. Please try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
      'TOO_MANY_REQUESTS', 429,
      { retryAfterSeconds },
    );
  }

  const created = await prisma.supportQuery.create({
    data: {
      schoolId,
      createdBy:     user.sub,
      createdByRole: user.role,
      subject:       input.subject,
      category:      input.category ?? null,
      message:       input.message,
    },
    include: QUERY_INCLUDE,
  });
  return toItem(created);
};

// ── GET /support/queries ──────────────────────────────────────
export const listMySupportQueries = async (user: RequestUser, query: ListMySupportQueriesQuerySchema) => {
  const schoolId = requireSchool(user);
  const where: Prisma.SupportQueryWhereInput = {
    schoolId,
    createdBy: user.sub,
    ...(query.status ? { status: query.status } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.supportQuery.findMany({
      where,
      include: QUERY_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip:    (query.page - 1) * query.pageSize,
      take:    query.pageSize,
    }),
    prisma.supportQuery.count({ where }),
  ]);
  return paginate(items.map(toItem), query.page, query.pageSize, total);
};

// ── GET /support/queries/:queryId ─────────────────────────────
export const getMySupportQuery = async (user: RequestUser, queryId: string) => {
  const schoolId = requireSchool(user);
  const q = await prisma.supportQuery.findFirst({
    where:   { id: queryId, schoolId, createdBy: user.sub },
    include: QUERY_INCLUDE,
  });
  if (!q) throw notFound();
  return toItem(q);
};

// ════════════════════════════════════════════════════════════
// SUPER_ADMIN — every query across all schools.
// ════════════════════════════════════════════════════════════

// ── GET /super-admin/support/queries ──────────────────────────
export const listAllSupportQueries = async (query: ListAllSupportQueriesQuerySchema) => {
  const where: Prisma.SupportQueryWhereInput = {
    ...(query.status   ? { status: query.status }          : {}),
    ...(query.schoolId ? { schoolId: query.schoolId }      : {}),
    ...(query.role     ? { createdByRole: query.role }     : {}),
    ...(query.category ? { category: query.category }      : {}),
    ...(query.search   ? { subject: { contains: query.search, mode: 'insensitive' } } : {}),
  };

  const [items, total, statusCounts] = await Promise.all([
    prisma.supportQuery.findMany({
      where,
      include: QUERY_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip:    (query.page - 1) * query.pageSize,
      take:    query.pageSize,
    }),
    prisma.supportQuery.count({ where }),
    prisma.supportQuery.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  return {
    ...paginate(items.map(toSuperAdminItem), query.page, query.pageSize, total),
    // Totals across ALL queries (ignores filters) — for the status tabs.
    statusCounts: Object.fromEntries(
      (['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const).map(s => [
        s, statusCounts.find(c => c.status === s)?._count._all ?? 0,
      ]),
    ),
  };
};

// ── GET /super-admin/support/queries/:queryId ─────────────────
export const getSupportQueryById = async (queryId: string) => {
  const q = await prisma.supportQuery.findUnique({ where: { id: queryId }, include: QUERY_INCLUDE });
  if (!q) throw notFound();
  return toSuperAdminItem(q);
};

// ── PATCH /super-admin/support/queries/:queryId ───────────────
// repliedAt/repliedBy move only when the reply text actually changes;
// reply: null clears the reply.
export const updateSupportQuery = async (queryId: string, superAdminId: string, input: UpdateSupportQuerySchema) => {
  const existing = await prisma.supportQuery.findUnique({ where: { id: queryId } });
  if (!existing) throw notFound();

  const replyChanged = input.reply !== undefined && input.reply !== existing.reply;

  const updated = await prisma.supportQuery.update({
    where: { id: queryId },
    data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(replyChanged ? {
        reply:     input.reply,
        repliedAt: input.reply === null ? null : new Date(),
        repliedBy: input.reply === null ? null : superAdminId,
      } : {}),
    },
    include: QUERY_INCLUDE,
  });
  return toSuperAdminItem(updated);
};
