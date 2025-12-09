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
    parsePositiveInt,
    normalizePositiveInt,
    safeParseJSON,
    ensureRemittance,
    defaultRemittanceDetails,
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
    setAppSetting,
    deleteAppSetting,
    loadRemittanceConfig,
    getSitePages,
    DEFAULT_RESERVATION_CHECKLIST_DEFINITIONS,
    isADMIN,
    isSTORE,
    getUserContact,
    fetchReservationsContext,
  } = ctx;

  async function validateTicketsUsable(conn, userId, rawTickets = []) {
    const ids = Array.from(new Set((Array.isArray(rawTickets) ? rawTickets : [])
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0)));
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await conn.query(
      `
        SELECT id
        FROM tickets
        WHERE user_id = ?
          AND used = 0
          AND (expiry IS NULL OR expiry >= CURRENT_DATE())
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
    return ids;
  }

  router.get('/orders/me', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
    const data = rows.map((row) => {
      const details = ensureRemittance(safeParseJSON(row.details, {}));
      return { ...row, details: JSON.stringify(details) };
    });
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
      const details = safeParseJSON(it, {});
      const total = Number(details.total || 0);
      // 狀態：0 元強制完成，否則沿用或預設待匯款
      details.status = (total <= 0 ? '已完成' : (details.status || '待匯款'));
      ensureRemittance(details);
      const validatedTicketIds = await validateTicketsUsable(conn, req.user.id, details.ticketsUsed || []);

      const [r] = await conn.query('INSERT INTO orders (user_id, code, details) VALUES (?, ?, ?)', [req.user.id, code, JSON.stringify(details)]);
      const orderId = r.insertId;
      created.push({ id: orderId, code });
      createdSummaries.push({ id: orderId, code, total, status: details.status, remittance: details.remittance, detailsSummary: summarizeOrderDetails(details), detailsRaw: details });

      // 0 元訂單：自動完成並執行「完成時」副作用（發券/建預約/標記票券）
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
              const values = [];
              for (let i = 0; i < quantity; i++) values.push([req.user.id, ticketType, expiryStr, randomUUID(), 0, 0]);
              if (values.length) {
                const [ins] = await conn.query('INSERT INTO tickets (user_id, type, expiry, uuid, discount, used) VALUES ?;', [values]);
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
          const eventName = details?.event?.name || details?.event || null;
          const eventId = normalizePositiveInt(details?.event?.id ?? details?.event_id ?? details?.eventId);
          if (isReservationOrder && !details.reservations_granted) {
            const reservationRows = [];
            for (const sel of selections) {
              const qty = Number(sel.qty || sel.quantity || 0);
              const type = sel.type || sel.ticketType || '';
              const store = sel.store || '';
              const storeId = normalizePositiveInt(sel.storeId ?? sel.store_id ?? sel.storeID);
              for (let i = 0; i < qty; i++) {
                reservationRows.push({
                  userId: req.user.id,
                  ticketType: type,
                  storeName: store,
                  eventName: eventName || '',
                  eventId,
                  storeId,
                });
              }
            }
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
                   AND (expiry IS NULL OR expiry >= CURRENT_DATE())
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
    return fail(res, 'ORDER_CREATE_FAIL', err.message, 500);
  } finally {
    conn.release();
  }
});

// Admin Remittance Settings
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
router.get('/admin/orders', adminOnly, async (req, res) => {
  try {
    const defaultLimit = 50;
    const limit = parsePositiveInt(req.query.limit, defaultLimit, { min: 1, max: 200 });
    const offsetRaw = req.query.offset ?? req.query.skip ?? 0;
    const offset = Math.max(0, parsePositiveInt(offsetRaw, 0, { min: 0 }));
    const queryRaw = String(req.query.q || req.query.query || '').trim();
    const searchTerm = queryRaw ? `%${queryRaw}%` : null;

    const isAdmin = isADMIN(req.user.role);
    const baseFrom = isAdmin
      ? 'FROM orders o JOIN users u ON u.id = o.user_id'
      : 'FROM orders o JOIN users u ON u.id = o.user_id JOIN events e ON e.id = CAST(JSON_UNQUOTE(JSON_EXTRACT(o.details, \'$.event.id\')) AS UNSIGNED)';

    const where = [];
    const params = [];
    if (!isAdmin) {
      where.push('e.owner_user_id = ?');
      params.push(req.user.id);
    }
    if (searchTerm) {
      where.push(
        `(o.code LIKE ? OR u.username LIKE ? OR u.email LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(o.details, '$.ticketType')) LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(o.details, '$.event.name')) LIKE ? OR CAST(o.id AS CHAR) LIKE ?)`
      );
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) AS total ${baseFrom} ${whereSql}`;
    const [[countRow]] = await pool.query(countSql, params);
    const total = Number(countRow?.total || 0);

    const listSql = `SELECT o.id, o.code, o.details, o.created_at, u.id AS user_id, u.username, u.email, u.phone, u.remittance_last5 ${baseFrom} ${whereSql} ORDER BY o.id DESC LIMIT ? OFFSET ?`;
    const [rows] = await pool.query(listSql, [...params, limit, offset]);
    const items = rows.map((row) => ({
      id: row.id,
      code: row.code || '',
      created_at: row.created_at || null,
      user_id: row.user_id,
      username: row.username || '',
      email: row.email || '',
      phone: row.phone == null ? null : String(row.phone),
      remittance_last5: row.remittance_last5 == null ? null : String(row.remittance_last5),
      details: ensureRemittance(safeParseJSON(row.details, {})),
    }));

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

router.patch('/admin/orders/:id/status', adminOnly, async (req, res) => {
  const { status } = req.body || {};
  const allowed = ['待匯款', '處理中', '已完成'];
  if (!allowed.includes(status)) return fail(res, 'VALIDATION_ERROR', '不支援的狀態', 400);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query('SELECT * FROM orders WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows.length) {
      await conn.rollback();
      return fail(res, 'ORDER_NOT_FOUND', '找不到訂單', 404);
    }
    const order = rows[0];
    const details = ensureRemittance(safeParseJSON(order.details, {}));
    if (isSTORE(req.user.role)){
      const eventId = Number(details?.event?.id || 0);
      if (!eventId) { await conn.rollback(); return fail(res, 'FORBIDDEN', '僅能管理賽事預約訂單', 403); }
      const [own] = await conn.query('SELECT owner_user_id FROM events WHERE id = ? LIMIT 1', [eventId]);
      if (!own.length || String(own[0].owner_user_id || '') !== String(req.user.id)) { await conn.rollback(); return fail(res, 'FORBIDDEN', '無權限操作此訂單', 403); }
    }
    const prevStatus = details.status || '';
    const orderEventName = details?.event?.name || details?.event || null;
    const createdReservationIds = [];
    const newlyIssuedTickets = [];
    let reservationQuantityForOrder = 0;

    // 更新 details.status
    details.status = status;
    await conn.query('UPDATE orders SET details = ? WHERE id = ?', [JSON.stringify(details), order.id]);

    // 若由非「已完成」狀態 → 「已完成」，進行發券、建立預約與標記已用票券（避免重複發放/重複標記）
    if (status === '已完成' && prevStatus !== '已完成') {
      // 判斷是否為「預約型」訂單（有 selections 即視為預約，不發券）
      const selections = Array.isArray(details.selections) ? details.selections : [];
      const isReservationOrder = selections.length > 0;
      reservationQuantityForOrder = selections.reduce((sum, sel) => sum + Number(sel.qty || sel.quantity || 0), 0);

      // 發券（僅限非預約型的「票券型訂單」）
      if (!isReservationOrder) {
        const ticketType = details.ticketType || details?.event?.name || null;
        const quantity = Number(details.quantity || 0);
        if (!details.granted && ticketType && quantity > 0) {
          const today = new Date();
          const expiry = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());
          const expiryStr = formatDateYYYYMMDD(expiry);
          const values = [];
          const ticketMeta = [];
          for (let i = 0; i < quantity; i++) {
            const uuid = randomUUID();
            values.push([order.user_id, ticketType, expiryStr, uuid, 0, 0]);
            ticketMeta.push({ uuid, expiry: expiryStr, type: ticketType });
          }
          if (values.length) {
            const [ins3] = await conn.query('INSERT INTO tickets (user_id, type, expiry, uuid, discount, used) VALUES ?;', [values]);
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
        const reservationRows = [];
        for (const sel of selections) {
          const qty = Number(sel.qty || sel.quantity || 0);
          const type = sel.type || sel.ticketType || '';
          const store = sel.store || '';
          for (let i = 0; i < qty; i++) {
            reservationRows.push({
              userId: order.user_id,
              ticketType: type,
              storeName: store,
              eventName: orderEventName || '',
              eventId: normalizePositiveInt(order.details?.event?.id ?? order.details?.event_id ?? order.details?.eventId),
              storeId: normalizePositiveInt(sel.storeId ?? sel.store_id ?? sel.storeID),
            });
          }
        }
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
          } catch (_) { /* ignore legacy schema */ }
          details.reservations_granted = true;
          await conn.query('UPDATE orders SET details = ? WHERE id = ?', [JSON.stringify(details), order.id]);
        }
    }

    // 若使用既有票券（ticketsUsed），在此一次性標記為已使用
    const ticketsUsed = Array.isArray(details.ticketsUsed) ? details.ticketsUsed : [];
    if (!details.tickets_marked && ticketsUsed.length > 0) {
      const ids = await validateTicketsUsable(conn, order.user_id, ticketsUsed);
      if (ids.length) {
        const placeholders = ids.map(() => '?').join(',');
        const [upd] = await conn.query(
          `UPDATE tickets SET used = 1
           WHERE user_id = ?
             AND used = 0
             AND (expiry IS NULL OR expiry >= CURRENT_DATE())
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
      const shouldNotifyLine = status === '已完成';
      const shouldEmail = status === '已完成' && prevStatus !== '已完成';
      if (shouldNotifyLine || shouldEmail) {
        let reservationContexts = [];
        if (status === '已完成') {
          try {
            if (createdReservationIds.length) {
              reservationContexts = await fetchReservationsContext(createdReservationIds);
            } else if (!createdReservationIds.length && reservationQuantityForOrder > 0 && orderEventName) {
              const [rowsCtx] = await pool.query(
                'SELECT id FROM reservations WHERE user_id = ? AND event = ? ORDER BY id DESC LIMIT ?',
                [order.user_id, orderEventName, reservationQuantityForOrder]
              );
              const fallbackIds = rowsCtx.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
              if (fallbackIds.length) {
                reservationContexts = await fetchReservationsContext(fallbackIds);
              }
            }
          } catch (err) {
            console.error('reservation context fetch error:', err?.message || err);
          }
        }

        let completionNotice = null;
        if (status === '已完成') {
          completionNotice = composeReservationPaymentContent({
            contexts: reservationContexts,
            tickets: newlyIssuedTickets,
            orderSummary: { total: Number(details.total || 0) },
          });
        }

        const contact = await getUserContact(order.user_id);
        const targetEmail = (contact.email || '').trim();
        const summary = [{
          id: order.id,
          code: order.code,
          total: Number(details.total || 0),
          status: details.status,
          remittance: details.remittance,
          detailsSummary: summarizeOrderDetails(details),
        }];
        const linePayloads = [];
        if (completionNotice?.lineMessages?.length) {
          const arr = Array.isArray(completionNotice.lineMessages)
            ? completionNotice.lineMessages
            : [completionNotice.lineMessages];
          linePayloads.push(...arr);
        }
        if (shouldNotifyLine) {
          linePayloads.push(buildOrderDoneFlex(order.code, Number(details.total || 0)));
        }
        await sendOrderNotificationEmail({
          to: shouldEmail ? targetEmail : '',
          username: contact.username || '',
          orders: summary,
          type: 'completed',
          userId: shouldNotifyLine ? order.user_id : undefined,
          lineMessages: linePayloads.length ? (linePayloads.length === 1 ? linePayloads[0] : linePayloads) : undefined,
          emailSubject: completionNotice?.emailSubject,
          emailHtml: completionNotice?.emailHtml,
        });
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
    return fail(res, 'ADMIN_ORDER_STATUS_FAIL', err.message, 500);
  } finally {
    conn.release();
  }
});

  return router;
}

module.exports = buildOrderRoutes;
