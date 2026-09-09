'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const buildCourseRoutes = require('../src/routes/courses');

function fixture({ purpose = 'COUNT_PASS', payment = 'pending', fulfillment = 'pending', legacy = false, seatStatus = 'HELD', expired = false, failWrite = false, mailFails = false } = {}) {
  let state = {
    order: { id: 7, code: 'COURSE-7', owner_user_id: 'provider-a', user_id: 'member', student_id: 4,
      buyer_name: '測試會員', buyer_email: 'member@example.test', product_id: purpose === 'COUNT_PASS' ? 10 : null,
      product_name: '測試課程', quantity: purpose === 'COUNT_PASS' ? 2 : 1, unit_price: 100,
      total_amount: purpose === 'COUNT_PASS' ? 220 : 100, pricing_json: null, row_version: 3,
      order_purpose: purpose, payment_method: 'BANK_TRANSFER', status: payment === 'reviewing' ? 'payment_review' : payment,
      payment_status: payment, fulfillment_status: fulfillment, pay_by_at: '2020-01-01 00:00:00' },
    items: purpose === 'COUNT_PASS' && !legacy ? [
      { id: 11, order_id: 7, shop_product_id: 10, ticket_product_id: 20, item_type: 'primary', quantity: 6, unit_price: 100, line_total: 200, issuance_status: 'pending', metadata_json: '{"chargeQuantity":2}', item_name_snapshot: '套票', component_quantity: 3 },
      { id: 12, order_id: 7, shop_product_id: 10, ticket_product_id: 21, item_type: 'component', quantity: 2, unit_price: 0, line_total: 0, issuance_status: 'pending', metadata_json: '{"chargeQuantity":2}', item_name_snapshot: '附贈券', component_quantity: 1 },
      { id: 13, order_id: 7, shop_product_id: 15, ticket_product_id: 22, item_type: 'required_addon', quantity: 2, unit_price: 10, line_total: 20, issuance_status: 'pending', metadata_json: '{"chargeQuantity":2}', item_name_snapshot: '加購', component_quantity: 1 },
    ] : [], keys: {}, events: [], outbox: [], resets: [], mails: [], bookings: [], entitlements: [], commits: 0, rollbacks: 0,
  };
  if (legacy) state.order.total_amount = 200;
  let snapshot;
  const query = async (sql, params = []) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    if (q.includes('FROM course_schema_versions')) return [params.map(version => ({ version }))];
    if (q.includes('FROM course_v2_cutover_state')) return [[{ state: legacy ? 'legacy' : 'active', schema_version: '049_course_count_card_normalization', maintenance_mode: 0 }]];
    if (q.startsWith('SELECT id, role FROM users')) return [[{ id: params[0], role: params[0] === 'admin' ? 'ADMIN' : params[0].startsWith('provider') ? 'SERVICE_PROVIDER' : 'USER' }]];
    if (q.includes('FROM course_staff_memberships')) return [params.includes('ops') ? [{ id: 1 }] : []];
    if (q.startsWith('SELECT pricing_json')) return [[{ pricing_json: state.order.pricing_json }]];
    if (q.startsWith('SELECT o.*')) return [[structuredClone(state.order)]];
    if (q.startsWith('INSERT IGNORE INTO order_action_idempotency')) {
      if (state.keys[params[3]]) return [{ affectedRows: 0 }];
      state.keys[params[3]] = { resource_id: params[2], request_hash: params[4], status: 'processing' };
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('SELECT resource_id, request_hash')) return [[state.keys[params[2]]]];
    if (q.startsWith('UPDATE order_action_idempotency')) { Object.assign(state.keys[params[3]], { status: 'completed', response_json: params[0] }); return [{ affectedRows: 1 }]; }
    if (q.includes('FROM course_order_items')) return [structuredClone(state.items)];
    if (q.includes('FROM course_tickets')) return [[]];
    if (q.includes('FROM order_lifecycle_events')) return [[]];
    if (q.includes('FROM course_settings')) return [[{ fixed_term_enabled: 1, advanced_payments_enabled: 1, bank_transfer_hold_hours: 48 }]];
    if (q.includes('FROM course_seat_allocations')) return [[{ id: 1, status: seatStatus, expires_at: expired ? '2000-01-01 00:00:00' : null }]];
    if (q.includes('FROM course_term_enrollments e')) return [[{ id: 1, owner_user_id: 'provider-a', user_id: 'member', student_id: 4, status: 'PENDING_PAYMENT', term_status: 'published', quote_snapshot_json: '{"sessionIds":[9]}' }]];
    if (q.includes('FROM course_sessions WHERE')) return [[{ id: 9, status: 'open', ends_at: '2099-01-01 12:00:00' }]];
    if (q.includes('FROM course_makeup_insurance_coverages c')) return [[{ status: 'reviewing', booking_status: 'RESERVED', entitlement_status: 'RESERVED', valid_until: '2099-01-01', starts_at: '2099-01-01', session_status: 'open', payment_hold_minutes: 90 }]];
    if (q.includes('FROM course_order_discounts')) return [[]];
    if (q.includes('FROM course_order_payment_instruments instrument')) return [[]];
    if (q.includes('FROM course_students')) return [[{ id: 4, display_name: '測試學員', email: 'member@example.test' }]];
    if (q.includes('FROM course_makeup_insurance_coverages coverage')) return [[{ id: 1, owner_user_id: 'provider-a', user_id: 'member', student_id: 4, status: 'pending_payment', booking_status: 'RESERVED', makeup_status: 'RESERVED', allocation_status: 'HELD', session_id: 9, makeup_booking_id: 1, makeup_entitlement_id: 1, seat_allocation_id: 1 }]];
    if (q.includes('FROM course_bookings')) return [structuredClone(state.bookings)];
    if (q.startsWith('INSERT INTO course_term_session_entitlements')) { state.entitlements.push({ id: 1 }); return [{ insertId: 1 }]; }
    if (q.startsWith('INSERT INTO course_bookings')) { state.bookings.push({ id: 1, origin: purpose === 'TERM_ENROLLMENT' ? 'TERM_ROSTER' : 'MAKEUP' }); return [{ insertId: 1 }]; }
    if (q.startsWith('UPDATE course_term_session_entitlements') || q.startsWith('UPDATE course_term_enrollments') || q.startsWith('UPDATE course_makeup_bookings') || q.startsWith('UPDATE course_makeup_entitlements')) { state.resets.push({ q, params }); return [{ affectedRows: 1 }]; }
    if (q.startsWith('UPDATE course_orders SET payment_status')) {
      Object.assign(state.order, { payment_status: 'paid', status: q.includes("fulfillment_status = 'fulfilled'") ? 'issued' : 'paid', row_version: state.order.row_version + 1 });
      if (q.includes("fulfillment_status = 'fulfilled'")) state.order.fulfillment_status = 'fulfilled';
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE course_orders SET unit_price')) {
      assert.equal(params.at(-1), state.order.row_version);
      Object.assign(state.order, { unit_price: params[0], total_amount: params[1], pricing_json: params[2], status: 'pending', payment_status: 'pending', fulfillment_status: 'pending', row_version: state.order.row_version + 1 });
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE course_order_items SET')) {
      if (failWrite) throw new Error('simulated item write failure');
      const item = state.items.find(item => item.id === params[3]);
      Object.assign(item, { unit_price: params[0], line_total: params[1], metadata_json: params[2] });
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE course_orders SET pay_by_at')) { state.order.pay_by_at = params[0]; return [{ affectedRows: 1 }]; }
    if (q.startsWith('UPDATE course_payment_submissions') || q.startsWith('UPDATE course_seat_allocations') || q.startsWith('UPDATE course_makeup_insurance_coverages')) { state.resets.push({ q, params }); return [{ affectedRows: 1 }]; }
    if (q.startsWith('INSERT INTO order_lifecycle_events')) { state.events.push(params); return [{ affectedRows: 1 }]; }
    if (q.startsWith('INSERT INTO course_notification_outbox')) { state.outbox.push(params); return [{ affectedRows: 1 }]; }
    throw new Error(`Unexpected SQL: ${q}`);
  };
  const conn = { query, async beginTransaction() { snapshot = structuredClone(state); }, async commit() { state.commits++; }, async rollback() { state = { ...snapshot, rollbacks: state.rollbacks + 1 }; }, release() {} };
  const pool = { query, getConnection: async () => conn };
  const env = Object.fromEntries(['COURSE_V2_ENABLED', 'COURSE_FIXED_TERM_ENABLED', 'COURSE_ADVANCED_PAYMENTS_ENABLED'].map(key => [key, process.env[key]]));
  process.env.COURSE_V2_ENABLED = legacy ? 'false' : 'true';
  process.env.COURSE_FIXED_TERM_ENABLED = 'true';
  process.env.COURSE_ADVANCED_PAYMENTS_ENABLED = 'true';
  const router = buildCourseRoutes({
    pool, authRequired: (_req, _res, next) => next(),
    ok: (res, data) => Object.assign(res, { status: 200, body: { ok: true, data } }),
    fail: (res, code, message, status) => Object.assign(res, { status, body: { code, message } }),
    isMailerReady: () => true, EMAIL_FROM_ADDRESS: 'sender@example.test',
    transporter: { async sendMail(mail) { assert.ok(state.commits > 0); if (mailFails) throw new Error('mail unavailable'); state.mails.push(mail); } },
  });
  for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  const handler = router.stack.find(layer => layer.route?.path === '/admin/courses/orders/:id/details').route.stack.at(-1).handle;
  const actionHandler = router.stack.find(layer => layer.route?.path === '/admin/courses/orders/:id/actions/:action').route.stack.at(-1).handle;
  return {
    get state() { return state; },
    async confirm({ version = 4, key = 'confirm-zero' } = {}) {
      const response = {};
      await actionHandler({ params: { id: '7', action: 'confirm-payment' }, body: {}, headers: { 'if-match': String(version), 'idempotency-key': key }, user: { id: 'admin', role: 'ADMIN' } }, response);
      return response;
    },
    async request(pricing, { actor = 'admin', version = 3, key = 'price-1', extra = {} } = {}) {
      const response = {};
      await handler({ params: { id: '7' }, body: { pricing, ...extra }, headers: { 'if-match': String(version), 'idempotency-key': key }, user: { id: actor, role: actor === 'admin' ? 'ADMIN' : 'SERVICE_PROVIDER' } }, response);
      return response;
    },
  };
}

for (const legacy of [false, true]) test(`course ${legacy ? 'legacy' : 'V2 bundle'} price edit, replay and zero confirmation state`, async () => {
  const f = fixture({ legacy });
  const response = await f.request({ totalOverride: 0, unitPriceOverrides: { [legacy ? 'primary' : 'shop:10:primary']: 80.25 } });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.totalAmount, 0);
  assert.equal(response.body.data.paymentStatus, 'pending');
  assert.equal(response.body.data.capabilities.editPricing, true);
  assert.equal(f.state.order.row_version, 4);
  assert.equal(f.state.mails.length, 1);
  assert.ok(f.state.mails[0].html.includes('NT$ 0'));
  if (!legacy) {
    assert.deepEqual(f.state.items.map(item => item.quantity), [6, 2, 2]);
    assert.deepEqual(f.state.items.map(item => item.line_total), [160.5, 0, 20]);
  }
  const replay = await f.request({ totalOverride: 0, unitPriceOverrides: { [legacy ? 'primary' : 'shop:10:primary']: 80.25 } });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.replayed, true);
  assert.equal(f.state.mails.length, 1);
  assert.equal(f.state.events.length, 1);
});

for (const purpose of ['TERM_ENROLLMENT', 'MAKEUP_INSURANCE']) test(`${purpose} zero amount creates rights only after explicit confirmation without transfer data`, async () => {
  const f = fixture({ purpose, payment: 'reviewing' });
  assert.equal((await f.request({ totalOverride: 0 })).status, 200);
  assert.equal(f.state.order.fulfillment_status, 'pending');
  assert.equal(f.state.bookings.length, 0);
  const confirmed = await f.confirm();
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.data.order.paymentStatus, 'paid');
  assert.equal(confirmed.body.data.order.fulfillmentStatus, 'fulfilled');
  assert.equal(f.state.bookings.length, 1);
  assert.ok(f.state.resets.some(row => row.q.includes('course_seat_allocations') && row.q.includes("status = 'ACTIVE'")));
  if (purpose === 'TERM_ENROLLMENT') assert.equal(f.state.entitlements.length, 1);
  else assert.ok(f.state.resets.some(row => row.q.includes('course_makeup_insurance_coverages') && row.q.includes("status = 'active'")));
  const replay = await f.confirm();
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.replayed, true);
  assert.equal(f.state.bookings.length, 1);
  assert.equal(f.state.outbox.length, 2, 'one price update and one rights activation notification');
});

for (const purpose of ['TERM_ENROLLMENT', 'MAKEUP_INSURANCE']) test(`${purpose} resets review and grants a new full payment deadline in the same transaction`, async () => {
  const f = fixture({ purpose, payment: 'reviewing' });
  const before = Date.now();
  const response = await f.request({ unitPriceOverrides: { primary: 80.25 }, totalOverride: 0 });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(f.state.order.payment_status, 'pending');
  assert.equal(response.body.data.capabilities.confirmPayment, true);
  assert.equal(f.state.mails.length, 0);
  assert.equal(f.state.outbox.length, 1);
  assert.equal(response.body.data.notification.reason, 'queued');
  const { dateMs } = require('../src/services/course-term-policy');
  const duration = purpose === 'TERM_ENROLLMENT' ? 48 * 3600000 : 90 * 60000;
  assert.ok(Math.abs(dateMs(f.state.order.pay_by_at) - (before + duration)) < 2000);
  assert.ok(f.state.resets.some(row => row.q.includes("status = 'REJECTED'")));
  assert.ok(f.state.resets.some(row => row.q.includes('course_seat_allocations') && row.params[0] === f.state.order.pay_by_at));
  if (purpose === 'MAKEUP_INSURANCE') assert.ok(f.state.resets.some(row => row.q.includes("status = 'pending_payment'")));
  assert.equal(response.body.data.pricing.lines[0].unitPrice, 80.25);
  const restored = await f.request({ totalOverride: null }, { version: 4, key: 'restore-total' });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.data.totalAmount, 80.25);
  assert.equal(restored.body.data.pricing.original.lines[0].baseUnitPrice, 100);
  assert.equal(f.state.order.quantity, 1);
});

test('course permissions allow owning provider and ops, reject another provider and coach', async () => {
  for (const actor of ['provider-a', 'ops', 'provider-b', 'coach']) {
    const f = fixture();
    const response = await f.request({ totalOverride: 50 }, { actor });
    assert.equal(response.status, ['provider-a', 'ops'].includes(actor) ? 200 : 403, JSON.stringify(response.body));
  }
});

test('course pricing rejects stale versions, paid/fulfilled states, expired seats and foreign fields', async () => {
  for (const options of [{ payment: 'paid' }, { fulfillment: 'fulfilled' }, { purpose: 'TERM_ENROLLMENT', seatStatus: 'RELEASED' }, { purpose: 'MAKEUP_INSURANCE', expired: true }]) {
    const f = fixture(options);
    assert.equal((await f.request({ totalOverride: 5 })).status, 409);
    assert.equal(f.state.order.row_version, 3);
    assert.equal(f.state.outbox.length, 0);
  }
  assert.equal((await fixture().request({ totalOverride: 5 }, { version: 2 })).status, 409);
  assert.equal((await fixture().request({ totalOverride: 5 }, { extra: { quantity: 8 } })).status, 400);
  assert.equal((await fixture().request({ totalOverride: 5 }, { key: '' })).status, 400);
});

test('course item failure rolls back money, audit and idempotency; mail failure does not roll back commit', async () => {
  const f = fixture({ failWrite: true });
  const failed = await f.request({ totalOverride: 10 });
  assert.equal(failed.status, 500);
  assert.equal(f.state.order.total_amount, 220);
  assert.equal(f.state.order.row_version, 3);
  assert.deepEqual(f.state.keys, {});
  assert.equal(f.state.events.length, 0);
  const mail = fixture({ mailFails: true });
  const saved = await mail.request({ totalOverride: 10 });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.data.notification.sent, false);
  assert.equal(mail.state.order.total_amount, 10);
});
