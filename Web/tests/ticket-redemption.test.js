import test from 'node:test'
import assert from 'node:assert/strict'
import { allocateTicketRedemptions, redemptionDiscount, validTicketDiscount } from '../src/utils/ticketRedemption.js'
import { createPricingDraft, previewPricing } from '../src/utils/managedOrderPricing.js'

test('ticket allocation is stable across locations and caps each ticket independently', () => {
  const items = [{ productId: 8, price: 1500, useTickets: 2 }, { productId: 8, price: 900, useTickets: 1 }]
  const tickets = [{ id: 1, product_id: 8, discount: 500 }, { id: 2, product_id: 8, discount: 2000 }, { id: 3, product_id: 8, discount: 0 }]
  const options = { ticketKey: t => t.product_id, itemKeys: item => [item.productId], unitPrice: item => item.price }
  const result = allocateTicketRedemptions(items, tickets, options)
  assert.deepEqual(result.map(line => [line.discount, line.subtotal, line.missing]), [[2000, 1000, 0], [900, 0, 0]])
  assert.deepEqual(result.flatMap(line => line.redemptions.map(t => t.ticketId)), [1, 2, 3])
  assert.deepEqual(allocateTicketRedemptions(items, tickets, options), result)
  assert.equal(tickets.length, 3, 'allocation must not consume the source wallet')
  assert.equal(allocateTicketRedemptions(items, tickets.slice(0, 1), options)[0].missing, 1)
  assert.equal(allocateTicketRedemptions(items, [{ ...tickets[0], used: true }], options)[0].missing, 2)
})

test('fixed amount supports precise service fees and rejects invalid face values', () => {
  assert.equal(redemptionDiscount(999.99, [{ faceValue: 500 }, { faceValue: 2000 }, { faceValue: 0 }]), 2499.98)
  for (const value of [-1, 0.5, '', '1e3', true, null, Infinity, 100000000]) assert.equal(validTicketDiscount(value), false)
})

test('admin preview recalculates the difference without turning fixed tickets into full waivers', () => {
  const pricing = { lines: [{ key: 'reservation:0', quantity: 2, baseUnitPrice: 1500, byTicket: true, ticketRedemptions: [{ ticketId: 1, faceValue: 500 }, { ticketId: 2, faceValue: 0 }] }] }
  const draft = createPricingDraft(pricing)
  assert.equal(previewPricing(pricing, draft).total, 1000)
  draft.unitPriceOverrides['reservation:0'] = 1800
  assert.equal(previewPricing(pricing, draft).total, 1300)
  draft.unitPriceOverrides['reservation:0'] = 300
  assert.equal(previewPricing(pricing, draft).total, 0)
})
