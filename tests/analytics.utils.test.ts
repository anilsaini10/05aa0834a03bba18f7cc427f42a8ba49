// Pure analytics helpers — no DB. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pct, growthPercentage, compare, attendanceSummary, emptyCounts, paperOutcome, examOutcome, passFailSummary,
  sessionRange, sessionYearOf, previousYearWindow, splitIntoTerms, precedingWindow, schoolToday, scoreBand, toDay, atDay,
} from '../src/features/admin/analytics/analytics.utils';

test('zero denominators give null, never 0 or NaN', () => {
  assert.equal(pct(0, 0), null);
  assert.equal(pct(5, 0), null);
  assert.equal(pct(1, 3), 33.33);
  assert.equal(growthPercentage(10, 0), null);
  assert.equal(growthPercentage(10, null), null);
  assert.equal(growthPercentage(null, 10), null);
});

test('growth percentage formula', () => {
  assert.equal(growthPercentage(1085, 1000), 8.5);
  assert.equal(growthPercentage(900, 1000), -10);
  assert.equal(growthPercentage(1000, 1000), 0);
});

test('compare: percentage points only for percentage metrics', () => {
  const c = compare(95, 92, true);
  assert.equal(c.absoluteChange, 3);
  assert.equal(c.percentagePointChange, 3);
  assert.equal(c.percentageChange, 3.26);
  assert.equal(c.trendDirection, 'UP');
  assert.equal(compare(10, 12).percentagePointChange, null);
  assert.equal(compare(10, 12).trendDirection, 'DOWN');
  assert.equal(compare(null, 12).trendDirection, 'UNKNOWN');
  assert.equal(compare(5, 5).trendDirection, 'FLAT');
});

test('attendance: holidays out of the denominator, late counts as attended', () => {
  const s = attendanceSummary({ ...emptyCounts(), PRESENT: 6, LATE: 1, ABSENT: 2, LEAVE: 1, HOLIDAY: 5 });
  assert.equal(s.markedRecords, 10);
  assert.equal(s.attendancePercentage, 70);
  assert.equal(s.absencePercentage, 20);
  assert.equal(attendanceSummary(emptyCounts()).attendancePercentage, null);
});

test('paper outcome: absent and pending are never a fail', () => {
  assert.equal(paperOutcome('GRADED', 33, 100, 33), 'PASS');     // boundary passes
  assert.equal(paperOutcome('GRADED', 32.9, 100, 33), 'FAIL');
  assert.equal(paperOutcome('GRADED', 10, 20, 33), 'PASS');      // normalized: 50%
  assert.equal(paperOutcome('ABSENT', null, 100, 33), 'ABSENT');
  assert.equal(paperOutcome('PENDING', null, 100, 33), 'PENDING');
  assert.equal(paperOutcome('GRADED', null, 100, 33), 'PENDING'); // graded without marks
  assert.equal(paperOutcome('GRADED', 5, 0, 33), 'PENDING');      // bad max marks
});

test('exam outcome: pending wins, then fail, then pass', () => {
  assert.equal(examOutcome(['PASS', 'PENDING', 'FAIL']), 'PENDING');
  assert.equal(examOutcome(['PASS', 'FAIL', 'ABSENT']), 'FAIL');
  assert.equal(examOutcome(['PASS', 'ABSENT']), 'PASS');
  assert.equal(examOutcome(['ABSENT', 'ABSENT']), 'ABSENT');
  assert.equal(examOutcome([]), 'PENDING');
});

test('pass/fail percentages use assessed students only', () => {
  const s = passFailSummary(8, 2, 5, 10);
  assert.equal(s.assessedCount, 10);
  assert.equal(s.passPercentage, 80);
  assert.equal(passFailSummary(0, 0, 3, 4).passPercentage, null);
});

test('sessions follow the school start month', () => {
  assert.equal(sessionYearOf(atDay('2026-03-31'), 4), 2025);
  assert.equal(sessionYearOf(atDay('2026-04-01'), 4), 2026);
  const r = sessionRange(2026, 4);
  assert.equal(toDay(r.from), '2026-04-01');
  assert.equal(toDay(r.to), '2027-03-31');
  assert.equal(toDay(sessionRange(2024, 1).to), '2024-12-31');
});

test('year-on-year window is cut at the same elapsed point', () => {
  const w = previousYearWindow(sessionRange(2026, 4), atDay('2026-10-29'));
  assert.equal(toDay(w.current.to), '2026-10-29');
  assert.equal(toDay(w.previous.from), '2025-04-01');
  assert.equal(toDay(w.previous.to), '2025-10-29');
  assert.equal(w.truncated, true);
  const done = previousYearWindow(sessionRange(2024, 4), atDay('2026-10-29'));
  assert.equal(done.truncated, false);
  assert.equal(toDay(done.previous.to), '2024-03-31');
});

test('terms split a session into month-aligned parts', () => {
  const t = splitIntoTerms(sessionRange(2026, 4), 2);
  assert.deepEqual(t.map(x => [toDay(x.from), toDay(x.to)]), [['2026-04-01', '2026-09-30'], ['2026-10-01', '2027-03-31']]);
  const t3 = splitIntoTerms(sessionRange(2026, 4), 3);
  assert.equal(toDay(t3[2].to), '2027-03-31');
  assert.equal(toDay(t3[1].from), '2026-08-01');
});

test('preceding window has the same length', () => {
  const p = precedingWindow({ from: atDay('2026-07-01'), to: atDay('2026-07-31') });
  assert.equal(toDay(p.from), '2026-05-31');
  assert.equal(toDay(p.to), '2026-06-30');
});

test('school "today" is the IST calendar day', () => {
  assert.equal(toDay(schoolToday(new Date('2026-10-28T19:00:00Z'))), '2026-10-29'); // 00:30 IST
  assert.equal(toDay(schoolToday(new Date('2026-10-28T18:00:00Z'))), '2026-10-28'); // 23:30 IST
});

test('score bands', () => {
  assert.equal(scoreBand(100), '90-100');
  assert.equal(scoreBand(33), '33-44');
  assert.equal(scoreBand(32.99), '0-32');
});
