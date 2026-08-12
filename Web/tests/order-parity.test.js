import test from 'node:test'
import assert from 'node:assert/strict'

import {
  clampPurchaseQuantity,
  hasEditableOrderField,
  hasOrderCapability,
  maxPurchaseQuantity,
  normalizeOrderRecord,
  orderMutationHeaders,
  orderStatusSummary,
  shouldRetainIdempotencyKey,
} from '../src/utils/orderParity.js'

test('purchase limits use the product contract and stay within 1 to 99', () => {
  assert.equal(maxPurchaseQuantity({}), 10)
  assert.equal(maxPurchaseQuantity({ max_purchase_quantity: 3 }), 3)
  assert.equal(maxPurchaseQuantity({ maxPurchaseQuantity: 150 }), 99)
  assert.equal(clampPurchaseQuantity(8, { maxPurchaseQuantity: 3 }), 3)
  assert.equal(clampPurchaseQuantity(0, { maxPurchaseQuantity: 3 }), 1)
})

test('canonical order normalization exposes server capabilities without inferring them', () => {
  const order = normalizeOrderRecord({
    source: 'general',
    status: '已付款',
    paymentStatus: 'paid',
    fulfillmentStatus: 'fulfilled',
    row_version: 7,
    line_items: [{ name: '一般票', quantity: 2 }],
    tickets: [{ uuid: 'T-1', status: 'available' }],
    capabilities: { refund: true, edit: false },
    editable_fields: ['contactConfirmation'],
    lifecycle_events: [{ action: 'confirm-payment' }],
  })

  assert.equal(order.paymentStatus, 'paid')
  assert.equal(order.fulfillmentStatus, 'fulfilled')
  assert.equal(order.rowVersion, 7)
  assert.equal(order.lineItems.length, 1)
  assert.equal(order.issuedTickets[0].uuid, 'T-1')
  assert.equal(order.lifecycle[0].action, 'confirm-payment')
  assert.equal(hasOrderCapability(order, 'refund'), true)
  assert.equal(hasOrderCapability(order, 'confirmPayment'), false)
  assert.equal(hasEditableOrderField(order, 'contactConfirmation'), true)
  assert.equal(orderStatusSummary(order), '已發券')

  const legacy = normalizeOrderRecord({ status: '處理中' }, 'course')
  assert.equal(legacy.paymentStatus, 'reviewing')
  assert.deepEqual(legacy.capabilities, {})
  assert.equal(hasOrderCapability(legacy, 'confirmPayment'), false)
})

test('mutations send optimistic concurrency and retain keys only for ambiguous failures', () => {
  assert.deepEqual(orderMutationHeaders({ rowVersion: 9 }, 'retry-key'), {
    'Idempotency-Key': 'retry-key',
    'If-Match': '9',
  })
  assert.equal(shouldRetainIdempotencyKey(new Error('network')), true)
  assert.equal(shouldRetainIdempotencyKey({ response: { status: 500 } }), true)
  assert.equal(shouldRetainIdempotencyKey({ response: { status: 408 } }), true)
  assert.equal(shouldRetainIdempotencyKey({ response: { status: 409, data: { code: 'IDEMPOTENCY_IN_PROGRESS' } } }), true)
  assert.equal(shouldRetainIdempotencyKey({ response: { status: 400 } }), false)
  assert.equal(shouldRetainIdempotencyKey({ response: { status: 409, data: { code: 'ORDER_VERSION_CONFLICT' } } }), false)
})
