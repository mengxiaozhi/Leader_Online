const express = require('express');
const { createHash, randomUUID } = require('crypto');
const { buildProviderOrderAccessIndex } = require('../services/provider-order-access');

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
    invalidateEventStoresCache,
    invalidateEventCaches,
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
    normalizeSiteSocialLinks,
    ensureUserContactInfoReady,
    ensureOrderIdempotencyTable,
    formatDateYYYYMMDD,
    logTicket,
    ensureTicketProductIdColumn,
    ensureProductManagementSchema,
    setAppSetting,
    deleteAppSetting,
    loadRemittanceConfig,
    getOrderEmailCcConfig,
    saveOrderEmailCcConfig,
    getProviderRemittanceConfig,
    saveProviderRemittanceConfig,
    getProviderServiceTerms,
    saveProviderServiceTerms,
    listProviderServiceTerms,
    getSitePages,
    DEFAULT_RESERVATION_CHECKLIST_DEFINITIONS,
    isADMIN,
    isSERVICE_PROVIDER,
    getUserContact,
    fetchReservationsContext,
    syncReservationTasksForIds,
    normalizeEventServicePriceMap,
    assertReservationCapacityAvailable,
    normalizeUserId,
    ensureEventDriverAssignmentsTable,
    ensureEventExclusiveColumn,
    isPublishedListingStatus,
  } = ctx;

  const ORDER_STATUS_REMITTANCE_PENDING = '待匯款';
  const ORDER_STATUS_PROCESSING = '處理中';
  const ORDER_STATUS_PAID = '已付款';
  const ORDER_STATUS_CANCELLED = '已取消';
  const ORDER_STATUS_PAID_LEGACY = '已完成';
  const ORDER_STATUS_ASSIGNMENT_LEGACY = '待指派';
  const ORDER_PAYMENT_STATUSES = [ORDER_STATUS_REMITTANCE_PENDING, ORDER_STATUS_PROCESSING, ORDER_STATUS_PAID, ORDER_STATUS_CANCELLED];

  function normalizeOrderPaymentStatus(value = '') {
    const status = String(value || '').trim();
    if (status === ORDER_STATUS_PAID_LEGACY || status === ORDER_STATUS_ASSIGNMENT_LEGACY) return ORDER_STATUS_PAID;
    return status;
  }

  const ADMIN_ORDER_STATUS_SQL = `CASE
    WHEN JSON_UNQUOTE(JSON_EXTRACT(o.details, '$.status')) IN ('${ORDER_STATUS_PAID_LEGACY}', '${ORDER_STATUS_ASSIGNMENT_LEGACY}') THEN '${ORDER_STATUS_PAID}'
    WHEN NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(o.details, '$.status'))), '') IS NULL THEN '${ORDER_STATUS_PROCESSING}'
    ELSE JSON_UNQUOTE(JSON_EXTRACT(o.details, '$.status'))
  END`;

  function readAdminQueryText(req, ...names) {
    for (const name of names) {
      const value = req.query?.[name];
      const first = Array.isArray(value) ? value[0] : value;
      const text = String(first ?? '').trim();
      if (text) return text;
    }
    return '';
  }

  function readAdminQueryList(req, ...names) {
    const values = [];
    for (const name of names) {
      const raw = req.query?.[name];
      for (const item of (Array.isArray(raw) ? raw : [raw])) {
        if (item == null) continue;
        values.push(...String(item).split(',').map((entry) => entry.trim()).filter(Boolean));
      }
    }
    return Array.from(new Set(values));
  }

  function readAdminDate(req, ...names) {
    const text = readAdminQueryText(req, ...names);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
    const date = new Date(`${text}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : '';
  }

  function appendAdminOrderFilters(req, where, params) {
    const id = readAdminQueryText(req, 'id');
    const code = readAdminQueryText(req, 'code');
    const user = readAdminQueryText(req, 'user');
    const content = readAdminQueryText(req, 'content');
    const statuses = readAdminQueryList(req, 'statuses', 'statuses[]', 'status')
      .map(normalizeOrderPaymentStatus)
      .filter((status) => ORDER_PAYMENT_STATUSES.includes(status));
    const createdFrom = readAdminDate(req, 'createdFrom', 'created_from');
    const createdTo = readAdminDate(req, 'createdTo', 'created_to');

    if (id) {
      where.push('CAST(o.id AS CHAR) LIKE ?');
      params.push(`%${id}%`);
    }
    if (code) {
      where.push('o.code LIKE ?');
      params.push(`%${code}%`);
    }
    if (user) {
      where.push('(u.username LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR u.remittance_last5 LIKE ? OR CAST(o.user_id AS CHAR) LIKE ?)');
      params.push(`%${user}%`, `%${user}%`, `%${user}%`, `%${user}%`, `%${user}%`);
    }
    if (content) {
      where.push('CAST(o.details AS CHAR) LIKE ?');
      params.push(`%${content}%`);
    }
    if (statuses.length) {
      where.push(`${ADMIN_ORDER_STATUS_SQL} IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }
    if (createdFrom) {
      where.push('o.created_at >= ?');
      params.push(createdFrom);
    }
    if (createdTo) {
      where.push('o.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
      params.push(createdTo);
    }
  }

  function buildAdminOrderSummary(entries = []) {
    const byStatus = Object.fromEntries(ORDER_PAYMENT_STATUSES.map((status) => [status, 0]));
    let total = 0;
    for (const entry of entries) {
      const status = normalizeOrderPaymentStatus(entry?.status || ORDER_STATUS_PROCESSING) || ORDER_STATUS_PROCESSING;
      const count = Number(entry?.count ?? 1) || 0;
      byStatus[status] = Number(byStatus[status] || 0) + count;
      total += count;
    }
    return { total, byStatus, ...byStatus };
  }

  function invalidateOrderEventCapacity(details = {}) {
    const eventId = normalizePositiveInt(details?.event?.id ?? details?.event_id ?? details?.eventId);
    if (!eventId) return;
    invalidateEventStoresCache(eventId);
    invalidateEventCaches(eventId);
  }

  function isOrderPaidStatus(value = '') {
    return normalizeOrderPaymentStatus(value) === ORDER_STATUS_PAID;
  }

  function normalizeExternalSiteUrl(value, limit = 1000) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) return '';
    return text.length > limit ? text.slice(0, limit) : text;
  }

  function isAllowedExternalSiteUrl(value) {
    if (!value) return true;
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  function hasSocialLinkValue(item = {}) {
    return !!String(item?.label || item?.name || item?.platform || item?.url || item?.href || '').trim();
  }

  function findInvalidSocialLink(input = []) {
    const list = Array.isArray(input) ? input : [];
    return list.find((item) => {
      if (!hasSocialLinkValue(item)) return false;
      const url = normalizeExternalSiteUrl(item?.url || item?.href || '');
      return !url || !isAllowedExternalSiteUrl(url);
    }) || null;
  }

  function normalizeEventExclusiveFlag(value) {
    if (value === undefined || value === null || value === '') return 0;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'number') return value !== 0 ? 1 : 0;
    const normalized = String(value).trim().toLowerCase();
    return ['1', 'true', 'yes', 'y', 'on'].includes(normalized) ? 1 : 0;
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
    if (expectation.productId) return ticketProductId === expectation.productId;
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
      providerUserId: normalizeUserId(source.providerUserId ?? source.provider_user_id ?? source.owner_user_id),
    };
  }

  async function ensureTicketProductPublished(connOrPool, details = {}) {
    const productId = normalizePositiveInt(details.productId ?? details.product_id ?? details.product?.id);
    const ticketType = String(details.ticketType || details?.product?.name || details?.event?.name || '').trim();
    if (!productId && !ticketType) {
      const err = new Error('缺少票券商品，請重新選擇');
      err.code = 'ORDER_PRODUCT_NOT_FOUND';
      throw err;
    }
    try {
      await ensureProductManagementSchema();
      const params = [];
      let where = '';
      if (productId) {
        where = 'id = ?';
        params.push(productId);
      } else {
        where = 'name = ?';
        params.push(ticketType);
      }
      const [rows] = await connOrPool.query(
        `SELECT id, name, price, owner_user_id, listing_status FROM products WHERE ${where} LIMIT 1`,
        params
      );
      const product = rows?.[0] || null;
      if (!product) {
        const err = new Error('票券商品不存在，請重新選擇');
        err.code = 'ORDER_PRODUCT_NOT_FOUND';
        throw err;
      }
      if (!isPublishedListingStatus(product.listing_status)) {
        const err = new Error('此票券商品尚未發布，請重新選擇');
        err.code = 'ORDER_PRODUCT_NOT_PUBLISHED';
        throw err;
      }
      return product;
    } catch (err) {
      if (['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(err?.code)) {
        const unavailable = new Error('票券商品資料暫時無法驗證');
        unavailable.code = 'ORDER_PRODUCT_VALIDATION_UNAVAILABLE';
        throw unavailable;
      }
      throw err;
    }
  }

  function applyTicketOrderPricing(details = {}, product = {}) {
    const quantity = Number(details.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
      const err = new Error('票券數量必須為 1 至 99 的整數');
      err.code = 'ORDER_TICKET_QUANTITY_INVALID';
      throw err;
    }
    const unitPrice = roundMoney(product.price);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      const err = new Error('票券商品價格設定錯誤');
      err.code = 'ORDER_PRODUCT_PRICE_INVALID';
      throw err;
    }
    const total = roundMoney(unitPrice * quantity);
    details.productId = Number(product.id);
    details.product_id = Number(product.id);
    details.ticketType = String(product.name || '').trim();
    details.providerUserId = normalizeUserId(product.owner_user_id);
    details.provider_user_id = normalizeUserId(product.owner_user_id);
    details.quantity = quantity;
    details.unitPrice = unitPrice;
    details.subtotal = total;
    details.discount = 0;
    details.total = total;
    return details;
  }

  async function fetchEventServiceRows(connOrPool, storeIds = []) {
    const ids = Array.from(new Set((Array.isArray(storeIds) ? storeIds : [storeIds])
      .map((value) => normalizePositiveInt(value))
      .filter((value) => Number.isFinite(value) && value > 0)));
    if (!ids.length) return new Map();
    await ensureEventExclusiveColumn();
    const placeholders = ids.map(() => '?').join(',');
    let rows = [];
    try {
      [rows] = await connOrPool.query(
        `SELECT s.id, s.event_id, s.owner_user_id, s.delivery_point_id, s.name, s.is_active, s.pre_enabled, s.post_enabled, s.prices,
                e.deadline AS event_deadline, e.owner_user_id AS event_owner_user_id, e.is_exclusive AS event_is_exclusive,
                e.listing_status AS event_listing_status
           FROM event_stores s
           LEFT JOIN events e ON e.id = s.event_id
          WHERE s.id IN (${placeholders})`,
        ids
      );
    } catch (err) {
      if (err?.code !== 'ER_BAD_FIELD_ERROR') throw err;
      [rows] = await connOrPool.query(
        `SELECT s.id, s.event_id, s.delivery_point_id, s.name, s.is_active, s.pre_enabled, s.post_enabled, s.prices,
                e.deadline AS event_deadline, e.owner_user_id AS event_owner_user_id, 0 AS event_is_exclusive,
                'published' AS event_listing_status
           FROM event_stores s
           LEFT JOIN events e ON e.id = s.event_id
          WHERE s.id IN (${placeholders})`,
        ids
      );
    }
    return (Array.isArray(rows) ? rows : []).reduce((map, row) => {
      const id = normalizePositiveInt(row.id);
      if (!id) return map;
      map.set(id, row);
      return map;
    }, new Map());
  }

  function normalizeSelectionQuantity(sel = {}) {
    const qty = Math.floor(Number(sel.qty || sel.quantity || 0));
    return Number.isFinite(qty) && qty > 0 ? qty : 0;
  }

  function summarizeServiceSelections(items = [], fallback = '') {
    const names = Array.from(new Set((Array.isArray(items) ? items : [])
      .map((item) => String(item.storeName || item.store || '').trim())
      .filter(Boolean)));
    if (names.length <= 3) return names.join('、') || fallback || '';
    return `${names.slice(0, 3).join('、')} 等 ${names.length} 個交車點`;
  }

  function applyResolvedServiceSelectionDetails(details = {}, resolved = {}) {
    const serviceSelections = Array.isArray(resolved.serviceSelections) ? resolved.serviceSelections : [];
    details.serviceSelections = serviceSelections.map((item) => ({
      storeId: item.storeId || null,
      deliveryPointId: item.deliveryPointId || null,
      storeName: item.storeName || '',
      providerUserId: item.providerUserId || null,
      provider_user_id: item.providerUserId || null,
      quantity: item.quantity || 0,
    }));
    details.storeSummary = resolved.storeSummary || summarizeServiceSelections(serviceSelections, details.storeSummary);
    details.serviceSelection = {
      storeId: resolved.storeId || null,
      deliveryPointId: resolved.deliveryPointId || null,
      storeName: resolved.storeName || details.storeSummary || '',
      providerUserId: resolved.providerUserId || null,
      provider_user_id: resolved.providerUserId || null,
    };
    return details;
  }

  async function resolveOrderServiceSelection(connOrPool, details = {}) {
    const eventId = normalizePositiveInt(details?.event?.id ?? details?.event_id ?? details?.eventId);
    const base = readOrderServiceSelection(details);
    const fallbackStoreId = normalizePositiveInt(details?.storeId ?? details?.store_id);
    const selections = Array.isArray(details.selections) ? details.selections : [];
    const serviceSelectionFallbacks = Array.isArray(details.serviceSelections) ? details.serviceSelections : [];
    const selectionStoreIds = extractSelectionStoreIds(details);
    const legacyStoreIds = Array.from(new Set([
      base.storeId,
      base.legacyPreStoreId,
      base.legacyPostStoreId,
      fallbackStoreId,
    ].filter((value) => Number.isFinite(value) && value > 0)));
    const storeIds = selectionStoreIds.length ? selectionStoreIds : legacyStoreIds;
    if (!storeIds.length) {
      const err = new Error('請先選擇交車點');
      err.code = 'ORDER_SERVICE_SELECTION_REQUIRED';
      throw err;
    }
    if (!selectionStoreIds.length && storeIds.length > 1) {
      const err = new Error('賽前與賽後已改為單一交車點，請重新選擇');
      err.code = 'ORDER_SERVICE_SELECTION_DELIVERY_POINT_MISMATCH';
      throw err;
    }
    const storeMap = await fetchEventServiceRows(connOrPool, storeIds);
    const resolvedSelections = [];
    const serviceSummaryByStore = new Map();

    const resolveOne = (sel = {}, index = 0) => {
      const fallbackSelection = serviceSelectionFallbacks[index] || {};
      const selectionStoreId = normalizePositiveInt(sel.storeId ?? sel.store_id ?? sel.storeID)
        || normalizePositiveInt(fallbackSelection.storeId ?? fallbackSelection.store_id ?? fallbackSelection.storeID)
        || (storeIds.length === 1 ? storeIds[0] : null);
      if (!selectionStoreId) {
        const err = new Error('請先選擇交車點');
        err.code = 'ORDER_SERVICE_SELECTION_REQUIRED';
        throw err;
      }
      const store = storeMap.get(selectionStoreId);
      if (!store) {
        const err = new Error('交車點服務設定不存在，請重新整理後再試');
        err.code = 'ORDER_SERVICE_SELECTION_NOT_FOUND';
        throw err;
      }
      if (eventId && normalizePositiveInt(store.event_id) !== eventId) {
        const err = new Error('交車點服務不屬於目前賽事');
        err.code = 'ORDER_SERVICE_SELECTION_EVENT_MISMATCH';
        throw err;
      }
      if (!isPublishedListingStatus(store.event_listing_status)) {
        const err = new Error('此服務檔期尚未發布，請重新選擇');
        err.code = 'ORDER_EVENT_NOT_PUBLISHED';
        throw err;
      }
      if (normalizeEventExclusiveFlag(store.event_is_exclusive) === 1) {
        const eventOwnerId = normalizeUserId(store.event_owner_user_id);
        const storeOwnerId = normalizeUserId(store.owner_user_id) || eventOwnerId;
        if (eventOwnerId && storeOwnerId !== eventOwnerId) {
          const err = new Error('此場次為服務商獨佔，請重新選擇交車點');
          err.code = 'ORDER_SERVICE_SELECTION_EVENT_EXCLUSIVE';
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
        normalizePositiveInt(sel.deliveryPointId ?? sel.delivery_point_id),
        normalizePositiveInt(fallbackSelection.deliveryPointId ?? fallbackSelection.delivery_point_id),
        storeIds.length === 1 ? base.deliveryPointId : null,
        storeIds.length === 1 ? base.legacyPreDeliveryPointId : null,
        storeIds.length === 1 ? base.legacyPostDeliveryPointId : null,
        normalizePositiveInt(store.delivery_point_id),
      ].filter((value) => Number.isFinite(value) && value > 0)));
      if (deliveryPointIds.length > 1) {
        const err = new Error('交車點資料不一致，請重新選擇');
        err.code = 'ORDER_SERVICE_SELECTION_DELIVERY_POINT_MISMATCH';
        throw err;
      }
      const deliveryPointId = deliveryPointIds[0] || null;
      const storeName = String(sel.store || sel.storeName || sel.store_name || '').trim()
        || String(fallbackSelection.store || fallbackSelection.storeName || fallbackSelection.store_name || '').trim()
        || (storeIds.length === 1 ? (base.storeName || base.legacyPreStoreName || base.legacyPostStoreName) : '')
        || String(store.name || '').trim();
      const providerUserId = normalizeUserId(sel.providerUserId ?? sel.provider_user_id ?? sel.owner_user_id)
        || normalizeUserId(fallbackSelection.providerUserId ?? fallbackSelection.provider_user_id ?? fallbackSelection.owner_user_id)
        || normalizeUserId(store.owner_user_id)
        || normalizeUserId(store.event_owner_user_id)
        || base.providerUserId
        || null;
      sel.storeId = selectionStoreId;
      sel.store_id = selectionStoreId;
      sel.deliveryPointId = deliveryPointId;
      sel.delivery_point_id = deliveryPointId;
      sel.store = storeName;
      sel.providerUserId = providerUserId;
      sel.provider_user_id = providerUserId;
      const resolved = {
        index,
        storeId: selectionStoreId,
        deliveryPointId,
        storeName,
        providerUserId,
        storeSummary: storeName,
        prices: safeParseJSON(store.prices, {}),
        eventDeadline: store.event_deadline || null,
      };
      const qty = normalizeSelectionQuantity(sel);
      const current = serviceSummaryByStore.get(selectionStoreId) || {
        storeId: selectionStoreId,
        deliveryPointId,
        storeName,
        providerUserId,
        quantity: 0,
      };
      current.quantity += qty;
      serviceSummaryByStore.set(selectionStoreId, current);
      return resolved;
    };

    if (selections.length) {
      selections.forEach((sel, index) => {
        resolvedSelections.push(resolveOne(sel, index));
      });
    } else {
      resolvedSelections.push(resolveOne({}, 0));
    }

    const serviceSelections = Array.from(serviceSummaryByStore.values());
    const primary = serviceSelections.length === 1 ? serviceSelections[0] : null;
    const storeSummary = summarizeServiceSelections(serviceSelections, details.storeSummary);
    return {
      storeId: primary?.storeId || null,
      deliveryPointId: primary?.deliveryPointId || null,
      storeName: primary?.storeName || storeSummary,
      providerUserId: primary?.providerUserId || null,
      storeSummary,
      serviceSelections,
      resolvedSelections,
      prices: resolvedSelections[0]?.prices || {},
      eventDeadline: resolvedSelections[0]?.eventDeadline || null,
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

  function hasPriceStage(price = {}, stage) {
    const value = price?.[stage];
    return value !== undefined && value !== null && String(value).trim() !== '' && Number.isFinite(Number(value));
  }

  function resolvePriceMode(price = {}, eventDeadline = null, now = new Date()) {
    const hasNormal = hasPriceStage(price, 'normal');
    const hasEarly = hasPriceStage(price, 'early');
    if (hasEarly && !hasNormal) return 'early';
    if (hasNormal && !hasEarly) return 'normal';
    if (hasEarly && hasNormal) return isEarlyPriceActive(price, eventDeadline, now) ? 'early' : 'normal';
    return null;
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
    const resolvedSelections = Array.isArray(serviceSelection.resolvedSelections) ? serviceSelection.resolvedSelections : [];

    let subtotal = 0;
    let discount = 0;
    let quantity = 0;
    const now = new Date();
    for (const [index, sel] of selections.entries()) {
      const resolved = resolvedSelections[index] || serviceSelection || {};
      const prices = normalizeEventServicePriceMap(resolved.prices || {});
      if (!Object.keys(prices).length) {
        const err = new Error('所選交車點尚未設定價格表，請重新整理後再試');
        err.code = 'ORDER_SERVICE_PRICES_MISSING';
        throw err;
      }
      const type = String(sel.type || sel.ticketType || '').trim();
      const qty = Math.max(0, Math.floor(Number(sel.qty || sel.quantity || 0)));
      const price = findPriceEntry(prices, type);
      if (!type || !qty || !price) {
        const err = new Error('訂單包含無效或不存在的服務項目，請重新選擇');
        err.code = 'ORDER_SERVICE_PRICE_ITEM_INVALID';
        throw err;
      }
      const priceMode = resolvePriceMode(price, resolved.eventDeadline, now);
      if (!priceMode) {
        const err = new Error('訂單包含尚未設定價格的服務項目，請重新選擇');
        err.code = 'ORDER_SERVICE_PRICE_ITEM_INVALID';
        throw err;
      }
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
      sel.storeId = resolved.storeId || sel.storeId || null;
      sel.store_id = resolved.storeId || sel.store_id || null;
      sel.deliveryPointId = resolved.deliveryPointId || sel.deliveryPointId || null;
      sel.delivery_point_id = resolved.deliveryPointId || sel.delivery_point_id || null;
      sel.store = resolved.storeName || sel.store || '';
      sel.providerUserId = resolved.providerUserId || sel.providerUserId || null;
      sel.provider_user_id = resolved.providerUserId || sel.provider_user_id || null;
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
    const serviceSelections = Array.isArray(details?.serviceSelections) ? details.serviceSelections : [];
    const primarySelection = details?.serviceSelection && typeof details.serviceSelection === 'object'
      ? [details.serviceSelection]
      : [];
    const ids = [...selections, ...serviceSelections, ...primarySelection]
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

  function stableStringifyForHash(value, seen = new WeakSet()) {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (typeof value !== 'object') return JSON.stringify(String(value));
    if (seen.has(value)) return '"[Circular]"';
    seen.add(value);
    if (Array.isArray(value)) return `[${value.map((item) => stableStringifyForHash(item, seen)).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringifyForHash(value[key], seen)}`).join(',')}}`;
  }

  function normalizeOrderIdempotencyKey(value) {
    if (value === undefined || value === null) return '';
    const key = String(value || '').trim();
    if (!key) return '';
    if (key.length > 128) {
      const err = new Error('Idempotency key is too long');
      err.code = 'IDEMPOTENCY_KEY_INVALID';
      throw err;
    }
    return key;
  }

  function buildOrderIdempotencyContext(body = {}, items = []) {
    const requestKey = normalizeOrderIdempotencyKey(body.idempotencyKey);
    if (!requestKey) return null;
    const requestHash = createHash('sha256')
      .update(stableStringifyForHash({ items }))
      .digest('hex');
    return { requestKey, requestHash };
  }

  function parseIdempotencyResponse(value) {
    const response = safeParseJSON(value, null);
    return response && typeof response === 'object' && response.ok === true ? response : null;
  }

  async function claimOrderIdempotency(conn, { userId, requestKey, requestHash }) {
    const [insertResult] = await conn.query(
      `INSERT IGNORE INTO order_idempotency_keys
        (user_id, request_key, request_hash, status)
       VALUES (?, ?, ?, 'processing')`,
      [userId, requestKey, requestHash]
    );
    if (Number(insertResult?.affectedRows || 0) === 1) return { claimed: true };

    const [rows] = await conn.query(
      `SELECT request_hash, status, response_json
         FROM order_idempotency_keys
        WHERE user_id = ? AND request_key = ?
        LIMIT 1
        FOR UPDATE`,
      [userId, requestKey]
    );
    const row = rows?.[0];
    if (!row) {
      const err = new Error('訂單處理中，請稍候再試');
      err.code = 'IDEMPOTENCY_IN_PROGRESS';
      throw err;
    }
    if (String(row.request_hash || '') !== requestHash) {
      const err = new Error('此訂單提交識別碼已被不同內容使用，請重新整理後再下單');
      err.code = 'IDEMPOTENCY_KEY_REUSED';
      throw err;
    }
    const replayResponse = parseIdempotencyResponse(row.response_json);
    if (String(row.status || '') === 'completed' && replayResponse) {
      return { claimed: false, replayResponse };
    }
    const err = new Error('訂單仍在處理中，請稍候再試');
    err.code = 'IDEMPOTENCY_IN_PROGRESS';
    throw err;
  }

  async function completeOrderIdempotency(conn, { userId, requestKey }, response) {
    await conn.query(
      `UPDATE order_idempotency_keys
          SET status = 'completed',
              response_json = ?
        WHERE user_id = ? AND request_key = ?
        LIMIT 1`,
      [JSON.stringify(response), userId, requestKey]
    );
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
    const resolvedSelections = Array.isArray(serviceSelection.resolvedSelections) ? serviceSelection.resolvedSelections : [];
    const driverByStoreId = new Map();
    const reservationRows = [];
    for (const [index, sel] of selections.entries()) {
      const resolved = resolvedSelections[index] || serviceSelection || {};
      const qty = Number(sel.qty || sel.quantity || 0);
      const type = sel.type || sel.ticketType || '';
      const storeId = normalizePositiveInt(resolved.storeId ?? sel.storeId ?? sel.store_id ?? sel.storeID);
      let defaultDriverId = null;
      if (storeId) {
        if (!driverByStoreId.has(storeId)) {
          driverByStoreId.set(storeId, await resolveDefaultDriverForReservation(connOrPool, { eventId, storeId }));
        }
        defaultDriverId = driverByStoreId.get(storeId) || null;
      }
      for (let i = 0; i < qty; i++) {
        reservationRows.push({
          userId,
          ticketType: type,
          storeName: resolved.storeName || sel.store || serviceSelection.storeSummary || '',
          eventName,
          eventId,
          storeId,
          orderId,
          deliveryPointId: normalizePositiveInt(resolved.deliveryPointId ?? sel.deliveryPointId ?? sel.delivery_point_id),
          driverId: defaultDriverId,
        });
      }
    }
    return { reservationRows, serviceSelection };
  }

  async function releaseUnpaidOrderTickets(connOrPool, userId, details = {}) {
    if (!details?.tickets_marked) return;
    const ids = (Array.isArray(details.ticketsUsed) ? details.ticketsUsed : [])
      .map(normalizePositiveInt)
      .filter((id) => Number.isFinite(id) && id > 0);
    if (!ids.length) return;
    await connOrPool.query(
      `UPDATE tickets SET used = 0
        WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
      [userId, ...ids]
    );
  }

  async function prepareEditableOrderDetails(conn, userId, input = {}, previousStatus = ORDER_STATUS_REMITTANCE_PENDING) {
    let details = safeParseJSON(input, {});
    if (!details || typeof details !== 'object' || Array.isArray(details)) {
      const err = new Error('訂單內容格式不正確');
      err.code = 'ORDER_UPDATE_INVALID';
      err.statusCode = 400;
      throw err;
    }
    delete details.granted;
    delete details.reservations_granted;
    delete details.paymentNotified;
    delete details.payment_notified;
    delete details.cancelledAt;
    delete details.cancelled_at;

    const reservationOrder = isReservationOrderDetails(details);
    if (reservationOrder) {
      const serviceSelection = await resolveOrderServiceSelection(conn, details);
      ensureReservationOrderPricing(details, serviceSelection);
      applyResolvedServiceSelectionDetails(details, serviceSelection);
      await assertReservationCapacityAvailable(conn, details, { lock: true });
      const remittanceResolution = await resolveOrderRemittance({
        ...details,
        remittance: {}, bankInfo: '', bankCode: '', bankAccount: '', bankAccountName: '', bankName: '',
      });
      if (remittanceResolution.missingStoreIds.length) {
        const err = new Error('部分店面資料不存在，請重新整理後再試');
        err.code = 'ORDER_REMITTANCE_STORE_NOT_FOUND';
        err.statusCode = 400;
        throw err;
      }
      if (remittanceResolution.missingConfigStoreIds.length) {
        const err = new Error('所選店面、服務商與平台尚未設定匯款資訊，請先聯繫平台管理員');
        err.code = 'ORDER_REMITTANCE_UNSET';
        err.statusCode = 400;
        throw err;
      }
      if (remittanceResolution.multiple) {
        const err = new Error('本次選擇包含不同匯款資訊的店面，請分開下單');
        err.code = 'ORDER_REMITTANCE_MIXED';
        err.statusCode = 400;
        throw err;
      }
      if (hasRemittanceDetails(remittanceResolution.remittance)) {
        details = applyRemittanceDetails(details, remittanceResolution.remittance);
      }
    } else {
      const product = await ensureTicketProductPublished(conn, details);
      applyTicketOrderPricing(details, product);
      const remittanceResolution = await resolveOrderRemittance(details);
      if (Array.isArray(remittanceResolution.missingConfigProductIds) && remittanceResolution.missingConfigProductIds.length) {
        const err = new Error('所選票券商品服務商與平台尚未設定匯款資訊，請先聯繫平台管理員');
        err.code = 'ORDER_REMITTANCE_UNSET';
        err.statusCode = 400;
        throw err;
      }
      details = hasRemittanceDetails(remittanceResolution.remittance)
        ? applyRemittanceDetails(details, remittanceResolution.remittance)
        : await hydrateOrderRemittance(details);
    }
    details.status = previousStatus || ORDER_STATUS_REMITTANCE_PENDING;
    ensureRemittance(details);
    const validatedTicketIds = await validateTicketsUsable(conn, userId, details.ticketsUsed || [], details);
    if (validatedTicketIds.length) {
      const [updated] = await conn.query(
        `UPDATE tickets SET used = 1
          WHERE user_id = ? AND used = 0
            AND (expiry IS NULL OR expiry > CURRENT_DATE())
            AND id IN (${validatedTicketIds.map(() => '?').join(',')})`,
        [userId, ...validatedTicketIds]
      );
      if (Number(updated.affectedRows || 0) !== validatedTicketIds.length) {
        const err = new Error('票券狀態已變更，請重新選擇票券');
        err.code = 'TICKET_USE_CONFLICT';
        err.statusCode = 409;
        throw err;
      }
      details.tickets_marked = true;
    } else {
      details.tickets_marked = false;
    }
    return details;
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

router.get('/orders/:id', authRequired, async (req, res) => {
  const orderId = normalizePositiveInt(req.params.id);
  if (!orderId) return fail(res, 'ORDER_NOT_FOUND', '找不到訂單', 404);
  try {
    const [rows] = await pool.query('SELECT * FROM orders WHERE id = ? AND user_id = ? LIMIT 1', [orderId, req.user.id]);
    if (!rows.length) return fail(res, 'ORDER_NOT_FOUND', '找不到訂單', 404);
    const details = normalizeOrderDetailsForPayment(await hydrateOrderRemittance(safeParseJSON(rows[0].details, {})));
    return ok(res, { ...rows[0], details });
  } catch (err) {
    return fail(res, 'ORDER_FETCH_FAIL', err.message, 500);
  }
});

router.patch('/orders/:id', authRequired, async (req, res) => {
  const orderId = normalizePositiveInt(req.params.id);
  const input = req.body?.details ?? req.body;
  if (!orderId) return fail(res, 'ORDER_NOT_FOUND', '找不到訂單', 404);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT id, user_id, code, details FROM orders WHERE id = ? AND user_id = ? LIMIT 1 FOR UPDATE', [orderId, req.user.id]);
    if (!rows.length) {
      const err = new Error('找不到訂單');
      err.code = 'ORDER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }
    const oldDetails = safeParseJSON(rows[0].details, {});
    const status = normalizeOrderPaymentStatus(oldDetails.status) || ORDER_STATUS_PROCESSING;
    if (isOrderPaidStatus(status)) {
      const err = new Error('付款確認完成後無法修改訂單');
      err.code = 'ORDER_ALREADY_PAID';
      err.statusCode = 409;
      throw err;
    }
    if (status === ORDER_STATUS_CANCELLED) {
      const err = new Error('已取消的訂單無法修改');
      err.code = 'ORDER_ALREADY_CANCELLED';
      err.statusCode = 409;
      throw err;
    }
    const submittedDetails = safeParseJSON(input, {});
    if (isReservationOrderDetails(oldDetails) !== isReservationOrderDetails(submittedDetails)) {
      const err = new Error('無法變更訂單類型，請取消後重新下單');
      err.code = 'ORDER_TYPE_CHANGE_NOT_ALLOWED';
      err.statusCode = 400;
      throw err;
    }
    await releaseUnpaidOrderTickets(conn, req.user.id, oldDetails);
    const details = await prepareEditableOrderDetails(conn, req.user.id, submittedDetails, status);
    await conn.query('UPDATE orders SET details = ? WHERE id = ? AND user_id = ?', [JSON.stringify(details), orderId, req.user.id]);
    await conn.commit();
    invalidateOrderEventCapacity(oldDetails);
    invalidateOrderEventCapacity(details);
    return ok(res, { id: orderId, code: rows[0].code, details }, '訂單已更新');
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    if (err?.statusCode) return fail(res, err.code || 'ORDER_UPDATE_FAIL', err.message, err.statusCode);
    if (err?.code === 'INVALID_TICKETS') return fail(res, 'TICKETS_UNUSABLE', '包含已過期或不可用的票券，請重新確認', 400);
    if (err?.code === 'ORDER_PRICE_CHANGED' || err?.code === 'TICKET_USE_CONFLICT') return fail(res, err.code, err.message, 409);
    return fail(res, err?.code || 'ORDER_UPDATE_FAIL', err.message || '更新訂單失敗', 400);
  } finally {
    conn.release();
  }
});

router.post('/orders/:id/cancel', authRequired, async (req, res) => {
  const orderId = normalizePositiveInt(req.params.id);
  if (!orderId) return fail(res, 'ORDER_NOT_FOUND', '找不到訂單', 404);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT id, code, details FROM orders WHERE id = ? AND user_id = ? LIMIT 1 FOR UPDATE', [orderId, req.user.id]);
    if (!rows.length) {
      const err = new Error('找不到訂單');
      err.code = 'ORDER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }
    const details = safeParseJSON(rows[0].details, {});
    const status = normalizeOrderPaymentStatus(details.status) || ORDER_STATUS_PROCESSING;
    if (status === ORDER_STATUS_CANCELLED) {
      await conn.commit();
      return ok(res, { id: orderId, code: rows[0].code, details }, '訂單已取消');
    }
    if (isOrderPaidStatus(status)) {
      const err = new Error('付款確認完成後無法自行取消訂單');
      err.code = 'ORDER_ALREADY_PAID';
      err.statusCode = 409;
      throw err;
    }
    const reservations = await listReservationsByOrderId(conn, orderId);
    if (reservations.length) {
      const err = new Error('此訂單已建立預約，無法自行取消');
      err.code = 'ORDER_HAS_RESERVATIONS';
      err.statusCode = 409;
      throw err;
    }
    await releaseUnpaidOrderTickets(conn, req.user.id, details);
    details.status = ORDER_STATUS_CANCELLED;
    details.tickets_marked = false;
    details.cancelledAt = new Date().toISOString();
    await conn.query('UPDATE orders SET details = ? WHERE id = ? AND user_id = ?', [JSON.stringify(details), orderId, req.user.id]);
    await conn.commit();
    invalidateOrderEventCapacity(details);
    return ok(res, { id: orderId, code: rows[0].code, details }, '訂單已取消');
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    return fail(res, err?.code || 'ORDER_CANCEL_FAIL', err.message || '取消訂單失敗', err?.statusCode || 500);
  } finally {
    conn.release();
  }
});

router.post('/orders', authRequired, async (req, res) => {
  const body = req.body || {};
  const { items } = body;
  if (!Array.isArray(items)) return fail(res, 'VALIDATION_ERROR', '缺少 items', 400);

  let idempotency = null;
  try {
    idempotency = buildOrderIdempotencyContext(body, items);
  } catch (err) {
    if (err?.code === 'IDEMPOTENCY_KEY_INVALID') {
      return fail(res, 'IDEMPOTENCY_KEY_INVALID', '訂單提交識別碼格式不正確', 400);
    }
    return fail(res, 'ORDER_CREATE_FAIL', err.message || '訂單資料處理失敗', 500);
  }
  if (idempotency) {
    try {
      await ensureOrderIdempotencyTable();
    } catch (err) {
      console.error('[orders] idempotency table check failed', err?.message || err);
      return fail(res, 'ORDER_IDEMPOTENCY_UNAVAILABLE', '訂單防重複機制暫時不可用', 500);
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let idempotencyClaim = null;
    if (idempotency) {
      idempotencyClaim = await claimOrderIdempotency(conn, {
        userId: req.user.id,
        requestKey: idempotency.requestKey,
        requestHash: idempotency.requestHash,
      });
      if (idempotencyClaim?.replayResponse) {
        await conn.commit();
        return res.json(idempotencyClaim.replayResponse);
      }
    }

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
      const wrapped = new Error(err.message || '內部錯誤');
      wrapped.code = 'USER_CONTACT_CHECK_FAIL';
      throw wrapped;
    }
    if (!contactCheck.ok) {
      const err = new Error(contactCheck.message || '聯絡資料尚未完成');
      err.code = contactCheck.code || 'USER_CONTACT_INCOMPLETE';
      err.statusCode = contactCheck.status || 400;
      throw err;
    }

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
        applyResolvedServiceSelectionDetails(details, normalizedServiceSelection);
        await assertReservationCapacityAvailable(conn, details, { lock: true });
      } else {
        const product = await ensureTicketProductPublished(conn, details);
        applyTicketOrderPricing(details, product);
        total = Number(details.total || 0);
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
            applyResolvedServiceSelectionDetails(details, serviceSelection);
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

    const successResponse = { ok: true, message: '訂單建立成功', data: created };
    if (idempotency && idempotencyClaim?.claimed) {
      await completeOrderIdempotency(conn, { userId: req.user.id, requestKey: idempotency.requestKey }, successResponse);
    }

    await conn.commit();
    createdSummaries.forEach((summary) => {
      if (isReservationOrderDetails(summary.detailsRaw || {})) invalidateOrderEventCapacity(summary.detailsRaw || {});
    });
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
    return res.json(successResponse);
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    if (err?.code === 'IDEMPOTENCY_KEY_REUSED') {
      return fail(res, 'IDEMPOTENCY_KEY_REUSED', err.message || '訂單提交識別碼已被不同內容使用', 409);
    }
    if (err?.code === 'IDEMPOTENCY_IN_PROGRESS') {
      return fail(res, 'IDEMPOTENCY_IN_PROGRESS', err.message || '訂單仍在處理中，請稍候再試', 409);
    }
    if (err?.code === 'USER_CONTACT_CHECK_FAIL') {
      return fail(res, 'USER_CONTACT_CHECK_FAIL', err.message || '內部錯誤', 500);
    }
    if (err?.statusCode && err?.code) {
      return fail(res, err.code, err.message, err.statusCode);
    }
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
      'ORDER_EVENT_NOT_PUBLISHED',
      'ORDER_PRODUCT_NOT_FOUND',
      'ORDER_PRODUCT_NOT_PUBLISHED',
      'ORDER_PRODUCT_VALIDATION_UNAVAILABLE',
      'ORDER_PRODUCT_PRICE_INVALID',
      'ORDER_TICKET_QUANTITY_INVALID',
      'ORDER_SERVICE_SELECTION_INACTIVE',
      'ORDER_SERVICE_SELECTION_DELIVERY_POINT_MISMATCH',
      'ORDER_SERVICE_SELECTION_EVENT_EXCLUSIVE',
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
    if (err?.code === 'DELIVERY_POINT_CAPACITY_EXCEEDED') {
      return fail(res, 'DELIVERY_POINT_CAPACITY_EXCEEDED', err.message || '交車點收容數量不足', err.statusCode || 409);
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

router.get('/provider/legal_terms', serviceProviderOnly, async (req, res) => {
  try {
    if (!isSERVICE_PROVIDER(req.user?.role)) {
      return fail(res, 'FORBIDDEN', '需要服務商權限', 403);
    }
    const data = await getProviderServiceTerms(req.user.id);
    return ok(res, data);
  } catch (err) {
    return fail(res, 'PROVIDER_LEGAL_TERMS_GET_FAIL', err.message || '讀取服務商條款失敗', 500);
  }
});

router.patch('/provider/legal_terms', serviceProviderOnly, async (req, res) => {
  try {
    if (!isSERVICE_PROVIDER(req.user?.role)) {
      return fail(res, 'FORBIDDEN', '需要服務商權限', 403);
    }
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    const data = await saveProviderServiceTerms(req.user.id, content);
    return ok(res, data, '服務商條款已更新');
  } catch (err) {
    if (err?.code === 'PROVIDER_NOT_FOUND') {
      return fail(res, 'PROVIDER_NOT_FOUND', err.message || '找不到服務商帳號', 404);
    }
    return fail(res, 'PROVIDER_LEGAL_TERMS_UPDATE_FAIL', err.message || '更新服務商條款失敗', 500);
  }
});

router.get('/providers/legal_terms', async (req, res) => {
  try {
    const data = await listProviderServiceTerms();
    return ok(res, data);
  } catch (err) {
    return fail(res, 'PROVIDER_LEGAL_TERMS_LIST_FAIL', err.message || '讀取服務商條款失敗', 500);
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

router.get('/admin/order_email_cc', adminOnly, async (req, res) => {
  try {
    const data = await getOrderEmailCcConfig({ includeUsers: true });
    return ok(res, data);
  } catch (err) {
    return fail(res, 'ADMIN_ORDER_EMAIL_CC_GET_FAIL', err.message || '讀取訂單 Email 副本設定失敗', 500);
  }
});

router.patch('/admin/order_email_cc', adminOnly, async (req, res) => {
  try {
    const data = await saveOrderEmailCcConfig(req.body || {});
    return ok(res, data, '訂單 Email 副本設定已更新');
  } catch (err) {
    if (err?.code === 'ORDER_EMAIL_CC_INVALID_EMAIL') {
      return fail(res, 'ORDER_EMAIL_CC_INVALID_EMAIL', err.message || 'Email 格式不正確', 400);
    }
    if (err?.code === 'ORDER_EMAIL_CC_USER_NOT_FOUND') {
      return fail(res, 'ORDER_EMAIL_CC_USER_NOT_FOUND', err.message || '找不到指定帳號', 404);
    }
    return fail(res, 'ADMIN_ORDER_EMAIL_CC_UPDATE_FAIL', err.message || '更新訂單 Email 副本設定失敗', 500);
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
    const insuranceTermsUrl = normalizeExternalSiteUrl(body.insuranceTermsUrl);
    const invalidSocialLink = findInvalidSocialLink(body.socialLinks);
    const socialLinks = normalizeSiteSocialLinks(Array.isArray(body.socialLinks) ? body.socialLinks : []);

    const limit = 20000;
    if (terms.length > limit) terms = terms.slice(0, limit);
    if (privacy.length > limit) privacy = privacy.slice(0, limit);
    if (notice.length > limit) notice = notice.slice(0, limit);
    if (rules.length > limit) rules = rules.slice(0, limit);
    if (!isAllowedExternalSiteUrl(insuranceTermsUrl)) {
      return fail(res, 'INVALID_INSURANCE_TERMS_URL', '產險條款連結請使用 http:// 或 https:// 開頭', 400);
    }
    if (invalidSocialLink) {
      return fail(res, 'INVALID_SOCIAL_LINK_URL', '社群連結請使用 http:// 或 https:// 開頭', 400);
    }

    const entries = [
      { key: SITE_PAGE_KEYS.terms, value: terms },
      { key: SITE_PAGE_KEYS.privacy, value: privacy },
      { key: SITE_PAGE_KEYS.reservationNotice, value: notice },
      { key: SITE_PAGE_KEYS.reservationRules, value: rules },
      { key: SITE_PAGE_KEYS.insuranceTermsUrl, value: insuranceTermsUrl },
      { key: SITE_PAGE_KEYS.socialLinks, value: socialLinks.length ? JSON.stringify(socialLinks) : '' },
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

router.get('/app/legal_links', async (req, res) => {
  try {
    const pages = await getSitePages();
    const insuranceTermsUrl = normalizeExternalSiteUrl(pages.insuranceTermsUrl);
    return ok(res, {
      insuranceTermsUrl: isAllowedExternalSiteUrl(insuranceTermsUrl) ? insuranceTermsUrl : '',
      socialLinks: pages.socialLinks || [],
    });
  } catch (err) {
    return fail(res, 'LEGAL_LINKS_FETCH_FAIL', err.message || '讀取條款連結失敗', 500);
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
        `(o.code LIKE ? OR u.username LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR u.remittance_last5 LIKE ? OR CAST(o.details AS CHAR) LIKE ? OR ${ADMIN_ORDER_STATUS_SQL} LIKE ? OR CAST(o.id AS CHAR) LIKE ?)`
      );
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }
    appendAdminOrderFilters(req, where, params);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const isAdmin = isADMIN(req.user.role);
    let total = 0;
    let items = [];
    let summary;

    const selectSql = `SELECT o.id, o.code, o.details, o.created_at, u.id AS user_id, u.username, u.email, u.role AS user_role, u.is_vip, u.phone, u.remittance_last5 ${baseFrom}`;
    const providerAccessIndex = isAdmin ? null : await buildProviderOrderAccessIndex(pool, req.user.id);
    const hydrateProviderRows = async (sqlWhere, sqlParams) => {
      const [rows] = await pool.query(`${selectSql} ${sqlWhere} ORDER BY o.created_at DESC, o.id DESC`, sqlParams);
      return rows.map((source) => ({
          ...source,
          _details: normalizeOrderDetailsForPayment(safeParseJSON(source.details, {})),
        }))
        .filter((row) => providerAccessIndex.canManage(row._details));
    };

    if (isAdmin) {
      const countSql = `SELECT COUNT(*) AS total ${baseFrom} ${whereSql}`;
      const listSql = `${selectSql} ${whereSql} ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`;
      const summarySql = `SELECT ${ADMIN_ORDER_STATUS_SQL} AS status, COUNT(*) AS count ${baseFrom} GROUP BY ${ADMIN_ORDER_STATUS_SQL}`;
      const [[countRow], [rows], [summaryRows]] = await Promise.all([
        pool.query(countSql, params).then(([result]) => result),
        pool.query(listSql, [...params, limit, offset]),
        pool.query(summarySql),
      ]);
      total = Number(countRow?.total || 0);
      items = await Promise.all(rows.map(async (row) => ({
        id: row.id,
        code: row.code || '',
        created_at: row.created_at || null,
        user_id: row.user_id,
        username: row.username || '',
        email: row.email || '',
        user_role: row.user_role || 'USER',
        isVip: Boolean(Number(row.is_vip || 0)),
        phone: row.phone == null ? null : String(row.phone),
        remittance_last5: row.remittance_last5 == null ? null : String(row.remittance_last5),
        details: normalizeOrderDetailsForPayment(await hydrateOrderRemittance(safeParseJSON(row.details, {}))),
      })));

      summary = buildAdminOrderSummary(summaryRows);
    } else {
      const providerFiltered = await hydrateProviderRows(whereSql, params);
      const providerScoped = where.length ? await hydrateProviderRows('', []) : providerFiltered;
      total = providerFiltered.length;
      items = await Promise.all(providerFiltered.slice(offset, offset + limit).map(async (row) => ({
        id: row.id,
        code: row.code || '',
        created_at: row.created_at || null,
        user_id: row.user_id,
        username: row.username || '',
        email: row.email || '',
        user_role: row.user_role || 'USER',
        isVip: Boolean(Number(row.is_vip || 0)),
        phone: row.phone == null ? null : String(row.phone),
        remittance_last5: row.remittance_last5 == null ? null : String(row.remittance_last5),
        details: normalizeOrderDetailsForPayment(await hydrateOrderRemittance(row._details)),
      })));
      summary = buildAdminOrderSummary(providerScoped.map((row) => ({
        status: row._details?.status || ORDER_STATUS_PROCESSING,
      })));
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
      summary,
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

    const [rows] = await conn.query('SELECT * FROM orders WHERE id = ? LIMIT 1 FOR UPDATE', [req.params.id]);
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

    if (isReservationOrder && isOrderPaidStatus(targetStatus) && !details.reservations_granted) {
      await assertReservationCapacityAvailable(conn, details, { excludeOrderId: order.id, lock: true });
    }

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
        applyResolvedServiceSelectionDetails(details, serviceSelection);
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
    if (isReservationOrder) invalidateOrderEventCapacity(details);
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
    if (err?.code === 'DELIVERY_POINT_CAPACITY_EXCEEDED') {
      return fail(res, 'DELIVERY_POINT_CAPACITY_EXCEEDED', err.message || '交車點收容數量不足', err.statusCode || 409);
    }
    if ([
      'ORDER_SERVICE_SELECTION_REQUIRED',
      'ORDER_SERVICE_SELECTION_NOT_FOUND',
      'ORDER_SERVICE_SELECTION_EVENT_MISMATCH',
      'ORDER_EVENT_NOT_PUBLISHED',
      'ORDER_SERVICE_SELECTION_INACTIVE',
      'ORDER_SERVICE_SELECTION_DELIVERY_POINT_MISMATCH',
      'ORDER_SERVICE_SELECTION_EVENT_EXCLUSIVE',
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
