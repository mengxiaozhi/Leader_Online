import test from 'node:test'
import assert from 'node:assert/strict'
import { findDuplicateReservationOrders, duplicateReservationOrderMessage } from '../src/utils/duplicateReservationOrders.js'

const selection = { storeId: 7, store: '台北交車點', type: '公路車', qty: 1 }
const proposed = { event: { id: 10, code: 'EV10' }, selections: [selection] }
const order = (overrides = {}) => ({
  id: 42, code: 'ORDER42', created_at: '2020-01-01 09:00:00', paymentStatus: 'paid',
  details: { event: { id: 10, code: 'EV10' }, selections: [selection], consignorName: '另一位選手' },
  ...overrides,
})

test('same event, store and vehicle warns even for an old order or a different consignor', () => {
  const matches = findDuplicateReservationOrders([order()], proposed)
  assert.equal(matches.length, 1)
  const message = duplicateReservationOrderMessage(matches)
  assert.match(message, /ORDER42/)
  assert.match(message, /2020\/01\/01 09:00/)
  assert.match(message, /另一位選手/)
  assert.match(message, /台北交車點／公路車 × 1/)
})

test('pending and reviewing orders warn; cancelled, refunded and voided orders do not', () => {
  for (const paymentStatus of ['pending', 'reviewing', 'paid']) {
    assert.equal(findDuplicateReservationOrders([order({ paymentStatus })], proposed).length, 1)
  }
  for (const overrides of [{ paymentStatus: 'cancelled' }, { paymentStatus: 'refunded' }, { fulfillmentStatus: 'voided' }]) {
    assert.equal(findDuplicateReservationOrders([order(overrides)], proposed).length, 0)
  }
  for (const status of ['已取消', '已退款']) {
    assert.equal(findDuplicateReservationOrders([order({ paymentStatus: undefined, details: { ...order().details, status } })], proposed).length, 0)
  }
})

test('different event, store or vehicle and zero-quantity lines are not duplicates', () => {
  for (const details of [
    { ...order().details, event: { id: 11, code: 'EV10' } },
    { ...order().details, selections: [{ ...selection, storeId: 8 }] },
    { ...order().details, selections: [{ ...selection, type: '登山車' }] },
    { ...order().details, selections: [{ ...selection, qty: 0 }] },
    { productId: 20, ticketType: '公路車' },
  ]) assert.equal(findDuplicateReservationOrders([order({ details })], proposed).length, 0)
  assert.equal(findDuplicateReservationOrders([order()], { ...proposed, selections: [{ ...selection, qty: 0 }] }).length, 0)
})

test('cash and ticket lines aggregate once, with partial overlaps across multiple stores', () => {
  const details = { ...order().details, selections: [
    { ...selection, qty: 2, byTicket: true },
    { ...selection, qty: 1, unitPrice: 999 },
    { ...selection, storeId: 8, store: '台中交車點', qty: 3 },
  ] }
  const matches = findDuplicateReservationOrders([order({ details })], {
    ...proposed, selections: [selection, { ...selection, type: '登山車' }],
  })
  assert.equal(matches.length, 1)
  assert.equal(matches[0].selections.length, 1)
  assert.equal(matches[0].selections[0].quantity, 3)
})

test('legacy JSON details and missing IDs match by event code and saved store identity', () => {
  const details = { status: '已付款', event: { code: 'EV10' }, serviceSelection: { storeId: '7' }, selections: [{ type: '公路車', qty: 1 }] }
  assert.equal(findDuplicateReservationOrders([order({ details: JSON.stringify(details), paymentStatus: undefined })], proposed).length, 1)
  assert.equal(findDuplicateReservationOrders([order({ details: '{invalid' })], proposed).length, 0)
  assert.equal(findDuplicateReservationOrders([order({ details: { ...details, event: {} } })], proposed).length, 0)
})
