const express = require('express');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const mime = require('mime-types');

function buildReservationRoutes(ctx) {
  const router = express.Router();
  const {
    ok,
    fail,
    pool,
    storage,
    authRequired,
    reservationManagerOnly,
    scanAccessOnly,
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
    safeParseJSON,
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
    isADMIN,
    isSTORE,
    buildAdminReservationSummaries,
    notifyReservationStageChange,
    listEventStores,
    getEventById,
    invalidateEventStoresCache,
    formatReservationDisplayId,
    summarizeReservationSchedule,
    composeReservationPaymentContent,
    detectChecklistPhotoStorageSupport,
  } = ctx;
  const hasChecklistStorage = () => isChecklistPhotoStorageEnabled();

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
    const [rows] = await pool.query('SELECT * FROM reservations WHERE user_id = ?', [req.user.id]);
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
      };
    }));
    return ok(res, list);
  } catch (err) {
    return fail(res, 'RESERVATIONS_LIST_FAIL', err.message, 500);
  }
});

router.post('/reservations', authRequired, async (req, res) => {
  const { ticketType, store, event } = req.body;
  if (!ticketType || !store || !event) return fail(res, 'VALIDATION_ERROR', '缺少必要欄位', 400);
  const eventId = normalizePositiveInt(req.body?.eventId ?? req.body?.event_id);
  const storeId = normalizePositiveInt(req.body?.storeId ?? req.body?.store_id);
  let contactCheck;
  try {
    contactCheck = await ensureUserContactInfoReady(req.user.id);
  } catch (err) {
    return fail(res, 'USER_CONTACT_CHECK_FAIL', err.message || '內部錯誤', 500);
  }
  if (!contactCheck.ok) return fail(res, contactCheck.code, contactCheck.message, contactCheck.status || 400);
  try {
    const [result] = await insertReservationsBulk(pool, [{
      userId: req.user.id,
      ticketType,
      storeName: store,
      eventName: event,
      eventId,
      storeId,
    }]);
    return ok(res, { id: result.insertId }, '預約建立成功');
  } catch (err) {
    return fail(res, 'RESERVATION_CREATE_FAIL', err.message, 500);
  }
});

router.post('/reservations/:id/checklists/:stage/photos', authRequired, async (req, res) => {
  const reservationId = Number(req.params.id);
  const stage = String(req.params.stage || '').toLowerCase();
  if (!Number.isFinite(reservationId) || reservationId <= 0) {
    return fail(res, 'VALIDATION_ERROR', '預約編號不正確', 400);
  }
  if (!isChecklistStage(stage)) {
    return fail(res, 'VALIDATION_ERROR', '僅支援賽前/賽後交車與取車檢核', 400);
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
    return fail(res, 'VALIDATION_ERROR', '僅支援賽前/賽後交車與取車檢核', 400);
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
        storagePathForDeletion = storage.normalizeRelativePath(photoRow.storage_path);
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
    return fail(res, 'VALIDATION_ERROR', '僅支援賽前/賽後交車與取車檢核', 400);
  }

  const access = await ensureChecklistReservationAccess(reservationId, req.user);
  if (!access.ok) {
    return fail(res, access.code, access.message, access.status);
  }

  try {
    const normalizeStoragePath = (p) => {
      if (!p) return { rel: null, abs: null };
      const raw = String(p);
      const root = storage.STORAGE_ROOT ? path.resolve(storage.STORAGE_ROOT) : '';
      let rel = storage.normalizeRelativePath(raw);
      let abs = null;
      if (root && raw.startsWith(root)) {
        const trimmed = path.relative(root, raw);
        if (trimmed && !trimmed.startsWith('..')) rel = storage.normalizeRelativePath(trimmed);
      }
      try {
        abs = path.isAbsolute(raw) ? raw : path.resolve(root || process.cwd(), raw);
      } catch (_) { abs = null; }
      return { rel, abs };
    };
    const tryServeFallbackDir = () => {
      const storageRoot = storage.STORAGE_ROOT || path.resolve(__dirname, '../../storage');
      const stageFolder = sanitizeStageForPath(stage);
      const reservationFolder = sanitizeReservationIdForPath(reservationId);
      const raw = String(reservationId || '').trim();
      const dirCandidates = [
        path.join(storageRoot, 'checklists', stageFolder, reservationFolder),
        raw && raw !== reservationFolder ? path.join(storageRoot, 'checklists', stageFolder, raw) : null,
      ].filter(Boolean);
      for (const dir of dirCandidates) {
        try {
          if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
          const files = fs.readdirSync(dir).filter(f => !fs.statSync(path.join(dir, f)).isDirectory());
          if (!files.length) continue;
          const target = path.join(dir, files[0]);
          const mimeType = mime.lookup(target) || row.mime || 'application/octet-stream';
          res.setHeader('Content-Type', mimeType);
          res.setHeader('Cache-Control', 'private, max-age=300');
          const stat = fs.statSync(target);
          if (stat?.size) res.setHeader('Content-Length', stat.size);
          console.warn('[checklists/photo] fallback disk file', { reservationId, stage, dir, file: files[0] });
          const stream = fs.createReadStream(target);
          stream.on('error', (err) => {
            console.error('serveChecklistPhoto fallback stream error:', err?.message || err);
            if (!res.headersSent) res.status(500).end();
            else res.destroy();
          });
          stream.pipe(res);
          return true;
        } catch (err) {
          console.error('[checklists/photo] fallback disk error:', { reservationId, stage, err: err?.message || err });
        }
      }
      return false;
    };

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
      const { rel, abs } = normalizeStoragePath(row.storage_path);
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
      if (abs && fs.existsSync(abs)) {
        const stat = fs.statSync(abs);
        if (stat?.size) res.setHeader('Content-Length', stat.size);
        sendStream(() => fs.createReadStream(abs), abs);
        return;
      }
      console.warn('[checklists/photo] storage path missing', { reservationId, stage, path: row.storage_path, rel, abs });
    }

    if (tryServeFallbackDir()) return;

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
    return fail(res, 'VALIDATION_ERROR', '僅支援賽前/賽後交車與取車檢核', 400);
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
          store: context?.store?.name || updatedReservation.store || '門市',
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

    const isAdmin = isADMIN(req.user.role);
    const baseFrom = isAdmin
      ? 'FROM reservations r JOIN users u ON u.id = r.user_id'
      : 'FROM reservations r JOIN users u ON u.id = r.user_id JOIN events e ON e.title = r.event';

    const whereClauses = [];
    const params = [];
    if (!isAdmin) {
      whereClauses.push('e.owner_user_id = ?');
      params.push(req.user.id);
    }
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
    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) AS total ${baseFrom} ${whereSql}`;
    const [[countRow]] = await pool.query(countSql, params);
    const total = Number(countRow?.total || 0);

    const listSql = `SELECT r.*, u.username, u.email ${baseFrom} ${whereSql} ORDER BY r.id DESC LIMIT ? OFFSET ?`;
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
    if (isADMIN(req.user.role)) {
      [rows] = await pool.query(
        'SELECT r.*, u.username, u.email FROM reservations r JOIN users u ON u.id = r.user_id WHERE r.id = ? LIMIT 1',
        [reservationId]
      );
    } else {
      [rows] = await pool.query(
        'SELECT r.*, u.username, u.email FROM reservations r JOIN users u ON u.id = r.user_id JOIN events e ON e.title = r.event WHERE r.id = ? AND e.owner_user_id = ? LIMIT 1',
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
    for (;;) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const [dup] = await pool.query(
        'SELECT id FROM reservations WHERE verify_code_pre_dropoff = ? OR verify_code_pre_pickup = ? OR verify_code_post_dropoff = ? OR verify_code_post_pickup = ? LIMIT 1',
        [code, code, code, code]
      );
      if (!dup.length) return code;
    }
  }

  try {
    const [rows] = await pool.query('SELECT * FROM reservations WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows.length) return fail(res, 'RESERVATION_NOT_FOUND', '找不到預約', 404);
    const cur = rows[0];
    if (isSTORE(req.user.role)){
      const [own] = await pool.query('SELECT owner_user_id FROM events WHERE title = ? LIMIT 1', [cur.event]);
      if (!own.length || String(own[0].owner_user_id || '') !== String(req.user.id)) return fail(res, 'FORBIDDEN', '無權限操作此預約', 403);
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

    // Authorization for STORE accounts
    if (isSTORE(req.user.role)){
      // 1) must own the event (by title match, consistent with other endpoints)
      const [own] = await pool.query('SELECT owner_user_id FROM events WHERE title = ? LIMIT 1', [r.event]);
      if (!own.length || String(own[0].owner_user_id || '') !== String(req.user.id)) return fail(res, 'FORBIDDEN', '無權限操作此預約', 403);
      // 2) must match the store name (only scan own store)
      try {
        const [u] = await pool.query('SELECT username FROM users WHERE id = ? LIMIT 1', [req.user.id]);
        const myStore = String(u?.[0]?.username || '').trim().toLowerCase();
        const targetStore = String(r.store || '').trim().toLowerCase();
        if (myStore && targetStore && myStore !== targetStore) return fail(res, 'FORBIDDEN', '僅能掃描本店的預約', 403);
      } catch (_) { /* ignore lookup errors; default to event-ownership check */ }
    }

    // Determine which stage this code corresponds to
    let stage = null;
    if (r.verify_code_pre_dropoff === code) stage = 'pre_dropoff';
    else if (r.verify_code_pre_pickup === code) stage = 'pre_pickup';
    else if (r.verify_code_post_dropoff === code) stage = 'post_dropoff';
    else if (r.verify_code_post_pickup === code) stage = 'post_pickup';

    if (!stage) return fail(res, 'CODE_STAGE_MISMATCH', '驗證碼與狀態不符', 400);

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

// Generate a 6-digit reservation code unique across all per-stage columns
async function generateReservationStageCode(conn = pool) {
  for (;;) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    try {
      const [dup] = await conn.query(
        'SELECT id FROM reservations WHERE verify_code_pre_dropoff = ? OR verify_code_pre_pickup = ? OR verify_code_post_dropoff = ? OR verify_code_post_pickup = ? LIMIT 1',
        [code, code, code, code]
      );
      if (!dup.length) return code;
    } catch (e) {
      // Legacy schema without new columns: allow fallback (will be ignored by caller)
      return code;
    }
  }
}

// Event code: EV + 6 chars
async function generateEventCode() {
  let code;
  for (;;) {
    code = `EV${randomCode(6)}`;
    const [dup] = await pool.query('SELECT id FROM events WHERE code = ? LIMIT 1', [code]);
    if (!dup.length) break;
  }
  return code;
}

// Product code: PD + 6 chars
async function generateProductCode() {
  let code;
  for (;;) {
    code = `PD${randomCode(6)}`;
    try {
      const [dup] = await pool.query('SELECT id FROM products WHERE code = ? LIMIT 1', [code]);
      if (!dup.length) break;
    } catch (e) {
      // Legacy table without code column; accept generated code without uniqueness enforcement at DB level
      break;
    }
  }
  return code;
}
