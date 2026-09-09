const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key)
export function priceCents(value) {
  if (!['number', 'string'].includes(typeof value) || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) throw new Error('金額須為非負數，最多兩位小數')
  const result = Math.round(Number(value) * 100)
  if (!Number.isSafeInteger(result) || result < 0 || result > 9999999999) throw new Error('金額超出允許範圍')
  return result
}
export const formatOrderMoney = value => `NT$ ${Number(value ?? 0).toLocaleString('zh-TW', { maximumFractionDigits: 2 })}`
export function createPricingDraft(pricing = {}) {
  return { unitPriceOverrides: { ...(pricing.unitPriceOverrides || {}) }, totalOverride: pricing.totalOverride ?? null, manualTotal: pricing.totalOverride != null, note: '', dirty: false }
}
export function pricingPayload(draft) {
  const unitPriceOverrides = Object.fromEntries(Object.entries(draft.unitPriceOverrides).map(([key, value]) => [key, value === null ? null : priceCents(value) / 100]))
  if (draft.note.length > 500) throw new Error('改價備註最多 500 字')
  return { unitPriceOverrides, totalOverride: draft.manualTotal ? priceCents(draft.totalOverride) / 100 : null, note: draft.note }
}
export function previewPricing(pricing = {}, draft, lines = pricing.lines || []) {
  try {
    const payload = pricingPayload(draft)
    let subtotal = 0
    let discount = 0
    for (const line of lines) {
      const unit = own(payload.unitPriceOverrides, line.key) && payload.unitPriceOverrides[line.key] !== null
        ? payload.unitPriceOverrides[line.key] : line.baseUnitPrice
      const quantity = Number(line.quantity)
      if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error('數量須為非負整數')
      const value = priceCents(unit) * quantity
      subtotal += value
      if (line.byTicket) discount += value
    }
    discount += pricing.discountLimit == null ? priceCents(pricing.otherDiscount || 0) : Math.min(priceCents(pricing.discountLimit), Math.max(0, subtotal - discount))
    const calculatedTotal = Math.max(0, subtotal - discount)
    const total = payload.totalOverride === null ? calculatedTotal : priceCents(payload.totalOverride)
    priceCents(subtotal / 100)
    priceCents(total / 100)
    return { subtotal: subtotal / 100, discount: discount / 100, calculatedTotal: calculatedTotal / 100, total: total / 100, adjustmentAmount: (total - calculatedTotal) / 100, error: '' }
  } catch (error) { return { error: error.message } }
}
