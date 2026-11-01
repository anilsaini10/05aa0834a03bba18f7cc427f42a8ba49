// Custom role name normalization — no DB. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRoleKey, normalizeRoleName, ROLE_KEY_PATTERN, RESERVED_ROLE_KEYS } from '../src/shared/utils/roleKey';

test('any case / spacing gives the same key', () => {
  for (const raw of ['accountant', 'Accountant', 'ACCOUNTANT', '  accountant  ', 'AcCoUnTaNt']) {
    assert.equal(normalizeRoleKey(raw), 'ACCOUNTANT');
  }
  assert.equal(normalizeRoleKey('head clerk'), 'HEAD_CLERK');
  assert.equal(normalizeRoleKey('Head  -  Clerk'), 'HEAD_CLERK');
  assert.equal(normalizeRoleKey('head_clerk'), 'HEAD_CLERK');
  assert.equal(normalizeRoleKey('Café Manager'), 'CAFE_MANAGER');
  assert.equal(normalizeRoleKey('Lab Assistant 2'), 'LAB_ASSISTANT_2');
});

test('invalid and reserved keys', () => {
  assert.equal(ROLE_KEY_PATTERN.test(normalizeRoleKey('!!!')), false);
  assert.equal(ROLE_KEY_PATTERN.test(normalizeRoleKey('2nd clerk')), false);   // must start with a letter
  assert.ok(RESERVED_ROLE_KEYS.has(normalizeRoleKey('teacher')));
  assert.ok(RESERVED_ROLE_KEYS.has(normalizeRoleKey('Super Admin')));
  assert.ok(RESERVED_ROLE_KEYS.has(normalizeRoleKey('staff')));
});

test('display name', () => {
  assert.equal(normalizeRoleName('accountant'), 'Accountant');
  assert.equal(normalizeRoleName('ACCOUNTANT'), 'Accountant');
  assert.equal(normalizeRoleName('head   clerk'), 'Head Clerk');
  assert.equal(normalizeRoleName('HR Manager'), 'HR Manager');   // deliberate mixed case kept
});
