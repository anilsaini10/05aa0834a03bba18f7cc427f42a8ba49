import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/db';
import { NOTIFICATION_TYPE } from '../../../constants';
import { notifyUser } from '../../notifications/notifications.service';
import { schoolToday, toDay } from '../analytics/analytics.utils';
import {
  CreateInterventionSchema, UpdateInterventionSchema, ListInterventionsQuerySchema, INTERVENTION_ENTITY_TYPES,
} from './interventions.validation';

const appError = (message: string, code: string, statusCode: number) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = statusCode;
  return err;
};

const notFound = () => appError('Intervention not found', 'INTERVENTION_NOT_FOUND', 404);

type EntityType = (typeof INTERVENTION_ENTITY_TYPES)[number];

const INCLUDE = {
  assignedToUser: { select: { id: true, name: true, role: true } },
  createdByUser:  { select: { id: true, name: true } },
} satisfies Prisma.InterventionInclude;

type WithRefs = Prisma.InterventionGetPayload<{ include: typeof INCLUDE }>;

const toItem = (i: WithRefs, today = schoolToday()) => ({
  id:           i.id,
  alertKey:     i.alertKey,
  alertType:    i.alertType,
  entityType:   i.entityType,
  entityId:     i.entityId,
  title:        i.title,
  description:  i.description,
  actionTaken:  i.actionTaken,
  status:       i.status,
  assignedTo:   i.assignedToUser,
  dueDate:      i.dueDate ? toDay(i.dueDate) : null,
  followUpDate: i.followUpDate ? toDay(i.followUpDate) : null,
  overdue:      !!i.dueDate && i.dueDate < today && (i.status === 'OPEN' || i.status === 'IN_PROGRESS'),
  outcome:      i.outcome,
  completedAt:  i.completedAt,
  createdBy:    i.createdByUser,
  createdAt:    i.createdAt,
  updatedAt:    i.updatedAt,
});

// The entity must exist in this school — stops linking (and later
// exposing) another school's student/teacher via a crafted id.
const ENTITY_CHECKS: Record<EntityType, (id: string, schoolId: string) => Promise<unknown>> = {
  STUDENT:    (id, schoolId) => prisma.student.findFirst({ where: { id, schoolId }, select: { id: true } }),
  TEACHER:    (id, schoolId) => prisma.teacher.findFirst({ where: { id, schoolId }, select: { id: true } }),
  CLASS:      (id, schoolId) => prisma.class.findFirst({ where: { id, schoolId }, select: { id: true } }),
  SECTION:    (id, schoolId) => prisma.section.findFirst({ where: { id, class: { schoolId } }, select: { id: true } }),
  SUBJECT:    (id, schoolId) => prisma.subject.findFirst({ where: { id, schoolId }, select: { id: true } }),
  EXAM_PAPER: (id, schoolId) => prisma.examSchedule.findFirst({ where: { id, schoolId }, select: { id: true } }),
  HOMEWORK:   (id, schoolId) => prisma.homework.findFirst({ where: { id, schoolId }, select: { id: true } }),
};

const requireAssignee = async (schoolId: string, userId: string) => {
  const user = await prisma.user.findFirst({
    where:  { id: userId, schoolId, role: { in: ['ADMIN', 'TEACHER'] }, isActive: true },
    select: { id: true },
  });
  if (!user) throw appError('Assignee must be an active admin or teacher of this school', 'INVALID_ASSIGNEE', 400);
};

const notifyAssignee = (userId: string, i: { id: string; title: string; dueDate: Date | null }) =>
  notifyUser(userId, {
    title: 'New intervention assigned',
    body:  i.dueDate ? `${i.title} — due ${toDay(i.dueDate)}` : i.title,
    data:  { type: NOTIFICATION_TYPE.INTERVENTION, interventionId: i.id },
  });

const statusTimestamps = (status: string | undefined) =>
  status === undefined ? {} : { completedAt: status === 'COMPLETED' ? new Date() : null };

// ── POST /admin/interventions ─────────────────────────────────
export const createIntervention = async (schoolId: string, adminId: string, input: CreateInterventionSchema) => {
  if (!(await ENTITY_CHECKS[input.entityType](input.entityId, schoolId))) {
    throw appError(`${input.entityType} not found`, 'ENTITY_NOT_FOUND', 404);
  }
  if (input.assignedTo) await requireAssignee(schoolId, input.assignedTo);

  const created = await prisma.intervention.create({
    data: {
      schoolId,
      createdBy:    adminId,
      alertKey:     input.alertKey ?? null,
      alertType:    input.alertType ?? null,
      entityType:   input.entityType,
      entityId:     input.entityId,
      title:        input.title,
      description:  input.description ?? null,
      actionTaken:  input.actionTaken ?? null,
      status:       input.status,
      assignedTo:   input.assignedTo ?? null,
      dueDate:      input.dueDate ?? null,
      followUpDate: input.followUpDate ?? null,
      completedAt:  input.status === 'COMPLETED' ? new Date() : null,
    },
    include: INCLUDE,
  });

  if (created.assignedTo && created.assignedTo !== adminId) void notifyAssignee(created.assignedTo, created);
  return toItem(created);
};

// ── PATCH /admin/interventions/:id ────────────────────────────
export const updateIntervention = async (schoolId: string, adminId: string, id: string, input: UpdateInterventionSchema) => {
  const existing = await prisma.intervention.findFirst({ where: { id, schoolId } });
  if (!existing) throw notFound();
  if (input.assignedTo) await requireAssignee(schoolId, input.assignedTo);

  const statusChanged = input.status !== undefined && input.status !== existing.status;
  const updated = await prisma.intervention.update({
    where: { id },
    data: {
      ...(input.title        !== undefined ? { title: input.title }               : {}),
      ...(input.description  !== undefined ? { description: input.description }   : {}),
      ...(input.actionTaken  !== undefined ? { actionTaken: input.actionTaken }   : {}),
      ...(input.assignedTo   !== undefined ? { assignedTo: input.assignedTo }     : {}),
      ...(input.dueDate      !== undefined ? { dueDate: input.dueDate }           : {}),
      ...(input.followUpDate !== undefined ? { followUpDate: input.followUpDate } : {}),
      ...(input.outcome      !== undefined ? { outcome: input.outcome }           : {}),
      ...(statusChanged ? { status: input.status, ...statusTimestamps(input.status) } : {}),
    },
    include: INCLUDE,
  });

  if (input.assignedTo && input.assignedTo !== existing.assignedTo && input.assignedTo !== adminId) {
    void notifyAssignee(input.assignedTo, updated);
  }
  return toItem(updated);
};

// ── GET /admin/interventions/:id ──────────────────────────────
export const getIntervention = async (schoolId: string, id: string) => {
  const i = await prisma.intervention.findFirst({ where: { id, schoolId }, include: INCLUDE });
  if (!i) throw notFound();
  return toItem(i);
};

// ── GET /admin/interventions ──────────────────────────────────
export const listInterventions = async (schoolId: string, q: ListInterventionsQuerySchema) => {
  const today = schoolToday();
  const where: Prisma.InterventionWhereInput = {
    schoolId,
    ...(q.status     ? { status: q.status }         : {}),
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.entityId   ? { entityId: q.entityId }     : {}),
    ...(q.alertType  ? { alertType: q.alertType }   : {}),
    ...(q.alertKey   ? { alertKey: q.alertKey }     : {}),
    ...(q.assignedTo ? { assignedTo: q.assignedTo } : {}),
    ...(q.overdue === true ? { dueDate: { lt: today }, status: { in: ['OPEN', 'IN_PROGRESS'] } } : {}),
  };

  const [items, total, statusCounts] = await Promise.all([
    prisma.intervention.findMany({
      where,
      include: INCLUDE,
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      skip:    (q.page - 1) * q.pageSize,
      take:    q.pageSize,
    }),
    prisma.intervention.count({ where }),
    prisma.intervention.groupBy({ by: ['status'], where: { schoolId }, _count: { _all: true } }),
  ]);

  return {
    items: items.map(i => toItem(i, today)),
    page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    statusCounts: Object.fromEntries(
      (['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const).map(s => [s, statusCounts.find(c => c.status === s)?._count._all ?? 0]),
    ),
  };
};
