// Fee / salary helpers — no DB queries. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { payableOf, settleStatus } from '../src/features/admin/fees/fees.service';
import { computeSalary } from '../src/features/admin/salary/salary.service';
import { createPaymentSchema, createStudentFeeSchema } from '../src/features/admin/fees/fees.validation';

const d = (v: number) => new Prisma.Decimal(v);

test('fee payable and status', () => {
  assert.equal(payableOf({ amount: d(10000), discount: d(1500), fine: d(200) }).toNumber(), 8700);
  assert.equal(settleStatus(d(8700), d(0)), 'PENDING');
  assert.equal(settleStatus(d(8700), d(0.01)), 'PARTIAL');
  assert.equal(settleStatus(d(8700), d(8700)), 'PAID');
  assert.equal(settleStatus(d(0), d(0)), 'PAID');           // fully discounted
});

test('paise arithmetic is exact', () => {
  assert.equal(payableOf({ amount: d(0.1), discount: d(0), fine: d(0.2) }).toNumber(), 0.3);
});

test('amounts are validated and rounded to paise', () => {
  assert.equal(createPaymentSchema.parse({ amount: '1500.456', mode: 'UPI' }).amount, 1500.46);
  assert.equal(createPaymentSchema.safeParse({ amount: 0, mode: 'CASH' }).success, false);
  assert.equal(createPaymentSchema.safeParse({ amount: 10, mode: 'BITCOIN' }).success, false);
  assert.equal(createPaymentSchema.safeParse({ amount: 10, mode: 'CASH', paidAt: '2999-01-01' }).success, false);
  assert.equal(createStudentFeeSchema.safeParse({
    studentId: '3f1c2a4e-8b7d-4c1a-9e2f-1a2b3c4d5e6f', title: 'Trip', category: 'Misc', amount: -5, dueDate: '2026-07-01',
  }).success, false);
});

test('salary totals', () => {
  const s = computeSalary(30000, [{ label: 'HRA', amount: 5000 }, { label: 'Bonus', amount: 1000.5 }], [{ label: 'PF', amount: 1800 }]);
  assert.equal(s.grossAmount.toNumber(), 36000.5);
  assert.equal(s.totalDeductions.toNumber(), 1800);
  assert.equal(s.netAmount.toNumber(), 34200.5);
  assert.throws(() => computeSalary(1000, [], [{ label: 'LOP', amount: 1001 }]), (e: any) => e.code === 'DEDUCTIONS_EXCEED_GROSS');
});
