// Student fees + salary over HTTP, against a throwaway schema built with
// the real migrations.
//   TEST_DATABASE_URL="postgresql://…/db?schema=fees_test" npm run test:integration
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import type { Server } from 'node:http';

const url = process.env.TEST_DATABASE_URL;
const schemaName = url ? new URL(url).searchParams.get('schema') : null;
const enabled = !!url && !!schemaName && schemaName.includes('test');
if (url && !enabled) throw new Error('TEST_DATABASE_URL must set ?schema=<name containing "test">');
if (enabled) process.env.DATABASE_URL = url;
process.env.NODE_ENV = 'test';

let prisma: any, server: Server, base = '';
const t: Record<string, string> = {};
const ids: Record<string, string> = {};

const call = async (method: string, path: string, token?: string, body?: unknown) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() as any };
};

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const thisMonth = () => { const [y, m] = today().split('-').map(Number); return { year: y, month: m }; };

before(async () => {
  if (!enabled) return;
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' });
  ({ prisma } = require('../src/config/db'));
  const { signAccessToken } = require('../src/shared/utils/jwt');
  const app = require('../src/app').default;

  const sa     = await prisma.user.create({ data: { name: 'SA', email: 'sa@f.test', passwordHash: 'x', role: 'SUPER_ADMIN' } });
  const school = await prisma.school.create({ data: { name: 'Fee School' } });
  const sid    = school.id;
  const admin  = await prisma.user.create({ data: { name: 'Admin', email: 'admin@f.test', passwordHash: 'x', role: 'ADMIN', schoolId: sid } });
  const cls    = await prisma.class.create({ data: { name: '5', numericLevel: 5, schoolId: sid } });
  const cls6   = await prisma.class.create({ data: { name: '6', numericLevel: 6, schoolId: sid } });
  const sec    = await prisma.section.create({ data: { name: 'A', classId: cls.id, capacity: 40 } });
  const sec6   = await prisma.section.create({ data: { name: 'A', classId: cls6.id, capacity: 40 } });
  const parent = await prisma.user.create({ data: { name: 'Parent', email: 'p@f.test', passwordHash: 'x', role: 'PARENT', schoolId: sid } });
  const other  = await prisma.user.create({ data: { name: 'Other P', email: 'op@f.test', passwordHash: 'x', role: 'PARENT', schoolId: sid } });
  const student = (name: string, classId: string, sectionId: string, rollNo: number, parentUserId: string) => prisma.student.create({ data: {
    admissionNo: `ADM${rollNo}`, name, gender: 'MALE', dateOfBirth: new Date('2015-01-01'), classId, sectionId, rollNo,
    parentUserId, parentName: 'P', parentPhone: '9999999999', parentEmail: 'p@f.test', schoolId: sid,
  } });
  const s1 = await student('Aarav', cls.id, sec.id, 1, parent.id);
  const s2 = await student('Bina', cls.id, sec.id, 2, other.id);
  const s3 = await student('Chetan', cls6.id, sec6.id, 3, other.id);

  const tUser   = await prisma.user.create({ data: { name: 'Meera', email: 't@f.test', passwordHash: 'x', role: 'TEACHER', schoolId: sid } });
  const teacher = await prisma.teacher.create({ data: { employeeId: 'TCH0001', userId: tUser.id, gender: 'FEMALE', joiningDate: new Date('2024-01-01'), salary: 30000, schoolId: sid } });
  const staff   = await prisma.staff.create({ data: { employeeId: 'STF0001', name: 'Ramu', phone: '8888888888', gender: 'MALE', designation: 'Peon', salary: 12000, joiningDate: new Date('2024-01-01'), schoolId: sid } });

  const role = await prisma.customRole.create({ data: { key: 'ACCOUNTANT', name: 'Accountant' } });
  await prisma.schoolRolePermission.create({ data: { schoolId: sid, customRoleId: role.id, permissions: { feesManage: true } } });
  const acc = await prisma.user.create({ data: { name: 'Acc', email: 'acc@f.test', passwordHash: 'x', role: 'STAFF', schoolId: sid, customRoleId: role.id } });

  const tok = (u: any, customRole: string | null = null) => signAccessToken({ sub: u.id, email: u.email, role: u.role, schoolId: u.schoolId, customRole });
  Object.assign(t, { sa: tok(sa), admin: tok(admin), parent: tok(parent), other: tok(other), teacher: tok(tUser), acc: tok(acc, 'ACCOUNTANT') });
  Object.assign(ids, { school: sid, cls: cls.id, cls6: cls6.id, s1: s1.id, s2: s2.id, s3: s3.id, teacher: teacher.id, staff: staff.id });

  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
});

after(async () => {
  if (!enabled) return;
  server?.close();
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await prisma.$disconnect();
});

test('fee structure → assign → pay in parts → void → edit', { skip: !enabled }, async () => {
  const st = await call('POST', '/admin/fees/structures', t.admin, { name: 'Tuition Q1', category: 'Tuition', amount: 10000, dueDate: '2099-07-15', classId: ids.cls });
  assert.equal(st.status, 201);
  assert.equal(st.body.data.amount, 10000);
  ids.structure = st.body.data.id;

  const assign = await call('POST', `/admin/fees/structures/${ids.structure}/assign`, t.admin, {});
  assert.deepEqual(assign.body.data, { matchedStudents: 2, assigned: 2, alreadyAssigned: 0 });   // class 5 only
  assert.equal((await call('POST', `/admin/fees/structures/${ids.structure}/assign`, t.admin, {})).body.data.alreadyAssigned, 2);
  assert.equal((await call('POST', `/admin/fees/structures/${ids.structure}/assign`, t.admin, { studentIds: [ids.s3] })).status, 404);

  const list = await call('GET', `/admin/fees/student-fees?studentId=${ids.s1}`, t.admin);
  const fee = list.body.data.items[0];
  ids.fee = fee.id;
  assert.equal(fee.status, 'PENDING');
  assert.equal(fee.balanceAmount, 10000);

  const p1 = await call('POST', `/admin/fees/student-fees/${ids.fee}/payments`, t.admin, { amount: 4000, mode: 'CASH' });
  assert.equal(p1.status, 201);
  assert.match(p1.body.data.payment.receiptNo, /^RCP-\d{4}-\d{2}-00001$/);
  assert.equal(p1.body.data.fee.status, 'PARTIAL');
  assert.equal(p1.body.data.fee.balanceAmount, 6000);

  const over = await call('POST', `/admin/fees/student-fees/${ids.fee}/payments`, t.admin, { amount: 7000, mode: 'UPI' });
  assert.equal(over.body.error.code, 'AMOUNT_EXCEEDS_BALANCE');

  const p2 = await call('POST', `/admin/fees/student-fees/${ids.fee}/payments`, t.acc, { amount: 6000, mode: 'UPI', referenceNo: 'UTR1' });
  assert.equal(p2.body.data.fee.status, 'PAID');
  assert.equal(p2.body.data.payment.collectedBy.name, 'Acc');
  assert.equal((await call('POST', `/admin/fees/student-fees/${ids.fee}/payments`, t.admin, { amount: 1, mode: 'CASH' })).body.error.code, 'FEE_NOT_PAYABLE');

  // Void the ₹4000 → back to PARTIAL with ₹6000 paid.
  const v = await call('POST', `/admin/fees/payments/${p1.body.data.payment.id}/void`, t.admin, { reason: 'Entered twice' });
  assert.equal(v.body.data.payment.status, 'VOIDED');
  assert.equal(v.body.data.fee.status, 'PARTIAL');
  assert.equal(v.body.data.fee.paidAmount, 6000);
  assert.equal((await call('POST', `/admin/fees/payments/${p1.body.data.payment.id}/void`, t.admin, { reason: 'x' })).body.error.code, 'PAYMENT_ALREADY_VOIDED');

  // Can't drop payable below paid; a ₹4000 discount settles it.
  assert.equal((await call('PATCH', `/admin/fees/student-fees/${ids.fee}`, t.admin, { amount: 5000 })).body.error.code, 'PAYABLE_BELOW_PAID');
  const disc = await call('PATCH', `/admin/fees/student-fees/${ids.fee}`, t.admin, { discount: 4000 });
  assert.equal(disc.body.data.status, 'PAID');
  assert.equal(disc.body.data.payableAmount, 6000);

  assert.equal((await call('DELETE', `/admin/fees/structures/${ids.structure}`, t.admin)).body.error.code, 'FEE_STRUCTURE_IN_USE');
  assert.equal((await call('DELETE', `/admin/fees/student-fees/${ids.fee}`, t.admin)).body.error.code, 'FEE_HAS_PAYMENTS');
});

test('concurrent payments never overpay', { skip: !enabled }, async () => {
  const fee = (await call('GET', `/admin/fees/student-fees?studentId=${ids.s2}`, t.admin)).body.data.items[0];
  const results = await Promise.all([1, 2, 3].map(() =>
    call('POST', `/admin/fees/student-fees/${fee.id}/payments`, t.admin, { amount: 6000, mode: 'CASH' })));
  assert.equal(results.filter(r => r.status === 201).length, 1);
  const after = (await call('GET', `/admin/fees/student-fees/${fee.id}`, t.admin)).body.data;
  assert.equal(after.paidAmount, 6000);
  assert.equal(after.payments.length, 1);
});

test('overdue, waive / reopen / cancel, defaulters and summary', { skip: !enabled }, async () => {
  const adhoc = await call('POST', '/admin/fees/student-fees', t.admin, { studentId: ids.s3, title: 'Lab fee', category: 'Lab', amount: 1500, dueDate: '2020-01-10' });
  assert.equal(adhoc.status, 201);
  assert.equal(adhoc.body.data.isOverdue, true);
  assert.equal(adhoc.body.data.displayStatus, 'OVERDUE');
  ids.adhoc = adhoc.body.data.id;

  const overdue = await call('GET', '/admin/fees/student-fees?status=OVERDUE', t.admin);
  assert.deepEqual(overdue.body.data.items.map((f: any) => f.id), [ids.adhoc]);

  const defaulters = await call('GET', '/admin/fees/defaulters?overdueOnly=true', t.admin);
  assert.equal(defaulters.body.data.total, 1);
  assert.equal(defaulters.body.data.items[0].student.id, ids.s3);
  assert.equal(defaulters.body.data.items[0].overdueAmount, 1500);
  const allDue = await call('GET', '/admin/fees/defaulters', t.admin);
  assert.equal(allDue.body.data.total, 2);   // s2 (₹4000 left) and s3

  const w = await call('POST', `/admin/fees/student-fees/${ids.adhoc}/waive`, t.admin, { reason: 'Scholarship' });
  assert.equal(w.body.data.status, 'WAIVED');
  assert.equal(w.body.data.balanceAmount, 0);
  assert.equal((await call('POST', `/admin/fees/student-fees/${ids.adhoc}/payments`, t.admin, { amount: 10, mode: 'CASH' })).body.error.code, 'FEE_NOT_PAYABLE');
  assert.equal((await call('PATCH', `/admin/fees/student-fees/${ids.adhoc}`, t.admin, { fine: 10 })).body.error.code, 'FEE_CLOSED');
  assert.equal((await call('POST', `/admin/fees/student-fees/${ids.adhoc}/reopen`, t.admin)).body.data.status, 'PENDING');
  assert.equal((await call('POST', `/admin/fees/student-fees/${ids.adhoc}/cancel`, t.admin, { reason: 'Wrong student' })).body.data.status, 'CANCELLED');

  const sum = await call('GET', '/admin/fees/summary', t.admin);
  assert.equal(sum.status, 200);
  assert.deepEqual(sum.body.data.totals, {
    billedAmount: 16000, collectedAmount: 12000, pendingAmount: 4000, overdueAmount: 0, waivedAmount: 0, collectionRate: 75,
  });
  assert.deepEqual(sum.body.data.counts, { PENDING: 0, PARTIAL: 1, PAID: 1, WAIVED: 0, CANCELLED: 1, OVERDUE: 0 });
  assert.equal(sum.body.data.collectedToday, 12000);
  assert.equal(sum.body.data.byClass.length, 2);

  assert.deepEqual((await call('DELETE', `/admin/fees/student-fees/${ids.adhoc}`, t.admin)).body.data, { deleted: true });

  const ledger = await call('GET', `/admin/fees/students/${ids.s1}`, t.admin);
  assert.equal(ledger.body.data.payments.length, 2);   // incl. the voided one
  assert.equal(ledger.body.data.totals.balanceAmount, 0);
});

test('parent sees only their own child\'s fees', { skip: !enabled }, async () => {
  const mine = await call('GET', `/students/fees?studentId=${ids.s1}`, t.parent);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.data.fees.length, 1);
  assert.equal(mine.body.data.payments.length, 1);   // voided one hidden
  assert.deepEqual(mine.body.data.totals, { payableAmount: 6000, paidAmount: 6000, balanceAmount: 0, overdueAmount: 0 });

  const receipt = await call('GET', `/students/fees/receipts/${mine.body.data.payments[0].id}`, t.parent);
  assert.equal(receipt.body.data.amount, 6000);
  assert.equal((await call('GET', `/students/fees/receipts/${mine.body.data.payments[0].id}`, t.other)).status, 404);
  assert.equal((await call('GET', `/students/fees?studentId=${ids.s1}`, t.other)).body.error.code, 'NOT_YOUR_CHILD');
});

test('who can manage fees and salary', { skip: !enabled }, async () => {
  assert.equal((await call('GET', '/admin/fees/summary', t.acc)).status, 200);              // Accountant has feesManage
  assert.equal((await call('GET', '/admin/salary', t.acc)).body.error.code, 'PERMISSION_DENIED');
  assert.equal((await call('GET', '/admin/fees/summary', t.teacher)).status, 403);
  assert.equal((await call('GET', '/admin/fees/summary', t.parent)).status, 403);

  // Super admin switches fees off for the school → admin and accountant both lose it.
  await call('PATCH', `/super-admin/schools/${ids.school}/permissions`, t.sa, { permissions: { feesManage: false } });
  assert.equal((await call('GET', '/admin/fees/summary', t.admin)).body.error.code, 'PERMISSION_DENIED');
  assert.equal((await call('GET', '/admin/fees/summary', t.acc)).body.error.code, 'PERMISSION_DENIED');
  await call('PATCH', `/super-admin/schools/${ids.school}/permissions`, t.sa, { permissions: { feesManage: null } });
  assert.equal((await call('GET', '/admin/fees/summary', t.admin)).status, 200);
});

test('salary: generate → edit → hold → credit', { skip: !enabled }, async () => {
  const { year, month } = thisMonth();
  const gen = await call('POST', '/admin/salary/generate', t.admin, { month, year });
  assert.equal(gen.status, 201);
  assert.deepEqual(gen.body.data, { month, year, eligibleEmployees: 2, created: 2, alreadyGenerated: 0 });
  assert.equal((await call('POST', '/admin/salary/generate', t.admin, { month, year })).body.data.created, 0);
  assert.equal((await call('POST', '/admin/salary/generate', t.admin, { month: month === 12 ? 1 : month + 1, year: month === 12 ? year + 1 : year })).body.error.code, 'FUTURE_PERIOD');

  const list = await call('GET', `/admin/salary?month=${month}&year=${year}`, t.admin);
  assert.equal(list.body.data.total, 2);
  assert.equal(list.body.data.totals.PENDING.netAmount, 42000);
  const tSlip = list.body.data.items.find((s: any) => s.employee.type === 'TEACHER');
  const sSlip = list.body.data.items.find((s: any) => s.employee.type === 'STAFF');
  assert.equal(tSlip.employee.name, 'Meera');

  const edit = await call('PATCH', `/admin/salary/${tSlip.id}`, t.admin, {
    allowances: [{ label: 'HRA', amount: 5000 }], deductions: [{ label: 'PF', amount: 1800 }, { label: 'Loss of pay (1 day)', amount: 1000 }],
  });
  assert.equal(edit.body.data.grossAmount, 35000);
  assert.equal(edit.body.data.netAmount, 32200);
  assert.equal((await call('PATCH', `/admin/salary/${tSlip.id}`, t.admin, { deductions: [{ label: 'x', amount: 99999 }] })).body.error.code, 'DEDUCTIONS_EXCEED_GROSS');

  assert.equal((await call('POST', `/admin/salary/${tSlip.id}/hold`, t.admin, { reason: 'Docs pending' })).body.data.status, 'ON_HOLD');
  assert.equal((await call('POST', `/admin/salary/${tSlip.id}/credit`, t.admin, { paymentMode: 'BANK_TRANSFER' })).body.error.code, 'INVALID_SALARY_STATUS');
  assert.equal((await call('POST', `/admin/salary/${tSlip.id}/release`, t.admin)).body.data.status, 'PENDING');

  const credit = await call('POST', `/admin/salary/${tSlip.id}/credit`, t.admin, { paymentMode: 'BANK_TRANSFER', referenceNo: 'NEFT123' });
  assert.equal(credit.body.data.status, 'CREDITED');
  assert.equal(credit.body.data.creditedBy.name, 'Admin');
  assert.equal((await call('POST', `/admin/salary/${tSlip.id}/credit`, t.admin, { paymentMode: 'CASH' })).body.error.code, 'INVALID_SALARY_STATUS');
  assert.equal((await call('PATCH', `/admin/salary/${tSlip.id}`, t.admin, { note: 'x' })).body.error.code, 'INVALID_SALARY_STATUS');
  assert.equal((await call('DELETE', `/admin/salary/${tSlip.id}`, t.admin)).body.error.code, 'INVALID_SALARY_STATUS');
  assert.equal((await call('POST', `/admin/salary/${tSlip.id}/cancel`, t.admin, { reason: 'x' })).body.error.code, 'INVALID_SALARY_STATUS');

  const bulk = await call('POST', '/admin/salary/credit', t.admin, { slipIds: [sSlip.id, tSlip.id], paymentMode: 'CASH' });
  assert.equal(bulk.body.data.credited, 1);
  assert.equal(bulk.body.data.creditedAmount, 12000);
  assert.deepEqual(bulk.body.data.skipped, [tSlip.id]);

  const summary = await call('GET', '/admin/salary/summary', t.admin);
  assert.equal(summary.body.data.generated, 2);
  assert.equal(summary.body.data.notGenerated, 0);
  assert.equal(summary.body.data.creditedAmount, 44200);
  assert.equal(summary.body.data.payableAmount, 0);

  // Teacher sees own slip and a notification.
  const mine = await call('GET', '/teacher/salary', t.teacher);
  assert.equal(mine.body.data.items.length, 1);
  assert.equal(mine.body.data.totals.creditedAmount, 32200);
  assert.equal((await call('GET', `/teacher/salary/${sSlip.id}`, t.teacher)).status, 404);
  const notes = await prisma.notification.findMany({ where: { type: 'SALARY' } });
  assert.equal(notes.length, 1);
});
