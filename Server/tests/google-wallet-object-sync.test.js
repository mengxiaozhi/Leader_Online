const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GOOGLE_WALLET_ISSUER_SCOPE,
  backoffSeconds,
  enqueueGoogleWalletObjectSync,
  isGoogleWalletTerminalError,
  isGoogleWalletTransientError,
  processGoogleWalletObjectSyncJobs,
  syncGenericObjectIfSaved,
} = require('../src/services/google-wallet-object-sync');

const object = {
  id: '1234567890123456789.reservation_test',
  classId: '1234567890123456789.transport',
  state: 'ACTIVE',
};

function httpError(status, message = `HTTP ${status}`) {
  return Object.assign(new Error(message), { response: { status } });
}

test('Google Wallet REST sync GETs then fully PUTs an already-saved object', async () => {
  const calls = [];
  const result = await syncGenericObjectIfSaved({
    object,
    request: async (options) => {
      calls.push(options);
      return { data: {} };
    },
  });

  assert.equal(result.saved, true);
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'PUT']);
  assert.deepEqual(calls[1].data, object);
  assert.match(calls[0].url, /genericObject\/1234567890123456789\.reservation_test$/);
  assert.equal(calls[0].timeout, 5000);
});

test('Google Wallet REST 404 means the pass has not been saved and is not an error', async () => {
  const calls = [];
  const result = await syncGenericObjectIfSaved({
    object,
    request: async (options) => {
      calls.push(options);
      throw httpError(404);
    },
  });

  assert.equal(result.saved, false);
  assert.equal(result.updated, false);
  assert.equal(calls.length, 1);
});

test('Google Wallet retry and terminal classifications cover rate limits and permissions', () => {
  assert.equal(GOOGLE_WALLET_ISSUER_SCOPE, 'https://www.googleapis.com/auth/wallet_object.issuer');
  assert.equal(isGoogleWalletTransientError(httpError(408)), true);
  assert.equal(isGoogleWalletTransientError(httpError(429)), true);
  assert.equal(isGoogleWalletTransientError(httpError(503)), true);
  assert.equal(isGoogleWalletTransientError(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), true);
  assert.equal(isGoogleWalletTerminalError(httpError(403)), true);
  assert.equal(isGoogleWalletTerminalError(httpError(500)), false);
  assert.deepEqual([1, 2, 3, 10].map(backoffSeconds), [5, 10, 20, 900]);
});

test('leased worker keeps configuration failures pending without exhausting retries', async () => {
  const pool = workerPool(dueJob({ attempts: 7 }));
  const results = await processGoogleWalletObjectSyncJobs({
    pool,
    request: async () => {
      const error = new Error('credentials temporarily unavailable');
      error.code = 'GOOGLE_WALLET_NOT_CONFIGURED';
      error.terminal = true;
      throw error;
    },
    logger: { error() {} },
  });

  assert.equal(results[0].retrying, true);
  const pending = pool.calls.find((call) => (
    call.sql.includes("SET status = 'pending'")
    && call.sql.includes('last_error_code')
  ));
  assert.ok(pending);
  assert.equal(pending.params[0], 300);
  assert.equal(pending.params[1], 'GOOGLE_WALLET_NOT_CONFIGURED');
  assert.doesNotMatch(pending.sql, /attempts = \?/);
});

test('outbox enqueue coalesces by object id and increments generation', async () => {
  const calls = [];
  const queryable = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
  };
  await enqueueGoogleWalletObjectSync(queryable, {
    resourceType: 'reservation',
    resourceId: 901,
    holderUserId: 'member-001',
    objectId: object.id,
    action: 'INACTIVATE',
    payload: { ...object, state: 'INACTIVE' },
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /ON DUPLICATE KEY UPDATE/);
  assert.match(calls[0].sql, /generation = generation \+ 1/);
  assert.match(calls[0].sql, /lease_owner = IF\(/);
  assert.match(calls[0].sql, /status = IF\(/);
  assert.equal(calls[0].params[4], 'INACTIVATE');
  assert.doesNotMatch(calls[0].params[5], /photo|data:image/i);
});

function workerPool(job) {
  const calls = [];
  let claimed = false;
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (
        sql.includes('SELECT id, object_id, action, payload')
        && sql.includes("WHERE status = 'processing' AND lease_owner = ?")
      ) {
        if (claimed) return [[]];
        claimed = true;
        return [[job]];
      }
      if (sql.includes('WHERE id = ? AND status = \'processing\' AND lease_owner = ?')) {
        return [[]];
      }
      return [{ affectedRows: 1 }];
    },
  };
}

function dueJob(overrides = {}) {
  return {
    id: 12,
    object_id: object.id,
    action: 'UPSERT',
    payload: JSON.stringify(object),
    generation: 4,
    attempts: 0,
    max_attempts: 8,
    ...overrides,
  };
}

test('leased worker retries 5xx with backoff and preserves the generation guard', async () => {
  const pool = workerPool(dueJob());
  const results = await processGoogleWalletObjectSyncJobs({
    pool,
    request: async () => {
      throw httpError(503);
    },
    logger: { error() {} },
  });

  assert.equal(results[0].retrying, true);
  const retry = pool.calls.find((call) => call.sql.includes("SET status = 'pending'"));
  assert.ok(retry);
  assert.equal(retry.params[0], 1);
  assert.equal(retry.params[1], 5);
  assert.ok(retry.sql.includes('generation = ?'));
  assert.equal(retry.params.at(-2), 4);
});

test('leased worker marks permission failures terminal without retrying', async () => {
  const pool = workerPool(dueJob());
  const results = await processGoogleWalletObjectSyncJobs({
    pool,
    request: async () => {
      throw httpError(403);
    },
    logger: { error() {} },
  });

  assert.equal(results[0].retrying, false);
  const failed = pool.calls.find((call) => call.sql.includes("SET status = 'failed'"));
  assert.ok(failed);
  assert.equal(failed.params[1], 'HTTP_403');
});

test('leased worker completes a 404 job because an unsaved pass needs no live update', async () => {
  const pool = workerPool(dueJob());
  const results = await processGoogleWalletObjectSyncJobs({
    pool,
    request: async () => {
      throw httpError(404);
    },
    logger: { error() {} },
  });

  assert.equal(results[0].ok, true);
  assert.equal(results[0].saved, false);
  assert.ok(pool.calls.some((call) => call.sql.includes("SET status = 'completed'")));
});

test('a leased worker drains a newer generation before releasing the object lease', async () => {
  const calls = [];
  const puts = [];
  let claimReturned = false;
  let current = dueJob();
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (
        sql.includes('SELECT id, object_id, action, payload')
        && sql.includes("WHERE status = 'processing' AND lease_owner = ?")
      ) {
        if (claimReturned) return [[]];
        claimReturned = true;
        return [[{ ...current }]];
      }
      if (sql.includes('WHERE id = ? AND status = \'processing\' AND lease_owner = ?')) {
        return [[{ ...current }]];
      }
      if (sql.includes("SET status = 'completed'")) {
        const requestedGeneration = Number(params[1]);
        return [{ affectedRows: requestedGeneration === current.generation ? 1 : 0 }];
      }
      return [{ affectedRows: 1 }];
    },
  };

  const results = await processGoogleWalletObjectSyncJobs({
    pool,
    limit: 1,
    request: async (options) => {
      if (options.method === 'PUT') {
        puts.push(options.data.state);
        if (puts.length === 1) {
          current = dueJob({
            generation: 5,
            action: 'INACTIVATE',
            payload: JSON.stringify({ ...object, state: 'INACTIVE' }),
          });
        }
      }
      return { data: {} };
    },
    logger: { error() {} },
  });

  assert.deepEqual(puts, ['ACTIVE', 'INACTIVE']);
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
  assert.equal(
    calls.filter((call) => call.sql.includes('SET lease_expires_at = DATE_ADD')).length,
    2
  );
});
