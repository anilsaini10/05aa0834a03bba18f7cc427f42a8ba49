import { z } from 'zod';
import { EventType, AnnouncementAudience } from '@prisma/client';
import { prisma } from '../../config/db';
import {
  cellString, optionalCellString, cellDate,
  parseRows, bulkValidationError, findDuplicates, BulkRowResult,
} from '../../shared/utils/bulkImport';

// ════════════════════════════════════════════════════════════
// Bulk create events — e.g. a whole year's academic calendar from an
// Excel sheet. Same rules as the single create, applied to every row
// first; nothing is saved unless every row is valid. Bulk imports don't
// send a push notification per row (a year's calendar would spam
// everyone).
// ════════════════════════════════════════════════════════════

const key = (v: string) => v.trim().toLowerCase().replace(/[\s_\-]+/g, ' ');

// Spreadsheet labels → EventType.
const EVENT_TYPE_ALIASES: Record<string, EventType> = {
  'holiday': 'HOLIDAY', 'school holiday': 'HOLIDAY', 'local holiday': 'HOLIDAY',
  'government holiday': 'GOVERNMENT_HOLIDAY', 'govt holiday': 'GOVERNMENT_HOLIDAY', 'gov holiday': 'GOVERNMENT_HOLIDAY',
  'public holiday': 'GOVERNMENT_HOLIDAY', 'gazetted holiday': 'GOVERNMENT_HOLIDAY', 'national holiday': 'GOVERNMENT_HOLIDAY',
  'vacation': 'VACATION', 'leave': 'VACATION', 'break': 'VACATION', 'summer vacation': 'VACATION',
  'winter vacation': 'VACATION', 'autumn break': 'VACATION', 'diwali vacation': 'VACATION',
  'exam': 'EXAM', 'exams': 'EXAM', 'examination': 'EXAM', 'test': 'EXAM',
  'meeting': 'MEETING', 'ptm': 'MEETING', 'parent teacher meeting': 'MEETING',
  'activity': 'ACTIVITY', 'event': 'ACTIVITY', 'function': 'ACTIVITY', 'celebration': 'ACTIVITY', 'sports': 'ACTIVITY',
  'other': 'OTHER',
};
const AUDIENCE_ALIASES: Record<string, AnnouncementAudience> = {
  'all': 'ALL', 'everyone': 'ALL', 'both': 'ALL',
  'teacher': 'TEACHER', 'teachers': 'TEACHER', 'staff': 'TEACHER',
  'parent': 'PARENT', 'parents': 'PARENT', 'student': 'PARENT', 'students': 'PARENT',
};

const cellEnum = <T extends string>(aliases: Record<string, T>, values: readonly T[], label: string) =>
  z.preprocess(v => {
    if (typeof v !== 'string' || !v.trim()) return v === '' ? undefined : v;
    const raw = v.trim();
    return (values as readonly string[]).includes(raw.toUpperCase()) ? raw.toUpperCase() : aliases[key(raw)] ?? raw;
  }, z.enum(values as [T, ...T[]], { errorMap: () => ({ message: `${label} must be one of: ${values.join(', ')}` }) }));

export const bulkEventRowSchema = z.object({
  title:       cellString(z.string({ required_error: 'title is required' }).min(2, 'Title must be at least 2 characters').max(200)),
  description: optionalCellString(z.string().max(2000)),
  eventType:   cellEnum(EVENT_TYPE_ALIASES, Object.values(EventType), 'eventType'),
  audience:    cellEnum(AUDIENCE_ALIASES, Object.values(AnnouncementAudience), 'audience').optional().default('ALL'),
  startDate:   cellDate('startDate'),
  endDate:     cellDate('endDate').optional(),   // blank → one-day event
})
  .transform(r => ({ ...r, endDate: r.endDate ?? r.startDate }))
  .refine(r => r.endDate >= r.startDate, { message: 'endDate must be on or after startDate', path: ['endDate'] });

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export const bulkCreateEvents = async (schoolId: string, createdBy: string, rows: unknown[], dryRun: boolean) => {
  // A blank audience cell arrives as "" → treat like missing.
  const cleaned = rows.map(r => (r && typeof r === 'object' && (r as any).audience === '') ? { ...(r as any), audience: undefined } : r);
  const parsed  = parseRows(cleaned, bulkEventRowSchema);
  const results: BulkRowResult[] = parsed.map(p => ({
    index: p.index, status: p.errors.length ? 'error' : 'valid', ...(p.errors.length ? { errors: [...p.errors] } : {}),
  }));
  const addError = (index: number, message: string) => {
    const r = results[index];
    r.status = 'error';
    (r.errors ??= []).push(message);
  };

  const valid = parsed.filter(p => p.data) as { index: number; data: z.infer<typeof bulkEventRowSchema> }[];

  // Same title + type + dates twice → duplicate row, in the file or already saved
  // (so re-uploading the same calendar doesn't double it).
  const sig = (d: { title: string; eventType: string; startDate: Date; endDate: Date }) =>
    `${key(d.title)}|${d.eventType}|${dayKey(d.startDate)}|${dayKey(d.endDate)}`;

  for (const [index, first] of findDuplicates(valid.map(v => ({ index: v.index, key: sig(v.data) })))) {
    addError(index, `title: Same event as row index ${first}`);
  }
  if (valid.length) {
    const minStart = new Date(Math.min(...valid.map(v => v.data.startDate.getTime())));
    const maxEnd   = new Date(Math.max(...valid.map(v => v.data.endDate.getTime())));
    const existing = await prisma.event.findMany({
      where:  { schoolId, startDate: { gte: minStart, lte: maxEnd } },
      select: { title: true, eventType: true, startDate: true, endDate: true },
    });
    const saved = new Set(existing.map(sig));
    for (const v of valid) if (saved.has(sig(v.data))) addError(v.index, 'title: This event already exists on the calendar');
  }

  const invalid = results.filter(r => r.status === 'error').length;
  if (dryRun) {
    return { dryRun: true, total: results.length, valid: results.length - invalid, invalid, created: 0, results };
  }
  if (invalid > 0) throw bulkValidationError(results);

  const created = await prisma.event.createManyAndReturn({
    data: valid.map(v => ({
      schoolId, createdBy,
      title:       v.data.title,
      description: v.data.description ?? null,
      eventType:   v.data.eventType,
      audience:    v.data.audience,
      startDate:   v.data.startDate,
      endDate:     v.data.endDate,
    })),
  });

  // Match created rows back by their signature (unique within this upload).
  const bySig = new Map(created.map(e => [sig(e), e]));
  for (const v of valid) {
    const e = bySig.get(sig(v.data))!;
    Object.assign(results[v.index], { status: 'created', id: e.id, title: e.title, eventType: e.eventType });
  }

  return { dryRun: false, total: results.length, valid: results.length, invalid: 0, created: created.length, results };
};
