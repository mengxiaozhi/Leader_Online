'use strict';

const MAX_CENTS = 9999999999; // DECIMAL(10,2)
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const json = (value) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; }
};
const error = (message, code = 'ORDER_PRICING_INVALID', statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

function cents(value) {
  if (!['number', 'string'].includes(typeof value) || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) {
    throw error('金額須為非負數，最多兩位小數');
  }
  const result = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(result) || result < 0 || result > MAX_CENTS) throw error('金額超出允許範圍');
  return result;
}
const amount = (value) => cents(value ?? 0) / 100;
const fromCents = (value) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_CENTS) throw error('金額超出允許範圍');
  return value / 100;
};
function storedPricing(value) {
  const parsed = json(value);
  return parsed?.version === 1 && Array.isArray(parsed.lines) ? parsed : null;
}
function hasManagedPricing(value) { return storedPricing(value)?.managed === true; }

function generalPricingLines(details = {}) {
  const selections = Array.isArray(details.selections) ? details.selections : [];
  if (!selections.length) return [{
    key: 'ticket', name: details.ticketType || '票券商品', quantity: Number(details.quantity || 1),
    baseUnitPrice: amount(details.unitPrice ?? details.price ?? (Math.round(Number(details.total || 0) / Number(details.quantity || 1) * 100) / 100)),
  }];
  return [...selections.map((line, index) => ({
    key: `reservation:${index}`, name: [line.store, line.type || line.ticketType].filter(Boolean).join('｜'),
    quantity: Number(line.qty ?? line.quantity ?? 1), baseUnitPrice: amount(line.unitPrice ?? line.price ?? 0),
    byTicket: line.byTicket === true,
  })), {
    key: 'material', name: '加購包材', quantity: details.addOn?.material ? Number(details.addOn.materialCount || 0) : 0,
    baseUnitPrice: amount(details.addOn?.materialUnitPrice ?? 100), addOn: true,
  }];
}

// These are sales quantities, not the number of tickets issued by a bundle.
function coursePricingLines(order = {}, items = []) {
  if (!items.length) return [{
    key: 'primary', name: order.product_name || order.productName || (order.order_purpose === 'MAKEUP_INSURANCE' ? '補課保險' : '課程費用'),
    quantity: Number(order.quantity || 1), baseUnitPrice: amount(order.unit_price ?? order.unitPrice ?? 0),
  }];
  const groups = new Map();
  for (const item of items) {
    const shopId = item.shopProductId ?? item.shop_product_id;
    const itemType = item.itemType ?? item.item_type;
    const key = `shop:${shopId ?? item.id}:${itemType === 'required_addon' ? 'addon' : 'primary'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()].map(([key, group]) => {
    const paid = group.find(item => Number(item.lineTotal ?? item.line_total ?? 0) > 0) || group[0];
    const metadata = json(paid.metadata ?? paid.metadata_json) || {};
    const unitPrice = amount(paid.unitPrice ?? paid.unit_price ?? 0);
    const total = amount(paid.lineTotal ?? paid.line_total ?? 0);
    const addon = (paid.itemType ?? paid.item_type) === 'required_addon';
    const componentQuantity = metadata.componentQuantity ?? paid.componentQuantity ?? paid.component_quantity;
    const quantity = Number(metadata.chargeQuantity ?? paid.chargeQuantity ?? (
      unitPrice > 0 ? cents(total) / cents(unitPrice)
        : componentQuantity ? Number(paid.quantity || 1) / Number(componentQuantity)
          : addon ? paid.quantity || 1 : order.quantity || 1
    ));
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw error('課程計價份數無法確認，請先確認訂單明細', 'ORDER_PRICING_QUANTITY_INVALID', 409);
    return {
      key, name: paid.shopProductName || paid.name || paid.item_name_snapshot || '課程商品',
      quantity, baseUnitPrice: unitPrice, addOn: addon,
      itemIds: group.map(item => Number(item.id)), chargeItemId: Number(paid.id),
    };
  });
}

function calculatePricing(lines, previousValue, patch, { fixedDiscount = 0, discountLimit = null, originalTotal = null, note = '' } = {}) {
  const previous = storedPricing(previousValue);
  if (patch !== undefined && (!patch || typeof patch !== 'object' || Array.isArray(patch))) throw error('改價資料格式不正確');
  for (const key of Object.keys(patch || {})) if (!['unitPriceOverrides', 'totalOverride', 'note'].includes(key)) throw error('改價資料包含不支援的欄位');
  const unitPriceOverrides = { ...(previous?.unitPriceOverrides || {}) };
  if (own(patch, 'unitPriceOverrides')) {
    if (!patch.unitPriceOverrides || typeof patch.unitPriceOverrides !== 'object' || Array.isArray(patch.unitPriceOverrides)) throw error('單價資料格式不正確');
    for (const [key, value] of Object.entries(patch.unitPriceOverrides)) {
      if (!lines.some(line => line.key === key)) throw error('訂單項目已變更，請重新載入', 'ORDER_PRICING_LINE_CHANGED', 409);
      if (value === null) delete unitPriceOverrides[key];
      else unitPriceOverrides[key] = amount(value);
    }
  }
  for (const key of Object.keys(unitPriceOverrides)) if (!lines.some(line => line.key === key)) throw error('訂單項目已變更，請重新載入', 'ORDER_PRICING_LINE_CHANGED', 409);
  let totalOverride = previous?.totalOverride ?? null;
  if (own(patch, 'totalOverride')) totalOverride = patch.totalOverride === null ? null : amount(patch.totalOverride);
  const calculatedLines = lines.map(line => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 0) throw error('訂單計價數量不正確');
    const original = previous?.original?.lines?.find(item => item.key === line.key);
    const baseUnitPrice = amount(original?.baseUnitPrice ?? line.baseUnitPrice);
    const unitPrice = own(unitPriceOverrides, line.key) ? unitPriceOverrides[line.key] : baseUnitPrice;
    const subtotal = fromCents(cents(unitPrice) * line.quantity);
    const discount = line.byTicket ? subtotal : 0;
    return { ...line, baseUnitPrice, unitPrice, subtotal, discount, lineTotal: fromCents(cents(subtotal) - cents(discount)) };
  });
  const subtotalCents = calculatedLines.reduce((sum, line) => sum + cents(line.subtotal), 0);
  const lineDiscount = calculatedLines.reduce((sum, line) => sum + cents(line.discount), 0);
  const otherDiscount = discountLimit === null ? cents(fixedDiscount) : Math.min(cents(discountLimit), Math.max(0, subtotalCents - lineDiscount));
  const discount = fromCents(lineDiscount + otherDiscount);
  const subtotal = fromCents(subtotalCents);
  const calculatedTotal = fromCents(Math.max(0, subtotalCents - cents(discount)));
  const total = totalOverride ?? calculatedTotal;
  const requestedNote = patch?.note ?? note;
  if (typeof requestedNote !== 'string' || requestedNote.length > 500) throw error('改價備註最多 500 字');
  return {
    version: 1, managed: previous?.managed === true || patch !== undefined,
    original: previous?.original || { lines: lines.map(line => ({ ...line })), total: originalTotal ?? calculatedTotal },
    unitPriceOverrides, totalOverride, lines: calculatedLines, subtotal, discount,
    otherDiscount: fromCents(otherDiscount), discountLimit, calculatedTotal,
    adjustmentAmount: (cents(total) - cents(calculatedTotal)) / 100, total,
    note: requestedNote,
  };
}

function generalPricing(details) {
  return storedPricing(details?.pricing) || calculatePricing(generalPricingLines(details), null, undefined, { originalTotal: details?.total });
}
function coursePricing(order, items = []) {
  const saved = storedPricing(order.pricing_json ?? order.pricing);
  if (saved) return saved;
  const lines = coursePricingLines(order, items);
  const gross = lines.reduce((sum, line) => sum + cents(line.baseUnitPrice) * line.quantity, 0);
  const total = amount(order.total_amount ?? order.totalAmount ?? 0);
  return calculatePricing(lines, null, undefined, {
    fixedDiscount: Math.max(0, gross - cents(total)) / 100,
    discountLimit: order.pricing_discount_limit ?? null, originalTotal: total,
  });
}
function applyGeneralPricing(details, previousDetails, patch) {
  const previous = storedPricing(previousDetails?.pricing) || { version: 1, lines: [], original: { lines: generalPricingLines(previousDetails), total: previousDetails?.total } };
  const pricing = calculatePricing(generalPricingLines(details), previous, patch, { originalTotal: previousDetails?.total });
  for (const line of pricing.lines) {
    if (line.key === 'ticket') {
      details.unitPrice = line.unitPrice;
    } else if (line.key === 'material') {
      details.addOn = { ...(details.addOn || {}), materialUnitPrice: line.unitPrice };
      details.addOnCost = line.subtotal;
    } else {
      const selection = details.selections[Number(line.key.split(':')[1])];
      Object.assign(selection, { unitPrice: line.unitPrice, subtotal: line.lineTotal, discount: line.discount });
    }
  }
  details.subtotal = fromCents(pricing.lines.filter(line => !line.addOn).reduce((sum, line) => sum + cents(line.subtotal), 0));
  details.discount = pricing.discount;
  details.total = pricing.total;
  details.pricing = pricing;
  return pricing;
}

function assertCustomerPricingEditable(value, input = {}) {
  if (hasManagedPricing(value)) throw error('此訂單已由後台調整金額，修改內容請聯繫服務人員', 'ORDER_MANAGED_PRICING_LOCKED', 409);
  if (own(input, 'pricing') || own(input, 'pricing_json') || own(input, 'totalOverride') || own(input, 'unitPriceOverrides')) throw error('會員不可指定人工改價', 'ORDER_PRICING_FORBIDDEN', 403);
}

module.exports = { cents, amount, fromCents, storedPricing, hasManagedPricing, generalPricingLines, coursePricingLines, calculatePricing, generalPricing, coursePricing, applyGeneralPricing, assertCustomerPricingEditable };
