import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db';
import { SubmitCrashReportSchema, ListCrashReportsQuerySchema } from './crashReports.validation';

const notFound = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 404;
  return err;
};

// ── POST /crash-reports — any authenticated user submits a report ──
export const submitCrashReport = async (
  userId: string,
  input:  SubmitCrashReportSchema,
) => {
  return prisma.crashReport.create({
    data: {
      userId,
      appVersion:   input.appVersion,
      buildNumber:  input.buildNumber,
      platform:     input.platform,
      osVersion:    input.osVersion,
      deviceModel:  input.deviceModel,
      errorMessage: input.errorMessage,
      stackTrace:   input.stackTrace,
      errorType:    input.errorType,
      isFatal:      input.isFatal,
      crashedAt:    input.crashedAt,
      metadata:     (input.metadata ?? {}) as any,
    },
  });
};

// ── GET /super-admin/crash-reports — paginated list (SUPER_ADMIN) ──
export const listCrashReports = async (query: ListCrashReportsQuerySchema) => {
  const { page, pageSize, platform, isFatal, search } = query;

  const where: Prisma.CrashReportWhereInput = {
    ...(platform !== undefined ? { platform } : {}),
    ...(isFatal !== undefined ? { isFatal } : {}),
    ...(search ? {
      OR: [
        { errorMessage: { contains: search, mode: 'insensitive' as const } },
        { errorType:    { contains: search, mode: 'insensitive' as const } },
        { deviceModel:  { contains: search, mode: 'insensitive' as const } },
      ],
    } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.crashReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip:    (page - 1) * pageSize,
      take:    pageSize,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
    }),
    prisma.crashReport.count({ where }),
  ]);

  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};

// ── GET /super-admin/crash-reports/:id — single report detail ──
export const getCrashReportById = async (id: string) => {
  const report = await prisma.crashReport.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true, role: true, phone: true } },
    },
  });
  if (!report) throw notFound('Crash report not found', 'CRASH_REPORT_NOT_FOUND');
  return report;
};

// ── GET /super-admin/crash-reports/stats — summary counts ──
export const getCrashReportStats = async () => {
  const [total, fatal, today, byPlatform] = await Promise.all([
    prisma.crashReport.count(),
    prisma.crashReport.count({ where: { isFatal: true } }),
    prisma.crashReport.count({
      where: {
        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }),
    prisma.crashReport.groupBy({
      by:      ['platform'],
      _count:  { id: true },
      orderBy: { _count: { id: 'desc' } },
    }),
  ]);

  return {
    total,
    fatal,
    nonFatal: total - fatal,
    today,
    byPlatform: byPlatform.map(p => ({
      platform: p.platform,
      count:    p._count.id,
    })),
  };
};
