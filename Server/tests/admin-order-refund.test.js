const assert = require('node:assert/strict');
const test = require('node:test');
const wallet = require('../src/services/reservation-google-wallet');
const walletSync = require('../src/services/google-wallet-object-sync');

// Keep wallet delivery outside this route test; queueing remains transactional.
test.mock.method(wallet, 'inactivateReservationGoogleWalletForHolder', async ({ queryable, reservation }) => {
  queryable.queueWallet(reservation.id);
  return { pass: { objectId: `test.${reservation.id}` } };
});
test.mock.method(walletSync, 'processGoogleWalletObjectSyncJobs', async () => {});
const buildOrderRoutes = require('../src/routes/orders');

function fixture({ status = 'service_booking', evidence = '', checklist = false, failWrite = false, oldSchema = false } = {}) {
  let state = {
    order: {
      id: 161, code: 'REFUND-161', user_id: 'buyer', row_version: 3,
      payment_status: 'paid', fulfillment_status: 'fulfilled',
      details: JSON.stringify({ status: '已付款', reservations_granted: true, selections: [{ storeId: 7, qty: 1 }], total: 2000 }),
    },
    reservations: [{ id: 801, order_id: 161, user_id: 'buyer', status, verify_code: 'OLD-CODE',
      verify_code_pre_dropoff: 'OLD-DROPOFF', pre_dropoff_checklist: checklist ? '{"completed":true}' : '{}' }],
    keys: {}, events: [], walletJobs: [], commits: 0, rollbacks: 0, mails: [],
  };
  let snapshot;
  let sequence = 0;
  const query = async (sql, params = []) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    if (q.startsWith('INSERT IGNORE INTO order_action_idempotency')) {
      if (state.keys[params[3]]) return [{ affectedRows: 0 }];
      state.keys[params[3]] = { resource_id: params[2], request_hash: params[4], status: 'processing' };
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('SELECT resource_id, request_hash')) return [[state.keys[params[2]]]];
    if (q.startsWith('UPDATE order_action_idempotency')) {
      Object.assign(state.keys[params[3]], { response_json: params[0], status: 'completed' });
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('SELECT * FROM orders WHERE id')) return [[structuredClone(state.order)]];
    if (q.startsWith('SELECT * FROM reservations WHERE order_id')) return [structuredClone(state.reservations)];
    if (q.startsWith('SHOW COLUMNS FROM reservations')) return [[{ Type: oldSchema ? "enum('service_booking','done')" : "enum('service_booking','done','cancelled')" }]];
    if (q.startsWith('SELECT DISTINCT reservation_id FROM')) {
      return [evidence && q.includes(`FROM ${evidence} `) ? [{ reservation_id: 801 }] : []];
    }
    if (q.startsWith('UPDATE reservations SET verify_code')) {
      const reservation = state.reservations.find(row => row.id === params.at(-1));
      Object.assign(reservation, { verify_code: params[0], verify_code_pre_dropoff: params[1] });
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith("UPDATE reservations SET status = 'cancelled'")) {
      state.reservations.forEach(row => { row.status = 'cancelled'; });
      return [{ affectedRows: state.reservations.length }];
    }
    if (q.startsWith('UPDATE reservation_tasks SET status')) return [{ affectedRows: 0 }];
    if (q.includes('FROM tickets')) return [[]];
    if (q.startsWith('UPDATE orders SET details = ?')) {
      if (failWrite) throw new Error('simulated order write failure');
      assert.equal(params.at(-1), state.order.row_version);
      Object.assign(state.order, { details: params[0], payment_status: params[1], fulfillment_status: params[2], row_version: state.order.row_version + 1 });
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('INSERT INTO order_lifecycle_events')) {
      state.events.push({ action: params[3], reason: params[8], metadata: JSON.parse(params[10]) });
      return [{ affectedRows: 1 }];
    }
    if (q.includes('FROM order_lifecycle_events')) return [[]];
    throw new Error(`Unexpected SQL: ${q}`);
  };
  const conn = {
    query,
    queueWallet(id) { state.walletJobs.push(id); },
    async beginTransaction() { snapshot = structuredClone(state); },
    async commit() { state.commits++; },
    async rollback() { state = { ...snapshot, rollbacks: state.rollbacks + 1 }; },
    release() {},
  };
  const middleware = (_req, _res, next) => next();
  const router = buildOrderRoutes({
    pool: { query, getConnection: async () => conn },
    authRequired: middleware, adminOnly: middleware, serviceProviderOnly: middleware,
    isADMIN: role => role === 'ADMIN',
    normalizePositiveInt: value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null,
    safeParseJSON(value, fallback = {}) { try { return typeof value === 'string' ? JSON.parse(value) : (value ?? fallback); } catch { return fallback; } },
    generateReservationStageCode: async () => `NEW-${++sequence}`,
    getUserContact: async () => ({ username: '測試會員', email: 'buyer@example.test' }),
    summarizeOrderDetails: () => '測試退款',
    sendOrderNotificationEmail: async payload => { assert.ok(state.commits > 0); state.mails.push(payload); return { mailed: true }; },
    ok: (res, data) => res.status(200).json({ ok: true, data }),
    fail: (res, code, message, status) => res.status(status).json({ ok: false, code, message }),
  });
  const single = router.stack.find(layer => layer.route?.path === '/admin/orders/:id/actions/:action').route.stack.at(-1).handle;
  const bulk = router.stack.find(layer => layer.route?.path === '/admin/orders/bulk-actions').route.stack.at(-1).handle;
  return {
    get state() { return state; },
    async request({ version = 3, key = 'refund-161', reason = '客戶申請退款', batch = false } = {}) {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      const req = { params: { id: '161', action: 'refund' }, user: { id: 'admin', role: 'ADMIN' },
        headers: { 'if-match': String(version), 'idempotency-key': key },
        body: batch ? { action: 'refund', items: [{ id: 161, rowVersion: version }], reason } : { reason } };
      await (batch ? bulk : single)(req, res);
      return res;
    },
  };
}

for (const status of ['pending', 'service_booking', '', 'cancelled', 'expired']) {
  test(`whole-order refund cancels ${status || 'legacy empty'} reservations without a refund reference`, async () => {
    const f = fixture({ status });
    const result = await f.request();
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    assert.equal(f.state.order.payment_status, 'refunded');
    assert.equal(f.state.order.fulfillment_status, 'voided');
    assert.equal(f.state.order.row_version, 4);
    assert.equal(f.state.reservations[0].status, 'cancelled');
    assert.notEqual(f.state.reservations[0].verify_code, 'OLD-CODE');
    assert.notEqual(f.state.reservations[0].verify_code_pre_dropoff, 'OLD-DROPOFF');
    assert.deepEqual(f.state.walletJobs, [801]);
    assert.equal(f.state.events[0].reason, '客戶申請退款');
    assert.deepEqual(f.state.events[0].metadata.reservationIds, [801]);
    assert.equal(f.state.mails.length, 1);
    const replay = await f.request();
    assert.equal(replay.body.replayed, true);
    assert.equal(f.state.events.length, 1);
    assert.equal(f.state.walletJobs.length, 1);
    assert.equal(f.state.mails.length, 1);
  });
}

for (const status of ['pre_dropoff', 'pre_pickup', 'post_dropoff', 'post_pickup', 'done', 'unknown']) {
  test(`refund still rejects reservations in ${status}`, async () => {
    const f = fixture({ status });
    const result = await f.request();
    assert.equal(result.statusCode, 409);
    assert.equal(f.state.order.payment_status, 'paid');
    assert.equal(f.state.reservations[0].status, status);
    assert.deepEqual(f.state.walletJobs, []);
    assert.deepEqual(f.state.events, []);
  });
}

for (const evidence of ['reservation_checklist_photos', 'reservation_assignments', 'reservation_transfers', 'reservation_tasks']) {
  for (const status of ['service_booking', 'cancelled']) test(`refund protects ${status} reservations with ${evidence}`, async () => {
    const f = fixture({ status, evidence });
    const result = await f.request();
    assert.equal(result.statusCode, 409);
    assert.equal(result.body.code, 'ORDER_FULFILLMENT_ALREADY_STARTED');
    assert.equal(f.state.order.payment_status, 'paid');
    assert.equal(f.state.reservations[0].verify_code, 'OLD-CODE');
    assert.deepEqual(f.state.walletJobs, []);
  });
}

test('refund still protects completed checklists and stale order versions', async () => {
  const checked = fixture({ checklist: true });
  assert.equal((await checked.request()).body.code, 'ORDER_FULFILLMENT_ALREADY_STARTED');
  const stale = fixture();
  assert.equal((await stale.request({ version: 2 })).body.code, 'ORDER_VERSION_CONFLICT');
  assert.equal(stale.state.reservations[0].status, 'service_booking');
});

test('failed refund restores reservations, verification codes, wallet jobs and idempotency claim', async () => {
  const f = fixture({ failWrite: true });
  const result = await f.request();
  assert.equal(result.statusCode, 500);
  assert.equal(f.state.order.payment_status, 'paid');
  assert.equal(f.state.reservations[0].status, 'service_booking');
  assert.equal(f.state.reservations[0].verify_code, 'OLD-CODE');
  assert.equal(f.state.reservations[0].verify_code_pre_dropoff, 'OLD-DROPOFF');
  assert.deepEqual(f.state.walletJobs, []);
  assert.deepEqual(f.state.events, []);
  assert.deepEqual(f.state.keys, {});
  assert.deepEqual(f.state.mails, []);
});

test('missing cancellation migration gives an actionable error before changing reservations or wallet jobs', async () => {
  const f = fixture({ oldSchema: true });
  const result = await f.request();
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.code, 'ORDER_REFUND_SCHEMA_NOT_READY');
  assert.equal(f.state.order.payment_status, 'paid');
  assert.equal(f.state.reservations[0].verify_code, 'OLD-CODE');
  assert.deepEqual(f.state.walletJobs, []);
  assert.deepEqual(f.state.keys, {});
});

test('bulk refunds apply the same unstarted reservation cancellation contract', async () => {
  const f = fixture();
  const result = await f.request({ batch: true });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.data.items[0].ok, true, JSON.stringify(result.body));
  assert.equal(f.state.reservations[0].status, 'cancelled');
  assert.equal(f.state.order.payment_status, 'refunded');
});

test('refund cancels every unstarted reservation in the order', async () => {
  const f = fixture();
  f.state.reservations.push({ ...f.state.reservations[0], id: 802, status: 'pending' });
  const result = await f.request();
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  for (const reservation of f.state.reservations) {
    assert.equal(reservation.status, 'cancelled');
    assert.notEqual(reservation.verify_code, 'OLD-CODE');
  }
  assert.deepEqual(f.state.walletJobs, [801, 802]);
  assert.deepEqual(f.state.events[0].metadata.reservationIds, [801, 802]);
});

test('one started reservation blocks the entire refund without changing unstarted siblings', async () => {
  const f = fixture();
  f.state.reservations.push({ ...f.state.reservations[0], id: 802, status: 'pre_dropoff' });
  const original = structuredClone(f.state.reservations);
  const result = await f.request();
  assert.equal(result.statusCode, 409);
  assert.equal(f.state.order.payment_status, 'paid');
  assert.deepEqual(f.state.reservations, original);
  assert.deepEqual(f.state.walletJobs, []);
  assert.deepEqual(f.state.events, []);
});
