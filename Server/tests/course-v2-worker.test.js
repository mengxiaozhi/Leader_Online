const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COURSE_V2_WORKER_LOCK,
  countCardParityEnabledByEnvironment,
  enabledByEnvironment,
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
    async assertCountCardParity() {
      observed.push('051');
    },
    async processDueAttendanceInvites({ limit }) {
      observed.push(`batch:${limit}`);
      return [{ id: 7, status: 'auto_redeemed' }];
    },
    async processDueAutoNoShows({ limit }) {
      observed.push(`no-show:${limit}`);
      return [{ id: 8, status: 'no_show' }];
    },
    async processDuePausedTickets({ limit }) {
      observed.push(`pause:${limit}`);
      return [{ ticketId: 9, status: 'active' }];
    },
    async processDuePartialTransfers() {
      return [];
    },
  };

  const result = await processCourseV2AttendanceInvites({
    pool,
    domain,
    limit: 25,
    countCardParityEnabled: true,
  });

  assert.deepEqual(result, {
    enabled: true,
    acquired: true,
    processed: [{ id: 7, status: 'auto_redeemed' }],
    invites: [{ id: 7, status: 'auto_redeemed' }],
    autoNoShows: [{ id: 8, status: 'no_show' }],
    pausedTickets: [{ ticketId: 9, status: 'active' }],
    partialTransfers: [],
  });
  assert.deepEqual(observed, ['schema', '051', 'batch:25', 'no-show:25', 'pause:25']);
  assert.equal(lease.calls[0].params[0], COURSE_V2_WORKER_LOCK);
  assert.match(lease.calls[0].sql, /GET_LOCK/);
  assert.match(lease.calls.at(-1).sql, /RELEASE_LOCK/);
  assert.equal(lease.released, true);
});

test('count-card parity expiration runs under the same V2 lease only when its flag is enabled', async () => {
  assert.equal(enabledByEnvironment('true'), true);
  assert.equal(enabledByEnvironment('false'), false);
  assert.equal(countCardParityEnabledByEnvironment('true'), true);
  assert.equal(countCardParityEnabledByEnvironment('false'), false);
  const lease = createLease();
  const observed = [];
  const result = await processCourseV2AttendanceInvites({
    pool: {
      async getConnection() {
        return lease;
      },
    },
    domain: {
      enabled: true,
      async assertSchema() {},
      async assertCountCardParity() {},
      async processDueAttendanceInvites() { return []; },
      async processDueAutoNoShows() { return []; },
      async processDuePausedTickets() { return []; },
      async processDuePartialTransfers({ limit }) {
        observed.push(limit);
        return [{ transferId: 55, status: 'expired' }];
      },
    },
    limit: 20,
    countCardParityEnabled: true,
  });
  assert.deepEqual(observed, [20]);
  assert.deepEqual(result.partialTransfers, [{ transferId: 55, status: 'expired' }]);
  assert.equal(lease.calls.some(({ sql }) => sql.includes('RELEASE_LOCK')), true);
});

test('051 worker batches remain dormant when only legacy V2 is enabled', async () => {
  const lease = createLease();
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
      async processDueAttendanceInvites() { batches += 1; return []; },
      async processDueAutoNoShows() { batches += 1; return []; },
      async processDuePausedTickets() { batches += 1; return []; },
      async processDuePartialTransfers() { batches += 1; return []; },
    },
    countCardParityEnabled: false,
  });
  assert.equal(batches, 0);
  assert.deepEqual(result.invites, []);
  assert.deepEqual(result.autoNoShows, []);
  assert.deepEqual(result.pausedTickets, []);
  assert.deepEqual(result.partialTransfers, []);
});

test('051 rollback keeps existing invite, pause, and transfer compensation batches alive', async () => {
  const lease = createLease();
  const observed = [];
  const result = await processCourseV2AttendanceInvites({
    pool: {
      async getConnection() {
        return lease;
      },
    },
    domain: {
      enabled: true,
      async assertSchema() {},
      async assertCountCardParity(_queryable, options) {
        observed.push(['schema', options]);
      },
      async processDueAttendanceInvites() { observed.push(['invites']); return [{ id: 1 }]; },
      async processDueAutoNoShows() { observed.push(['auto-no-show']); return []; },
      async processDuePausedTickets() { observed.push(['pauses']); return [{ ticketId: 2 }]; },
      async processDuePartialTransfers() { observed.push(['transfers']); return [{ transferId: 3 }]; },
    },
    countCardParityEnabled: false,
  });

  assert.deepEqual(observed, [
    ['schema', { requireEnabled: false }],
    ['invites'],
    ['pauses'],
    ['transfers'],
  ]);
  assert.deepEqual(result.invites, [{ id: 1 }]);
  assert.deepEqual(result.pausedTickets, [{ ticketId: 2 }]);
  assert.deepEqual(result.partialTransfers, [{ transferId: 3 }]);
  assert.deepEqual(result.autoNoShows, []);
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
    countCardParityEnabled: false,
  });

  assert.equal(result.acquired, false);
  assert.equal(batches, 0);
  assert.equal(lease.calls.some(({ sql }) => sql.includes('RELEASE_LOCK')), false);
  assert.equal(lease.released, true);
});
