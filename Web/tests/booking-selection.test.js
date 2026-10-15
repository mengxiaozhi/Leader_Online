import assert from 'node:assert/strict'
import test from 'node:test'

import {
  bookingEditCapacityCredits,
  bookingSelectionTotal,
  updateBookingTickets,
  updateBookingTotal,
} from '../src/utils/bookingSelection.js'
import { allocateTicketRedemptions } from '../src/utils/ticketRedemption.js'

test('one bicycle paid with one ticket remains one bicycle', () => {
  const initial = updateBookingTotal({}, 1)
  assert.deepEqual(initial, { quantity: 1, useTickets: 0 })
  const redeemed = updateBookingTickets(initial, 1, { maxTickets: 1 })
  assert.deepEqual(redeemed, { quantity: 0, useTickets: 1 })
  assert.equal(bookingSelectionTotal(redeemed), 1)
  assert.deepEqual(updateBookingTickets(redeemed, 0), initial)
})

test('total changes preserve the selected ticket subset and clamp whole units', () => {
  const selection = { quantity: 2, useTickets: 3 }
  assert.equal(bookingSelectionTotal(selection), 5, 'legacy split quantities keep the same total')
  assert.deepEqual(updateBookingTotal(selection, 7), { quantity: 4, useTickets: 3 })
  assert.deepEqual(updateBookingTotal(selection, 2), { quantity: 0, useTickets: 2 })
  assert.deepEqual(updateBookingTotal(selection, 9, { maxTotal: 4, maxTickets: 2 }), { quantity: 2, useTickets: 2 })
  assert.deepEqual(updateBookingTotal(selection, 2.9), { quantity: 0, useTickets: 2 })
  assert.deepEqual(updateBookingTickets({ quantity: 3, useTickets: 0 }, 1.8), { quantity: 2, useTickets: 1 })
  for (const invalid of [-1, '', undefined, NaN, Infinity]) {
    assert.deepEqual(updateBookingTotal(selection, invalid), { quantity: 0, useTickets: 0 })
  }
})

test('ticket changes respect the remaining shared pool without changing capacity', () => {
  const first = updateBookingTickets({ quantity: 2, useTickets: 0 }, 2, { maxTickets: 2 })
  const second = updateBookingTickets({ quantity: 3, useTickets: 0 }, 3, { maxTickets: 1 })
  assert.deepEqual(first, { quantity: 0, useTickets: 2 })
  assert.deepEqual(second, { quantity: 2, useTickets: 1 })
  assert.equal(bookingSelectionTotal(first) + bookingSelectionTotal(second), 5)
  assert.equal(first.useTickets + second.useTickets, 3)
  assert.deepEqual(updateBookingTickets(second, 99, { maxTickets: 0 }), { quantity: 3, useTickets: 0 })
  assert.deepEqual(updateBookingTickets(first, 99, { maxTickets: 10 }), first, 'tickets cannot exceed bicycles')
})

test('mixed ticket pools retain fixed-face balances and one reservation per bicycle', () => {
  const options = {
    ticketKey: ticket => ticket.productId,
    itemKeys: item => [item.productId],
    unitPrice: item => item.price,
  }
  const first = { productId: 8, price: 1500, ...updateBookingTickets(updateBookingTotal({}, 1), 1, { maxTickets: 1 }) }
  const second = { productId: 9, price: 900, ...updateBookingTickets(updateBookingTotal({}, 2), 1, { maxTickets: 1 }) }
  const allocations = allocateTicketRedemptions([first, second], [
    { id: 1, productId: 8, discount: 500 },
    { id: 2, productId: 9, discount: 0 },
  ], options)
  assert.deepEqual(allocations.map(line => [line.discount, line.subtotal, line.missing]), [[500, 1000, 0], [900, 0, 0]])
  const gross = [first, second].reduce((sum, item) => sum + item.price * bookingSelectionTotal(item), 0)
  const discount = allocations.reduce((sum, allocation) => sum + allocation.discount, 0)
  assert.equal(gross - discount, 1900)
  assert.equal(bookingSelectionTotal(first) + bookingSelectionTotal(second), 3)
})

test('edit capacity restores original paid and ticket units across a shared delivery point', () => {
  const details = { event: { id: 7 }, selections: [
    { storeId: 1, deliveryPointId: 10, type: '公路車', qty: 2 },
    { storeId: 2, deliveryPointId: 10, type: '登山車', qty: 1, byTicket: true },
    { storeId: 3, deliveryPointId: 20, qty: 4 },
  ] }
  const stores = [
    { id: 1, eventId: 7, deliveryPointId: 10 },
    { id: 2, eventId: 7, deliveryPointId: 10 },
    { id: 3, eventId: 7, deliveryPointId: 20 },
    { id: 4, eventId: 7, deliveryPointId: 30 },
    { id: 5, eventId: 8, deliveryPointId: 10 },
  ]
  assert.deepEqual(bookingEditCapacityCredits(details, stores), { 1: 3, 2: 3, 3: 4 })
  assert.equal(Math.min(5, 2 + bookingEditCapacityCredits(details, stores)[1]), 5, 'remaining plus own occupancy permits preserving the order')
  assert.deepEqual(bookingEditCapacityCredits({ ...details, status: '已取消' }, stores), {})
})

test('edit credits use saved delivery point; changed mappings receive no unrelated credit', () => {
  const stores = [
    { id: 1, deliveryPointId: 20 },
    { id: 2, deliveryPointId: 10 },
    { id: 3, deliveryPointId: 30 },
  ]
  const details = { selections: [
    { storeId: 1, deliveryPointId: 10, qty: 2 },
    { storeId: 999, deliveryPointId: 30, quantity: 1 },
    { storeId: 999, qty: 4 },
    { storeId: 3, deliveryPointId: 40, qty: 6 },
  ] }
  assert.deepEqual(bookingEditCapacityCredits(details, stores), { 2: 2, 3: 1 })
})

test('legacy edit lines without a delivery point use only the matching live store', () => {
  const stores = [{ id: 1, delivery_point_id: 10 }, { id: 2, deliveryPointId: 20 }]
  assert.deepEqual(bookingEditCapacityCredits({ selections: [
    { store_id: 1, quantity: 2.9 },
    { storeID: 2, qty: 1 },
    { storeId: 99, qty: 8 },
    { storeId: 1, qty: -1 },
  ] }, stores), { 1: 2, 2: 1 })
  assert.deepEqual(bookingEditCapacityCredits({ quantity: 3, serviceSelection: { storeId: 1 } }, stores), { 1: 3 })
  assert.deepEqual(bookingEditCapacityCredits({ selections: [] }, stores), {})
})
