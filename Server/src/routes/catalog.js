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
    isEventCoverStorageEnabled,
    buildEventCoverStoragePath,
    buildProductCoverStoragePath,
    eventManagerOnly,
    productManagerOnly,
    adminOrEditorOnly,
    deliveryPointOnly,
    isADMIN,
    isSTORE,
    isEDITOR,
    normalizeUserId,
    generateProductCode,
    generateEventCode,
    getEventById,
    listEventStores,
    listEventServicePrices,
    safeParseJSON,
    parsePositiveInt,
    normalizeDateTimeInput,
    ensureDeliveryPointSchema,
    ensureEventStoreRemittanceColumns,
    ensureEventStoreDeliveryPointColumn,
    ensureEventStorePhaseColumns,
    ensureEventServicePricesTable,
    ensureEventDriverAssignmentsTable,
    ensureReservationAssignmentsTable,
    normalizeRemittanceDetails,
    hasRemittanceDetails,
    getDeliveryPointByUserId,
    hasApprovedDeliveryPointProviderBinding,
    getProviderRemittanceConfig,
    syncEventServicePrices,
    syncReservationTasksForIds,
    ensureProductManagementSchema,
  } = ctx;
  const hasEventCoverStorage = () => isEventCoverStorageEnabled();

  function mapProductRow(row = {}) {
    const id = Number(row.id);
    return {
      ...row,
      id: Number.isFinite(id) ? id : row.id,
      code: row.code || (row.id != null ? `PD${String(row.id).padStart(6, '0')}` : null),
      price: row.price == null ? 0 : Number(row.price),
      owner_user_id: row.owner_user_id || null,
      cover: row.cover_url || (row.id != null ? `/products/${row.id}/cover` : null),
    };
  }

  async function ensureProductEditableBy(reqUser, rawProductId) {
    const productId = parsePositiveInt(rawProductId, null, { min: 1 });
    if (!productId) {
      const err = new Error('商品編號不正確');
      err.statusCode = 400;
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    await ensureProductManagementSchema();
    const [rows] = await pool.query(
      'SELECT id, name, owner_user_id, cover_path FROM products WHERE id = ? LIMIT 1',
      [productId]
    );
    const product = rows?.[0] || null;
    if (!product) {
      const err = new Error('找不到商品');
      err.statusCode = 404;
      err.code = 'PRODUCT_NOT_FOUND';
      throw err;
    }
    if (!isADMIN(reqUser?.role) && !isEDITOR(reqUser?.role)) {
      const ownerId = normalizeUserId(product.owner_user_id);
      if (!ownerId || ownerId !== normalizeUserId(reqUser?.id)) {
        const err = new Error('無權限操作此票券商品');
        err.statusCode = 403;
        err.code = 'FORBIDDEN';
        throw err;
      }
    }
    return { ...product, id: productId };
  }

  function collectProductIdsFromPrices(prices = {}) {
    return Array.from(new Set(Object.values(prices || {})
      .map((entry) => parsePositiveInt(entry?.product_id ?? entry?.productId ?? entry?.product, null, { min: 1 }))
      .filter(Boolean)));
  }

  async function ensureManageableProductPrices(reqUser, prices = {}) {
    if (isADMIN(reqUser?.role) || isEDITOR(reqUser?.role)) return;
    const ids = collectProductIdsFromPrices(prices);
    if (!ids.length) return;
    await ensureProductManagementSchema();
    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT id, owner_user_id FROM products WHERE id IN (${placeholders})`,
      ids
    );
    const owned = new Set((Array.isArray(rows) ? rows : [])
      .filter((row) => normalizeUserId(row.owner_user_id) === normalizeUserId(reqUser?.id))
      .map((row) => Number(row.id)));
    if (ids.some((id) => !owned.has(id))) {
      const err = new Error('只能綁定自己建立的票券商品');
      err.statusCode = 403;
      err.code = 'FORBIDDEN_PRODUCT_OWNER';
      throw err;
    }
  }

  async function serveProductCover(res, product = {}) {
    const contentType = product.cover_type || 'application/octet-stream';
    const coverPath = product.cover_path ? storage.normalizeRelativePath(product.cover_path) : null;
    if (coverPath && await storage.fileExists(coverPath)) {
      const stat = await storage.getFileStat(coverPath);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      if (stat?.size) res.setHeader('Content-Length', stat.size);
      const stream = storage.createReadStream(coverPath);
      stream.on('error', (err) => {
        console.error('serveProductCover stream error:', err?.message || err);
        if (!res.headersSent) res.status(500).end();
        else res.destroy();
      });
      stream.pipe(res);
      return true;
    }
    if (product.cover_data) {
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.end(product.cover_data);
      return true;
    }
    if (product.cover_url) {
      res.redirect(302, product.cover_url);
      return true;
    }
    return false;
  }

  function logBindingDebug(label, payload = {}) {
    try {
      console.log(`[binding-debug] ${label}`, JSON.stringify(payload, null, 2));
    } catch (_) {
      console.log(`[binding-debug] ${label}`, payload);
    }
  }

  function logBindingError(label, err, extra = {}) {
    logBindingDebug(label, {
      ...extra,
      error: {
        name: err?.name || '',
        code: err?.code || '',
        statusCode: err?.statusCode || null,
        message: err?.message || String(err || ''),
      },
    });
  }

  router.get('/products', async (req, res) => {
  try {
    await ensureProductManagementSchema();
    const [rows] = await pool.query('SELECT id, code, name, description, cover_url, cover_type, owner_user_id, price, created_at, updated_at FROM products ORDER BY id DESC');
    const list = rows.map(mapProductRow).map(({ owner_user_id, ...item }) => item);
    return ok(res, list);
  } catch (err) {
    return fail(res, 'PRODUCTS_LIST_FAIL', err.message, 500);
  }
});

router.get('/products/:id/cover', async (req, res) => {
  const productId = parsePositiveInt(req.params.id, null, { min: 1 });
  if (!productId) return res.status(404).end();
  try {
    await ensureProductManagementSchema();
    const [rows] = await pool.query(
      'SELECT id, name, cover_url, cover_type, cover_data, cover_path FROM products WHERE id = ? LIMIT 1',
      [productId]
    );
    if (!rows.length) return res.status(404).end();
    const served = await serveProductCover(res, rows[0]);
    if (served) return;
    if (rows[0].name) return res.redirect(302, `/tickets/cover/${encodeURIComponent(rows[0].name)}`);
    return res.status(404).end();
  } catch (err) {
    return res.status(500).end();
  }
});

router.get('/admin/products', productManagerOnly, async (req, res) => {
  try {
    await ensureProductManagementSchema();
    const where = [];
    const params = [];
    if (isSTORE(req.user.role)) {
      where.push('owner_user_id = ?');
      params.push(req.user.id);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT id, code, name, description, cover_url, cover_type, owner_user_id, price, created_at, updated_at FROM products ${whereSql} ORDER BY id DESC`,
      params
    );
    return ok(res, rows.map(mapProductRow));
  } catch (err) {
    return fail(res, 'ADMIN_PRODUCTS_LIST_FAIL', err.message, 500);
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

router.post('/admin/products', productManagerOnly, async (req, res) => {
  const parsed = ProductCreateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  let { code, name, description, price } = parsed.data;
  try {
    await ensureProductManagementSchema();
    if (!code || !String(code).trim()) code = await generateProductCode();
    const ownerId = isSTORE(req.user.role)
      ? req.user.id
      : (normalizeUserId(req.body?.ownerId ?? req.body?.owner_user_id) || null);
    const [r] = await pool.query(
      'INSERT INTO products (code, name, description, price, owner_user_id) VALUES (?, ?, ?, ?, ?)',
      [code, name, description, price, ownerId]
    );
    return ok(res, { id: r.insertId, code, owner_user_id: ownerId }, '商品已新增');
  } catch (err) {
    return fail(res, 'ADMIN_PRODUCT_CREATE_FAIL', err.message, 500);
  }
});

router.patch('/admin/products/:id', productManagerOnly, async (req, res) => {
  const parsed = ProductUpdateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  const fields = parsed.data;
  const sets = [];
  const values = [];
  for (const [k, v] of Object.entries(fields)) { sets.push(`${k} = ?`); values.push(v); }
  if (!sets.length) return ok(res, null, '無更新');
  values.push(req.params.id);
  try {
    await ensureProductEditableBy(req.user, req.params.id);
    const [r] = await pool.query(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, values);
    if (!r.affectedRows) return fail(res, 'PRODUCT_NOT_FOUND', '找不到商品', 404);
    return ok(res, null, '商品已更新');
  } catch (err) {
    if (err?.statusCode) return fail(res, err.code || 'FORBIDDEN', err.message, err.statusCode);
    return fail(res, 'ADMIN_PRODUCT_UPDATE_FAIL', err.message, 500);
  }
});

router.delete('/admin/products/:id', productManagerOnly, async (req, res) => {
  try {
    const product = await ensureProductEditableBy(req.user, req.params.id);
    const coverPath = product.cover_path ? storage.normalizeRelativePath(product.cover_path) : null;
    const [r] = await pool.query('DELETE FROM products WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return fail(res, 'PRODUCT_NOT_FOUND', '找不到商品', 404);
    if (coverPath) await storage.deleteFile(coverPath).catch(() => {});
    return ok(res, null, '商品已刪除');
  } catch (err) {
    if (err?.statusCode) return fail(res, err.code || 'FORBIDDEN', err.message, err.statusCode);
    return fail(res, 'ADMIN_PRODUCT_DELETE_FAIL', err.message, 500);
  }
});

router.post('/admin/products/:id/cover_json', productManagerOnly, async (req, res) => {
  try {
    const product = await ensureProductEditableBy(req.user, req.params.id);
    const { dataUrl, mime, base64 } = req.body || {};
    let contentType = null;
    let buffer = null;
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
    if (!buffer?.length) return fail(res, 'VALIDATION_ERROR', '檔案為空', 400);
    if (buffer.length > 10 * 1024 * 1024) return fail(res, 'PAYLOAD_TOO_LARGE', '檔案過大（>10MB）', 413);
    contentType = contentType || 'application/octet-stream';
    const previousPath = product.cover_path ? storage.normalizeRelativePath(product.cover_path) : null;
    const extension = storage.mimeToExtension(contentType);
    let storagePathRelative = null;
    let attempts = 0;
    while (attempts < 5) {
      attempts += 1;
      const candidate = buildProductCoverStoragePath(product.id, extension);
      try {
        await storage.writeBuffer(candidate, buffer, { mode: 0o600 });
        storagePathRelative = storage.normalizeRelativePath(candidate);
        break;
      } catch (err) {
        if (err?.code === 'EEXIST' && attempts < 5) continue;
        console.error('writeProductCover error:', err?.message || err);
        return fail(res, 'ADMIN_PRODUCT_COVER_UPLOAD_FAIL', '封面儲存失敗，請稍後再試', 500);
      }
    }
    try {
      await pool.query(
        'UPDATE products SET cover_url = NULL, cover_type = ?, cover_path = ?, cover_data = NULL WHERE id = ?',
        [contentType, storagePathRelative, product.id]
      );
    } catch (err) {
      if (storagePathRelative) await storage.deleteFile(storagePathRelative).catch(() => {});
      throw err;
    }
    if (previousPath && previousPath !== storagePathRelative) await storage.deleteFile(previousPath).catch(() => {});
    return ok(res, { id: product.id, size: buffer.length, type: contentType, path: storagePathRelative }, '商品封面已更新');
  } catch (err) {
    if (err?.statusCode) return fail(res, err.code || 'FORBIDDEN', err.message, err.statusCode);
    return fail(res, 'ADMIN_PRODUCT_COVER_UPLOAD_FAIL', err.message, 500);
  }
});

router.delete('/admin/products/:id/cover', productManagerOnly, async (req, res) => {
  try {
    const product = await ensureProductEditableBy(req.user, req.params.id);
    const coverPath = product.cover_path ? storage.normalizeRelativePath(product.cover_path) : null;
    await pool.query('UPDATE products SET cover_url = NULL, cover_type = NULL, cover_path = NULL, cover_data = NULL WHERE id = ?', [product.id]);
    if (coverPath) await storage.deleteFile(coverPath).catch(() => {});
    return ok(res, null, '封面已刪除');
  } catch (err) {
    if (err?.statusCode) return fail(res, err.code || 'FORBIDDEN', err.message, err.statusCode);
    return fail(res, 'ADMIN_PRODUCT_COVER_DELETE_FAIL', err.message, 500);
  }
});

router.get('/events', async (req, res) => {
  try {
    if (eventListCache.value && eventListCache.expiresAt > Date.now()) {
      return ok(res, eventListCache.value);
    }
    // 避免傳回 BLOB，明確排除 cover_data；僅返回未到期服務檔期
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
    if (!event) return fail(res, 'EVENT_NOT_FOUND', '找不到服務檔期', 404);
    return ok(res, event);
  } catch (err) {
    return fail(res, 'EVENT_READ_FAIL', err.message, 500);
  }
});

// Admin Events list (ADMIN/EDITOR: all, SERVICE_PROVIDER: active events to provide services)
router.get('/admin/events', eventManagerOnly, async (req, res) => {
  try {
    const defaultLimit = 50;
    const limit = parsePositiveInt(req.query.limit, defaultLimit, { min: 1, max: 200 });
    const offsetRaw = req.query.offset ?? req.query.skip ?? 0;
    const offset = Math.max(0, parsePositiveInt(offsetRaw, 0, { min: 0 }));
    const queryRaw = String(req.query.q || req.query.query || '').trim();
    const searchTerm = queryRaw ? `%${queryRaw}%` : null;

    const canViewAll = isADMIN(req.user.role) || isEDITOR(req.user.role);
    const isProvider = isSTORE(req.user.role);
    const baseFrom = 'FROM events e';
    const where = [];
    const params = [];
    if (isProvider) {
      where.push('(COALESCE(e.ends_at, e.deadline, e.starts_at) IS NULL OR COALESCE(e.ends_at, e.deadline, e.starts_at) >= NOW())');
    } else if (!canViewAll) {
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

router.get('/events/:id/prices', async (req, res) => {
  try {
    const prices = await listEventServicePrices(req.params.id, { useCache: true });
    return ok(res, prices);
  } catch (err) {
    return fail(res, 'EVENT_SERVICE_PRICES_LIST_FAIL', err.message, 500);
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

async function ensureEventEditableBy(reqUser, eventId) {
  const event = await getEventById(eventId, { useCache: false });
  if (!event) {
    const err = new Error('找不到服務檔期');
    err.code = 'EVENT_NOT_FOUND';
    throw err;
  }
  if (isADMIN(reqUser?.role) || isEDITOR(reqUser?.role)) return event;
  if (String(event.owner_user_id || '') !== String(reqUser?.id || '')) {
    const err = new Error('無權限管理此服務檔期');
    err.code = 'FORBIDDEN_EVENT_OWNER';
    throw err;
  }
  return event;
}

router.get('/admin/events/:id/prices', eventManagerOnly, async (req, res) => {
  try {
    await ensureEventEditableBy(req.user, req.params.id);
    const prices = await listEventServicePrices(req.params.id, { useCache: false });
    return ok(res, prices);
  } catch (err) {
    if (err?.code === 'EVENT_NOT_FOUND') return fail(res, 'EVENT_NOT_FOUND', err.message, 404);
    if (err?.code === 'FORBIDDEN_EVENT_OWNER') return fail(res, 'FORBIDDEN', err.message, 403);
    return fail(res, 'ADMIN_EVENT_SERVICE_PRICES_LIST_FAIL', err.message, 500);
  }
});

router.patch('/admin/events/:id/prices', eventManagerOnly, async (req, res) => {
  const parsed = EventServicePricesSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  try {
    await ensureEventEditableBy(req.user, req.params.id);
    await ensureManageableProductPrices(req.user, parsed.data.prices || {});
    const prices = await syncEventServicePrices(pool, req.params.id, parsed.data.prices || {});
    invalidateEventStoresCache(req.params.id);
    invalidateEventCaches(req.params.id);
    return ok(res, prices, '服務價格已更新');
  } catch (err) {
    if (err?.code === 'EVENT_NOT_FOUND') return fail(res, 'EVENT_NOT_FOUND', err.message, 404);
    if (err?.code === 'FORBIDDEN_EVENT_OWNER') return fail(res, 'FORBIDDEN', err.message, 403);
    if (err?.statusCode) return fail(res, err.code || 'FORBIDDEN', err.message, err.statusCode);
    return fail(res, 'ADMIN_EVENT_SERVICE_PRICES_UPDATE_FAIL', err.message, 500);
  }
});

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
    return ok(res, { id: r.insertId }, '服務檔期已新增');
  } catch (err) {
    return fail(res, 'ADMIN_EVENT_CREATE_FAIL', err.message, 500);
  }
});

router.patch('/admin/events/:id', eventManagerOnly, async (req, res) => {
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
    await ensureEventEditableBy(req.user, req.params.id);
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
    if (!r.affectedRows) return fail(res, 'EVENT_NOT_FOUND', '找不到服務檔期', 404);
    invalidateEventCaches(req.params.id);
    return ok(res, null, '服務檔期已更新');
  } catch (err) {
    if (err?.code === 'EVENT_NOT_FOUND') return fail(res, 'EVENT_NOT_FOUND', err.message, 404);
    if (err?.code === 'FORBIDDEN_EVENT_OWNER') return fail(res, 'FORBIDDEN', err.message, 403);
    return fail(res, 'ADMIN_EVENT_UPDATE_FAIL', err.message, 500);
  }
});

// Admin: delete event cover (both url and blob)
router.delete('/admin/events/:id/cover', eventManagerOnly, async (req, res) => {
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return fail(res, 'VALIDATION_ERROR', '服務檔期編號不正確', 400);
  }
  let coverPath = null;
  try {
    await ensureEventEditableBy(req.user, req.params.id);
    const [rows] = await pool.query(
      `SELECT owner_user_id${hasEventCoverStorage() ? ', cover_path' : ''} FROM events WHERE id = ? LIMIT 1`,
      [eventId]
    );
    if (!rows.length) return fail(res, 'EVENT_NOT_FOUND', '找不到服務檔期', 404);
    const row = rows[0];
    if (hasEventCoverStorage() && row.cover_path) {
      coverPath = storage.normalizeRelativePath(row.cover_path);
    }
  } catch (err) {
    if (err?.code === 'EVENT_NOT_FOUND') return fail(res, 'EVENT_NOT_FOUND', err.message, 404);
    if (err?.code === 'FORBIDDEN_EVENT_OWNER') return fail(res, 'FORBIDDEN', err.message, 403);
    return fail(res, 'EVENT_NOT_FOUND', err?.message || '查詢失敗', 500);
  }

  try {
    const sql = hasEventCoverStorage()
      ? 'UPDATE events SET cover = NULL, cover_type = NULL, cover_path = NULL, cover_data = NULL WHERE id = ?'
      : 'UPDATE events SET cover = NULL, cover_type = NULL, cover_data = NULL WHERE id = ?';
    const [r] = await pool.query(sql, [eventId]);
    if (!r.affectedRows) return fail(res, 'EVENT_NOT_FOUND', '找不到服務檔期', 404);
    if (coverPath) await storage.deleteFile(coverPath).catch(() => {});
    invalidateEventCaches(req.params.id);
    return ok(res, null, '封面已刪除');
  } catch (err) {
    if (err?.code === 'FORBIDDEN_EVENT_OWNER') return fail(res, 'FORBIDDEN', err.message, 403);
    return fail(res, 'ADMIN_EVENT_COVER_DELETE_FAIL', err.message, 500);
  }
});

// Admin: upload event cover as base64 JSON
router.post('/admin/events/:id/cover_json', eventManagerOnly, async (req, res) => {
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return fail(res, 'VALIDATION_ERROR', '服務檔期編號不正確', 400);
  }
  if (!hasEventCoverStorage()) {
    return fail(res, 'STORAGE_PATH_UNAVAILABLE', '封面儲存未初始化，請聯繫客服', 500);
  }
  const { dataUrl, mime, base64 } = req.body || {};
  let contentType = null;
  let buffer = null;
  let previousCoverPath = null;
  try {
    await ensureEventEditableBy(req.user, req.params.id);
    const [rows] = await pool.query(
      `SELECT owner_user_id${hasEventCoverStorage() ? ', cover_path' : ''} FROM events WHERE id = ? LIMIT 1`,
      [eventId]
    );
    if (!rows.length) return fail(res, 'EVENT_NOT_FOUND', '找不到服務檔期', 404);
    const row = rows[0];
    if (hasEventCoverStorage() && row.cover_path) {
      previousCoverPath = storage.normalizeRelativePath(row.cover_path);
    }
  } catch (err) {
    if (err?.code === 'EVENT_NOT_FOUND') return fail(res, 'EVENT_NOT_FOUND', err.message, 404);
    if (err?.code === 'FORBIDDEN_EVENT_OWNER') return fail(res, 'FORBIDDEN', err.message, 403);
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
      return fail(res, 'EVENT_NOT_FOUND', '找不到服務檔期', 404);
    }

    if (previousCoverPath && previousCoverPath !== storagePathRelative) {
      await storage.deleteFile(previousCoverPath).catch(() => {});
    }

    invalidateEventCaches(req.params.id);
    return ok(res, {
      id: eventId,
      size: buffer.length,
      type: contentType,
      path: hasEventCoverStorage() ? storagePathRelative : null
    }, '封面已更新');
  } catch (err) {
    if (err?.code === 'FORBIDDEN_EVENT_OWNER') return fail(res, 'FORBIDDEN', err.message, 403);
    return fail(res, 'ADMIN_EVENT_COVER_UPLOAD_FAIL', err.message, 500);
  }
});

// Public: serve event cover
router.get('/events/:id/cover', async (req, res) => {
  try {
    const selectSql = hasEventCoverStorage()
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

    if (hasEventCoverStorage() && e.cover_path) {
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
    return fail(res, 'VALIDATION_ERROR', '服務檔期編號不正確', 400);
  }
  let coverPath = null;
  if (hasEventCoverStorage()) {
    try {
      const [[row]] = await pool.query('SELECT cover_path FROM events WHERE id = ? LIMIT 1', [eventId]);
      if (row && row.cover_path) coverPath = storage.normalizeRelativePath(row.cover_path);
    } catch (_) { /* ignore */ }
  }
  try {
    await ensureEventEditableBy(req.user, req.params.id);
    const [r] = await pool.query('DELETE FROM events WHERE id = ?', [eventId]);
    if (!r.affectedRows) return fail(res, 'EVENT_NOT_FOUND', '找不到服務檔期', 404);
    if (coverPath) await storage.deleteFile(coverPath).catch(() => {});
    invalidateEventCaches(req.params.id);
    return ok(res, null, '服務檔期已刪除');
  } catch (err) {
    if (err?.code === 'EVENT_NOT_FOUND') return fail(res, 'EVENT_NOT_FOUND', err.message, 404);
    if (err?.code === 'FORBIDDEN_EVENT_OWNER') return fail(res, 'FORBIDDEN', err.message, 403);
    return fail(res, 'ADMIN_EVENT_DELETE_FAIL', err.message, 500);
  }
});

async function getOwnedDeliveryPointService(serviceId, userId) {
  const normalizedServiceId = parsePositiveInt(serviceId, null, { min: 1 });
  if (!normalizedServiceId) return null;
  const [rows] = await pool.query(
    `SELECT s.*, e.code AS event_code, e.title AS event_title, e.starts_at, e.ends_at, e.deadline, e.location,
            dp.owner_user_id
       FROM event_stores s
       JOIN delivery_points dp ON dp.id = s.delivery_point_id
       JOIN events e ON e.id = s.event_id
      WHERE s.id = ? AND dp.owner_user_id = ?
      LIMIT 1`,
    [normalizedServiceId, userId]
  );
  return rows?.[0] || null;
}

router.get('/delivery-point/events/available', deliveryPointOnly, async (req, res) => {
  return fail(res, 'DELIVERY_POINT_SERVICE_MANAGEMENT_DISABLED', '交車點不再自行設定服務賽事，請由服務商於活動設定中綁定。', 410);
});

router.get('/delivery-point/services', deliveryPointOnly, async (req, res) => {
  return fail(res, 'DELIVERY_POINT_SERVICE_MANAGEMENT_DISABLED', '交車點不再自行設定服務賽事，請由服務商於活動設定中綁定。', 410);
});

router.post('/delivery-point/events/:id/service', deliveryPointOnly, async (req, res) => {
  return fail(res, 'DELIVERY_POINT_SERVICE_MANAGEMENT_DISABLED', '交車點不再自行設定服務賽事，請由服務商於活動設定中綁定。', 410);
});

router.patch('/delivery-point/services/:serviceId', deliveryPointOnly, async (req, res) => {
  return fail(res, 'DELIVERY_POINT_SERVICE_MANAGEMENT_DISABLED', '交車點不再自行設定服務賽事，請由服務商於活動設定中綁定。', 410);
});

router.delete('/delivery-point/services/:serviceId', deliveryPointOnly, async (req, res) => {
  return fail(res, 'DELIVERY_POINT_SERVICE_MANAGEMENT_DISABLED', '交車點不再自行設定服務賽事，請由服務商於活動設定中綁定。', 410);
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
  early_start: z.union([z.string(), z.null()]).optional(),
  earlyStart: z.union([z.string(), z.null()]).optional(),
  early_end: z.union([z.string(), z.null()]).optional(),
  earlyEnd: z.union([z.string(), z.null()]).optional(),
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
  const earlyStart = normalizeDateTimeInput(entry.early_start ?? entry.earlyStart);
  const earlyEnd = normalizeDateTimeInput(entry.early_end ?? entry.earlyEnd);
  if (earlyStart) base.early_start = earlyStart;
  if (earlyEnd) base.early_end = earlyEnd;
  return base;
});
const PricesSchema = z.record(z.string().min(1), PriceEntrySchema);
const AddressSchema = z.string().trim().max(255).nullable().optional();
const ExternalUrlSchema = z.string().trim().max(500).nullable().optional();
const BusinessHoursSchema = z.string().trim().max(1000).nullable().optional();
const RemittanceInfoSchema = z.string().trim().max(600).nullable().optional();
const RemittanceBankCodeSchema = z.string().trim().max(32).nullable().optional();
const RemittanceBankAccountSchema = z.string().trim().max(64).nullable().optional();
const RemittanceAccountNameSchema = z.string().trim().max(64).nullable().optional();
const RemittanceBankNameSchema = z.string().trim().max(64).nullable().optional();
const StoreRemittanceSchema = z.object({
  info: RemittanceInfoSchema,
  bankCode: RemittanceBankCodeSchema,
  bankAccount: RemittanceBankAccountSchema,
  accountName: RemittanceAccountNameSchema,
  bankName: RemittanceBankNameSchema,
}).partial();
const STORE_DETAIL_FIELDS = ['address', 'external_url', 'business_hours'];
const normalizeStoreDetailField = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value || '').trim();
  return text || null;
};
const mapStoreRemittance = (row = {}) => normalizeRemittanceDetails({
  info: row?.remittance?.info ?? row?.remittance_info,
  bankCode: row?.remittance?.bankCode ?? row?.remittance_bank_code,
  bankAccount: row?.remittance?.bankAccount ?? row?.remittance_bank_account,
  accountName: row?.remittance?.accountName ?? row?.remittance_account_name,
  bankName: row?.remittance?.bankName ?? row?.remittance_bank_name,
});
const normalizeStoreBody = (body = {}) => {
  const payload = { ...(body || {}) };
  if (payload.externalUrl && !payload.external_url) payload.external_url = payload.externalUrl;
  if (payload.businessHours && !payload.business_hours) payload.business_hours = payload.businessHours;
  if (payload.deliveryPointId !== undefined && payload.delivery_point_id === undefined) payload.delivery_point_id = payload.deliveryPointId;
  if (payload.preEnabled !== undefined && payload.pre_enabled === undefined) payload.pre_enabled = payload.preEnabled;
  if (payload.postEnabled !== undefined && payload.post_enabled === undefined) payload.post_enabled = payload.postEnabled;
  if (payload.isActive !== undefined && payload.is_active === undefined) payload.is_active = payload.isActive;
  if (payload.address === undefined && payload.storeAddress) payload.address = payload.storeAddress;
  if (!payload.remittance && (
    payload.remittance_info !== undefined
    || payload.remittance_bank_code !== undefined
    || payload.remittance_bank_account !== undefined
    || payload.remittance_account_name !== undefined
    || payload.remittance_bank_name !== undefined
  )) {
    payload.remittance = {
      info: payload.remittance_info,
      bankCode: payload.remittance_bank_code,
      bankAccount: payload.remittance_bank_account,
      accountName: payload.remittance_account_name,
      bankName: payload.remittance_bank_name,
    };
  }
  return payload;
};
const StoreCreateSchema = z.object({
  name: z.string().min(1),
  delivery_point_id: z.union([z.number().int().positive(), z.string().trim().min(1), z.null()]).optional(),
  is_active: z.union([z.boolean(), z.number(), z.string()]).optional(),
  address: AddressSchema,
  external_url: ExternalUrlSchema,
  business_hours: BusinessHoursSchema,
  remittance: StoreRemittanceSchema.optional(),
  prices: PricesSchema,
});
const StoreUpdateSchema = StoreCreateSchema.partial();
const EventStoreCreateSchema = z.object({
  delivery_point_id: z.union([z.number().int().positive(), z.string().trim().min(1)]),
  is_active: z.union([z.boolean(), z.number(), z.string()]).optional(),
  prices: PricesSchema,
});
const EventStoreUpdateSchema = EventStoreCreateSchema.partial();
const EventServicePricesSchema = z.object({
  prices: PricesSchema,
});
const EventDriverAssignmentSchema = z.object({
  driverId: z.union([z.string(), z.number(), z.null()]).optional().nullable(),
});

const coerceFlag = (value, defaultValue = true) => {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
};

const resolveStorePrices = (row = {}, fallbackPrices = {}) => {
  const parsed = safeParseJSON(row?.prices, {});
  const prices = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  if (Object.keys(prices).length) return prices;
  if (fallbackPrices && typeof fallbackPrices === 'object' && !Array.isArray(fallbackPrices)) return fallbackPrices;
  return {};
};

const mapEventServiceRow = (row = {}, fallbackPrices = {}) => ({
  ...row,
  address: normalizeStoreDetailField(row.address),
  external_url: normalizeStoreDetailField(row.external_url),
  business_hours: normalizeStoreDetailField(row.business_hours),
  is_active: row.is_active == null ? true : Number(row.is_active) !== 0,
  pre_enabled: row.pre_enabled == null ? true : Number(row.pre_enabled) !== 0,
  post_enabled: row.post_enabled == null ? true : Number(row.post_enabled) !== 0,
  prices: resolveStorePrices(row, fallbackPrices),
});

async function resolveDeliveryPointSnapshot(rawDeliveryPointId) {
  const deliveryPointId = parsePositiveInt(rawDeliveryPointId, null, { min: 1 });
  if (!deliveryPointId) return null;
  await ensureDeliveryPointSchema();
  const [rows] = await pool.query(
    `SELECT id, name, address, external_url, business_hours,
            remittance_info, remittance_bank_code, remittance_bank_account,
            remittance_account_name, remittance_bank_name, is_active,
            owner_user_id
       FROM delivery_points
      WHERE id = ?
      LIMIT 1`,
    [deliveryPointId]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: deliveryPointId,
    name: String(row.name || '').trim() || `交車點 #${deliveryPointId}`,
    address: normalizeStoreDetailField(row.address),
    external_url: normalizeStoreDetailField(row.external_url),
    business_hours: normalizeStoreDetailField(row.business_hours),
    remittance: normalizeRemittanceDetails({
      info: row.remittance_info,
      bankCode: row.remittance_bank_code,
      bankAccount: row.remittance_bank_account,
      accountName: row.remittance_account_name,
      bankName: row.remittance_bank_name,
    }),
    is_active: row.is_active == null ? true : Number(row.is_active) !== 0,
    owner_user_id: normalizeUserId(row.owner_user_id),
  };
}

async function resolveManagedEventRow(rawEventId, reqUser) {
  const eventId = parsePositiveInt(rawEventId, null, { min: 1 });
  if (!eventId) return null;
  const [rows] = await pool.query('SELECT id, owner_user_id FROM events WHERE id = ? LIMIT 1', [eventId]);
  const event = rows?.[0] || null;
  if (!event) return null;
  const ownerUserId = normalizeUserId(event.owner_user_id);
  return {
    id: eventId,
    owner_user_id: ownerUserId,
  };
}

async function resolveManagedDeliveryPointSnapshot(rawDeliveryPointId, reqUser) {
  const deliveryPoint = await resolveDeliveryPointSnapshot(rawDeliveryPointId);
  logBindingDebug('resolve-managed-delivery-point:start', {
    rawDeliveryPointId,
    deliveryPointFound: !!deliveryPoint,
    user: { id: normalizeUserId(reqUser?.id), role: reqUser?.role || '' },
    deliveryPoint: deliveryPoint ? {
      id: deliveryPoint.id,
      name: deliveryPoint.name,
      owner_user_id: deliveryPoint.owner_user_id,
      is_active: deliveryPoint.is_active,
    } : null,
  });
  if (!deliveryPoint) return null;
  if (!isSTORE(reqUser.role)) return deliveryPoint;
  const ownerUserId = normalizeUserId(deliveryPoint.owner_user_id);
  if (!ownerUserId) {
    const err = new Error('交車點帳號尚未綁定使用者');
    err.statusCode = 409;
    err.code = 'DELIVERY_POINT_OWNER_REQUIRED';
    throw err;
  }
  const isBound = await hasApprovedDeliveryPointProviderBinding(deliveryPoint.id, reqUser.id);
  logBindingDebug('resolve-managed-delivery-point:binding-check', {
    deliveryPointId: deliveryPoint.id,
    providerUserId: normalizeUserId(reqUser.id),
    isBound,
  });
  if (!isBound) {
    const err = new Error('只能綁定屬於自己服務商的交車點');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }
  return {
    ...deliveryPoint,
    provider_id: normalizeUserId(reqUser.id),
  };
}

function buildEventStoreMutationPayload(body = {}, current = null) {
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  const isActive = has('is_active')
    ? (coerceFlag(body.is_active, true) ? 1 : 0)
    : (current?.is_active == null ? 1 : (Number(current.is_active) !== 0 ? 1 : 0));
  return {
    is_active: isActive,
    pre_enabled: 1,
    pre_start: null,
    pre_end: null,
    post_enabled: 1,
    post_start: null,
    post_end: null,
  };
}

async function syncLegacyEventStorePrices(eventId, prices = {}) {
  const normalizedEventId = parsePositiveInt(eventId, null, { min: 1 });
  if (!normalizedEventId) return;
  const serialized = JSON.stringify(prices || {});
  try {
    await pool.query('UPDATE event_stores SET prices = ? WHERE event_id = ?', [serialized, normalizedEventId]);
  } catch (err) {
    if (err?.code !== 'ER_BAD_FIELD_ERROR') throw err;
  }
}

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

async function ensureEventStoreOwnerColumn() {
  const alters = [
    'ALTER TABLE event_stores ADD COLUMN owner_user_id CHAR(36) NULL AFTER event_id',
    'ALTER TABLE event_stores ADD INDEX idx_event_stores_owner (owner_user_id)',
  ];
  for (const sql of alters) {
    try { await pool.query(sql); } catch (err) {
      if (!['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(err?.code)) {
        console.warn('ensureEventStoreOwnerColumn error:', err?.message || err);
      }
    }
  }
}

function normalizeAssignmentDriverId(value) {
  if (value === undefined || value === null) return null;
  const normalized = normalizeUserId(value);
  return normalized || null;
}

function throwRouteError(message, code, statusCode = 400) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  throw err;
}

async function ensureProviderEventService(connOrPool, rawEventId, rawProviderUserId) {
  const eventId = parsePositiveInt(rawEventId, null, { min: 1 });
  const providerUserId = normalizeUserId(rawProviderUserId);
  if (!eventId) throwRouteError('服務檔期編號不正確', 'VALIDATION_ERROR', 400);
  if (!providerUserId) throwRouteError('服務商身分不正確', 'FORBIDDEN', 403);
  const [[event]] = await connOrPool.query(
    'SELECT id, title, owner_user_id FROM events WHERE id = ? LIMIT 1',
    [eventId]
  );
  if (!event) throwRouteError('找不到服務檔期', 'EVENT_NOT_FOUND', 404);
  const [rows] = await connOrPool.query(
    `SELECT s.id
       FROM event_stores s
       LEFT JOIN events e ON e.id = s.event_id
      WHERE s.event_id = ? AND COALESCE(s.owner_user_id, e.owner_user_id) = ?
      LIMIT 1`,
    [eventId, providerUserId]
  );
  if (!rows.length) throwRouteError('只能設定自己在此檔期的司機安排', 'FORBIDDEN', 403);
  return { ...event, id: eventId, provider_user_id: providerUserId };
}

async function validateProviderDriver(connOrPool, rawProviderUserId, rawDriverId) {
  const providerUserId = normalizeUserId(rawProviderUserId);
  const driverId = normalizeAssignmentDriverId(rawDriverId);
  if (!driverId) return null;
  const [rows] = await connOrPool.query(
    `SELECT id, username, email, role, provider_id
       FROM users
      WHERE id = ?
      LIMIT 1`,
    [driverId]
  );
  const driver = rows?.[0] || null;
  if (!driver) throwRouteError('找不到司機', 'DRIVER_NOT_FOUND', 404);
  if (String(driver.role || '').toUpperCase() !== 'DRIVER') {
    throwRouteError('只能指定司機帳號', 'FORBIDDEN', 403);
  }
  if (normalizeUserId(driver.provider_id) !== providerUserId) {
    throwRouteError('只能指定自己旗下的司機', 'FORBIDDEN', 403);
  }
  return {
    id: normalizeUserId(driver.id),
    username: driver.username || '',
    email: driver.email || '',
  };
}

async function getEventDriverAssignment(connOrPool, eventId, providerUserId) {
  await ensureEventDriverAssignmentsTable();
  const [rows] = await connOrPool.query(
    `SELECT a.event_id, a.provider_user_id, a.driver_id,
            d.username AS driver_username, d.email AS driver_email
       FROM event_driver_assignments a
       LEFT JOIN users d ON d.id = a.driver_id
      WHERE a.event_id = ? AND a.provider_user_id = ?
      LIMIT 1`,
    [eventId, providerUserId]
  );
  const row = rows?.[0] || null;
  const driverId = normalizeAssignmentDriverId(row?.driver_id);
  return {
    eventId,
    providerUserId,
    driverId,
    driver: driverId ? {
      id: driverId,
      username: row?.driver_username || '',
      email: row?.driver_email || '',
    } : null,
  };
}

async function syncUnassignedReservationsForEventDriver(conn, { eventId, providerUserId, driverId }) {
  const normalizedDriverId = normalizeAssignmentDriverId(driverId);
  if (!normalizedDriverId) return 0;
  await ensureReservationAssignmentsTable();
  const [rows] = await conn.query(
    `SELECT r.id
       FROM reservations r
       JOIN event_stores s ON s.id = r.store_id
       LEFT JOIN events e ON e.id = r.event_id
      WHERE r.event_id = ?
        AND COALESCE(s.owner_user_id, e.owner_user_id) = ?
        AND (r.driver_id IS NULL OR r.driver_id = '')
      ORDER BY r.id ASC`,
    [eventId, providerUserId]
  );
  const reservationIds = (rows || []).map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
  if (!reservationIds.length) return 0;
  const placeholders = reservationIds.map(() => '?').join(',');
  const [result] = await conn.query(
    `UPDATE reservations
        SET driver_id = ?
      WHERE id IN (${placeholders}) AND (driver_id IS NULL OR driver_id = '')`,
    [normalizedDriverId, ...reservationIds]
  );
  const syncedCount = Number(result?.affectedRows || 0);
  if (syncedCount > 0) {
    await conn.query(
      'INSERT INTO reservation_assignments (reservation_id, driver_id, assigned_by, action, note) VALUES ?',
      [reservationIds.map((id) => [id, normalizedDriverId, providerUserId, 'assign', 'event_driver_assignment'])]
    );
    await syncReservationTasksForIds(conn, reservationIds);
  }
  return syncedCount;
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
  const { name, prices } = parsed.data;
  const address = normalizeStoreDetailField(parsed.data.address);
  const externalUrl = normalizeStoreDetailField(parsed.data.external_url);
  const businessHours = normalizeStoreDetailField(parsed.data.business_hours);
  try {
    await ensureManageableProductPrices(req.user, prices || {});
    await ensureStoreTemplatesTable();
    let r;
    try {
      [r] = await pool.query(
        'INSERT INTO store_templates (name, address, external_url, business_hours, prices) VALUES (?, ?, ?, ?, ?)',
        [name, address, externalUrl, businessHours, JSON.stringify(prices)]
      );
    } catch (err) {
      if (err?.code === 'ER_BAD_FIELD_ERROR') {
        [r] = await pool.query(
          'INSERT INTO store_templates (name, prices) VALUES (?, ?)',
          [name, JSON.stringify(prices)]
        );
      } else {
        throw err;
      }
    }
    return ok(res, { id: r.insertId }, '模板已新增');
  } catch (err) {
    if (err?.statusCode) return fail(res, err.code || 'FORBIDDEN', err.message, err.statusCode);
    return fail(res, 'ADMIN_STORE_TEMPLATE_CREATE_FAIL', err.message, 500);
  }
});

router.patch('/admin/store_templates/:id', eventManagerOnly, async (req, res) => {
  const parsed = StoreUpdateSchema.safeParse(normalizeStoreBody(req.body));
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  const fields = parsed.data;
  const rawPrices = fields.prices;
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
    if (rawPrices !== undefined) await ensureManageableProductPrices(req.user, rawPrices || {});
    await ensureStoreTemplatesTable();
    let r;
    try {
      [r] = await pool.query(`UPDATE store_templates SET ${sets.join(', ')} WHERE id = ?`, values);
    } catch (err) {
      if (err?.code === 'ER_BAD_FIELD_ERROR') {
        const legacyEntries = entries.filter(([k]) => ['name', 'prices'].includes(k));
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
    if (err?.statusCode) return fail(res, err.code || 'FORBIDDEN', err.message, err.statusCode);
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

router.get('/admin/events/:id/driver', eventManagerOnly, async (req, res) => {
  if (!isSTORE(req.user?.role)) return fail(res, 'FORBIDDEN', '只有服務商可以設定賽事司機', 403);
  try {
    await ensureEventStoreOwnerColumn();
    await ensureEventDriverAssignmentsTable();
    const providerUserId = normalizeUserId(req.user.id);
    const event = await ensureProviderEventService(pool, req.params.id, providerUserId);
    const assignment = await getEventDriverAssignment(pool, event.id, providerUserId);
    return res.json(assignment);
  } catch (err) {
    if (err?.statusCode) return fail(res, err.code || 'EVENT_DRIVER_ASSIGNMENT_FAIL', err.message, err.statusCode);
    return fail(res, 'EVENT_DRIVER_ASSIGNMENT_GET_FAIL', err.message, 500);
  }
});

router.patch('/admin/events/:id/driver', eventManagerOnly, async (req, res) => {
  if (!isSTORE(req.user?.role)) return fail(res, 'FORBIDDEN', '只有服務商可以設定賽事司機', 403);
  const parsed = EventDriverAssignmentSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  let conn;
  try {
    await ensureEventStoreOwnerColumn();
    await ensureEventDriverAssignmentsTable();
    await ensureReservationAssignmentsTable();
    const providerUserId = normalizeUserId(req.user.id);
    const requestedDriverId = normalizeAssignmentDriverId(parsed.data.driverId);
    await validateProviderDriver(pool, providerUserId, requestedDriverId);
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const event = await ensureProviderEventService(conn, req.params.id, providerUserId);
    let syncedReservations = 0;
    if (requestedDriverId) {
      await conn.query(
        `INSERT INTO event_driver_assignments (event_id, provider_user_id, driver_id)
              VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE driver_id = VALUES(driver_id), updated_at = CURRENT_TIMESTAMP`,
        [event.id, providerUserId, requestedDriverId]
      );
      syncedReservations = await syncUnassignedReservationsForEventDriver(conn, {
        eventId: event.id,
        providerUserId,
        driverId: requestedDriverId,
      });
    } else {
      await conn.query(
        'DELETE FROM event_driver_assignments WHERE event_id = ? AND provider_user_id = ?',
        [event.id, providerUserId]
      );
    }
    await conn.commit();
    return res.json({
      eventId: event.id,
      providerUserId,
      driverId: requestedDriverId,
      syncedReservations,
    });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (_) {}
    }
    if (err?.statusCode) return fail(res, err.code || 'EVENT_DRIVER_ASSIGNMENT_FAIL', err.message, err.statusCode);
    return fail(res, 'EVENT_DRIVER_ASSIGNMENT_UPDATE_FAIL', err.message, 500);
  } finally {
    if (conn) conn.release();
  }
});

router.get('/admin/events/:id/stores', eventManagerOnly, async (req, res) => {
  try {
    logBindingDebug('event-stores-list:start', {
      user: { id: normalizeUserId(req.user?.id), role: req.user?.role || '' },
      eventId: req.params.id,
    });
    await ensureEventStoreOwnerColumn();
    await ensureEventStoreDetailColumns();
    await ensureEventStoreRemittanceColumns();
    await ensureEventStoreDeliveryPointColumn();
    await ensureEventStorePhaseColumns();
    await ensureEventServicePricesTable();
    const sharedPrices = await listEventServicePrices(req.params.id, { useCache: false });
    if (isSTORE(req.user.role)) {
      const eventId = Number(req.params.id);
      if (!Number.isFinite(eventId) || eventId <= 0) return fail(res, 'VALIDATION_ERROR', '服務檔期編號不正確', 400);
      let rows = [];
      try {
        [rows] = await pool.query(
          `SELECT s.id, s.event_id, COALESCE(s.owner_user_id, e.owner_user_id) AS owner_user_id,
                  s.delivery_point_id, s.name, s.address, s.external_url, s.business_hours,
                  s.remittance_info, s.remittance_bank_code, s.remittance_bank_account,
                  s.remittance_account_name, s.remittance_bank_name, s.is_active,
                  s.pre_enabled, s.pre_start, s.pre_end, s.post_enabled, s.post_start, s.post_end,
                  s.prices, s.created_at, s.updated_at
             FROM event_stores s
             LEFT JOIN events e ON e.id = s.event_id
            WHERE s.event_id = ? AND COALESCE(s.owner_user_id, e.owner_user_id) = ?
            ORDER BY s.id ASC`,
          [eventId, req.user.id]
        );
      } catch (err) {
        if (err?.code === 'ER_BAD_FIELD_ERROR') {
          [rows] = await pool.query(
            `SELECT s.id, s.event_id, COALESCE(s.owner_user_id, e.owner_user_id) AS owner_user_id,
                    s.name, s.pre_start, s.pre_end, s.post_start, s.post_end, s.prices, s.created_at, s.updated_at
               FROM event_stores s
               LEFT JOIN events e ON e.id = s.event_id
              WHERE s.event_id = ? AND COALESCE(s.owner_user_id, e.owner_user_id) = ?
              ORDER BY s.id ASC`,
            [eventId, req.user.id]
          );
        } else {
          throw err;
        }
      }
      const list = rows.map((r) => {
        const remittance = mapStoreRemittance(r);
        return {
          ...mapEventServiceRow(r, sharedPrices),
          remittance,
          remittance_configured: hasRemittanceDetails(remittance),
        };
      });
      logBindingDebug('event-stores-list:provider-result', {
        user: { id: normalizeUserId(req.user?.id), role: req.user?.role || '' },
        eventId,
        count: list.length,
        items: list.map((item) => ({ id: item.id, delivery_point_id: item.delivery_point_id, owner_user_id: item.owner_user_id, name: item.name, is_active: item.is_active })),
      });
      return ok(res, list);
    }
    let rows = [];
    try {
      [rows] = await pool.query(
        'SELECT id, event_id, owner_user_id, delivery_point_id, name, address, external_url, business_hours, remittance_info, remittance_bank_code, remittance_bank_account, remittance_account_name, remittance_bank_name, is_active, pre_enabled, pre_start, pre_end, post_enabled, post_start, post_end, prices, created_at, updated_at FROM event_stores WHERE event_id = ? ORDER BY id ASC',
        [req.params.id]
      );
    } catch (err) {
      if (err?.code === 'ER_BAD_FIELD_ERROR') {
        const list = await listEventStores(req.params.id, { useCache: false });
        return ok(res, list.map((item) => ({
          ...item,
          remittance: normalizeRemittanceDetails(),
        })));
      }
      throw err;
    }
    const list = rows.map((r) => {
      const remittance = mapStoreRemittance(r);
      return {
        ...mapEventServiceRow(r, sharedPrices),
        remittance,
        remittance_configured: hasRemittanceDetails(remittance),
      };
    });
    logBindingDebug('event-stores-list:admin-result', {
      user: { id: normalizeUserId(req.user?.id), role: req.user?.role || '' },
      eventId: req.params.id,
      count: list.length,
      items: list.map((item) => ({ id: item.id, delivery_point_id: item.delivery_point_id, owner_user_id: item.owner_user_id, name: item.name, is_active: item.is_active })),
    });
    return ok(res, list);
  } catch (err) {
    logBindingError('event-stores-list:error', err, {
      user: { id: normalizeUserId(req.user?.id), role: req.user?.role || '' },
      eventId: req.params.id,
    });
    return fail(res, 'ADMIN_EVENT_STORES_LIST_FAIL', err.message, 500);
  }
});

router.post('/admin/events/:id/stores', eventManagerOnly, async (req, res) => {
  const parsed = EventStoreCreateSchema.safeParse(normalizeStoreBody(req.body));
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  const deliveryPointId = parsePositiveInt(parsed.data.delivery_point_id, null, { min: 1 });
  if (!deliveryPointId) return fail(res, 'VALIDATION_ERROR', '請選擇交車點帳號', 400);
  try {
    logBindingDebug('event-store-create:start', {
      user: { id: normalizeUserId(req.user?.id), role: req.user?.role || '' },
      eventId: req.params.id,
      deliveryPointId,
      bodyKeys: Object.keys(req.body || {}),
      normalizedBody: {
        delivery_point_id: parsed.data.delivery_point_id,
        priceTypes: Object.keys(parsed.data.prices || {}),
      },
    });
    await ensureEventStoreOwnerColumn();
    await ensureEventStoreDetailColumns();
    await ensureEventStoreRemittanceColumns();
    await ensureEventStoreDeliveryPointColumn();
    await ensureEventStorePhaseColumns();
    const event = await resolveManagedEventRow(req.params.id, req.user);
    if (!event) return fail(res, 'EVENT_NOT_FOUND', '找不到服務檔期', 404);
    const deliveryPoint = await resolveManagedDeliveryPointSnapshot(deliveryPointId, req.user);
    logBindingDebug('event-store-create:delivery-point', {
      eventId: event?.id || null,
      eventOwnerUserId: event?.owner_user_id || null,
      deliveryPoint: deliveryPoint ? {
        id: deliveryPoint.id,
        name: deliveryPoint.name,
        owner_user_id: deliveryPoint.owner_user_id,
        provider_id: deliveryPoint.provider_id || null,
        is_active: deliveryPoint.is_active,
      } : null,
    });
    if (!deliveryPoint) return fail(res, 'DELIVERY_POINT_NOT_FOUND', '找不到交車點帳號', 404);
    if (!deliveryPoint.is_active) return fail(res, 'DELIVERY_POINT_INACTIVE', '交車點帳號已停用，無法綁定', 400);
    const body = parsed.data || {};
    const prices = body.prices || {};
    if (!Object.keys(prices).length) {
      return fail(res, 'VALIDATION_ERROR', '請至少設定一個方案項目價格', 400);
    }
    await ensureManageableProductPrices(req.user, prices);
    const serviceData = buildEventStoreMutationPayload(body);
    const ownerUserId = isSTORE(req.user.role)
      ? normalizeUserId(req.user.id)
      : (event.owner_user_id || normalizeUserId(req.user.id) || null);
    const remittance = normalizeRemittanceDetails(await getProviderRemittanceConfig(ownerUserId));
    const [existingRows] = await pool.query(
      'SELECT id, owner_user_id FROM event_stores WHERE event_id = ? AND delivery_point_id = ? ORDER BY id ASC LIMIT 1',
      [req.params.id, deliveryPointId]
    );
    const existing = existingRows?.[0] || null;
    let serviceId = existing?.id || null;
    if (existing) {
      const effectiveOwnerId = normalizeUserId(existing.owner_user_id) || ownerUserId;
      if (isSTORE(req.user.role) && effectiveOwnerId && effectiveOwnerId !== normalizeUserId(req.user.id)) {
        return fail(res, 'FORBIDDEN', '無權限操作此交車點資訊', 403);
      }
      await pool.query(
        `UPDATE event_stores
            SET owner_user_id = ?,
                name = ?,
                address = ?,
                external_url = ?,
                business_hours = ?,
                remittance_info = ?,
                remittance_bank_code = ?,
                remittance_bank_account = ?,
                remittance_account_name = ?,
                remittance_bank_name = ?,
                is_active = ?,
                pre_enabled = ?,
                pre_start = ?,
                pre_end = ?,
                post_enabled = ?,
                post_start = ?,
                post_end = ?,
                prices = ?
          WHERE id = ?`,
        [
          ownerUserId,
          deliveryPoint.name,
          deliveryPoint.address,
          deliveryPoint.external_url,
          deliveryPoint.business_hours,
          remittance.info || null,
          remittance.bankCode || null,
          remittance.bankAccount || null,
          remittance.accountName || null,
          remittance.bankName || null,
          serviceData.is_active,
          serviceData.pre_enabled,
          serviceData.pre_start,
          serviceData.pre_end,
          serviceData.post_enabled,
          serviceData.post_start,
          serviceData.post_end,
          JSON.stringify(prices),
          existing.id,
        ]
      );
    } else {
      const [result] = await pool.query(
        `INSERT INTO event_stores (
          event_id, owner_user_id, delivery_point_id, name, address, external_url, business_hours,
          remittance_info, remittance_bank_code, remittance_bank_account, remittance_account_name, remittance_bank_name,
          is_active, pre_enabled, pre_start, pre_end, post_enabled, post_start, post_end, prices
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.id,
          ownerUserId,
          deliveryPoint.id,
          deliveryPoint.name,
          deliveryPoint.address,
          deliveryPoint.external_url,
          deliveryPoint.business_hours,
          remittance.info || null,
          remittance.bankCode || null,
          remittance.bankAccount || null,
          remittance.accountName || null,
          remittance.bankName || null,
          serviceData.is_active,
          serviceData.pre_enabled,
          serviceData.pre_start,
          serviceData.pre_end,
          serviceData.post_enabled,
          serviceData.post_start,
          serviceData.post_end,
          JSON.stringify(prices),
        ]
      );
      serviceId = result?.insertId || null;
    }
    invalidateEventStoresCache(req.params.id);
    invalidateEventCaches(req.params.id);
    logBindingDebug('event-store-create:success', {
      eventId: event.id,
      deliveryPointId: deliveryPoint.id,
      serviceId,
      mode: existing ? 'update-existing' : 'insert-new',
    });
    return ok(res, { id: serviceId }, existing ? '交車點服務已更新' : '交車點服務已建立');
  } catch (err) {
    logBindingError('event-store-create:error', err, {
      user: { id: normalizeUserId(req.user?.id), role: req.user?.role || '' },
      eventId: req.params.id,
      deliveryPointId,
    });
    if (err?.statusCode) return fail(res, err.code || 'FORBIDDEN', err.message, err.statusCode);
    return fail(res, 'ADMIN_EVENT_STORE_CREATE_FAIL', err.message, 500);
  }
});

router.patch('/admin/events/stores/:storeId', eventManagerOnly, async (req, res) => {
  const parsed = EventStoreUpdateSchema.safeParse(normalizeStoreBody(req.body));
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  const fields = parsed.data || {};
  const hasDeliveryPointInput = Object.prototype.hasOwnProperty.call(fields, 'delivery_point_id');
  const requestedDeliveryPointId = hasDeliveryPointInput
    ? parsePositiveInt(fields.delivery_point_id, null, { min: 1 })
    : null;
  if (!Object.keys(fields).length) return ok(res, null, '無更新');
  if (hasDeliveryPointInput && !requestedDeliveryPointId) return fail(res, 'VALIDATION_ERROR', '請選擇交車點帳號', 400);
  let eventIdForCache = null;
  try {
    logBindingDebug('event-store-update:start', {
      user: { id: normalizeUserId(req.user?.id), role: req.user?.role || '' },
      storeId: req.params.storeId,
      hasDeliveryPointInput,
      requestedDeliveryPointId,
      bodyKeys: Object.keys(req.body || {}),
      fieldKeys: Object.keys(fields || {}),
    });
    await ensureEventStoreOwnerColumn();
    await ensureEventStoreDetailColumns();
    await ensureEventStoreRemittanceColumns();
    await ensureEventStoreDeliveryPointColumn();
    await ensureEventStorePhaseColumns();
    const [meta] = await pool.query(
      `SELECT s.id, s.event_id, s.owner_user_id, s.delivery_point_id, s.name, s.address, s.external_url, s.business_hours,
              s.remittance_info, s.remittance_bank_code, s.remittance_bank_account, s.remittance_account_name, s.remittance_bank_name,
              s.is_active, s.pre_enabled, s.pre_start, s.pre_end, s.post_enabled, s.post_start, s.post_end, s.prices,
              e.owner_user_id AS event_owner_user_id
         FROM event_stores s
         LEFT JOIN events e ON e.id = s.event_id
        WHERE s.id = ?
        LIMIT 1`,
      [req.params.storeId]
    );
    if (!meta.length) return fail(res, 'STORE_NOT_FOUND', '找不到交車點資訊', 404);
    const current = meta[0];
    const effectiveOwnerId = normalizeUserId(current.owner_user_id) || normalizeUserId(current.event_owner_user_id);
    if (isSTORE(req.user.role) && effectiveOwnerId && effectiveOwnerId !== normalizeUserId(req.user.id)) {
      return fail(res, 'FORBIDDEN', '無權限操作此交車點資訊', 403);
    }
    eventIdForCache = current.event_id;
    let deliveryPoint = null;
    const nextDeliveryPointId = hasDeliveryPointInput ? requestedDeliveryPointId : parsePositiveInt(current.delivery_point_id, null, { min: 1 });
    if (!nextDeliveryPointId) return fail(res, 'VALIDATION_ERROR', '請選擇交車點帳號', 400);
    if (isSTORE(req.user.role) || hasDeliveryPointInput) {
      deliveryPoint = await resolveManagedDeliveryPointSnapshot(nextDeliveryPointId, req.user);
      logBindingDebug('event-store-update:delivery-point', {
        storeId: req.params.storeId,
        nextDeliveryPointId,
        deliveryPoint: deliveryPoint ? {
          id: deliveryPoint.id,
          name: deliveryPoint.name,
          owner_user_id: deliveryPoint.owner_user_id,
          provider_id: deliveryPoint.provider_id || null,
          is_active: deliveryPoint.is_active,
        } : null,
      });
      if (!deliveryPoint) return fail(res, 'DELIVERY_POINT_NOT_FOUND', '找不到交車點帳號', 404);
      if (!deliveryPoint.is_active) return fail(res, 'DELIVERY_POINT_INACTIVE', '交車點帳號已停用，無法綁定', 400);
    }
    if (hasDeliveryPointInput) {
      const [targetRows] = await pool.query(
        'SELECT id FROM event_stores WHERE event_id = ? AND delivery_point_id = ? AND id <> ? ORDER BY id ASC LIMIT 1',
        [eventIdForCache, nextDeliveryPointId, req.params.storeId]
      );
      if (targetRows?.length) {
        return fail(res, 'EVENT_STORE_DELIVERY_POINT_DUPLICATE', '此交車點已綁定於本活動', 409);
      }
    }
    const nextPrices = Object.prototype.hasOwnProperty.call(fields, 'prices')
      ? (fields.prices || {})
      : resolveStorePrices(current);
    if (!Object.keys(nextPrices || {}).length) return fail(res, 'VALIDATION_ERROR', '請至少設定一個方案項目價格', 400);
    await ensureManageableProductPrices(req.user, nextPrices);
    const serviceData = buildEventStoreMutationPayload(fields, current);
    const ownerUserId = isSTORE(req.user.role)
      ? normalizeUserId(req.user.id)
      : (normalizeUserId(current.owner_user_id) || normalizeUserId(current.event_owner_user_id) || effectiveOwnerId || normalizeUserId(req.user.id) || null);
    const pointSnapshot = deliveryPoint || current;
    const remittance = normalizeRemittanceDetails(await getProviderRemittanceConfig(ownerUserId));
    await pool.query(
      `UPDATE event_stores
          SET owner_user_id = ?,
              delivery_point_id = ?,
              name = ?,
              address = ?,
              external_url = ?,
              business_hours = ?,
              remittance_info = ?,
              remittance_bank_code = ?,
              remittance_bank_account = ?,
              remittance_account_name = ?,
              remittance_bank_name = ?,
              is_active = ?,
              pre_enabled = ?,
              pre_start = ?,
              pre_end = ?,
              post_enabled = ?,
              post_start = ?,
              post_end = ?,
              prices = ?
        WHERE id = ?`,
      [
        ownerUserId,
        nextDeliveryPointId,
        String(pointSnapshot.name || '').trim() || current.name,
        pointSnapshot.address ?? current.address ?? null,
        pointSnapshot.external_url ?? current.external_url ?? null,
        pointSnapshot.business_hours ?? current.business_hours ?? null,
        remittance.info || null,
        remittance.bankCode || null,
        remittance.bankAccount || null,
        remittance.accountName || null,
        remittance.bankName || null,
        serviceData.is_active,
        serviceData.pre_enabled,
        serviceData.pre_start,
        serviceData.pre_end,
        serviceData.post_enabled,
        serviceData.post_start,
        serviceData.post_end,
        JSON.stringify(nextPrices),
        req.params.storeId,
      ]
    );
    invalidateEventStoresCache(eventIdForCache);
    invalidateEventCaches(eventIdForCache);
    logBindingDebug('event-store-update:success', {
      storeId: req.params.storeId,
      eventId: eventIdForCache,
      nextDeliveryPointId,
      ownerUserId,
    });
    return ok(res, { id: Number(req.params.storeId) || req.params.storeId }, '交車點服務已更新');
  } catch (err) {
    logBindingError('event-store-update:error', err, {
      user: { id: normalizeUserId(req.user?.id), role: req.user?.role || '' },
      storeId: req.params.storeId,
      eventId: eventIdForCache,
      requestedDeliveryPointId,
    });
    if (err?.statusCode) return fail(res, err.code || 'FORBIDDEN', err.message, err.statusCode);
    return fail(res, 'ADMIN_EVENT_STORE_UPDATE_FAIL', err.message, 500);
  }
});

router.delete('/admin/events/stores/:storeId', eventManagerOnly, async (req, res) => {
  try {
    let eventIdForCache = null;
    await ensureEventStoreOwnerColumn();
    const [meta] = await pool.query(
      `SELECT s.event_id, COALESCE(s.owner_user_id, e.owner_user_id) AS owner_user_id
         FROM event_stores s
         LEFT JOIN events e ON e.id = s.event_id
        WHERE s.id = ?
        LIMIT 1`,
      [req.params.storeId]
    );
    if (!meta.length) return fail(res, 'STORE_NOT_FOUND', '找不到交車點資訊', 404);
    if (isSTORE(req.user.role) && String(meta[0].owner_user_id || '') !== String(req.user.id)) {
      return fail(res, 'FORBIDDEN', '無權限操作此交車點資訊', 403);
    }
    eventIdForCache = meta[0].event_id;
    const [r] = await pool.query('DELETE FROM event_stores WHERE id = ?', [req.params.storeId]);
    if (!r.affectedRows) return fail(res, 'STORE_NOT_FOUND', '找不到交車點資訊', 404);
    invalidateEventStoresCache(eventIdForCache);
    invalidateEventCaches(eventIdForCache);
    return ok(res, null, '交車點資訊已刪除');
  } catch (err) {
    return fail(res, 'ADMIN_EVENT_STORE_DELETE_FAIL', err.message, 500);
  }
});

  return router;
}

module.exports = buildCatalogRoutes;
