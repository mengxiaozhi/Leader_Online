const assert = require('node:assert/strict');
const test = require('node:test');
const buildOrderRoutes = require('../src/routes/orders');

const clone = (value) => JSON.parse(JSON.stringify(value));
const parseJSON = (value, fallback = {}) => {
  try { return typeof value === 'string' ? JSON.parse(value) : (value ?? fallback); }
  catch { return fallback; }
};

function fixture({ paymentStatus = 'pending', price = 100, capacityError = false, capacity = Infinity, ticketDiscounts = null, reservation = true } = {}) {
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
  if (!reservation) {
    original.details = JSON.stringify({ productId: 8, ticketType: '測試票券', quantity: 1, total: price, status: '待匯款' });
  }
  const ticketRows = (ticketDiscounts || []).map((discount, index) => ({ id: index + 1, type: '運送', product_id: 8, discount }));
  if (ticketDiscounts) {
    const details = parseJSON(original.details);
    details.selections[0].byTicket = true;
    details.selections[0].productId = 8;
    details.selections[0].qty = ticketRows.length;
    details.ticketsUsed = ticketRows.map(row => row.id);
    original.details = JSON.stringify(details);
  }
  const state = {
    order: clone(original), commits: 0, rollbacks: 0, events: [], emails: [], capacity: [], keys: {},
    user: { username: '測試會員', email: 'member@example.test', phone: '0912345678', remittance_last5: '54321' },
  };
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
      if (query.startsWith('SELECT COUNT(*) AS total FROM orders')) return [[{ total: 1 }]];
      if (query.startsWith('SELECT o.id, o.code, o.details')) return [[{ ...clone(state.order), ...clone(state.user), user_id: 'member' }]];
      if (query.includes('AS status, COUNT(*) AS count FROM orders')) return [[{ status: '待匯款', count: 1 }]];
      if (query.startsWith('SELECT username, email, phone, remittance_last5 FROM users')) return [[clone(state.user)]];
      if (query.startsWith('SELECT id FROM events WHERE id = ? AND owner_user_id = ?')) {
        return [params[1] === 'provider' ? [{ id: 9 }] : []];
      }
      if (query.startsWith('SELECT id FROM event_stores WHERE owner_user_id = ?')) {
        return [params[0] === 'provider' ? [{ id: 7 }] : []];
      }
      if (query.startsWith('SELECT id FROM events WHERE owner_user_id = ?')) {
        return [params[0] === 'provider' ? [{ id: 9 }] : []];
      }
      if (query.startsWith('SELECT id, name FROM products WHERE owner_user_id = ?')) return [[]];
      if (query.startsWith('SELECT id, name, price, ticket_discount, owner_user_id, listing_status')) {
        return [[{ id: 8, name: '測試票券', price, ticket_discount: 0, owner_user_id: 'provider', listing_status: 'published', max_purchase_quantity: 10 }]];
      }
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
    parsePositiveInt: (value, fallback) => value == null ? fallback : Number(value),
    normalizeUserId: (value) => value ? String(value) : null,
    safeParseJSON: parseJSON,
    isADMIN: (role) => role === 'ADMIN',
    ensureEventExclusiveColumn: async () => {},
    ensureProductManagementSchema: async () => {},
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
    hydrateOrderRemittance: async details => details,
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
    async listOrders({ role = 'ADMIN', actor = 'admin' } = {}) {
      const handler = router.stack.find(layer => layer.route?.path === '/admin/orders' && layer.route.methods.get)
        .route.stack.at(-1).handle;
      const response = {};
      await handler({ query: {}, user: { id: actor, role } }, response);
      return response;
    },
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

for (const role of ['ADMIN', 'SERVICE_PROVIDER']) {
  test(`${role} order list marks the deleted account while retaining its order contact snapshot`, async () => {
    const { state, listOrders } = fixture();
    const contactSnapshot = { username: '下單姓名', email: 'order@example.test', phone: '0987654321', remittanceLast5: '12345' };
    state.order.details = JSON.stringify({ ...parseJSON(state.order.details), contactSnapshot });
    state.user.username = 'Deleted User';
    state.user.email = 'deleted+member+1792153663677@example.invalid';
    const before = clone(state);

    const response = await listOrders({ role, actor: role === 'ADMIN' ? 'admin' : 'provider' });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const order = response.body.data.items[0];
    assert.equal(order.accountDeleted, true);
    assert.equal(order.username, contactSnapshot.username);
    assert.equal(order.email, contactSnapshot.email);
    assert.deepEqual(order.details.contactSnapshot, contactSnapshot);
    assert.equal(order.paymentStatus, 'pending');
    assert.deepEqual(state, before, 'listing must not mutate account, order, or payment data');
  });
}

test('order deletion marker follows the current account rather than the stored contact', async () => {
  const { state, listOrders } = fixture();
  state.order.details = JSON.stringify({
    ...parseJSON(state.order.details),
    contactSnapshot: { username: 'Deleted User', email: 'deleted+old@example.invalid' },
  });
  const active = await listOrders();
  assert.equal(active.body.data.items[0].accountDeleted, false);

  // Recognize both the legacy and timestamped anonymized email formats.
  for (const email of ['deleted+member@example.invalid', 'DELETED+member+1792153663677@EXAMPLE.INVALID']) {
    state.user.email = email;
    const deleted = await listOrders();
    assert.equal(deleted.body.data.items[0].accountDeleted, true);
  }
  state.user.email = '';
  state.user.username = 'Deleted User';
  const legacy = await listOrders();
  assert.equal(legacy.body.data.items[0].accountDeleted, true);
});

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

for (const reservation of [true, false]) {
  test(`admin corrects ${reservation ? 'reservation' : 'ticket'} remittance digits with leading zero and keeps the member profile`, async () => {
    const { request, state } = fixture({ reservation });
    const snapshot = {
      username: '下單姓名', email: 'order@example.test', phone: '0987654321',
      remittanceLast5: '12345', confirmedAt: '2026-10-01T00:00:00.000Z',
    };
    state.order.details = JSON.stringify({ ...parseJSON(state.order.details), contactSnapshot: snapshot });
    const memberBefore = clone(state.user);
    const payload = { remittanceLast5: ' 01234 ', contactSnapshot: { email: 'untrusted@example.test' } };
    const response = await request(payload, { key: 'remittance-edit' });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body.data.details.contactSnapshot, { ...snapshot, remittanceLast5: '01234' });
    assert.deepEqual(state.user, memberBefore);
    assert.equal(state.emails[0].to, snapshot.email);
    assert.equal(state.emails[0].orders[0].detailsRaw.contactSnapshot.remittanceLast5, '01234');
    const audit = JSON.parse(state.events[0].params.at(-1));
    assert.equal(audit.beforeRemittanceLast5, '12345');
    assert.equal(audit.afterRemittanceLast5, '01234');
    assert.equal(state.events[0].params[1], 'admin');
    const replay = await request(payload, { key: 'remittance-edit' });
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.data.replayed, true);
    assert.equal(state.events.length, 1);
    assert.equal(state.emails.length, 1);
    assert.equal(state.order.row_version, 4);
  });
}

test('admin can correct and clear historical remittance digits without profile fallback returning', async () => {
  const { request, state, listOrders } = fixture();
  const original = await listOrders();
  assert.equal(original.status, 200, JSON.stringify(original.body));
  assert.equal(original.body.data.items[0].remittance_last5, '54321');
  const response = await request({ remittanceLast5: '00000' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(response.body.data.details.contactSnapshot, {
    username: state.user.username, email: state.user.email, phone: state.user.phone, remittanceLast5: '00000',
  });
  assert.equal(JSON.parse(state.events[0].params.at(-1)).beforeRemittanceLast5, '54321');
  const corrected = await listOrders();
  assert.equal(corrected.body.data.items[0].remittance_last5, '00000');
  const cleared = await request({ remittanceLast5: '' }, { version: '4' });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal(cleared.body.data.details.contactSnapshot.remittanceLast5, '');
  assert.equal(state.user.remittance_last5, '54321');
  assert.equal(JSON.parse(state.events[1].params.at(-1)).afterRemittanceLast5, '');
  const reloaded = await listOrders();
  assert.equal(reloaded.body.data.items[0].remittance_last5, '');
});

test('omitting remittance digits preserves the snapshot and historical profile fallback', async () => {
  for (const snapshot of [null, { username: '會員', email: 'member@example.test', remittanceLast5: '01234' }]) {
    const { request, state } = fixture();
    const details = parseJSON(state.order.details);
    if (snapshot) details.contactSnapshot = snapshot;
    state.order.details = JSON.stringify(details);
    const response = await request({ selections: [{ qty: 2 }] });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body.data.details.contactSnapshot, snapshot || undefined);
    assert.equal(JSON.parse(state.events[0].params.at(-1)).afterRemittanceLast5, undefined);
  }
});

test('invalid remittance digits roll back the order, audit and idempotency claim', async () => {
  for (const remittanceLast5 of ['1234', '123456', '12a45', '１２３４５', '1e234', 12345, null, {}, []]) {
    const { request, state } = fixture();
    const before = clone(state.order);
    const response = await request({ remittanceLast5 }, { key: 'invalid-remittance' });
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.equal(response.body.code, 'ORDER_REMITTANCE_LAST5_INVALID');
    assert.deepEqual(state.order, before);
    assert.deepEqual(state.keys, {});
    assert.equal(state.events.length, 0);
    assert.equal(state.emails.length, 0);
    assert.equal(state.commits, 0);
  }
});

test('only a provider with access to the order can correct remittance digits', async () => {
  for (const actor of ['provider', 'other-provider']) {
    const { request, state } = fixture();
    const response = await request({ remittanceLast5: '01234' }, { role: 'SERVICE_PROVIDER', actor });
    assert.equal(response.status, actor === 'provider' ? 200 : 403, JSON.stringify(response.body));
    assert.equal(state.events.length, actor === 'provider' ? 1 : 0);
    assert.equal(state.emails.length, actor === 'provider' ? 1 : 0);
    if (actor !== 'provider') assert.equal(response.body.code, 'FORBIDDEN');
  }
});

test('member content edits cannot overwrite admin-corrected remittance digits', async () => {
  const { request, state } = fixture();
  const snapshot = { username: state.user.username, email: state.user.email, remittanceLast5: '01234' };
  state.order.details = JSON.stringify({ ...parseJSON(state.order.details), contactSnapshot: snapshot });
  const response = await request({ details: {
    ...parseJSON(state.order.details), remittanceLast5: '99999',
    contactSnapshot: { ...snapshot, remittanceLast5: '99999' },
  } }, { member: true });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(response.body.data.details.contactSnapshot, snapshot);
});

test('remittance correction keeps payment and version guards', async () => {
  for (const paymentStatus of ['paid', 'cancelled', 'refunded']) {
    const { request, state } = fixture({ paymentStatus });
    const response = await request({ remittanceLast5: '01234' });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'ORDER_PAID_IMMUTABLE');
    assert.equal(state.emails.length, 0);
  }
  const { request, state } = fixture();
  const response = await request({ remittanceLast5: '01234' }, { version: '2' });
  assert.equal(response.body.code, 'ORDER_VERSION_CONFLICT');
  assert.equal(state.order.row_version, 3);
  assert.equal(state.emails.length, 0);
});

test('member can change the consignor without changing membership or the order contact snapshot', async () => {
  const { request, state } = fixture();
  const previous = parseJSON(state.order.details);
  previous.consignorName = '原託運者';
  previous.contactSnapshot = { username: '訂購會員', email: 'member@example.test' };
  state.order.details = JSON.stringify(previous);
  const response = await request({ details: { ...previous, consignorName: '  新託運者  ', contactSnapshot: { username: '不可信的姓名' } } }, { member: true });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.details.consignorName, '新託運者');
  assert.equal(response.body.data.details.contactSnapshot.username, '訂購會員');
  assert.equal(state.order.user_id, 'member');
});

test('member edit with an omitted consignor preserves the existing independent name', async () => {
  const { request, state } = fixture();
  const previous = parseJSON(state.order.details);
  state.order.details = JSON.stringify({ ...previous, consignorName: '實際託運者' });
  const response = await request({ details: previous }, { member: true });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.details.consignorName, '實際託運者');
});

test('admin can fill a historical consignor and a member can clear it to use the buyer name', async () => {
  const admin = fixture();
  const filled = await admin.request({ consignorName: '代為託運者', selections: [{ qty: 1 }] });
  assert.equal(filled.status, 200, JSON.stringify(filled.body));
  assert.equal(filled.body.data.details.consignorName, '代為託運者');
  const member = fixture();
  member.state.order.details = JSON.stringify({ ...parseJSON(member.state.order.details), consignorName: '既有託運者' });
  const response = await member.request({ details: { ...parseJSON(member.state.order.details), consignorName: ' ' } }, { member: true });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.details.consignorName, member.state.user.username);
  assert.equal(member.state.commits, 1);
});

test('member and admin edits default missing consignors to the order buyer account name', async () => {
  for (const member of [true, false]) {
    for (const value of [undefined, null, '', '   ']) {
      const f = fixture();
      const previous = parseJSON(f.state.order.details);
      previous.consignorName = null;
      previous.contactSnapshot = { username: '訂購會員', email: 'member@example.test' };
      f.state.order.details = JSON.stringify(previous);
      const nameInput = value === undefined ? {} : { consignorName: value };
      const input = member
        ? { details: { ...previous, ...nameInput } }
        : { selections: [{ qty: 1 }], ...nameInput };
      const response = await f.request(input, { member });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.data.details.consignorName, f.state.user.username);
      assert.equal(response.body.data.details.contactSnapshot.username, '訂購會員');
      assert.equal(f.state.order.user_id, 'member');
      assert.equal(f.state.commits, 1);
    }
  }
});

test('admin prefill receives the buyer account name separately from the original order contact', async () => {
  const { state, listOrders } = fixture();
  state.order.details = JSON.stringify({
    ...parseJSON(state.order.details),
    contactSnapshot: { username: '下單時的姓名', email: 'order@example.test' },
  });
  const response = await listOrders();
  assert.equal(response.body.data.items[0].username, '下單時的姓名');
  assert.equal(response.body.data.items[0].buyerName, state.user.username);
});

test('edits reject invalid names while an explicit blank resets a recorded consignor to the buyer', async () => {
  for (const member of [true, false]) {
    for (const value of [0, false, {}, '名'.repeat(51)]) {
      const f = fixture();
      const response = await f.request(member
        ? { details: { ...parseJSON(f.state.order.details), consignorName: value } }
        : { selections: [{ qty: 1 }], consignorName: value }, { member });
      assert.equal(response.status, 400, JSON.stringify(response.body));
      assert.equal(response.body.code, 'CONSIGNOR_NAME_INVALID');
      assert.equal(f.state.commits, 0);
    }
    const f = fixture();
    const previous = { ...parseJSON(f.state.order.details), consignorName: '原託運者' };
    f.state.order.details = JSON.stringify(previous);
    const response = await f.request(member
      ? { details: { ...previous, consignorName: '' } }
      : { selections: [{ qty: 1 }], consignorName: null }, { member });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(parseJSON(f.state.order.details).consignorName, f.state.user.username);
  }
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
