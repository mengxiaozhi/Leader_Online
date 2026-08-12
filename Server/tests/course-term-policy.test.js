'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertIdempotencyKey,
  bankTransferDeadline,
  calculateTermQuote,
  canCancelTermLeave,
  ensureRowVersion,
  termCapacity,
} = require('../src/services/course-term-policy');

const sessions = [
  { id: 1, starts_at: '2026-09-01 10:00:00', status: 'open' },
  { id: 2, starts_at: '2026-09-08 10:00:00', status: 'open' },
  { id: 3, starts_at: '2026-09-15 10:00:00', status: 'open' },
  { id: 4, starts_at: '2026-09-22 10:00:00', status: 'cancelled' },
];

test('fixed-term quote locks exact sessions and all three late-join pricing modes', () => {
  const base = {
    term: { starts_on: '2026-09-01', ends_on: '2026-10-01' },
    sessions,
    startSessionId: 2,
  };
  const sessionsQuote = calculateTermQuote({
    ...base,
    pricingRule: { pricing_mode: 'PRO_RATA_SESSIONS', full_price: 3000 },
  });
  assert.deepEqual(sessionsQuote.sessionIds, [2, 3]);
  assert.equal(sessionsQuote.totalAmount, 2000);

  const unitQuote = calculateTermQuote({
    ...base,
    pricingRule: { pricing_mode: 'UNIT_X_REMAINING', full_price: 3000, unit_price: 850 },
  });
  assert.equal(unitQuote.totalAmount, 1700);

  const calendarQuote = calculateTermQuote({
    ...base,
    pricingRule: { pricing_mode: 'PRO_RATA_CALENDAR', full_price: 3000 },
  });
  assert.ok(calendarQuote.totalAmount > 0 && calendarQuote.totalAmount < 3000);
});

test('seat availability is derived from active allocations and null means unlimited', () => {
  assert.deepEqual(termCapacity({ capacity: 10, activeAllocations: 9 }), {
    capacity: 10,
    allocated: 9,
    available: 1,
    full: false,
  });
  assert.equal(termCapacity({ capacity: 10, activeAllocations: 10 }).full, true);
  assert.equal(termCapacity({ capacity: null, activeAllocations: 500 }).available, null);
});

test('bank-transfer deadline defaults to a 24-hour durable hold', () => {
  assert.equal(
    bankTransferDeadline({ now: '2026-09-01T00:00:00+08:00' }),
    '2026-09-02 00:00:00'
  );
});

test('leave self-cancellation is cutoff and unused-state constrained', () => {
  const leave = { status: 'APPROVED', cancel_close_at: '2026-09-01 09:00:00' };
  const entitlement = { status: 'LEAVE' };
  assert.equal(canCancelTermLeave({ leave, entitlement, now: '2026-09-01 08:59:59' }), true);
  assert.equal(canCancelTermLeave({ leave, entitlement, now: '2026-09-01 09:00:01' }), false);
  assert.equal(canCancelTermLeave({ leave, entitlement: { status: 'ATTENDED' }, now: '2026-09-01 08:00:00' }), false);
});

test('mutations require idempotency and stale If-Match returns 412', () => {
  assert.equal(assertIdempotencyKey('term-checkout-123'), 'term-checkout-123');
  assert.throws(() => assertIdempotencyKey('short'), (error) => error.code === 'IDEMPOTENCY_KEY_REQUIRED');
  assert.throws(() => ensureRowVersion(3, 2, '班期'), (error) => (
    error.code === 'COURSE_ROW_VERSION_CONFLICT' && error.statusCode === 412
  ));
});
