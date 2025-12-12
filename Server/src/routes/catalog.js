const express = require('express');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const { z } = require('zod');

function buildCatalogRoutes(ctx) {
  const router = express.Router();
  const {
    ok,
    fail,
    pool,
    storage,
    cacheUtils,
    DEFAULT_CACHE_TTL,
    eventDetailCache,
    eventStoresCache,
    eventListCache,
    invalidateEventCaches,
    invalidateEventStoresCache,
    eventsHaveCoverPathColumn,
    buildEventCoverStoragePath,
    eventManagerOnly,
    adminOrEditorOnly,
    isADMIN,
    isSTORE,
    isEDITOR,
    generateProductCode,
    generateEventCode,
    getEventById,
    listEventStores,
    safeParseJSON,
    normalizeDateInput,
    parsePositiveInt,
  } = ctx;

  router.get('/products', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM products');
    const list = rows.map(r => ({ ...r, code: r.code || (r.id != null ? `PD${String(r.id).padStart(6, '0')}` : null) }));
    return ok(res, list);
  } catch (err) {
    return fail(res, 'PRODUCTS_LIST_FAIL', err.message, 500);
  }
});

// Admin Products CRUD
const ProductCreateSchema = z.object({
  code: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional().default(''),
  price: z.number().nonnegative(),
});
const ProductUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  price: z.number().nonnegative().optional(),
});

router.post('/admin/products', adminOrEditorOnly, async (req, res) => {
  const parsed = ProductCreateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  let { code, name, description, price } = parsed.data;
  try {
    if (!code || !String(code).trim()) code = await generateProductCode();
    let r;
    try {
      [r] = await pool.query('INSERT INTO products (code, name, description, price) VALUES (?, ?, ?, ?)', [code, name, description, price]);
    } catch (e) {
      if (e?.code === 'ER_BAD_FIELD_ERROR') {
        // Legacy table without code column
        [r] = await pool.query('INSERT INTO products (name, description, price) VALUES (?, ?, ?)', [name, description, price]);
      } else {
        throw e;
      }
    }
    return ok(res, { id: r.insertId, code }, '商品已新增');
  } catch (err) {
    return fail(res, 'ADMIN_PRODUCT_CREATE_FAIL', err.message, 500);
  }
});

router.patch('/admin/products/:id', adminOrEditorOnly, async (req, res) => {
  const parsed = ProductUpdateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  const fields = parsed.data;
  const sets = [];
  const values = [];
  for (const [k, v] of Object.entries(fields)) { sets.push(`${k} = ?`); values.push(v); }
  if (!sets.length) return ok(res, null, '無更新');
  values.push(req.params.id);
  try {
    const [r] = await pool.query(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, values);
    if (!r.affectedRows) return fail(res, 'PRODUCT_NOT_FOUND', '找不到商品', 404);
    return ok(res, null, '商品已更新');
  } catch (err) {
    return fail(res, 'ADMIN_PRODUCT_UPDATE_FAIL', err.message, 500);
  }
});

router.delete('/admin/products/:id', adminOrEditorOnly, async (req, res) => {
  try {
    const [r] = await pool.query('DELETE FROM products WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return fail(res, 'PRODUCT_NOT_FOUND', '找不到商品', 404);
    return ok(res, null, '商品已刪除');
  } catch (err) {
    return fail(res, 'ADMIN_PRODUCT_DELETE_FAIL', err.message, 500);
  }
});

router.get('/events', async (req, res) => {
  try {
    if (eventListCache.value && eventListCache.expiresAt > Date.now()) {
      return ok(res, eventListCache.value);
    }
    // 避免傳回 BLOB，明確排除 cover_data；僅返回未到期活動
    const baseWhere = 'FROM events WHERE COALESCE(deadline, ends_at) IS NULL OR COALESCE(deadline, ends_at) >= NOW() ORDER BY starts_at ASC';
    const attempts = [
      // Preferred (new schema)
      `SELECT id, code, title, starts_at, ends_at, deadline, location, description, cover, cover_type, rules, created_at, updated_at ${baseWhere}`,
      // Legacy without cover/cover_type
      `SELECT id, code, title, starts_at, ends_at, deadline, location, description, rules, created_at, updated_at ${baseWhere}`,
      // Minimal legacy (no rules)
      `SELECT id, code, title, starts_at, ends_at, deadline, location, description, created_at, updated_at ${baseWhere}`,
      // Oldest fallback
      `SELECT id, title, starts_at, ends_at, deadline, location, description ${baseWhere}`,
    ];

    let rows = [];
    let lastErr = null;
    for (const sql of attempts) {
      try {
        const [result] = await pool.query(sql);
        rows = result;
        break;
      } catch (err) {
        lastErr = err;
        if (err?.code !== 'ER_BAD_FIELD_ERROR') throw err;
      }
    }
    if (!rows.length && lastErr && lastErr.code === 'ER_BAD_FIELD_ERROR') {
      throw lastErr;
    }

    // Normalize fields for front-end compatibility
    rows = rows.map((r) => ({
      id: r.id,
      code: r.code || (r.id != null ? `EV${String(r.id).padStart(6, '0')}` : null),
      title: r.title || '',
      starts_at: r.starts_at || null,
      ends_at: r.ends_at || null,
      deadline: r.deadline || null,
      location: r.location || '',
      description: r.description || '',
      cover: r.cover || null,
      cover_type: r.cover_type || null,
      rules: r.rules || null,
      created_at: r.created_at || null,
      updated_at: r.updated_at || null,
    }));
    const list = rows;
    eventListCache.value = list;
    eventListCache.expiresAt = Date.now() + DEFAULT_CACHE_TTL;
    return ok(res, list);
  } catch (err) {
    return fail(res, 'EVENTS_LIST_FAIL', err.message, 500);
  }
});

router.get('/events/:id', async (req, res) => {
  try {
    const event = await getEventById(req.params.id, { useCache: true });
    if (!event) return fail(res, 'EVENT_NOT_FOUND', '找不到活動', 404);
    return ok(res, event);
  } catch (err) {
    return fail(res, 'EVENT_READ_FAIL', err.message, 500);
  }
});

// Admin Events list (ADMIN: all, STORE: owned only)
router.get('/admin/events', eventManagerOnly, async (req, res) => {
  try {
    const defaultLimit = 50;
    const limit = parsePositiveInt(req.query.limit, defaultLimit, { min: 1, max: 200 });
    const offsetRaw = req.query.offset ?? req.query.skip ?? 0;
    const offset = Math.max(0, parsePositiveInt(offsetRaw, 0, { min: 0 }));
    const queryRaw = String(req.query.q || req.query.query || '').trim();
    const searchTerm = queryRaw ? `%${queryRaw}%` : null;

    const canViewAll = isADMIN(req.user.role) || isEDITOR(req.user.role);
    const baseFrom = 'FROM events e';
    const where = [];
    const params = [];
    if (!canViewAll) {
      where.push('e.owner_user_id = ?');
      params.push(req.user.id);
    }
    if (searchTerm) {
      where.push('(e.title LIKE ? OR e.code LIKE ? OR e.location LIKE ?)');
      params.push(searchTerm, searchTerm, searchTerm);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) AS total ${baseFrom} ${whereSql}`;
    const [[countRow]] = await pool.query(countSql, params);
    const total = Number(countRow?.total || 0);

    const listSql = `SELECT e.id, e.code, e.title, e.starts_at, e.ends_at, e.deadline, e.location, e.description, e.cover, e.cover_type, e.rules, e.owner_user_id, e.created_at, e.updated_at ${baseFrom} ${whereSql} ORDER BY e.id DESC LIMIT ? OFFSET ?`;
    const [rows] = await pool.query(listSql, [...params, limit, offset]);
    const items = rows.map((r) => ({
      ...r,
      code: r.code || `EV${String(r.id).padStart(6, '0')}`,
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
    return fail(res, 'ADMIN_EVENTS_LIST_FAIL', err.message, 500);
  }
});

// Event Stores (public list)
router.get('/events/:id/stores', async (req, res) => {
  try {
    const list = await listEventStores(req.params.id, { useCache: true });
    return ok(res, list);
  } catch (err) {
    return fail(res, 'EVENT_STORES_LIST_FAIL', err.message, 500);
  }
});

// Admin Events CRUD（對齊舊庫：title + starts_at/ends_at + deadline(JSON rules)）
const EventCreateSchema = z.object({
  code: z.string().optional(),
  title: z.string().min(1),
  starts_at: z.string().min(1),
  ends_at: z.string().min(1),
  deadline: z.string().optional(),
  location: z.string().optional(),
  description: z.string().optional(),
  cover: z.string().url().max(512).optional(),
  rules: z.union([z.array(z.string()), z.string()]).optional(),
});
const EventUpdateSchema = EventCreateSchema.partial();

function normalizeRules(v) {
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === 'string') return v.trim() ? v : '[]';
  return '[]';
}

router.post('/admin/events', eventManagerOnly, async (req, res) => {
  const parsed = EventCreateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  let { code, title, starts_at, ends_at, deadline, location, description, cover, rules } = parsed.data;
  const ownerId = (isADMIN(req.user.role) || isEDITOR(req.user.role)) ? (req.body?.ownerId || null) : req.user.id;
  try {
    // Auto-generate code if missing/blank
    if (!code || !String(code).trim()) {
      code = await generateEventCode();
    }
    // Try insert with cover; fallback to legacy schema when column not exists
    let r;
    try {
      [r] = await pool.query(
        'INSERT INTO events (code, title, starts_at, ends_at, deadline, location, description, cover, rules, owner_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [code || null, title, starts_at, ends_at, deadline || null, location || null, description || '', cover || null, normalizeRules(rules), ownerId]
      );
    } catch (e) {
      if (e?.code === 'ER_BAD_FIELD_ERROR') {
        [r] = await pool.query(
          'INSERT INTO events (code, title, starts_at, ends_at, deadline, location, description, rules) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [code || null, title, starts_at, ends_at, deadline || null, location || null, description || '', normalizeRules(rules)]
        );
      } else {
        throw e;
      }
    }
    invalidateEventCaches(r.insertId);
    return ok(res, { id: r.insertId }, '活動已新增');
  } catch (err) {
    return fail(res, 'ADMIN_EVENT_CREATE_FAIL', err.message, 500);
  }
});

router.patch('/admin/events/:id', eventManagerOnly, async (req, res) => {
  if (isSTORE(req.user.role)){
    const [e] = await pool.query('SELECT owner_user_id FROM events WHERE id = ? LIMIT 1', [req.params.id]);
    if (!e.length) return fail(res, 'EVENT_NOT_FOUND', '找不到活動', 404);
    if (String(e[0].owner_user_id || '') !== String(req.user.id)) return fail(res, 'FORBIDDEN', '無權限操作此活動', 403);
  }
  const parsed = EventUpdateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  const fields = parsed.data;
  if (fields.rules !== undefined) fields.rules = normalizeRules(fields.rules);
  if (!isADMIN(req.user.role) && !isEDITOR(req.user.role)) delete fields.owner_user_id;
  const sets = [];
  const values = [];
  for (const [k, v] of Object.entries(fields)) { sets.push(`${k} = ?`); values.push(v); }
  if (!sets.length) return ok(res, null, '無更新');
  values.push(req.params.id);
  try {
    let r;
    try {
      [r] = await pool.query(`UPDATE events SET ${sets.join(', ')} WHERE id = ?`, values);
    } catch (e) {
      if (e?.code === 'ER_BAD_FIELD_ERROR') {
        // Retry without unsupported columns (e.g., cover) for legacy DB
        const sets2 = [];
        const values2 = [];
        Object.entries(fields).forEach(([k, v]) => { if (k !== 'cover') { sets2.push(`${k} = ?`); values2.push(v); } });
        if (!sets2.length) return ok(res, null, '無更新');
        values2.push(req.params.id);
        [r] = await pool.query(`UPDATE events SET ${sets2.join(', ')} WHERE id = ?`, values2);
      } else {
        throw e;
      }
    }
    if (!r.affectedRows) return fail(res, 'EVENT_NOT_FOUND', '找不到活動', 404);
    invalidateEventCaches(req.params.id);
    return ok(res, null, '活動已更新');
  } catch (err) {
    return fail(res, 'ADMIN_EVENT_UPDATE_FAIL', err.message, 500);
  }
});

// Admin: delete event cover (both url and blob)
router.delete('/admin/events/:id/cover', eventManagerOnly, async (req, res) => {
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return fail(res, 'VALIDATION_ERROR', '活動編號不正確', 400);
  }
  let coverPath = null;
  try {
    const [rows] = await pool.query(
      `SELECT owner_user_id${eventsHaveCoverPathColumn ? ', cover_path' : ''} FROM events WHERE id = ? LIMIT 1`,
      [eventId]
    );
    if (!rows.length) return fail(res, 'EVENT_NOT_FOUND', '找不到活動', 404);
    const row = rows[0];
    if (isSTORE(req.user.role) && String(row.owner_user_id || '') !== String(req.user.id)) {
      return fail(res, 'FORBIDDEN', '無權限操作此活動', 403);
    }
    if (eventsHaveCoverPathColumn && row.cover_path) {
      coverPath = storage.normalizeRelativePath(row.cover_path);
    }
  } catch (err) {
    return fail(res, 'EVENT_NOT_FOUND', err?.message || '查詢失敗', 500);
  }

  try {
    const sql = eventsHaveCoverPathColumn
      ? 'UPDATE events SET cover = NULL, cover_type = NULL, cover_path = NULL, cover_data = NULL WHERE id = ?'
      : 'UPDATE events SET cover = NULL, cover_type = NULL, cover_data = NULL WHERE id = ?';
    const [r] = await pool.query(sql, [eventId]);
    if (!r.affectedRows) return fail(res, 'EVENT_NOT_FOUND', '找不到活動', 404);
    if (coverPath) await storage.deleteFile(coverPath).catch(() => {});
    invalidateEventCaches(req.params.id);
    return ok(res, null, '封面已刪除');
  } catch (err) {
    return fail(res, 'ADMIN_EVENT_COVER_DELETE_FAIL', err.message, 500);
  }
});

// Admin: upload event cover as base64 JSON
router.post('/admin/events/:id/cover_json', eventManagerOnly, async (req, res) => {
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return fail(res, 'VALIDATION_ERROR', '活動編號不正確', 400);
  }
  if (!eventsHaveCoverPathColumn) {
    return fail(res, 'STORAGE_PATH_UNAVAILABLE', '封面儲存未初始化，請聯繫客服', 500);
  }
  const { dataUrl, mime, base64 } = req.body || {};
  let contentType = null;
  let buffer = null;
  let previousCoverPath = null;
  try {
    const [rows] = await pool.query(
      `SELECT owner_user_id${eventsHaveCoverPathColumn ? ', cover_path' : ''} FROM events WHERE id = ? LIMIT 1`,
      [eventId]
    );
    if (!rows.length) return fail(res, 'EVENT_NOT_FOUND', '找不到活動', 404);
    const row = rows[0];
    if (isSTORE(req.user.role) && String(row.owner_user_id || '') !== String(req.user.id)) {
      return fail(res, 'FORBIDDEN', '無權限操作此活動', 403);
    }
    if (eventsHaveCoverPathColumn && row.cover_path) {
      previousCoverPath = storage.normalizeRelativePath(row.cover_path);
    }
  } catch (err) {
    return fail(res, 'EVENT_NOT_FOUND', err?.message || '查詢失敗', 500);
  }

  try {
    if (dataUrl && typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
      const m = /^data:([\w\-/.+]+);base64,(.*)$/.exec(dataUrl);
      if (!m) return fail(res, 'VALIDATION_ERROR', 'dataUrl 格式錯誤', 400);
      contentType = m[1];
      buffer = Buffer.from(m[2], 'base64');
    } else if (mime && base64) {
      contentType = String(mime);
      buffer = Buffer.from(String(base64), 'base64');
    } else {
      return fail(res, 'VALIDATION_ERROR', '缺少上傳內容', 400);
    }
    if (!buffer || !buffer.length) return fail(res, 'VALIDATION_ERROR', '檔案為空', 400);
    if (buffer.length > 10 * 1024 * 1024) return fail(res, 'PAYLOAD_TOO_LARGE', '檔案過大（>10MB）', 413);
    contentType = contentType || 'application/octet-stream';

    let storagePathRelative = null;
    const extension = storage.mimeToExtension(contentType);
    let attempts = 0;
    while (attempts < 5) {
      attempts += 1;
      const candidate = buildEventCoverStoragePath(eventId, extension);
      try {
        await storage.writeBuffer(candidate, buffer, { mode: 0o600 });
        storagePathRelative = storage.normalizeRelativePath(candidate);
        break;
      } catch (err) {
        if (err?.code === 'EEXIST' && attempts < 5) {
          continue;
        }
        console.error('writeEventCover error:', err?.message || err);
        return fail(res, 'ADMIN_EVENT_COVER_UPLOAD_FAIL', '封面儲存失敗，請稍後再試', 500);
      }
    }

    const sql = 'UPDATE events SET cover = NULL, cover_type = ?, cover_path = ?, cover_data = NULL WHERE id = ?';
    const params = [contentType, storagePathRelative, eventId];
    let result;
    try {
      [result] = await pool.query(sql, params);
    } catch (err) {
      if (storagePathRelative) await storage.deleteFile(storagePathRelative).catch(() => {});
      throw err;
    }

    if (!result.affectedRows) {
      if (storagePathRelative) await storage.deleteFile(storagePathRelative).catch(() => {});
      return fail(res, 'EVENT_NOT_FOUND', '找不到活動', 404);
    }

    if (previousCoverPath && previousCoverPath !== storagePathRelative) {
      await storage.deleteFile(previousCoverPath).catch(() => {});
    }

    invalidateEventCaches(req.params.id);
    return ok(res, {
      id: eventId,
      size: buffer.length,
      type: contentType,
      path: eventsHaveCoverPathColumn ? storagePathRelative : null
    }, '封面已更新');
  } catch (err) {
    return fail(res, 'ADMIN_EVENT_COVER_UPLOAD_FAIL', err.message, 500);
  }
});

// Public: serve event cover
router.get('/events/:id/cover', async (req, res) => {
  try {
    const selectSql = eventsHaveCoverPathColumn
      ? 'SELECT cover, cover_type, cover_data, cover_path, updated_at FROM events WHERE id = ? LIMIT 1'
      : 'SELECT cover, cover_type, cover_data, updated_at FROM events WHERE id = ? LIMIT 1';
    const [rows] = await pool.query(selectSql, [req.params.id]);
    if (!rows.length) return res.status(404).end();
    const e = rows[0];

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
    const sanitizeEventIdForPath = (eventId) => {
      const text = String(eventId || '').trim();
      return /^\d+$/.test(text) ? text : 'unknown';
    };
    const tryServeFallbackDir = () => {
      const storageRoot = storage.STORAGE_ROOT || path.resolve(__dirname, '../../storage');
      const slug = sanitizeEventIdForPath(req.params.id);
      const raw = String(req.params.id || '').trim();
      const dirCandidates = [
        path.join(storageRoot, 'event_covers', slug),
        raw && raw !== slug ? path.join(storageRoot, 'event_covers', raw) : null,
      ].filter(Boolean);
      for (const dir of dirCandidates) {
        try {
          if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
          const files = fs.readdirSync(dir).filter(f => !fs.statSync(path.join(dir, f)).isDirectory());
          if (!files.length) continue;
          const target = path.join(dir, files[0]);
          const mimeType = mime.lookup(target) || e.cover_type || 'application/octet-stream';
          res.setHeader('Content-Type', mimeType);
          res.setHeader('Cache-Control', 'public, max-age=86400');
          const stat = fs.statSync(target);
          if (stat?.size) res.setHeader('Content-Length', stat.size);
          console.warn('[events/cover] fallback disk file', { eventId: req.params.id, dir, file: files[0] });
          const stream = fs.createReadStream(target);
          stream.on('error', (err) => {
            console.error('serveEventCover fallback stream error:', err?.message || err);
            if (!res.headersSent) res.status(500).end();
            else res.destroy();
          });
          stream.pipe(res);
          return true;
        } catch (err) {
          console.error('[events/cover] fallback disk error:', { eventId: req.params.id, err: err?.message || err });
        }
      }
      return false;
    };

    if (eventsHaveCoverPathColumn && e.cover_path) {
      const { rel, abs } = normalizeStoragePath(e.cover_path);
      const sendStream = (streamFactory, label) => {
        const stream = streamFactory();
        res.setHeader('Content-Type', e.cover_type || 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        stream.on('error', (err) => {
          console.error('serveEventCover stream error:', { err: err?.message || err, path: label });
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
      console.warn('[events/cover] storage path missing', { eventId: req.params.id, path: e.cover_path, rel, abs });
    }
    if (tryServeFallbackDir()) return;
    if (e.cover_data) {
      res.setHeader('Content-Type', e.cover_type || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.end(e.cover_data);
    }
    if (e.cover) {
      return res.redirect(302, e.cover);
    }
    return res.status(404).end();
  } catch (err) {
    return res.status(500).end();
  }
});

router.delete('/admin/events/:id', eventManagerOnly, async (req, res) => {
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return fail(res, 'VALIDATION_ERROR', '活動編號不正確', 400);
  }
  let coverPath = null;
  if (isSTORE(req.user.role)){
    const [e] = await pool.query(`SELECT owner_user_id${eventsHaveCoverPathColumn ? ', cover_path' : ''} FROM events WHERE id = ? LIMIT 1`, [eventId]);
    if (!e.length) return fail(res, 'EVENT_NOT_FOUND', '找不到活動', 404);
    if (String(e[0].owner_user_id || '') !== String(req.user.id)) return fail(res, 'FORBIDDEN', '無權限操作此活動', 403);
    if (eventsHaveCoverPathColumn && e[0].cover_path) {
      coverPath = storage.normalizeRelativePath(e[0].cover_path);
    }
  } else if (eventsHaveCoverPathColumn) {
    try {
      const [[row]] = await pool.query('SELECT cover_path FROM events WHERE id = ? LIMIT 1', [eventId]);
      if (row && row.cover_path) coverPath = storage.normalizeRelativePath(row.cover_path);
    } catch (_) { /* ignore */ }
  }
  try {
    const [r] = await pool.query('DELETE FROM events WHERE id = ?', [eventId]);
    if (!r.affectedRows) return fail(res, 'EVENT_NOT_FOUND', '找不到活動', 404);
    if (coverPath) await storage.deleteFile(coverPath).catch(() => {});
    invalidateEventCaches(req.params.id);
    return ok(res, null, '活動已刪除');
  } catch (err) {
    return fail(res, 'ADMIN_EVENT_DELETE_FAIL', err.message, 500);
  }
});

// Admin Event Stores CRUD
const PositiveIntLike = z.union([
  z.number().int().positive(),
  z.string().regex(/^\d+$/),
]);
const PriceEntrySchema = z.object({
  normal: z.number().nonnegative(),
  early: z.number().nonnegative(),
  product_id: PositiveIntLike.optional(),
  productId: PositiveIntLike.optional(),
}).transform((entry) => {
  const candidateRaw = entry.product_id ?? entry.productId;
  let productId = null;
  if (candidateRaw !== undefined && candidateRaw !== null && candidateRaw !== '') {
    const candidate = typeof candidateRaw === 'string' ? candidateRaw.trim() : candidateRaw;
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) {
      productId = Math.floor(parsed);
    }
  }
  const base = {
    normal: entry.normal,
    early: entry.early,
  };
  if (productId) base.product_id = productId;
  return base;
});
const PricesSchema = z.record(z.string().min(1), PriceEntrySchema);
const AddressSchema = z.string().trim().max(255).nullable().optional();
const ExternalUrlSchema = z.string().trim().max(500).nullable().optional();
const BusinessHoursSchema = z.string().trim().max(1000).nullable().optional();
const STORE_DETAIL_FIELDS = ['address', 'external_url', 'business_hours'];
const normalizeStoreDetailField = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value || '').trim();
  return text || null;
};
const normalizeStoreBody = (body = {}) => {
  const payload = { ...(body || {}) };
  if (payload.externalUrl && !payload.external_url) payload.external_url = payload.externalUrl;
  if (payload.businessHours && !payload.business_hours) payload.business_hours = payload.businessHours;
  if (payload.address === undefined && payload.storeAddress) payload.address = payload.storeAddress;
  return payload;
};
const StoreCreateSchema = z.object({
  name: z.string().min(1),
  pre_start: z.string().optional(),
  pre_end: z.string().optional(),
  post_start: z.string().optional(),
  post_end: z.string().optional(),
  address: AddressSchema,
  external_url: ExternalUrlSchema,
  business_hours: BusinessHoursSchema,
  prices: PricesSchema,
});
const StoreUpdateSchema = StoreCreateSchema.partial();

// Shared Store Templates (ADMIN/STORE shared across all accounts)
async function ensureStoreTemplatesTable() {
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS store_templates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        address VARCHAR(255) NULL,
        external_url VARCHAR(500) NULL,
        business_hours TEXT NULL,
        pre_start DATE NULL,
        pre_end DATE NULL,
        post_start DATE NULL,
        post_end DATE NULL,
        prices TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`
    );
    const alters = [
      'ALTER TABLE store_templates ADD COLUMN address VARCHAR(255) NULL AFTER name',
      'ALTER TABLE store_templates ADD COLUMN external_url VARCHAR(500) NULL AFTER address',
      'ALTER TABLE store_templates ADD COLUMN business_hours TEXT NULL AFTER external_url',
    ];
    for (const sql of alters) {
      try { await pool.query(sql); } catch (err) {
        if (!['ER_DUP_FIELDNAME', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(err?.code)) {
          console.warn('ensureStoreTemplatesTable alter error:', err?.message || err);
        }
      }
    }
  } catch (_) { /* ignore */ }
}

async function ensureEventStoreDetailColumns() {
  const alters = [
    'ALTER TABLE event_stores ADD COLUMN address VARCHAR(255) NULL AFTER name',
    'ALTER TABLE event_stores ADD COLUMN external_url VARCHAR(500) NULL AFTER address',
    'ALTER TABLE event_stores ADD COLUMN business_hours TEXT NULL AFTER external_url',
  ];
  for (const sql of alters) {
    try { await pool.query(sql); } catch (err) {
      if (!['ER_DUP_FIELDNAME', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(err?.code)) {
        console.warn('ensureEventStoreDetailColumns error:', err?.message || err);
      }
    }
  }
}

router.get('/admin/store_templates', eventManagerOnly, async (req, res) => {
  try {
    await ensureStoreTemplatesTable();
    const [rows] = await pool.query('SELECT * FROM store_templates ORDER BY id DESC');
    const list = rows.map(r => ({
      ...r,
      address: normalizeStoreDetailField(r.address),
      external_url: normalizeStoreDetailField(r.external_url),
      business_hours: normalizeStoreDetailField(r.business_hours),
      prices: safeParseJSON(r.prices, {}),
    }));
    return ok(res, list);
  } catch (err) {
    return fail(res, 'ADMIN_STORE_TEMPLATES_LIST_FAIL', err.message, 500);
  }
});

router.post('/admin/store_templates', eventManagerOnly, async (req, res) => {
  const parsed = StoreCreateSchema.safeParse(normalizeStoreBody(req.body));
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  const { name, pre_start, pre_end, post_start, post_end, prices } = parsed.data;
  const address = normalizeStoreDetailField(parsed.data.address);
  const externalUrl = normalizeStoreDetailField(parsed.data.external_url);
  const businessHours = normalizeStoreDetailField(parsed.data.business_hours);
  try {
    await ensureStoreTemplatesTable();
    let r;
    try {
      [r] = await pool.query(
        'INSERT INTO store_templates (name, address, external_url, business_hours, pre_start, pre_end, post_start, post_end, prices) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [name, address, externalUrl, businessHours, normalizeDateInput(pre_start), normalizeDateInput(pre_end), normalizeDateInput(post_start), normalizeDateInput(post_end), JSON.stringify(prices)]
      );
    } catch (err) {
      if (err?.code === 'ER_BAD_FIELD_ERROR') {
        [r] = await pool.query(
          'INSERT INTO store_templates (name, pre_start, pre_end, post_start, post_end, prices) VALUES (?, ?, ?, ?, ?, ?)',
          [name, normalizeDateInput(pre_start), normalizeDateInput(pre_end), normalizeDateInput(post_start), normalizeDateInput(post_end), JSON.stringify(prices)]
        );
      } else {
        throw err;
      }
    }
    return ok(res, { id: r.insertId }, '模板已新增');
  } catch (err) {
    return fail(res, 'ADMIN_STORE_TEMPLATE_CREATE_FAIL', err.message, 500);
  }
});

router.patch('/admin/store_templates/:id', eventManagerOnly, async (req, res) => {
  const parsed = StoreUpdateSchema.safeParse(normalizeStoreBody(req.body));
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  const fields = parsed.data;
  if (fields.pre_start !== undefined) fields.pre_start = normalizeDateInput(fields.pre_start);
  if (fields.pre_end !== undefined) fields.pre_end = normalizeDateInput(fields.pre_end);
  if (fields.post_start !== undefined) fields.post_start = normalizeDateInput(fields.post_start);
  if (fields.post_end !== undefined) fields.post_end = normalizeDateInput(fields.post_end);
  if (fields.prices !== undefined) fields.prices = JSON.stringify(fields.prices);
  STORE_DETAIL_FIELDS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      fields[key] = normalizeStoreDetailField(fields[key]);
    }
  });
  const entries = Object.entries(fields);
  if (!entries.length) return ok(res, null, '無更新');
  const sets = entries.map(([k]) => `${k} = ?`);
  const values = entries.map(([, v]) => v);
  values.push(req.params.id);
  try {
    await ensureStoreTemplatesTable();
    let r;
    try {
      [r] = await pool.query(`UPDATE store_templates SET ${sets.join(', ')} WHERE id = ?`, values);
    } catch (err) {
      if (err?.code === 'ER_BAD_FIELD_ERROR') {
        const legacyEntries = entries.filter(([k]) => ['name', 'pre_start', 'pre_end', 'post_start', 'post_end', 'prices'].includes(k));
        if (!legacyEntries.length) throw err;
        const legacySets = legacyEntries.map(([k]) => `${k} = ?`);
        const legacyValues = legacyEntries.map(([, v]) => v);
        legacyValues.push(req.params.id);
        [r] = await pool.query(`UPDATE store_templates SET ${legacySets.join(', ')} WHERE id = ?`, legacyValues);
      } else {
        throw err;
      }
    }
    if (!r.affectedRows) return fail(res, 'STORE_TEMPLATE_NOT_FOUND', '找不到模板', 404);
    return ok(res, null, '模板已更新');
  } catch (err) {
    return fail(res, 'ADMIN_STORE_TEMPLATE_UPDATE_FAIL', err.message, 500);
  }
});

router.delete('/admin/store_templates/:id', eventManagerOnly, async (req, res) => {
  try {
    await ensureStoreTemplatesTable();
    const [r] = await pool.query('DELETE FROM store_templates WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return fail(res, 'STORE_TEMPLATE_NOT_FOUND', '找不到模板', 404);
    return ok(res, null, '模板已刪除');
  } catch (err) {
    return fail(res, 'ADMIN_STORE_TEMPLATE_DELETE_FAIL', err.message, 500);
  }
});

router.get('/admin/events/:id/stores', eventManagerOnly, async (req, res) => {
  try {
    if (isSTORE(req.user.role)){
      const [e] = await pool.query('SELECT owner_user_id FROM events WHERE id = ? LIMIT 1', [req.params.id]);
      if (!e.length) return fail(res, 'EVENT_NOT_FOUND', '找不到活動', 404);
      if (String(e[0].owner_user_id || '') !== String(req.user.id)) return fail(res, 'FORBIDDEN', '無權限操作此活動', 403);
    }
    const list = await listEventStores(req.params.id, { useCache: false });
    return ok(res, list);
  } catch (err) {
    return fail(res, 'ADMIN_EVENT_STORES_LIST_FAIL', err.message, 500);
  }
});

router.post('/admin/events/:id/stores', eventManagerOnly, async (req, res) => {
  const parsed = StoreCreateSchema.safeParse(normalizeStoreBody(req.body));
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  const { name, pre_start, pre_end, post_start, post_end, prices } = parsed.data;
  const address = normalizeStoreDetailField(parsed.data.address);
  const externalUrl = normalizeStoreDetailField(parsed.data.external_url);
  const businessHours = normalizeStoreDetailField(parsed.data.business_hours);
  try {
    if (isSTORE(req.user.role)){
      const [e] = await pool.query('SELECT owner_user_id FROM events WHERE id = ? LIMIT 1', [req.params.id]);
      if (!e.length) return fail(res, 'EVENT_NOT_FOUND', '找不到活動', 404);
      if (String(e[0].owner_user_id || '') !== String(req.user.id)) return fail(res, 'FORBIDDEN', '無權限操作此活動', 403);
    }
    await ensureEventStoreDetailColumns();
    let r;
    try {
      [r] = await pool.query(
        'INSERT INTO event_stores (event_id, name, address, external_url, business_hours, pre_start, pre_end, post_start, post_end, prices) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [req.params.id, name, address, externalUrl, businessHours, normalizeDateInput(pre_start), normalizeDateInput(pre_end), normalizeDateInput(post_start), normalizeDateInput(post_end), JSON.stringify(prices)]
      );
    } catch (err) {
      if (err?.code === 'ER_BAD_FIELD_ERROR') {
        [r] = await pool.query(
          'INSERT INTO event_stores (event_id, name, pre_start, pre_end, post_start, post_end, prices) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [req.params.id, name, normalizeDateInput(pre_start), normalizeDateInput(pre_end), normalizeDateInput(post_start), normalizeDateInput(post_end), JSON.stringify(prices)]
        );
      } else {
        throw err;
      }
    }
    invalidateEventStoresCache(req.params.id);
    invalidateEventCaches(req.params.id);
    return ok(res, { id: r.insertId }, '店面已新增');
  } catch (err) {
    return fail(res, 'ADMIN_EVENT_STORE_CREATE_FAIL', err.message, 500);
  }
});

router.patch('/admin/events/stores/:storeId', eventManagerOnly, async (req, res) => {
  const parsed = StoreUpdateSchema.safeParse(normalizeStoreBody(req.body));
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  const fields = parsed.data;
  if (fields.pre_start !== undefined) fields.pre_start = normalizeDateInput(fields.pre_start);
  if (fields.pre_end !== undefined) fields.pre_end = normalizeDateInput(fields.pre_end);
  if (fields.post_start !== undefined) fields.post_start = normalizeDateInput(fields.post_start);
  if (fields.post_end !== undefined) fields.post_end = normalizeDateInput(fields.post_end);
  if (fields.prices !== undefined) fields.prices = JSON.stringify(fields.prices);
  STORE_DETAIL_FIELDS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      fields[key] = normalizeStoreDetailField(fields[key]);
    }
  });
  const entries = Object.entries(fields);
  if (!entries.length) return ok(res, null, '無更新');
  const sets = entries.map(([k]) => `${k} = ?`);
  const values = entries.map(([, v]) => v);
  values.push(req.params.storeId);
  let eventIdForCache = null;
  try {
    if (isSTORE(req.user.role)){
      const [r0] = await pool.query('SELECT s.event_id, e.owner_user_id FROM event_stores s JOIN events e ON e.id = s.event_id WHERE s.id = ? LIMIT 1', [req.params.storeId]);
      if (!r0.length) return fail(res, 'STORE_NOT_FOUND', '找不到店面', 404);
      if (String(r0[0].owner_user_id || '') !== String(req.user.id)) return fail(res, 'FORBIDDEN', '無權限操作此活動', 403);
      eventIdForCache = r0[0].event_id;
    }
    if (eventIdForCache == null) {
      const [meta] = await pool.query('SELECT event_id FROM event_stores WHERE id = ? LIMIT 1', [req.params.storeId]);
      if (!meta.length) return fail(res, 'STORE_NOT_FOUND', '找不到店面', 404);
      eventIdForCache = meta[0].event_id;
    }
    await ensureEventStoreDetailColumns();
    let r;
    try {
      [r] = await pool.query(`UPDATE event_stores SET ${sets.join(', ')} WHERE id = ?`, values);
    } catch (err) {
      if (err?.code === 'ER_BAD_FIELD_ERROR') {
        const legacyEntries = entries.filter(([k]) => ['name', 'pre_start', 'pre_end', 'post_start', 'post_end', 'prices'].includes(k));
        if (!legacyEntries.length) throw err;
        const legacySets = legacyEntries.map(([k]) => `${k} = ?`);
        const legacyValues = legacyEntries.map(([, v]) => v);
        legacyValues.push(req.params.storeId);
        [r] = await pool.query(`UPDATE event_stores SET ${legacySets.join(', ')} WHERE id = ?`, legacyValues);
      } else {
        throw err;
      }
    }
    if (!r.affectedRows) return fail(res, 'STORE_NOT_FOUND', '找不到店面', 404);
    invalidateEventStoresCache(eventIdForCache);
    invalidateEventCaches(eventIdForCache);
    return ok(res, null, '店面已更新');
  } catch (err) {
    return fail(res, 'ADMIN_EVENT_STORE_UPDATE_FAIL', err.message, 500);
  }
});

router.delete('/admin/events/stores/:storeId', eventManagerOnly, async (req, res) => {
  try {
    let eventIdForCache = null;
    if (isSTORE(req.user.role)){
      const [r0] = await pool.query('SELECT s.event_id, e.owner_user_id FROM event_stores s JOIN events e ON e.id = s.event_id WHERE s.id = ? LIMIT 1', [req.params.storeId]);
      if (!r0.length) return fail(res, 'STORE_NOT_FOUND', '找不到店面', 404);
      if (String(r0[0].owner_user_id || '') !== String(req.user.id)) return fail(res, 'FORBIDDEN', '無權限操作此活動', 403);
      eventIdForCache = r0[0].event_id;
    }
    if (eventIdForCache == null) {
      const [meta] = await pool.query('SELECT event_id FROM event_stores WHERE id = ? LIMIT 1', [req.params.storeId]);
      if (!meta.length) return fail(res, 'STORE_NOT_FOUND', '找不到店面', 404);
      eventIdForCache = meta[0].event_id;
    }
    const [r] = await pool.query('DELETE FROM event_stores WHERE id = ?', [req.params.storeId]);
    if (!r.affectedRows) return fail(res, 'STORE_NOT_FOUND', '找不到店面', 404);
    invalidateEventStoresCache(eventIdForCache);
    invalidateEventCaches(eventIdForCache);
    return ok(res, null, '店面已刪除');
  } catch (err) {
    return fail(res, 'ADMIN_EVENT_STORE_DELETE_FAIL', err.message, 500);
  }
});

  return router;
}

module.exports = buildCatalogRoutes;
