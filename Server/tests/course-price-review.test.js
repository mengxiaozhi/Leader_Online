'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { preparePriceReview, resetPriceReview } = require('../src/services/course-price-review');
const { calculatePricing } = require('../src/services/managed-order-pricing');
const { dateMs, mysqlDateTime } = require('../src/services/course-term-policy');

function fixture(override = {}) {
  const discount = { id: 8, payment_instrument_id: 9, amount: 100, policy_snapshot_json: '{"faceValue":100}', instrument_status: 'RESERVED', hold_status: 'active', ticket_status: 'active', ledger_balance: 1, reserved_uses: 1, ...override };
  const writes = [];
  const conn = { async query(sql, params) {
    if (sql.startsWith('UPDATE')) { writes.push({ sql, params }); return [{ affectedRows: 1 }]; }
    if (sql.includes('FROM course_seat_allocations')) return [[{ status: 'HELD', expires_at: null }]];
    if (sql.includes('FROM course_term_enrollments')) return [[{ status: 'PENDING_PAYMENT', quote_snapshot_json: '{"sessionIds":[1]}', term_status: 'published' }]];
    if (sql.includes('FROM course_sessions')) return [[{ status: 'open', ends_at: '2099-01-01' }]];
    if (sql.includes('FROM course_order_discounts')) return [[discount]];
    throw new Error(sql);
  } };
  const order = { id: 7, owner_user_id: 'provider', order_purpose: 'TERM_ENROLLMENT' };
  return { conn, order, writes, prepare: () => preparePriceReview(conn, order, { getProviderSettings: async () => ({ bank_transfer_hold_hours: 24 }), dateMs, mysqlDateTime }) };
}

test('trial discount retains the reserved ticket and recalculates applied money independently of manual adjustment', async () => {
  const f = fixture();
  const context = await f.prepare();
  const pricing = calculatePricing([{ key: 'primary', quantity: 1, baseUnitPrice: 200 }], null, { unitPriceOverrides: { primary: 50 }, totalOverride: 10 }, { discountLimit: context.discountLimit });
  assert.equal(pricing.discount, 50);
  assert.equal(pricing.adjustmentAmount, 10);
  await resetPriceReview(f.conn, f.order, pricing, context, 'admin');
  assert.deepEqual(f.writes.find(row => row.sql.includes('UPDATE course_order_discounts')).params, [50, 8]);
  assert.deepEqual(f.writes.find(row => row.sql.includes('UPDATE course_order_payment_instruments')).params, [50, 9]);
  assert.equal(f.writes.some(row => row.sql.includes('UPDATE course_tickets') || row.sql.includes('UPDATE course_ticket_holds')), false);
});

test('price edits reject released, expired, frozen or underfunded trial discount rights', async () => {
  for (const override of [{ instrument_status: 'RELEASED' }, { hold_status: 'released' }, { ticket_status: 'void' }, { ticket_expires_at: '2000-01-01' }, { frozen_at: '2020-01-01' }, { ledger_balance: 0 }]) {
    const f = fixture(override);
    await assert.rejects(f.prepare, { code: 'COURSE_PRICE_REVIEW_UNAVAILABLE' });
    assert.equal(f.writes.length, 0);
  }
});
