'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ticketFaceValue, redemptionDiscount } = require('../src/services/ticket-redemption');
const { generalPricing, applyGeneralPricing } = require('../src/services/managed-order-pricing');
const { mapGeneralOrderDto } = require('../src/services/general-order-lifecycle');

test('ticket amount validation does not coerce invalid settings to full waivers', () => {
  for (const input of [null, '', ' ', true, [], -1, 0.1, Infinity, '1e3', 100000000]) assert.throws(() => ticketFaceValue(input));
  assert.equal(ticketFaceValue('500'), 500);
  assert.equal(ticketFaceValue(0), 0);
});

test('fixed tickets are capped per service with historical full redemption preserved', () => {
  assert.equal(redemptionDiscount(1500, [{ faceValue: 500 }]), 500);
  assert.equal(redemptionDiscount(1500, [{ faceValue: 500 }, { faceValue: 2000 }, { faceValue: 0 }]), 3500);
  assert.equal(redemptionDiscount(999.99, [{ faceValue: 1000 }, { faceValue: 500 }]), 1499.99);
});

test('order DTO and managed pricing preserve partial redemption without double subtraction', () => {
  const details = { quantity: 1, subtotal: 1500, discount: 500, total: 1100, addOn: { material: true, materialCount: 1 }, addOnCost: 100,
    selections: [{ type: '運送', qty: 1, unitPrice: 1500, subtotal: 1000, discount: 500, byTicket: true, ticketRedemptions: [{ ticketId: 1, faceValue: 500 }] }] };
  const dto = mapGeneralOrderDto({ id: 1, details });
  assert.equal(dto.lineItems[0].subtotal, 1500);
  assert.equal(dto.lineItems[0].total, 1000);
  assert.equal(generalPricing(details).total, 1100);
  const next = structuredClone(details);
  applyGeneralPricing(next, details, { unitPriceOverrides: { 'reservation:0': 300 } });
  assert.equal(next.discount, 300);
  assert.equal(next.total, 100);
  applyGeneralPricing(next, next, { unitPriceOverrides: { 'reservation:0': 1800 } });
  assert.equal(next.discount, 500);
  assert.equal(next.total, 1400);
});
