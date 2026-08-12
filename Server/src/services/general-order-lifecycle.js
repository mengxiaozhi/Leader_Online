const { createHash } = require('crypto');

const GENERAL_ORDER_SOURCE = 'general';
const PAYMENT_STATUSES = Object.freeze(['pending', 'reviewing', 'paid', 'cancelled', 'refunded']);
const FULFILLMENT_STATUSES = Object.freeze(['pending', 'fulfilled', 'voided', 'failed']);
const GENERAL_ORDER_ACTIONS = Object.freeze([
  'mark-reviewing',
  'confirm-payment',
  'cancel',
  'refund',
  'retry-fulfillment',
]);

const PAYMENT_TO_LEGACY_STATUS = Object.freeze({
  pending: '待匯款',
  reviewing: '處理中',
  paid: '已付款',
  cancelled: '已取消',
  refunded: '已退款',
});

function lifecycleError(code, message, statusCode = 400, data = undefined) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (data !== undefined) error.data = data;
  return error;
}

function safeJson(value, fallback = {}) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch (_) {
    return fallback;
  }
}

function normalizeLegacyStatus(value = '') {
  const status = String(value || '').trim();
  if (status === '已完成' || status === '待指派') return '已付款';
  return status;
}

function paymentStatusFromLegacy(value = '') {
  const status = normalizeLegacyStatus(value);
  if (status === '待匯款') return 'pending';
  if (status === '處理中') return 'reviewing';
  if (status === '已付款') return 'paid';
  if (status === '已取消') return 'cancelled';
  if (status === '已退款') return 'refunded';
  return 'pending';
}

function normalizePaymentStatus(value, details = {}) {
  const status = String(value || '').trim().toLowerCase();
  if (PAYMENT_STATUSES.includes(status)) return status;
  return paymentStatusFromLegacy(details?.status);
}

function normalizeFulfillmentStatus(value, details = {}, paymentStatus = 'pending') {
  const status = String(value || '').trim().toLowerCase();
  if (FULFILLMENT_STATUSES.includes(status)) return status;
  if (paymentStatus === 'refunded') return 'voided';
  if (details?.granted === true || details?.reservations_granted === true) return 'fulfilled';
  return 'pending';
}

function legacyStatusForPayment(paymentStatus) {
  return PAYMENT_TO_LEGACY_STATUS[paymentStatus] || PAYMENT_TO_LEGACY_STATUS.pending;
}

function readCanonicalOrderState(row = {}, detailsInput = undefined) {
  const details = detailsInput === undefined ? safeJson(row.details, {}) : safeJson(detailsInput, {});
  const paymentStatus = normalizePaymentStatus(row.payment_status ?? row.paymentStatus, details);
  const fulfillmentStatus = normalizeFulfillmentStatus(
    row.fulfillment_status ?? row.fulfillmentStatus,
    details,
    paymentStatus
  );
  const rowVersion = Math.max(1, Number(row.row_version ?? row.rowVersion ?? details.rowVersion ?? 1) || 1);
  return { paymentStatus, fulfillmentStatus, rowVersion, details };
}

function buildOrderCapabilities({ paymentStatus, fulfillmentStatus } = {}) {
  const editable = paymentStatus === 'pending' || paymentStatus === 'reviewing';
  return {
    edit: editable,
    cancel: editable,
    markReviewing: paymentStatus === 'pending',
    confirmPayment: editable,
    refund: paymentStatus === 'paid' && fulfillmentStatus === 'fulfilled',
    retryFulfillment: paymentStatus === 'paid'
      && (fulfillmentStatus === 'pending' || fulfillmentStatus === 'failed'),
  };
}

function buildEditableFields(details = {}, capabilities = {}) {
  if (!capabilities.edit) return [];
  if (Array.isArray(details?.selections) && details.selections.length) {
    return ['selections', 'serviceSelections', 'addOn', 'contactConfirmation'];
  }
  return ['quantity', 'contactConfirmation'];
}

function roundMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.round(number * 100) / 100);
}

function buildOrderLineItems(details = {}) {
  const selections = Array.isArray(details?.selections) ? details.selections : [];
  if (selections.length) {
    return selections.map((selection, index) => {
      const quantity = Math.max(0, Number(selection.qty ?? selection.quantity ?? 0) || 0);
      const unitPrice = roundMoney(selection.unitPrice ?? selection.price);
      const subtotal = roundMoney(selection.subtotal ?? (unitPrice * quantity));
      return {
        id: String(selection.id ?? `${index + 1}`),
        kind: 'reservation',
        productId: Number(selection.productId ?? selection.product_id) || null,
        name: String(selection.type ?? selection.ticketType ?? '').trim(),
        quantity,
        unitPrice,
        subtotal,
        discount: roundMoney(selection.discount),
        total: roundMoney(subtotal - roundMoney(selection.discount)),
        storeId: Number(selection.storeId ?? selection.store_id) || null,
        deliveryPointId: Number(selection.deliveryPointId ?? selection.delivery_point_id) || null,
        storeName: String(selection.store ?? selection.storeName ?? '').trim(),
      };
    });
  }
  const quantity = Math.max(0, Number(details.quantity || 0) || 0);
  const unitPrice = roundMoney(details.unitPrice ?? details.price);
  const subtotal = roundMoney(details.subtotal ?? (unitPrice * quantity));
  return [{
    id: String(details.productId ?? details.product_id ?? '1'),
    kind: 'ticket',
    productId: Number(details.productId ?? details.product_id) || null,
    name: String(details.ticketType ?? details?.product?.name ?? '').trim(),
    quantity,
    unitPrice,
    subtotal,
    discount: roundMoney(details.discount),
    total: roundMoney(details.total ?? (subtotal - roundMoney(details.discount))),
  }];
}

function mapIssuedTicket(ticket = {}) {
  const voidedAt = ticket.voided_at ?? ticket.voidedAt ?? null;
  const expired = ticket.expired === true || Number(ticket.expired || 0) === 1;
  const used = ticket.used === true || Number(ticket.used || 0) === 1;
  return {
    id: Number(ticket.id) || null,
    uuid: ticket.uuid || '',
    type: ticket.type || '',
    productId: Number(ticket.product_id ?? ticket.productId) || null,
    orderId: Number(ticket.order_id ?? ticket.orderId) || null,
    ownerUserId: ticket.user_id == null ? null : String(ticket.user_id),
    expiry: ticket.expiry || null,
    used,
    voidedAt,
    voidReason: ticket.void_reason ?? ticket.voidReason ?? null,
    replacedByTicketId: Number(ticket.replaced_by_ticket_id ?? ticket.replacedByTicketId) || null,
    rowVersion: Math.max(1, Number(ticket.row_version ?? ticket.rowVersion ?? 1) || 1),
    status: voidedAt ? 'voided' : used ? 'used' : expired ? 'expired' : 'available',
    createdAt: ticket.created_at ?? ticket.createdAt ?? null,
  };
}

function mapLifecycleEvent(event = {}) {
  return {
    id: Number(event.id) || null,
    action: event.action || '',
    actorUserId: event.actor_user_id == null ? null : String(event.actor_user_id),
    fromPaymentStatus: event.from_payment_status || null,
    toPaymentStatus: event.to_payment_status || null,
    fromFulfillmentStatus: event.from_fulfillment_status || null,
    toFulfillmentStatus: event.to_fulfillment_status || null,
    reason: event.reason || null,
    metadata: safeJson(event.metadata, {}),
    createdAt: event.created_at || null,
  };
}

function mapGeneralOrderDto(row = {}, { tickets = [], lifecycle = [] } = {}) {
  const state = readCanonicalOrderState(row);
  const details = state.details;
  const capabilities = buildOrderCapabilities(state);
  const publicFulfillmentStatus = state.fulfillmentStatus === 'failed'
    ? 'pending'
    : state.fulfillmentStatus;
  return {
    ...row,
    source: GENERAL_ORDER_SOURCE,
    status: legacyStatusForPayment(state.paymentStatus),
    paymentStatus: state.paymentStatus,
    fulfillmentStatus: publicFulfillmentStatus,
    lineItems: buildOrderLineItems(details),
    issuedTickets: tickets.map(mapIssuedTicket),
    rowVersion: state.rowVersion,
    capabilities,
    editableFields: buildEditableFields(details, capabilities),
    lifecycle: lifecycle.map(mapLifecycleEvent),
    details: {
      ...details,
      status: legacyStatusForPayment(state.paymentStatus),
    },
  };
}

function parseIfMatch(value) {
  const text = String(value ?? '').trim();
  if (!text) throw lifecycleError('PRECONDITION_REQUIRED', '缺少 If-Match 訂單版本', 428);
  const match = text.match(/^(?:W\/)?"?(\d+)"?$/i);
  const version = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(version) || version < 1) {
    throw lifecycleError('PRECONDITION_INVALID', 'If-Match 訂單版本格式不正確', 400);
  }
  return version;
}

function normalizeIdempotencyKey(value) {
  const key = String(value ?? '').trim();
  if (!key) throw lifecycleError('IDEMPOTENCY_KEY_REQUIRED', '缺少 Idempotency-Key', 400);
  if (key.length > 128) throw lifecycleError('IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key 不可超過 128 字元', 400);
  return key;
}

function stableStringify(value, seen = new WeakSet()) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value !== 'object') return JSON.stringify(String(value));
  if (seen.has(value)) return '"[Circular]"';
  seen.add(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry, seen)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key], seen)}`).join(',')}}`;
}

function requestHash(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function assertActionAllowed(action, state) {
  if (!GENERAL_ORDER_ACTIONS.includes(action)) {
    throw lifecycleError('ORDER_ACTION_UNSUPPORTED', '不支援的訂單操作', 400);
  }
  const { paymentStatus, fulfillmentStatus } = state;
  const allowed = (
    (action === 'mark-reviewing' && paymentStatus === 'pending')
    || (action === 'confirm-payment' && ['pending', 'reviewing'].includes(paymentStatus))
    || (action === 'cancel' && ['pending', 'reviewing'].includes(paymentStatus))
    || (action === 'refund' && paymentStatus === 'paid' && fulfillmentStatus === 'fulfilled')
    || (action === 'retry-fulfillment' && paymentStatus === 'paid' && ['pending', 'failed'].includes(fulfillmentStatus))
  );
  if (!allowed) {
    throw lifecycleError(
      'ORDER_ACTION_NOT_ALLOWED',
      `訂單目前為 ${paymentStatus}/${fulfillmentStatus}，無法執行 ${action}`,
      409,
      { paymentStatus, fulfillmentStatus, action }
    );
  }
}

async function loadGeneralOrderRelations(queryable, orderIds = []) {
  const ids = Array.from(new Set(orderIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)));
  const ticketsByOrder = new Map(ids.map((id) => [id, []]));
  const lifecycleByOrder = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return { ticketsByOrder, lifecycleByOrder };
  const placeholders = ids.map(() => '?').join(',');
  const [tickets] = await queryable.query(
    `SELECT id, uuid, type, product_id, order_id, user_id, discount, used, expiry,
            voided_at, void_reason, replaced_by_ticket_id, row_version, created_at,
            (expiry IS NOT NULL AND expiry <= CURRENT_DATE()) AS expired
       FROM tickets
      WHERE order_id IN (${placeholders})
      ORDER BY id ASC`,
    ids
  );
  for (const ticket of tickets || []) {
    const orderId = Number(ticket.order_id);
    if (!ticketsByOrder.has(orderId)) ticketsByOrder.set(orderId, []);
    ticketsByOrder.get(orderId).push(ticket);
  }
  const [events] = await queryable.query(
    `SELECT id, order_id, actor_user_id, action,
            from_payment_status, to_payment_status,
            from_fulfillment_status, to_fulfillment_status,
            reason, metadata, created_at
       FROM order_lifecycle_events
      WHERE domain = ? AND order_id IN (${placeholders})
      ORDER BY id ASC`,
    [GENERAL_ORDER_SOURCE, ...ids]
  );
  for (const event of events || []) {
    const orderId = Number(event.order_id);
    if (!lifecycleByOrder.has(orderId)) lifecycleByOrder.set(orderId, []);
    lifecycleByOrder.get(orderId).push(event);
  }
  return { ticketsByOrder, lifecycleByOrder };
}

async function claimActionIdempotency(conn, { actorUserId, operation, resourceId, key, hash }) {
  const [inserted] = await conn.query(
    `INSERT IGNORE INTO order_action_idempotency
      (actor_user_id, operation, resource_id, request_key, request_hash, status)
     VALUES (?, ?, ?, ?, ?, 'processing')`,
    [actorUserId, operation, resourceId, key, hash]
  );
  if (Number(inserted?.affectedRows || 0) === 1) return { claimed: true };
  const [rows] = await conn.query(
    `SELECT resource_id, request_hash, status, response_json
       FROM order_action_idempotency
      WHERE actor_user_id = ? AND operation = ? AND request_key = ?
      LIMIT 1 FOR UPDATE`,
    [actorUserId, operation, key]
  );
  const row = rows?.[0];
  if (!row) throw lifecycleError('IDEMPOTENCY_IN_PROGRESS', '操作正在處理中', 409);
  if (Number(row.resource_id) !== Number(resourceId) || String(row.request_hash || '') !== hash) {
    throw lifecycleError('IDEMPOTENCY_KEY_REUSED', '此 Idempotency-Key 已被不同操作使用', 409);
  }
  const response = safeJson(row.response_json, null);
  if (row.status === 'completed' && response?.ok === true) return { claimed: false, response };
  throw lifecycleError('IDEMPOTENCY_IN_PROGRESS', '操作正在處理中', 409);
}

async function completeActionIdempotency(conn, { actorUserId, operation, key, response }) {
  await conn.query(
    `UPDATE order_action_idempotency
        SET status = 'completed', response_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE actor_user_id = ? AND operation = ? AND request_key = ?`,
    [JSON.stringify(response), actorUserId, operation, key]
  );
}

function nextStateForAction(action, current, callbackResult = {}) {
  if (action === 'mark-reviewing') return { paymentStatus: 'reviewing', fulfillmentStatus: 'pending' };
  if (action === 'confirm-payment' || action === 'retry-fulfillment') {
    return { paymentStatus: 'paid', fulfillmentStatus: callbackResult.fulfillmentStatus || 'fulfilled' };
  }
  if (action === 'cancel') {
    return { paymentStatus: 'cancelled', fulfillmentStatus: callbackResult.fulfillmentStatus || 'pending' };
  }
  return { paymentStatus: 'refunded', fulfillmentStatus: 'voided' };
}

function createGeneralOrderActionExecutor({
  pool,
  isAdmin,
  canManage,
  fulfillOrder,
  cancelOrder,
  refundOrder,
  afterCommit,
} = {}) {
  if (!pool?.getConnection) throw new TypeError('pool.getConnection is required');

  async function runAction({ orderId, action, actor, expectedVersion, idempotencyKey, body = {} }) {
    const normalizedOrderId = Number(orderId);
    if (!Number.isSafeInteger(normalizedOrderId) || normalizedOrderId < 1) {
      throw lifecycleError('ORDER_NOT_FOUND', '找不到訂單', 404);
    }
    if (!GENERAL_ORDER_ACTIONS.includes(action)) {
      throw lifecycleError('ORDER_ACTION_UNSUPPORTED', '不支援的訂單操作', 400);
    }
    const version = Number(expectedVersion);
    if (!Number.isSafeInteger(version) || version < 1) {
      throw lifecycleError('PRECONDITION_REQUIRED', '缺少有效的訂單版本', 428);
    }
    const key = normalizeIdempotencyKey(idempotencyKey);
    const reason = String(body?.reason || '').trim().slice(0, 500);
    const normalizedBody = {
      ...(body || {}),
      reason,
      refundReference: String(body?.refundReference || '').trim().slice(0, 128) || undefined,
    };
    if (['refund', 'retry-fulfillment'].includes(action) && !reason) {
      throw lifecycleError('ORDER_ACTION_REASON_REQUIRED', '此操作必須填寫原因', 400);
    }
    if (action === 'refund' && !normalizedBody.refundReference) {
      throw lifecycleError('ORDER_REFUND_REFERENCE_REQUIRED', '退款必須填寫退款參考資訊', 400);
    }
    const actorUserId = String(actor?.id || '').trim();
    if (!actorUserId) throw lifecycleError('UNAUTHORIZED', '尚未登入', 401);
    const operation = `${GENERAL_ORDER_SOURCE}:${action}`;
    const hash = requestHash({ orderId: normalizedOrderId, action, expectedVersion: version, body: normalizedBody });
    const conn = await pool.getConnection();
    let callbackResult = {};
    let response;
    try {
      await conn.beginTransaction();
      const claim = await claimActionIdempotency(conn, {
        actorUserId,
        operation,
        resourceId: normalizedOrderId,
        key,
        hash,
      });
      if (claim.response) {
        await conn.commit();
        return { ...claim.response, replayed: true };
      }

      const [rows] = await conn.query('SELECT * FROM orders WHERE id = ? LIMIT 1 FOR UPDATE', [normalizedOrderId]);
      if (!rows.length) throw lifecycleError('ORDER_NOT_FOUND', '找不到訂單', 404);
      const order = rows[0];
      const current = readCanonicalOrderState(order);
      if (!(isAdmin?.(actor?.role)) && !(await canManage?.(conn, current.details, actorUserId, order))) {
        throw lifecycleError('FORBIDDEN', '無權限操作此訂單', 403);
      }
      if (current.rowVersion !== version) {
        throw lifecycleError('ORDER_VERSION_CONFLICT', '訂單已被更新，請重新載入', 409, {
          expectedVersion: version,
          currentVersion: current.rowVersion,
        });
      }
      assertActionAllowed(action, current);
      const details = safeJson(JSON.stringify(current.details), {});

      if (action === 'confirm-payment' || action === 'retry-fulfillment') {
        callbackResult = await fulfillOrder(conn, order, details, { action, actor, body: normalizedBody, current }) || {};
      } else if (action === 'cancel') {
        callbackResult = await cancelOrder(conn, order, details, { action, actor, body: normalizedBody, current }) || {};
      } else if (action === 'refund') {
        callbackResult = await refundOrder(conn, order, details, { action, actor, body: normalizedBody, current }) || {};
      }

      const next = nextStateForAction(action, current, callbackResult);
      details.status = legacyStatusForPayment(next.paymentStatus);
      details.lifecycleUpdatedAt = new Date().toISOString();
      details.lifecycleUpdatedBy = actorUserId;
      details.rowVersion = current.rowVersion + 1;
      const [updated] = await conn.query(
        `UPDATE orders
            SET details = ?, payment_status = ?, fulfillment_status = ?,
                row_version = row_version + 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND row_version = ?`,
        [JSON.stringify(details), next.paymentStatus, next.fulfillmentStatus, normalizedOrderId, current.rowVersion]
      );
      if (Number(updated?.affectedRows || 0) !== 1) {
        throw lifecycleError('ORDER_VERSION_CONFLICT', '訂單已被更新，請重新載入', 409);
      }
      await conn.query(
        `INSERT INTO order_lifecycle_events
          (domain, order_id, actor_user_id, action,
           from_payment_status, to_payment_status,
           from_fulfillment_status, to_fulfillment_status,
           reason, idempotency_key, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          GENERAL_ORDER_SOURCE,
          normalizedOrderId,
          actorUserId,
          action,
          current.paymentStatus,
          next.paymentStatus,
          current.fulfillmentStatus,
          next.fulfillmentStatus,
          reason || null,
          key,
          JSON.stringify({ ...(callbackResult.metadata || {}), refundReference: normalizedBody.refundReference || null }),
        ]
      );
      const [updatedRows] = await conn.query('SELECT * FROM orders WHERE id = ? LIMIT 1', [normalizedOrderId]);
      const relations = await loadGeneralOrderRelations(conn, [normalizedOrderId]);
      const dto = mapGeneralOrderDto(updatedRows[0], {
        tickets: relations.ticketsByOrder.get(normalizedOrderId) || [],
        lifecycle: relations.lifecycleByOrder.get(normalizedOrderId) || [],
      });
      response = { ok: true, message: '訂單操作已完成', data: dto, replayed: false };
      await completeActionIdempotency(conn, { actorUserId, operation, key, response });
      await conn.commit();
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      throw error;
    } finally {
      conn.release();
    }

    if (typeof afterCommit === 'function') {
      let notification;
      try {
        notification = await afterCommit({
          order: response.data,
          action,
          actor,
          body: normalizedBody,
          callbackResult,
        });
      } catch (error) {
        notification = { sent: false, reason: error?.message || 'send_error' };
      }
      response.notification = notification || { sent: false, reason: 'not_configured' };
      try {
        await pool.query(
          `UPDATE order_action_idempotency
              SET response_json = ?, updated_at = CURRENT_TIMESTAMP
            WHERE actor_user_id = ? AND operation = ? AND request_key = ?`,
          [JSON.stringify(response), actorUserId, operation, key]
        );
      } catch (_) {}
    }
    return response;
  }

  async function runBulk({ action, actor, idempotencyKey, items = [], body = {} }) {
    const key = normalizeIdempotencyKey(idempotencyKey);
    if (!GENERAL_ORDER_ACTIONS.includes(action)) {
      throw lifecycleError('ORDER_ACTION_UNSUPPORTED', '不支援的訂單操作', 400);
    }
    if (!Array.isArray(items) || !items.length) {
      throw lifecycleError('VALIDATION_ERROR', '批次操作至少需要一筆訂單', 400);
    }
    const normalizedIds = items.map((item) => Number(item?.id));
    if (normalizedIds.some((id) => !Number.isSafeInteger(id) || id < 1)) {
      throw lifecycleError('VALIDATION_ERROR', '批次操作包含無效的訂單編號', 400);
    }
    if (new Set(normalizedIds).size !== normalizedIds.length) {
      throw lifecycleError('DUPLICATE_ORDER_IDS', '批次操作不可重複指定同一筆訂單', 400);
    }
    const results = [];
    for (const item of items) {
      const itemId = Number(item?.id);
      const derivedKey = createHash('sha256')
        .update(`${key}:${action}:${itemId}`)
        .digest('hex');
      try {
        const result = await runAction({
          orderId: itemId,
          action,
          actor,
          expectedVersion: Number(item?.rowVersion ?? item?.row_version),
          idempotencyKey: derivedKey,
          body: { ...body, ...(item?.body || {}), reason: item?.reason ?? body?.reason },
        });
        results.push({
          id: itemId,
          ok: true,
          data: result.data,
          notification: result.notification || null,
          replayed: result.replayed === true,
        });
      } catch (error) {
        results.push({
          id: itemId || item?.id || null,
          ok: false,
          error: {
            code: error?.code || 'ORDER_ACTION_FAIL',
            message: error?.message || '訂單操作失敗',
            status: error?.statusCode || 500,
            data: error?.data,
          },
        });
      }
    }
    return {
      items: results,
      summary: {
        total: results.length,
        succeeded: results.filter((item) => item.ok).length,
        failed: results.filter((item) => !item.ok).length,
      },
    };
  }

  return { runAction, runBulk };
}

module.exports = {
  GENERAL_ORDER_SOURCE,
  GENERAL_ORDER_ACTIONS,
  PAYMENT_STATUSES,
  FULFILLMENT_STATUSES,
  legacyStatusForPayment,
  paymentStatusFromLegacy,
  readCanonicalOrderState,
  buildOrderCapabilities,
  buildOrderLineItems,
  assertActionAllowed,
  mapIssuedTicket,
  mapGeneralOrderDto,
  parseIfMatch,
  normalizeIdempotencyKey,
  loadGeneralOrderRelations,
  createGeneralOrderActionExecutor,
};
