'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cents, calculatePricing, generalPricing, applyGeneralPricing, coursePricingLines, coursePricing, assertCustomerPricingEditable } = require('../src/services/managed-order-pricing');
const { courseOrderCapabilities } = require('../src/services/course-order-workflow');
const { mapGeneralOrderDto } = require('../src/services/general-order-lifecycle');

test('money validation uses cents and rejects coercion, excess precision and overflow', () => {
  for (const bad of ['', ' ', '-1', -1, 1.001, NaN, Infinity, null, true, [], {}, '1e2', '100,000', 100000000]) assert.throws(() => cents(bad));
  assert.equal(cents('0'), 0);
  assert.equal(cents('0.29'), 29);
  assert.equal(cents('99999999.99'), 9999999999);
  assert.throws(() => calculatePricing([{ key: 'x', quantity: 2, baseUnitPrice: 99999999.99 }], null, {}));
});

test('total override stays fixed across unit/quantity changes and null restores automatic total', () => {
  const lines = [{ key: 'x', quantity: 3, baseUnitPrice: 0.1 }];
  const first = calculatePricing(lines, null, { unitPriceOverrides: { x: 0.29 }, totalOverride: 1.25 });
  assert.equal(first.calculatedTotal, 0.87);
  assert.equal(first.adjustmentAmount, 0.38);
  const next = calculatePricing([{ ...lines[0], quantity: 5, baseUnitPrice: 500 }], first, {});
  assert.equal(next.total, 1.25);
  assert.equal(next.calculatedTotal, 1.45);
  assert.equal(next.original.lines[0].baseUnitPrice, 0.1);
  assert.equal(next.adjustmentAmount, -0.2);
  const restored = calculatePricing(lines, next, { totalOverride: null, unitPriceOverrides: { x: null } });
  assert.equal(restored.total, 0.3);
  assert.equal(restored.managed, true);
});

test('line identity cannot be forged, unknown keys and invalid notes are rejected', () => {
  const lines = [{ key: 'x', quantity: 1, baseUnitPrice: 100 }];
  for (const patch of [null, [], { unitPriceOverrides: [] }, { unitPriceOverrides: { other: 1 } }, { total: 10 }, { note: 'x'.repeat(501) }]) assert.throws(() => calculatePricing(lines, null, patch));
});

test('reservation ticket deductions, custom material price and zero total remain distinct', () => {
  const previous = { quantity: 2, subtotal: 200, total: 100, discount: 100,
    selections: [{ type: '運送', qty: 1, unitPrice: 100, subtotal: 100 }, { type: '運送', qty: 1, unitPrice: 100, subtotal: 0, discount: 100, byTicket: true }],
    addOn: { material: false, materialCount: 0 }, addOnCost: 0 };
  const next = structuredClone(previous);
  next.addOn = { material: true, materialCount: 2 };
  applyGeneralPricing(next, previous, { unitPriceOverrides: { 'reservation:0': 50.25, 'reservation:1': 75, material: 10 }, totalOverride: 0 });
  assert.equal(next.total, 0);
  assert.equal(next.discount, 75);
  assert.equal(next.addOnCost, 20);
  assert.equal(next.selections[1].subtotal, 0);
  assert.equal(next.pricing.adjustmentAmount, -70.25);
  assert.equal(next.pricing.subtotal, 145.25);
  const dto = mapGeneralOrderDto({ payment_status: 'pending', fulfillment_status: 'pending', details: next });
  assert.equal(dto.capabilities.edit, false);
  assert.equal(dto.capabilities.editPricing, false);
  assert.equal(mapGeneralOrderDto({ payment_status: 'pending', fulfillment_status: 'pending', details: next }, { managed: true }).capabilities.editPricing, true);
});

test('ordinary ticket price edits preserve original snapshot and zero price', () => {
  const previous = { ticketType: '票券', productId: 3, quantity: 2, unitPrice: 100, subtotal: 200, discount: 0, total: 200 };
  const next = { ...previous, unitPrice: 200, total: 400 };
  applyGeneralPricing(next, previous, { unitPriceOverrides: { ticket: 0 } });
  assert.equal(next.unitPrice, 0);
  assert.equal(next.total, 0);
  assert.equal(generalPricing(next).original.total, 200);
  assert.equal(generalPricing(next).original.lines[0].baseUnitPrice, 100);
});

test('bundle charge quantity is independent of issue quantity and required addon units', () => {
  const order = { quantity: 2, unit_price: 100, total_amount: 230 };
  const items = [
    { id: 1, shopProductId: 10, itemType: 'primary', quantity: 6, unitPrice: 100, lineTotal: 200 },
    { id: 2, shopProductId: 10, itemType: 'component', quantity: 4, unitPrice: 0, lineTotal: 0 },
    { id: 3, shopProductId: 11, itemType: 'required_addon', quantity: 6, unitPrice: 10, lineTotal: 30 },
  ];
  const lines = coursePricingLines(order, items);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].quantity, 2);
  assert.equal(lines[1].quantity, 3);
  const priced = calculatePricing(lines, coursePricing(order, items), { unitPriceOverrides: { [lines[0].key]: 80, [lines[1].key]: 5 } });
  assert.equal(priced.total, 175);
  assert.deepEqual(items.map(item => item.quantity), [6, 4, 6]);
  const zeroBundle = coursePricingLines(order, [{ ...items[0], unitPrice: 0, lineTotal: 0, metadata: { chargeQuantity: 2 } }]);
  assert.equal(zeroBundle[0].quantity, 2);
  const legacyZero = coursePricingLines({ quantity: 5 }, [{ ...items[0], unitPrice: 0, lineTotal: 0, componentQuantity: 3 }]);
  assert.equal(legacyZero[0].quantity, 2, 'legacy free bundle uses its component ratio, not total cart quantity');
});

test('trial discount uses its original face-value limit while total override remains independent', () => {
  const first = calculatePricing([{ key: 'primary', quantity: 1, baseUnitPrice: 500 }], null, { unitPriceOverrides: { primary: 50 }, totalOverride: 0 }, { discountLimit: 100 });
  assert.equal(first.otherDiscount, 50);
  const next = calculatePricing(first.lines, first, { unitPriceOverrides: { primary: 150 }, totalOverride: null }, { discountLimit: 100 });
  assert.equal(next.otherDiscount, 100);
  assert.equal(next.total, 50);
});

test('manual course zero permits explicit confirmation without bank submission but never auto fulfills', () => {
  const pricing = calculatePricing([{ key: 'primary', quantity: 1, baseUnitPrice: 100 }], null, { totalOverride: 0 });
  for (const order_purpose of ['COUNT_PASS', 'TERM_ENROLLMENT', 'MAKEUP_INSURANCE']) {
    const row = { order_purpose, payment_method: 'BANK_TRANSFER', payment_status: 'pending', fulfillment_status: 'pending', total_amount: 0, pricing_json: JSON.stringify(pricing) };
    assert.equal(courseOrderCapabilities(row).edit, false);
    assert.equal(courseOrderCapabilities(row).confirmPayment, true);
    assert.equal(courseOrderCapabilities(row, { managed: true }).editPricing, true);
    assert.equal(row.payment_status, 'pending');
    for (const payment_status of ['paid', 'cancelled', 'refunded']) assert.equal(courseOrderCapabilities({ ...row, payment_status }, { managed: true }).editPricing, false);
  }
});

test('member overrides and subsequent edits of a managed order are rejected using stored state', () => {
  const pricing = calculatePricing([{ key: 'primary', quantity: 1, baseUnitPrice: 100 }], null, { totalOverride: 0 });
  assert.throws(() => assertCustomerPricingEditable(pricing, {}), { code: 'ORDER_MANAGED_PRICING_LOCKED' });
  assert.throws(() => assertCustomerPricingEditable(null, { pricing: { totalOverride: 0 } }), { code: 'ORDER_PRICING_FORBIDDEN' });
  assert.doesNotThrow(() => assertCustomerPricingEditable(null, { quantity: 2 }));
});
