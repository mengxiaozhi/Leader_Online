'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const buildOrderRoutes = require('../src/routes/orders');
const buildTicketRoutes = require('../src/routes/tickets');
const buildCatalogRoutes = require('../src/routes/catalog');
const clone = value => structuredClone(value);
const json = (value, fallback = {}) => typeof value === 'string' ? JSON.parse(value) : value ?? fallback;

function fixture({ face = 500, price = 800, used = false, actorRole = 'ADMIN' } = {}) {
  const contact = { username: '測試會員', email: 'member@example.test', phone: '0912345678', remittanceLast5: '12345' };
  const state = { orders: [], tickets: [{ id: 10, user_id: 'member', type: '運送', product_id: 8, product_owner_user_id: 'provider', discount: face, used, order_id: 7, row_version: 1 }], logs: [], reservations: [], keys: {}, commits: 0, rollbacks: 0, product: { id: 8, name: '運送', price, ticket_discount: face, listing_status: 'published' } };
  const conn = {
    async beginTransaction() { this.snapshot = clone(state); },
    async commit() { state.commits++; },
    async rollback() { Object.assign(state, this.snapshot); state.rollbacks++; },
    release() {},
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim();
      if (q.startsWith('SELECT id, name, price, ticket_discount') || q.startsWith('SELECT id, code, name, description')) return [[clone(state.product)]];
      if (q.startsWith('INSERT INTO products')) { state.product.ticket_discount = params[7]; return [{ insertId: 8 }]; }
      if (q.startsWith('SELECT COALESCE(')) return [[]];
      if (q.includes('FROM event_stores s')) return [[{ id: 7, event_id: 9, delivery_point_id: 3, name: '交車點', is_active: 1, pre_enabled: 1, post_enabled: 1, prices: { 運送: { normal: 1500, product_id: 8 } }, event_listing_status: 'published' }]];
      if (q.startsWith('SELECT id, type, discount,')) return [[...state.tickets.filter(t => t.user_id === params[0] && !t.used && params.slice(1).includes(t.id)).map(clone)]];
      if (q.includes('FROM tickets t') && q.includes('WHERE t.id = ?')) return [[...state.tickets.filter(t => t.id === params[0]).map(clone)]];
      if (q.startsWith('SELECT * FROM tickets WHERE order_id')) return [[...state.tickets.filter(t => t.order_id === params[0]).map(clone)]];
      if (q.startsWith('INSERT INTO tickets')) {
        const startId = state.tickets.length + 100;
        params[0].forEach((v, i) => state.tickets.push({ id: startId + i, user_id: v[0], type: v[1], product_id: v[2], order_id: v[3], expiry: v[4], uuid: v[5], discount: v[6], used: v[7] }));
        return [{ insertId: startId, affectedRows: params[0].length }];
      }
      if (q.startsWith('UPDATE tickets SET discount')) { state.tickets.find(t => t.id === params.at(-1)).discount = params[0]; return [{ affectedRows: 1 }]; }
      if (q.startsWith('UPDATE tickets SET used = 1')) {
        const matched = state.tickets.filter(t => t.user_id === params[0] && !t.used && params.slice(1).includes(t.id));
        matched.forEach(t => { t.used = 1; }); return [{ affectedRows: matched.length }];
      }
      if (q.startsWith('INSERT INTO orders')) {
        const id = state.orders.length + 1;
        state.orders.push({ id, user_id: params[0], code: params[1], details: params[2], payment_status: params[3], fulfillment_status: 'pending', row_version: 1 });
        return [{ insertId: id }];
      }
      if (q.startsWith('SELECT * FROM orders')) return [[clone(state.orders.find(o => o.id === Number(params[0])))]];
      if (q.startsWith('UPDATE orders')) {
        const order = state.orders.find(o => o.id === Number(params[q.includes('row_version = row_version + 1') ? params.length - 2 : params.length - 1]));
        order.details = params[0];
        if (q.includes('payment_status = ?')) { order.payment_status = params[1]; order.fulfillment_status = params[2]; order.row_version++; }
        else if (q.includes("fulfillment_status = 'fulfilled'")) order.fulfillment_status = 'fulfilled';
        return [{ affectedRows: 1 }];
      }
      if (q.startsWith('INSERT IGNORE INTO order_action_idempotency')) {
        if (state.keys[params[3]]) return [{ affectedRows: 0 }];
        state.keys[params[3]] = { resource_id: params[2], request_hash: params[4], status: 'processing' }; return [{ affectedRows: 1 }];
      }
      if (q.startsWith('SELECT resource_id, request_hash')) return [[clone(state.keys[params[2]])]];
      if (q.startsWith('UPDATE order_action_idempotency')) { Object.assign(state.keys[params[3]], { response_json: params[0], status: 'completed' }); return [{ affectedRows: 1 }]; }
      if (q.includes('FROM reservations') || q.includes('FROM ticket_logs') || q.includes('FROM order_lifecycle_events') || q.startsWith('SELECT id, uuid, type,')) return [[]];
      if (q.startsWith('UPDATE reservations') || q.startsWith('INSERT INTO order_lifecycle_events') || q.startsWith('DELETE FROM user_carts')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${q}`);
    },
  };
  const middleware = (_req, _res, next) => next();
  const ctx = {
    pool: { query: (...args) => conn.query(...args), getConnection: async () => conn },
    authRequired: middleware, adminOnly: middleware, serviceProviderOnly: middleware, productManagerOnly: middleware, eventManagerOnly: middleware, adminOrEditorOnly: middleware, deliveryPointOnly: middleware,
    ok: (res, data) => res.json({ ok: true, data }),
    fail: (res, code, message, status) => Object.assign(res, { statusCode: status, body: { ok: false, code, message } }),
    parsePositiveInt: value => Number(value) || null, normalizePositiveInt: value => Number(value) || null,
    normalizeUserId: value => value || null, safeParseJSON: json,
    isADMIN: role => role === 'ADMIN', isSTORE: () => false, isSERVICE_PROVIDER: () => true,
    normalizeListingStatus: value => value || 'published', isPublishedListingStatus: value => value === 'published',
    normalizeEventServicePriceMap: value => value,
    ensureProductManagementSchema: async () => {}, ensureTicketProductIdColumn: async () => true,
    ensureEventExclusiveColumn: async () => {}, ensureEventDriverAssignmentsTable: async () => {},
    ensureUserContactInfoReady: async () => ({ ok: true, ...contact }), generateOrderCode: async () => 'TEST-ORDER', generateProductCode: async () => 'PDTEST',
    ensureRemittance: () => {}, defaultRemittanceDetails: () => ({}), hasRemittanceDetails: () => false,
    hydrateOrderRemittance: async d => d, resolveOrderRemittance: async () => ({ missingStoreIds: [], missingConfigStoreIds: [], multiple: false, remittance: {} }),
    assertReservationCapacityAvailable: async () => {}, invalidateEventCaches: () => {}, invalidateEventStoresCache: () => {},
    getUserContact: async () => contact, summarizeOrderDetails: () => '', buildOrderCreatedFlex: () => [], composeReservationPaymentContent: () => ({}),
    sendOrderNotificationEmail: async () => ({ mailed: true }),
    formatDateYYYYMMDD: d => d.toISOString().slice(0, 10), logTicket: async ({ conn: _conn, ...entry }) => state.logs.push(entry),
    generateReservationStageCode: async () => 'TEST-CODE', syncReservationTasksForIds: async () => {},
    insertReservationsBulk: async (_conn, rows) => { state.reservations.push(...rows); return [{ insertId: 1, affectedRows: rows.length }]; },
  };
  const routers = { orders: buildOrderRoutes(ctx), tickets: buildTicketRoutes(ctx), catalog: buildCatalogRoutes(ctx) };
  return { state, async request(group, method, path, body, params = {}) {
    const response = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
    const handler = routers[group].stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
    await handler({ body, params, query: {}, user: { id: group === 'orders' && path === '/orders' ? 'member' : 'admin', role: actorRole, ...contact }, headers: { 'if-match': '1', 'idempotency-key': path === '/orders' ? '' : 'test-confirm-payment' } }, response);
    return { status: response.statusCode, body: response.body };
  }, contact };
}
const reservation = (discount = 500) => ({ kind: 'event-reservation', event: { id: 9, name: '測試活動' }, quantity: 1, subtotal: 1500, discount, total: 1500 - discount, ticketsUsed: [10], selections: [{ storeId: 7, type: '運送', productId: 8, byTicket: true, qty: 1, unitPrice: 1500, subtotal: 1500 - discount, discount }] });

test('catalog accepts fixed ticket face values and rejects fractional/negative settings', async () => {
  const { request, state } = fixture();
  for (const face of [-1, 0.5, '500']) {
    const r = await request('catalog', 'post', '/admin/products', { name: '票券', price: 800, ticket_discount: face });
    assert.equal(r.status, 400);
  }
  const r = await request('catalog', 'post', '/admin/products', { name: '票券', price: 800, ticket_discount: 500 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(state.product.ticket_discount, 500);
});

test('ticket face value edits persist and audit while used/provider-isolated tickets reject changes', async () => {
  const f = fixture();
  const r = await f.request('tickets', 'patch', '/admin/tickets/:id', { discount: 600 }, { id: 10 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(f.state.tickets[0].discount, 600);
  assert.deepEqual(f.state.logs[0].meta.changes.discount, { before: 500, after: 600 });
  for (const opts of [{ used: true }, { actorRole: 'STORE' }]) {
    const next = fixture(opts);
    const result = await next.request('tickets', 'patch', '/admin/tickets/:id', { discount: 600 }, { id: 10 });
    assert.ok([403, 409].includes(result.status), JSON.stringify(result.body));
    assert.equal(next.state.tickets[0].discount, 500);
  }
});

test('purchase snapshots the server face value and payment issues that amount even after catalog changes', async () => {
  const f = fixture();
  const created = await f.request('orders', 'post', '/orders', { contactConfirmation: f.contact, items: [{ productId: 8, quantity: 1, total: 0, ticketDiscount: 9999 }] });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(json(f.state.orders[0].details).ticketDiscount, 500);
  assert.equal(json(f.state.orders[0].details).total, 800);
  f.state.product.ticket_discount = 900;
  const paid = await f.request('orders', 'post', '/admin/orders/:id/actions/:action', {}, { id: 1, action: 'confirm-payment' });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(f.state.tickets.at(-1).discount, 500);
});

test('partial redemption stays pending until payment, then consumes one ticket and creates the reservation', async () => {
  const f = fixture();
  const created = await f.request('orders', 'post', '/orders', { contactConfirmation: f.contact, items: [reservation()] });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(f.state.orders[0].payment_status, 'pending');
  assert.equal(f.state.reservations.length, 0);
  assert.equal(f.state.tickets[0].used, false);
  assert.equal(json(f.state.orders[0].details).total, 1000);
  const paid = await f.request('orders', 'post', '/admin/orders/:id/actions/:action', {}, { id: 1, action: 'confirm-payment' });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(f.state.orders[0].payment_status, 'paid');
  assert.equal(f.state.reservations.length, 1);
  assert.equal(f.state.tickets[0].used, 1);
  const replay = await f.request('orders', 'post', '/admin/orders/:id/actions/:action', {}, { id: 1, action: 'confirm-payment' });
  assert.equal(replay.body.replayed, true, JSON.stringify(replay.body));
  assert.equal(f.state.reservations.length, 1);
});

test('payment refuses a changed ticket face value and rolls back fulfillment', async () => {
  const f = fixture();
  await f.request('orders', 'post', '/orders', { contactConfirmation: f.contact, items: [reservation()] });
  f.state.tickets[0].discount = 200;
  const paid = await f.request('orders', 'post', '/admin/orders/:id/actions/:action', {}, { id: 1, action: 'confirm-payment' });
  assert.equal(paid.body.code, 'TICKET_DISCOUNT_CHANGED', JSON.stringify(paid.body));
  assert.equal(f.state.orders[0].payment_status, 'pending');
  assert.equal(f.state.reservations.length, 0);
  assert.equal(f.state.tickets[0].used, false);
});


test('full and capped-to-zero redemptions still auto fulfill without a negative balance', async () => {
  for (const face of [0, 2000]) {
    const f = fixture({ face });
    const created = await f.request('orders', 'post', '/orders', { contactConfirmation: f.contact, items: [reservation(1500)] });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(f.state.orders[0].payment_status, 'paid');
    assert.equal(json(f.state.orders[0].details).total, 0);
    assert.equal(f.state.tickets[0].used, 1);
    assert.equal(f.state.reservations.length, 1);
  }
});

test('free ticket product issuance preserves configured redemption face value', async () => {
  const f = fixture({ face: 500, price: 0 });
  const created = await f.request('orders', 'post', '/orders', { contactConfirmation: f.contact, items: [{ productId: 8, quantity: 1 }] });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(f.state.tickets.at(-1).discount, 500);
});


test('editing an existing ticket purchase retains its original face value', async () => {
  const f = fixture();
  const created = await f.request('orders', 'post', '/orders', { contactConfirmation: f.contact, items: [{ productId: 8, quantity: 1 }] });
  assert.equal(created.status, 200);
  f.state.product.ticket_discount = 900;
  const edited = await f.request('orders', 'patch', '/admin/orders/:id/details', { quantity: 2 }, { id: 1 });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(json(f.state.orders[0].details).ticketDiscount, 500);
});
