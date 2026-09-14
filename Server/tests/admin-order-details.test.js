const assert = require('node:assert/strict');
const test = require('node:test');
const buildOrderRoutes = require('../src/routes/orders');

const clone = (value) => JSON.parse(JSON.stringify(value));
const parseJSON = (value, fallback = {}) => {
  try { return typeof value === 'string' ? JSON.parse(value) : (value ?? fallback); }
  catch { return fallback; }
};

function fixture({ paymentStatus = 'pending', price = 100, capacityError = false, capacity = Infinity, ticketDiscounts = null } = {}) {
  const original = {
    id: 127, code: 'TEST-127', user_id: 'member', row_version: 3,
    payment_status: paymentStatus, fulfillment_status: 'pending',
    details: JSON.stringify({
      kind: 'event-reservation', status: paymentStatus === 'reviewing' ? '處理中' : '待匯款',
      event: { id: 9 }, quantity: 1, subtotal: 100, discount: 0, total: 100,
      selections: [{ type: '運送', qty: 1, unitPrice: 100, subtotal: 100, discount: 0, storeId: 7 }],
      addOn: { material: false, materialCount: 0 }, addOnCost: 0, ticketsUsed: [],
    }),
  };
  const ticketRows = (ticketDiscounts || []).map((discount, index) => ({ id: index + 1, type: '運送', product_id: 8, discount }));
  if (ticketDiscounts) {
    const details = parseJSON(original.details);
    details.selections[0].byTicket = true;
    details.selections[0].productId = 8;
    details.selections[0].qty = ticketRows.length;
    details.ticketsUsed = ticketRows.map(row => row.id);
    original.details = JSON.stringify(details);
  }
  const state = { order: clone(original), commits: 0, rollbacks: 0, events: [], emails: [], capacity: [], keys: {} };
  const connection = {
    async beginTransaction() { this.snapshot = clone({ order: state.order, events: state.events, keys: state.keys }); },
    async commit() { state.commits += 1; },
    async rollback() { Object.assign(state, this.snapshot); state.rollbacks += 1; },
    release() {},
    async query(sql, params = []) {
      const query = sql.replace(/\s+/g, ' ').trim();
      if (query.startsWith('INSERT IGNORE INTO order_action_idempotency')) {
        const key = params[3]; if (state.keys[key]) return [{ affectedRows: 0 }];
        state.keys[key] = { resource_id: params[2], request_hash: params[4], status: 'processing' }; return [{ affectedRows: 1 }];
      }
      if (query.startsWith('SELECT resource_id, request_hash')) return [[state.keys[params[2]]]];
      if (query.startsWith('UPDATE order_action_idempotency')) { Object.assign(state.keys[params[3]], { response_json: params[0], status: 'completed' }); return [{ affectedRows: 1 }]; }
      if (query.startsWith('SELECT * FROM orders WHERE id = ?')) return [[clone(state.order)]];
      if (query.includes('FROM event_stores s')) return [[{
        id: 7, event_id: 9, owner_user_id: 'provider', delivery_point_id: 8, name: '測試交車點',
        is_active: 1, pre_enabled: 1, post_enabled: 1, prices: { 運送: { normal: price, product_id: ticketDiscounts ? 8 : null } },
        event_listing_status: 'published', event_is_exclusive: 0,
      }]];
      if (query.startsWith('UPDATE orders SET details = ?')) {
        assert.equal(params.at(-1), state.order.row_version);
        state.order.details = params[0];
        state.order.row_version += 1;
        state.order.payment_status = 'pending';
        state.order.fulfillment_status = 'pending';
        return [{ affectedRows: 1 }];
      }
      if (query.startsWith('INSERT INTO order_lifecycle_events')) {
        state.events.push({ params });
        return [{ affectedRows: 1 }];
      }
      if (query.startsWith('SELECT id, type, discount,')) return [[...ticketRows.filter(row => params.slice(1).includes(row.id))]];
      if (query.includes('FROM tickets') || query.includes('FROM order_lifecycle_events')) return [[]];
      throw new Error(`Unexpected SQL: ${query}`);
    },
  };
  const middleware = (_req, _res, next) => next();
  const router = buildOrderRoutes({
    pool: { getConnection: async () => connection, query: (...args) => connection.query(...args) },
    authRequired: middleware, adminOnly: middleware, serviceProviderOnly: middleware,
    ok: (res, data, message) => Object.assign(res, { status: 200, body: { ok: true, data, message } }),
    fail: (res, code, message, status) => Object.assign(res, { status, body: { ok: false, code, message } }),
    normalizePositiveInt: (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null,
    normalizeUserId: (value) => value ? String(value) : null,
    safeParseJSON: parseJSON,
    isADMIN: (role) => role === 'ADMIN',
    ensureEventExclusiveColumn: async () => {},
    ensureTicketProductIdColumn: async () => true,
    normalizeEventServicePriceMap: (prices) => prices,
    isPublishedListingStatus: (status) => status === 'published',
    assertReservationCapacityAvailable: async (_conn, details, options) => {
      state.capacity.push({ details: clone(details), options });
      const occupied = options.excludeOrderId === original.id ? 0 : parseJSON(original.details).quantity;
      if (capacityError || details.quantity > capacity - occupied) throw Object.assign(new Error('交車點收容數量不足'), {
        code: 'DELIVERY_POINT_CAPACITY_EXCEEDED', statusCode: 409,
      });
    },
    resolveOrderRemittance: async () => ({
      missingStoreIds: [], missingConfigStoreIds: [], multiple: false, remittance: {},
    }),
    hasRemittanceDetails: () => false,
    ensureRemittance: () => {},
    invalidateEventStoresCache: () => {},
    invalidateEventCaches: () => {},
    getUserContact: async () => ({ email: 'member@example.test', username: '測試會員' }),
    summarizeOrderDetails: () => '測試訂單',
    sendOrderNotificationEmail: async (payload) => {
      assert.ok(state.commits > 0, 'notification must follow commit');
      state.emails.push(payload);
      return { mailed: true };
    },
  });
  return {
    state,
    async request(body, { member = false, version = '3', key = '', role = 'ADMIN', actor = 'admin' } = {}) {
      const path = member ? '/orders/:id' : '/admin/orders/:id/details';
      const handler = router.stack.find((layer) => layer.route?.path === path && layer.route.methods.patch)
        .route.stack.at(-1).handle;
      const response = {};
      await handler({
        params: { id: '127' }, body, headers: { 'if-match': version, 'idempotency-key': key },
        user: member ? { id: 'member', role: 'USER' } : { id: actor, role },
      }, response);
      return response;
    },
  };
}

test('admin quantity edit reprices stored amounts and commits before notifying', async () => {
  const { request, state } = fixture();
  const response = await request({ selections: [{ qty: 2 }] });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const { details, rowVersion, notification } = response.body.data;
  assert.equal(details.quantity, 2);
  assert.equal(details.selections[0].subtotal, 200);
  assert.equal(details.total, 200);
  assert.equal(rowVersion, 4);
  assert.equal(state.events.length, 1);
  assert.equal(state.emails[0].orders[0].total, 200);
  assert.equal(notification.sent, true);
});

test('admin add-on edit recalculates the total and resets payment review', async () => {
  const { request, state } = fixture({ paymentStatus: 'reviewing' });
  const response = await request({ selections: [{ qty: 1 }], addOn: { material: true, materialCount: 2 } });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.details.addOnCost, 200);
  assert.equal(response.body.data.details.total, 300);
  assert.equal(response.body.data.paymentStatus, 'pending');
  assert.equal(JSON.parse(state.events[0].params.at(-1)).resetReview, true);
});

test('admin edits use current service prices and ignore client price overrides', async () => {
  const { request } = fixture({ price: 150 });
  const response = await request({ selections: [{ qty: 2, unitPrice: 1, subtotal: 2 }], total: 2 });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.details.selections[0].unitPrice, 150);
  assert.equal(response.body.data.details.total, 300);
});

test('member edits still reject stale totals even with a client price-refresh flag', async () => {
  const { request, state } = fixture();
  const details = parseJSON(state.order.details);
  details.selections[0].qty = 2;
  details.allowPriceRefresh = true;
  const response = await request({ details, allowPriceRefresh: true }, { member: true });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'ORDER_PRICE_CHANGED');
  assert.equal(state.commits, 0);
  assert.equal(state.emails.length, 0);
});

test('admin edits still reject stale versions without changing the order', async () => {
  const { request, state } = fixture();
  const response = await request({ selections: [{ qty: 2 }] }, { version: '2' });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'ORDER_VERSION_CONFLICT');
  assert.equal(state.commits, 0);
  assert.equal(state.emails.length, 0);
});

for (const paymentStatus of ['paid', 'cancelled', 'refunded']) {
  test(`admin edits keep ${paymentStatus} orders immutable`, async () => {
    const { request, state } = fixture({ paymentStatus });
    const response = await request({ selections: [{ qty: 2 }] });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'ORDER_PAID_IMMUTABLE');
    assert.equal(state.commits, 0);
    assert.equal(state.emails.length, 0);
  });
}

test('repriced admin edits still check capacity and roll back on rejection', async () => {
  const { request, state } = fixture({ capacityError: true });
  const response = await request({ selections: [{ qty: 2 }] });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'DELIVERY_POINT_CAPACITY_EXCEEDED');
  assert.equal(state.capacity[0].details.quantity, 2);
  assert.equal(state.capacity[0].options.lock, true);
  assert.equal(state.rollbacks, 1);
  assert.equal(state.order.row_version, 3);
  assert.equal(parseJSON(state.order.details).total, 100);
  assert.equal(state.emails.length, 0);
});

for (const member of [false, true]) {
  test(`${member ? 'member' : 'admin'} edit excludes the existing order from capacity usage`, async () => {
    const { request, state } = fixture({ capacity: 2 });
    const details = parseJSON(state.order.details);
    details.selections[0].qty = 2;
    details.selections[0].subtotal = 200;
    Object.assign(details, { quantity: 2, subtotal: 200, total: 200 });
    const response = await request(member ? { details } : { selections: [{ qty: 2 }] }, { member });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(state.capacity[0].options.excludeOrderId, 127);
    assert.equal(response.body.data.details.quantity, 2);
  });
}


test('admin manual total is audited, notified once, and protected by idempotency and version', async () => {
  const { request, state } = fixture({ paymentStatus: 'reviewing' });
  const payload = { pricing: { unitPriceOverrides: { 'reservation:0': 80.25 }, totalOverride: 0, note: '人工折讓' } };
  const first = await request(payload, { key: 'price-1' });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.data.details.total, 0);
  assert.equal(first.body.data.paymentStatus, 'pending');
  assert.equal(first.body.data.capabilities.editPricing, true);
  assert.equal(state.emails[0].orders[0].total, 0);
  assert.equal(JSON.parse(state.events[0].params.at(-1)).beforeTotal, 100);
  const replay = await request(payload, { key: 'price-1' });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.replayed, true);
  assert.equal(state.events.length, 1);
  assert.equal(state.emails.length, 1);
  assert.equal(state.order.row_version, 4);
  const conflict = await request({ pricing: { totalOverride: 50 } }, { key: 'price-1' });
  assert.equal(conflict.body.code, 'IDEMPOTENCY_KEY_REUSED');
  const next = await request({ selections: [{ qty: 2 }], pricing: {} }, { key: 'price-2', version: '4' });
  assert.equal(next.status, 200, JSON.stringify(next.body));
  assert.equal(next.body.data.details.total, 0);
  assert.equal(next.body.data.details.selections[0].unitPrice, 80.25);
  const member = await request({ details: JSON.parse(state.order.details) }, { member: true, version: '5' });
  assert.equal(member.body.code, 'ORDER_MANAGED_PRICING_LOCKED');
});

test('invalid admin pricing rolls back amounts, audit and idempotency claim', async () => {
  const { request, state } = fixture();
  const response = await request({ pricing: { totalOverride: '' } }, { key: 'invalid-price' });
  assert.equal(response.status, 400);
  assert.equal(state.order.row_version, 3);
  assert.equal(state.events.length, 0);
  assert.equal(state.emails.length, 0);
  assert.deepEqual(state.keys, {});
});


test('fixed ticket redemption preserves the payable balance through admin repricing', async () => {
  const { state, request } = fixture({ price: 1500, ticketDiscounts: [500] });
  const response = await request({});
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const details = parseJSON(state.order.details);
  assert.equal(details.total, 1000);
  assert.equal(details.discount, 500);
  assert.equal(details.selections[0].subtotal, 1000);
  assert.deepEqual(details.selections[0].ticketRedemptions, [{ ticketId: 1, faceValue: 500 }]);
});

test('mixed ticket face values cap each service separately and leave material payable', async () => {
  const { state, request } = fixture({ price: 1500, ticketDiscounts: [500, 2000, 0] });
  const response = await request({ addOn: { material: true, materialCount: 1 } });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const details = parseJSON(state.order.details);
  assert.equal(details.subtotal, 4500);
  assert.equal(details.discount, 3500);
  assert.equal(details.total, 1100);
});

test('member cannot forge a full waiver or server-authored ticket face value', async () => {
  const { state, request } = fixture({ price: 1500, ticketDiscounts: [500] });
  const details = parseJSON(state.order.details);
  Object.assign(details, { subtotal: 1500, discount: 1500, total: 0 });
  Object.assign(details.selections[0], { unitPrice: 1500, subtotal: 0, discount: 1500, ticketRedemptions: [{ ticketId: 1, faceValue: 0 }] });
  const response = await request({ details }, { member: true });
  assert.equal(response.body.code, 'ORDER_PRICE_CHANGED');
  assert.equal(state.commits, 0);
});

test('member edit accepts fixed redemption and rejects omitted or duplicate tickets', async () => {
  const { state, request } = fixture({ price: 1500, ticketDiscounts: [500] });
  const details = parseJSON(state.order.details);
  Object.assign(details, { subtotal: 1500, discount: 500, total: 1000 });
  Object.assign(details.selections[0], { unitPrice: 1500, subtotal: 1000, discount: 500 });
  for (const ids of [[], [1, 1]]) {
    const response = await request({ details: { ...details, ticketsUsed: ids } }, { member: true });
    assert.equal(response.body.code, 'TICKET_USAGE_MISMATCH');
  }
  const response = await request({ details }, { member: true });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(parseJSON(state.order.details).total, 1000);
});

test('manual service repricing retains fixed ticket face value', async () => {
  const { state, request } = fixture({ price: 1500, ticketDiscounts: [500] });
  const response = await request({ pricing: { unitPriceOverrides: { 'reservation:0': 1800 } } }, { key: 'fixed-ticket-pricing' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(parseJSON(state.order.details).total, 1300);
  assert.equal(parseJSON(state.order.details).discount, 500);
});
