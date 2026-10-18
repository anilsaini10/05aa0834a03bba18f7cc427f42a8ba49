import { z, ZodTypeAny } from 'zod';
import { Gender } from '@prisma/client';
import { normalizePhone } from './phone';

// ════════════════════════════════════════════════════════════
// Bulk create from a spreadsheet. The frontend reads the Excel file and
// POSTs its rows as JSON to the normal create endpoint (array body).
// These helpers make row fields tolerant of how spreadsheets hold values
// (blank cells, "Male"/"M", 15/08/2015 or Excel date serials, numbers as
// text, phones with +91/spaces) and turn per-row problems into a report.
// ════════════════════════════════════════════════════════════

export const MAX_BULK_ROWS = 500;

// ── Request body: either `[...]` or `{ rows: [...], dryRun? }` ─────
// dryRun can also come from `?dryRun=true`.
export const isBulkBody = (body: unknown): boolean =>
  Array.isArray(body) || (typeof body === 'object' && body !== null && Array.isArray((body as any).rows));

export const parseBulkRequest = (body: unknown, query: Record<string, unknown>) => {
  const rows   = Array.isArray(body) ? body : (body as any).rows;
  const dryRun = String(query.dryRun ?? (body as any)?.dryRun ?? 'false').toLowerCase() === 'true';

  const parsed = z.object({
    rows: z.array(z.unknown())
      .min(1, 'At least one row is required')
      .max(MAX_BULK_ROWS, `At most ${MAX_BULK_ROWS} rows per upload`),
  }).parse({ rows });

  return { rows: parsed.rows, dryRun };
};

// ── Cell-level preprocessors ─────────────────────────────────
// Blank cell ("", "  ", null) → undefined; strings are trimmed.
const blank = (v: unknown) => {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? undefined : t;
  }
  return v;
};

const toCellString = (v: unknown) => { const b = blank(v); return typeof b === 'number' ? String(b) : b; };

export const cellString = (schema: z.ZodString) => z.preprocess(toCellString, schema);

// optional() goes INSIDE the preprocess: a blank cell arrives as "" (not
// undefined) and only becomes undefined after preprocessing.
export const optionalCellString = (schema: z.ZodString) => z.preprocess(toCellString, schema.optional());

// Numbers typed or pasted as text: "25,000", " 3 ".
const toCellNumber = (v: unknown) => {
  const b = blank(v);
  if (typeof b === 'string') {
    const n = Number(b.replace(/,/g, ''));
    return Number.isNaN(n) ? b : n;
  }
  return b;
};

export const cellNumber = (schema: z.ZodNumber) => z.preprocess(toCellNumber, schema);

// Blank cell → `fallback` (e.g. experience years left empty → 0).
export const optionalCellNumber = (schema: z.ZodNumber, fallback: number) =>
  z.preprocess(toCellNumber, schema.optional()).transform(v => v ?? fallback);

const GENDER_ALIASES: Record<string, Gender> = {
  M: 'MALE', MALE: 'MALE', BOY: 'MALE',
  F: 'FEMALE', FEMALE: 'FEMALE', GIRL: 'FEMALE',
  O: 'OTHER', OTHER: 'OTHER',
};
export const cellGender = z.preprocess(
  v => { const b = blank(v); return typeof b === 'string' ? GENDER_ALIASES[b.toUpperCase()] ?? b : b; },
  z.nativeEnum(Gender, { errorMap: () => ({ message: 'gender must be Male, Female or Other' }) }),
);

// Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, an ISO datetime,
// or an Excel date serial number (days since 1899-12-30). Returns
// midnight UTC of that calendar date.
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const toDate = (v: unknown): unknown => {
  const b = blank(v);
  if (b === undefined) return undefined;
  if (b instanceof Date) return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()));
  if (typeof b === 'number' && b > 0 && b < 100_000) return new Date(EXCEL_EPOCH_MS + Math.round(b) * 86_400_000);
  // Anything unparseable is passed through unchanged, so z.date() reports
  // the friendly invalid_type_error below instead of a bare "Invalid date".
  if (typeof b !== 'string') return b;

  let y: number, m: number, d: number;
  let match = b.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (match) { [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]; }
  else if ((match = b.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) { [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])]; }
  else return b;

  const date = new Date(Date.UTC(y, m - 1, d));
  // Reject impossible dates such as 31/02/2015 (Date would roll them over).
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : b;
};
export const cellDate = (label: string) => z.preprocess(
  toDate,
  z.date({
    required_error:     `${label} is required`,
    invalid_type_error: `${label} must be a valid date (YYYY-MM-DD or DD/MM/YYYY)`,
  }),
);

// Mobile number in any common format → stored 10-digit form.
export const cellPhone = (label: string) => z.preprocess(
  v => { const b = blank(v); return typeof b === 'number' ? String(b) : b; },
  z.string({ required_error: `${label} is required` }).transform((value, ctx) => {
    const phone = normalizePhone(value);
    if (!phone) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid 10-digit mobile number' });
      return z.NEVER;
    }
    return phone;
  }),
);

// "Maths, Science; Hindi" or ["Maths", "Science"] → ["Maths", "Science", "Hindi"].
// A blank cell becomes [] so the caller's .min(1) message is what shows.
export const cellList = z.preprocess(v => {
  const b = blank(v);
  if (b === undefined) return [];
  if (typeof b === 'string') return b.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
  return b;
}, z.array(z.string().min(1).max(100)));

// ── Row results ──────────────────────────────────────────────
// index = position in the submitted list (0-based). The frontend maps it
// to its own spreadsheet row number (usually index + 2, after the header).
export interface BulkRowResult {
  index:   number;
  status:  'valid' | 'error' | 'created';
  errors?: string[];
  [extra: string]: unknown;
}

export interface ParsedRow<T> { index: number; data: T | null; errors: string[] }

export const parseRows = <S extends ZodTypeAny>(rows: unknown[], schema: S): ParsedRow<z.infer<S>>[] =>
  rows.map((raw, index) => {
    const result = schema.safeParse(raw ?? {});
    return result.success
      ? { index, data: result.data, errors: [] }
      : { index, data: null, errors: result.error.errors.map(e => (e.path.length ? `${e.path.join('.')}: ` : '') + e.message) };
  });

// Thrown when any row is invalid on a real (non-dry) run: nothing is saved.
export const bulkValidationError = (results: BulkRowResult[]) => {
  const invalid = results.filter(r => r.status === 'error').length;
  const err = new Error(`${invalid} of ${results.length} row(s) have errors — nothing was saved. Fix them and upload again.`) as any;
  err.code       = 'BULK_VALIDATION_FAILED';
  err.statusCode = 400;
  err.details    = { total: results.length, valid: results.length - invalid, invalid, results };
  return err;
};

// Duplicate values inside the uploaded list (e.g. same email twice).
export const findDuplicates = <T>(items: { index: number; key: T | null | undefined }[]) => {
  const firstIndex = new Map<T, number>();
  const dupes      = new Map<number, number>(); // index → first index with the same key
  for (const { index, key } of items) {
    if (key === null || key === undefined) continue;
    if (firstIndex.has(key)) dupes.set(index, firstIndex.get(key)!);
    else firstIndex.set(key, index);
  }
  return dupes;
};
