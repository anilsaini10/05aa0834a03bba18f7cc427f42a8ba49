import { Prisma, Announcement, User } from '@prisma/client';
import { prisma } from '../../../config/db';
import {
  CreateAnnouncementSchema,
  UpdateAnnouncementSchema,
  ListAnnouncementsQuerySchema,
} from './announcements.validation';

type AnnouncementWithCreator = Announcement & { createdByUser: User };

export interface AnnouncementResponse {
  id:        string;
  title:     string;
  message:   string;
  audience:  string;
  eventDate: Date | null;
  publishAt: Date | null;
  expiresAt: Date | null;
  status:    'SCHEDULED' | 'ACTIVE' | 'EXPIRED';
  createdBy: { id: string; name: string };
  createdAt: Date;
  updatedAt: Date;
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

const computeStatus = (publishAt: Date | null, expiresAt: Date | null): 'SCHEDULED' | 'ACTIVE' | 'EXPIRED' => {
  const now = new Date();
  if (publishAt && now < publishAt) return 'SCHEDULED';
  if (expiresAt && now > expiresAt) return 'EXPIRED';
  return 'ACTIVE';
};

const toResponse = (a: AnnouncementWithCreator): AnnouncementResponse => ({
  id:        a.id,
  title:     a.title,
  message:   a.message,
  audience:  a.audience,
  eventDate: a.eventDate,
  publishAt: a.publishAt,
  expiresAt: a.expiresAt,
  status:    computeStatus(a.publishAt, a.expiresAt),
  createdBy: { id: a.createdByUser.id, name: a.createdByUser.name },
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
});

// ── Create ────────────────────────────────────────────────────
export const createAnnouncement = async (
  schoolId: string,
  createdBy: string,
  input: CreateAnnouncementSchema,
): Promise<AnnouncementResponse> => {
  const announcement = await prisma.announcement.create({
    data: {
      schoolId,
      createdBy,
      title:     input.title,
      message:   input.message,
      audience:  input.audience,
      eventDate: input.eventDate ?? null,
      publishAt: input.publishAt ?? null,
      expiresAt: input.expiresAt ?? null,
    },
    include: { createdByUser: true },
  });

  return toResponse(announcement);
};

// ── List (paginated, searchable, audience-filterable) ────────────
// NOTE: admin sees every announcement regardless of publish/expiry window —
// self-service teacher/parent feeds are the ones that filter by the window.
export const listAnnouncements = async (schoolId: string, query: ListAnnouncementsQuerySchema) => {
  const { page, pageSize, search, audience } = query;

  const where: Prisma.AnnouncementWhereInput = {
    schoolId,
    ...(audience ? { audience } : {}),
    ...(search ? {
      OR: [
        { title:   { contains: search, mode: 'insensitive' } },
        { message: { contains: search, mode: 'insensitive' } },
      ],
    } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.announcement.findMany({
      where,
      include:  { createdByUser: true },
      orderBy:  { createdAt: 'desc' },
      skip:     (page - 1) * pageSize,
      take:     pageSize,
    }),
    prisma.announcement.count({ where }),
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
export const getAnnouncementById = async (
  schoolId: string,
  id: string,
): Promise<AnnouncementResponse> => {
  const announcement = await prisma.announcement.findFirst({
    where:   { id, schoolId },
    include: { createdByUser: true },
  });
  if (!announcement) throw notFound('Announcement not found', 'ANNOUNCEMENT_NOT_FOUND');
  return toResponse(announcement);
};

// ── Update ────────────────────────────────────────────────────
export const updateAnnouncement = async (
  schoolId: string,
  id: string,
  input: UpdateAnnouncementSchema,
): Promise<AnnouncementResponse> => {
  const existing = await prisma.announcement.findFirst({ where: { id, schoolId } });
  if (!existing) throw notFound('Announcement not found', 'ANNOUNCEMENT_NOT_FOUND');

  // Cross-check the merged (existing + incoming) date range — zod can only
  // validate fields present in this single request, not against the DB row.
  const publishAt = input.publishAt !== undefined ? input.publishAt : existing.publishAt;
  const expiresAt = input.expiresAt !== undefined ? input.expiresAt : existing.expiresAt;
  if (publishAt && expiresAt && expiresAt <= publishAt) {
    throw badRequest('expiresAt must be after publishAt', 'INVALID_DATE_RANGE');
  }

  const announcement = await prisma.announcement.update({
    where:   { id },
    data:    input,
    include: { createdByUser: true },
  });

  return toResponse(announcement);
};

// ── Delete ────────────────────────────────────────────────────
export const deleteAnnouncement = async (schoolId: string, id: string): Promise<void> => {
  const existing = await prisma.announcement.findFirst({ where: { id, schoolId } });
  if (!existing) throw notFound('Announcement not found', 'ANNOUNCEMENT_NOT_FOUND');

  await prisma.announcement.delete({ where: { id } });
};
