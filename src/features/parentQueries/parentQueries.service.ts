import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db';
import {
  CreateParentQuerySchema,
  ListMyParentQueriesQuerySchema,
  ListParentQueriesQuerySchema,
  UpdateParentQuerySchema,
} from './parentQueries.validation';

const appError = (message: string, code: string, statusCode: number, details?: Record<string, unknown>) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = statusCode;
  if (details) err.details = details;
  return err;
};

const notFound = () => appError('Parent query not found', 'PARENT_QUERY_NOT_FOUND', 404);

const MAX_QUERIES_PER_HOUR = 10;
const HOUR_MS              = 60 * 60 * 1000;

export interface RequestUser { sub: string; role: string; schoolId: string | null }

const QUERY_INCLUDE = {
  school:        true,
  createdByUser: true,
  repliedByUser: true,
} satisfies Prisma.ParentQueryInclude;

type QueryWithRefs = Prisma.ParentQueryGetPayload<{ include: typeof QUERY_INCLUDE }>;

const toParentItem = (q: QueryWithRefs) => ({
  id:        q.id,
  subject:   q.subject,
  message:   q.message,
  status:    q.status,
  reply:     q.reply,
  repliedAt: q.repliedAt,
  createdAt: q.createdAt,
  updatedAt: q.updatedAt,
});

const toAdminItem = (q: QueryWithRefs) => ({
  ...toParentItem(q),
  schoolId:   q.schoolId,
  schoolName: q.school.name,
  createdBy: {
    id:    q.createdByUser.id,
    name:  q.createdByUser.name,
    email: q.createdByUser.email,
    phone: q.createdByUser.phone,
  },
  repliedBy: q.repliedByUser ? { id: q.repliedByUser.id, name: q.repliedByUser.name } : null,
});

const paginate = <T>(items: T[], page: number, pageSize: number, total: number) => ({
  items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)),
});

const requireSchool = (user: RequestUser): string => {
  if (!user.schoolId) throw appError('Your account is not linked to a school', 'FORBIDDEN', 403);
  return user.schoolId;
};

// ════════════════════════════════════════════════════════════
// PARENT — own queries
// ════════════════════════════════════════════════════════════

export const createParentQuery = async (user: RequestUser, input: CreateParentQuerySchema) => {
  const schoolId = requireSchool(user);

  const recent = await prisma.parentQuery.findMany({
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

  const created = await prisma.parentQuery.create({
    data: {
      schoolId,
      createdBy: user.sub,
      subject:   input.subject,
      message:   input.message,
    },
    include: QUERY_INCLUDE,
  });
  return toParentItem(created);
};

export const listMyParentQueries = async (user: RequestUser, query: ListMyParentQueriesQuerySchema) => {
  const schoolId = requireSchool(user);
  const where: Prisma.ParentQueryWhereInput = {
    schoolId,
    createdBy: user.sub,
    ...(query.status ? { status: query.status } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.parentQuery.findMany({
      where,
      include: QUERY_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip:    (query.page - 1) * query.pageSize,
      take:    query.pageSize,
    }),
    prisma.parentQuery.count({ where }),
  ]);
  return paginate(items.map(toParentItem), query.page, query.pageSize, total);
};

export const getMyParentQuery = async (user: RequestUser, queryId: string) => {
  const schoolId = requireSchool(user);
  const q = await prisma.parentQuery.findFirst({
    where:   { id: queryId, schoolId, createdBy: user.sub },
    include: QUERY_INCLUDE,
  });
  if (!q) throw notFound();
  return toParentItem(q);
};

// ════════════════════════════════════════════════════════════
// ADMIN / PRINCIPAL — school-scoped queries
// ════════════════════════════════════════════════════════════

export const listParentQueries = async (user: RequestUser, query: ListParentQueriesQuerySchema) => {
  const schoolId = requireSchool(user);
  const where: Prisma.ParentQueryWhereInput = {
    schoolId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.search ? {
      OR: [
        { subject: { contains: query.search, mode: 'insensitive' as const } },
        { message: { contains: query.search, mode: 'insensitive' as const } },
        { createdByUser: { name: { contains: query.search, mode: 'insensitive' as const } } },
      ],
    } : {}),
  };

  const [items, total, statusCounts] = await Promise.all([
    prisma.parentQuery.findMany({
      where,
      include: QUERY_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip:    (query.page - 1) * query.pageSize,
      take:    query.pageSize,
    }),
    prisma.parentQuery.count({ where }),
    prisma.parentQuery.groupBy({ by: ['status'], where: { schoolId }, _count: { _all: true } }),
  ]);

  return {
    ...paginate(items.map(toAdminItem), query.page, query.pageSize, total),
    statusCounts: Object.fromEntries(
      (['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const).map(s => [
        s, statusCounts.find(c => c.status === s)?._count._all ?? 0,
      ]),
    ),
  };
};

export const getParentQueryById = async (user: RequestUser, queryId: string) => {
  const schoolId = requireSchool(user);
  const q = await prisma.parentQuery.findFirst({
    where:   { id: queryId, schoolId },
    include: QUERY_INCLUDE,
  });
  if (!q) throw notFound();
  return toAdminItem(q);
};

export const updateParentQuery = async (user: RequestUser, queryId: string, input: UpdateParentQuerySchema) => {
  const schoolId = requireSchool(user);
  const existing = await prisma.parentQuery.findFirst({ where: { id: queryId, schoolId } });
  if (!existing) throw notFound();

  const replyChanged = input.reply !== undefined && input.reply !== existing.reply;

  const updated = await prisma.parentQuery.update({
    where: { id: queryId },
    data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(replyChanged ? {
        reply:     input.reply,
        repliedAt: input.reply === null ? null : new Date(),
        repliedBy: input.reply === null ? null : user.sub,
      } : {}),
    },
    include: QUERY_INCLUDE,
  });
  return toAdminItem(updated);
};
