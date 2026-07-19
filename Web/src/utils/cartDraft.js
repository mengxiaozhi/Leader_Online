export const CART_DRAFT_VERSION = 1
export const CART_DRAFT_STORAGE_KEY = 'leader-online:guest-cart'

const clampQuantity = (value) => {
  const quantity = Math.floor(Number(value) || 0)
  return Math.max(1, Math.min(99, quantity))
}

export const sanitizeCartItem = (raw) => {
  if (!raw || typeof raw !== 'object') return null

  const name = String(raw.name || raw.title || '').trim()
  if (!name) return null

  const priceValue = Number(raw.price)
  const item = {
    name,
    price: Number.isFinite(priceValue) ? Math.max(0, Math.round(priceValue * 100) / 100) : 0,
    quantity: clampQuantity(raw.quantity ?? 1),
  }

  if (raw.id !== undefined && raw.id !== null) item.id = raw.id
  if (raw.cover) item.cover = String(raw.cover)
  if (raw.sku) item.sku = String(raw.sku)

  const providerUserId = String(raw.providerUserId || raw.provider_user_id || raw.owner_user_id || '').trim()
  if (providerUserId) {
    item.providerUserId = providerUserId
    item.provider_user_id = providerUserId
  }

  return item
}

export const sanitizeCartItems = (items = []) => (Array.isArray(items) ? items : [])
  .map(sanitizeCartItem)
  .filter(Boolean)

const itemMatches = (left, right) => {
  if (left?.id !== undefined && left?.id !== null && right?.id !== undefined && right?.id !== null) {
    return String(left.id) === String(right.id)
  }
  if (left?.sku && right?.sku) return left.sku === right.sku
  return left?.name === right?.name
}

export const mergeCartItems = (remoteItems = [], guestItems = []) => {
  const merged = sanitizeCartItems(remoteItems).map(item => ({ ...item }))

  for (const guestItem of sanitizeCartItems(guestItems)) {
    const existing = merged.find(remoteItem => itemMatches(remoteItem, guestItem))
    if (!existing) {
      merged.push({ ...guestItem })
      continue
    }

    existing.quantity = clampQuantity(existing.quantity + guestItem.quantity)
    // When the server already knows the product, keep its current price,
    // provider and presentation fields. The guest draft only contributes the
    // quantity and must not overwrite authoritative commerce metadata.
  }

  return merged
}

export const createCartDraft = (items = [], options = {}) => {
  const draft = {
    version: CART_DRAFT_VERSION,
    updatedAt: new Date().toISOString(),
    items: sanitizeCartItems(items),
  }
  const pendingItems = sanitizeCartItems(options.pendingItems)
  if (pendingItems.length) draft.pendingItems = pendingItems
  return draft
}

export const parseCartDraft = (raw) => {
  if (!raw) return null
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!parsed || parsed.version !== CART_DRAFT_VERSION || !Array.isArray(parsed.items)) return null
    const draft = {
      version: CART_DRAFT_VERSION,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      items: sanitizeCartItems(parsed.items),
    }
    const pendingItems = sanitizeCartItems(parsed.pendingItems)
    if (pendingItems.length) draft.pendingItems = pendingItems
    return draft
  } catch {
    return null
  }
}

export const planGuestCartMerge = (remoteItems = [], draft = null, options = {}) => {
  const remote = sanitizeCartItems(remoteItems)
  if (options.alreadyMerged) {
    return { items: remote, shouldPut: false, shouldClearDraft: false, merged: false }
  }

  const parsedDraft = parseCartDraft(draft)
  const guestItems = parsedDraft?.items || []
  if (!guestItems.length) {
    return { items: remote, shouldPut: false, shouldClearDraft: false, merged: false }
  }

  // A failed or interrupted PUT keeps the exact planned payload beside the
  // original guest items. Retrying this snapshot prevents adding the draft a
  // second time if the previous response was lost after the server committed.
  if (parsedDraft?.pendingItems?.length) {
    return {
      items: parsedDraft.pendingItems,
      shouldPut: true,
      shouldClearDraft: true,
      merged: true,
    }
  }

  return {
    items: mergeCartItems(remote, guestItems),
    // Persist even when both snapshots look identical. The draft is cleared only
    // after this request succeeds, which makes retries safe and predictable.
    shouldPut: true,
    shouldClearDraft: true,
    merged: true,
  }
}
