// ════════════════════════════════════════════════════════════
// Pure helpers for the analytics module — no DB access, so they're unit
// tested directly (tests/analytics.utils.test.ts).
//
// Conventions every analytics endpoint follows:
//   • Dates are calendar days ("YYYY-MM-DD"), stored as midnight UTC —
//     the same as every @db.Date column. "Today" is the school's local
//     (IST) day, not the server's UTC day.
//   • A rate whose denominator is 0 is null — never 0, never NaN — so the
//     app can show "—" instead of a misleading 0%.
//   • Percentages are 0–100, rounded to 2 decimals.
// ════════════════════════════════════════════════════════════

export const DAY_MS = 86_400_000;

// IST has no DST — a fixed offset is exact (same as subscriptionStatus.ts).
const SCHOOL_TZ_OFFSET_MS = 330 * 60_000;

export const toDay  = (d: Date): string => d.toISOString().slice(0, 10);
export const atDay  = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * DAY_MS);

// The school's current calendar day, as a date-only value.
export const schoolToday = (now = new Date()): Date => atDay(toDay(new Date(now.getTime() + SCHOOL_TZ_OFFSET_MS)));

export const round2 = (n: number): number => Math.round(n * 100) / 100;

// part/whole as a 0–100 percentage, or null when whole is 0.
export const pct = (part: number, whole: number): number | null =>
  whole > 0 ? round2((part / whole) * 100) : null;

export const avg = (sum: number | null | undefined, count: number): number | null =>
  count > 0 && sum !== null && sum !== undefined ? round2(sum / count) : null;

export const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
export const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : round2(Number(v)));

// ((current - previous) / previous) * 100 — null when previous is 0/unknown.
export const growthPercentage = (current: number | null, previous: number | null): number | null =>
  current === null || previous === null || previous === 0 ? null : round2(((current - previous) / previous) * 100);

export type TrendDirection = 'UP' | 'DOWN' | 'FLAT' | 'UNKNOWN';

export interface Comparison {
  currentValue:         number | null;
  previousValue:        number | null;
  absoluteChange:       number | null;
  percentageChange:     number | null;
  // Only for metrics that are themselves percentages (attendance %, pass %…):
  // 92% → 95% is +3 percentage points, not +3.26%.
  percentagePointChange: number | null;
  trendDirection:       TrendDirection;
}

export const compare = (current: number | null, previous: number | null, isPercentage = false): Comparison => {
  const known = current !== null && previous !== null;
  const diff  = known ? round2(current! - previous!) : null;
  return {
    currentValue:          current,
    previousValue:         previous,
    absoluteChange:        diff,
    percentageChange:      growthPercentage(current, previous),
    percentagePointChange: isPercentage ? diff : null,
    trendDirection:        !known ? 'UNKNOWN' : diff! > 0 ? 'UP' : diff! < 0 ? 'DOWN' : 'FLAT',
  };
};

// ── Academic sessions ────────────────────────────────────────
// There's no AcademicYear table — a session is derived from
// School.academicSessionStartMonth, exactly like the academic calendar:
// `year` is the year the session starts in (2026 → 2026-27).

export interface DateRange { from: Date; to: Date }

export const sessionYearOf = (date: Date, startMonth: number): number =>
  date.getUTCMonth() + 1 >= startMonth ? date.getUTCFullYear() : date.getUTCFullYear() - 1;

export const sessionRange = (year: number, startMonth: number): DateRange => ({
  from: new Date(Date.UTC(year, startMonth - 1, 1)),
  to:   new Date(Date.UTC(year + 1, startMonth - 1, 0)),   // day before the next session starts
});

export const sessionLabel = (year: number): string => `${year}-${String((year + 1) % 100).padStart(2, '0')}`;

export const rangeDays = (r: DateRange): number => Math.round((r.to.getTime() - r.from.getTime()) / DAY_MS) + 1;

// The equivalent window one year earlier. When the current window is
// still running (to > today), both windows are cut at the same elapsed
// point so an in-progress session is never compared to a full one.
export const previousYearWindow = (current: DateRange, today: Date): { current: DateRange; previous: DateRange; truncated: boolean } => {
  const effectiveTo = current.to > today ? (today < current.from ? current.from : today) : current.to;
  const shift = (d: Date) => new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate()));
  return {
    current:   { from: current.from, to: effectiveTo },
    previous:  { from: shift(current.from), to: shift(effectiveTo) },
    truncated: effectiveTo < current.to,
  };
};

// The window of the same length immediately before `r`.
export const precedingWindow = (r: DateRange): DateRange => ({
  from: addDays(r.from, -rangeDays(r)),
  to:   addDays(r.from, -1),
});

// Split a range into `parts` consecutive, near-equal month-aligned terms.
// Used because the schema has no Term table (see term-comparison).
export const splitIntoTerms = (r: DateRange, parts: number): (DateRange & { term: number })[] => {
  const months = (r.to.getUTCFullYear() - r.from.getUTCFullYear()) * 12 + r.to.getUTCMonth() - r.from.getUTCMonth() + 1;
  const terms: (DateRange & { term: number })[] = [];
  let start = r.from;
  for (let i = 0; i < parts; i++) {
    const monthsInTerm = Math.round((months * (i + 1)) / parts) - Math.round((months * i) / parts);
    const end = i === parts - 1
      ? r.to
      : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + monthsInTerm, 0));
    terms.push({ term: i + 1, from: start, to: end });
    start = addDays(end, 1);
  }
  return terms;
};

// Month buckets ("YYYY-MM") covering a range.
export const monthsIn = (r: DateRange): { month: string; from: Date; to: Date }[] => {
  const out = [];
  for (let m = new Date(Date.UTC(r.from.getUTCFullYear(), r.from.getUTCMonth(), 1)); m <= r.to;
       m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
    const end = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0));
    out.push({ month: toDay(m).slice(0, 7), from: m < r.from ? r.from : m, to: end > r.to ? r.to : end });
  }
  return out;
};

// Monday of the ISO week containing d.
export const weekStart = (d: Date): string => toDay(addDays(d, -((d.getUTCDay() + 6) % 7)));

// ── Attendance arithmetic ────────────────────────────────────
// HOLIDAY rows are never part of the denominator, and LATE counts as
// attended (the student was in school). LEAVE is approved leave (only
// approved leave requests write LEAVE rows) — it lowers the attendance %
// but is reported separately from ABSENT.

export interface StatusCounts { PRESENT: number; ABSENT: number; LATE: number; LEAVE: number; HOLIDAY: number }

export const emptyCounts = (): StatusCounts => ({ PRESENT: 0, ABSENT: 0, LATE: 0, LEAVE: 0, HOLIDAY: 0 });

export const attendanceSummary = (c: StatusCounts) => {
  const marked   = c.PRESENT + c.ABSENT + c.LATE + c.LEAVE;
  const attended = c.PRESENT + c.LATE;
  return {
    present:              c.PRESENT,
    absent:               c.ABSENT,
    late:                 c.LATE,
    approvedLeave:        c.LEAVE,
    markedHoliday:        c.HOLIDAY,
    markedRecords:        marked,
    attendancePercentage: pct(attended, marked),
    absencePercentage:    pct(c.ABSENT, marked),
  };
};

// ── Assessment arithmetic ────────────────────────────────────
// A paper (ExamMark) is:
//   GRADED with marks → PASS when marks/max ≥ passPercentage, else FAIL
//   ABSENT            → ABSENT (reported on its own, never a fail)
//   anything else     → PENDING (not yet assessed, never a fail)
// A student's exam = all their papers in it:
//   any PENDING → PENDING; else any FAIL → FAIL; else any PASS → PASS;
//   else (all absent) → ABSENT.

export type PaperOutcome = 'PASS' | 'FAIL' | 'ABSENT' | 'PENDING';

export const paperOutcome = (
  status: 'PENDING' | 'GRADED' | 'ABSENT',
  marks: number | null,
  maxMarks: number,
  passPercentage: number,
): PaperOutcome => {
  if (status === 'ABSENT') return 'ABSENT';
  if (status !== 'GRADED' || marks === null || maxMarks <= 0) return 'PENDING';
  return (marks / maxMarks) * 100 >= passPercentage ? 'PASS' : 'FAIL';
};

export const examOutcome = (papers: PaperOutcome[]): PaperOutcome => {
  if (papers.length === 0 || papers.includes('PENDING')) return 'PENDING';
  if (papers.includes('FAIL')) return 'FAIL';
  if (papers.includes('PASS')) return 'PASS';
  return 'ABSENT';
};

export const passFailSummary = (pass: number, fail: number, absent: number, pending: number) => ({
  passCount:      pass,
  failCount:      fail,
  absentCount:    absent,
  pendingCount:   pending,
  assessedCount:  pass + fail,
  // Of those actually assessed — absent/pending are excluded, not failed.
  passPercentage: pct(pass, pass + fail),
  failPercentage: pct(fail, pass + fail),
});

// Score bands on the normalized percentage. The schema stores no grading
// scale (ExamMark.grade is free text), so this fixed band set is used for
// distribution charts; teacher-entered grades are reported alongside.
export const SCORE_BANDS = [
  { band: '90-100', min: 90 },
  { band: '75-89',  min: 75 },
  { band: '60-74',  min: 60 },
  { band: '45-59',  min: 45 },
  { band: '33-44',  min: 33 },
  { band: '0-32',   min: 0  },
] as const;

export const scoreBand = (percentage: number): string =>
  SCORE_BANDS.find(b => percentage >= b.min)?.band ?? '0-32';

// A metric the current schema can't produce. Returned instead of a
// made-up number so the app can show "Not tracked yet".
export const unavailable = (reason: string, requiredData: string[]) => ({
  available: false as const,
  reason,
  requiredData,
});
