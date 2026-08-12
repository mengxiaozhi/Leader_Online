const assert = require('node:assert/strict');
const test = require('node:test');

const {
  shouldIncludeRequiredAddons,
  isBundleIssuableShopProductStatus,
  resolveReturningEligibility,
} = require('../src/services/course-v2-sales');

test('required add-on inclusion covers all new/returning and flag combinations', () => {
  assert.equal(shouldIncludeRequiredAddons(false, false), false);
  assert.equal(shouldIncludeRequiredAddons(false, true), false);
  assert.equal(shouldIncludeRequiredAddons(true, false), true);
  assert.equal(shouldIncludeRequiredAddons(true, true), false);
});

test('unknown identity is provisional only when new-student add-on is enabled', () => {
  assert.equal(shouldIncludeRequiredAddons(false, null), false);
  assert.equal(shouldIncludeRequiredAddons(true, null), true);
});

test('explicitly linked hidden add-ons remain bundle issuable until disabled', () => {
  assert.equal(isBundleIssuableShopProductStatus('published'), true);
  assert.equal(isBundleIssuableShopProductStatus('draft'), true);
  assert.equal(isBundleIssuableShopProductStatus('archived'), false);
  assert.equal(isBundleIssuableShopProductStatus('disabled'), false);
});

test('returning eligibility recognizes direct and claimed imported ticket ownership', async () => {
  const calls = [];
  const queryable = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [[{ id: 77 }]];
    },
  };

  assert.equal(await resolveReturningEligibility(queryable, {
    productId: 3,
    userId: 'member-1',
  }), true);
  assert.match(calls[0].sql, /previous\.user_id = \? OR previous_student\.user_id = \?/);
  assert.match(calls[0].sql, /qualifying_order\.payment_status = 'paid'/);
  assert.match(calls[0].sql, /qualifying_order\.fulfillment_status = 'fulfilled'/);
  assert.match(calls[0].sql, /manual_issuance\.source_type = 'manual_qualification'/);
  assert.deepEqual(calls[0].params, [3, 'member-1', 'member-1']);
});
