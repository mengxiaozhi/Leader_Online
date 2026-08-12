import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CART_DRAFT_VERSION,
  createCartDraft,
  mergeCartItems,
  parseCartDraft,
  planGuestCartMerge,
} from '../src/utils/cartDraft.js'

test('guest cart draft is versioned and rejects incompatible payloads', () => {
  const draft = createCartDraft([{ id: 1, name: '託運票', price: 200, quantity: 2 }])
  assert.equal(draft.version, CART_DRAFT_VERSION)
  assert.deepEqual(parseCartDraft(JSON.stringify(draft))?.items, [
    { id: 1, name: '託運票', price: 200, quantity: 2, maxPurchaseQuantity: 10 },
  ])
  assert.equal(parseCartDraft(JSON.stringify({ version: 999, items: [] })), null)
})

test('remote and guest carts merge quantities by stable product identity', () => {
  assert.deepEqual(
    mergeCartItems(
      [{ id: 1, name: '託運票', price: 200, quantity: 2 }],
      [
        { id: 1, name: '託運票', price: 220, quantity: 3 },
        { id: 2, name: '加值票', price: 100, quantity: 1 },
      ],
    ),
    [
      { id: 1, name: '託運票', price: 200, quantity: 5, maxPurchaseQuantity: 10 },
      { id: 2, name: '加值票', price: 100, quantity: 1, maxPurchaseQuantity: 10 },
    ],
  )
})

test('cart quantities obey each product purchase limit without silent global clipping', () => {
  const merged = mergeCartItems(
    [{ id: 1, name: '限量票', price: 200, quantity: 2, maxPurchaseQuantity: 3 }],
    [{ id: 1, name: '限量票', price: 999, quantity: 9, maxPurchaseQuantity: 99 }],
  )
  assert.equal(merged[0].quantity, 3)
  assert.equal(merged[0].maxPurchaseQuantity, 3)
  assert.equal(merged[0].price, 200)
})

test('guest merge plan runs once and waits for successful PUT before clearing', () => {
  const draft = createCartDraft([{ id: 1, name: '託運票', price: 200, quantity: 2 }])
  const first = planGuestCartMerge([{ id: 1, name: '託運票', price: 200, quantity: 1 }], draft)

  assert.equal(first.shouldPut, true)
  assert.equal(first.shouldClearDraft, true)
  assert.equal(first.items[0].quantity, 3)

  const pendingDraft = createCartDraft(draft.items, { pendingItems: first.items })
  const repeated = planGuestCartMerge(first.items, pendingDraft)
  assert.equal(repeated.shouldPut, true)
  assert.equal(repeated.shouldClearDraft, true)
  assert.equal(repeated.items[0].quantity, 3)

  const completed = planGuestCartMerge(first.items, draft, { alreadyMerged: true })
  assert.equal(completed.shouldPut, false)
  assert.equal(completed.shouldClearDraft, false)
})
