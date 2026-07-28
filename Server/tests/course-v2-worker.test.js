const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COURSE_V2_WORKER_LOCK,
  processCourseV2AttendanceInvites,
} = require('../src/services/course-v2-worker');

function createLease({ acquired = 1 } = {}) {
  const calls = [];
  return {
    calls,
    released: false,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('GET_LOCK')) return [[{ acquired }]];
      if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
      throw new Error(`Unexpected lease query: ${sql}`);
    },
    release() {
      this.released = true;
    },
  };
}

test('course V2 worker skips cleanly when the runtime feature is disabled', async () => {
  const result = await processCourseV2AttendanceInvites({
    pool: {},
    domain: {
      enabled: false,
    },
  });
  assert.deepEqual(result, { enabled: false, acquired: false, processed: [] });
});

test('course V2 worker holds one MySQL lease around the due-invite batch', async () => {
  const lease = createLease();
  const observed = [];
  const pool = {
    async getConnection() {
      return lease;
    },
  };
  const domain = {
    enabled: true,
    async assertSchema() {
      observed.push('schema');
    },
    async processDueAttendanceInvites({ limit }) {
      observed.push(`batch:${limit}`);
      return [{ id: 7, status: 'auto_redeemed' }];
    },
    async processDueAutoNoShows({ limit }) {
      observed.push(`no-show:${limit}`);
      return [{ id: 8, status: 'no_show' }];
    },
  };

  const result = await processCourseV2AttendanceInvites({
    pool,
    domain,
    limit: 25,
  });

  assert.deepEqual(result, {
    enabled: true,
    acquired: true,
    processed: [{ id: 7, status: 'auto_redeemed' }],
    invites: [{ id: 7, status: 'auto_redeemed' }],
    autoNoShows: [{ id: 8, status: 'no_show' }],
  });
  assert.deepEqual(observed, ['schema', 'batch:25', 'no-show:25']);
  assert.equal(lease.calls[0].params[0], COURSE_V2_WORKER_LOCK);
  assert.match(lease.calls[0].sql, /GET_LOCK/);
  assert.match(lease.calls.at(-1).sql, /RELEASE_LOCK/);
  assert.equal(lease.released, true);
});

test('course V2 worker does not run a batch when another process owns the lease', async () => {
  const lease = createLease({ acquired: 0 });
  let batches = 0;
  const result = await processCourseV2AttendanceInvites({
    pool: {
      async getConnection() {
        return lease;
      },
    },
    domain: {
      enabled: true,
      async assertSchema() {},
      async processDueAttendanceInvites() {
        batches += 1;
        return [];
      },
    },
  });

  assert.equal(result.acquired, false);
  assert.equal(batches, 0);
  assert.equal(lease.calls.some(({ sql }) => sql.includes('RELEASE_LOCK')), false);
  assert.equal(lease.released, true);
});
