'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const buildOrderRoutes = require('../src/routes/orders');
const {
  assertActionAllowed,
  createGeneralOrderActionExecutor,
  mapGeneralOrderDto,
  normalizeIdempotencyKey,
  parseIfMatch,
} = require('../src/services/general-order-lifecycle');
const { assertGeneralTicketManager } = require('../src/services/general-ticket-policy');

const clone = (value) => JSON.parse(JSON.stringify(value));

function cloneState(state) {
  return {
    orders: new Map([...state.orders].map(([key, value]) => [key, clone(value)])),
    idempotency: new Map([...state.idempotency].map(([key, value]) => [key, clone(value)])),
    tickets: clone(state.tickets),
    lifecycle: clone(state.lifecycle),
  };
}

class FakeConnection {
  constructor(pool) {
    this.pool = pool;
    this.snapshot = null;
  }

  async beginTransaction() {
    this.snapshot = cloneState(this.pool.state);
  }

  async commit() {
    this.snapshot = null;
  }

  async rollback() {
    if (this.snapshot) this.pool.state = cloneState(this.snapshot);
    this.snapshot = null;
  }

  release() {}

  async query(sql, params = []) {
    const query = String(sql).replace(/\s+/g, ' ').trim();
    const state = this.pool.state;

    if (query.startsWith('INSERT IGNORE INTO order_action_idempotency')) {
      const [actorUserId, operation, resourceId, requestKey, requestHash] = params;
      const mapKey = `${actorUserId}|${operation}|${requestKey}`;
      if (state.idempotency.has(mapKey)) return [{ affectedRows: 0 }];
      state.idempotency.set(mapKey, {
        resource_id: resourceId,
        request_hash: requestHash,
        status: 'processing',
        response_json: null,
      });
      return [{ affectedRows: 1 }];
    }

    if (query.startsWith('SELECT resource_id, request_hash, status, response_json FROM order_action_idempotency')) {
      const [actorUserId, operation, requestKey] = params;
      const row = state.idempotency.get(`${actorUserId}|${operation}|${requestKey}`);
      return [row ? [clone(row)] : []];
    }

    if (query.startsWith('UPDATE order_action_idempotency')) {
      const [responseJson, actorUserId, operation, requestKey] = params;
      const mapKey = `${actorUserId}|${operation}|${requestKey}`;
      const row = state.idempotency.get(mapKey);
      if (row) Object.assign(row, { status: 'completed', response_json: responseJson });
      return [{ affectedRows: row ? 1 : 0 }];
    }

    if (query.startsWith('SELECT * FROM orders WHERE id = ?')) {
      const row = state.orders.get(Number(params[0]));
      return [row ? [clone(row)] : []];
    }

    if (query.startsWith('UPDATE orders SET details = ?')) {
      const [detailsJson, paymentStatus, fulfillmentStatus, orderId, expectedVersion] = params;
      const order = state.orders.get(Number(orderId));
      if (!order || Number(order.row_version) !== Number(expectedVersion)) return [{ affectedRows: 0 }];
      Object.assign(order, {
        details: detailsJson,
        payment_status: paymentStatus,
        fulfillment_status: fulfillmentStatus,
        row_version: Number(order.row_version) + 1,
      });
      return [{ affectedRows: 1 }];
    }

    if (query.startsWith('INSERT INTO order_lifecycle_events')) {
      const [domain, orderId, actorUserId, action, fromPaymentStatus, toPaymentStatus,
        fromFulfillmentStatus, toFulfillmentStatus, reason, idempotencyKey, metadata] = params;
      state.lifecycle.push({
        id: state.lifecycle.length + 1,
        domain,
        order_id: Number(orderId),
        actor_user_id: actorUserId,
        action,
        from_payment_status: fromPaymentStatus,
        to_payment_status: toPaymentStatus,
        from_fulfillment_status: fromFulfillmentStatus,
        to_fulfillment_status: toFulfillmentStatus,
        reason,
        idempotency_key: idempotencyKey,
        metadata,
        created_at: '2026-08-03T00:00:00.000Z',
      });
      return [{ affectedRows: 1, insertId: state.lifecycle.length }];
    }

    if (query.startsWith('SELECT id, uuid, type, product_id, order_id')) {
      const ids = new Set(params.map(Number));
      return [clone(state.tickets.filter((ticket) => ids.has(Number(ticket.order_id))))];
    }

    if (query.startsWith('SELECT id, order_id, actor_user_id, action,')) {
      const ids = new Set(params.slice(1).map(Number));
      return [clone(state.lifecycle.filter((event) => event.domain === params[0] && ids.has(Number(event.order_id))))];
    }

    throw new Error(`Unhandled fake SQL: ${query}`);
  }
}

class FakePool {
  constructor(orders = []) {
    this.state = {
      orders: new Map(orders.map((order) => [Number(order.id), clone(order)])),
      idempotency: new Map(),
      tickets: [],
      lifecycle: [],
    };
  }

  async getConnection() {
    return new FakeConnection(this);
  }

  async query(sql, params) {
    return new FakeConnection(this).query(sql, params);
  }
}

function orderFixture(id, paymentStatus = 'pending', fulfillmentStatus = 'pending', rowVersion = 1) {
  return {
    id,
    user_id: 'buyer-1',
    code: `ORD-${id}`,
    details: JSON.stringify({ status: '待匯款', productId: 9, ticketType: '測試票', quantity: 1, total: 100 }),
    payment_status: paymentStatus,
    fulfillment_status: fulfillmentStatus,
    row_version: rowVersion,
  };
}

function createExecutor(pool, overrides = {}) {
  return createGeneralOrderActionExecutor({
    pool,
    isAdmin: (role) => role === 'ADMIN',
    canManage: async () => true,
    fulfillOrder: async () => ({ fulfillmentStatus: 'fulfilled' }),
    cancelOrder: async () => ({ fulfillmentStatus: 'pending' }),
    refundOrder: async () => ({ fulfillmentStatus: 'voided' }),
    ...overrides,
  });
}

test('general order DTO exposes the shared public contract and keeps failed internal fulfillment retryable', () => {
  const dto = mapGeneralOrderDto({
    ...orderFixture(1, 'paid', 'failed', 7),
    details: JSON.stringify({ status: '已完成', productId: 9, ticketType: '入場票', quantity: 2, unitPrice: 50, total: 100 }),
  }, {
    tickets: [{ id: 10, order_id: 1, uuid: 'T-10', type: '入場票', row_version: 2 }],
    lifecycle: [{ id: 1, action: 'migration-repair-required', metadata: '{}' }],
  });

  assert.equal(dto.source, 'general');
  assert.equal(dto.status, '已付款');
  assert.equal(dto.paymentStatus, 'paid');
  assert.equal(dto.fulfillmentStatus, 'pending');
  assert.equal(dto.rowVersion, 7);
  assert.equal(dto.lineItems[0].quantity, 2);
  assert.equal(dto.issuedTickets[0].orderId, 1);
  assert.equal(dto.capabilities.retryFulfillment, true);
  assert.equal(dto.capabilities.edit, false);
  assert.deepEqual(dto.editableFields, []);
  assert.equal(dto.lifecycle[0].action, 'migration-repair-required');
});

test('general order state machine permits only the documented forward and compensation transitions', () => {
  const allowed = [
    ['mark-reviewing', 'pending', 'pending'],
    ['confirm-payment', 'pending', 'pending'],
    ['confirm-payment', 'reviewing', 'pending'],
    ['cancel', 'pending', 'pending'],
    ['cancel', 'reviewing', 'pending'],
    ['refund', 'paid', 'fulfilled'],
    ['retry-fulfillment', 'paid', 'pending'],
    ['retry-fulfillment', 'paid', 'failed'],
  ];
  for (const [action, paymentStatus, fulfillmentStatus] of allowed) {
    assert.doesNotThrow(() => assertActionAllowed(action, { paymentStatus, fulfillmentStatus }));
  }
  const denied = [
    ['mark-reviewing', 'reviewing', 'pending'],
    ['confirm-payment', 'paid', 'fulfilled'],
    ['cancel', 'paid', 'fulfilled'],
    ['refund', 'paid', 'pending'],
    ['retry-fulfillment', 'paid', 'fulfilled'],
    ['confirm-payment', 'cancelled', 'voided'],
    ['confirm-payment', 'refunded', 'voided'],
  ];
  for (const [action, paymentStatus, fulfillmentStatus] of denied) {
    assert.throws(
      () => assertActionAllowed(action, { paymentStatus, fulfillmentStatus }),
      (error) => error.code === 'ORDER_ACTION_NOT_ALLOWED' && error.statusCode === 409
    );
  }
});

test('If-Match and idempotency headers enforce explicit concurrency contracts', () => {
  assert.equal(parseIfMatch('W/"12"'), 12);
  assert.equal(parseIfMatch('"3"'), 3);
  assert.throws(() => parseIfMatch(''), (error) => error.code === 'PRECONDITION_REQUIRED' && error.statusCode === 428);
  assert.throws(() => parseIfMatch('abc'), (error) => error.code === 'PRECONDITION_INVALID');
  assert.equal(normalizeIdempotencyKey(' checkout-1 '), 'checkout-1');
  assert.throws(() => normalizeIdempotencyKey(''), (error) => error.code === 'IDEMPOTENCY_KEY_REQUIRED');
});

test('confirm-payment is atomic and an idempotent replay cannot issue a second ticket', async () => {
  const pool = new FakePool([orderFixture(1, 'reviewing', 'pending', 3)]);
  let fulfillmentCalls = 0;
  const executor = createExecutor(pool, {
    fulfillOrder: async (_conn, order) => {
      fulfillmentCalls += 1;
      pool.state.tickets.push({ id: 1, order_id: order.id, uuid: 'T-1', type: '測試票', row_version: 1 });
      return { fulfillmentStatus: 'fulfilled' };
    },
  });
  const input = {
    orderId: 1,
    action: 'confirm-payment',
    actor: { id: 'admin-1', role: 'ADMIN' },
    expectedVersion: 3,
    idempotencyKey: 'confirm-1',
    body: {},
  };

  const first = await executor.runAction(input);
  const replay = await executor.runAction(input);

  assert.equal(first.data.paymentStatus, 'paid');
  assert.equal(first.data.fulfillmentStatus, 'fulfilled');
  assert.equal(first.data.rowVersion, 4);
  assert.equal(replay.replayed, true);
  assert.equal(fulfillmentCalls, 1);
  assert.equal(pool.state.tickets.length, 1);
  assert.equal(pool.state.lifecycle.length, 1);
});

test('fulfillment failure rolls back tickets, lifecycle, paid state and idempotency claim', async () => {
  const pool = new FakePool([orderFixture(1)]);
  const executor = createExecutor(pool, {
    fulfillOrder: async (_conn, order) => {
      pool.state.tickets.push({ id: 1, order_id: order.id, uuid: 'T-1' });
      throw Object.assign(new Error('發券失敗'), { code: 'ISSUE_FAILED' });
    },
  });

  await assert.rejects(() => executor.runAction({
    orderId: 1,
    action: 'confirm-payment',
    actor: { id: 'admin-1', role: 'ADMIN' },
    expectedVersion: 1,
    idempotencyKey: 'rollback-1',
  }), (error) => error.code === 'ISSUE_FAILED');

  assert.equal(pool.state.orders.get(1).payment_status, 'pending');
  assert.equal(pool.state.orders.get(1).row_version, 1);
  assert.equal(pool.state.tickets.length, 0);
  assert.equal(pool.state.lifecycle.length, 0);
  assert.equal(pool.state.idempotency.size, 0);
});

test('bulk actions isolate transactions and return per-order version conflicts', async () => {
  const pool = new FakePool([orderFixture(1), orderFixture(2)]);
  const executor = createExecutor(pool);
  const result = await executor.runBulk({
    action: 'mark-reviewing',
    actor: { id: 'admin-1', role: 'ADMIN' },
    idempotencyKey: 'bulk-1',
    items: [{ id: 1, rowVersion: 1 }, { id: 2, rowVersion: 99 }],
  });

  assert.deepEqual(result.summary, { total: 2, succeeded: 1, failed: 1 });
  assert.equal(result.items[0].ok, true);
  assert.equal(result.items[0].notification, null);
  assert.equal(result.items[1].error.code, 'ORDER_VERSION_CONFLICT');
  assert.equal(pool.state.orders.get(1).payment_status, 'reviewing');
  assert.equal(pool.state.orders.get(2).payment_status, 'pending');

  const retriedSubset = await executor.runBulk({
    action: 'mark-reviewing',
    actor: { id: 'admin-1', role: 'ADMIN' },
    idempotencyKey: 'bulk-1',
    items: [{ id: 2, rowVersion: 1 }],
  });
  assert.deepEqual(retriedSubset.summary, { total: 1, succeeded: 1, failed: 0 });
  assert.equal(pool.state.orders.get(2).payment_status, 'reviewing');
});

test('bulk idempotency is order-based, independent of item order, and rejects duplicate ids', async () => {
  const pool = new FakePool([orderFixture(1), orderFixture(2)]);
  const executor = createExecutor(pool);
  const input = {
    action: 'mark-reviewing',
    actor: { id: 'admin-1', role: 'ADMIN' },
    idempotencyKey: 'bulk-stable',
  };
  await executor.runBulk({ ...input, items: [{ id: 1, rowVersion: 1 }, { id: 2, rowVersion: 1 }] });
  const replay = await executor.runBulk({ ...input, items: [{ id: 2, rowVersion: 1 }, { id: 1, rowVersion: 1 }] });
  assert.equal(replay.items.every((item) => item.ok && item.replayed), true);
  assert.equal(pool.state.orders.get(1).row_version, 2);
  assert.equal(pool.state.orders.get(2).row_version, 2);

  await assert.rejects(
    () => executor.runBulk({ ...input, idempotencyKey: 'bulk-duplicate', items: [{ id: 1, rowVersion: 2 }, { id: 1, rowVersion: 2 }] }),
    (error) => error.code === 'DUPLICATE_ORDER_IDS' && error.statusCode === 400
  );
});

test('compensation reasons and refund references are bounded before persistence', async () => {
  const pool = new FakePool([orderFixture(1, 'paid', 'fulfilled')]);
  let callbackBody;
  const executor = createExecutor(pool, {
    refundOrder: async (_conn, _order, _details, context) => {
      callbackBody = context.body;
      return { fulfillmentStatus: 'voided' };
    },
  });
  await executor.runAction({
    orderId: 1,
    action: 'refund',
    actor: { id: 'admin-1', role: 'ADMIN' },
    expectedVersion: 1,
    idempotencyKey: 'refund-1',
    body: { reason: 'R'.repeat(800), refundReference: 'X'.repeat(300) },
  });

  assert.equal(callbackBody.reason.length, 500);
  assert.equal(callbackBody.refundReference.length, 128);
  assert.equal(pool.state.lifecycle[0].reason.length, 500);
  assert.equal(pool.state.orders.get(1).payment_status, 'refunded');
  assert.equal(pool.state.orders.get(1).fulfillment_status, 'voided');
});

test('refund requires both an audit reason and an operations reference', async () => {
  const pool = new FakePool([orderFixture(1, 'paid', 'fulfilled')]);
  const executor = createExecutor(pool);
  await assert.rejects(
    () => executor.runAction({
      orderId: 1,
      action: 'refund',
      actor: { id: 'admin-1', role: 'ADMIN' },
      expectedVersion: 1,
      idempotencyKey: 'refund-without-reference',
      body: { reason: '客戶取消' },
    }),
    (error) => error.code === 'ORDER_REFUND_REFERENCE_REQUIRED' && error.statusCode === 400
  );
  assert.equal(pool.state.orders.get(1).payment_status, 'paid');
});

test('general ticket manager policy isolates Provider A, Provider B and unowned tickets', () => {
  const isAdmin = (role) => role === 'ADMIN';
  assert.equal(assertGeneralTicketManager({ actor: { id: 'admin', role: 'ADMIN' }, ownerUserId: null, isAdmin }), true);
  assert.equal(assertGeneralTicketManager({ actor: { id: 'provider-a', role: 'STORE' }, ownerUserId: 'provider-a', isAdmin }), true);
  assert.throws(
    () => assertGeneralTicketManager({ actor: { id: 'provider-b', role: 'STORE' }, ownerUserId: 'provider-a', isAdmin }),
    (error) => error.code === 'FORBIDDEN' && error.statusCode === 403
  );
  assert.throws(
    () => assertGeneralTicketManager({ actor: { id: 'provider-a', role: 'STORE' }, ownerUserId: null, isAdmin }),
    (error) => error.code === 'FORBIDDEN' && error.statusCode === 403
  );
});

test('modular route inventory keeps create and update routes top-level and public validation is explicit', () => {
  const middleware = (_req, _res, next) => next?.();
  const router = buildOrderRoutes({
    pool: { getConnection() {} },
    authRequired: middleware,
    adminOnly: middleware,
    serviceProviderOnly: middleware,
  });
  const inventory = router.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
  assert.equal(inventory.filter((route) => route === 'PATCH /orders/:id').length, 1);
  assert.equal(inventory.filter((route) => route === 'POST /orders').length, 1);
  assert.ok(inventory.indexOf('POST /orders') < inventory.indexOf('GET /admin/orders'));

  const root = path.resolve(__dirname, '..', '..');
  const modularOrders = fs.readFileSync(path.join(root, 'Server/src/routes/orders.js'), 'utf8');
  const modularTickets = fs.readFileSync(path.join(root, 'Server/src/routes/tickets.js'), 'utf8');
  const legacyRuntime = fs.readFileSync(path.join(root, 'Server/v1/index.js'), 'utf8');
  for (const source of [modularOrders, legacyRuntime]) {
    assert.match(source, /items\.length === 0/);
    assert.match(source, /max_purchase_quantity/);
    assert.match(source, /details\.status = total <= 0/);
    assert.match(source, /voided_at IS NULL/);
    assert.match(source, /\/admin\/orders\/:id\/actions\/:action/);
    assert.match(source, /\/admin\/orders\/bulk-actions/);
  }
  for (const source of [modularTickets, legacyRuntime]) {
    assert.match(source, /\/admin\/tickets\/:id\/actions\/:action/);
    assert.match(source, /serviceProviderOnly/);
    assert.match(source, /p\.owner_user_id = \?/);
    assert.match(source, /TICKET_ORDER_MANAGED/);
  }
});

test('member cancellation, fulfillment repair and v1 ticket rules preserve the audited parity contract', () => {
  const root = path.resolve(__dirname, '..', '..');
  const modularOrders = fs.readFileSync(path.join(root, 'Server/src/routes/orders.js'), 'utf8');
  const modularTickets = fs.readFileSync(path.join(root, 'Server/src/routes/tickets.js'), 'utf8');
  const legacyRuntime = fs.readFileSync(path.join(root, 'Server/v1/index.js'), 'utf8');
  const between = (source, start, end) => {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.notEqual(startIndex, -1, `missing section start: ${start}`);
    assert.notEqual(endIndex, -1, `missing section end: ${end}`);
    return source.slice(startIndex, endIndex);
  };

  const modularCancel = between(modularOrders, "router.post('/orders/:id/cancel'", "router.post('/orders'");
  const legacyCancel = between(legacyRuntime, "app.post('/orders/:id/cancel'", "app.post('/orders'");
  for (const section of [modularCancel, legacyCancel]) {
    assert.match(section, /Idempotency-Key/);
    assert.match(section, /order_action_idempotency/);
    assert.match(section, /idempotency_key/);
    assert.match(section, /notification/);
  }

  const modularFulfillment = between(modularOrders, 'async function reconcilePaidTickets', 'async function prepareManagedOrderDetails');
  const legacyFulfillment = between(legacyRuntime, 'async function reconcileLegacyPaidTickets', 'async function prepareLegacyManagedOrderDetails');
  for (const section of [modularFulfillment, legacyFulfillment]) {
    assert.doesNotMatch(section, /DELETE FROM tickets/);
    assert.match(section, /ORDER_FULFILLMENT_EXCESS_TICKETS/);
    assert.match(section, /ORDER_FULFILLMENT_IDENTITY_CONFLICT/);
    assert.match(section, /ORDER_FULFILLMENT_UNTRACKED/);
  }

  assert.match(legacyRuntime, /SELECT id, name, price, owner_user_id, listing_status, max_purchase_quantity/);
  assert.match(legacyRuntime, /ORDER_PRODUCT_NOT_PUBLISHED/);
  assert.match(legacyRuntime, /SELECT id, type, product_id FROM tickets/);
  for (const source of [modularTickets, legacyRuntime]) {
    assert.match(source, /TICKET_EXPIRED/);
    assert.match(source, /used = 0 AND voided_at IS NULL AND \(expiry IS NULL OR expiry > CURRENT_DATE\(\)\)/);
    assert.match(source, /FROM tickets WHERE id = \? LIMIT 1 FOR UPDATE|FROM tickets[\s\S]{0,120}LIMIT 1[\s\S]{0,30}FOR UPDATE/);
  }
});
