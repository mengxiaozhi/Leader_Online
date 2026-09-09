import test from 'node:test'
import assert from 'node:assert/strict'
import { createPricingDraft, priceCents, previewPricing, pricingPayload } from '../src/utils/managedOrderPricing.js'

const pricing = { lines: [{ key: 'ticket', quantity: 3, baseUnitPrice: 100 }], otherDiscount: 0, total: 300 }
test('price form rejects blank, negatives, exponent notation and excess decimal precision', () => {
  for (const value of ['', ' ', '-1', '1e2', 0.001, true, null, 100000000]) assert.throws(() => priceCents(value))
  assert.equal(priceCents('0.29'), 29)
})
test('manual zero stays zero when quantity changes and restore uses current quantity', () => {
  const draft = createPricingDraft({ ...pricing, totalOverride: 0 })
  draft.unitPriceOverrides.ticket = '80.25'
  const preview = previewPricing(pricing, draft, [{ ...pricing.lines[0], quantity: 4 }])
  assert.equal(preview.total, 0)
  assert.equal(preview.adjustmentAmount, -321)
  draft.manualTotal = false
  assert.equal(previewPricing(pricing, draft).total, 240.75)
  draft.unitPriceOverrides.ticket = null
  assert.equal(previewPricing(pricing, draft).total, 300)
  assert.equal(pricingPayload(draft).unitPriceOverrides.ticket, null)
})
test('reopening preserves overrides and validation errors do not become zero prices', () => {
  const draft = createPricingDraft({ unitPriceOverrides: { ticket: 30 }, totalOverride: 60 })
  assert.equal(previewPricing(pricing, draft).total, 60)
  draft.totalOverride = ''
  assert.ok(previewPricing(pricing, draft).error)
  assert.throws(() => pricingPayload(draft))
})
