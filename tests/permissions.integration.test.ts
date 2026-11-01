// School + role permissions over HTTP, against a throwaway schema built
// with the real migrations.
//   TEST_DATABASE_URL="postgresql://…/db?schema=perm_test" npm run test:integration
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

before(async () => {
  if (!enabled) return;
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' });
  ({ prisma } = require('../src/config/db'));
  const { signAccessToken } = require('../src/shared/utils/jwt');
  const app = require('../src/app').default;

  const sa = await prisma.user.create({ data: { name: 'SA', email: 'sa@test.com', passwordHash: 'x', role: 'SUPER_ADMIN' } });
  const [a, b] = [await prisma.school.create({ data: { name: 'School A' } }), await prisma.school.create({ data: { name: 'School B' } })];
  const adminA = await prisma.user.create({ data: { name: 'Admin A', email: 'a@test.com', passwordHash: 'x', role: 'ADMIN', schoolId: a.id } });
  const adminB = await prisma.user.create({ data: { name: 'Admin B', email: 'b@test.com', passwordHash: 'x', role: 'ADMIN', schoolId: b.id } });
  const teacher = await prisma.user.create({ data: { name: 'T', email: 't@test.com', passwordHash: 'x', role: 'TEACHER', schoolId: a.id } });
  const role = await prisma.customRole.create({ data: { key: 'ACCOUNTANT', name: 'Accountant' } });
  const staff = await prisma.user.create({ data: { name: 'Ravi', email: 'ravi@test.com', passwordHash: 'x', role: 'STAFF', schoolId: a.id, customRoleId: role.id } });
  const tok = (u: any, customRole: string | null = null) => signAccessToken({ sub: u.id, email: u.email, role: u.role, schoolId: u.schoolId, customRole });
  Object.assign(t, { sa: tok(sa), a: tok(adminA), b: tok(adminB), teacher: tok(teacher), staff: tok(staff, 'ACCOUNTANT') });
  Object.assign(ids, { a: a.id, b: b.id, role: role.id });

  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
});

after(async () => {
  if (!enabled) return;
  server?.close();
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await prisma.$disconnect();
});

test('super admin sets a school\'s permissions (PUT replace, PATCH merge)', { skip: !enabled }, async () => {
  const empty = await call('GET', `/super-admin/schools/${ids.a}/permissions`, t.sa);
  assert.deepEqual(empty.body.data, { schoolId: ids.a, schoolName: 'School A', permissions: {} });

  const put = await call('PUT', `/super-admin/schools/${ids.a}/permissions`, t.sa, { permissions: {
    feesCollect: true, salaryView: true, reportsView: false, maxDiscountPercent: 10, allowedClasses: ['1', '2'],
  } });
  assert.equal(put.status, 200);
  assert.equal(put.body.data.permissions.maxDiscountPercent, 10);

  const patch = await call('PATCH', `/super-admin/schools/${ids.a}/permissions`, t.sa, { permissions: { reportsView: true, maxDiscountPercent: null } });
  assert.deepEqual(patch.body.data.permissions, { feesCollect: true, salaryView: true, reportsView: true, allowedClasses: ['1', '2'] });

  const bad = await call('PATCH', `/super-admin/schools/${ids.a}/permissions`, t.sa, { permissions: { fees_collect: true } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error.message, /feesCollect/);
  assert.equal((await call('PUT', `/super-admin/schools/${ids.a}/permissions`, t.sa, { permissions: { a: { b: 1 } } })).status, 400);
  assert.equal((await call('GET', `/super-admin/schools/00000000-0000-4000-8000-000000000000/permissions`, t.sa)).status, 404);
  assert.equal((await call('PUT', `/super-admin/schools/${ids.a}/permissions`, t.a, { permissions: {} })).status, 403);   // admin can't
  // The rest of /super-admin/schools/:id/* still reaches the existing router.
  assert.equal((await call('GET', `/super-admin/schools/${ids.a}`, t.sa)).status, 200);
});

test('concurrent PATCHes never lose a key', { skip: !enabled }, async () => {
  await Promise.all(Array.from({ length: 10 }, (_, i) =>
    call('PATCH', `/super-admin/schools/${ids.b}/permissions`, t.sa, { permissions: { [`flag${i}`]: true } })));
  const r = await call('GET', `/super-admin/schools/${ids.b}/permissions`, t.sa);
  assert.equal(Object.keys(r.body.data.permissions).length, 10);
});

test('admin reads school permissions and sets a role\'s', { skip: !enabled }, async () => {
  const school = await call('GET', '/admin/permissions/school', t.a);
  assert.equal(school.body.data.permissions.feesCollect, true);

  const put = await call('PUT', `/admin/permissions/roles/${ids.role}`, t.a, { permissions: { feesCollect: true, reportsView: true, receiptPrint: true } });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.data.role, { id: ids.role, key: 'ACCOUNTANT', name: 'Accountant' });

  const patch = await call('PATCH', `/admin/permissions/roles/${ids.role}`, t.a, { permissions: { receiptPrint: null, salaryView: true } });
  assert.deepEqual(patch.body.data.permissions, { feesCollect: true, reportsView: true, salaryView: true });

  // Super admin switches salaryView off for the school → blocked for the role.
  await call('PATCH', `/super-admin/schools/${ids.a}/permissions`, t.sa, { permissions: { salaryView: false } });
  const role = await call('GET', `/admin/permissions/roles/${ids.role}`, t.a);
  assert.equal(role.body.data.permissions.salaryView, true);             // what the admin saved
  assert.equal(role.body.data.effectivePermissions.salaryView, false);   // what applies
  assert.deepEqual(role.body.data.blockedBySchool, ['salaryView']);

  const matrix = await call('GET', '/admin/permissions/roles', t.a);
  assert.equal(matrix.body.data.roles.length, 1);
  assert.equal(matrix.body.data.schoolPermissions.salaryView, false);
});

test('role permissions are per school', { skip: !enabled }, async () => {
  const b = await call('GET', `/admin/permissions/roles/${ids.role}`, t.b);
  assert.deepEqual(b.body.data.permissions, {});
  const sa = await call('GET', `/super-admin/schools/${ids.a}/role-permissions`, t.sa);
  assert.equal(sa.body.data.roles[0].permissions.feesCollect, true);
});

test('each user gets their own effective permissions', { skip: !enabled }, async () => {
  const staff = await call('GET', '/auth/permissions', t.staff);
  assert.equal(staff.body.data.customRole.key, 'ACCOUNTANT');
  assert.deepEqual(staff.body.data.permissions, { feesCollect: true, reportsView: true, salaryView: false });
  assert.deepEqual(staff.body.data.blockedBySchool, ['salaryView']);

  const teacher = await call('GET', '/auth/permissions', t.teacher);
  assert.equal(teacher.body.data.permissions.feesCollect, true);           // school-level
  assert.equal(teacher.body.data.rolePermissions, null);

  assert.equal((await call('GET', '/auth/permissions', t.sa)).body.data.isSuperAdmin, true);
  assert.equal((await call('GET', '/auth/permissions')).status, 401);
  assert.equal((await call('PUT', `/admin/permissions/roles/${ids.role}`, t.staff, { permissions: {} })).status, 403);
});

test('inactive role can\'t be configured', { skip: !enabled }, async () => {
  await prisma.customRole.update({ where: { id: ids.role }, data: { isActive: false } });
  assert.equal((await call('PATCH', `/admin/permissions/roles/${ids.role}`, t.a, { permissions: { x: true } })).body.error.code, 'ROLE_NOT_FOUND');
});
