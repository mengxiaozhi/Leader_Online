export const BOOKING_DRAFT_VERSION = 1

const DRAFT_PREFIX = 'leader:booking-draft'

const nonNegativeInteger = (value, fallback = 0) => {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

const normalizeTypeName = (value) => String(value || '')
  .trim()
  .replace(/\s+/g, '')
  .replace(/^(EV|E)?\d{1,8}/i, '')
  .replace(/[（(][^（）()]*[）)]\s*$/, '')
  .replace(/(貨車託運券|託運券|票券|憑證|入場券|券)\s*$/, '')
  .replace(/(隊|組)\s*$/, '')

const resolveProductId = (source = {}) => {
  const raw = source?.productId
    ?? source?.product_id
    ?? source?.ticketProductId
    ?? source?.ticket_product_id
    ?? source?.product?.id
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

const ticketBindingKey = (type, price = {}) => {
  const productId = resolveProductId(price)
  if (productId) return `p-${productId}`
  const normalized = normalizeTypeName(type)
  return normalized ? `t-${normalized}` : ''
}

const capacityRemaining = (store = {}) => {
  const explicit = store.capacityRemaining ?? store.capacity_remaining
  if (explicit !== undefined && explicit !== null && String(explicit).trim() !== '') {
    return nonNegativeInteger(explicit)
  }
  const capacity = Number(store.capacity)
  if (!Number.isFinite(capacity) || capacity <= 0) return Number.POSITIVE_INFINITY
  const reserved = nonNegativeInteger(store.reservedQuantity ?? store.reserved_quantity)
  return Math.max(0, Math.floor(capacity) - reserved)
}

const normalizeAddOn = (value = {}) => ({
  material: value.material === true,
  materialCount: nonNegativeInteger(value.materialCount),
  nakedConfirm: value.nakedConfirm === true,
  purchasePolicy: false,
  usagePolicy: false,
})

export const bookingDraftKey = (eventCode) => {
  const code = String(eventCode || '').trim()
  return code ? `${DRAFT_PREFIX}:v${BOOKING_DRAFT_VERSION}:${encodeURIComponent(code)}` : ''
}

export const createBookingDraft = ({ eventCode, selectionItems = {}, addOn = {} } = {}) => ({
  version: BOOKING_DRAFT_VERSION,
  eventCode: String(eventCode || '').trim(),
  updatedAt: Date.now(),
  selections: Object.values(selectionItems || {})
    .filter(Boolean)
    .map(item => ({
      storeId: item.storeId ?? null,
      type: String(item.type || '').trim(),
      quantity: nonNegativeInteger(item.quantity),
      useTickets: nonNegativeInteger(item.useTickets),
    }))
    .filter(item => item.storeId !== null && item.type && (item.quantity > 0 || item.useTickets > 0)),
  addOn: normalizeAddOn(addOn),
})

export const saveBookingDraft = (eventCode, state, storage = globalThis.sessionStorage) => {
  const key = bookingDraftKey(eventCode)
  if (!key || !storage?.setItem) return null
  const draft = createBookingDraft({ eventCode, ...state })
  try {
    storage.setItem(key, JSON.stringify(draft))
    return draft
  } catch {
    return null
  }
}

export const loadBookingDraft = (eventCode, storage = globalThis.sessionStorage) => {
  const key = bookingDraftKey(eventCode)
  if (!key || !storage?.getItem) return null
  try {
    const draft = JSON.parse(storage.getItem(key) || 'null')
    if (draft?.version !== BOOKING_DRAFT_VERSION) return null
    if (String(draft.eventCode || '') !== String(eventCode || '').trim()) return null
    if (!Array.isArray(draft.selections)) return null
    return draft
  } catch {
    return null
  }
}

export const clearBookingDraft = (eventCode, storage = globalThis.sessionStorage) => {
  const key = bookingDraftKey(eventCode)
  if (!key || !storage?.removeItem) return
  try { storage.removeItem(key) } catch { /* storage may be unavailable */ }
}

/**
 * Restores only choices that still exist, then clamps them against the latest
 * delivery-point capacity and the shared live ticket pool.
 */
export const pruneBookingDraft = (draft, {
  stores = [],
  ticketAvailability = {},
  allowTickets = false,
} = {}) => {
  if (!draft || draft.version !== BOOKING_DRAFT_VERSION) {
    return { selections: [], addOn: normalizeAddOn() }
  }

  const storesById = new Map(stores.map(store => [String(store?.id ?? ''), store]))
  const capacityByStore = new Map(stores.map(store => [
    String(store?.id ?? ''),
    capacityRemaining(store),
  ]))
  const remainingTickets = Object.fromEntries(Object.entries(ticketAvailability || {})
    .map(([key, value]) => [key, nonNegativeInteger(value)]))
  const selections = []

  for (const saved of draft.selections || []) {
    const storeId = String(saved?.storeId ?? '')
    const store = storesById.get(storeId)
    if (!store) continue
    const type = String(saved?.type || '')
    const currentType = Object.keys(store.prices || {}).find(key => key === type)
      || Object.keys(store.prices || {}).find(key => normalizeTypeName(key) === normalizeTypeName(type))
    if (!currentType) continue

    const availableCapacity = capacityByStore.get(storeId) ?? Number.POSITIVE_INFINITY
    const quantity = Math.min(nonNegativeInteger(saved.quantity), availableCapacity)
    const capacityAfterQuantity = Math.max(0, availableCapacity - quantity)
    capacityByStore.set(storeId, capacityAfterQuantity)

    let useTickets = 0
    if (allowTickets && capacityAfterQuantity > 0) {
      const binding = ticketBindingKey(currentType, store.prices?.[currentType] || {})
      const availableTickets = remainingTickets[binding] || 0
      useTickets = Math.min(nonNegativeInteger(saved.useTickets), capacityAfterQuantity, availableTickets)
      remainingTickets[binding] = Math.max(0, availableTickets - useTickets)
      capacityByStore.set(storeId, Math.max(0, capacityAfterQuantity - useTickets))
    }

    if (quantity > 0 || useTickets > 0) {
      selections.push({
        storeId: store.id,
        type: currentType,
        quantity,
        useTickets,
      })
    }
  }

  return {
    selections,
    addOn: normalizeAddOn(draft.addOn),
  }
}
