import { prisma } from '../../../config/db';
import { CreateSessionSchema, UpdateSessionSchema } from './academicSessions.validation';

const notFound = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code = code; err.statusCode = 404;
  return err;
};

const conflict = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code = code; err.statusCode = 409;
  return err;
};

export const createSession = async (schoolId: string, input: CreateSessionSchema) => {
  const existing = await prisma.academicSession.findUnique({
    where: { schoolId_name: { schoolId, name: input.name } },
  });
  if (existing) throw conflict('A session with this name already exists', 'SESSION_EXISTS');

  return prisma.$transaction(async (tx) => {
    if (input.isCurrent) {
      await tx.academicSession.updateMany({
        where: { schoolId, isCurrent: true },
        data:  { isCurrent: false },
      });
    }
    return tx.academicSession.create({
      data: { schoolId, ...input, isCurrent: input.isCurrent ?? false },
    });
  });
};

export const updateSession = async (schoolId: string, sessionId: string, input: UpdateSessionSchema) => {
  const session = await prisma.academicSession.findFirst({ where: { id: sessionId, schoolId } });
  if (!session) throw notFound('Academic session not found', 'SESSION_NOT_FOUND');

  if (input.name && input.name !== session.name) {
    const dup = await prisma.academicSession.findUnique({
      where: { schoolId_name: { schoolId, name: input.name } },
    });
    if (dup) throw conflict('A session with this name already exists', 'SESSION_EXISTS');
  }

  return prisma.$transaction(async (tx) => {
    if (input.isCurrent) {
      await tx.academicSession.updateMany({
        where: { schoolId, isCurrent: true, NOT: { id: sessionId } },
        data:  { isCurrent: false },
      });
    }
    return tx.academicSession.update({ where: { id: sessionId }, data: input });
  });
};

export const listSessions = async (schoolId: string) => {
  return prisma.academicSession.findMany({
    where:   { schoolId },
    orderBy: { startDate: 'desc' },
  });
};

export const getSessionById = async (schoolId: string, sessionId: string) => {
  const session = await prisma.academicSession.findFirst({ where: { id: sessionId, schoolId } });
  if (!session) throw notFound('Academic session not found', 'SESSION_NOT_FOUND');
  return session;
};

export const getCurrentSession = async (schoolId: string) => {
  const session = await prisma.academicSession.findFirst({ where: { schoolId, isCurrent: true } });
  if (!session) throw notFound('No current academic session set — please create one first', 'NO_CURRENT_SESSION');
  return session;
};

export const deleteSession = async (schoolId: string, sessionId: string) => {
  const session = await prisma.academicSession.findFirst({
    where: { id: sessionId, schoolId },
    include: { _count: { select: { promotionBatches: true, admissions: true } } },
  });
  if (!session) throw notFound('Academic session not found', 'SESSION_NOT_FOUND');
  if (session._count.promotionBatches > 0 || session._count.admissions > 0) {
    throw conflict('Cannot delete a session that has promotions or admissions linked to it', 'SESSION_IN_USE');
  }
  await prisma.academicSession.delete({ where: { id: sessionId } });
  return session;
};
