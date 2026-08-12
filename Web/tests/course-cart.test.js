import test from 'node:test'
import assert from 'node:assert/strict'

import {
  COURSE_CART_DRAFT_VERSION,
  courseCartRequestItems,
  createCourseCartDraft,
  mergeCourseCartItems,
  normalizeCourseBatchPreview,
  normalizeCourseCartItems,
  parseCourseCartDraft,
} from '../src/utils/courseCart.js'

test('course cart normalizes identities and merges duplicate products', () => {
  const catalog = [{
    id: 11,
    name: '權威課程名稱',
    price: 600,
    max_purchase_quantity: 4,
    owner_user_id: 'provider-a',
  }]
  const items = normalizeCourseCartItems([
    { product_id: 11, name: '過期草稿名稱', price: 1, quantity: 3, maxPurchaseQuantity: 99 },
    { productId: 11, quantity: 3 },
    { quantity: 5 },
  ], catalog)

  assert.equal(items.length, 1)
  assert.deepEqual(items[0], {
    productId: 11,
    id: 11,
    name: '權威課程名稱',
    price: 600,
    quantity: 4,
    maxPurchaseQuantity: 4,
    providerUserId: 'provider-a',
    providerName: '',
    rowVersion: '',
  })
  assert.deepEqual(courseCartRequestItems(items), [{ productId: 11, quantity: 4 }])
})

test('remote and guest course carts merge once and obey the per-product cap', () => {
  const catalog = [{ id: 21, name: '跨服務商方案', price: 900, maxPurchaseQuantity: 5, providerUserId: 'provider-b' }]
  const merged = mergeCourseCartItems(
    [{ productId: 21, quantity: 2 }],
    [{ productId: 21, quantity: 9, price: 1 }],
    catalog,
  )
  assert.equal(merged[0].quantity, 5)
  assert.equal(merged[0].price, 900)
  assert.equal(merged[0].providerUserId, 'provider-b')

  const draft = createCourseCartDraft([{ productId: 21, name: '方案', quantity: 2 }], { pendingItems: merged })
  assert.equal(draft.version, COURSE_CART_DRAFT_VERSION)
  const parsed = parseCourseCartDraft(JSON.stringify(draft))
  assert.equal(parsed.pendingItems[0].quantity, 5)
  assert.equal(parsed.items[0].quantity, 2)
})

test('batch preview normalization preserves grouped orders, full lines and checkout hash', () => {
  const preview = normalizeCourseBatchPreview({
    data: {
      data: {
        source: 'course',
        orders: [{
          product_id: 31,
          product_name: '自由潛水方案',
          provider_user_id: 'provider-c',
          provider_name: '海洋教室',
          quantity: 2,
          max_purchase_quantity: 3,
          items: [{ name: '主方案', quantity: 2 }, { name: '強制加購', quantity: 2 }],
          expected_ticket_count: 4,
          remittance: { bank_code: '808', bank_account: '12345678' },
          total_amount: '3200',
        }],
        payment_groups: [{
          key: 'provider-c',
          provider_user_id: 'provider-c',
          provider_name: '海洋教室',
          product_ids: [31],
          expected_ticket_count: 4,
          total_amount: '3200',
          remittance: { bank_name: '測試銀行', bank_code: '808', bank_account: '12345678', account_name: '海洋教室' },
        }],
        expected_ticket_count: 4,
        total_quantity: 2,
        total_amount: '3200',
        checkout_hash: 'hash-31',
      },
    },
  })

  assert.equal(preview.source, 'course')
  assert.equal(preview.orderCount, 1)
  assert.equal(preview.totalQuantity, 2)
  assert.equal(preview.totalAmount, 3200)
  assert.equal(preview.checkoutHash, 'hash-31')
  assert.equal(preview.orders[0].productId, 31)
  assert.equal(preview.orders[0].providerUserId, 'provider-c')
  assert.equal(preview.orders[0].maxPurchaseQuantity, 3)
  assert.equal(preview.orders[0].lineItems.length, 2)
  assert.equal(preview.orders[0].expectedTicketCount, 4)
  assert.equal(preview.orders[0].remittance.bankCode, '808')
  assert.equal(preview.expectedTicketCount, 4)
  assert.equal(preview.paymentGroups[0].providerName, '海洋教室')
  assert.equal(preview.paymentGroups[0].remittance.bankAccount, '12345678')
})
