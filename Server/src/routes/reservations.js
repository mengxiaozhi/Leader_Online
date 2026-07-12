const express = require('express');
const QRCode = require('qrcode');
const { detectImageMime, normalizeMime } = require('../utils/image-upload');

function buildReservationRoutes(ctx) {
  const router = express.Router();
  const {
    ok,
    fail,
    pool,
    storage,
    authRequired,
    isMailerReady,
    transporter,
    EMAIL_FROM_NAME,
    EMAIL_FROM_ADDRESS,
    PUBLIC_WEB_URL,
    normalizeEmail,
    escapeHtml,
    buildLeaderEmailHtml,
    reservationManagerOnly,
    scanAccessOnly,
    serviceProviderOnly,
    driverOnly,
    notifyLineByUserId,
    sendReservationStatusEmail,
    buildReservationStatusFlex,
    buildReservationProgressFlex,
    buildReservationFlexMessage,
    buildReservationSectionHtml,
    buildQrUrl,
    getReservationStageCode,
    sanitizeStageForPath,
    sanitizeReservationIdForPath,
    LINE_BOT_QR_MAX_LENGTH,
    parsePositiveInt,
    parseBoolean,
    parseBooleanParam,
    normalizePositiveInt,
    normalizeUserId,
    MAX_CHECKLIST_IMAGE_BYTES,
    CHECKLIST_PHOTO_LIMIT,
    CHECKLIST_ALLOWED_MIME,
    CHECKLIST_STAGE_KEYS,
    CHECKLIST_STAGES,
    getReservationChecklistDefinitions,
    persistReservationChecklistDefinitions,
    reservationHasEventIdColumn,
    reservationHasStoreIdColumn,
    isChecklistPhotoStorageEnabled,
    generateReservationStageCode,
    listChecklistPhotosBulk,
    hydrateReservationChecklists,
    ensureChecklistHasPhotos,
    insertReservationsBulk,
    ensureUserContactInfoReady,
    parseDataUri,
    checklistColumnByStage,
    isChecklistStage,
    ensureChecklistReservationAccess,
    buildChecklistStoragePath,
    normalizeChecklist,
    fetchReservationById,
    composeChecklistCompletionContent,
    zhReservationStatus,
    normalizeRole,
    isADMIN,
    isSTORE,
    isDRIVER,
    isDELIVERY_POINT,
    buildAdminReservationSummaries,
    notifyReservationStageChange,
    listEventStores,
    getEventById,
    invalidateEventStoresCache,
    isPublishedListingStatus,
    formatReservationDisplayId,
    summarizeReservationSchedule,
    composeReservationPaymentContent,
    detectChecklistPhotoStorageSupport,
    ensureReservationAssignmentsTable,
    listReservationAssignments,
    getDeliveryPointIdByUserId,
    listStoreDeliveryPointRows,
    syncReservationTasksForIds,
    listReservationTasksForAssignee,
    ensureReservationTransfersTable,
    reservationTransferBlockReason,
    getLineSubjectByUserId,
    linePush,
    buildTransferAcceptedForSenderFlex,
    buildTransferAcceptedForRecipientFlex,
    randomCode: makeRandomCode,
    safeParseJSON,
  } = ctx;
  const hasChecklistStorage = () => isChecklistPhotoStorageEnabled();
  const ADMIN_RESERVATION_STATUSES = ['service_booking', 'pre_dropoff', 'pre_pickup', 'post_dropoff', 'post_pickup', 'done'];

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

  function appendAdminReservationFilters(req, where, params) {
    const id = readAdminQueryText(req, 'id');
    const user = readAdminQueryText(req, 'user');
    const event = readAdminQueryText(req, 'event');
    const store = readAdminQueryText(req, 'store');
    const ticketType = readAdminQueryText(req, 'ticketType', 'ticket_type');
    const statuses = readAdminQueryList(req, 'statuses', 'statuses[]', 'status')
      .filter((status) => ADMIN_RESERVATION_STATUSES.includes(status));
    const reservedFrom = readAdminDate(req, 'reservedFrom', 'reserved_from');
    const reservedTo = readAdminDate(req, 'reservedTo', 'reserved_to');

    if (id) {
      where.push('CAST(r.id AS CHAR) LIKE ?');
      params.push(`%${id}%`);
    }
    if (user) {
      where.push('(u.username LIKE ? OR u.email LIKE ? OR CAST(r.user_id AS CHAR) LIKE ?)');
      params.push(`%${user}%`, `%${user}%`, `%${user}%`);
    }
    if (event) {
      where.push('(r.event LIKE ? OR e.title LIKE ? OR e.code LIKE ?)');
      params.push(`%${event}%`, `%${event}%`, `%${event}%`);
    }
    if (store) {
      where.push('(r.store LIKE ? OR s.name LIKE ? OR s.address LIKE ?)');
      params.push(`%${store}%`, `%${store}%`, `%${store}%`);
    }
    if (ticketType) {
      where.push('r.ticket_type LIKE ?');
      params.push(`%${ticketType}%`);
    }
    if (statuses.length) {
      where.push(`r.status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }
    if (reservedFrom) {
      where.push('r.reserved_at >= ?');
      params.push(reservedFrom);
    }
    if (reservedTo) {
      where.push('r.reserved_at < DATE_ADD(?, INTERVAL 1 DAY)');
      params.push(reservedTo);
    }
  }

  function mapAdminReservationSummary(row = {}) {
    const byStatus = {};
    for (const status of ADMIN_RESERVATION_STATUSES) byStatus[status] = Number(row?.[status] || 0);
    return { total: Number(row?.total || 0), byStatus, ...byStatus };
  }

  async function getUserProviderId(userId) {
    if (!userId) return null;
    try {
      const [rows] = await pool.query('SELECT provider_id FROM users WHERE id = ? LIMIT 1', [userId]);
      return rows?.[0]?.provider_id || null;
    } catch (_) {
      return null;
    }
  }

  async function isReservationAssignedToDriver(reservation, driverUserId) {
    const normalizedDriverId = normalizeUserId(driverUserId);
    if (!normalizedDriverId) return false;
    if (String(normalizeUserId(reservation?.driver_id ?? reservation?.driverId) || '') === String(normalizedDriverId)) {
      return true;
    }

    const reservationId = normalizePositiveInt(reservation?.id);
    if (!reservationId) return false;
    try {
      const [rows] = await pool.query(
        `SELECT id
           FROM reservation_tasks
          WHERE reservation_id = ?
            AND assignee_user_id = ?
            AND UPPER(assignee_role) = 'DRIVER'
            AND UPPER(COALESCE(status, 'OPEN')) <> 'CANCELLED'
          LIMIT 1`,
        [reservationId, normalizedDriverId]
      );
      return Array.isArray(rows) && rows.length > 0;
    } catch (err) {
      if (err?.code === 'ER_NO_SUCH_TABLE' || err?.code === 'ER_BAD_FIELD_ERROR') return false;
      throw err;
    }
  }

  async function canDriverAccessReservationTask(reservation, driverUserId) {
    if (await isReservationAssignedToDriver(reservation, driverUserId)) return true;

    const providerId = await getUserProviderId(driverUserId);
    if (!providerId) return false;
    return isReservationEventOwnedByProvider(reservation, providerId);
  }

  async function isReservationStoreOwnedBy(reservation, ownerUserId) {
    const storeId = normalizePositiveInt(reservation?.store_id ?? reservation?.storeId);
    if (!storeId || !ownerUserId) return false;
    try {
      const [rows] = await pool.query('SELECT id FROM event_stores WHERE id = ? AND owner_user_id = ? LIMIT 1', [storeId, ownerUserId]);
      return Array.isArray(rows) && rows.length > 0;
    } catch (err) {
      if (err?.code === 'ER_BAD_FIELD_ERROR') return false;
      throw err;
    }
  }

  async function isReservationEventOwnedByProvider(reservation, ownerUserId) {
    const eventId = normalizePositiveInt(reservation?.event_id ?? reservation?.eventId);
    if (!eventId || !ownerUserId) return false;
    const [rows] = await pool.query('SELECT id FROM events WHERE id = ? AND owner_user_id = ? LIMIT 1', [eventId, ownerUserId]);
    return Array.isArray(rows) && rows.length > 0;
  }

  async function isReservationDeliveryPointOwnedByUser(reservation, userId) {
    const reservationDeliveryPointId = normalizePositiveInt(reservation?.delivery_point_id ?? reservation?.deliveryPointId);
    if (!reservationDeliveryPointId || !userId) return false;
    const ownDeliveryPointId = await getDeliveryPointIdByUserId(userId);
    return !!ownDeliveryPointId && ownDeliveryPointId === reservationDeliveryPointId;
  }

  async function isReservationStageDeliveryPointOwnedByUser(reservation, userId, stage) {
    const ownDeliveryPointId = await getDeliveryPointIdByUserId(userId);
    if (!ownDeliveryPointId) return false;
    const normalizedStage = String(stage || reservation?.status || '').toLowerCase();
    if (normalizedStage === 'pre_dropoff') {
      return ownDeliveryPointId === normalizePositiveInt(reservation?.delivery_point_id ?? reservation?.deliveryPointId);
    }
    if (normalizedStage === 'post_dropoff') {
      return ownDeliveryPointId === normalizePositiveInt(reservation?.delivery_point_id ?? reservation?.deliveryPointId);
    }
    return isReservationDeliveryPointOwnedByUser(reservation, userId);
  }

  async function getStoreDeliveryPointId(conn, storeId) {
    const normalizedStoreId = normalizePositiveInt(storeId);
    if (!normalizedStoreId) return null;
    const rows = await listStoreDeliveryPointRows(conn, [normalizedStoreId]);
    const match = (Array.isArray(rows) ? rows : []).find((row) => Number(row.id) === normalizedStoreId);
    return normalizePositiveInt(match?.delivery_point_id);
  }

  async function validateAssignableDriver(conn, actor, rawDriverId) {
    const driverId = normalizeUserId(rawDriverId);
    if (!driverId) return null;
    const [rows] = await conn.query('SELECT id, role, provider_id, username, email FROM users WHERE id = ? LIMIT 1', [driverId]);
    if (!rows.length) {
      const err = new Error('找不到司機帳號');
      err.code = 'DRIVER_NOT_FOUND';
      throw err;
    }
    const driver = rows[0];
    const role = normalizeRole(driver.role || 'USER');
    if (role !== 'DRIVER') {
      const err = new Error('目標帳號不是司機');
      err.code = 'INVALID_DRIVER_ROLE';
      throw err;
    }
    if (!isADMIN(actor.role)) {
      const providerId = String(driver.provider_id || '');
      if (!providerId || providerId !== String(actor.id)) {
        const err = new Error('司機不屬於此服務商');
        err.code = 'FORBIDDEN_DRIVER_PROVIDER';
        throw err;
      }
    }
    return driver;
  }

  async function applyReservationDriverAssignment(conn, reservationIds = [], targetDriverId, actorUserId) {
    const ids = Array.from(new Set((Array.isArray(reservationIds) ? reservationIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0)));
    if (!ids.length) return { changed: false, action: null };

    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await conn.query(
      `SELECT id, driver_id
       FROM reservations
       WHERE id IN (${placeholders})
       ORDER BY id ASC`,
      ids
    );
    const normalizedTarget = normalizeUserId(targetDriverId);
    const currentRows = Array.isArray(rows) ? rows : [];
    const changed = currentRows.some((row) => String(row.driver_id || '') !== String(normalizedTarget || ''));
    if (!changed) return { changed: false, action: null };

    const currentDriverIds = Array.from(new Set(currentRows.map((row) => normalizeUserId(row.driver_id)).filter(Boolean)));
    let action = null;
    if (!normalizedTarget) action = 'unassign';
    else if (!currentDriverIds.length) action = 'assign';
    else action = 'reassign';

    await conn.query(`UPDATE reservations SET driver_id = ? WHERE id IN (${placeholders})`, [normalizedTarget, ...ids]);
    try {
      await ensureReservationAssignmentsTable();
      const values = ids.map((id) => [id, normalizedTarget, actorUserId, action]);
      await conn.query(
        'INSERT INTO reservation_assignments (reservation_id, driver_id, assigned_by, action) VALUES ?',
        [values]
      );
    } catch (err) {
      console.warn('reservation assignment log failed:', err?.message || err);
    }
    await syncReservationTasksForIds(conn, ids);
    return { changed: true, action };
  }

  router.get('/qr', async (req, res) => {
  const raw = req.query.data || req.query.text || '';
  const value = String(raw || '').trim();
  if (!value) {
    return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: '缺少 data 參數' });
  }
  if (value.length > LINE_BOT_QR_MAX_LENGTH) {
    return res.status(400).json({ ok: false, code: 'DATA_TOO_LONG', message: 'data 長度過長' });
  }
  try {
    const png = await QRCode.toBuffer(value, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 600,
      color: { dark: '#000000', light: '#ffffff' },
    });
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=300, immutable',
      'Content-Length': png.length,
    });
    res.end(png);
  } catch (err) {
    console.error('generateLineBotQr error:', err?.message || err);
    res.status(500).json({ ok: false, code: 'QR_GENERATE_FAIL', message: '產生 QR 失敗' });
  }
});

/** ======== Reservations（可選：建立每張「預約」） ======== */
router.get('/reservations/me', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM reservations WHERE user_id = ? ORDER BY reserved_at DESC, id DESC',
      [req.user.id]
    );
    const orderIds = Array.from(new Set(rows
      .map((row) => normalizePositiveInt(row.order_id))
      .filter((id) => Number.isFinite(id) && id > 0)));
    const orderDetailsMap = new Map();
    if (orderIds.length) {
      const placeholders = orderIds.map(() => '?').join(',');
      const [orderRows] = await pool.query(`SELECT id, details FROM orders WHERE id IN (${placeholders})`, orderIds);
      (orderRows || []).forEach((row) => {
        const id = normalizePositiveInt(row.id);
        if (id) orderDetailsMap.set(id, safeParseJSON(row.details, {}));
      });
    }
    const reservationIds = rows
      .map((row) => {
        const raw = row.id;
        if (raw === null || raw === undefined) return null;
        if (typeof raw === 'bigint') return raw.toString();
        const text = String(raw).trim();
        return /^\d+$/.test(text) ? text : null;
      })
      .filter(Boolean);
    const photoMap = await listChecklistPhotosBulk(reservationIds);
    const list = await Promise.all(rows.map(async (row) => {
      const checklists = await hydrateReservationChecklists(row, photoMap);
      const orderDetails = orderDetailsMap.get(normalizePositiveInt(row.order_id)) || {};
      const transferBlock = reservationTransferBlockReason(row, orderDetails);
      const stageChecklist = {};
      for (const stage of CHECKLIST_STAGE_KEYS) {
        const data = checklists[stage] || {};
        stageChecklist[stage] = {
          found: ensureChecklistHasPhotos(data),
          completed: !!data.completed,
        };
      }
      return {
        ...row,
        pre_dropoff_checklist: checklists.pre_dropoff,
        pre_pickup_checklist: checklists.pre_pickup,
        post_dropoff_checklist: checklists.post_dropoff,
        post_pickup_checklist: checklists.post_pickup,
        stage_checklist: stageChecklist,
        transferable: !transferBlock,
        transfer_block_code: transferBlock?.code || null,
        transfer_block_message: transferBlock?.message || null,
      };
    }));
    return ok(res, list);
  } catch (err) {
    return fail(res, 'RESERVATIONS_LIST_FAIL', err.message, 500);
  }
});

// Driver Reservations: list assigned reservations
router.get('/driver/reservations', driverOnly, async (req, res) => {
  try {
    const limit = parsePositiveInt(req.query.limit, 50, { min: 1, max: 200 });
    const offset = Math.max(0, parsePositiveInt(req.query.offset ?? req.query.skip ?? 0, 0, { min: 0 }));
    const includePhotos = parseBooleanParam(req.query.includePhotos ?? req.query.include_photos, false);
    const queryRaw = String(req.query.q || req.query.query || '').trim();
    const searchTerm = queryRaw ? `%${queryRaw}%` : null;
    const providerId = await getUserProviderId(req.user.id);
    const baseFrom = 'FROM reservations r JOIN users u ON u.id = r.user_id LEFT JOIN users d ON d.id = r.driver_id LEFT JOIN events e ON (e.id = r.event_id OR (r.event_id IS NULL AND e.id = (SELECT MAX(e2.id) FROM events e2 WHERE e2.title = r.event))) LEFT JOIN event_stores s ON s.id = r.store_id';
    const scopeClauses = ['r.driver_id = ?'];
    const scopeParams = [req.user.id];
    if (providerId) {
      scopeClauses.push('EXISTS (SELECT 1 FROM events scope_e WHERE scope_e.owner_user_id = ? AND (scope_e.id = r.event_id OR (r.event_id IS NULL AND scope_e.title = r.event)))');
      scopeParams.push(providerId);
    }
    const whereClauses = [...scopeClauses];
    const params = [...scopeParams];
    if (searchTerm) {
      whereClauses.push('(r.ticket_type LIKE ? OR r.store LIKE ? OR r.event LIKE ? OR u.username LIKE ? OR u.email LIKE ? OR r.status LIKE ? OR CAST(r.id AS CHAR) LIKE ?)');
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }
    appendAdminReservationFilters(req, whereClauses, params);
    const whereSql = `WHERE ${whereClauses.join(' AND ')}`;
    const scopeWhereSql = `WHERE ${scopeClauses.join(' AND ')}`;
    const [[countRow]] = await pool.query(`SELECT COUNT(DISTINCT r.id) AS total ${baseFrom} ${whereSql}`, params);
    const total = Number(countRow?.total || 0);
    const statusCountsSql = ADMIN_RESERVATION_STATUSES
      .map((status) => `COUNT(DISTINCT CASE WHEN r.status = '${status}' THEN r.id END) AS ${status}`)
      .join(', ');
    const [[summaryRow]] = await pool.query(
      `SELECT COUNT(DISTINCT r.id) AS total, ${statusCountsSql} ${baseFrom} ${scopeWhereSql}`,
      scopeParams
    );
    const [rows] = await pool.query(
      `SELECT r.*, u.username, u.email, d.username AS driver_username, d.email AS driver_email, e.location AS event_address, s.address AS store_address ${baseFrom} ${whereSql} ORDER BY r.reserved_at DESC, r.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const items = await buildAdminReservationSummaries(rows, { includePhotos });
    return ok(res, {
      items,
      meta: {
        total,
        limit,
        offset,
        hasMore: offset + items.length < total,
        query: queryRaw,
      },
      summary: mapAdminReservationSummary(summaryRow),
    });
  } catch (err) {
    return fail(res, 'DRIVER_RESERVATIONS_LIST_FAIL', err.message, 500);
  }
});

router.get('/tasks/me', authRequired, async (req, res) => {
  try {
    const role = normalizeRole(req.user?.role || 'USER');
    if (role !== 'DRIVER' && role !== 'DELIVERY_POINT') {
      return fail(res, 'FORBIDDEN', '需要司機或交車點權限', 403);
    }
    const taskRole = role === 'DELIVERY_POINT' ? 'DELIVERY_POINT' : 'DRIVER';
    const items = await listReservationTasksForAssignee(req.user.id, taskRole, { includeCompleted: true });
    return ok(res, items);
  } catch (err) {
    return fail(res, 'TASKS_LIST_FAIL', err.message, 500);
  }
});

// Service Provider: assign driver to reservation
router.patch('/provider/reservations/:id/driver', serviceProviderOnly, async (req, res) => {
  const reservationId = Number(req.params.id);
  if (!Number.isFinite(reservationId) || reservationId <= 0) {
    return fail(res, 'VALIDATION_ERROR', '預約編號不正確', 400);
  }
  const driverId = normalizeUserId(req.body?.driverId ?? req.body?.driver_id);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let rows;
    try {
      [rows] = await conn.query(
        `SELECT r.id, r.order_id, r.event_id, r.event, r.store_id,
                e.owner_user_id AS event_owner_user_id,
                s.owner_user_id AS store_owner_user_id
           FROM reservations r
           LEFT JOIN events e ON e.id = r.event_id
           LEFT JOIN event_stores s ON s.id = r.store_id
          WHERE r.id = ?
          LIMIT 1`,
        [reservationId]
      );
    } catch (err) {
      if (err?.code !== 'ER_BAD_FIELD_ERROR') throw err;
      [rows] = await conn.query(
        'SELECT r.id, NULL AS order_id, r.event_id, r.event, r.store_id, NULL AS event_owner_user_id, NULL AS store_owner_user_id FROM reservations r WHERE r.id = ? LIMIT 1',
        [reservationId]
      );
    }

    if (!rows.length) {
      await conn.rollback();
      return fail(res, 'RESERVATION_NOT_FOUND', '找不到預約', 404);
    }
    const reservation = rows[0];

    if (!isADMIN(req.user.role)) {
      const eventOwnerId = String(reservation.event_owner_user_id || '');
      const storeOwnerId = String(reservation.store_owner_user_id || '');
      const canManageEvent = (eventOwnerId && eventOwnerId === String(req.user.id))
        || await isReservationEventOwnedByProvider(reservation, req.user.id);
      const canManageStore = (storeOwnerId && storeOwnerId === String(req.user.id))
        || await isReservationStoreOwnedBy(reservation, req.user.id);
      if (!canManageEvent && !canManageStore) {
        await conn.rollback();
        return fail(res, 'FORBIDDEN', '無權限操作此預約', 403);
      }
    }

    const driver = await validateAssignableDriver(conn, req.user, driverId);
    const targetDriverId = driver?.id || null;

    await applyReservationDriverAssignment(conn, [reservationId], targetDriverId, req.user.id);
    await conn.commit();
    return ok(res, { id: reservationId, driver_id: targetDriverId }, targetDriverId ? '司機已指派' : '司機已取消指派');
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    if (err?.code === 'DRIVER_NOT_FOUND') return fail(res, 'DRIVER_NOT_FOUND', err.message || '找不到司機帳號', 404);
    if (err?.code === 'INVALID_DRIVER_ROLE') return fail(res, 'INVALID_DRIVER_ROLE', err.message || '目標帳號不是司機', 400);
    if (err?.code === 'FORBIDDEN_DRIVER_PROVIDER') return fail(res, 'FORBIDDEN', err.message || '司機不屬於此服務商', 403);
    return fail(res, 'RESERVATION_ASSIGN_DRIVER_FAIL', err.message, 500);
  } finally {
    conn.release();
  }
});

// Reservation assignment history
router.get('/reservations/:id/assignments', authRequired, async (req, res) => {
  const reservationId = Number(req.params.id);
  if (!Number.isFinite(reservationId) || reservationId <= 0) {
    return fail(res, 'VALIDATION_ERROR', '預約編號不正確', 400);
  }
  try {
    const [rows] = await pool.query(
      'SELECT r.id, r.driver_id, r.delivery_point_id, r.event_id, r.event, r.store_id, s.owner_user_id AS store_owner_user_id FROM reservations r LEFT JOIN event_stores s ON s.id = r.store_id WHERE r.id = ? LIMIT 1',
      [reservationId]
    );
    if (!rows.length) return fail(res, 'RESERVATION_NOT_FOUND', '找不到預約', 404);
    const reservation = rows[0];
    const role = normalizeRole(req.user?.role || 'USER');
    const isAdmin = isADMIN(role);
    const isDriver = role === 'DRIVER' && String(reservation.driver_id || '') === String(req.user.id);
    const isProvider = role === 'SERVICE_PROVIDER' && await isReservationEventOwnedByProvider(reservation, req.user.id);
    const isDeliveryPoint = role === 'DELIVERY_POINT' && await isReservationDeliveryPointOwnedByUser(reservation, req.user.id);
    if (!isAdmin && !isDriver && !isProvider && !isDeliveryPoint) return fail(res, 'FORBIDDEN', '無權限查看此預約指派紀錄', 403);

    const limit = parsePositiveInt(req.query.limit, 50, { min: 1, max: 200 });
    const paged = parseBooleanParam(req.query.paged, false);
    if (!paged) {
      const items = await listReservationAssignments(reservationId, { limit });
      return ok(res, items);
    }
    const cursor = normalizePositiveInt(req.query.cursor);
    const page = await listReservationAssignments(reservationId, { limit, cursor, withPageInfo: true });
    return ok(res, {
      items: page.items,
      meta: {
        limit,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      },
    });
  } catch (err) {
    return fail(res, 'RESERVATION_ASSIGNMENTS_FAIL', err.message, 500);
  }
});

router.post('/reservations', authRequired, (req, res) => (
  fail(res, 'DIRECT_RESERVATION_DISABLED', '請透過結帳流程建立預約', 410)
));

/** ======== Reservation Transfers ======== */
const RESERVATION_TRANSFER_CODE_PREFIX = 'RSV-';

// List completed reservation transfer records for the current user.
// The transfer table is the durable history source, so this also exposes
// transfers completed before the wallet record UI was added.
router.get('/reservations/logs', authRequired, async (req, res) => {
  try {
    await ensureReservationTransfersTable();
    const paged = parseBoolean(req.query?.paged, false);
    const defaultLimit = paged ? 50 : 100;
    const maxLimit = paged ? 200 : 500;
    const limit = Math.min(Math.max(parseInt(req.query?.limit || String(defaultLimit), 10) || defaultLimit, 1), maxLimit);
    const cursor = paged ? normalizePositiveInt(req.query?.cursor) : null;
    const where = [
      "rt.status = 'accepted'",
      '(rt.from_user_id = ? OR rt.to_user_id = ?)',
    ];
    const params = [req.user.id, req.user.id];
    if (cursor) {
      where.push('rt.id < ?');
      params.push(cursor);
    }
    const fetchLimit = paged ? limit + 1 : limit;
    const [rows] = await pool.query(
      `SELECT rt.id,
              rt.reservation_id,
              rt.from_user_id,
              rt.to_user_id,
              rt.to_user_email,
              rt.code,
              rt.status,
              rt.created_at,
              rt.updated_at,
              r.ticket_type,
              r.store,
              r.event,
              r.reserved_at,
              from_user.email AS from_email,
              to_user.email AS to_email
         FROM reservation_transfers rt
         LEFT JOIN reservations r ON r.id = rt.reservation_id
         LEFT JOIN users from_user ON from_user.id = rt.from_user_id
         LEFT JOIN users to_user ON to_user.id = rt.to_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY rt.id DESC
        LIMIT ?`,
      [...params, fetchLimit]
    );
    const hasMore = paged && rows.length > limit;
    const visibleRows = hasMore ? rows.slice(0, limit) : rows;
    const list = visibleRows.map((row) => ({
      id: row.id,
      record_type: 'reservation',
      reservation_id: row.reservation_id,
      user_id: req.user.id,
      action: String(row.from_user_id) === String(req.user.id) ? 'transferred_out' : 'transferred_in',
      status: row.status,
      meta: {
        method: row.code ? 'qr' : 'email',
        ticket_type: row.ticket_type || '',
        event: row.event || '',
        store: row.store || '',
        reserved_at: row.reserved_at || null,
        from_email: row.from_email || null,
        to_email: row.to_email || row.to_user_email || null,
      },
      created_at: row.updated_at || row.created_at,
    }));
    if (!paged) return ok(res, list);
    return ok(res, {
      items: list,
      meta: {
        limit,
        hasMore,
        nextCursor: hasMore && list.length ? Number(list[list.length - 1].id) : null,
      },
    });
  } catch (err) {
    return fail(res, 'RESERVATION_LOGS_FAIL', err.message, 500);
  }
});

async function findUserIdByEmail(email, connOrPool = pool) {
  const targetEmail = normalizeEmail(email);
  if (!targetEmail) return null;
  try {
    const [rows] = await connOrPool.query('SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [targetEmail]);
    return rows.length ? rows[0].id : null;
  } catch (_) {
    return null;
  }
}

function normalizeReservationTransferCode(raw) {
  return String(raw || '').trim().replace(/\s+/g, '').toUpperCase();
}

async function generateReservationTransferCode(connOrPool = pool) {
  await ensureReservationTransfersTable();
  for (;;) {
    const code = `${RESERVATION_TRANSFER_CODE_PREFIX}${makeRandomCode(10)}`;
    const [dup] = await connOrPool.query('SELECT id FROM reservation_transfers WHERE code = ? LIMIT 1', [code]);
    if (!dup.length) return code;
  }
}

async function expireOldReservationTransfers(connOrPool = pool) {
  try {
    await ensureReservationTransfersTable();
    await connOrPool.query(
      `UPDATE reservation_transfers
          SET status = 'expired'
        WHERE status = 'pending'
          AND (
            (code IS NOT NULL AND created_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE))
            OR (code IS NULL AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY))
          )`
    );
  } catch (_) { /* ignore */ }
}

async function hasPendingReservationTransfer(connOrPool, reservationId) {
  await ensureReservationTransfersTable();
  const [rows] = await connOrPool.query(
    'SELECT id FROM reservation_transfers WHERE reservation_id = ? AND status = "pending" LIMIT 1',
    [reservationId]
  );
  return rows.length > 0;
}

async function fetchReservationTransferCandidate(connOrPool, reservationId, { lock = false } = {}) {
  const lockSql = lock ? ' FOR UPDATE' : '';
  const [rows] = await connOrPool.query(
    `SELECT r.*, o.details AS order_details, o.code AS order_code
       FROM reservations r
       LEFT JOIN orders o ON o.id = r.order_id
      WHERE r.id = ?
      LIMIT 1${lockSql}`,
    [reservationId]
  );
  if (!rows.length) return null;
  const row = rows[0];
  row.order_details_parsed = safeParseJSON(row.order_details, {});
  return row;
}

function ensureReservationTransferAllowed(reservation, userId) {
  if (!reservation) return { code: 'RESERVATION_NOT_FOUND', message: '找不到預約', status: 404 };
  if (userId && String(reservation.user_id) !== String(userId)) {
    return { code: 'FORBIDDEN', message: '僅限持有人轉讓此預約', status: 403 };
  }
  return reservationTransferBlockReason(reservation, reservation.order_details_parsed || safeParseJSON(reservation.order_details, {}));
}

function reservationTransferLabel(reservation = {}) {
  const eventTitle = String(reservation.event || '預約').trim() || '預約';
  const ticketType = String(reservation.ticket_type || '').trim();
  return ticketType ? `${eventTitle} / ${ticketType}` : eventTitle;
}

async function sendReservationTransferNotificationEmail({ to, senderName, reservation, recipientExists }) {
  if (!isMailerReady()) return { mailed: false, reason: 'mailer_not_ready' };
  const targetEmail = normalizeEmail(to);
  if (!targetEmail) return { mailed: false, reason: 'no_email' };

  const webBase = (PUBLIC_WEB_URL || 'http://localhost:5173').replace(/\/$/, '');
  const actionUrl = recipientExists
    ? `${webBase}/wallet?tab=reservations`
    : `${webBase}/login?email=${encodeURIComponent(targetEmail)}&register=1`;
  const actionText = recipientExists ? '前往錢包查看轉讓' : '註冊並領取預約';
  const displaySender = String(senderName || '朋友').trim() || '朋友';
  const subject = '您收到一筆預約轉讓 - Leader Online';
  const detailRows = [
    ['轉讓人', displaySender],
    ['服務檔期', reservation?.event || '預約'],
    ['交車點資訊', reservation?.store || '-'],
    ['票券類型', reservation?.ticket_type || '-'],
    ['預約編號', formatReservationDisplayId(reservation?.id || '') || String(reservation?.id || '')],
  ];

  const html = buildLeaderEmailHtml({
    title: '您收到一筆預約轉讓',
    intro: `${displaySender} 將一筆預約轉讓給您。請使用 ${targetEmail} 登入或註冊 Leader Online，即可在錢包中查看這筆轉讓。`,
    actionUrl,
    actionText,
    childrenHtml: `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #d5dde8;border-radius:14px;overflow:hidden;margin:0 0 18px 0;">
        ${detailRows.map(([label, value], index) => `
          <tr>
            <td style="padding:12px 14px;${index < detailRows.length - 1 ? 'border-bottom:1px solid #d5dde8;' : ''}color:#64748b;width:32%;">${escapeHtml(label)}</td>
            <td style="padding:12px 14px;${index < detailRows.length - 1 ? 'border-bottom:1px solid #d5dde8;' : ''}font-weight:500;color:#1f2937;">${escapeHtml(value)}</td>
          </tr>
        `).join('')}
      </table>
      <p style="margin:0 0 16px 0;">若您已經有帳號，請直接登入並前往錢包處理轉讓；若尚未註冊，請使用此收件信箱建立帳號，系統會協助領取符合條件的預約。</p>
      <p style="margin:0;">若非您本人操作，可忽略此郵件。</p>
    `,
  });

  try {
    await transporter.sendMail({
      from: `${EMAIL_FROM_NAME} <${EMAIL_FROM_ADDRESS}>`,
      to: targetEmail,
      subject,
      html,
    });
    return { mailed: true };
  } catch (err) {
    console.error('sendReservationTransferNotificationEmail error:', err?.message || err);
    return { mailed: false, reason: err?.message || 'send_error' };
  }
}

async function completeReservationTransfer(conn, transfer, recipientUser) {
  const reservation = await fetchReservationTransferCandidate(conn, transfer.reservation_id, { lock: true });
  if (!reservation) return { error: { code: 'RESERVATION_NOT_FOUND', message: '預約不存在', status: 404 } };
  if (String(reservation.user_id) !== String(transfer.from_user_id)) {
    return { error: { code: 'TRANSFER_INVALID', message: '預約持有人已變更', status: 409 } };
  }
  const block = ensureReservationTransferAllowed(reservation, transfer.from_user_id);
  if (block) return { error: block };

  const [upd] = await conn.query(
    'UPDATE reservations SET user_id = ? WHERE id = ? AND user_id = ?',
    [recipientUser.id, reservation.id, transfer.from_user_id]
  );
  if (!upd.affectedRows) {
    return { error: { code: 'TRANSFER_CONFLICT', message: '轉讓競態，請重試', status: 409 } };
  }
  await conn.query('UPDATE reservation_transfers SET status = "accepted", to_user_id = COALESCE(to_user_id, ?) WHERE id = ?', [recipientUser.id, transfer.id]);
  await conn.query('UPDATE reservation_transfers SET status = "canceled" WHERE reservation_id = ? AND status = "pending" AND id <> ?', [reservation.id, transfer.id]);
  try { await syncReservationTasksForIds(conn, [reservation.id]); } catch (_) {}
  return { reservation };
}

async function notifyReservationTransferAccepted({ fromUserId, toUser, reservation }) {
  try {
    const label = `預約 ${reservationTransferLabel(reservation)}`;
    const lineFrom = await getLineSubjectByUserId(fromUserId);
    const lineTo = await getLineSubjectByUserId(toUser.id);
    if (lineFrom) await linePush(lineFrom, buildTransferAcceptedForSenderFlex(label, toUser?.username));
    if (lineTo) await linePush(lineTo, buildTransferAcceptedForRecipientFlex(label));
  } catch (_) {}
}

router.post('/reservations/transfers/initiate', authRequired, async (req, res) => {
  const reservationId = normalizePositiveInt(req.body?.reservationId ?? req.body?.reservation_id);
  const mode = String(req.body?.mode || '').trim().toLowerCase();
  if (!reservationId || !['email', 'qr'].includes(mode)) return fail(res, 'VALIDATION_ERROR', '參數錯誤', 400);

  const conn = await pool.getConnection();
  let emailPayload = null;
  try {
    await ensureReservationTransfersTable();
    await conn.beginTransaction();
    await expireOldReservationTransfers(conn);
    const reservation = await fetchReservationTransferCandidate(conn, reservationId, { lock: true });
    const block = ensureReservationTransferAllowed(reservation, req.user.id);
    if (block) {
      await conn.rollback();
      return fail(res, block.code, block.message, block.status);
    }
    if (await hasPendingReservationTransfer(conn, reservation.id)) {
      await conn.rollback();
      return fail(res, 'TRANSFER_EXISTS', '已有待處理的預約轉讓', 409);
    }

    if (mode === 'email') {
      const targetEmail = normalizeEmail(req.body?.email);
      if (!targetEmail) {
        await conn.rollback();
        return fail(res, 'VALIDATION_ERROR', '需提供對方 Email', 400);
      }
      if (targetEmail === normalizeEmail(req.user.email)) {
        await conn.rollback();
        return fail(res, 'VALIDATION_ERROR', '不可轉讓給自己', 400);
      }
      const toId = await findUserIdByEmail(targetEmail, conn);
      await conn.query(
        'INSERT INTO reservation_transfers (reservation_id, from_user_id, to_user_id, to_user_email, code, status) VALUES (?, ?, ?, ?, NULL, "pending")',
        [reservation.id, req.user.id, toId, targetEmail]
      );
      emailPayload = {
        to: targetEmail,
        senderName: req.user?.username || req.user?.email,
        reservation,
        recipientExists: Boolean(toId),
      };
      await conn.commit();
      try { await sendReservationTransferNotificationEmail(emailPayload); } catch (_) {}
      return ok(res, null, '已發起預約轉讓（等待對方接受）');
    }

    const code = await generateReservationTransferCode(conn);
    await conn.query(
      'INSERT INTO reservation_transfers (reservation_id, from_user_id, code, status) VALUES (?, ?, ?, "pending")',
      [reservation.id, req.user.id, code]
    );
    await conn.commit();
    return ok(res, { code }, '請出示 QR 給對方掃描立即轉讓');
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    return fail(res, 'RESERVATION_TRANSFER_INITIATE_FAIL', err.message, 500);
  } finally {
    conn.release();
  }
});

router.get('/reservations/transfers/incoming', authRequired, async (req, res) => {
  try {
    await ensureReservationTransfersTable();
    await expireOldReservationTransfers();
    const [rows] = await pool.query(
      `SELECT rt.*,
              r.user_id AS reservation_user_id,
              r.order_id,
              r.ticket_type,
              r.store,
              r.event,
              r.reserved_at,
              r.status AS reservation_status,
              r.pre_dropoff_checklist,
              r.pre_pickup_checklist,
              r.post_dropoff_checklist,
              r.post_pickup_checklist,
              o.details AS order_details,
              u.username AS from_username,
              u.email AS from_email
         FROM reservation_transfers rt
         JOIN reservations r ON r.id = rt.reservation_id
         LEFT JOIN orders o ON o.id = r.order_id
         JOIN users u ON u.id = rt.from_user_id
        WHERE rt.status = 'pending'
          AND (rt.to_user_id = ? OR (rt.to_user_id IS NULL AND LOWER(rt.to_user_email) = LOWER(?)))
        ORDER BY rt.created_at DESC, rt.id DESC`,
      [req.user.id, req.user.email || '']
    );
    const list = rows
      .map((row) => {
        const reservation = {
          id: row.reservation_id,
          user_id: row.reservation_user_id,
          order_id: row.order_id,
          status: row.reservation_status,
          pre_dropoff_checklist: row.pre_dropoff_checklist,
          pre_pickup_checklist: row.pre_pickup_checklist,
          post_dropoff_checklist: row.post_dropoff_checklist,
          post_pickup_checklist: row.post_pickup_checklist,
        };
        const block = reservationTransferBlockReason(reservation, safeParseJSON(row.order_details, {}));
        if (block) return null;
        return {
          id: row.id,
          reservation_id: row.reservation_id,
          from_user_id: row.from_user_id,
          to_user_id: row.to_user_id,
          to_user_email: row.to_user_email,
          code: row.code,
          status: row.status,
          created_at: row.created_at,
          updated_at: row.updated_at,
          from_username: row.from_username,
          from_email: row.from_email,
          ticket_type: row.ticket_type,
          store: row.store,
          event: row.event,
          reserved_at: row.reserved_at,
          reservation_status: row.reservation_status,
          type: 'reservation',
        };
      })
      .filter(Boolean);
    return ok(res, list);
  } catch (err) {
    return fail(res, 'INCOMING_RESERVATION_TRANSFERS_FAIL', err.message, 500);
  }
});

router.post('/reservations/transfers/:id/accept', authRequired, async (req, res) => {
  const id = normalizePositiveInt(req.params.id);
  if (!id) return fail(res, 'VALIDATION_ERROR', '參數錯誤', 400);
  const conn = await pool.getConnection();
  try {
    await ensureReservationTransfersTable();
    await conn.beginTransaction();
    await expireOldReservationTransfers(conn);
    const [rows] = await conn.query('SELECT * FROM reservation_transfers WHERE id = ? AND status = "pending" LIMIT 1 FOR UPDATE', [id]);
    if (!rows.length) { await conn.rollback(); return fail(res, 'TRANSFER_NOT_FOUND', '找不到待處理的預約轉讓', 404) }
    const transfer = rows[0];
    const myEmail = normalizeEmail(req.user.email);
    if (String(transfer.to_user_id || '') !== String(req.user.id) && normalizeEmail(transfer.to_user_email || '') !== myEmail) {
      await conn.rollback(); return fail(res, 'FORBIDDEN', '僅限被指定的帳號接受', 403)
    }
    if (String(transfer.from_user_id) === String(req.user.id)) {
      await conn.rollback(); return fail(res, 'FORBIDDEN', '不可自行接受', 403)
    }

    const result = await completeReservationTransfer(conn, transfer, req.user);
    if (result.error) {
      await conn.rollback();
      return fail(res, result.error.code, result.error.message, result.error.status || 400);
    }
    await conn.commit();
    await notifyReservationTransferAccepted({ fromUserId: transfer.from_user_id, toUser: req.user, reservation: result.reservation });
    return ok(res, null, '已接受並完成預約轉讓');
  } catch (err) {
    try { await conn.rollback() } catch (_) {}
    return fail(res, 'RESERVATION_TRANSFER_ACCEPT_FAIL', err.message, 500);
  } finally {
    conn.release();
  }
});

router.post('/reservations/transfers/:id/decline', authRequired, async (req, res) => {
  const id = normalizePositiveInt(req.params.id);
  if (!id) return fail(res, 'VALIDATION_ERROR', '參數錯誤', 400);
  try {
    await ensureReservationTransfersTable();
    await expireOldReservationTransfers();
    const [result] = await pool.query(
      'UPDATE reservation_transfers SET status = "declined" WHERE id = ? AND status = "pending" AND (to_user_id = ? OR LOWER(to_user_email) = LOWER(?))',
      [id, req.user.id, req.user.email || '']
    );
    if (!result.affectedRows) return fail(res, 'TRANSFER_NOT_FOUND', '找不到待處理的預約轉讓', 404);
    return ok(res, null, '已拒絕預約轉讓');
  } catch (err) {
    return fail(res, 'RESERVATION_TRANSFER_DECLINE_FAIL', err.message, 500);
  }
});

router.post('/reservations/transfers/claim_code', authRequired, async (req, res) => {
  const code = normalizeReservationTransferCode(req.body?.code);
  if (!code) return fail(res, 'VALIDATION_ERROR', '缺少驗證碼', 400);
  const conn = await pool.getConnection();
  try {
    await ensureReservationTransfersTable();
    await conn.beginTransaction();
    await expireOldReservationTransfers(conn);
    const [rows] = await conn.query('SELECT * FROM reservation_transfers WHERE code = ? AND status = "pending" LIMIT 1 FOR UPDATE', [code]);
    if (!rows.length) { await conn.rollback(); return fail(res, 'CODE_NOT_FOUND', '無效或已處理的預約轉讓碼', 404) }
    const transfer = rows[0];
    if (String(transfer.from_user_id) === String(req.user.id)) {
      await conn.rollback(); return fail(res, 'FORBIDDEN', '不可轉讓給自己', 403)
    }

    const result = await completeReservationTransfer(conn, transfer, req.user);
    if (result.error) {
      await conn.rollback();
      return fail(res, result.error.code, result.error.message, result.error.status || 400);
    }
    await conn.commit();
    await notifyReservationTransferAccepted({ fromUserId: transfer.from_user_id, toUser: req.user, reservation: result.reservation });
    return ok(res, null, '已完成預約轉讓');
  } catch (err) {
    try { await conn.rollback() } catch (_) {}
    return fail(res, 'RESERVATION_TRANSFER_CLAIM_FAIL', err.message, 500);
  } finally {
    conn.release();
  }
});

router.post('/reservations/transfers/cancel_pending', authRequired, async (req, res) => {
  const reservationId = normalizePositiveInt(req.body?.reservationId ?? req.body?.reservation_id);
  if (!reservationId) return fail(res, 'VALIDATION_ERROR', '參數錯誤', 400);
  try {
    await ensureReservationTransfersTable();
    const [rows] = await pool.query('SELECT id, user_id FROM reservations WHERE id = ? LIMIT 1', [reservationId]);
    if (!rows.length) return fail(res, 'RESERVATION_NOT_FOUND', '找不到預約', 404);
    if (String(rows[0].user_id) !== String(req.user.id)) return fail(res, 'FORBIDDEN', '僅限持有人取消', 403);
    await pool.query(
      'UPDATE reservation_transfers SET status = "canceled" WHERE reservation_id = ? AND from_user_id = ? AND status = "pending"',
      [reservationId, req.user.id]
    );
    return ok(res, null, '已取消待處理的預約轉讓');
  } catch (err) {
    return fail(res, 'RESERVATION_TRANSFER_CANCEL_FAIL', err.message, 500);
  }
});

router.post('/reservations/:id/checklists/:stage/photos', authRequired, async (req, res) => {
  const reservationId = Number(req.params.id);
  const stage = String(req.params.stage || '').toLowerCase();
  if (!Number.isFinite(reservationId) || reservationId <= 0) {
    return fail(res, 'VALIDATION_ERROR', '預約編號不正確', 400);
  }
  if (!isChecklistStage(stage)) {
    return fail(res, 'VALIDATION_ERROR', '僅支援出貨前/到貨後交付與取貨檢核', 400);
  }

  const access = await ensureChecklistReservationAccess(reservationId, req.user);
  if (!access.ok) {
    return fail(res, access.code, access.message, access.status);
  }
  if (!access.isOwner) {
    return fail(res, 'FORBIDDEN', '僅限本人可上傳檢核照片', 403);
  }

  const column = checklistColumnByStage(stage);
  if (!column) {
    return fail(res, 'VALIDATION_ERROR', '檢核階段不正確', 400);
  }

  const { data, name } = req.body || {};
  const parsed = parseDataUri(data);
  if (!parsed) {
    return fail(res, 'INVALID_IMAGE', '照片格式不正確，請重新拍攝上傳', 400);
  }
  if (!CHECKLIST_ALLOWED_MIME.has(parsed.mime)) {
    return fail(res, 'UNSUPPORTED_TYPE', '僅支援 JPG、PNG、WEBP、HEIC 圖片', 400);
  }
  if (detectImageMime(parsed.buffer) !== normalizeMime(parsed.mime)) {
    return fail(res, 'UNSUPPORTED_TYPE', '圖片內容與檔案格式不一致', 415);
  }
  if (parsed.buffer.length > MAX_CHECKLIST_IMAGE_BYTES) {
    return fail(res, 'FILE_TOO_LARGE', '照片尺寸過大，請壓縮後再上傳', 400);
  }

  if (!hasChecklistStorage()) {
    await detectChecklistPhotoStorageSupport().catch(() => {});
  }
  if (!hasChecklistStorage()) {
    return fail(res, 'STORAGE_PATH_UNAVAILABLE', '照片儲存尚未初始化，請稍後再試或聯繫客服', 500);
  }

  let storagePathRelative = null;
  let checksum = null;
  const extension = storage.mimeToExtension(parsed.mime);
  let attempts = 0;
  while (attempts < 5) {
    attempts += 1;
    const candidate = buildChecklistStoragePath(reservationId, stage, extension);
    try {
      await storage.writeBuffer(candidate, parsed.buffer, { mode: 0o600 });
      storagePathRelative = storage.normalizeRelativePath(candidate);
      checksum = storage.hashBuffer(parsed.buffer);
      break;
    } catch (err) {
      if (err?.code === 'EEXIST' && attempts < 5) {
        continue;
      }
      console.error('writeChecklistPhoto error:', err?.message || err);
      return fail(res, 'UPLOAD_FAIL', '上傳失敗，請稍後再試', 500);
    }
  }

  try {
    const [[countRow]] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM reservation_checklist_photos WHERE reservation_id = ? AND stage = ?',
      [reservationId, stage]
    );
    if (Number(countRow?.cnt || 0) >= CHECKLIST_PHOTO_LIMIT) {
      if (storagePathRelative) await storage.deleteFile(storagePathRelative).catch(() => {});
      return fail(res, 'PHOTO_LIMIT', `最多可上傳 ${CHECKLIST_PHOTO_LIMIT} 張照片`, 400);
    }

    const originalName = typeof name === 'string' ? name.slice(0, 255) : null;
    const insertSql = 'INSERT INTO reservation_checklist_photos (reservation_id, stage, mime, original_name, size, storage_path, checksum, data) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)';
    const insertParams = [reservationId, stage, parsed.mime, originalName, parsed.buffer.length, storagePathRelative, checksum];
    let insert;
    try {
      [insert] = await pool.query(insertSql, insertParams);
    } catch (err) {
      if (storagePathRelative) await storage.deleteFile(storagePathRelative).catch(() => {});
      throw err;
    }
    const photoId = insert.insertId;

    const current = normalizeChecklist(access.reservation[column]);
    const nextChecklistPersist = {
      items: current.items,
      completed: current.completed,
      completedAt: current.completedAt,
    };

    await pool.query(`UPDATE reservations SET ${column} = ? WHERE id = ? LIMIT 1`, [
      JSON.stringify(nextChecklistPersist),
      reservationId,
    ]);

    const updatedReservation = await fetchReservationById(reservationId);
    const checklists = await hydrateReservationChecklists(updatedReservation);
    const checklist = checklists[stage] || { items: [], photos: [], completed: false, completedAt: null };
    const photo = checklist.photos.find((p) => Number(p.id) === Number(photoId)) || null;

    return ok(res, { photo, checklist });
  } catch (err) {
    console.error('uploadChecklistPhoto error:', err?.message || err);
    if (storagePathRelative) await storage.deleteFile(storagePathRelative).catch(() => {});
    return fail(res, 'UPLOAD_FAIL', '上傳失敗，請稍後再試', 500);
  }
});

router.delete('/reservations/:id/checklists/:stage/photos/:photoId', authRequired, async (req, res) => {
  const reservationId = Number(req.params.id);
  const stage = String(req.params.stage || '').toLowerCase();
  const photoId = String(req.params.photoId || '');
  if (!Number.isFinite(reservationId) || reservationId <= 0 || !photoId) {
    return fail(res, 'VALIDATION_ERROR', '參數不正確', 400);
  }
  if (!isChecklistStage(stage)) {
    return fail(res, 'VALIDATION_ERROR', '僅支援出貨前/到貨後交付與取貨檢核', 400);
  }
  const access = await ensureChecklistReservationAccess(reservationId, req.user);
  if (!access.ok) return fail(res, access.code, access.message, access.status);
  if (!access.isOwner) return fail(res, 'FORBIDDEN', '僅限本人可刪除檢核照片', 403);

  const column = checklistColumnByStage(stage);
  if (!column) return fail(res, 'VALIDATION_ERROR', '檢核階段不正確', 400);
  const current = normalizeChecklist(access.reservation[column]);

  let storagePathForDeletion = null;
  if (hasChecklistStorage()) {
    try {
      const [[photoRow]] = await pool.query(
        'SELECT storage_path FROM reservation_checklist_photos WHERE reservation_id = ? AND stage = ? AND id = ? LIMIT 1',
        [reservationId, stage, photoId]
      );
      if (photoRow && photoRow.storage_path) {
        storagePathForDeletion = storage.toSafeRelativePath(photoRow.storage_path);
      }
    } catch (err) {
      console.warn('fetchChecklistPhotoForDeletion error:', err?.message || err);
    }
  }

  try {
    const [del] = await pool.query(
      'DELETE FROM reservation_checklist_photos WHERE reservation_id = ? AND stage = ? AND id = ? LIMIT 1',
      [reservationId, stage, photoId]
    );
    if (!del.affectedRows) {
      return fail(res, 'PHOTO_NOT_FOUND', '找不到要刪除的照片', 404);
    }

    const nextChecklistPersist = {
      items: current.items,
      completed: current.completed,
      completedAt: current.completedAt,
    };

    // 若已無照片，標記為未完成
    const [[remainingRow]] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM reservation_checklist_photos WHERE reservation_id = ? AND stage = ?',
      [reservationId, stage]
    );
    if (Number(remainingRow?.cnt || 0) === 0) {
      nextChecklistPersist.completed = false;
      nextChecklistPersist.completedAt = null;
    }

    await pool.query(`UPDATE reservations SET ${column} = ? WHERE id = ? LIMIT 1`, [
      JSON.stringify(nextChecklistPersist),
      reservationId,
    ]);

    const updatedReservation = await fetchReservationById(reservationId);
    const checklists = await hydrateReservationChecklists(updatedReservation);
    const checklist = checklists[stage] || { items: [], photos: [], completed: false, completedAt: null };
    if (storagePathForDeletion) await storage.deleteFile(storagePathForDeletion).catch(() => {});
    return ok(res, { removed: Number(photoId), checklist });
  } catch (err) {
    console.error('deleteChecklistPhoto error:', err?.message || err);
    return fail(res, 'DELETE_FAIL', '刪除失敗，請稍後再試', 500);
  }
});

router.get('/reservations/:id/checklists/:stage/photos/:photoId/raw', authRequired, async (req, res) => {
  const reservationId = Number(req.params.id);
  const stage = String(req.params.stage || '').toLowerCase();
  const photoId = String(req.params.photoId || '').trim();
  if (!Number.isFinite(reservationId) || reservationId <= 0 || !photoId) {
    return fail(res, 'VALIDATION_ERROR', '參數不正確', 400);
  }
  if (!isChecklistStage(stage)) {
    return fail(res, 'VALIDATION_ERROR', '僅支援出貨前/到貨後交付與取貨檢核', 400);
  }

  const access = await ensureChecklistReservationAccess(reservationId, req.user);
  if (!access.ok) {
    return fail(res, access.code, access.message, access.status);
  }

  try {
    const [[row]] = await pool.query(
      'SELECT id, reservation_id, stage, mime, size, storage_path, data FROM reservation_checklist_photos WHERE reservation_id = ? AND stage = ? AND id = ? LIMIT 1',
      [reservationId, stage, photoId]
    );
    if (!row) {
      return res.status(404).json({ ok: false, code: 'PHOTO_NOT_FOUND', message: '找不到照片' });
    }

    const mime = row.mime || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=300');

    if (hasChecklistStorage() && row.storage_path) {
      const rel = storage.toSafeRelativePath(row.storage_path);
      const sendStream = (streamFactory, label) => {
        const stream = streamFactory();
        stream.on('error', (err) => {
          console.error('streamChecklistPhoto error:', { err: err?.message || err, path: label });
          if (!res.headersSent) res.status(500).end();
          else res.destroy();
        });
        stream.pipe(res);
      };
      if (rel && await storage.fileExists(rel)) {
        const stat = await storage.getFileStat(rel);
        if (stat?.size) res.setHeader('Content-Length', stat.size);
        sendStream(() => storage.createReadStream(rel), rel);
        return;
      }
      console.warn('[checklists/photo] storage path missing or rejected', { reservationId, stage, path: row.storage_path, rel });
    }

    if (row.data) {
      const buffer = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
      res.setHeader('Content-Length', buffer.length);
      return res.end(buffer);
    }

    return res.status(404).json({ ok: false, code: 'PHOTO_CONTENT_MISSING', message: '照片內容不存在' });
  } catch (err) {
    console.error('serveChecklistPhoto error:', err?.message || err);
    return res.status(500).json({ ok: false, code: 'PHOTO_FETCH_FAIL', message: '讀取照片失敗' });
  }
});

router.patch('/reservations/:id/checklists/:stage', authRequired, async (req, res) => {
  const reservationId = Number(req.params.id);
  const stage = String(req.params.stage || '').toLowerCase();
  if (!Number.isFinite(reservationId) || reservationId <= 0) {
    return fail(res, 'VALIDATION_ERROR', '預約編號不正確', 400);
  }
  if (!isChecklistStage(stage)) {
    return fail(res, 'VALIDATION_ERROR', '僅支援出貨前/到貨後交付與取貨檢核', 400);
  }

  const access = await ensureChecklistReservationAccess(reservationId, req.user);
  if (!access.ok) return fail(res, access.code, access.message, access.status);
  if (!access.isOwner) return fail(res, 'FORBIDDEN', '僅限本人可更新檢核表', 403);

  const column = checklistColumnByStage(stage);
  if (!column) return fail(res, 'VALIDATION_ERROR', '檢核階段不正確', 400);
  const checklists = await hydrateReservationChecklists(access.reservation);
  const current = checklists[stage] || { items: [], photos: [], completed: false, completedAt: null };
  const wasCompleted = !!current.completed;

  const itemsInput = Array.isArray(req.body?.items) ? req.body.items : current.items;
  const items = itemsInput.map(item => {
    if (!item) return null;
    if (typeof item === 'string') return { label: item, checked: true };
    const label = typeof item.label === 'string' ? item.label : '';
    if (!label) return null;
    return { label: label.slice(0, 200), checked: !!item.checked };
  }).filter(Boolean);

  const requestedCompletion = req.body?.completed;
  if (requestedCompletion === true && !ensureChecklistHasPhotos(current)) {
    return fail(res, 'PHOTO_REQUIRED', '請至少上傳 1 張照片後再完成檢核', 400);
  }
  if (requestedCompletion === true && !items.every(item => item.checked)) {
    return fail(res, 'CHECKLIST_INCOMPLETE', '請勾選所有檢核項目後再完成', 400);
  }

  const nextChecklistPersist = {
    items,
    completed: current.completed,
    completedAt: current.completedAt,
  };

  if (requestedCompletion === true) {
    nextChecklistPersist.completed = true;
    if (!nextChecklistPersist.completedAt) nextChecklistPersist.completedAt = new Date().toISOString();
  } else if (requestedCompletion === false) {
    nextChecklistPersist.completed = false;
    nextChecklistPersist.completedAt = null;
  }

  try {
    await pool.query(`UPDATE reservations SET ${column} = ? WHERE id = ? LIMIT 1`, [
      JSON.stringify(nextChecklistPersist),
      reservationId,
    ]);
    const updatedReservation = await fetchReservationById(reservationId);
    const updatedChecklists = await hydrateReservationChecklists(updatedReservation);
    const checklist = updatedChecklists[stage] || { items: [], photos: [], completed: false, completedAt: null };
    if (!wasCompleted && checklist.completed) {
      try {
        const context = await fetchReservationContext(reservationId);
        const notice = composeChecklistCompletionContent({ context: context || { reservation: updatedReservation }, stage });
        let to = '';
        try {
          const [rowsMail] = await pool.query('SELECT email FROM users WHERE id = ? LIMIT 1', [updatedReservation.user_id]);
          to = rowsMail?.[0]?.email || '';
        } catch (_) { to = ''; }
        await sendReservationStatusEmail({
          to,
          eventTitle: context?.event?.title || updatedReservation.event || '預約',
          store: context?.store?.name || updatedReservation.store || '交車點資訊',
          statusZh: zhReservationStatus(stage),
          userId: updatedReservation.user_id,
          lineMessages: notice?.lineMessages,
          emailSubject: notice?.emailSubject,
          emailHtml: notice?.emailHtml,
        });
      } catch (err) {
        console.error('checklist completion notify error:', err?.message || err);
      }
    }
    return ok(res, { checklist });
  } catch (err) {
    console.error('updateChecklist error:', err?.message || err);
    return fail(res, 'CHECKLIST_UPDATE_FAIL', '更新檢核表失敗', 500);
  }
});

// Admin Reservations: list all (with pagination & optional photos)
router.get('/admin/reservations', reservationManagerOnly, async (req, res) => {
  try {
    const defaultLimit = 50;
    const limit = parsePositiveInt(req.query.limit, defaultLimit, { min: 1, max: 200 });
    const offsetRaw = req.query.offset ?? req.query.skip ?? 0;
    const offset = Math.max(0, parsePositiveInt(offsetRaw, 0, { min: 0 }));
    const includePhotos = parseBooleanParam(req.query.includePhotos ?? req.query.include_photos, false);
    const queryRaw = String(req.query.q || req.query.query || '').trim();
    const searchTerm = queryRaw ? `%${queryRaw}%` : null;
    const numericSearchId = queryRaw && /^\d+$/.test(queryRaw) ? Number(queryRaw) : null;

    const role = normalizeRole(req.user.role || 'USER');
    const isAdmin = isADMIN(role);
    const isDeliveryPoint = isDELIVERY_POINT(role);
    const baseFrom = 'FROM reservations r JOIN users u ON u.id = r.user_id LEFT JOIN users d ON d.id = r.driver_id LEFT JOIN events e ON (e.id = r.event_id OR (r.event_id IS NULL AND e.id = (SELECT MAX(e2.id) FROM events e2 WHERE e2.title = r.event))) LEFT JOIN event_stores s ON s.id = r.store_id';

    const scopeClauses = [];
    const scopeParams = [];
    if (!isAdmin) {
      if (isDeliveryPoint) {
        const deliveryPointId = await getDeliveryPointIdByUserId(req.user.id);
        if (!deliveryPointId) {
          return ok(res, {
            items: [],
            meta: { total: 0, limit, offset, hasMore: false, query: queryRaw },
            summary: mapAdminReservationSummary(),
          });
        }
        scopeClauses.push('r.delivery_point_id = ?');
        scopeParams.push(deliveryPointId);
      } else {
        scopeClauses.push('EXISTS (SELECT 1 FROM events scope_e WHERE scope_e.owner_user_id = ? AND (scope_e.id = r.event_id OR (r.event_id IS NULL AND scope_e.title = r.event)))');
        scopeParams.push(req.user.id);
      }
    }
    const whereClauses = [...scopeClauses];
    const params = [...scopeParams];
    if (searchTerm) {
      const clauseParts = [
        'r.ticket_type LIKE ?',
        'r.store LIKE ?',
        'r.event LIKE ?',
        'u.username LIKE ?',
        'u.email LIKE ?',
        'r.status LIKE ?',
        'CAST(r.id AS CHAR) LIKE ?',
      ];
      const clauseParams = [
        searchTerm,
        searchTerm,
        searchTerm,
        searchTerm,
        searchTerm,
        searchTerm,
        searchTerm,
      ];
      if (numericSearchId !== null && Number.isFinite(numericSearchId)) {
        clauseParts.push('r.id = ?');
        clauseParams.push(numericSearchId);
      }
      whereClauses.push(`(${clauseParts.join(' OR ')})`);
      params.push(...clauseParams);
    }
    appendAdminReservationFilters(req, whereClauses, params);
    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const scopeWhereSql = scopeClauses.length ? `WHERE ${scopeClauses.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(DISTINCT r.id) AS total ${baseFrom} ${whereSql}`;
    const [[countRow]] = await pool.query(countSql, params);
    const total = Number(countRow?.total || 0);

    const statusCountsSql = ADMIN_RESERVATION_STATUSES
      .map((status) => `COUNT(DISTINCT CASE WHEN r.status = '${status}' THEN r.id END) AS ${status}`)
      .join(', ');
    const [[summaryRow]] = await pool.query(
      `SELECT COUNT(DISTINCT r.id) AS total, ${statusCountsSql} ${baseFrom} ${scopeWhereSql}`,
      scopeParams
    );
    const summary = mapAdminReservationSummary(summaryRow);

    const listSql = `SELECT r.*, u.username, u.email, d.username AS driver_username, d.email AS driver_email, e.location AS event_address, s.address AS store_address ${baseFrom} ${whereSql} ORDER BY r.reserved_at DESC, r.id DESC LIMIT ? OFFSET ?`;
    const listParams = [...params, limit, offset];
    const [rows] = await pool.query(listSql, listParams);
    const items = await buildAdminReservationSummaries(rows, { includePhotos });

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
    return fail(res, 'ADMIN_RESERVATIONS_LIST_FAIL', err.message, 500);
  }
});

// Admin Reservations: fetch single reservation with detailed checklists/photos
router.get('/admin/reservations/:id/checklists', reservationManagerOnly, async (req, res) => {
  const reservationId = Number(req.params.id);
  if (!Number.isFinite(reservationId) || reservationId <= 0) {
    return fail(res, 'VALIDATION_ERROR', '預約編號不正確', 400);
  }
  const includePhotos = parseBooleanParam(req.query.includePhotos ?? req.query.include_photos, true);
  try {
    let rows;
    const role = normalizeRole(req.user.role || 'USER');
    if (isADMIN(role)) {
      [rows] = await pool.query(
        'SELECT r.*, u.username, u.email, d.username AS driver_username, d.email AS driver_email, e.location AS event_address, s.address AS store_address FROM reservations r JOIN users u ON u.id = r.user_id LEFT JOIN users d ON d.id = r.driver_id LEFT JOIN events e ON (e.id = r.event_id OR e.title = r.event) LEFT JOIN event_stores s ON s.id = r.store_id WHERE r.id = ? LIMIT 1',
        [reservationId]
      );
    } else if (isDELIVERY_POINT(role)) {
      const deliveryPointId = await getDeliveryPointIdByUserId(req.user.id);
      if (!deliveryPointId) return fail(res, 'RESERVATION_NOT_FOUND', '找不到預約', 404);
      [rows] = await pool.query(
        'SELECT r.*, u.username, u.email, d.username AS driver_username, d.email AS driver_email, e.location AS event_address, s.address AS store_address FROM reservations r JOIN users u ON u.id = r.user_id LEFT JOIN users d ON d.id = r.driver_id LEFT JOIN events e ON (e.id = r.event_id OR e.title = r.event) LEFT JOIN event_stores s ON s.id = r.store_id WHERE r.id = ? AND r.delivery_point_id = ? LIMIT 1',
        [reservationId, deliveryPointId]
      );
    } else {
      [rows] = await pool.query(
        'SELECT r.*, u.username, u.email, d.username AS driver_username, d.email AS driver_email, e.location AS event_address, s.address AS store_address FROM reservations r JOIN users u ON u.id = r.user_id LEFT JOIN users d ON d.id = r.driver_id LEFT JOIN events e ON (e.id = r.event_id OR e.title = r.event) LEFT JOIN event_stores s ON s.id = r.store_id WHERE r.id = ? AND e.owner_user_id = ? LIMIT 1',
        [reservationId, req.user.id]
      );
    }
    if (!rows.length) return fail(res, 'RESERVATION_NOT_FOUND', '找不到預約', 404);

    const [item] = await buildAdminReservationSummaries(rows, { includePhotos });
    return ok(res, item);
  } catch (err) {
    return fail(res, 'ADMIN_RESERVATION_GET_FAIL', err.message, 500);
  }
});

// Admin Reservations: update status (six-stage flow)
router.patch('/admin/reservations/:id/status', reservationManagerOnly, async (req, res) => {
  const { status } = req.body || {};
  const allowed = ['service_booking', 'pre_dropoff', 'pre_pickup', 'post_dropoff', 'post_pickup', 'done'];
  if (!allowed.includes(status)) return fail(res, 'VALIDATION_ERROR', '不支援的狀態', 400);

  // Helper: generate a 6-digit code that is unique across all stage columns
  async function generateStageCode() {
    return generateReservationStageCode(pool);
  }

  try {
    const [rows] = await pool.query('SELECT * FROM reservations WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows.length) return fail(res, 'RESERVATION_NOT_FOUND', '找不到預約', 404);
    const cur = rows[0];
    if (isSTORE(req.user.role)) {
      const allowed = await isReservationEventOwnedByProvider(cur, req.user.id);
      if (!allowed) return fail(res, 'FORBIDDEN', '無權限操作此預約', 403);
    } else if (isDELIVERY_POINT(req.user.role)) {
      if (status !== 'pre_dropoff' && status !== 'post_dropoff') {
        return fail(res, 'FORBIDDEN', '交車點僅可操作賽前交車或賽後交車階段', 403);
      }
      const allowed = await isReservationStageDeliveryPointOwnedByUser(cur, req.user.id, status);
      if (!allowed) return fail(res, 'FORBIDDEN', '無權限操作此預約', 403);
    }

    const colMap = {
      pre_dropoff: 'verify_code_pre_dropoff',
      pre_pickup: 'verify_code_pre_pickup',
      post_dropoff: 'verify_code_post_dropoff',
      post_pickup: 'verify_code_post_pickup',
    };

    let stageCode = null;
    const col = colMap[status] || null;
    if (col) {
      // If current record has no code for this stage, generate one
      if (!cur[col]) stageCode = await generateStageCode();
      // Update only the column for the target stage
      const sql = `UPDATE reservations SET status = ?, ${col} = COALESCE(${col}, ?) WHERE id = ?`;
      await pool.query(sql, [status, stageCode || cur[col] || null, cur.id]);
    } else {
      await pool.query('UPDATE reservations SET status = ? WHERE id = ?', [status, cur.id]);
    }

    await syncReservationTasksForIds(pool, [cur.id]);

    // Backward compatibility: keep legacy verify_code in response if present
    const resp = { id: cur.id, status };
    if (col) resp[col] = stageCode || cur[col] || null;
    if (cur.verify_code) resp.verify_code = cur.verify_code;
    await notifyReservationStageChange(cur.id, status, cur);
    return ok(res, resp, '預約狀態已更新');
  } catch (err) {
    return fail(res, 'ADMIN_RESERVATION_STATUS_FAIL', err.message, 500);
  }
});

// Staff scan QR: progress reservation to next stage by stage-specific code
router.post('/admin/reservations/progress_scan', scanAccessOnly, async (req, res) => {
  const raw = (req.body?.code ?? '').toString().trim();
  if (!raw) return fail(res, 'VALIDATION_ERROR', '缺少驗證碼', 400);
  const code = raw.replace(/\s+/g, '');
  const confirmProgress = parseBooleanParam(
    req.body?.confirm ?? req.body?.confirmed ?? req.body?.confirmProgress,
    false
  );

  const normalizeStage = (status) => {
    const s = String(status || '').toLowerCase();
    if (!s || s === 'pending' || s === 'service_booking') return 'pre_dropoff';
    if (s === 'pickup') return 'pre_pickup';
    return status;
  };

  try {
    const [rows] = await pool.query(
      `SELECT * FROM reservations WHERE
         verify_code_pre_dropoff = ? OR
         verify_code_pre_pickup = ? OR
         verify_code_post_dropoff = ? OR
         verify_code_post_pickup = ?
       LIMIT 1`,
      [code, code, code, code]
    );
    if (!rows.length) return fail(res, 'CODE_NOT_FOUND', '查無對應預約或驗證碼', 404);
    const r = rows[0];

    // Determine which stage this code corresponds to
    let stage = null;
    if (r.verify_code_pre_dropoff === code) stage = 'pre_dropoff';
    else if (r.verify_code_pre_pickup === code) stage = 'pre_pickup';
    else if (r.verify_code_post_dropoff === code) stage = 'post_dropoff';
    else if (r.verify_code_post_pickup === code) stage = 'post_pickup';

    if (!stage) return fail(res, 'CODE_STAGE_MISMATCH', '驗證碼與狀態不符', 400);

    if (isSTORE(req.user.role)) {
      const allowed = await isReservationEventOwnedByProvider(r, req.user.id);
      if (!allowed) return fail(res, 'FORBIDDEN', '無權限操作此預約', 403);
    }
    if (isDELIVERY_POINT(req.user.role)) {
      if (stage !== 'pre_dropoff' && stage !== 'post_dropoff') {
        return fail(res, 'FORBIDDEN', '交車點僅可掃描賽前交車或賽後交車階段', 403);
      }
      const allowed = await isReservationStageDeliveryPointOwnedByUser(r, req.user.id, stage);
      if (!allowed) return fail(res, 'FORBIDDEN', '無權限操作此預約', 403);
    }
    if (isDRIVER(req.user.role)) {
      const allowed = await canDriverAccessReservationTask(r, req.user.id);
      if (!allowed) return fail(res, 'FORBIDDEN', '此任務未指派給此司機', 403);
    }

    // Must match current status to avoid out-of-order scans
    const currentStage = normalizeStage(r.status);
    if (currentStage !== stage) return fail(res, 'STATUS_NOT_MATCH', '預約不在此階段或已被處理', 409);

    const nextMap = {
      pre_dropoff: 'pre_pickup',
      pre_pickup: 'post_dropoff',
      post_dropoff: 'post_pickup',
      post_pickup: 'done',
    };
    const next = nextMap[stage] || null;
    if (!next) return fail(res, 'ALREADY_DONE', '已完成，無法再進入下一階段', 400);

    const checklists = await hydrateReservationChecklists(r, null, { includePhotos: true });
    const targetChecklist = checklists?.[stage] || { items: [], photos: [], completed: false, photoCount: 0 };
    const requiresChecklist = CHECKLIST_STAGE_KEYS.includes(stage);
    const checklistReady = requiresChecklist && ensureChecklistHasPhotos(targetChecklist) && !!targetChecklist.completed;
    const stageChecklistSummary = {};
    for (const key of CHECKLIST_STAGE_KEYS) {
      const entry = checklists?.[key] || { items: [], photos: [], completed: false, photoCount: 0 };
      const entryCount = Number(entry.photoCount);
      stageChecklistSummary[key] = {
        found: ensureChecklistHasPhotos(entry),
        completed: !!entry.completed,
        photoCount: Number.isFinite(entryCount) ? entryCount : (Array.isArray(entry.photos) ? entry.photos.length : 0),
      };
    }
    let ownerUsername = '';
    let ownerEmail = '';
    try {
      const [userRows] = await pool.query('SELECT username, email FROM users WHERE id = ? LIMIT 1', [r.user_id]);
      ownerUsername = userRows?.[0]?.username || '';
      ownerEmail = userRows?.[0]?.email || '';
    } catch (_) { ownerUsername = ownerUsername || ''; ownerEmail = ownerEmail || ''; }

    if (!confirmProgress) {
      return ok(res, {
        needsConfirmation: true,
        stage,
        nextStage: next,
        stageLabel: zhReservationStatus(stage),
        nextStageLabel: next ? zhReservationStatus(next) : '',
        checklistReady,
        requiresChecklist,
        code,
        reservation: {
          id: r.id,
          user_id: r.user_id,
          event: r.event,
          store: r.store,
          ticket_type: r.ticket_type,
          reserved_at: r.reserved_at,
          status: r.status,
          username: ownerUsername,
          email: ownerEmail,
        },
        checklist: targetChecklist,
        stageChecklist: stageChecklistSummary,
      }, '請確認檢核內容後繼續');
    }

    if (requiresChecklist && !checklistReady) {
      return fail(res, 'CHECKLIST_NOT_READY', '此階段檢核未完成或缺少照片', 422);
    }

    // Ensure next-stage code is generated (except for done)
    const colMap = {
      pre_dropoff: 'verify_code_pre_dropoff',
      pre_pickup: 'verify_code_pre_pickup',
      post_dropoff: 'verify_code_post_dropoff',
      post_pickup: 'verify_code_post_pickup',
    };
    const nextCol = colMap[next] || null;
    let nextCode = null;
    if (nextCol) {
      // Fetch latest row to check existing code
      const [rows2] = await pool.query('SELECT ?? AS v FROM reservations WHERE id = ? LIMIT 1', [nextCol, r.id]);
      const exists = rows2?.[0]?.v || null;
      if (!exists) nextCode = await generateReservationStageCode();
    }

    if (nextCol) {
      const sql = `UPDATE reservations SET status = ?, ${nextCol} = COALESCE(${nextCol}, ?) WHERE id = ?`;
      await pool.query(sql, [next, nextCode || null, r.id]);
    } else {
      await pool.query('UPDATE reservations SET status = ? WHERE id = ?', [next, r.id]);
    }

    await syncReservationTasksForIds(pool, [r.id]);

    await notifyReservationStageChange(r.id, next, { ...r, status: next });

    return ok(res, { id: r.id, from: stage, to: next, nextCode: nextCode || null }, '已進入下一階段');
  } catch (err) {
    return fail(res, 'RESERVATION_PROGRESS_SCAN_FAIL', err.message, 500);
  }
});

/** ======== Orders（隨機碼 code） ======== */
function randomCode(n = 10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 避免混淆字元
  let s = '';
  for (let i = 0; i < n; i++) s += alphabet[randomInt(0, alphabet.length)];
  return s;
}
async function generateOrderCode() {
  let code;
  for (; ;) {
    code = randomCode(10);
    const [dup] = await pool.query('SELECT id FROM orders WHERE code = ? LIMIT 1', [code]);
    if (!dup.length) break;
  }
  return code;
}

  return router;
}

module.exports = buildReservationRoutes;
