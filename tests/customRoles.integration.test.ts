// Custom roles end to end over HTTP, against a throwaway schema built
// with the REAL migrations (so the enum migration and CHECK constraint
// are exercised too).
//   TEST_DATABASE_URL="postgresql://…/db?schema=roles_test" npm run test:integration
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
const tokens: Record<string, string> = {};
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
  const { hashPassword } = require('../src/shared/utils/hash');
  const { signAccessToken } = require('../src/shared/utils/jwt');
  const app = require('../src/app').default;

  const hash = await hashPassword('secret123');
  const superAdmin = await prisma.user.create({ data: { name: 'SA', email: 'sa@t.t', passwordHash: hash, role: 'SUPER_ADMIN' } });
  const [a, b] = [await prisma.school.create({ data: { name: 'School A' } }), await prisma.school.create({ data: { name: 'School B' } })];
  const adminA = await prisma.user.create({ data: { name: 'Admin A', email: 'a@t.t', passwordHash: hash, role: 'ADMIN', schoolId: a.id } });
  const adminB = await prisma.user.create({ data: { name: 'Admin B', email: 'b@t.t', passwordHash: hash, role: 'ADMIN', schoolId: b.id } });
  const tok = (u: any) => signAccessToken({ sub: u.id, email: u.email, role: u.role, schoolId: u.schoolId });
  Object.assign(tokens, { sa: tok(superAdmin), a: tok(adminA), b: tok(adminB) });
  Object.assign(ids, { a: a.id, b: b.id });

  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
});

after(async () => {
  if (!enabled) return;
  server?.close();
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await prisma.$disconnect();
});

test('super admin creates a role; case/spacing variants are duplicates', { skip: !enabled }, async () => {
  const r = await call('POST', '/super-admin/roles', tokens.sa, { name: '  accountant ', description: 'Fees & accounts' });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.key, 'ACCOUNTANT');
  assert.equal(r.body.data.name, 'Accountant');
  ids.role = r.body.data.id;

  for (const name of ['ACCOUNTANT', 'Accountant', 'account ant'.replace(' ', '')]) {
    const dup = await call('POST', '/super-admin/roles', tokens.sa, { name });
    assert.equal(dup.status, 409, name);
    assert.equal(dup.body.error.code, 'ROLE_ALREADY_EXISTS');
  }
  assert.equal((await call('POST', '/super-admin/roles', tokens.sa, { name: 'Teacher' })).status, 400);
  assert.equal((await call('POST', '/super-admin/roles', tokens.sa, { name: '!!' })).status, 400);
  assert.equal((await call('POST', '/super-admin/roles', tokens.a, { name: 'Librarian' })).status, 403);   // admins can't create roles

  const lib = await call('POST', '/super-admin/roles', tokens.sa, { name: 'head clerk' });
  assert.equal(lib.body.data.key, 'HEAD_CLERK');
  ids.role2 = lib.body.data.id;
});

test('admin sees active roles and creates an account', { skip: !enabled }, async () => {
  const list = await call('GET', '/admin/roles', tokens.a);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.data.items.map((r: any) => r.key).sort(), ['ACCOUNTANT', 'HEAD_CLERK']);

  const created = await call('POST', '/admin/role-users', tokens.a, {
    customRoleId: ids.role, name: 'Ravi Accountant', email: 'Ravi@SchoolA.com', phone: '+91 98765 43210', username: 'ravi.acc',
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.role, 'STAFF');
  assert.equal(created.body.data.customRole.key, 'ACCOUNTANT');
  assert.equal(created.body.data.email, 'ravi@schoola.com');
  assert.equal(created.body.data.phone, '9876543210');
  assert.equal(created.body.data.defaultPassword, '123456');
  ids.user = created.body.data.id;

  const dupEmail = await call('POST', '/admin/role-users', tokens.a, { customRoleId: ids.role, name: 'X Y', email: 'ravi@schoola.com' });
  assert.equal(dupEmail.body.error.code, 'EMAIL_TAKEN');
  const dupPhone = await call('POST', '/admin/role-users', tokens.a, { customRoleId: ids.role, name: 'X Y', email: 'x@schoola.com', phone: '9876543210' });
  assert.equal(dupPhone.body.error.code, 'PHONE_TAKEN');

  const users = await call('GET', `/admin/role-users?customRoleId=${ids.role}`, tokens.a);
  assert.equal(users.body.data.total, 1);
  assert.equal((await call('GET', '/admin/role-users', tokens.b)).body.data.total, 0);              // other school sees nothing
  assert.equal((await call('GET', `/admin/role-users/${ids.user}`, tokens.b)).status, 404);
  assert.equal((await call('GET', '/admin/roles', tokens.a)).body.data.items.find((r: any) => r.key === 'ACCOUNTANT').usersInSchool, 1);
});

test('the created id logs in (email, username, phone) as STAFF', { skip: !enabled }, async () => {
  for (const identifier of ['ravi@schoola.com', 'RAVI.ACC', '09876543210']) {
    const r = await call('POST', '/auth/login', undefined, { identifier, password: '123456', role: 'STAFF', schoolId: ids.a });
    assert.equal(r.status, 200, identifier);
    assert.equal(r.body.data.user.role, 'STAFF');
    assert.equal(r.body.data.user.customRole.key, 'ACCOUNTANT');
    tokens.staff = r.body.data.tokens.accessToken;
    tokens.staffRefresh = r.body.data.tokens.refreshToken;
  }
  const me = await call('GET', '/auth/me', tokens.staff);
  assert.equal(me.body.data.user.customRole, 'ACCOUNTANT');
  // Wrong school / wrong role → no login.
  assert.equal((await call('POST', '/auth/login', undefined, { identifier: 'ravi@schoola.com', password: '123456', role: 'STAFF', schoolId: ids.b })).status, 401);
  assert.equal((await call('POST', '/auth/login', undefined, { identifier: 'ravi@schoola.com', password: '123456', role: 'TEACHER', schoolId: ids.a })).status, 401);
  // A STAFF token can't reach admin or teacher APIs.
  assert.equal((await call('GET', '/admin/roles', tokens.staff)).status, 403);
});

test('login screen: school roles list, then login with the picked role', { skip: !enabled }, async () => {
  // Public: only roles some active STAFF account in this school has.
  const a = await call('GET', `/schools/${ids.a}/roles`);
  assert.equal(a.status, 200);
  assert.deepEqual(a.body.data.roles, [{ role: 'STAFF', customRoleId: ids.role, key: 'ACCOUNTANT', name: 'Accountant' }]);
  assert.deepEqual((await call('GET', `/schools/${ids.b}/roles`)).body.data.roles, []);
  assert.equal((await call('GET', '/schools/00000000-0000-4000-8000-000000000000/roles')).body.error.code, 'SCHOOL_NOT_FOUND');

  const body = { identifier: 'ravi@schoola.com', password: '123456', role: 'STAFF', schoolId: ids.a };
  assert.equal((await call('POST', '/auth/login', undefined, { ...body, customRoleId: ids.role })).status, 200);
  assert.equal((await call('POST', '/auth/login', undefined, { ...body, customRoleId: ids.role2 })).body.error.code, 'INVALID_CREDENTIALS');
  const notStaff = await call('POST', '/auth/login', undefined, { ...body, role: 'ADMIN', customRoleId: ids.role });
  assert.equal(notStaff.body.error.code, 'VALIDATION_ERROR');
});

test('admin reset password works for STAFF', { skip: !enabled }, async () => {
  const r = await call('POST', `/admin/users/${ids.user}/reset-password`, tokens.a);
  assert.equal(r.status, 200);
});

test('deactivating the role blocks login and refresh; delete only when unused', { skip: !enabled }, async () => {
  const login = await call('POST', '/auth/login', undefined, { identifier: 'ravi@schoola.com', password: '123456', role: 'STAFF', schoolId: ids.a });
  const refreshToken = login.body.data.tokens.refreshToken;

  assert.equal((await call('DELETE', `/super-admin/roles/${ids.role}`, tokens.sa)).body.error.code, 'ROLE_IN_USE');
  const off = await call('PATCH', `/super-admin/roles/${ids.role}`, tokens.sa, { isActive: false, name: 'ACCOUNTS OFFICER' });
  assert.equal(off.body.data.isActive, false);
  assert.equal(off.body.data.key, 'ACCOUNTANT');          // key never changes
  assert.equal(off.body.data.name, 'Accounts Officer');

  const blocked = await call('POST', '/auth/login', undefined, { identifier: 'ravi@schoola.com', password: '123456', role: 'STAFF', schoolId: ids.a });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'ROLE_INACTIVE');
  assert.equal((await call('POST', '/auth/refresh', undefined, { refreshToken })).status, 401);
  assert.equal((await call('GET', '/admin/roles', tokens.a)).body.data.items.some((r: any) => r.key === 'ACCOUNTANT'), false);
  assert.equal((await call('POST', '/admin/role-users', tokens.a, { customRoleId: ids.role, name: 'New One', email: 'n@schoola.com' })).body.error.code, 'ROLE_NOT_FOUND');

  const reactivate = await call('POST', '/super-admin/roles', tokens.sa, { name: 'accountant' });
  assert.equal(reactivate.body.error.details.isActive, false);   // tells the UI to reactivate instead

  assert.equal((await call('DELETE', `/super-admin/roles/${ids.role2}`, tokens.sa)).status, 200);  // unused → deletable
});

test('deactivating the account logs it out; DB rejects STAFF without a role', { skip: !enabled }, async () => {
  await call('PATCH', `/super-admin/roles/${ids.role}`, tokens.sa, { isActive: true });
  const login = await call('POST', '/auth/login', undefined, { identifier: 'ravi@schoola.com', password: '123456', role: 'STAFF', schoolId: ids.a });
  assert.equal(login.status, 200);
  const upd = await call('PATCH', `/admin/role-users/${ids.user}`, tokens.a, { isActive: false });
  assert.equal(upd.body.data.isActive, false);
  assert.equal((await call('POST', '/auth/refresh', undefined, { refreshToken: login.body.data.tokens.refreshToken })).status, 401);

  await assert.rejects(prisma.user.create({ data: { name: 'Bad', email: 'bad@test.com', passwordHash: 'x', role: 'STAFF', schoolId: ids.a } }));
  await assert.rejects(prisma.user.create({ data: { name: 'Bad', email: 'bad2@test.com', passwordHash: 'x', role: 'TEACHER', schoolId: ids.a, customRoleId: ids.role } }));
});
