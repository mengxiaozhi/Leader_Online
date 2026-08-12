'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  COURSE_PRODUCTIZATION_WORKER_LOCK,
  advancedPaymentsEnabledByEnvironment,
  enabledByEnvironment,
  processCourseProductizationJobs,
  startCourseProductizationWorker,
} = require('../src/services/course-productization-worker');
const { createCourseTermDomain } = require('../src/services/course-term-domain');

function lease() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
      throw new Error(`unexpected lease query: ${sql}`);
    },
    release() {},
  };
}

test('compensation worker remains started when both product feature flags are off', () => {
  const worker = startCourseProductizationWorker({
    pool: {},
    intervalMs: 60000,
    advancedPaymentsEnabled: false,
    fixedTermEnabled: false,
  });
  assert.equal(worker.enabled, true);
  worker.stop();
});

test('fixed-term worker can advance waitlist without enabling 053 payments', async () => {
  assert.equal(enabledByEnvironment({ fixedTerm: 'true', advancedPayments: 'false' }), true);
  assert.equal(enabledByEnvironment({ fixedTerm: 'false', advancedPayments: 'true' }), true);
  assert.equal(enabledByEnvironment({ fixedTerm: 'false', advancedPayments: 'false' }), false);
  assert.equal(advancedPaymentsEnabledByEnvironment('true'), true);
  assert.equal(advancedPaymentsEnabledByEnvironment('false'), false);

  const lock = lease();
  const calls = [];
  const pool = {
    async getConnection() { return lock; },
  };
  const domain = {
    async readSchemaState() {
      return { termSchemaReady: true, paymentSchemaReady: false };
    },
    async expireDueHolds(options) {
      calls.push('payments');
      return [];
    },
  };

  const adminDomain = {
    async expireDueSeatOffers(options) {
      assert.equal(options.requireEnabled, false);
      calls.push('expire-waitlist');
      return [{ offerId: 1 }];
    },
    async fillAvailableWaitlistOffers() {
      calls.push('fill-waitlist');
      return [{ offerId: 2 }];
    },
  };
  const result = await processCourseProductizationJobs({
    pool,
    domain,
    adminDomain,
    advancedPaymentsEnabled: false,
    fixedTermEnabled: true,
  });

  assert.equal(result.acquired, true);
  assert.deepEqual(result.expiredOrders, []);
  assert.deepEqual(result.notifications, []);
  assert.deepEqual(result.expiredWaitlistOffers, [{ offerId: 1 }]);
  assert.deepEqual(result.createdWaitlistOffers, [{ offerId: 2 }]);
  assert.deepEqual(calls, ['expire-waitlist', 'fill-waitlist']);
  assert.equal(lock.calls[0].params[0], COURSE_PRODUCTIZATION_WORKER_LOCK);
});

test('053-only schema drains notification outbox without starting 052 jobs', async () => {
  const lock = lease();
  const calls = [];
  const result = await processCourseProductizationJobs({
    pool: { async getConnection() { return lock; } },
    domain: {
      async readSchemaState() {
        return { termSchemaReady: false, paymentSchemaReady: true };
      },
      async expireDueHolds() { calls.push('payments'); return []; },
    },
    adminDomain: {
      async expireDueSeatOffers() { calls.push('expire-waitlist'); return []; },
      async fillAvailableWaitlistOffers() { calls.push('fill-waitlist'); return []; },
    },
    notificationProcessor: async () => { calls.push('notifications'); return [{ id: 7 }]; },
    advancedPaymentsEnabled: true,
    fixedTermEnabled: false,
  });
  assert.deepEqual(result.expiredOrders, []);
  assert.deepEqual(result.expiredWaitlistOffers, []);
  assert.deepEqual(result.createdWaitlistOffers, []);
  assert.deepEqual(result.notifications, [{ id: 7 }]);
  assert.deepEqual(calls, ['notifications']);
});

test('feature rollback still compensates 052/053 resources but does not create a waitlist offer', async () => {
  const lock = lease();
  const calls = [];
  const result = await processCourseProductizationJobs({
    pool: { async getConnection() { return lock; } },
    domain: {
      async readSchemaState(options) {
        assert.equal(options.refresh, true);
        return { termSchemaReady: true, paymentSchemaReady: true };
      },
      async expireDueHolds(options) {
        assert.equal(options.requireEnabled, false);
        calls.push('expire-holds');
        return [31];
      },
    },
    adminDomain: {
      async expireDueSeatOffers(options) {
        assert.equal(options.requireEnabled, false);
        calls.push('expire-waitlist');
        return [{ offerId: 41 }];
      },
      async fillAvailableWaitlistOffers() {
        calls.push('fill-waitlist');
        return [{ offerId: 42 }];
      },
    },
    notificationProcessor: async () => {
      calls.push('notifications');
      return [{ id: 51 }];
    },
    advancedPaymentsEnabled: false,
    fixedTermEnabled: false,
  });

  assert.deepEqual(result.expiredOrders, [31]);
  assert.deepEqual(result.expiredWaitlistOffers, [{ offerId: 41 }]);
  assert.deepEqual(result.createdWaitlistOffers, []);
  assert.deepEqual(result.notifications, [{ id: 51 }]);
  assert.deepEqual(calls, ['expire-holds', 'expire-waitlist', 'notifications']);
});

test('expireDueHolds supports schema-only compensation when feature flags are off', async () => {
  const calls = [];
  const conn = {
    async beginTransaction() { calls.push('begin'); },
    async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); },
    release() { calls.push('release'); },
    async query(sql) {
      if (sql.includes('FROM course_seat_allocations')) return [[]];
      throw new Error(`unexpected transaction query: ${sql}`);
    },
  };
  const pool = {
    async query(sql) {
      if (sql.includes('FROM course_schema_versions')) {
        return [[
          { version: '052_course_fixed_term_productization' },
          { version: '053_course_term_payments_notifications' },
        ]];
      }
      throw new Error(`unexpected pool query: ${sql}`);
    },
    async getConnection() { return conn; },
  };
  const domain = createCourseTermDomain({
    pool,
    enabled: false,
    advancedPaymentsEnabled: false,
  });

  assert.deepEqual(await domain.expireDueHolds({ requireEnabled: false }), []);
  assert.deepEqual(calls, ['begin', 'commit', 'release']);
});
