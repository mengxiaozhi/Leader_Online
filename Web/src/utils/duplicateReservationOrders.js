import { normalizeOrderRecord, paymentStatusLabel } from './orderParity.js'
import { formatTaipeiDateTime } from './datetime.js'

const text = value => String(value ?? '').trim()
const positiveId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null
const parseDetails = value => {
  if (value && typeof value === 'object') return value
  try { return JSON.parse(value || '{}') || {} } catch { return {} }
}
const eventIdentity = details => ({
  id: positiveId(details.event?.id ?? details.eventId ?? details.event_id),
  code: text(details.event?.code ?? details.eventCode ?? details.event_code),
})
const sameEvent = (left, right) => left.id && right.id
  ? left.id === right.id
  : !!left.code && left.code === right.code

const selectionIdentity = (selection, details) => ({
  storeId: positiveId(selection.storeId ?? selection.store_id ?? details.serviceSelection?.storeId ?? details.storeId ?? details.store_id),
  deliveryPointId: positiveId(selection.deliveryPointId ?? selection.delivery_point_id ?? details.serviceSelection?.deliveryPointId),
  store: text(selection.store ?? selection.storeName ?? details.serviceSelection?.storeName),
  type: text(selection.type ?? selection.ticketType),
  quantity: Number(selection.qty ?? selection.quantity ?? 0),
})
const sameSelection = (left, right) => {
  if (!left.type || left.type !== right.type) return false
  if (left.storeId && right.storeId) return left.storeId === right.storeId
  if (left.deliveryPointId && right.deliveryPointId) return left.deliveryPointId === right.deliveryPointId
  return !!left.store && left.store === right.store
}

// The caller supplies only the authenticated member's complete order history.
// Keep cash/ticket redemption and pricing changes out of the duplicate identity.
export function findDuplicateReservationOrders(orders, proposed) {
  const proposedEvent = eventIdentity(proposed)
  const proposedSelections = (proposed.selections || [])
    .map(selection => selectionIdentity(selection, proposed)).filter(selection => selection.quantity > 0)
  return orders.flatMap(record => {
    const details = parseDetails(record.details)
    if (!sameEvent(eventIdentity(details), proposedEvent)) return []
    const order = normalizeOrderRecord({ ...record, status: record.status || details.status }, 'general')
    if (['cancelled', 'refunded'].includes(order.paymentStatus) || order.fulfillmentStatus === 'voided') return []
    const matches = []
    for (const selection of Array.isArray(details.selections) ? details.selections : []) {
      const identity = selectionIdentity(selection, details)
      if (!(identity.quantity > 0) || !proposedSelections.some(item => sameSelection(item, identity))) continue
      const existing = matches.find(item => sameSelection(item, identity))
      if (existing) existing.quantity += identity.quantity
      else matches.push(identity)
    }
    return matches.length ? [{
      id: order.id,
      code: text(order.code) || `#${order.id}`,
      createdAt: order.createdAt ?? order.created_at,
      paymentStatus: order.paymentStatus,
      consignorName: text(details.consignorName),
      selections: matches,
    }] : []
  })
}

export function duplicateReservationOrderMessage(matches) {
  const summaries = matches.map(order => {
    const items = order.selections.map(item => `${item.store || '同一交車點'}／${item.type} × ${item.quantity}`).join('、')
    const date = formatTaipeiDateTime(order.createdAt, { fallback: '未記錄時間' })
    const consignor = order.consignorName ? `\n託運者：${order.consignorName}` : ''
    return `訂單 ${order.code}｜${paymentStatusLabel(order.paymentStatus)}\n下單時間：${date}（台灣時間）${consignor}\n${items}`
  })
  return `此帳號先前已在同一場次下單，交車點與車種和本次選擇相同，共找到 ${matches.length} 筆訂單。\n\n${summaries.join('\n\n')}\n\n請先確認是否重複下單；若是替其他選手預約或確實需要追加，仍可繼續。先前訂單可至「我的訂單」查看。`
}
