const wholeQuantity = value => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(parsed))
}

const quantityLimit = value => value === Infinity ? Infinity : wholeQuantity(value)

/** Existing order payloads keep directly paid and ticket-backed units separate. */
export const bookingSelectionTotal = (selection = {}) => (
  wholeQuantity(selection.quantity) + wholeQuantity(selection.useTickets)
)

/** Changing bicycle count preserves tickets within the count and live limits. */
export const updateBookingTotal = (selection = {}, requestedTotal = 0, {
  maxTotal = 999,
  maxTickets = Infinity,
} = {}) => {
  const total = Math.min(wholeQuantity(requestedTotal), quantityLimit(maxTotal))
  const useTickets = Math.min(wholeQuantity(selection.useTickets), total, quantityLimit(maxTickets))
  return { quantity: total - useTickets, useTickets }
}

/** Tickets replace directly paid units; they never add another bicycle. */
export const updateBookingTickets = (selection = {}, requestedTickets = 0, {
  maxTotal = 999,
  maxTickets = Infinity,
} = {}) => {
  const total = Math.min(bookingSelectionTotal(selection), quantityLimit(maxTotal))
  const useTickets = Math.min(wholeQuantity(requestedTickets), total, quantityLimit(maxTickets))
  return { quantity: total - useTickets, useTickets }
}

const positiveId = value => {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

const storeId = store => positiveId(store?.id ?? store?.storeId ?? store?.store_id)
const pointId = source => positiveId(source?.deliveryPointId ?? source?.delivery_point_id)
const eventId = source => positiveId(source?.event?.id ?? source?.eventId ?? source?.event_id)

/**
 * Public capacity includes this unpaid order, while an order edit excludes it.
 * Match the backend's occupancy grouping by the saved delivery point, falling
 * back to the current store mapping only for legacy lines without a point ID.
 * These credits are a UI estimate; the locked server check remains authoritative.
 */
export const bookingEditCapacityCredits = (details = {}, stores = []) => {
  if (String(details.status || '').trim() === '已取消') return {}
  const orderEventId = eventId(details)
  const liveStores = (Array.isArray(stores) ? stores : []).filter(store => (
    storeId(store) && (!orderEventId || !eventId(store) || orderEventId === eventId(store))
  ))
  const storesById = new Map(liveStores.map(store => [storeId(store), store]))
  const livePoints = new Set(liveStores.map(pointId).filter(Boolean))
  const selections = Array.isArray(details.selections) ? details.selections : []
  let entries = selections.filter(selection => wholeQuantity(selection?.qty ?? selection?.quantity) > 0)
  if (!entries.length) {
    const service = details.serviceSelection && typeof details.serviceSelection === 'object'
      ? details.serviceSelection
      : details
    const quantity = wholeQuantity(details.quantity)
    entries = quantity > 0 ? [{
      storeId: service.storeId ?? service.store_id ?? details.storeId ?? details.store_id,
      deliveryPointId: service.deliveryPointId ?? service.delivery_point_id ?? details.deliveryPointId ?? details.delivery_point_id,
      quantity,
    }] : []
  }
  const creditsByPoint = new Map()
  for (const entry of entries) {
    const savedStoreId = positiveId(entry?.storeId ?? entry?.store_id ?? entry?.storeID)
    const savedPointId = pointId(entry)
    const occupiedPointId = savedPointId || pointId(storesById.get(savedStoreId))
    if (!occupiedPointId || !livePoints.has(occupiedPointId)) continue
    const quantity = wholeQuantity(entry?.qty ?? entry?.quantity)
    creditsByPoint.set(occupiedPointId, (creditsByPoint.get(occupiedPointId) || 0) + quantity)
  }
  return Object.fromEntries(liveStores
    .map(store => [String(storeId(store)), creditsByPoint.get(pointId(store)) || 0])
    .filter(([, credit]) => credit > 0))
}
