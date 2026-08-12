import { clampPurchaseQuantity, maxPurchaseQuantity } from './orderParity.js'

export const COURSE_CART_DRAFT_VERSION = 1
export const COURSE_CART_DRAFT_STORAGE_KEY = 'leader-online:guest-course-cart'

const productIdOf = record => record?.productId ?? record?.product_id ?? record?.id

export function normalizeCourseCartItem(record = {}, fallback = {}) {
  const productId = productIdOf(record) ?? productIdOf(fallback)
  if (productId === undefined || productId === null || !String(productId).trim()) return null
  // Catalog/server metadata wins over a stale guest draft. Quantity remains
  // draft-owned so merging never discards what the user selected.
  const authoritative = Object.keys(fallback || {}).length
    ? { ...record, ...fallback, quantity: record.quantity ?? fallback.quantity }
    : { ...record }
  if (Object.keys(fallback || {}).length) {
    authoritative.maxPurchaseQuantity = maxPurchaseQuantity(fallback)
  }
  const limit = maxPurchaseQuantity(authoritative)
  const price = Number(authoritative.price ?? authoritative.unitPrice ?? authoritative.unit_price ?? 0)
  return {
    productId,
    id: productId,
    name: String(authoritative.name ?? authoritative.productName ?? authoritative.product_name ?? `課程 ${productId}`).trim(),
    price: Number.isFinite(price) ? Math.max(0, price) : 0,
    quantity: clampPurchaseQuantity(authoritative.quantity ?? 1, { maxPurchaseQuantity: limit }),
    maxPurchaseQuantity: limit,
    providerUserId: String(authoritative.providerUserId ?? authoritative.provider_user_id ?? authoritative.owner_user_id ?? ''),
    providerName: String(authoritative.providerName ?? authoritative.provider_name ?? ''),
    rowVersion: authoritative.rowVersion ?? authoritative.row_version ?? authoritative.version ?? '',
  }
}

export function normalizeCourseCartItems(items = [], catalog = []) {
  const catalogById = new Map((Array.isArray(catalog) ? catalog : []).map(item => [String(productIdOf(item)), item]))
  const merged = []
  for (const raw of Array.isArray(items) ? items : []) {
    const fallback = catalogById.get(String(productIdOf(raw))) || {}
    const item = normalizeCourseCartItem(raw, fallback)
    if (!item) continue
    const existing = merged.find(candidate => String(candidate.productId) === String(item.productId))
    if (!existing) {
      merged.push(item)
      continue
    }
    existing.quantity = clampPurchaseQuantity(existing.quantity + item.quantity, existing)
  }
  return merged
}

export function mergeCourseCartItems(remoteItems = [], guestItems = [], catalog = []) {
  return normalizeCourseCartItems([
    ...normalizeCourseCartItems(remoteItems, catalog),
    ...normalizeCourseCartItems(guestItems, catalog),
  ], catalog)
}

export function courseCartRequestItems(items = []) {
  return normalizeCourseCartItems(items).map(item => ({
    productId: item.productId,
    quantity: item.quantity,
  }))
}

export function createCourseCartDraft(items = [], options = {}) {
  const draft = {
    version: COURSE_CART_DRAFT_VERSION,
    updatedAt: new Date().toISOString(),
    items: normalizeCourseCartItems(items),
  }
  const pendingItems = normalizeCourseCartItems(options.pendingItems)
  if (pendingItems.length) draft.pendingItems = pendingItems
  return draft
}

export function parseCourseCartDraft(raw) {
  if (!raw) return null
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!parsed || parsed.version !== COURSE_CART_DRAFT_VERSION || !Array.isArray(parsed.items)) return null
    return {
      version: COURSE_CART_DRAFT_VERSION,
      updatedAt: String(parsed.updatedAt || ''),
      items: normalizeCourseCartItems(parsed.items),
      pendingItems: normalizeCourseCartItems(parsed.pendingItems),
    }
  } catch {
    return null
  }
}

export function normalizeCourseBatchPreview(response = {}) {
  const root = response?.data ?? response ?? {}
  const payload = root?.data ?? root
  const normalizeRemittance = value => ({
    info: String(value?.info ?? value?.remittance_info ?? ''),
    bankName: String(value?.bankName ?? value?.bank_name ?? value?.remittance_bank_name ?? ''),
    bankCode: String(value?.bankCode ?? value?.bank_code ?? value?.remittance_bank_code ?? ''),
    bankAccount: String(value?.bankAccount ?? value?.bank_account ?? value?.remittance_bank_account ?? ''),
    accountName: String(value?.accountName ?? value?.account_name ?? value?.remittance_account_name ?? ''),
    source: String(value?.source || ''),
  })
  const orders = Array.isArray(payload?.orders) ? payload.orders.map(order => ({
    ...order,
    productId: productIdOf(order),
    productName: String(order.productName ?? order.product_name ?? order.name ?? ''),
    providerUserId: String(order.providerUserId ?? order.provider_user_id ?? order.owner_user_id ?? ''),
    providerName: String(order.providerName ?? order.provider_name ?? ''),
    quantity: Number(order.quantity || 0),
    maxPurchaseQuantity: maxPurchaseQuantity(order),
    lineItems: Array.isArray(order.lineItems) ? order.lineItems : (Array.isArray(order.items) ? order.items : []),
    totalAmount: Number(order.totalAmount ?? order.total_amount ?? order.total ?? 0),
    expectedTicketCount: Number(order.expectedTicketCount ?? order.expected_ticket_count ?? 0),
    remittance: normalizeRemittance(order.remittance),
  })) : []
  const paymentGroups = Array.isArray(payload?.paymentGroups ?? payload?.payment_groups)
    ? (payload.paymentGroups ?? payload.payment_groups).map(group => ({
        ...group,
        key: String(group.key ?? group.providerUserId ?? group.provider_user_id ?? 'platform'),
        providerUserId: String(group.providerUserId ?? group.provider_user_id ?? ''),
        providerName: String(group.providerName ?? group.provider_name ?? ''),
        productIds: Array.isArray(group.productIds ?? group.product_ids)
          ? (group.productIds ?? group.product_ids)
          : [],
        totalAmount: Number(group.totalAmount ?? group.total_amount ?? 0),
        expectedTicketCount: Number(group.expectedTicketCount ?? group.expected_ticket_count ?? 0),
        remittance: normalizeRemittance(group.remittance),
      }))
    : []
  return {
    source: String(payload?.source || 'request'),
    orders,
    orderCount: Number(payload?.orderCount ?? orders.length),
    totalQuantity: Number(payload?.totalQuantity ?? orders.reduce((sum, order) => sum + order.quantity, 0)),
    expectedTicketCount: Number(payload?.expectedTicketCount ?? payload?.expected_ticket_count
      ?? orders.reduce((sum, order) => sum + order.expectedTicketCount, 0)),
    totalAmount: Number(payload?.totalAmount ?? orders.reduce((sum, order) => sum + order.totalAmount, 0)),
    paymentGroups,
    checkoutHash: String(payload?.checkoutHash ?? payload?.checkout_hash ?? ''),
  }
}
