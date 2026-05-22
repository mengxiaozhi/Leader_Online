const express = require('express');
const { randomUUID } = require('crypto');

function buildOrderRoutes(ctx) {
  const router = express.Router();
  const {
    ok,
    fail,
    pool,
    authRequired,
    adminOnly,
    serviceProviderOnly,
    parsePositiveInt,
    normalizePositiveInt,
    safeParseJSON,
    ensureRemittance,
    defaultRemittanceDetails,
    hasRemittanceDetails,
    applyRemittanceDetails,
    resolveOrderRemittance,
    hydrateOrderRemittance,
    summarizeOrderDetails,
    composeReservationPaymentContent,
    sendOrderNotificationEmail,
    notifyLineByUserId,
    buildOrderDoneFlex,
    buildOrderCreatedFlex,
    generateOrderCode,
    generateReservationStageCode,
    insertReservationsBulk,
    REMITTANCE_SETTING_KEYS,
    REMITTANCE_ENV_DEFAULTS,
    remittanceConfig,
    getReservationChecklistDefinitions,
    persistReservationChecklistDefinitions,
    CHECKLIST_DEFINITION_SETTING_KEY,
    CHECKLIST_STAGE_KEYS,
    getRemittanceConfig,
    SITE_PAGE_KEYS,
    ensureUserContactInfoReady,
    formatDateYYYYMMDD,
    logTicket,
    ensureTicketProductIdColumn,
    ensureProductManagementSchema,
    setAppSetting,
    deleteAppSetting,
    loadRemittanceConfig,
    getProviderRemittanceConfig,
    saveProviderRemittanceConfig,
    getSitePages,
    DEFAULT_RESERVATION_CHECKLIST_DEFINITIONS,
    isADMIN,
    getUserContact,
    fetchReservationsContext,
    syncReservationTasksForIds,
    normalizeEventServicePriceMap,
    normalizeUserId,
    ensureEventDriverAssignmentsTable,
  } = ctx;

  const ORDER_STATUS_REMITTANCE_PENDING = '待匯款';
  const ORDER_STATUS_PROCESSING = '處理中';
  const ORDER_STATUS_PAID = '已付款';
  const ORDER_STATUS_PAID_LEGACY = '已完成';
  const ORDER_STATUS_ASSIGNMENT_LEGACY = '待指派';
  const ORDER_PAYMENT_STATUSES = [ORDER_STATUS_REMITTANCE_PENDING, ORDER_STATUS_PROCESSING, ORDER_STATUS_PAID];

  function normalizeOrderPaymentStatus(value = '') {
    const status = String(value || '').trim();
    if (status === ORDER_STATUS_PAID_LEGACY || status === ORDER_STATUS_ASSIGNMENT_LEGACY) return ORDER_STATUS_PAID;
    return status;
  }

  function isOrderPaidStatus(value = '') {
    return normalizeOrderPaymentStatus(value) === ORDER_STATUS_PAID;
  }

  function normalizeOrderDetailsForPayment(details = {}) {
    const normalized = details && typeof details === 'object' ? details : {};
    if (normalized.status) normalized.status = normalizeOrderPaymentStatus(normalized.status);
    delete normalized.driver;
    delete normalized.driverId;
    delete normalized.driver_id;
    return normalized;
  }

  function normalizeTicketTypeKey(value = '') {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  }

  function buildTicketUsageExpectations(details = {}) {
    const selections = Array.isArray(details?.selections) ? details.selections : [];
    const expectations = [];
    for (const sel of selections) {
      if (!sel?.byTicket) continue;
      const qty = Math.max(0, Math.floor(Number(sel.qty || sel.quantity || 0)));
      if (!qty) continue;
      const productId = normalizePositiveInt(sel.productId ?? sel.product_id ?? sel.product);
      const typeKey = normalizeTicketTypeKey(sel.type || sel.ticketType || '');
      for (let i = 0; i < qty; i++) expectations.push({ productId, typeKey, type: sel.type || sel.ticketType || '' });
    }
    return expectations;
  }

  function ticketMatchesExpectation(ticket = {}, expectation = {}) {
    const ticketProductId = normalizePositiveInt(ticket.product_id ?? ticket.productId);
    if (expectation.productId && ticketProductId) return ticketProductId === expectation.productId;
    if (expectation.productId && !ticketProductId) return normalizeTicketTypeKey(ticket.type) === expectation.typeKey;
    if (!expectation.productId && ticketProductId) return false;
    if (expectation.typeKey) return normalizeTicketTypeKey(ticket.type) === expectation.typeKey;
    return true;
  }

  async function validateTicketsUsable(conn, userId, rawTickets = [], details = {}) {
    const ids = Array.from(new Set((Array.isArray(rawTickets) ? rawTickets : [])
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0)));
    if (!ids.length) return [];
    const hasProductId = await ensureTicketProductIdColumn(conn);
    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await conn.query(
      `
        SELECT id, type, ${hasProductId ? 'product_id' : 'NULL AS product_id'}
        FROM tickets
        WHERE user_id = ?
          AND used = 0
          AND (expiry IS NULL OR expiry > CURRENT_DATE())
          AND id IN (${placeholders})
      `,
      [userId, ...ids]
    );
    const valid = rows.map((r) => Number(r.id));
    const invalid = ids.filter((id) => !valid.includes(id));
    if (invalid.length) {
      const err = new Error('包含已過期或不可用的票券');
      err.code = 'INVALID_TICKETS';
      err.invalidTickets = invalid;
      throw err;
    }
    const expectations = buildTicketUsageExpectations(details);
    if (expectations.length && expectations.length !== ids.length) {
      const err = new Error('票券抵扣數量與訂單內容不一致，請重新選擇票券');
      err.code = 'TICKET_USAGE_MISMATCH';
      throw err;
    }
    if (expectations.length) {
      const rowById = new Map(rows.map((row) => [Number(row.id), row]));
      const remaining = expectations.slice();
      for (const id of ids) {
        const ticket = rowById.get(id);
        const index = remaining.findIndex((expectation) => ticketMatchesExpectation(ticket, expectation));
        if (index < 0) {
          const err = new Error('票券不適用於所選服務項目，請重新選擇票券');
          err.code = 'TICKET_PRODUCT_MISMATCH';
          err.invalidTickets = [id];
          throw err;
        }
        remaining.splice(index, 1);
      }
    }
    return ids;
  }

  async function listProviderOwnedStoreIds(connOrPool, providerUserId) {
    if (!providerUserId) return new Set();
    try {
      const [rows] = await connOrPool.query('SELECT id FROM event_stores WHERE owner_user_id = ?', [providerUserId]);
      return new Set(
        (Array.isArray(rows) ? rows : [])
          .map((row) => Number(row.id))
          .filter((id) => Number.isFinite(id) && id > 0)
      );
    } catch (err) {
      if (err?.code === 'ER_BAD_FIELD_ERROR') return new Set();
      throw err;
    }
  }

  function readOrderServiceSelection(details = {}) {
    const source = details?.serviceSelection && typeof details.serviceSelection === 'object'
      ? details.serviceSelection
      : details;
    return {
      storeId: normalizePositiveInt(source.storeId ?? source.store_id),
      deliveryPointId: normalizePositiveInt(source.deliveryPointId ?? source.delivery_point_id),
      storeName: String(source.storeName ?? source.store_name ?? '').trim(),
      legacyPreStoreId: normalizePositiveInt(source.preStoreId ?? source.pre_store_id),
      legacyPostStoreId: normalizePositiveInt(source.postStoreId ?? source.post_store_id),
      legacyPreDeliveryPointId: normalizePositiveInt(source.preDeliveryPointId ?? source.pre_delivery_point_id),
      legacyPostDeliveryPointId: normalizePositiveInt(source.postDeliveryPointId ?? source.post_delivery_point_id),
      legacyPreStoreName: String(source.preStoreName ?? source.pre_store_name ?? '').trim(),
      legacyPostStoreName: String(source.postStoreName ?? source.post_store_name ?? '').trim(),
    };
  }

  async function fetchEventServiceRows(connOrPool, storeIds = []) {
    const ids = Array.from(new Set((Array.isArray(storeIds) ? storeIds : [storeIds])
      .map((value) => normalizePositiveInt(value))
      .filter((value) => Number.isFinite(value) && value > 0)));
    if (!ids.length) return new Map();
    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await connOrPool.query(
      `SELECT s.id, s.event_id, s.delivery_point_id, s.name, s.is_active, s.pre_enabled, s.post_enabled, s.prices,
              e.deadline AS event_deadline
         FROM event_stores s
         LEFT JOIN events e ON e.id = s.event_id
        WHERE s.id IN (${placeholders})`,
      ids
    );
    return (Array.isArray(rows) ? rows : []).reduce((map, row) => {
      const id = normalizePositiveInt(row.id);
      if (!id) return map;
      map.set(id, row);
      return map;
    }, new Map());
  }

  async function resolveOrderServiceSelection(connOrPool, details = {}) {
    const eventId = normalizePositiveInt(details?.event?.id ?? details?.event_id ?? details?.eventId);
    const base = readOrderServiceSelection(details);
    const fallbackStoreId = normalizePositiveInt(details?.storeId ?? details?.store_id);
    const storeIds = Array.from(new Set([
      base.storeId,
      base.legacyPreStoreId,
      base.legacyPostStoreId,
      fallbackStoreId,
    ].filter((value) => Number.isFinite(value) && value > 0)));
    if (!storeIds.length) {
      const err = new Error('請先選擇交車點');
      err.code = 'ORDER_SERVICE_SELECTION_REQUIRED';
      throw err;
    }
    if (storeIds.length > 1) {
      const err = new Error('賽前與賽後已改為單一交車點，請重新選擇');
      err.code = 'ORDER_SERVICE_SELECTION_DELIVERY_POINT_MISMATCH';
      throw err;
    }
    const [storeId] = storeIds;
    const storeMap = await fetchEventServiceRows(connOrPool, [storeId]);
    const store = storeMap.get(storeId);
    if (!store) {
      const err = new Error('交車點服務設定不存在，請重新整理後再試');
      err.code = 'ORDER_SERVICE_SELECTION_NOT_FOUND';
      throw err;
    }
    if (eventId) {
      if (normalizePositiveInt(store.event_id) !== eventId) {
        const err = new Error('交車點服務不屬於目前賽事');
        err.code = 'ORDER_SERVICE_SELECTION_EVENT_MISMATCH';
        throw err;
      }
    }
    if (Number(store.is_active || 0) === 0) {
      const err = new Error('交車點服務已停用，請重新選擇');
      err.code = 'ORDER_SERVICE_SELECTION_INACTIVE';
      throw err;
    }
    if (Number(store.pre_enabled || 0) === 0) {
      const err = new Error('所選賽前交車點目前未提供賽前交車服務');
      err.code = 'ORDER_PRE_SERVICE_DISABLED';
      throw err;
    }
    if (Number(store.post_enabled || 0) === 0) {
      const err = new Error('所選賽後交車點目前未提供賽後交車服務');
      err.code = 'ORDER_POST_SERVICE_DISABLED';
      throw err;
    }
    const deliveryPointIds = Array.from(new Set([
      base.deliveryPointId,
      base.legacyPreDeliveryPointId,
      base.legacyPostDeliveryPointId,
      normalizePositiveInt(store.delivery_point_id),
    ].filter((value) => Number.isFinite(value) && value > 0)));
    if (deliveryPointIds.length > 1) {
      const err = new Error('交車點資料不一致，請重新選擇');
      err.code = 'ORDER_SERVICE_SELECTION_DELIVERY_POINT_MISMATCH';
      throw err;
    }
    const deliveryPointId = deliveryPointIds[0] || null;
    const storeName = base.storeName
      || base.legacyPreStoreName
      || base.legacyPostStoreName
      || String(store.name || '').trim();
    return {
      storeId,
      deliveryPointId,
      storeName,
      storeSummary: storeName,
      prices: safeParseJSON(store.prices, {}),
      eventDeadline: store.event_deadline || null,
    };
  }

  function roundMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.round(n * 100) / 100);
  }

  function parsePriceDateMs(value) {
    if (!value) return null;
    const ts = Date.parse(String(value).trim().replace(' ', 'T'));
    return Number.isNaN(ts) ? null : ts;
  }

  function isEarlyPriceActive(price = {}, eventDeadline = null, now = new Date()) {
    const rawStart = price.early_start ?? price.earlyStart;
    const rawEnd = price.early_end ?? price.earlyEnd;
    const hasItemWindow = !!rawStart || !!rawEnd;
    const nowMs = now.getTime();
    if (hasItemWindow) {
      const startMs = parsePriceDateMs(rawStart);
      const endMs = parsePriceDateMs(rawEnd);
      if (startMs !== null && nowMs < startMs) return false;
      if (endMs !== null && nowMs > endMs) return false;
      return startMs !== null || endMs !== null;
    }
    const deadlineMs = parsePriceDateMs(eventDeadline);
    return deadlineMs === null ? true : nowMs <= deadlineMs;
  }

  function findPriceEntry(prices = {}, type = '') {
    const key = String(type || '').trim();
    if (!key) return null;
    if (prices[key]) return prices[key];
    const normalizedKey = normalizeTicketTypeKey(key);
    const matchedKey = Object.keys(prices || {}).find((candidate) => normalizeTicketTypeKey(candidate) === normalizedKey);
    return matchedKey ? prices[matchedKey] : null;
  }

  function ensureReservationOrderPricing(details = {}, serviceSelection = {}) {
    const selections = Array.isArray(details.selections) ? details.selections : [];
    if (!selections.length) return details;
    const prices = normalizeEventServicePriceMap(serviceSelection.prices || {});
    if (!Object.keys(prices).length) {
      const err = new Error('所選交車點尚未設定價格表，請重新整理後再試');
      err.code = 'ORDER_SERVICE_PRICES_MISSING';
      throw err;
    }

    let subtotal = 0;
    let discount = 0;
    let quantity = 0;
    const now = new Date();
    for (const sel of selections) {
      const type = String(sel.type || sel.ticketType || '').trim();
      const qty = Math.max(0, Math.floor(Number(sel.qty || sel.quantity || 0)));
      const price = findPriceEntry(prices, type);
      if (!type || !qty || !price) {
        const err = new Error('訂單包含無效或不存在的服務項目，請重新選擇');
        err.code = 'ORDER_SERVICE_PRICE_ITEM_INVALID';
        throw err;
      }
      const priceMode = isEarlyPriceActive(price, serviceSelection.eventDeadline, now) ? 'early' : 'normal';
      const unitPrice = roundMoney(priceMode === 'early' ? price.early : price.normal);
      const expectedSubtotal = sel.byTicket ? 0 : roundMoney(unitPrice * qty);
      const expectedDiscount = sel.byTicket ? roundMoney(unitPrice * qty) : 0;
      const submittedUnit = roundMoney(sel.unitPrice ?? sel.price);
      const submittedSubtotal = roundMoney(sel.subtotal || 0);
      const submittedDiscount = roundMoney(sel.discount || 0);
      if (
        Math.abs(submittedUnit - unitPrice) > 0.01
        || Math.abs(submittedSubtotal - expectedSubtotal) > 0.01
        || Math.abs(submittedDiscount - expectedDiscount) > 0.01
      ) {
        const err = new Error('價格已更新，請重新整理頁面後再送出預約');
        err.code = 'ORDER_PRICE_CHANGED';
        throw err;
      }
      sel.qty = qty;
      sel.unitPrice = unitPrice;
      sel.subtotal = expectedSubtotal;
      sel.discount = expectedDiscount;
      sel.priceMode = priceMode;
      if (price.early_start) sel.early_start = price.early_start;
      if (price.early_end) sel.early_end = price.early_end;
      subtotal += expectedSubtotal + expectedDiscount;
      discount += expectedDiscount;
      quantity += qty;
    }

    const requestedAddOnCost = roundMoney(details.addOnCost || 0);
    const materialCount = Math.max(0, Math.floor(Number(details?.addOn?.materialCount || 0)));
    const expectedAddOnCost = details?.addOn?.material ? roundMoney(materialCount * 100) : 0;
    if (Math.abs(requestedAddOnCost - expectedAddOnCost) > 0.01) {
      const err = new Error('加購費用已更新，請重新整理頁面後再送出預約');
      err.code = 'ORDER_PRICE_CHANGED';
      throw err;
    }

    const total = roundMoney(Math.max(subtotal + expectedAddOnCost - discount, 0));
    if (
      Math.abs(roundMoney(details.subtotal || 0) - subtotal) > 0.01
      || Math.abs(roundMoney(details.discount || 0) - discount) > 0.01
      || Math.abs(roundMoney(details.total || 0) - total) > 0.01
      || Math.max(0, Math.floor(Number(details.quantity || 0))) !== quantity
    ) {
      const err = new Error('訂單金額已更新，請重新整理頁面後再送出預約');
      err.code = 'ORDER_PRICE_CHANGED';
      throw err;
    }

    details.subtotal = subtotal;
    details.discount = discount;
    details.addOnCost = expectedAddOnCost;
    details.total = total;
    details.quantity = quantity;
    return details;
  }

  function extractSelectionStoreIds(details = {}) {
    const selections = Array.isArray(details?.selections) ? details.selections : [];
    const ids = selections
      .map((sel) => normalizePositiveInt(sel?.storeId ?? sel?.store_id ?? sel?.storeID))
      .filter((id) => Number.isFinite(id) && id > 0);
    return Array.from(new Set(ids));
  }

  async function providerCanManageOrder(connOrPool, details = {}, providerUserId) {
    const eventId = normalizePositiveInt(details?.event?.id ?? details?.event_id ?? details?.eventId);
    if (eventId && providerUserId) {
      const [rows] = await connOrPool.query('SELECT id FROM events WHERE id = ? AND owner_user_id = ? LIMIT 1', [eventId, providerUserId]);
      if (Array.isArray(rows) && rows.length > 0) return true;
    }
    const productId = normalizePositiveInt(details.productId ?? details.product_id ?? details.product?.id);
    const ticketType = String(details.ticketType || details?.product?.name || '').trim();
    if (providerUserId && (productId || ticketType)) {
      try {
        await ensureProductManagementSchema();
        const where = ['owner_user_id = ?'];
        const params = [providerUserId];
        if (productId) {
          where.push('id = ?');
          params.push(productId);
        } else {
          where.push('name = ?');
          params.push(ticketType);
        }
        const [rows] = await connOrPool.query(`SELECT id FROM products WHERE ${where.join(' AND ')} LIMIT 1`, params);
        if (Array.isArray(rows) && rows.length > 0) return true;
      } catch (err) {
        if (err?.code !== 'ER_BAD_FIELD_ERROR' && err?.code !== 'ER_NO_SUCH_TABLE') throw err;
      }
    }
    const ownedStoreIds = await listProviderOwnedStoreIds(connOrPool, providerUserId);
    if (!ownedStoreIds.size) return false;
    const storeIds = extractSelectionStoreIds(details);
    if (!storeIds.length) return false;
    return storeIds.every((id) => ownedStoreIds.has(id));
  }

  function isReservationOrderDetails(details = {}) {
    return Array.isArray(details?.selections) && details.selections.length > 0;
  }

  async function listReservationsByOrderId(connOrPool, orderId) {
    const normalized = normalizePositiveInt(orderId);
    if (!normalized) return [];
    try {
      const [rows] = await connOrPool.query(
        `SELECT id
          FROM reservations
          WHERE order_id = ?
         ORDER BY id ASC`,
        [normalized]
      );
      return Array.isArray(rows) ? rows : [];
    } catch (err) {
      if (err?.code === 'ER_BAD_FIELD_ERROR') return [];
      throw err;
    }
  }

  async function resolveDefaultDriverForReservation(connOrPool, { eventId, storeId } = {}) {
    const normalizedEventId = normalizePositiveInt(eventId);
    const normalizedStoreId = normalizePositiveInt(storeId);
    if (!normalizedEventId || !normalizedStoreId) return null;
    await ensureEventDriverAssignmentsTable();
    let providerUserId = null;
    try {
      const [providerRows] = await connOrPool.query(
        `SELECT COALESCE(s.owner_user_id, e.owner_user_id) AS provider_user_id
           FROM event_stores s
           LEFT JOIN events e ON e.id = s.event_id
          WHERE s.id = ? AND s.event_id = ?
          LIMIT 1`,
        [normalizedStoreId, normalizedEventId]
      );
      providerUserId = normalizeUserId(providerRows?.[0]?.provider_user_id);
    } catch (err) {
      if (err?.code !== 'ER_BAD_FIELD_ERROR') throw err;
      const [providerRows] = await connOrPool.query(
        `SELECT e.owner_user_id AS provider_user_id
           FROM event_stores s
           LEFT JOIN events e ON e.id = s.event_id
          WHERE s.id = ? AND s.event_id = ?
          LIMIT 1`,
        [normalizedStoreId, normalizedEventId]
      );
      providerUserId = normalizeUserId(providerRows?.[0]?.provider_user_id);
    }
    if (!providerUserId) return null;
    const [rows] = await connOrPool.query(
      `SELECT a.driver_id
         FROM event_driver_assignments a
         JOIN users d ON d.id = a.driver_id
        WHERE a.event_id = ?
          AND a.provider_user_id = ?
          AND UPPER(d.role) = 'DRIVER'
          AND d.provider_id = ?
        LIMIT 1`,
      [normalizedEventId, providerUserId, providerUserId]
    );
    return normalizeUserId(rows?.[0]?.driver_id) || null;
  }

  async function buildReservationRowsForOrder(connOrPool, { userId, orderId, details = {} } = {}) {
    const selections = Array.isArray(details.selections) ? details.selections : [];
    const serviceSelection = await resolveOrderServiceSelection(connOrPool, details);
    const eventName = details?.event?.name || details?.event || '';
    const eventId = normalizePositiveInt(details?.event?.id ?? details?.event_id ?? details?.eventId);
    const defaultDriverId = await resolveDefaultDriverForReservation(connOrPool, {
      eventId,
      storeId: serviceSelection.storeId,
    });
    const reservationRows = [];
    for (const sel of selections) {
      const qty = Number(sel.qty || sel.quantity || 0);
      const type = sel.type || sel.ticketType || '';
      for (let i = 0; i < qty; i++) {
        reservationRows.push({
          userId,
          ticketType: type,
          storeName: serviceSelection.storeSummary || '',
          eventName,
          eventId,
          storeId: serviceSelection.storeId,
          orderId,
          deliveryPointId: serviceSelection.deliveryPointId,
          driverId: defaultDriverId,
        });
      }
    }
    return { reservationRows, serviceSelection };
  }


router.get('/orders/me', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
    const data = await Promise.all(rows.map(async (row) => {
      const details = normalizeOrderDetailsForPayment(await hydrateOrderRemittance(safeParseJSON(row.details, {})));
      return { ...row, details: JSON.stringify(details) };
    }));
    return ok(res, data);
  } catch (err) {
    return fail(res, 'ORDERS_LIST_FAIL', err.message, 500);
  }
});

router.post('/orders', authRequired, async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) return fail(res, 'VALIDATION_ERROR', '缺少 items', 400);

  let contactCheck;
  try {
    contactCheck = await ensureUserContactInfoReady(req.user.id);
  } catch (err) {
    console.error('[orders] contact check failed', {
      userId: req.user?.id,
      code: err?.code,
      message: err?.message,
      stack: err?.stack,
    });
    return fail(res, 'USER_CONTACT_CHECK_FAIL', err.message || '內部錯誤', 500);
  }
  if (!contactCheck.ok) return fail(res, contactCheck.code, contactCheck.message, contactCheck.status || 400);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const created = [];
    const createdSummaries = [];
    for (const it of items) {
      const code = await generateOrderCode();
      let details = safeParseJSON(it, {});
      let total = Number(details.total || 0);
      const isReservationOrder = isReservationOrderDetails(details);
      if (isReservationOrder) {
        const normalizedServiceSelection = await resolveOrderServiceSelection(conn, details);
        ensureReservationOrderPricing(details, normalizedServiceSelection);
        total = Number(details.total || 0);
        details.serviceSelection = {
          storeId: normalizedServiceSelection.storeId,
          deliveryPointId: normalizedServiceSelection.deliveryPointId,
          storeName: normalizedServiceSelection.storeName,
        };
      }
      if (isReservationOrder) {
        const remittanceResolution = await resolveOrderRemittance({
          ...details,
          remittance: {},
          bankInfo: '',
          bankCode: '',
          bankAccount: '',
          bankAccountName: '',
          bankName: '',
        });
        if (remittanceResolution.missingStoreIds.length) {
          const err = new Error('部分店面資料不存在，請重新整理後再試');
          err.code = 'ORDER_REMITTANCE_STORE_NOT_FOUND';
          throw err;
        }
        if (remittanceResolution.missingConfigStoreIds.length) {
          const err = new Error('所選店面、服務商與平台尚未設定匯款資訊，請先聯繫平台管理員');
          err.code = 'ORDER_REMITTANCE_UNSET';
          throw err;
        }
        if (remittanceResolution.multiple) {
          const err = new Error('本次選擇包含不同匯款資訊的店面，請分開下單');
          err.code = 'ORDER_REMITTANCE_MIXED';
          throw err;
        }
        if (hasRemittanceDetails(remittanceResolution.remittance)) {
          details = applyRemittanceDetails(details, remittanceResolution.remittance);
        }
      } else {
        const remittanceResolution = await resolveOrderRemittance(details);
        if (Array.isArray(remittanceResolution.missingConfigProductIds) && remittanceResolution.missingConfigProductIds.length) {
          const err = new Error('所選票券商品服務商與平台尚未設定匯款資訊，請先聯繫平台管理員');
          err.code = 'ORDER_REMITTANCE_UNSET';
          throw err;
        }
        if (hasRemittanceDetails(remittanceResolution.remittance)) {
          details = applyRemittanceDetails(details, remittanceResolution.remittance);
        } else {
          details = await hydrateOrderRemittance(details);
        }
      }
      // 狀態：0 元強制付款完成，否則沿用或預設待匯款
      details.status = total <= 0
        ? ORDER_STATUS_PAID
        : (normalizeOrderPaymentStatus(details.status) || ORDER_STATUS_REMITTANCE_PENDING);
      ensureRemittance(details);
      const validatedTicketIds = await validateTicketsUsable(conn, req.user.id, details.ticketsUsed || [], details);

      const [r] = await conn.query('INSERT INTO orders (user_id, code, details) VALUES (?, ?, ?)', [req.user.id, code, JSON.stringify(details)]);
      const orderId = r.insertId;
      const ticketsUsedForOrder = Array.isArray(details.ticketsUsed) ? details.ticketsUsed : [];
      if (!details.tickets_marked && ticketsUsedForOrder.length > 0) {
        const ids = validatedTicketIds;
        if (ids.length) {
          const placeholders = ids.map(() => '?').join(',');
          const [upd] = await conn.query(
            `UPDATE tickets SET used = 1
             WHERE user_id = ?
               AND used = 0
               AND (expiry IS NULL OR expiry > CURRENT_DATE())
               AND id IN (${placeholders})`,
            [req.user.id, ...ids]
          );
          if (Number(upd.affectedRows || 0) !== ids.length) {
            const err = new Error('票券狀態已變更，請重新選擇票券');
            err.code = 'TICKET_USE_CONFLICT';
            throw err;
          }
          details.tickets_marked = true;
          await conn.query('UPDATE orders SET details = ? WHERE id = ?', [JSON.stringify(details), orderId]);
        }
      }
      created.push({ id: orderId, code });
      createdSummaries.push({ id: orderId, code, total, status: details.status, remittance: details.remittance, detailsSummary: summarizeOrderDetails(details), detailsRaw: details });

      // 0 元訂單：自動標記為已付款並執行付款副作用（發券/建預約/標記票券）
      if (total <= 0) {
        try {
          const selections = Array.isArray(details.selections) ? details.selections : [];
          const isReservationOrder = selections.length > 0;

          // 票券型訂單（非預約）：發券
          if (!isReservationOrder && !details.granted) {
            const ticketType = details.ticketType || details?.event?.name || null;
            const quantity = Number(details.quantity || 0);
            if (ticketType && quantity > 0) {
              const today = new Date();
              const expiry = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());
              const expiryStr = formatDateYYYYMMDD(expiry);
              const productId = normalizePositiveInt(details.productId ?? details.product_id ?? details.product?.id);
              const hasTicketProductId = await ensureTicketProductIdColumn(conn);
              const values = [];
              for (let i = 0; i < quantity; i++) {
                values.push(hasTicketProductId
                  ? [req.user.id, ticketType, productId || null, expiryStr, randomUUID(), 0, 0]
                  : [req.user.id, ticketType, expiryStr, randomUUID(), 0, 0]);
              }
              if (values.length) {
                const [ins] = await conn.query(
                  hasTicketProductId
                    ? 'INSERT INTO tickets (user_id, type, product_id, expiry, uuid, discount, used) VALUES ?;'
                    : 'INSERT INTO tickets (user_id, type, expiry, uuid, discount, used) VALUES ?;',
                  [values]
                );
                // Log issuance per ticket
                try {
                  const firstId = Number(ins.insertId || 0);
                  const count = Number(ins.affectedRows || values.length);
                  for (let i = 0; i < count; i++) {
                    const tid = firstId ? (firstId + i) : null;
                    if (tid) await logTicket({ conn, ticketId: tid, userId: req.user.id, action: 'issued', meta: { type: ticketType, order_id: orderId, order_code: code } });
                  }
                } catch (_) { /* ignore */ }
              }
              details.granted = true;
              await conn.query('UPDATE orders SET details = ? WHERE id = ?', [JSON.stringify(details), orderId]);
            }
          }

          // 預約型訂單：建立預約
          if (isReservationOrder && !details.reservations_granted) {
            const { reservationRows, serviceSelection } = await buildReservationRowsForOrder(conn, {
              userId: req.user.id,
              orderId,
              details,
            });
            details.serviceSelection = {
              storeId: serviceSelection.storeId,
              deliveryPointId: serviceSelection.deliveryPointId,
              storeName: serviceSelection.storeName,
            };
            if (reservationRows.length) {
              const [ins] = await insertReservationsBulk(conn, reservationRows);
              // Immediately seed pre_dropoff codes for the new rows (best-effort)
              try {
                const startId = Number(ins.insertId || 0);
                const count = Number(ins.affectedRows || 0);
                for (let i = 0; i < count; i++) {
                  const id = startId + i;
                  const code = await generateReservationStageCode(conn);
                  await conn.query('UPDATE reservations SET verify_code_pre_dropoff = COALESCE(verify_code_pre_dropoff, ?) WHERE id = ?', [code, id]);
                }
                const createdIds = Array.from({ length: count }, (_, index) => startId + index).filter((id) => Number.isFinite(id) && id > 0);
                if (createdIds.length) {
                  await syncReservationTasksForIds(conn, createdIds);
                }
              } catch (_) { /* ignore legacy schema */ }
            }
            details.reservations_granted = true;
            await conn.query('UPDATE orders SET details = ? WHERE id = ?', [JSON.stringify(details), orderId]);
          }

          // 若有使用既有票券，標記為已使用
          const ticketsUsed = Array.isArray(details.ticketsUsed) ? details.ticketsUsed : [];
          if (!details.tickets_marked && ticketsUsed.length > 0) {
            const ids = validatedTicketIds;
            if (ids.length) {
              const placeholders = ids.map(() => '?').join(',');
              const [upd] = await conn.query(
                `UPDATE tickets SET used = 1
                 WHERE user_id = ?
                   AND used = 0
                   AND (expiry IS NULL OR expiry > CURRENT_DATE())
                   AND id IN (${placeholders})`,
                [req.user.id, ...ids]
              );
              if (Number(upd.affectedRows || 0) !== ids.length) {
                const err = new Error('票券狀態已變更，請重新選擇票券');
                err.code = 'TICKET_USE_CONFLICT';
                throw err;
              }
              details.tickets_marked = true;
              await conn.query('UPDATE orders SET details = ? WHERE id = ?', [JSON.stringify(details), orderId]);
            }
          }
        } catch (e) {
          // 若自動完成副作用失敗，回報錯誤讓用戶重試（不部分成功）
          throw e;
        }
      }
    }

    try { await conn.query('DELETE FROM user_carts WHERE user_id = ?', [req.user.id]); } catch (_) {}

    await conn.commit();
    // Email / LINE 通知（最佳努力）
    try {
      if (createdSummaries.length) {
        const remittance = (createdSummaries.find(c => c.remittance && Object.keys(c.remittance || {}).length) || {}).remittance || defaultRemittanceDetails();
        const contact = await getUserContact(req.user.id);
        const targetEmail = (contact.email || req.user?.email || '').trim();
        const targetName = contact.username || req.user?.username || '';
        await sendOrderNotificationEmail({
          to: targetEmail,
          username: targetName,
          orders: createdSummaries,
          type: 'created',
          userId: req.user.id,
          lineMessages: buildOrderCreatedFlex(createdSummaries, remittance)
        });
      }
    } catch (_) {}
    return ok(res, created, '訂單建立成功');
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    if (err?.code === 'INVALID_TICKETS') {
      return fail(res, 'TICKETS_UNUSABLE', '包含已過期或不可用的票券，請重新確認', 400);
    }
    if (err?.code === 'TICKET_USE_CONFLICT') {
      return fail(res, 'TICKET_USE_CONFLICT', err.message || '票券狀態已變更，請重新選擇', 409);
    }
    if (err?.code === 'ORDER_REMITTANCE_STORE_NOT_FOUND') {
      return fail(res, 'ORDER_REMITTANCE_STORE_NOT_FOUND', err.message || '部分店面資料不存在，請重新整理後再試', 400);
    }
    if (err?.code === 'ORDER_REMITTANCE_UNSET') {
      return fail(res, 'ORDER_REMITTANCE_UNSET', err.message || '尚未設定可用的匯款資訊', 400);
    }
    if (err?.code === 'ORDER_REMITTANCE_MIXED') {
      return fail(res, 'ORDER_REMITTANCE_MIXED', err.message || '本次選擇包含不同匯款資訊的店面，請分開下單', 400);
    }
    if ([
      'ORDER_SERVICE_SELECTION_REQUIRED',
      'ORDER_SERVICE_SELECTION_NOT_FOUND',
      'ORDER_SERVICE_SELECTION_EVENT_MISMATCH',
      'ORDER_SERVICE_SELECTION_INACTIVE',
      'ORDER_SERVICE_SELECTION_DELIVERY_POINT_MISMATCH',
      'ORDER_PRE_SERVICE_DISABLED',
      'ORDER_POST_SERVICE_DISABLED',
      'ORDER_SERVICE_PRICES_MISSING',
      'ORDER_SERVICE_PRICE_ITEM_INVALID',
    ].includes(err?.code)) {
      return fail(res, err.code, err.message || '交車點服務設定驗證失敗', 400);
    }
    if (err?.code === 'ORDER_PRICE_CHANGED') {
      return fail(res, 'ORDER_PRICE_CHANGED', err.message || '價格已更新，請重新整理後再試', 409);
    }
    console.error('[orders] create failed', {
      userId: req.user?.id,
      code: err?.code,
      message: err?.message,
      stack: err?.stack,
      itemsCount: Array.isArray(items) ? items.length : null,
    });
    return fail(res, 'ORDER_CREATE_FAIL', err.message, 500);
  } finally {
    conn.release();
  }
});

// Admin Remittance Settings
router.get('/provider/remittance', serviceProviderOnly, async (req, res) => {
  try {
    const data = await getProviderRemittanceConfig(req.user.id);
    return ok(res, data);
  } catch (err) {
    return fail(res, 'PROVIDER_REMITTANCE_GET_FAIL', err.message || '讀取匯款資訊失敗', 500);
  }
});

router.patch('/provider/remittance', serviceProviderOnly, async (req, res) => {
  try {
    const data = await saveProviderRemittanceConfig(req.user.id, req.body || {});
    return ok(res, data, '匯款資訊已更新');
  } catch (err) {
    if (err?.code === 'PROVIDER_NOT_FOUND') {
      return fail(res, 'PROVIDER_NOT_FOUND', err.message || '找不到服務商帳號', 404);
    }
    return fail(res, 'PROVIDER_REMITTANCE_UPDATE_FAIL', err.message || '更新匯款資訊失敗', 500);
  }
});

router.get('/admin/remittance', adminOnly, async (req, res) => {
  try {
    const data = await loadRemittanceConfig();
    return ok(res, data);
  } catch (err) {
    return fail(res, 'ADMIN_REMITTANCE_GET_FAIL', err.message || '讀取匯款資訊失敗', 500);
  }
});

router.patch('/admin/remittance', adminOnly, async (req, res) => {
  try {
    const body = req.body || {};
    let info = typeof body.info === 'string' ? body.info.trim() : '';
    let bankCode = typeof body.bankCode === 'string' ? body.bankCode.trim() : '';
    let bankAccount = typeof body.bankAccount === 'string' ? body.bankAccount.trim() : '';
    let accountName = typeof body.accountName === 'string' ? body.accountName.trim() : '';
    let bankName = typeof body.bankName === 'string' ? body.bankName.trim() : '';

    if (info.length > 600) info = info.slice(0, 600);
    if (bankCode.length > 32) bankCode = bankCode.slice(0, 32);
    if (bankAccount.length > 64) bankAccount = bankAccount.slice(0, 64);
    if (accountName.length > 64) accountName = accountName.slice(0, 64);
    if (bankName.length > 64) bankName = bankName.slice(0, 64);

    const entries = [
      { key: REMITTANCE_SETTING_KEYS.info, value: info },
      { key: REMITTANCE_SETTING_KEYS.bankCode, value: bankCode },
      { key: REMITTANCE_SETTING_KEYS.bankAccount, value: bankAccount },
      { key: REMITTANCE_SETTING_KEYS.accountName, value: accountName },
      { key: REMITTANCE_SETTING_KEYS.bankName, value: bankName },
    ];

    for (const { key, value } of entries) {
      if (value && value.length) await setAppSetting(key, value);
      else await deleteAppSetting(key);
    }

    const data = await loadRemittanceConfig();
    return ok(res, data, '匯款資訊已更新');
  } catch (err) {
    return fail(res, 'ADMIN_REMITTANCE_UPDATE_FAIL', err.message || '更新匯款資訊失敗', 500);
  }
});

router.get('/admin/site_pages', adminOnly, async (req, res) => {
  try {
    const data = await getSitePages();
    return ok(res, data);
  } catch (err) {
    return fail(res, 'ADMIN_SITE_PAGES_GET_FAIL', err.message || '讀取頁面內容失敗', 500);
  }
});

router.patch('/admin/site_pages', adminOnly, async (req, res) => {
  try {
    const body = req.body || {};
    let terms = typeof body.terms === 'string' ? body.terms : '';
    let privacy = typeof body.privacy === 'string' ? body.privacy : '';
    let notice = typeof body.reservationNotice === 'string' ? body.reservationNotice : '';
    let rules = typeof body.reservationRules === 'string' ? body.reservationRules : '';

    const limit = 20000;
    if (terms.length > limit) terms = terms.slice(0, limit);
    if (privacy.length > limit) privacy = privacy.slice(0, limit);
    if (notice.length > limit) notice = notice.slice(0, limit);
    if (rules.length > limit) rules = rules.slice(0, limit);

    const entries = [
      { key: SITE_PAGE_KEYS.terms, value: terms },
      { key: SITE_PAGE_KEYS.privacy, value: privacy },
      { key: SITE_PAGE_KEYS.reservationNotice, value: notice },
      { key: SITE_PAGE_KEYS.reservationRules, value: rules },
    ];

    for (const { key, value } of entries) {
      if (value && value.length) await setAppSetting(key, value);
      else await deleteAppSetting(key);
    }

    const data = await getSitePages();
    return ok(res, data, '頁面內容已更新');
  } catch (err) {
    return fail(res, 'ADMIN_SITE_PAGES_UPDATE_FAIL', err.message || '更新頁面內容失敗', 500);
  }
});

router.get('/admin/reservation_checklists', adminOnly, (req, res) => {
  try {
    const data = getReservationChecklistDefinitions();
    return ok(res, data);
  } catch (err) {
    return fail(res, 'ADMIN_RESERVATION_CHECKLISTS_GET_FAIL', err?.message || '讀取檢核項目失敗', 500);
  }
});

router.patch('/admin/reservation_checklists', adminOnly, async (req, res) => {
  try {
    const body = req.body || {};
    if (body && body.reset === true) {
      const data = await persistReservationChecklistDefinitions(DEFAULT_RESERVATION_CHECKLIST_DEFINITIONS);
      return ok(res, data, '檢核項目已重置');
    }
    const definitions = body.definitions && typeof body.definitions === 'object'
      ? body.definitions
      : body;
    const data = await persistReservationChecklistDefinitions(definitions);
    return ok(res, data, '檢核項目已更新');
  } catch (err) {
    return fail(res, 'ADMIN_RESERVATION_CHECKLISTS_UPDATE_FAIL', err?.message || '更新檢核項目失敗', 500);
  }
});

router.get('/app/reservation_checklists', (req, res) => {
  try {
    const data = getReservationChecklistDefinitions();
    return ok(res, data);
  } catch (err) {
    return fail(res, 'RESERVATION_CHECKLISTS_GET_FAIL', err?.message || '讀取檢核項目失敗', 500);
  }
});

router.get('/pages/:slug', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    const slugMap = {
      terms: 'terms',
      privacy: 'privacy',
      'reservation-notice': 'reservationNotice',
      'reservation-rules': 'reservationRules',
    };
    const key = slugMap[slug];
    if (!key) return fail(res, 'PAGE_NOT_FOUND', '未找到頁面', 404);
    const pages = await getSitePages();
    const content = pages[key] || '';
    return ok(res, { slug, content });
  } catch (err) {
    return fail(res, 'PAGE_FETCH_FAIL', err.message || '頁面讀取失敗', 500);
  }
});

// Admin Orders
router.get('/admin/orders', serviceProviderOnly, async (req, res) => {
  try {
    const defaultLimit = 50;
    const limit = parsePositiveInt(req.query.limit, defaultLimit, { min: 1, max: 200 });
    const offsetRaw = req.query.offset ?? req.query.skip ?? 0;
    const offset = Math.max(0, parsePositiveInt(offsetRaw, 0, { min: 0 }));
    const queryRaw = String(req.query.q || req.query.query || '').trim();
    const searchTerm = queryRaw ? `%${queryRaw}%` : null;

    const baseFrom = 'FROM orders o JOIN users u ON u.id = o.user_id';

    const where = [];
    const params = [];
    if (searchTerm) {
      where.push(
        `(o.code LIKE ? OR u.username LIKE ? OR u.email LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(o.details, '$.ticketType')) LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(o.details, '$.event.name')) LIKE ? OR CAST(o.id AS CHAR) LIKE ?)`
      );
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const isAdmin = isADMIN(req.user.role);
    let total = 0;
    let items = [];

    if (isAdmin) {
      const countSql = `SELECT COUNT(*) AS total ${baseFrom} ${whereSql}`;
      const [[countRow]] = await pool.query(countSql, params);
      total = Number(countRow?.total || 0);

      const listSql = `SELECT o.id, o.code, o.details, o.created_at, u.id AS user_id, u.username, u.email, u.phone, u.remittance_last5 ${baseFrom} ${whereSql} ORDER BY o.id DESC LIMIT ? OFFSET ?`;
      const [rows] = await pool.query(listSql, [...params, limit, offset]);
      items = await Promise.all(rows.map(async (row) => ({
        id: row.id,
        code: row.code || '',
        created_at: row.created_at || null,
        user_id: row.user_id,
        username: row.username || '',
        email: row.email || '',
        phone: row.phone == null ? null : String(row.phone),
        remittance_last5: row.remittance_last5 == null ? null : String(row.remittance_last5),
        details: normalizeOrderDetailsForPayment(await hydrateOrderRemittance(safeParseJSON(row.details, {}))),
      })));
    } else {
      const listSql = `SELECT o.id, o.code, o.details, o.created_at, u.id AS user_id, u.username, u.email, u.phone, u.remittance_last5 ${baseFrom} ${whereSql} ORDER BY o.id DESC`;
      const [rows] = await pool.query(listSql, params);
      const providerFiltered = [];
      for (const row of (await Promise.all(rows.map(async (source) => ({
        ...source,
        _details: normalizeOrderDetailsForPayment(await hydrateOrderRemittance(safeParseJSON(source.details, {}))),
      }))))) {
        if (await providerCanManageOrder(pool, row._details, req.user.id)) {
          providerFiltered.push(row);
        }
      }
      total = providerFiltered.length;
      items = providerFiltered.slice(offset, offset + limit).map((row) => ({
        id: row.id,
        code: row.code || '',
        created_at: row.created_at || null,
        user_id: row.user_id,
        username: row.username || '',
        email: row.email || '',
        phone: row.phone == null ? null : String(row.phone),
        remittance_last5: row.remittance_last5 == null ? null : String(row.remittance_last5),
        details: row._details,
      }));
    }

    return ok(res, {
      items,
      meta: {
        total,
        limit,
        offset,
        hasMore: offset + items.length < total,
        query: queryRaw,
      },
    });
  } catch (err) {
    return fail(res, 'ADMIN_ORDERS_LIST_FAIL', err.message, 500);
  }
});

router.patch('/admin/orders/:id/status', serviceProviderOnly, async (req, res) => {
  const body = req.body || {};
  const requestedStatus = normalizeOrderPaymentStatus(body.status);
  if (!ORDER_PAYMENT_STATUSES.includes(requestedStatus)) return fail(res, 'VALIDATION_ERROR', '不支援的狀態', 400);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query('SELECT * FROM orders WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows.length) {
      await conn.rollback();
      return fail(res, 'ORDER_NOT_FOUND', '找不到訂單', 404);
    }
    const order = rows[0];
    const details = normalizeOrderDetailsForPayment(await hydrateOrderRemittance(safeParseJSON(order.details, {})));
    const isReservationOrder = isReservationOrderDetails(details);
    if (!isADMIN(req.user.role)) {
      if (!(await providerCanManageOrder(conn, details, req.user.id))) {
        await conn.rollback();
        return fail(res, 'FORBIDDEN', '無權限操作此訂單', 403);
      }
    }
    const prevStatus = details.status || '';
    const wasPaid = isOrderPaidStatus(prevStatus);
    const orderEventName = details?.event?.name || details?.event || null;
    const selections = Array.isArray(details.selections) ? details.selections : [];
    const createdReservationIds = [];
    const newlyIssuedTickets = [];
    let reservationQuantityForOrder = selections.reduce((sum, sel) => sum + Number(sel.qty || sel.quantity || 0), 0);
    let targetStatus = requestedStatus;
    delete details.driver;
    delete details.driverId;
    delete details.driver_id;

    // 更新 details.status
    details.status = targetStatus;
    await conn.query('UPDATE orders SET details = ? WHERE id = ?', [JSON.stringify(details), order.id]);

    const ticketsUsed = Array.isArray(details.ticketsUsed) ? details.ticketsUsed : [];
    const needsPaidSideEffects = isReservationOrder
      ? !details.reservations_granted || (!details.tickets_marked && ticketsUsed.length > 0)
      : !details.granted || (!details.tickets_marked && ticketsUsed.length > 0);

    // 進入「已付款」後，進行發券、建立預約與標記已用票券（避免重複發放/重複標記）
    if (isOrderPaidStatus(targetStatus) && (!wasPaid || needsPaidSideEffects)) {
      // 發券（僅限非預約型的「票券型訂單」）
      if (!isReservationOrder) {
        const ticketType = details.ticketType || details?.event?.name || null;
          const quantity = Number(details.quantity || 0);
          if (!details.granted && ticketType && quantity > 0) {
            const today = new Date();
            const expiry = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());
            const expiryStr = formatDateYYYYMMDD(expiry);
            const productId = normalizePositiveInt(details.productId ?? details.product_id ?? details.product?.id);
            const hasTicketProductId = await ensureTicketProductIdColumn(conn);
            const values = [];
            const ticketMeta = [];
            for (let i = 0; i < quantity; i++) {
              const uuid = randomUUID();
              values.push(hasTicketProductId
                ? [order.user_id, ticketType, productId || null, expiryStr, uuid, 0, 0]
                : [order.user_id, ticketType, expiryStr, uuid, 0, 0]);
              ticketMeta.push({ uuid, expiry: expiryStr, type: ticketType, product_id: productId || null });
            }
            if (values.length) {
              const [ins3] = await conn.query(
                hasTicketProductId
                  ? 'INSERT INTO tickets (user_id, type, product_id, expiry, uuid, discount, used) VALUES ?;'
                  : 'INSERT INTO tickets (user_id, type, expiry, uuid, discount, used) VALUES ?;',
                [values]
              );
            // Log issuance per ticket
            try {
              const firstId = Number(ins3.insertId || 0);
              const count = Number(ins3.affectedRows || values.length);
              for (let i = 0; i < count; i++) {
                const tid = firstId ? (firstId + i) : null;
                const meta = ticketMeta[i] || {};
                newlyIssuedTickets.push({ id: tid, ...meta });
                if (tid) await logTicket({ conn, ticketId: tid, userId: order.user_id, action: 'issued', meta: { type: ticketType, order_id: order.id, order_code: order.code } });
              }
            } catch (_) { /* ignore */ }
            details.granted = true;
            await conn.query('UPDATE orders SET details = ? WHERE id = ?', [JSON.stringify(details), order.id]);
          }
        }
      }

      // 建立預約（針對含 selections 的預約型訂單）
      if (!details.reservations_granted && isReservationOrder) {
        const { reservationRows, serviceSelection } = await buildReservationRowsForOrder(conn, {
          userId: order.user_id,
          orderId: order.id,
          details: { ...details, event: details.event || orderEventName },
        });
        details.serviceSelection = {
          storeId: serviceSelection.storeId,
          deliveryPointId: serviceSelection.deliveryPointId,
          storeName: serviceSelection.storeName,
        };
        if (reservationRows.length) {
          const [ins2] = await insertReservationsBulk(conn, reservationRows);
          // Best-effort: seed pre_dropoff verification codes for newly created reservations
          try {
            const startId = Number(ins2.insertId || 0);
            const count = Number(ins2.affectedRows || 0);
            for (let i = 0; i < count; i++) {
              const id = startId + i;
              createdReservationIds.push(id);
              const code = await generateReservationStageCode(conn);
              await conn.query('UPDATE reservations SET verify_code_pre_dropoff = COALESCE(verify_code_pre_dropoff, ?) WHERE id = ?', [code, id]);
            }
            if (createdReservationIds.length) {
              await syncReservationTasksForIds(conn, createdReservationIds);
            }
          } catch (_) { /* ignore legacy schema */ }
          details.reservations_granted = true;
          await conn.query('UPDATE orders SET details = ? WHERE id = ?', [JSON.stringify(details), order.id]);
        }
      }

      // 若使用既有票券（ticketsUsed），在此一次性標記為已使用
      const ticketsUsed = Array.isArray(details.ticketsUsed) ? details.ticketsUsed : [];
      if (!details.tickets_marked && ticketsUsed.length > 0) {
        const ids = await validateTicketsUsable(conn, order.user_id, ticketsUsed, details);
        if (ids.length) {
          const placeholders = ids.map(() => '?').join(',');
          const [upd] = await conn.query(
            `UPDATE tickets SET used = 1
             WHERE user_id = ?
               AND used = 0
               AND (expiry IS NULL OR expiry > CURRENT_DATE())
               AND id IN (${placeholders})`,
            [order.user_id, ...ids]
          );
          if (Number(upd.affectedRows || 0) !== ids.length) {
            const err = new Error('票券狀態已變更，請重新選擇');
            err.code = 'TICKET_USE_CONFLICT';
            throw err;
          }
          details.tickets_marked = true;
          await conn.query('UPDATE orders SET details = ? WHERE id = ?', [JSON.stringify(details), order.id]);
        }
      }
    }

    await conn.commit();
    // 狀態更新通知（Email / LINE）
    try {
      const shouldSendPaymentNotification = isOrderPaidStatus(targetStatus)
        && !wasPaid
        && details.paymentNotified !== true
        && details.completionNotified !== true;
      if (shouldSendPaymentNotification) {
        let reservationContexts = [];
        try {
          if (createdReservationIds.length) {
            reservationContexts = await fetchReservationsContext(createdReservationIds);
          } else if (!createdReservationIds.length) {
            const fallbackIds = (await listReservationsByOrderId(pool, order.id))
              .map((row) => Number(row.id))
              .filter((id) => Number.isFinite(id) && id > 0);
            if (fallbackIds.length) {
              reservationContexts = await fetchReservationsContext(fallbackIds);
            } else if (reservationQuantityForOrder > 0 && orderEventName) {
              const [rowsCtx] = await pool.query(
                'SELECT id FROM reservations WHERE user_id = ? AND event = ? ORDER BY id DESC LIMIT ?',
                [order.user_id, orderEventName, reservationQuantityForOrder]
              );
              const legacyFallbackIds = rowsCtx.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
              if (legacyFallbackIds.length) {
                reservationContexts = await fetchReservationsContext(legacyFallbackIds);
              }
            }
          }
        } catch (err) {
          console.error('reservation context fetch error:', err?.message || err);
        }

        let completionNotice = null;
        completionNotice = composeReservationPaymentContent({
          contexts: reservationContexts,
          tickets: newlyIssuedTickets,
          orderSummary: { ...details, total: Number(details.total || 0) },
        });

        const contact = await getUserContact(order.user_id);
        const targetEmail = (contact.email || '').trim();
        const summary = [{
          id: order.id,
          code: order.code,
          total: Number(details.total || 0),
          status: details.status,
          remittance: details.remittance,
          detailsSummary: summarizeOrderDetails(details),
          detailsRaw: details,
        }];
        const linePayloads = [];
        if (completionNotice?.lineMessages?.length) {
          const arr = Array.isArray(completionNotice.lineMessages)
            ? completionNotice.lineMessages
            : [completionNotice.lineMessages];
          linePayloads.push(...arr);
        }
        linePayloads.push(buildOrderDoneFlex({ code: order.code, detailsRaw: details }));
        await sendOrderNotificationEmail({
          to: targetEmail,
          username: contact.username || '',
          orders: summary,
          type: 'completed',
          userId: order.user_id,
          lineMessages: linePayloads.length ? (linePayloads.length === 1 ? linePayloads[0] : linePayloads) : undefined,
          emailSubject: completionNotice?.emailSubject,
          emailHtml: completionNotice?.emailHtml,
        });
        details.paymentNotified = true;
        details.completionNotified = true;
        await pool.query('UPDATE orders SET details = ? WHERE id = ?', [JSON.stringify(details), order.id]);
      }
    } catch (_) {}
    return ok(res, null, '狀態已更新');
  } catch (err) {
    try { await conn.rollback(); } catch (_) { }
    if (err?.code === 'INVALID_TICKETS') {
      return fail(res, 'TICKETS_UNUSABLE', '包含已過期或不可用的票券，請重新確認', 400);
    }
    if (err?.code === 'TICKET_USE_CONFLICT') {
      return fail(res, 'TICKET_USE_CONFLICT', err.message || '票券狀態已變更，請重新選擇', 409);
    }
    if ([
      'ORDER_SERVICE_SELECTION_REQUIRED',
      'ORDER_SERVICE_SELECTION_NOT_FOUND',
      'ORDER_SERVICE_SELECTION_EVENT_MISMATCH',
      'ORDER_SERVICE_SELECTION_INACTIVE',
      'ORDER_SERVICE_SELECTION_DELIVERY_POINT_MISMATCH',
      'ORDER_PRE_SERVICE_DISABLED',
      'ORDER_POST_SERVICE_DISABLED',
    ].includes(err?.code)) {
      return fail(res, err.code, err.message || '交車點服務設定驗證失敗', 400);
    }
    return fail(res, 'ADMIN_ORDER_STATUS_FAIL', err.message, 500);
  } finally {
    conn.release();
  }
});

  return router;
}

module.exports = buildOrderRoutes;
