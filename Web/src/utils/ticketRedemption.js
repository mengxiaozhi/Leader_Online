export function ticketDiscountLabel(value) {
  return Number(value) > 0 ? `每張抵免 NT$ ${Number(value).toLocaleString('zh-TW')}` : '每張抵免對應服務全額'
}

export function validTicketDiscount(value) {
  return ['number', 'string'].includes(typeof value) && /^\d+$/.test(String(value))
    && Number.isSafeInteger(Number(value)) && Number(value) <= 99999999
}

export function redemptionDiscount(unitPrice, redemptions) {
  const unitCents = Math.round(Number(unitPrice) * 100)
  return redemptions.reduce((sum, ticket) => {
    if (!validTicketDiscount(ticket.faceValue)) throw new Error('票券抵免金額不正確')
    const face = Number(ticket.faceValue)
    return sum + (face === 0 ? unitCents : Math.min(unitCents, face * 100))
  }, 0) / 100
}

// Keep the same allocation for the summary, legal review, and submitted order.
export function allocateTicketRedemptions(items, tickets, { ticketKey, itemKeys, unitPrice }) {
  const pools = new Map()
  for (const ticket of tickets) {
    if (ticket.used || ticket.voided_at || ticket.voidedAt) continue
    const key = ticketKey(ticket)
    if (!key) continue
    if (!pools.has(key)) pools.set(key, [])
    pools.get(key).push(ticket)
  }
  return items.map(item => {
    const quantity = Number(item.useTickets || 0)
    const taken = []
    for (const key of itemKeys(item)) {
      const pool = pools.get(key) || []
      while (pool.length && taken.length < quantity) taken.push(pool.shift())
    }
    const redemptions = taken.map(ticket => ({ ticketId: Number(ticket.id), faceValue: Number(ticket.discount ?? 0) }))
    const price = unitPrice(item)
    const discount = redemptionDiscount(price, redemptions)
    return { item, quantity, redemptions, discount, subtotal: Math.round((price * quantity - discount) * 100) / 100, missing: quantity - taken.length }
  })
}
