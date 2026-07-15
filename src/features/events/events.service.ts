import { Prisma, Event, User } from '@prisma/client';
import { prisma } from '../../config/db';
import {
  CreateEventSchema,
  UpdateEventSchema,
  ListEventsQuerySchema,
} from './events.validation';

type EventWithCreator = Event & { createdByUser: User };

export interface EventResponse {
  id:          string;
  title:       string;
  description: string | null;
  eventType:   string;
  audience:    string;
  startDate:   Date;
  endDate:     Date;
  createdBy:   { id: string; name: string };
  createdAt:   Date;
  updatedAt:   Date;
}

const notFound = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 404;
  return err;
};

const badRequest = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 400;
  return err;
};

const toResponse = (e: EventWithCreator): EventResponse => ({
  id:          e.id,
  title:       e.title,
  description: e.description,
  eventType:   e.eventType,
  audience:    e.audience,
  startDate:   e.startDate,
  endDate:     e.endDate,
  createdBy:   { id: e.createdByUser.id, name: e.createdByUser.name },
  createdAt:   e.createdAt,
  updatedAt:   e.updatedAt,
});

// ── Create ────────────────────────────────────────────────────
export const createEvent = async (
  schoolId: string,
  createdBy: string,
  input: CreateEventSchema,
): Promise<EventResponse> => {
  const event = await prisma.event.create({
    data: {
      schoolId,
      createdBy,
      title:       input.title,
      description: input.description ?? null,
      eventType:   input.eventType,
      audience:    input.audience,
      startDate:   input.startDate,
      endDate:     input.endDate,
    },
    include: { createdByUser: true },
  });

  return toResponse(event);
};

// ── List (paginated, searchable, filterable, date-range overlap) ─
export const listEvents = async (schoolId: string, query: ListEventsQuerySchema) => {
  const { page, pageSize, search, eventType, audience, from, to } = query;

  const where: Prisma.EventWhereInput = {
    schoolId,
    ...(eventType ? { eventType } : {}),
    ...(audience ? { audience } : {}),
    ...(from ? { endDate: { gte: from } } : {}),
    ...(to ? { startDate: { lte: to } } : {}),
    ...(search ? {
      OR: [
        { title:       { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.event.findMany({
      where,
      include:  { createdByUser: true },
      orderBy:  { startDate: 'asc' },
      skip:     (page - 1) * pageSize,
      take:     pageSize,
    }),
    prisma.event.count({ where }),
  ]);

  return {
    items: items.map(toResponse),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};

// ── Get one ───────────────────────────────────────────────────
export const getEventById = async (schoolId: string, id: string): Promise<EventResponse> => {
  const event = await prisma.event.findFirst({
    where:   { id, schoolId },
    include: { createdByUser: true },
  });
  if (!event) throw notFound('Event not found', 'EVENT_NOT_FOUND');
  return toResponse(event);
};

// ── Update ────────────────────────────────────────────────────
export const updateEvent = async (
  schoolId: string,
  id: string,
  input: UpdateEventSchema,
): Promise<EventResponse> => {
  const existing = await prisma.event.findFirst({ where: { id, schoolId } });
  if (!existing) throw notFound('Event not found', 'EVENT_NOT_FOUND');

  // Cross-check the merged (existing + incoming) date range — zod can only
  // validate fields present in this single request, not against the DB row.
  const startDate = input.startDate ?? existing.startDate;
  const endDate    = input.endDate ?? existing.endDate;
  if (endDate < startDate) {
    throw badRequest('endDate must be on or after startDate', 'INVALID_DATE_RANGE');
  }

  const event = await prisma.event.update({
    where:   { id },
    data:    input,
    include: { createdByUser: true },
  });

  return toResponse(event);
};

// ── Delete ────────────────────────────────────────────────────
export const deleteEvent = async (schoolId: string, id: string): Promise<void> => {
  const existing = await prisma.event.findFirst({ where: { id, schoolId } });
  if (!existing) throw notFound('Event not found', 'EVENT_NOT_FOUND');

  await prisma.event.delete({ where: { id } });
};
