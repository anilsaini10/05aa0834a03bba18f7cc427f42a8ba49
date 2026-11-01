// Permission helpers — no DB queries. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCamelCase, replacePermissionsSchema, patchPermissionsSchema } from '../src/features/permissions/permissions.validation';
import { effectivePermissions } from '../src/features/permissions/permissions.service';

test('camelCase suggestions', () => {
  assert.equal(toCamelCase('fees_collect'), 'feesCollect');
  assert.equal(toCamelCase('Can Edit Fees'), 'canEditFees');
  assert.equal(toCamelCase('FeesCollect'), 'feesCollect');
  assert.equal(toCamelCase('max-discount-percent'), 'maxDiscountPercent');
});

test('accepted values and keys', () => {
  const ok = replacePermissionsSchema.safeParse({ permissions: {
    feesCollect: true, maxDiscountPercent: 10, reportFormat: 'pdf', allowedClasses: ['1', '2'], feeIds: [1, 2],
  } });
  assert.equal(ok.success, true);
  assert.equal(replacePermissionsSchema.safeParse({ permissions: {} }).success, true);   // clear all
});

test('rejected keys and values', () => {
  const bad = (permissions: unknown) => replacePermissionsSchema.safeParse({ permissions }).success;
  assert.equal(bad({ fees_collect: true }), false);
  assert.equal(bad({ FeesCollect: true }), false);
  assert.equal(bad({ '1fees': true }), false);
  assert.equal(bad({ constructor: true }), false);
  assert.equal(bad({ feesCollect: { nested: true } }), false);
  assert.equal(bad({ feesCollect: null }), false);          // null only in PATCH
  assert.equal(bad(['feesCollect']), false);
  assert.equal(bad('feesCollect'), false);
  const r = replacePermissionsSchema.safeParse({ permissions: { fees_collect: true } });
  assert.match(JSON.stringify(r.error?.issues), /use \\"feesCollect\\"/);
});

test('patch: null removes, empty patch rejected', () => {
  assert.equal(patchPermissionsSchema.safeParse({ permissions: { feesCollect: null } }).success, true);
  assert.equal(patchPermissionsSchema.safeParse({ permissions: {} }).success, false);
});

test('school false blocks the same role key', () => {
  const e = effectivePermissions(
    { feesCollect: true, salaryView: true, reportsView: false, maxDiscountPercent: 10 },
    { salaryView: false, reportsView: false, feesCollect: true },
  );
  assert.deepEqual(e.permissions, { feesCollect: true, salaryView: false, reportsView: false, maxDiscountPercent: 10 });
  assert.deepEqual(e.blockedBySchool, ['salaryView']);
});
