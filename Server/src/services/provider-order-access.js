function normalizePositiveInt(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeUserId(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function orderAccessKeys(details = {}) {
  const selections = [
    ...(Array.isArray(details.selections) ? details.selections : []),
    ...(Array.isArray(details.serviceSelections) ? details.serviceSelections : []),
    ...(details.serviceSelection && typeof details.serviceSelection === 'object' ? [details.serviceSelection] : []),
  ];
  return {
    eventId: normalizePositiveInt(details?.event?.id ?? details.event_id ?? details.eventId),
    productId: normalizePositiveInt(details.productId ?? details.product_id ?? details?.product?.id),
    productName: String(details.ticketType || details?.product?.name || '').trim(),
    storeIds: [...new Set(selections
      .map((entry) => normalizePositiveInt(entry?.storeId ?? entry?.store_id ?? entry?.storeID))
      .filter(Boolean))],
  };
}

async function queryOwnedRows(db, sql, params = []) {
  try {
    const [rows] = await db.query(sql, params);
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(error?.code)) return [];
    throw error;
  }
}

async function buildProviderOrderAccessIndex(db, providerUserId) {
  const providerId = normalizeUserId(providerUserId);
  if (!providerId) return { canManage: () => false };

  const [eventRows, productRows, storeRows] = await Promise.all([
    queryOwnedRows(db, 'SELECT id FROM events WHERE owner_user_id = ?', [providerId]),
    queryOwnedRows(db, 'SELECT id, name FROM products WHERE owner_user_id = ?', [providerId]),
    queryOwnedRows(db, 'SELECT id FROM event_stores WHERE owner_user_id = ?', [providerId]),
  ]);
  const eventIds = new Set(eventRows.map((row) => normalizePositiveInt(row.id)).filter(Boolean));
  const productIds = new Set(productRows.map((row) => normalizePositiveInt(row.id)).filter(Boolean));
  const productNames = new Set(productRows.map((row) => String(row.name || '').trim()).filter(Boolean));
  const storeIds = new Set(storeRows.map((row) => normalizePositiveInt(row.id)).filter(Boolean));

  return {
    canManage(details = {}) {
      const keys = orderAccessKeys(details);
      if (keys.eventId && eventIds.has(keys.eventId)) return true;
      if (keys.productId && productIds.has(keys.productId)) return true;
      if (!keys.productId && keys.productName && productNames.has(keys.productName)) return true;
      return keys.storeIds.length > 0 && keys.storeIds.every((id) => storeIds.has(id));
    },
  };
}

module.exports = { buildProviderOrderAccessIndex, orderAccessKeys };
