import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BOOKING_DRAFT_VERSION,
  bookingDraftKey,
  clearBookingDraft,
  createBookingDraft,
  loadBookingDraft,
  pruneBookingDraft,
  saveBookingDraft,
} from '../src/utils/bookingDraft.js'

const createStorage = () => {
  const values = new Map()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  }
}

test('booking drafts are versioned and isolated by event code', () => {
  const storage = createStorage()
  saveBookingDraft('EV000123', {
    selectionItems: {
      '1::標準': { storeId: 1, type: '標準', quantity: 2, useTickets: 1 },
    },
    addOn: { material: true, materialCount: 2, nakedConfirm: true },
  }, storage)

  const restored = loadBookingDraft('EV000123', storage)
  assert.equal(restored.version, BOOKING_DRAFT_VERSION)
  assert.deepEqual(restored.selections, [{ storeId: 1, type: '標準', quantity: 2, useTickets: 1 }])
  assert.equal(loadBookingDraft('EV000999', storage), null)

  clearBookingDraft('EV000123', storage)
  assert.equal(storage.getItem(bookingDraftKey('EV000123')), null)

  storage.setItem(bookingDraftKey('EV000123'), JSON.stringify({
    ...restored,
    version: BOOKING_DRAFT_VERSION - 1,
  }))
  assert.equal(loadBookingDraft('EV000123', storage), null)
})

test('draft restoration drops stale choices and clamps capacity and ticket pool', () => {
  const draft = createBookingDraft({
    eventCode: 'EV000123',
    selectionItems: {
      first: { storeId: 1, type: '標準券', quantity: 4, useTickets: 2 },
      second: { storeId: 2, type: '標準券', quantity: 1, useTickets: 2 },
      removed: { storeId: 3, type: '過期方案', quantity: 8, useTickets: 0 },
    },
    addOn: { material: true, materialCount: 4, nakedConfirm: true },
  })
  const stores = [
    { id: 1, capacityRemaining: 5, prices: { '標準券': { normal: 1000, productId: 9 } } },
    { id: 2, capacityRemaining: 5, prices: { '標準券': { normal: 1000, productId: 9 } } },
  ]

  const restored = pruneBookingDraft(draft, {
    stores,
    allowTickets: true,
    ticketAvailability: { 'p-9': 2 },
  })

  assert.deepEqual(restored.selections, [
    { storeId: 1, type: '標準券', quantity: 4, useTickets: 1 },
    { storeId: 2, type: '標準券', quantity: 1, useTickets: 1 },
  ])
  assert.deepEqual(restored.addOn, {
    material: true,
    materialCount: 4,
    nakedConfirm: true,
    purchasePolicy: false,
    usagePolicy: false,
  })
})

test('logged-out restoration keeps paid quantities but never revives ticket use', () => {
  const draft = {
    version: BOOKING_DRAFT_VERSION,
    eventCode: 'EV1',
    selections: [{ storeId: 8, type: '公路車', quantity: 7, useTickets: 3 }],
    addOn: {},
  }
  const restored = pruneBookingDraft(draft, {
    stores: [{ id: 8, capacityRemaining: 2, prices: { '公路車': { normal: 500 } } }],
    allowTickets: false,
    ticketAvailability: { 't-公路車': 10 },
  })

  assert.deepEqual(restored.selections, [
    { storeId: 8, type: '公路車', quantity: 2, useTickets: 0 },
  ])
})
