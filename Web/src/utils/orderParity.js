const asArray = value => Array.isArray(value) ? value : []

export const DEFAULT_MAX_PURCHASE_QUANTITY = 10

export function maxPurchaseQuantity(record = {}) {
  const candidate = Number(
    record.maxPurchaseQuantity
    ?? record.max_purchase_quantity
    ?? record.purchaseLimit
    ?? record.purchase_limit
    ?? DEFAULT_MAX_PURCHASE_QUANTITY
  )
  if (!Number.isFinite(candidate)) return DEFAULT_MAX_PURCHASE_QUANTITY
  return Math.max(1, Math.min(99, Math.floor(candidate)))
}

export function clampPurchaseQuantity(value, record = {}) {
  const quantity = Math.floor(Number(value) || 0)
  return Math.max(1, Math.min(maxPurchaseQuantity(record), quantity))
}

export function createOrderMutationKey(prefix = 'order') {
  const random = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${random}`.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 128)
}

export function orderMutationHeaders(order = {}, idempotencyKey = '') {
  const headers = {
    'Idempotency-Key': idempotencyKey || createOrderMutationKey('order-action'),
  }
  const rowVersion = order.rowVersion ?? order.row_version ?? order.version
  if (rowVersion !== undefined && rowVersion !== null && String(rowVersion).trim()) {
    headers['If-Match'] = String(rowVersion).trim()
  }
  return headers
}

export function shouldRetainIdempotencyKey(error) {
  const status = Number(error?.response?.status || 0)
  const code = String(
    error?.response?.data?.code
    || error?.response?.data?.error?.code
    || ''
  ).trim().toUpperCase()
  return !status || status === 408 || status === 429 || status >= 500 || code === 'IDEMPOTENCY_IN_PROGRESS'
}

const legacyPaymentStatus = order => {
  const raw = String(order.paymentStatus ?? order.payment_status ?? order.status ?? '').trim()
  if (['payment_review', 'reviewing', '處理中'].includes(raw)) return 'reviewing'
  if (['paid', 'issued', '已付款', '已完成', '待指派'].includes(raw)) return 'paid'
  if (['cancelled', 'canceled', '已取消'].includes(raw)) return 'cancelled'
  if (['refunded', '已退款'].includes(raw)) return 'refunded'
  return 'pending'
}

const legacyFulfillmentStatus = order => {
  const raw = String(order.fulfillmentStatus ?? order.fulfillment_status ?? '').trim()
  if (raw) return raw
  if (['issued', '已付款', '已完成', '待指派'].includes(String(order.status || '').trim())) return 'fulfilled'
  if (['refunded', '已退款'].includes(String(order.status || '').trim())) return 'voided'
  return 'pending'
}

export function normalizeOrderRecord(record = {}, source = 'course') {
  const lineItems = asArray(record.lineItems ?? record.line_items ?? record.items ?? record.orderItems)
  const rawTickets = asArray(record.issuedTickets ?? record.issued_tickets ?? record.tickets)
  const ticketCodes = asArray(record.ticketCodes ?? record.ticket_codes)
  const issuedTickets = rawTickets.length
    ? rawTickets
    : ticketCodes.map(code => ({ code: String(code) }))
  const capabilities = record.capabilities && typeof record.capabilities === 'object'
    ? { ...record.capabilities }
    : {}
  const editableFields = asArray(record.editableFields ?? record.editable_fields).map(String)
  const lifecycle = asArray(record.lifecycle ?? record.lifecycleEvents ?? record.lifecycle_events)

  return {
    ...record,
    source: String(record.source || source),
    paymentStatus: legacyPaymentStatus(record),
    fulfillmentStatus: legacyFulfillmentStatus(record),
    lineItems,
    items: lineItems,
    issuedTickets,
    ticketCodes: issuedTickets.map(ticket => String(ticket?.code || '')).filter(Boolean),
    rowVersion: record.rowVersion ?? record.row_version ?? record.version ?? '',
    capabilities,
    editableFields,
    lifecycle,
    maxPurchaseQuantity: maxPurchaseQuantity(record),
  }
}

export function hasOrderCapability(order = {}, capability) {
  return Boolean(order?.capabilities && order.capabilities[capability] === true)
}

export function hasEditableOrderField(order = {}, field) {
  return asArray(order?.editableFields).includes(field)
}

export function paymentStatusLabel(status) {
  return ({
    pending: '待匯款',
    reviewing: '款項確認中',
    paid: '已付款',
    cancelled: '已取消',
    refunded: '已退款',
  })[String(status || '')] || String(status || '—')
}

export function fulfillmentStatusLabel(status) {
  return ({
    pending: '待履約',
    fulfilled: '已發券',
    voided: '已作廢',
    failed: '發券失敗',
  })[String(status || '')] || String(status || '—')
}

export function orderStatusChip(order = {}) {
  if (order.paymentStatus === 'refunded' || order.fulfillmentStatus === 'voided') return ''
  if (order.paymentStatus === 'paid' && order.fulfillmentStatus === 'fulfilled') return 'ops-chip-success'
  if (order.paymentStatus === 'reviewing' || order.fulfillmentStatus === 'failed') return 'ops-chip-info'
  if (order.paymentStatus === 'pending') return 'ops-chip-warning'
  return ''
}

export function orderStatusSummary(order = {}) {
  const payment = paymentStatusLabel(order.paymentStatus)
  const fulfillment = fulfillmentStatusLabel(order.fulfillmentStatus)
  return order.paymentStatus === 'paid' && order.fulfillmentStatus === 'fulfilled'
    ? fulfillment
    : `${payment}／${fulfillment}`
}
