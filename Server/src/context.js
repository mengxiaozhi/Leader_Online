// server.js
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const QRCode = require('qrcode');
const path = require('path');
const storage = require('../storage');
require('dotenv').config();

const app = express();

storage.ensureStorageRoot().catch((err) => {
  console.error('❌ Failed to initialize storage directory:', err?.message || err);
});

/** ======== 反向代理設定（讓 secure cookie 正常） ======== */
app.set('trust proxy', 1);

/** ======== 安全與中介層 ======== */
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

/** ======== CORS ======== */
const ALLOW_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const corsConfig = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOW_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
};
app.use((req, res, next) => { res.setHeader('Vary', 'Origin'); next(); });
app.use(cors(corsConfig));
app.options('*', cors(corsConfig));

/** ======== 速率限制 ======== */
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(['/login', '/users'], authLimiter);

/** ======== 回應工具 ======== */
const ok = (res, data = null, message = 'Success') => res.json({ ok: true, message, data });
const fail = (res, code = 'INTERNAL_ERROR', message = 'Internal error', status = 500) =>
  res.status(status).json({ ok: false, code, message });

/** ======== DB 連線池 ======== */
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'leader_online',
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_POOL || '10', 10),
  queueLimit: 0,
  charset: 'utf8mb4_unicode_ci',
});

// 開機檢查
(async () => {
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    console.log('✅ MySQL 連線正常');
    conn.release();
  } catch (err) {
    console.error('❌ MySQL 連線失敗：', err.message);
  }
})();

let reservationHasEventIdColumn = false;
let reservationHasStoreIdColumn = false;
let reservationHasDriverIdColumn = false;
let reservationHasOrderIdColumn = false;
let reservationHasDeliveryPointIdColumn = false;
let usersHaveProviderIdColumn = false;
let usersHaveVipColumn = false;
let usersHaveRemittanceColumns = false;
let usersHaveServiceTermsColumn = false;
let eventStoresHaveRemittanceColumns = false;
let eventStoresHaveDeliveryPointIdColumn = false;
let eventStoresHavePhaseColumns = false;
let eventStoresHaveCapacityColumn = false;
let reservationAssignmentsTableReady = false;
let eventDriverAssignmentsTableReady = false;
let deliveryPointsTableReady = false;
let deliveryPointProviderBindingsTableReady = false;
let reservationTasksTableReady = false;
let eventServicePricesTableReady = false;
let reservationOrderIdBackfillDone = false;
let deliveryPointBackfillDone = false;
let reservationTaskBackfillDone = false;
let eventServicePriceBackfillDone = false;
let deliveryPointSchemaReady = false;
let checklistPhotosHaveStoragePath = false;
let eventsHaveCoverPathColumn = false;
let ticketCoversHaveStoragePath = false;
let ticketsHaveProductIdColumn = false;
let productManagementSchemaReady = false;
let eventsHaveExclusiveColumn = false;
let eventsHaveListingStatusColumn = false;
const DEFAULT_CACHE_TTL = 30 * 1000;
const eventDetailCache = new Map();
const eventStoresCache = new Map();
const eventServicePricesCache = new Map();
const eventListCache = { value: null, expiresAt: 0 };

const LISTING_STATUS_DRAFT = 'draft';
const LISTING_STATUS_PUBLISHED = 'published';
const LISTING_STATUS_VALUES = new Set([LISTING_STATUS_DRAFT, LISTING_STATUS_PUBLISHED]);
function normalizeListingStatus(value, fallback = LISTING_STATUS_PUBLISHED) {
  const normalizedFallback = LISTING_STATUS_VALUES.has(String(fallback || '').trim().toLowerCase())
    ? String(fallback).trim().toLowerCase()
    : LISTING_STATUS_PUBLISHED;
  if (value === undefined || value === null || value === '') return normalizedFallback;
  if (typeof value === 'boolean') return value ? LISTING_STATUS_PUBLISHED : LISTING_STATUS_DRAFT;
  if (typeof value === 'number') return value === 0 ? LISTING_STATUS_DRAFT : LISTING_STATUS_PUBLISHED;
  const normalized = String(value).trim().toLowerCase();
  if (LISTING_STATUS_VALUES.has(normalized)) return normalized;
  if (['publish', 'published', 'active', 'online', '上架', '發布', '已發布', '1', 'true', 'yes', 'on'].includes(normalized)) return LISTING_STATUS_PUBLISHED;
  if (['draft', 'inactive', 'offline', 'hidden', '暫存', '草稿', '未發布', '下架', '0', 'false', 'no', 'off'].includes(normalized)) return LISTING_STATUS_DRAFT;
  return normalizedFallback;
}
function isPublishedListingStatus(value) {
  return normalizeListingStatus(value, LISTING_STATUS_PUBLISHED) === LISTING_STATUS_PUBLISHED;
}

const cacheUtils = {
  get(map, key) {
    const entry = map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      map.delete(key);
      return null;
    }
    return entry.value;
  },
  set(map, key, value, ttl = DEFAULT_CACHE_TTL) {
    map.set(key, { value, expiresAt: Date.now() + ttl });
  },
  delete(map, key) {
    map.delete(key);
  }
};
const invalidateEventListCache = () => {
  eventListCache.value = null;
  eventListCache.expiresAt = 0;
};
const invalidateEventCaches = (eventId) => {
  if (eventId !== null && eventId !== undefined) {
    const key = String(eventId);
    cacheUtils.delete(eventDetailCache, key);
    cacheUtils.delete(eventStoresCache, key);
    cacheUtils.delete(eventServicePricesCache, key);
  }
  invalidateEventListCache();
};
const invalidateEventStoresCache = (eventId) => {
  if (eventId === null || eventId === undefined) return;
  cacheUtils.delete(eventStoresCache, String(eventId));
};
async function detectReservationIdColumns() {
  try {
    const [eventCol] = await pool.query("SHOW COLUMNS FROM reservations LIKE 'event_id'");
    reservationHasEventIdColumn = Array.isArray(eventCol) && eventCol.length > 0;
  } catch (err) {
    console.warn('detectReservationIdColumns event_id error:', err?.message || err);
    reservationHasEventIdColumn = false;
  }
  try {
    const [storeCol] = await pool.query("SHOW COLUMNS FROM reservations LIKE 'store_id'");
    reservationHasStoreIdColumn = Array.isArray(storeCol) && storeCol.length > 0;
  } catch (err) {
    console.warn('detectReservationIdColumns store_id error:', err?.message || err);
    reservationHasStoreIdColumn = false;
  }
  try {
    const [driverCol] = await pool.query("SHOW COLUMNS FROM reservations LIKE 'driver_id'");
    reservationHasDriverIdColumn = Array.isArray(driverCol) && driverCol.length > 0;
  } catch (err) {
    console.warn('detectReservationIdColumns driver_id error:', err?.message || err);
    reservationHasDriverIdColumn = false;
  }
  try {
    const [orderCol] = await pool.query("SHOW COLUMNS FROM reservations LIKE 'order_id'");
    reservationHasOrderIdColumn = Array.isArray(orderCol) && orderCol.length > 0;
  } catch (err) {
    console.warn('detectReservationIdColumns order_id error:', err?.message || err);
    reservationHasOrderIdColumn = false;
  }
  try {
    const [deliveryPointCol] = await pool.query("SHOW COLUMNS FROM reservations LIKE 'delivery_point_id'");
    reservationHasDeliveryPointIdColumn = Array.isArray(deliveryPointCol) && deliveryPointCol.length > 0;
  } catch (err) {
    console.warn('detectReservationIdColumns delivery_point_id error:', err?.message || err);
    reservationHasDeliveryPointIdColumn = false;
  }
}

function buildReservationOrderBackfillKey(source = {}) {
  const eventId = normalizePositiveInt(source.eventId ?? source.event_id);
  const storeId = normalizePositiveInt(source.storeId ?? source.store_id);
  const eventName = String(source.eventName ?? source.event ?? '').trim();
  const storeName = String(source.storeName ?? source.store ?? '').trim();
  const ticketType = String(source.ticketType ?? source.ticket_type ?? '').trim();
  return [String(eventId || 0), eventName, String(storeId || 0), storeName, ticketType].join('||');
}

function buildOrderReservationExpectation(details = {}) {
  const counts = new Map();
  const eventId = normalizePositiveInt(details?.event?.id ?? details?.event_id ?? details?.eventId);
  const eventName = String(details?.event?.name || details?.event || '').trim();
  const selections = Array.isArray(details.selections) ? details.selections : [];
  let total = 0;
  for (const sel of selections) {
    const qty = Math.max(0, Number(sel.qty || sel.quantity || 0));
    if (!qty) continue;
    const key = buildReservationOrderBackfillKey({
      eventId,
      eventName,
      storeId: sel.storeId ?? sel.store_id ?? sel.storeID,
      storeName: sel.store,
      ticketType: sel.type || sel.ticketType || '',
    });
    counts.set(key, (counts.get(key) || 0) + qty);
    total += qty;
  }
  return { counts, total };
}

function mapsEqual(left = new Map(), right = new Map()) {
  if (left.size !== right.size) return false;
  for (const [key, value] of left.entries()) {
    if ((right.get(key) || 0) !== value) return false;
  }
  return true;
}

async function backfillReservationOrderIds() {
  if (!reservationHasOrderIdColumn || reservationOrderIdBackfillDone) return;
  reservationOrderIdBackfillDone = true;
  try {
    const [reservationRows] = await pool.query(
      `SELECT id, user_id, ticket_type, event_id, store_id, store, event
       FROM reservations
       WHERE order_id IS NULL OR order_id = 0
       ORDER BY id ASC`
    );
    if (!Array.isArray(reservationRows) || !reservationRows.length) return;

    const [orderRows] = await pool.query('SELECT id, user_id, details FROM orders ORDER BY id ASC');
    if (!Array.isArray(orderRows) || !orderRows.length) return;

    const candidatesByUser = new Map();
    for (const row of reservationRows) {
      const userId = String(row.user_id || '');
      if (!userId) continue;
      if (!candidatesByUser.has(userId)) candidatesByUser.set(userId, []);
      candidatesByUser.get(userId).push(row);
    }

    let linkedOrders = 0;
    let linkedReservations = 0;
    for (const order of orderRows) {
      const userId = String(order.user_id || '');
      if (!userId) continue;
      const details = safeParseJSON(order.details, {});
      const expected = buildOrderReservationExpectation(details);
      if (!expected.total) continue;

      const poolForUser = candidatesByUser.get(userId) || [];
      if (!poolForUser.length) continue;

      const matched = poolForUser.filter((row) => expected.counts.has(buildReservationOrderBackfillKey(row)));
      if (matched.length !== expected.total) continue;

      const actual = new Map();
      for (const row of matched) {
        const key = buildReservationOrderBackfillKey(row);
        actual.set(key, (actual.get(key) || 0) + 1);
      }
      if (!mapsEqual(expected.counts, actual)) continue;

      const ids = matched
        .map((row) => Number(row.id))
        .filter((id) => Number.isFinite(id) && id > 0);
      if (!ids.length) continue;

      const placeholders = ids.map(() => '?').join(',');
      await pool.query(
        `UPDATE reservations
         SET order_id = ?
         WHERE id IN (${placeholders}) AND (order_id IS NULL OR order_id = 0)`,
        [order.id, ...ids]
      );

      linkedOrders += 1;
      linkedReservations += ids.length;
      candidatesByUser.set(
        userId,
        poolForUser.filter((row) => !ids.includes(Number(row.id)))
      );
    }

    if (linkedOrders || linkedReservations) {
      console.log(`[reservations] backfilled order links: ${linkedOrders} orders / ${linkedReservations} reservations`);
    }
  } catch (err) {
    reservationOrderIdBackfillDone = false;
    console.warn('backfill reservation order_id error:', err?.message || err);
  }
}

async function ensureReservationIdColumns() {
  await detectReservationIdColumns();
  if (!reservationHasEventIdColumn) {
    try {
      await pool.query('ALTER TABLE reservations ADD COLUMN event_id INT UNSIGNED NULL AFTER ticket_type');
    } catch (err) {
      if (err?.code !== 'ER_DUP_FIELDNAME') console.error('add reservations.event_id error:', err?.message || err);
    }
    try {
      await pool.query('ALTER TABLE reservations ADD INDEX idx_reservations_event (event_id)');
    } catch (err) {
      if (err?.code !== 'ER_DUP_KEYNAME') console.warn('index idx_reservations_event error:', err?.message || err);
    }
  }
  await detectReservationIdColumns();
  if (!reservationHasStoreIdColumn) {
    try {
      await pool.query('ALTER TABLE reservations ADD COLUMN store_id INT UNSIGNED NULL AFTER event_id');
    } catch (err) {
      if (err?.code !== 'ER_DUP_FIELDNAME') console.error('add reservations.store_id error:', err?.message || err);
    }
    try {
      await pool.query('ALTER TABLE reservations ADD INDEX idx_reservations_store (store_id)');
    } catch (err) {
      if (err?.code !== 'ER_DUP_KEYNAME') console.warn('index idx_reservations_store error:', err?.message || err);
    }
  }
  await detectReservationIdColumns();
  if (!reservationHasDriverIdColumn) {
    try {
      await pool.query('ALTER TABLE reservations ADD COLUMN driver_id CHAR(36) NULL AFTER store_id');
    } catch (err) {
      if (err?.code !== 'ER_DUP_FIELDNAME') console.error('add reservations.driver_id error:', err?.message || err);
    }
    try {
      await pool.query('ALTER TABLE reservations ADD INDEX idx_reservations_driver (driver_id)');
    } catch (err) {
      if (err?.code !== 'ER_DUP_KEYNAME') console.warn('index idx_reservations_driver error:', err?.message || err);
    }
  }
  await detectReservationIdColumns();
  if (!reservationHasOrderIdColumn) {
    try {
      await pool.query('ALTER TABLE reservations ADD COLUMN order_id BIGINT UNSIGNED NULL AFTER driver_id');
    } catch (err) {
      if (err?.code !== 'ER_DUP_FIELDNAME') console.error('add reservations.order_id error:', err?.message || err);
    }
    try {
      await pool.query('ALTER TABLE reservations ADD INDEX idx_reservations_order (order_id)');
    } catch (err) {
      if (err?.code !== 'ER_DUP_KEYNAME') console.warn('index idx_reservations_order error:', err?.message || err);
    }
  }
  await detectReservationIdColumns();
  if (reservationHasEventIdColumn) {
    try {
      const [[needSync]] = await pool.query(
        'SELECT 1 AS v FROM reservations WHERE event_id IS NULL OR event_id = 0 LIMIT 1'
      );
      if (needSync?.v) {
        await pool.query(`
          UPDATE reservations r
          JOIN events e ON (r.event_id IS NULL OR r.event_id = 0) AND (r.event = e.title OR r.event = e.code)
          SET r.event_id = e.id
        `);
      }
    } catch (err) {
      console.warn('sync reservation event_id error:', err?.message || err);
    }
  }
  if (reservationHasStoreIdColumn) {
    try {
      const [[needSyncStore]] = await pool.query(
        'SELECT 1 AS v FROM reservations WHERE store_id IS NULL OR store_id = 0 LIMIT 1'
      );
      if (needSyncStore?.v) {
        await pool.query(`
          UPDATE reservations r
          JOIN event_stores s
            ON (r.store_id IS NULL OR r.store_id = 0)
            AND s.name = r.store
            AND (
              (r.event_id IS NOT NULL AND s.event_id = r.event_id)
              OR r.event_id IS NULL
            )
          SET
            r.store_id = s.id,
            r.event_id = COALESCE(r.event_id, s.event_id)
        `);
      }
    } catch (err) {
      console.warn('sync reservation store_id error:', err?.message || err);
    }
  }
  if (reservationHasOrderIdColumn) {
    await backfillReservationOrderIds();
  }
}
ensureReservationIdColumns().catch((err) => {
  console.error('ensureReservationIdColumns error:', err?.message || err);
});

async function detectUserProviderColumn() {
  try {
    const [cols] = await pool.query("SHOW COLUMNS FROM users LIKE 'provider_id'");
    usersHaveProviderIdColumn = Array.isArray(cols) && cols.length > 0;
  } catch (err) {
    console.warn('detect users.provider_id error:', err?.message || err);
    usersHaveProviderIdColumn = false;
  }
}

async function ensureUserProviderColumn() {
  await detectUserProviderColumn();
  if (usersHaveProviderIdColumn) return;
  try {
    await pool.query('ALTER TABLE users ADD COLUMN provider_id CHAR(36) NULL AFTER role');
  } catch (err) {
    if (err?.code !== 'ER_DUP_FIELDNAME') console.error('add users.provider_id error:', err?.message || err);
  }
  try {
    await pool.query('ALTER TABLE users ADD INDEX idx_users_provider (provider_id)');
  } catch (err) {
    if (err?.code !== 'ER_DUP_KEYNAME') console.warn('index idx_users_provider error:', err?.message || err);
  }
  await detectUserProviderColumn();
}
ensureUserProviderColumn().catch((err) => {
  console.error('ensureUserProviderColumn error:', err?.message || err);
});

async function detectUserVipColumn() {
  try {
    const [cols] = await pool.query("SHOW COLUMNS FROM users LIKE 'is_vip'");
    usersHaveVipColumn = Array.isArray(cols) && cols.length > 0;
  } catch (err) {
    console.warn('detect users.is_vip error:', err?.message || err);
    usersHaveVipColumn = false;
  }
}

async function ensureUserVipColumn() {
  await detectUserVipColumn();
  if (usersHaveVipColumn) return;
  try {
    await pool.query('ALTER TABLE users ADD COLUMN is_vip TINYINT(1) NOT NULL DEFAULT 0 AFTER role');
  } catch (err) {
    if (err?.code !== 'ER_DUP_FIELDNAME') console.error('add users.is_vip error:', err?.message || err);
  }
  await detectUserVipColumn();
}
ensureUserVipColumn().catch((err) => {
  console.error('ensureUserVipColumn error:', err?.message || err);
});

async function ensureProductManagementSchema(connOrPool = pool) {
  if (productManagementSchemaReady && connOrPool === pool) return true;
  const statements = [
    'ALTER TABLE products ADD COLUMN owner_user_id CHAR(36) NULL AFTER price',
    'ALTER TABLE products ADD INDEX idx_products_owner (owner_user_id)',
    'ALTER TABLE products ADD COLUMN cover_url VARCHAR(512) NULL AFTER description',
    'ALTER TABLE products ADD COLUMN cover_type VARCHAR(100) NULL AFTER cover_url',
    'ALTER TABLE products ADD COLUMN cover_data LONGBLOB NULL AFTER cover_type',
    'ALTER TABLE products ADD COLUMN cover_path VARCHAR(512) NULL AFTER cover_data',
    "ALTER TABLE products ADD COLUMN listing_status VARCHAR(16) NOT NULL DEFAULT 'published' AFTER owner_user_id",
    'ALTER TABLE products ADD INDEX idx_products_listing_status (listing_status)',
  ];
  for (const sql of statements) {
    try {
      await connOrPool.query(sql);
    } catch (err) {
      if (!['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME'].includes(err?.code)) {
        productManagementSchemaReady = false;
        throw err;
      }
    }
  }
  try {
    await connOrPool.query(
      "UPDATE products SET listing_status = 'published' WHERE listing_status IS NULL OR listing_status NOT IN ('draft', 'published')"
    );
  } catch (err) {
    if (err?.code !== 'ER_BAD_FIELD_ERROR') throw err;
  }
  if (connOrPool === pool) productManagementSchemaReady = true;
  return true;
}
ensureProductManagementSchema().catch((err) => {
  console.error('ensureProductManagementSchema error:', err?.message || err);
});

async function detectEventExclusiveColumn(connOrPool = pool) {
  try {
    const [rows] = await connOrPool.query("SHOW COLUMNS FROM events LIKE 'is_exclusive'");
    const hasColumn = Array.isArray(rows) && rows.length > 0;
    if (connOrPool === pool) eventsHaveExclusiveColumn = hasColumn;
    return hasColumn;
  } catch (err) {
    if (connOrPool === pool) eventsHaveExclusiveColumn = false;
    console.warn('detect events.is_exclusive error:', err?.message || err);
    return false;
  }
}

async function ensureEventExclusiveColumn(connOrPool = pool) {
  if (connOrPool === pool && eventsHaveExclusiveColumn) return true;
  if (await detectEventExclusiveColumn(connOrPool)) return true;
  try {
    await connOrPool.query('ALTER TABLE events ADD COLUMN is_exclusive TINYINT(1) NOT NULL DEFAULT 0 AFTER owner_user_id');
  } catch (err) {
    if (err?.code === 'ER_BAD_FIELD_ERROR') {
      try {
        await connOrPool.query('ALTER TABLE events ADD COLUMN is_exclusive TINYINT(1) NOT NULL DEFAULT 0');
      } catch (fallbackErr) {
        if (fallbackErr?.code !== 'ER_DUP_FIELDNAME') throw fallbackErr;
      }
    } else if (err?.code !== 'ER_DUP_FIELDNAME') {
      throw err;
    }
  }
  try {
    await connOrPool.query('ALTER TABLE events ADD INDEX idx_events_exclusive_owner (is_exclusive, owner_user_id)');
  } catch (err) {
    if (!['ER_DUP_KEYNAME', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(err?.code)) throw err;
  }
  return detectEventExclusiveColumn(connOrPool);
}

ensureEventExclusiveColumn().catch((err) => {
  console.error('ensureEventExclusiveColumn error:', err?.message || err);
});

async function detectEventListingStatusColumn(connOrPool = pool) {
  try {
    const [rows] = await connOrPool.query("SHOW COLUMNS FROM events LIKE 'listing_status'");
    const hasColumn = Array.isArray(rows) && rows.length > 0;
    if (connOrPool === pool) eventsHaveListingStatusColumn = hasColumn;
    return hasColumn;
  } catch (err) {
    if (connOrPool === pool) eventsHaveListingStatusColumn = false;
    console.warn('detect events.listing_status error:', err?.message || err);
    return false;
  }
}

async function ensureEventListingStatusColumn(connOrPool = pool) {
  if (connOrPool === pool && eventsHaveListingStatusColumn) return true;
  const hasColumn = await detectEventListingStatusColumn(connOrPool);
  if (!hasColumn) {
    try {
      await connOrPool.query("ALTER TABLE events ADD COLUMN listing_status VARCHAR(16) NOT NULL DEFAULT 'published' AFTER is_exclusive");
    } catch (err) {
      if (err?.code === 'ER_BAD_FIELD_ERROR') {
        try {
          await connOrPool.query("ALTER TABLE events ADD COLUMN listing_status VARCHAR(16) NOT NULL DEFAULT 'published' AFTER owner_user_id");
        } catch (fallbackErr) {
          if (fallbackErr?.code === 'ER_BAD_FIELD_ERROR') {
            await connOrPool.query("ALTER TABLE events ADD COLUMN listing_status VARCHAR(16) NOT NULL DEFAULT 'published'");
          } else if (fallbackErr?.code !== 'ER_DUP_FIELDNAME') {
            throw fallbackErr;
          }
        }
      } else if (err?.code !== 'ER_DUP_FIELDNAME') {
        throw err;
      }
    }
  }
  try {
    await connOrPool.query('ALTER TABLE events ADD INDEX idx_events_listing_status (listing_status)');
  } catch (err) {
    if (!['ER_DUP_KEYNAME', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(err?.code)) throw err;
  }
  try {
    await connOrPool.query(
      "UPDATE events SET listing_status = 'published' WHERE listing_status IS NULL OR listing_status NOT IN ('draft', 'published')"
    );
  } catch (err) {
    if (err?.code !== 'ER_BAD_FIELD_ERROR') throw err;
  }
  return detectEventListingStatusColumn(connOrPool);
}

ensureEventListingStatusColumn().catch((err) => {
  console.error('ensureEventListingStatusColumn error:', err?.message || err);
});

async function detectEventStoreDeliveryPointColumn() {
  try {
    const [cols] = await pool.query("SHOW COLUMNS FROM event_stores LIKE 'delivery_point_id'");
    eventStoresHaveDeliveryPointIdColumn = Array.isArray(cols) && cols.length > 0;
  } catch (err) {
    console.warn('detect event_stores.delivery_point_id error:', err?.message || err);
    eventStoresHaveDeliveryPointIdColumn = false;
  }
}

async function detectEventStorePhaseColumns() {
  try {
    const [activeCols] = await pool.query("SHOW COLUMNS FROM event_stores LIKE 'is_active'");
    const [preCols] = await pool.query("SHOW COLUMNS FROM event_stores LIKE 'pre_enabled'");
    const [postCols] = await pool.query("SHOW COLUMNS FROM event_stores LIKE 'post_enabled'");
    eventStoresHavePhaseColumns = Array.isArray(activeCols) && activeCols.length > 0
      && Array.isArray(preCols) && preCols.length > 0
      && Array.isArray(postCols) && postCols.length > 0;
  } catch (err) {
    console.warn('detect event_stores phase columns error:', err?.message || err);
    eventStoresHavePhaseColumns = false;
  }
}

async function detectEventStoreCapacityColumn() {
  try {
    const [cols] = await pool.query("SHOW COLUMNS FROM event_stores LIKE 'capacity'");
    eventStoresHaveCapacityColumn = Array.isArray(cols) && cols.length > 0;
  } catch (err) {
    console.warn('detect event_stores.capacity error:', err?.message || err);
    eventStoresHaveCapacityColumn = false;
  }
}

async function ensureDeliveryPointsTable() {
  if (deliveryPointsTableReady) return;
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS delivery_points (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        owner_user_id CHAR(36) NULL,
        name VARCHAR(255) NOT NULL,
        address VARCHAR(255) NULL,
        external_url VARCHAR(500) NULL,
        business_hours TEXT NULL,
        capacity INT UNSIGNED NULL,
        remittance_info TEXT NULL,
        remittance_bank_code VARCHAR(32) NULL,
        remittance_bank_account VARCHAR(64) NULL,
        remittance_account_name VARCHAR(64) NULL,
        remittance_bank_name VARCHAR(64) NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_delivery_points_owner (owner_user_id),
        KEY idx_delivery_points_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`
    );
    deliveryPointsTableReady = true;
  } catch (err) {
    deliveryPointsTableReady = false;
    console.warn('ensureDeliveryPointsTable error:', err?.message || err);
  }
}

async function ensureDeliveryPointCapacityColumn() {
  await ensureDeliveryPointsTable();
  try {
    await pool.query('ALTER TABLE delivery_points ADD COLUMN capacity INT UNSIGNED NULL AFTER business_hours');
  } catch (err) {
    if (!['ER_DUP_FIELDNAME', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(err?.code)) {
      console.warn('ensureDeliveryPointCapacityColumn error:', err?.message || err);
    }
  }
}

async function ensureDeliveryPointProviderBindingsTable() {
  if (deliveryPointProviderBindingsTableReady) return;
  await ensureDeliveryPointsTable();
  await ensureUserProviderColumn();
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS delivery_point_provider_bindings (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        delivery_point_id INT UNSIGNED NOT NULL,
        provider_user_id CHAR(36) NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
        requested_by_user_id CHAR(36) NOT NULL,
        responded_by_user_id CHAR(36) NULL,
        requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        responded_at DATETIME NULL,
        approved_at DATETIME NULL,
        rejected_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_delivery_point_provider_pair (delivery_point_id, provider_user_id),
        KEY idx_delivery_point_provider_status (delivery_point_id, status),
        KEY idx_provider_delivery_point_status (provider_user_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`
    );
    try {
      await pool.query(
        `INSERT INTO delivery_point_provider_bindings (
           delivery_point_id, provider_user_id, status, requested_by_user_id, responded_by_user_id,
           requested_at, responded_at, approved_at, rejected_at
         )
         SELECT dp.id, u.provider_id, 'APPROVED', dp.owner_user_id, dp.owner_user_id,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
           FROM delivery_points dp
           JOIN users u ON u.id = dp.owner_user_id
         WHERE UPPER(COALESCE(u.role, '')) = 'DELIVERY_POINT'
            AND u.provider_id IS NOT NULL
            AND u.provider_id <> ''
         ON DUPLICATE KEY UPDATE
           status = 'APPROVED',
           responded_by_user_id = COALESCE(responded_by_user_id, VALUES(responded_by_user_id)),
           responded_at = COALESCE(responded_at, VALUES(responded_at)),
           approved_at = COALESCE(approved_at, VALUES(approved_at)),
           rejected_at = NULL`
      );
    } catch (err) {
      if (!['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(err?.code)) {
        console.warn('backfill delivery_point_provider_bindings error:', err?.message || err);
      }
    }
    deliveryPointProviderBindingsTableReady = true;
  } catch (err) {
    deliveryPointProviderBindingsTableReady = false;
    console.warn('ensureDeliveryPointProviderBindingsTable error:', err?.message || err);
  }
}

async function hasApprovedDeliveryPointProviderBinding(deliveryPointId, providerUserId) {
  const normalizedDeliveryPointId = normalizePositiveInt(deliveryPointId);
  const normalizedProviderUserId = normalizeUserId(providerUserId);
  if (!normalizedDeliveryPointId || !normalizedProviderUserId) {
    console.log('[binding-debug] has-approved-binding:invalid-input', JSON.stringify({ deliveryPointId, providerUserId, normalizedDeliveryPointId, normalizedProviderUserId }));
    return false;
  }
  await ensureDeliveryPointProviderBindingsTable();
  const [rows] = await pool.query(
    `SELECT id, status, provider_user_id, delivery_point_id
       FROM delivery_point_provider_bindings
      WHERE delivery_point_id = ?
        AND TRIM(provider_user_id) = ?
        AND TRIM(UPPER(COALESCE(status, ''))) = 'APPROVED'
      LIMIT 1`,
    [normalizedDeliveryPointId, normalizedProviderUserId]
  );
  const approved = Array.isArray(rows) && rows.length > 0;
  console.log('[binding-debug] has-approved-binding:result', JSON.stringify({
    deliveryPointId: normalizedDeliveryPointId,
    providerUserId: normalizedProviderUserId,
    approved,
    rows: (Array.isArray(rows) ? rows : []).map((row) => ({
      id: row.id,
      delivery_point_id: row.delivery_point_id,
      provider_user_id: row.provider_user_id,
      status: row.status,
    })),
  }));
  return approved;
}

async function ensureEventStoreDeliveryPointColumn() {
  await detectEventStoreDeliveryPointColumn();
  if (eventStoresHaveDeliveryPointIdColumn) return;
  const alters = [
    'ALTER TABLE event_stores ADD COLUMN delivery_point_id INT UNSIGNED NULL AFTER owner_user_id',
    'ALTER TABLE event_stores ADD INDEX idx_event_stores_delivery_point (delivery_point_id)',
  ];
  for (const sql of alters) {
    try {
      await pool.query(sql);
    } catch (err) {
      if (!['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(err?.code)) {
        console.warn('ensureEventStoreDeliveryPointColumn error:', err?.message || err);
      }
    }
  }
  await detectEventStoreDeliveryPointColumn();
}

async function ensureEventStoreCapacityColumn() {
  await detectEventStoreCapacityColumn();
  if (eventStoresHaveCapacityColumn) return;
  try {
    await pool.query('ALTER TABLE event_stores ADD COLUMN capacity INT UNSIGNED NULL AFTER business_hours');
  } catch (err) {
    if (!['ER_DUP_FIELDNAME', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(err?.code)) {
      console.warn('ensureEventStoreCapacityColumn error:', err?.message || err);
    }
  }
  await detectEventStoreCapacityColumn();
}

async function ensureEventStorePhaseColumns() {
  await detectEventStorePhaseColumns();
  if (eventStoresHavePhaseColumns) return;
  const alters = [
    'ALTER TABLE event_stores ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER remittance_bank_name',
    'ALTER TABLE event_stores ADD COLUMN pre_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER remittance_bank_name',
    'ALTER TABLE event_stores ADD COLUMN post_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER pre_end',
  ];
  for (const sql of alters) {
    try {
      await pool.query(sql);
    } catch (err) {
      if (!['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(err?.code)) {
        console.warn('ensureEventStorePhaseColumns error:', err?.message || err);
      }
    }
  }
  try {
    await pool.query(
      `UPDATE event_stores
          SET pre_enabled = CASE
                WHEN pre_enabled IS NULL THEN IF(pre_start IS NOT NULL OR pre_end IS NOT NULL, 1, 1)
                ELSE pre_enabled
              END,
              post_enabled = CASE
                WHEN post_enabled IS NULL THEN IF(post_start IS NOT NULL OR post_end IS NOT NULL, 1, 1)
                ELSE post_enabled
              END,
              is_active = COALESCE(is_active, 1)`
    );
  } catch (err) {
    if (err?.code !== 'ER_NO_SUCH_TABLE') {
      console.warn('backfill event_stores phase flags error:', err?.message || err);
    }
  }
  await detectEventStorePhaseColumns();
}

async function ensureReservationDeliveryPointColumn() {
  await detectReservationIdColumns();
  if (reservationHasDeliveryPointIdColumn) return;
  try {
    await pool.query('ALTER TABLE reservations ADD COLUMN delivery_point_id INT UNSIGNED NULL AFTER order_id');
  } catch (err) {
    if (err?.code !== 'ER_DUP_FIELDNAME') console.warn('add reservations.delivery_point_id error:', err?.message || err);
  }
  try {
    await pool.query('ALTER TABLE reservations ADD INDEX idx_reservations_delivery_point (delivery_point_id)');
  } catch (err) {
    if (err?.code !== 'ER_DUP_KEYNAME') console.warn('index idx_reservations_delivery_point error:', err?.message || err);
  }
  await detectReservationIdColumns();
}

async function ensureEventServicePricesTable() {
  if (eventServicePricesTableReady) return;
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS event_service_prices (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        event_id INT UNSIGNED NOT NULL,
        type VARCHAR(255) NOT NULL,
        product_id INT UNSIGNED NULL,
        normal_price DECIMAL(10,2) NOT NULL DEFAULT 0,
        early_price DECIMAL(10,2) NOT NULL DEFAULT 0,
        early_start DATETIME NULL,
        early_end DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_event_service_prices_event_type (event_id, type),
        KEY idx_event_service_prices_product (product_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`
    );
    const alters = [
      'ALTER TABLE event_service_prices ADD COLUMN early_start DATETIME NULL AFTER early_price',
      'ALTER TABLE event_service_prices ADD COLUMN early_end DATETIME NULL AFTER early_start',
    ];
    for (const sql of alters) {
      try {
        await pool.query(sql);
      } catch (err) {
        if (!['ER_DUP_FIELDNAME', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(err?.code)) {
          console.warn('ensureEventServicePricesTable alter error:', err?.message || err);
        }
      }
    }
    eventServicePricesTableReady = true;
  } catch (err) {
    eventServicePricesTableReady = false;
    console.warn('ensureEventServicePricesTable error:', err?.message || err);
  }
}

async function ensureEventDriverAssignmentsTable() {
  if (eventDriverAssignmentsTableReady) return;
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS event_driver_assignments (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        event_id INT UNSIGNED NOT NULL,
        provider_user_id CHAR(36) NOT NULL,
        driver_id CHAR(36) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_event_driver_provider (event_id, provider_user_id),
        KEY idx_event_driver_assignments_provider (provider_user_id),
        KEY idx_event_driver_assignments_driver (driver_id),
        CONSTRAINT fk_event_driver_assignments_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`
    );
    eventDriverAssignmentsTableReady = true;
  } catch (err) {
    eventDriverAssignmentsTableReady = false;
    console.warn('ensureEventDriverAssignmentsTable error:', err?.message || err);
  }
}

async function ensureReservationTasksTable() {
  if (reservationTasksTableReady) return;
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS reservation_tasks (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        reservation_id BIGINT UNSIGNED NOT NULL,
        order_id BIGINT UNSIGNED NULL,
        assignee_user_id CHAR(36) NOT NULL,
        assignee_role VARCHAR(32) NOT NULL,
        task_stage VARCHAR(32) NOT NULL DEFAULT 'general',
        store_id INT UNSIGNED NULL,
        delivery_point_id INT UNSIGNED NULL,
        driver_id CHAR(36) NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'OPEN',
        completed_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_reservation_tasks_assignee (reservation_id, assignee_user_id, assignee_role, task_stage),
        KEY idx_reservation_tasks_assignee (assignee_user_id, assignee_role, task_stage, status),
        KEY idx_reservation_tasks_reservation (reservation_id),
        KEY idx_reservation_tasks_order (order_id),
        KEY idx_reservation_tasks_store (store_id),
        KEY idx_reservation_tasks_delivery_point (delivery_point_id),
        KEY idx_reservation_tasks_driver (driver_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`
    );
    const alters = [
      'ALTER TABLE reservation_tasks ADD COLUMN task_stage VARCHAR(32) NOT NULL DEFAULT "general" AFTER assignee_role',
      'ALTER TABLE reservation_tasks ADD COLUMN store_id INT UNSIGNED NULL AFTER task_stage',
    ];
    for (const sql of alters) {
      try {
        await pool.query(sql);
      } catch (err) {
        if (err?.code !== 'ER_DUP_FIELDNAME') {
          console.warn('ensureReservationTasksTable alter error:', err?.message || err);
        }
      }
    }
    try {
      await pool.query(
        `UPDATE reservation_tasks
            SET task_stage = CASE
                  WHEN assignee_role = 'DRIVER' THEN 'driver'
                  WHEN task_stage IS NULL OR task_stage = '' THEN 'general'
                  ELSE task_stage
                END`
      );
    } catch (err) {
      console.warn('backfill reservation_tasks.task_stage error:', err?.message || err);
    }
    try {
      await pool.query('ALTER TABLE reservation_tasks DROP INDEX uq_reservation_tasks_assignee');
    } catch (err) {
      if (!['ER_CANT_DROP_FIELD_OR_KEY', 'ER_DROP_INDEX_FK'].includes(err?.code)) {
        console.warn('drop reservation_tasks unique index error:', err?.message || err);
      }
    }
    const indexes = [
      'ALTER TABLE reservation_tasks ADD UNIQUE KEY uq_reservation_tasks_assignee (reservation_id, assignee_user_id, assignee_role, task_stage)',
      'ALTER TABLE reservation_tasks ADD KEY idx_reservation_tasks_store (store_id)',
    ];
    for (const sql of indexes) {
      try {
        await pool.query(sql);
      } catch (err) {
        if (err?.code !== 'ER_DUP_KEYNAME') {
          console.warn('ensureReservationTasksTable index error:', err?.message || err);
        }
      }
    }
    reservationTasksTableReady = true;
  } catch (err) {
    reservationTasksTableReady = false;
    console.warn('ensureReservationTasksTable error:', err?.message || err);
  }
}

async function ensureReservationAssignmentsTable() {
  if (reservationAssignmentsTableReady) return;
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS reservation_assignments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        reservation_id BIGINT UNSIGNED NOT NULL,
        driver_id CHAR(36) NULL,
        assigned_by CHAR(36) NULL,
        action VARCHAR(32) NOT NULL DEFAULT 'assign',
        note VARCHAR(255) NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_res_assign_reservation (reservation_id),
        INDEX idx_res_assign_driver (driver_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`
    );
    reservationAssignmentsTableReady = true;
  } catch (err) {
    reservationAssignmentsTableReady = false;
    console.warn('ensureReservationAssignmentsTable error:', err?.message || err);
  }
}
ensureReservationAssignmentsTable().catch((err) => {
  console.error('ensureReservationAssignmentsTable error:', err?.message || err);
});
ensureEventDriverAssignmentsTable().catch((err) => {
  console.error('ensureEventDriverAssignmentsTable error:', err?.message || err);
});

async function listReservationAssignments(reservationId, { limit = 50 } = {}) {
  await ensureReservationAssignmentsTable();
  const normalized = normalizePositiveInt(reservationId);
  if (!normalized) return [];
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const [rows] = await pool.query(
    `SELECT ra.id, ra.reservation_id, ra.driver_id, ra.assigned_by, ra.action, ra.note, ra.created_at,
            d.username AS driver_username, d.email AS driver_email,
            a.username AS assigned_by_username, a.email AS assigned_by_email
     FROM reservation_assignments ra
     LEFT JOIN users d ON d.id = ra.driver_id
     LEFT JOIN users a ON a.id = ra.assigned_by
     WHERE ra.reservation_id = ?
     ORDER BY ra.id DESC
     LIMIT ?`,
    [normalized, safeLimit]
  );
  return rows.map((row) => ({
    id: row.id,
    reservation_id: row.reservation_id,
    driver_id: row.driver_id || null,
    assigned_by: row.assigned_by || null,
    action: row.action || 'assign',
    note: row.note || null,
    created_at: row.created_at || null,
    driver_username: row.driver_username || '',
    driver_email: row.driver_email || '',
    assigned_by_username: row.assigned_by_username || '',
    assigned_by_email: row.assigned_by_email || '',
  }));
}

function mapDeliveryPointRow(row = {}) {
  return {
    id: Number(row.id || 0) || null,
    owner_user_id: normalizeUserId(row.owner_user_id),
    owner_username: row.owner_username || '',
    owner_email: row.owner_email || '',
    name: String(row.name || '').trim(),
    address: normalizeNullableText(row.address),
    external_url: normalizeNullableText(row.external_url),
    business_hours: normalizeNullableText(row.business_hours),
    capacity: normalizeDeliveryPointCapacity(row.capacity),
    remittance: remittanceDetailsFromColumns(row),
    is_active: row.is_active == null ? true : Number(row.is_active) !== 0,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function normalizeDeliveryPointCapacity(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : null;
}

function reservationOrderEventId(details = {}) {
  return normalizePositiveInt(details?.event?.id ?? details?.event_id ?? details?.eventId);
}

function reservationOrderDeliveryPointId(details = {}) {
  const source = details?.serviceSelection && typeof details.serviceSelection === 'object'
    ? details.serviceSelection
    : details;
  const direct = normalizePositiveInt(
    source?.deliveryPointId
      ?? source?.delivery_point_id
      ?? details?.deliveryPointId
      ?? details?.delivery_point_id
  );
  if (direct) return direct;
  const selections = Array.isArray(details?.selections) ? details.selections : [];
  const ids = Array.from(new Set(selections
    .map((selection) => normalizePositiveInt(selection?.deliveryPointId ?? selection?.delivery_point_id))
    .filter((value) => Number.isFinite(value) && value > 0)));
  return ids.length === 1 ? ids[0] : null;
}

function reservationOrderStoreId(details = {}) {
  const source = details?.serviceSelection && typeof details.serviceSelection === 'object'
    ? details.serviceSelection
    : details;
  const direct = normalizePositiveInt(
    source?.storeId
      ?? source?.store_id
      ?? details?.storeId
      ?? details?.store_id
  );
  if (direct) return direct;
  const selections = Array.isArray(details?.selections) ? details.selections : [];
  const ids = Array.from(new Set(selections
    .map((selection) => normalizePositiveInt(selection?.storeId ?? selection?.store_id ?? selection?.storeID))
    .filter((value) => Number.isFinite(value) && value > 0)));
  return ids.length === 1 ? ids[0] : null;
}

function reservationOrderQuantity(details = {}) {
  const direct = Number(details?.quantity);
  if (Number.isFinite(direct) && direct > 0) return Math.floor(direct);
  const selections = Array.isArray(details?.selections) ? details.selections : [];
  return selections.reduce((sum, sel) => {
    const qty = Number(sel?.qty ?? sel?.quantity ?? 0);
    return sum + (Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 0);
  }, 0);
}

function isActiveReservationOrderDetails(details = {}) {
  const selections = Array.isArray(details?.selections) ? details.selections : [];
  const kind = String(details?.kind || '').trim();
  const status = String(details?.status || '').trim();
  return (kind === 'event-reservation' || selections.length > 0) && status !== '已取消';
}

async function getReservationCapacityUsageForEvent(eventId, { connOrPool = pool, excludeOrderId = null } = {}) {
  const normalizedEventId = normalizePositiveInt(eventId);
  const usage = new Map();
  const storeUsage = new Map();
  if (!normalizedEventId) return usage;
  const params = [];
  let sql = 'SELECT id, details FROM orders WHERE (details LIKE ? OR details LIKE ?)';
  params.push('%event-reservation%', '%selections%');
  const normalizedExcludeOrderId = normalizePositiveInt(excludeOrderId);
  if (normalizedExcludeOrderId) {
    sql += ' AND id <> ?';
    params.push(normalizedExcludeOrderId);
  }
  try {
    const [rows] = await connOrPool.query(sql, params);
    for (const row of Array.isArray(rows) ? rows : []) {
      const details = safeParseJSON(row.details, {});
      if (!isActiveReservationOrderDetails(details)) continue;
      if (reservationOrderEventId(details) !== normalizedEventId) continue;
      const deliveryPointId = reservationOrderDeliveryPointId(details);
      const quantity = reservationOrderQuantity(details);
      if (!quantity) continue;
      if (deliveryPointId) {
        usage.set(deliveryPointId, (usage.get(deliveryPointId) || 0) + quantity);
        continue;
      }
      const storeId = reservationOrderStoreId(details);
      if (storeId) storeUsage.set(storeId, (storeUsage.get(storeId) || 0) + quantity);
    }
  } catch (err) {
    if (!['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(err?.code)) throw err;
  }
  if (storeUsage.size) {
    await ensureEventStoreDeliveryPointColumn();
    const storeIds = Array.from(storeUsage.keys());
    const placeholders = storeIds.map(() => '?').join(',');
    try {
      const [rows] = await connOrPool.query(
        `SELECT id, delivery_point_id FROM event_stores WHERE id IN (${placeholders})`,
        storeIds
      );
      for (const row of Array.isArray(rows) ? rows : []) {
        const deliveryPointId = normalizePositiveInt(row.delivery_point_id);
        const storeId = normalizePositiveInt(row.id);
        if (!deliveryPointId || !storeId) continue;
        usage.set(deliveryPointId, (usage.get(deliveryPointId) || 0) + (storeUsage.get(storeId) || 0));
      }
    } catch (err) {
      if (!['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(err?.code)) throw err;
    }
  }
  return usage;
}

async function assertReservationCapacityAvailable(connOrPool, details = {}, { excludeOrderId = null, lock = false } = {}) {
  const eventId = reservationOrderEventId(details);
  const storeId = reservationOrderStoreId(details);
  let deliveryPointId = reservationOrderDeliveryPointId(details);
  const requested = reservationOrderQuantity(details);
  if (!eventId || (!storeId && !deliveryPointId) || requested <= 0) return null;
  await ensureDeliveryPointSchema();
  let capacity = null;
  if (storeId) {
    try {
      const [storeRows] = await connOrPool.query(
        `SELECT id, delivery_point_id, capacity
           FROM event_stores
          WHERE id = ? AND event_id = ?
          LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
        [storeId, eventId]
      );
      const storeRow = storeRows?.[0] || null;
      if (storeRow) {
        deliveryPointId = normalizePositiveInt(storeRow.delivery_point_id) || deliveryPointId;
        capacity = normalizeDeliveryPointCapacity(storeRow.capacity);
      }
    } catch (err) {
      if (!['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(err?.code)) throw err;
    }
  }
  if (!storeId && deliveryPointId) {
    const [rows] = await connOrPool.query(
      `SELECT id, capacity FROM delivery_points WHERE id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [deliveryPointId]
    );
    capacity = normalizeDeliveryPointCapacity(rows?.[0]?.capacity);
  }
  if (!deliveryPointId) return null;
  if (!capacity) return null;
  const usage = await getReservationCapacityUsageForEvent(eventId, { connOrPool, excludeOrderId });
  const occupied = usage.get(deliveryPointId) || 0;
  const remaining = Math.max(0, capacity - occupied);
  if (requested > remaining) {
    const err = new Error(`此交車點收容數量剩餘 ${remaining} 輛，無法建立 ${requested} 輛托運訂單`);
    err.code = 'DELIVERY_POINT_CAPACITY_EXCEEDED';
    err.statusCode = 409;
    err.capacity = capacity;
    err.occupied = occupied;
    err.remaining = remaining;
    err.requested = requested;
    throw err;
  }
  return { capacity, occupied, remaining, requested };
}

function buildDeliveryPointIdentityKey(source = {}) {
  const remittance = remittanceDetailsFromColumns(source);
  return [
    String(source.name || '').trim().toLowerCase(),
    String(source.address || '').trim().toLowerCase(),
    String(source.external_url || '').trim().toLowerCase(),
    String(source.business_hours || '').trim().toLowerCase(),
    String(remittance.info || '').trim().toLowerCase(),
    String(remittance.bankCode || '').trim().toLowerCase(),
    String(remittance.bankAccount || '').trim().toLowerCase(),
    String(remittance.accountName || '').trim().toLowerCase(),
    String(remittance.bankName || '').trim().toLowerCase(),
  ].join('||');
}

async function getDeliveryPointByUserId(userId) {
  const ownerUserId = normalizeUserId(userId);
  if (!ownerUserId) return null;
  await ensureDeliveryPointSchema();
  const [rows] = await pool.query(
    `SELECT dp.*, u.username AS owner_username, u.email AS owner_email
       FROM delivery_points dp
       LEFT JOIN users u ON u.id = dp.owner_user_id
      WHERE dp.owner_user_id = ?
      LIMIT 1`,
    [ownerUserId]
  );
  if (!rows.length) return null;
  return mapDeliveryPointRow(rows[0]);
}

async function getDeliveryPointIdByUserId(userId) {
  const row = await getDeliveryPointByUserId(userId);
  return row?.id || null;
}

async function ensureDeliveryPointProfile(userOrId, source = {}) {
  const ownerUserId = normalizeUserId(typeof userOrId === 'object' ? userOrId?.id : userOrId);
  if (!ownerUserId) return null;
  await ensureDeliveryPointSchema();

  const existing = await getDeliveryPointByUserId(ownerUserId);
  if (existing) return existing;

  const fallbackName = String(
    source?.name ||
    source?.username ||
    (typeof userOrId === 'object' ? userOrId?.username : '') ||
    source?.email ||
    (typeof userOrId === 'object' ? userOrId?.email : '') ||
    `交車點 ${ownerUserId}`
  ).trim();
  if (fallbackName) {
    const [claimableRows] = await pool.query(
      'SELECT id FROM delivery_points WHERE owner_user_id IS NULL AND LOWER(name) = LOWER(?) ORDER BY id ASC LIMIT 2',
      [fallbackName]
    );
    const claimableId = Array.isArray(claimableRows) && claimableRows.length === 1
      ? normalizePositiveInt(claimableRows[0]?.id)
      : null;
    if (claimableId) {
      await pool.query('UPDATE delivery_points SET owner_user_id = ?, is_active = 1 WHERE id = ?', [ownerUserId, claimableId]);
      await syncReservationTasksForDeliveryPointIds(pool, [claimableId]);
      return getDeliveryPointByUserId(ownerUserId);
    }
  }
  const remittance = normalizeRemittanceDetails(source?.remittance || source || {});
  const [result] = await pool.query(
    `INSERT INTO delivery_points (
      owner_user_id, name, address, external_url, business_hours,
      remittance_info, remittance_bank_code, remittance_bank_account,
      remittance_account_name, remittance_bank_name, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      ownerUserId,
      fallbackName || `交車點 ${ownerUserId}`,
      normalizeNullableText(source?.address),
      normalizeNullableText(source?.external_url ?? source?.externalUrl),
      normalizeNullableText(source?.business_hours ?? source?.businessHours),
      remittance.info || null,
      remittance.bankCode || null,
      remittance.bankAccount || null,
      remittance.accountName || null,
      remittance.bankName || null,
    ]
  );
  await syncReservationTasksForDeliveryPointIds(pool, [Number(result.insertId)]);
  return getDeliveryPointByUserId(ownerUserId);
}

async function listDeliveryPoints({ activeOnly = false } = {}) {
  await ensureDeliveryPointSchema();
  const where = [];
  const params = [];
  if (activeOnly) {
    where.push('dp.is_active = 1');
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT dp.*, u.username AS owner_username, u.email AS owner_email
       FROM delivery_points dp
       LEFT JOIN users u ON u.id = dp.owner_user_id
       ${whereSql}
      ORDER BY dp.name ASC, dp.id ASC`,
    params
  );
  return rows.map(mapDeliveryPointRow);
}

async function listStoreDeliveryPointRows(connOrPool, storeIds = []) {
  const ids = Array.from(new Set((Array.isArray(storeIds) ? storeIds : [storeIds])
    .map((value) => normalizePositiveInt(value))
    .filter((value) => Number.isFinite(value) && value > 0)));
  if (!ids.length) return [];
  await ensureDeliveryPointSchema();
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await connOrPool.query(
    `SELECT id, delivery_point_id
       FROM event_stores
      WHERE id IN (${placeholders})`,
    ids
  );
  return Array.isArray(rows) ? rows : [];
}

function normalizeEventServicePriceMap(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const result = {};
  Object.keys(source).forEach((type) => {
    const key = String(type || '').trim();
    if (!key) return;
    const raw = source[type] && typeof source[type] === 'object' ? source[type] : {};
    const entry = {
      productId: normalizePositiveInt(raw.productId ?? raw.product_id ?? raw.product),
    };
    const normal = normalizeOptionalPriceAmount(raw.normal ?? raw.normal_price ?? raw.price);
    const early = normalizeOptionalPriceAmount(raw.early ?? raw.early_price);
    if (normal !== null) entry.normal = normal;
    if (early !== null) entry.early = early;
    const earlyStart = normalizeDateTimeInput(raw.early_start ?? raw.earlyStart);
    const earlyEnd = normalizeDateTimeInput(raw.early_end ?? raw.earlyEnd);
    if (earlyStart) entry.early_start = earlyStart;
    if (earlyEnd) entry.early_end = earlyEnd;
    if (entry.normal !== undefined || entry.early !== undefined) result[key] = entry;
  });
  return result;
}

function normalizeOptionalPriceAmount(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function buildEventServicePriceRows(priceMap = {}) {
  const normalized = normalizeEventServicePriceMap(priceMap);
  return Object.entries(normalized).map(([type, info]) => ({
    type,
    productId: normalizePositiveInt(info.productId),
    normal: Math.max(0, Number(info.normal ?? 0) || 0),
    early: Math.max(0, Number(info.early ?? 0) || 0),
    early_start: normalizeDateTimeInput(info.early_start ?? info.earlyStart),
    early_end: normalizeDateTimeInput(info.early_end ?? info.earlyEnd),
  }));
}

async function backfillEventServicePrices() {
  if (eventServicePriceBackfillDone) return;
  eventServicePriceBackfillDone = true;
  try {
    await ensureEventServicePricesTable();
    const [events] = await pool.query('SELECT id FROM events ORDER BY id ASC');
    for (const eventRow of (Array.isArray(events) ? events : [])) {
      const eventId = normalizePositiveInt(eventRow.id);
      if (!eventId) continue;
      const [[countRow]] = await pool.query('SELECT COUNT(*) AS total FROM event_service_prices WHERE event_id = ?', [eventId]);
      if (Number(countRow?.total || 0) > 0) continue;
      const [storeRows] = await pool.query(
        'SELECT prices FROM event_stores WHERE event_id = ? AND prices IS NOT NULL ORDER BY id ASC LIMIT 1',
        [eventId]
      );
      const legacyMap = normalizeEventServicePriceMap(safeParseJSON(storeRows?.[0]?.prices, {}));
      const rows = buildEventServicePriceRows(legacyMap);
      if (!rows.length) continue;
      const values = rows.map((row) => [eventId, row.type, row.productId, row.normal, row.early, row.early_start || null, row.early_end || null]);
      await pool.query(
        'INSERT INTO event_service_prices (event_id, type, product_id, normal_price, early_price, early_start, early_end) VALUES ?',
        [values]
      );
    }
  } catch (err) {
    eventServicePriceBackfillDone = false;
    console.warn('backfill event service prices error:', err?.message || err);
  }
}

async function listEventServicePrices(eventId, { useCache = true } = {}) {
  const normalized = normalizePositiveInt(eventId);
  if (!normalized) return {};
  const key = String(normalized);
  if (useCache) {
    const cached = cacheUtils.get(eventServicePricesCache, key);
    if (cached) return cached;
  }
  await ensureEventServicePricesTable();
  await backfillEventServicePrices();
  const [rows] = await pool.query(
    `SELECT type, product_id, normal_price, early_price, early_start, early_end
       FROM event_service_prices
      WHERE event_id = ?
      ORDER BY id ASC`,
    [normalized]
  );
  const result = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const type = String(row.type || '').trim();
    if (!type) return;
    result[type] = {
      normal: Math.max(0, Number(row.normal_price || 0)),
      early: Math.max(0, Number(row.early_price || 0)),
      productId: normalizePositiveInt(row.product_id),
      early_start: normalizeDateTimeInput(row.early_start),
      early_end: normalizeDateTimeInput(row.early_end),
    };
  });
  cacheUtils.set(eventServicePricesCache, key, result);
  return result;
}

async function syncEventServicePrices(connOrPool, eventId, priceMap = {}) {
  const normalizedEventId = normalizePositiveInt(eventId);
  if (!normalizedEventId) return {};
  await ensureEventServicePricesTable();
  const rows = buildEventServicePriceRows(priceMap);
  await connOrPool.query('DELETE FROM event_service_prices WHERE event_id = ?', [normalizedEventId]);
  if (rows.length) {
    const values = rows.map((row) => [normalizedEventId, row.type, row.productId, row.normal, row.early, row.early_start || null, row.early_end || null]);
    await connOrPool.query(
      'INSERT INTO event_service_prices (event_id, type, product_id, normal_price, early_price, early_start, early_end) VALUES ?',
      [values]
    );
  }
  cacheUtils.delete(eventServicePricesCache, String(normalizedEventId));
  return listEventServicePrices(normalizedEventId, { useCache: false });
}

const RESERVATION_STAGE_ORDER = {
  service_booking: 0,
  pre_dropoff: 1,
  pre_pickup: 2,
  post_dropoff: 3,
  post_pickup: 4,
  done: 5,
};

function reservationTaskStatusForStage(status, taskStage) {
  const normalizedStatus = String(status || 'service_booking').toLowerCase();
  const currentOrder = RESERVATION_STAGE_ORDER[normalizedStatus] ?? 0;
  const normalizedTaskStage = String(taskStage || 'general').toLowerCase();
  if (normalizedTaskStage === 'driver' || normalizedTaskStage === 'general') {
    return normalizedStatus === 'done' ? 'DONE' : 'OPEN';
  }
  if (normalizedTaskStage === 'pre_dropoff') {
    return currentOrder >= RESERVATION_STAGE_ORDER.pre_pickup ? 'DONE' : 'OPEN';
  }
  if (normalizedTaskStage === 'post_dropoff') {
    return currentOrder >= RESERVATION_STAGE_ORDER.post_pickup ? 'DONE' : 'OPEN';
  }
  return normalizedStatus === 'done' ? 'DONE' : 'OPEN';
}

async function syncReservationTasksForIds(connOrPool, reservationIds = []) {
  const ids = Array.from(new Set((Array.isArray(reservationIds) ? reservationIds : [reservationIds])
    .map((value) => normalizePositiveInt(value))
    .filter((value) => Number.isFinite(value) && value > 0)));
  if (!ids.length) return;
  await ensureDeliveryPointsTable();
  await ensureReservationDeliveryPointColumn();
  await ensureReservationTasksTable();

  const placeholders = ids.map(() => '?').join(',');
  const [reservationRows] = await connOrPool.query(
    `SELECT id, order_id, driver_id, delivery_point_id, store_id, status
       FROM reservations
      WHERE id IN (${placeholders})`,
    ids
  );
  const reservations = Array.isArray(reservationRows) ? reservationRows : [];
  if (!reservations.length) return;

  const deliveryPointIds = Array.from(new Set(
    reservations
      .map((row) => normalizePositiveInt(row.delivery_point_id))
      .filter((value) => Number.isFinite(value) && value > 0)
  ));

  const deliveryPointOwnerMap = new Map();
  if (deliveryPointIds.length) {
    const dpPlaceholders = deliveryPointIds.map(() => '?').join(',');
    const [rows] = await connOrPool.query(
      `SELECT id, owner_user_id FROM delivery_points WHERE id IN (${dpPlaceholders})`,
      deliveryPointIds
    );
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const id = normalizePositiveInt(row.id);
      const ownerUserId = normalizeUserId(row.owner_user_id);
      if (id) deliveryPointOwnerMap.set(id, ownerUserId || null);
    });
  }

  const [taskRows] = await connOrPool.query(
    `SELECT id, reservation_id, assignee_user_id, assignee_role, task_stage, status
       FROM reservation_tasks
      WHERE reservation_id IN (${placeholders})`,
    ids
  );
  const existingMap = new Map();
  (Array.isArray(taskRows) ? taskRows : []).forEach((row) => {
    const reservationId = normalizePositiveInt(row.reservation_id);
    if (!reservationId) return;
    if (!existingMap.has(reservationId)) existingMap.set(reservationId, []);
    existingMap.get(reservationId).push(row);
  });

  for (const reservation of reservations) {
    const reservationId = normalizePositiveInt(reservation.id);
    if (!reservationId) continue;
    const orderId = normalizePositiveInt(reservation.order_id);
    const driverId = normalizeUserId(reservation.driver_id);
    const deliveryPointId = normalizePositiveInt(reservation.delivery_point_id);
    const storeId = normalizePositiveInt(reservation.store_id);
    const desiredAssignments = [];

    const deliveryPointOwnerId = deliveryPointId ? deliveryPointOwnerMap.get(deliveryPointId) || null : null;
    if (deliveryPointOwnerId) {
      desiredAssignments.push({
        assignee_user_id: deliveryPointOwnerId,
        assignee_role: 'DELIVERY_POINT',
        task_stage: 'pre_dropoff',
        store_id: storeId,
        delivery_point_id: deliveryPointId,
        driver_id: null,
      });
      desiredAssignments.push({
        assignee_user_id: deliveryPointOwnerId,
        assignee_role: 'DELIVERY_POINT',
        task_stage: 'post_dropoff',
        store_id: storeId,
        delivery_point_id: deliveryPointId,
        driver_id: null,
      });
    }
    if (driverId) {
      desiredAssignments.push({
        assignee_user_id: driverId,
        assignee_role: 'DRIVER',
        task_stage: 'driver',
        store_id: null,
        delivery_point_id: deliveryPointId || null,
        driver_id: driverId,
      });
    }

    const desiredKeys = new Set();
    for (const assignment of desiredAssignments) {
      const taskStatus = reservationTaskStatusForStage(reservation.status, assignment.task_stage);
      const completedAt = taskStatus === 'DONE' ? new Date() : null;
      const key = `${assignment.assignee_role}:${assignment.assignee_user_id}:${assignment.task_stage}`;
      desiredKeys.add(key);
      await connOrPool.query(
        `INSERT INTO reservation_tasks (
          reservation_id, order_id, assignee_user_id, assignee_role,
          task_stage, store_id, delivery_point_id, driver_id, status, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          order_id = VALUES(order_id),
          task_stage = VALUES(task_stage),
          store_id = VALUES(store_id),
          delivery_point_id = VALUES(delivery_point_id),
          driver_id = VALUES(driver_id),
          status = VALUES(status),
          completed_at = VALUES(completed_at),
          updated_at = CURRENT_TIMESTAMP`,
        [
          reservationId,
          orderId || null,
          assignment.assignee_user_id,
          assignment.assignee_role,
          assignment.task_stage,
          assignment.store_id || null,
          assignment.delivery_point_id || null,
          assignment.driver_id || null,
          taskStatus,
          completedAt,
        ]
      );
    }

    const currentTasks = existingMap.get(reservationId) || [];
    for (const task of currentTasks) {
      const assigneeRole = String(task.assignee_role || '').toUpperCase();
      const assigneeUserId = normalizeUserId(task.assignee_user_id);
      const taskStage = String(task.task_stage || 'general').toLowerCase();
      const key = `${assigneeRole}:${assigneeUserId}:${taskStage}`;
      if (desiredKeys.has(key)) continue;
      if (String(task.status || '').toUpperCase() === 'DONE') continue;
      await connOrPool.query(
        `UPDATE reservation_tasks
            SET status = 'CANCELLED',
                completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [task.id]
      );
    }
  }
}

async function syncReservationTasksForDeliveryPointIds(connOrPool, deliveryPointIds = []) {
  const ids = Array.from(new Set((Array.isArray(deliveryPointIds) ? deliveryPointIds : [deliveryPointIds])
    .map((value) => normalizePositiveInt(value))
    .filter((value) => Number.isFinite(value) && value > 0)));
  if (!ids.length) return;
  await ensureDeliveryPointsTable();
  await ensureReservationDeliveryPointColumn();
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await connOrPool.query(
    `SELECT id
       FROM reservations
      WHERE delivery_point_id IN (${placeholders})`,
    ids
  );
  const reservationIds = (Array.isArray(rows) ? rows : [])
    .map((row) => normalizePositiveInt(row.id))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!reservationIds.length) return;
  await syncReservationTasksForIds(connOrPool, reservationIds);
}

async function listReservationTasksForAssignee(userId, role, { includeCompleted = true } = {}) {
  const assigneeUserId = normalizeUserId(userId);
  const assigneeRole = String(role || '').trim().toUpperCase();
  if (!assigneeUserId || !assigneeRole) return [];
  await ensureDeliveryPointSchema();
  await ensureReservationTasksTable();
  const where = ['rt.assignee_user_id = ?', 'rt.assignee_role = ?'];
  const params = [assigneeUserId, assigneeRole];
  if (!includeCompleted) {
    where.push("rt.status = 'OPEN'");
  } else {
    where.push("rt.status <> 'CANCELLED'");
  }
  const [rows] = await pool.query(
    `SELECT rt.id AS task_id, rt.status AS task_status, rt.assignee_role, rt.task_stage, rt.store_id AS task_store_id,
            rt.completed_at AS task_completed_at,
            r.*, u.username, u.email, d.username AS driver_username, d.email AS driver_email,
            e.location AS event_address, s.address AS store_address, dp.name AS delivery_point_name
       FROM reservation_tasks rt
       JOIN reservations r ON r.id = rt.reservation_id
       JOIN users u ON u.id = r.user_id
       LEFT JOIN users d ON d.id = r.driver_id
       LEFT JOIN events e ON (e.id = r.event_id OR e.title = r.event)
       LEFT JOIN event_stores s ON s.id = r.store_id
        LEFT JOIN delivery_points dp ON dp.id = rt.delivery_point_id
       WHERE ${where.join(' AND ')}
       ORDER BY CASE WHEN rt.status = 'OPEN' THEN 0 WHEN rt.status = 'DONE' THEN 1 ELSE 2 END, r.reserved_at DESC, r.id DESC`,
    params
  );
  const items = await buildAdminReservationSummaries(Array.isArray(rows) ? rows : [], { includePhotos: false });
  return items.map((item, index) => ({
    ...item,
    task_id: rows[index]?.task_id || null,
    task_status: rows[index]?.task_status || 'OPEN',
    task_stage: rows[index]?.task_stage || 'general',
    task_store_id: rows[index]?.task_store_id || null,
    task_completed_at: rows[index]?.task_completed_at || null,
    assignee_role: assigneeRole,
  }));
}

async function backfillEventStoreDeliveryPoints() {
  if (deliveryPointBackfillDone) return;
  deliveryPointBackfillDone = true;
  try {
    await ensureDeliveryPointsTable();
    await ensureEventStoreDeliveryPointColumn();
    const storeQueries = [
      `SELECT id, name, address, external_url, business_hours,
              remittance_info, remittance_bank_code, remittance_bank_account,
              remittance_account_name, remittance_bank_name, delivery_point_id
         FROM event_stores
        ORDER BY id ASC`,
      'SELECT id, name, delivery_point_id FROM event_stores ORDER BY id ASC',
      'SELECT id, name FROM event_stores ORDER BY id ASC',
    ];
    let storeRows = [];
    let lastErr = null;
    for (const sql of storeQueries) {
      try {
        const [rows] = await pool.query(sql);
        storeRows = Array.isArray(rows) ? rows : [];
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (err?.code !== 'ER_BAD_FIELD_ERROR') throw err;
      }
    }
    if (lastErr && lastErr.code === 'ER_BAD_FIELD_ERROR') throw lastErr;
    if (!storeRows.length) return;

    const [deliveryPointRows] = await pool.query('SELECT * FROM delivery_points ORDER BY id ASC');
    const keyMap = new Map();
    (Array.isArray(deliveryPointRows) ? deliveryPointRows : []).forEach((row) => {
      const key = buildDeliveryPointIdentityKey(row);
      if (key && !keyMap.has(key)) keyMap.set(key, Number(row.id));
    });

    for (const store of storeRows) {
      if (normalizePositiveInt(store.delivery_point_id)) continue;
      const key = buildDeliveryPointIdentityKey(store);
      let deliveryPointId = key ? keyMap.get(key) || null : null;
      if (!deliveryPointId) {
        const remittance = remittanceDetailsFromColumns(store);
        const [result] = await pool.query(
          `INSERT INTO delivery_points (
            owner_user_id, name, address, external_url, business_hours,
            remittance_info, remittance_bank_code, remittance_bank_account,
            remittance_account_name, remittance_bank_name, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            null,
            String(store.name || '').trim() || `交車點 ${store.id}`,
            normalizeNullableText(store.address),
            normalizeNullableText(store.external_url),
            normalizeNullableText(store.business_hours),
            remittance.info || null,
            remittance.bankCode || null,
            remittance.bankAccount || null,
            remittance.accountName || null,
            remittance.bankName || null,
          ]
        );
        deliveryPointId = Number(result.insertId || 0) || null;
        if (deliveryPointId && key) keyMap.set(key, deliveryPointId);
      }
      if (!deliveryPointId) continue;
      await pool.query('UPDATE event_stores SET delivery_point_id = ? WHERE id = ?', [deliveryPointId, store.id]);
    }
  } catch (err) {
    deliveryPointBackfillDone = false;
    console.warn('backfill event store delivery_point_id error:', err?.message || err);
  }
}

async function backfillReservationDeliveryPointIds() {
  await ensureReservationDeliveryPointColumn();
  await ensureEventStoreDeliveryPointColumn();
  if (!reservationHasDeliveryPointIdColumn || !eventStoresHaveDeliveryPointIdColumn) return;
  try {
    await pool.query(
      `UPDATE reservations r
       JOIN event_stores s ON s.id = r.store_id
          SET r.delivery_point_id = s.delivery_point_id
        WHERE (r.delivery_point_id IS NULL OR r.delivery_point_id = 0)
          AND s.delivery_point_id IS NOT NULL`
    );
  } catch (err) {
    console.warn('backfill reservations.delivery_point_id error:', err?.message || err);
  }
}

async function backfillReservationTasks() {
  if (reservationTaskBackfillDone) return;
  reservationTaskBackfillDone = true;
  try {
    await ensureReservationTasksTable();
    const [rows] = await pool.query(
      `SELECT id
         FROM reservations
        WHERE (driver_id IS NOT NULL AND driver_id <> '')
           OR (delivery_point_id IS NOT NULL AND delivery_point_id > 0)`
    );
    const reservationIds = (Array.isArray(rows) ? rows : [])
      .map((row) => normalizePositiveInt(row.id))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (!reservationIds.length) return;
    await syncReservationTasksForIds(pool, reservationIds);
  } catch (err) {
    reservationTaskBackfillDone = false;
    console.warn('backfill reservation tasks error:', err?.message || err);
  }
}

async function ensureDeliveryPointSchema() {
  if (deliveryPointSchemaReady) return;
  await ensureReservationIdColumns();
  await ensureDeliveryPointsTable();
  await ensureDeliveryPointCapacityColumn();
  await ensureDeliveryPointProviderBindingsTable();
  await ensureEventStoreDeliveryPointColumn();
  await ensureEventStoreCapacityColumn();
  await ensureEventStorePhaseColumns();
  await ensureEventServicePricesTable();
  await ensureReservationDeliveryPointColumn();
  await ensureReservationTasksTable();
  await backfillEventServicePrices();
  await backfillEventStoreDeliveryPoints();
  await backfillReservationDeliveryPointIds();
  await backfillReservationTasks();
  deliveryPointSchemaReady = true;
}

ensureDeliveryPointSchema().catch((err) => {
  console.error('ensureDeliveryPointSchema error:', err?.message || err);
});

async function detectChecklistPhotoStorageSupport() {
  try {
    const [rows] = await pool.query("SHOW COLUMNS FROM reservation_checklist_photos LIKE 'storage_path'");
    checklistPhotosHaveStoragePath = Array.isArray(rows) && rows.length > 0;
  } catch (err) {
    console.warn('detect checklist storage_path error:', err?.message || err);
    checklistPhotosHaveStoragePath = false;
  }
}
function isChecklistPhotoStorageEnabled() {
  return checklistPhotosHaveStoragePath;
}

function isEventCoverStorageEnabled() {
  return eventsHaveCoverPathColumn;
}

function isTicketCoverStorageEnabled() {
  return ticketCoversHaveStoragePath;
}

async function detectEventCoverPathSupport() {
  try {
    const [rows] = await pool.query("SHOW COLUMNS FROM events LIKE 'cover_path'");
    eventsHaveCoverPathColumn = Array.isArray(rows) && rows.length > 0;
  } catch (err) {
    console.warn('detect events.cover_path error:', err?.message || err);
    eventsHaveCoverPathColumn = false;
  }
}

async function detectTicketCoverStorageSupport() {
  try {
    const [rows] = await pool.query("SHOW COLUMNS FROM ticket_covers LIKE 'storage_path'");
    ticketCoversHaveStoragePath = Array.isArray(rows) && rows.length > 0;
  } catch (err) {
    console.warn('detect ticket_covers.storage_path error:', err?.message || err);
    ticketCoversHaveStoragePath = false;
  }
}

async function detectImageStorageColumns() {
  await Promise.allSettled([
    detectChecklistPhotoStorageSupport(),
    detectEventCoverPathSupport(),
    detectTicketCoverStorageSupport(),
  ]);
}

detectImageStorageColumns().catch((err) => {
  console.error('detectImageStorageColumns error:', err?.message || err);
});

/** ======== Email 相關（驗證信） ======== */
const REQUIRE_EMAIL_VERIFICATION = (process.env.REQUIRE_EMAIL_VERIFICATION || '0') === '1';
const RESTRICT_EMAIL_DOMAIN_TO_EDU_TW = (process.env.RESTRICT_EMAIL_DOMAIN_TO_EDU_TW || '0') === '1';
const PUBLIC_API_BASE = process.env.PUBLIC_API_BASE || '';
const PUBLIC_WEB_URL = process.env.PUBLIC_WEB_URL || 'http://localhost:5173';
const WEB_BASE = (PUBLIC_WEB_URL || 'http://localhost:5173').replace(/\/$/, '');
const THEME_PRIMARY = process.env.THEME_PRIMARY || process.env.WEB_THEME_PRIMARY || '#D90000';
const FLEX_DEFAULT_ICON = `${WEB_BASE}/icon.png`;
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || process.env.EMAIL_USER_NAME || 'Leader Online';
const EMAIL_USER = process.env.EMAIL_USER || '';
const EMAIL_PASS = process.env.EMAIL_PASS || '';
const EMAIL_FROM_ADDRESS = process.env.EMAIL_FROM_USER || process.env.EMAIL_FROM_ADDRESS || EMAIL_USER;
// Google OAuth
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
// LINE Login (OAuth/OpenID Connect)
const LINE_CLIENT_ID = process.env.LINE_CLIENT_ID || process.env.LINE_CHANNEL_ID || '';
const LINE_CLIENT_SECRET = process.env.LINE_CLIENT_SECRET || process.env.LINE_CHANNEL_SECRET || '';
// LINE Messaging API (push)
const LINE_BOT_CHANNEL_ACCESS_TOKEN = process.env.LINE_BOT_CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
// Magic link for deep-link auto-login from bot
const MAGIC_LINK_SECRET = process.env.MAGIC_LINK_SECRET || process.env.LINK_SIGNING_SECRET || '';
const LINE_BOT_QR_MAX_LENGTH = Number(process.env.LINE_BOT_QR_MAX_LENGTH || 512);
const BANK_TRANSFER_INFO = process.env.BANK_TRANSFER_INFO || '';
const BANK_CODE = process.env.BANK_CODE || '';
const BANK_ACCOUNT = process.env.BANK_ACCOUNT || '';
const BANK_ACCOUNT_NAME = process.env.BANK_ACCOUNT_NAME || '';
const BANK_NAME = process.env.BANK_NAME || '';
const REMITTANCE_SETTING_KEYS = {
  info: 'remittance_info',
  bankCode: 'remittance_bank_code',
  bankAccount: 'remittance_bank_account',
  accountName: 'remittance_account_name',
  bankName: 'remittance_bank_name',
};
const REMITTANCE_ENV_DEFAULTS = {
  info: BANK_TRANSFER_INFO,
  bankCode: BANK_CODE,
  bankAccount: BANK_ACCOUNT,
  accountName: BANK_ACCOUNT_NAME,
  bankName: BANK_NAME,
};
const REMITTANCE_FIELD_LIMITS = {
  info: 600,
  bankCode: 32,
  bankAccount: 64,
  accountName: 64,
  bankName: 64,
};
const USER_REMITTANCE_COLUMN_DEFINITIONS = [
  ['remittance_info', 'TEXT NULL'],
  ['remittance_bank_code', 'VARCHAR(32) NULL'],
  ['remittance_bank_account', 'VARCHAR(64) NULL'],
  ['remittance_account_name', 'VARCHAR(64) NULL'],
  ['remittance_bank_name', 'VARCHAR(64) NULL'],
];
const USER_SERVICE_TERMS_COLUMN = 'service_terms';
const USER_SERVICE_TERMS_LIMIT = 20000;
const EVENT_STORE_REMITTANCE_COLUMN_DEFINITIONS = [
  ['remittance_info', 'TEXT NULL'],
  ['remittance_bank_code', 'VARCHAR(32) NULL'],
  ['remittance_bank_account', 'VARCHAR(64) NULL'],
  ['remittance_account_name', 'VARCHAR(64) NULL'],
  ['remittance_bank_name', 'VARCHAR(64) NULL'],
];
let remittanceConfig = { ...REMITTANCE_ENV_DEFAULTS };
const SITE_PAGE_KEYS = {
  terms: 'site_terms',
  privacy: 'site_privacy',
  reservationNotice: 'site_reservation_notice',
  reservationRules: 'site_reservation_rules',
  insuranceTermsUrl: 'site_insurance_terms_url',
  socialLinks: 'site_social_links',
};
const ORDER_EMAIL_CC_SETTING_KEY = 'order_email_cc';
const CHECKLIST_DEFINITION_SETTING_KEY = 'reservation_checklist_definitions';
const DEFAULT_RESERVATION_CHECKLIST_DEFINITIONS = {
  pre_dropoff: {
    title: '賽前交車檢核表',
    items: [
      '貨物與配件與預約資訊相符',
      '托運文件、標籤與聯絡方式已確認',
      '完成貨況拍照（含外觀、特殊要求）',
    ],
  },
  pre_pickup: {
    title: '賽前取車檢核表',
    items: [
      '貨物外觀與包裝無異常',
      '托運文件與隨附物品已領取',
      '與人員完成貨況紀錄或拍照存證',
    ],
  },
  post_dropoff: {
    title: '賽後交車檢核表',
    items: [
      '貨物停放於指定區域並妥善固定',
      '與人員核對到貨後貨況與隨附物品',
      '拍攝交付現場與貨況照片備查',
    ],
  },
  post_pickup: {
    title: '賽後取車檢核表',
    items: [
      '貨物外觀無新增損傷與污漬',
      '出貨前寄存的隨附物品已領回',
      '與人員完成到貨後貨況點交紀錄',
    ],
  },
};
let reservationChecklistDefinitions = null;

loadRemittanceConfig().catch((err) => {
  console.error('loadRemittanceConfig error:', err?.message || err);
});
setInterval(() => {
  loadRemittanceConfig().catch(() => {});
}, 5 * 60 * 1000);
loadReservationChecklistDefinitions().catch((err) => {
  console.error('loadReservationChecklistDefinitions error:', err?.message || err);
});
setInterval(() => {
  loadReservationChecklistDefinitions().catch(() => {});
}, 5 * 60 * 1000);
ensureRemittanceColumns().catch((err) => {
  console.error('ensureRemittanceColumns error:', err?.message || err);
});

let mailerReady = false;
const transporter = nodemailer.createTransport(EMAIL_USER && EMAIL_PASS ? {
  service: 'gmail',
  auth: { user: EMAIL_USER, pass: EMAIL_PASS },
} : {});
const isMailerReady = () => mailerReady;

if (EMAIL_USER && EMAIL_PASS) {
  transporter.verify((err) => {
    if (err) { console.error('❌ 郵件服務驗證失敗：', err.message); mailerReady = false; }
    else { console.log('✅ 郵件服務就緒（Gmail）'); mailerReady = true; }
  });
} else {
  console.warn('⚠️ 未設定 EMAIL_USER / EMAIL_PASS，無法寄送驗證信');
}

const EMAIL_THEME = {
  primary: '#A9363C',
  secondary: '#7F252B',
  text: '#1f2937',
  muted: '#64748b',
  line: '#d5dde8',
  page: '#f7f8fa',
  panel: '#ffffff',
  soft: '#fbf1f2',
};

function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildLeaderEmailHtml({
  title = 'Leader Online 通知',
  eyebrow = 'Leader Online',
  intro = '',
  childrenHtml = '',
  actionUrl = '',
  actionText = '查看詳情',
  footerNote = '此信件由系統自動發送，請勿直接回覆。',
} = {}) {
  const safeTitle = escapeHtml(title);
  const safeEyebrow = escapeHtml(eyebrow);
  const safeIntro = escapeHtml(intro);
  const safeFooter = escapeHtml(footerNote);
  const safeActionUrl = String(actionUrl || '').trim();
  const actionHtml = safeActionUrl
    ? `
      <tr>
        <td style="padding:8px 28px 22px 28px;">
          <a href="${escapeHtml(safeActionUrl)}" style="display:inline-block;background:${EMAIL_THEME.primary};color:#ffffff;text-decoration:none;border:1px solid ${EMAIL_THEME.primary};border-radius:12px;padding:12px 18px;font-size:15px;font-weight:500;">
            ${escapeHtml(actionText)}
          </a>
        </td>
      </tr>`
    : '';

  return `
<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0;padding:0;background:${EMAIL_THEME.page};font-family:Inter,'Segoe UI','Noto Sans TC','PingFang TC','Microsoft JhengHei',Arial,sans-serif;color:${EMAIL_THEME.text};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL_THEME.page};padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:${EMAIL_THEME.panel};border:1px solid ${EMAIL_THEME.line};border-radius:18px;overflow:hidden;">
            <tr>
              <td style="padding:26px 28px 18px 28px;border-bottom:1px solid ${EMAIL_THEME.line};">
                <div style="font-size:13px;line-height:20px;color:${EMAIL_THEME.primary};font-weight:500;margin-bottom:8px;">${safeEyebrow}</div>
                <h1 style="margin:0;color:${EMAIL_THEME.text};font-size:24px;line-height:1.28;font-weight:500;letter-spacing:0;">${safeTitle}</h1>
                ${safeIntro ? `<p style="margin:12px 0 0 0;color:${EMAIL_THEME.muted};font-size:15px;line-height:1.7;">${safeIntro}</p>` : ''}
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px 8px 28px;font-size:15px;line-height:1.8;color:${EMAIL_THEME.text};">
                ${childrenHtml}
              </td>
            </tr>
            ${actionHtml}
            <tr>
              <td style="padding:18px 28px 26px 28px;border-top:1px solid ${EMAIL_THEME.line};background:#fbfcfd;">
                <p style="margin:0;color:${EMAIL_THEME.muted};font-size:13px;line-height:1.7;">${safeFooter}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();
}

/** ======== Email: reservation status notifications ======== */
function zhReservationStatus(status){
  const map = {
    service_booking: '建立預約',
    pre_dropoff: '賽前交車',
    pre_pickup: '賽前取車',
    post_dropoff: '賽後交車',
    post_pickup: '賽後取車',
    done: '完成',
  };
  return map[status] || status;
}

async function sendReservationStatusEmail({ to, eventTitle, store, statusZh, userId, lineMessages, lineText, emailSubject, emailHtml }){
  const title = String(eventTitle || '預約');
  const storeName = String(store || '交車點資訊');
  const zh = String(statusZh || '狀態更新');
  const defaultLine = lineMessages ? null : (lineText || `【Leader Online】${title}（${storeName}）狀態已更新：${zh}`);
  const linePayload = lineMessages || defaultLine;
  if (userId && linePayload) {
    try { await notifyLineByUserId(userId, linePayload) } catch (_) { /* ignore line errors */ }
  }

  if (!mailerReady) return { mailed: false, reason: 'mailer_not_ready' };
  const email = String(to || '').trim();
  if (!email) return { mailed: false, reason: 'no_email' };
  const web = (process.env.PUBLIC_WEB_URL || 'http://localhost:5173').replace(/\/$/, '');
  const walletUrl = `${web}/wallet?tab=reservations`;
  const subject = emailSubject || `預約狀態更新：${title} - ${zh}`;
  const html = buildLeaderEmailHtml({
    title: subject,
    intro: '您的預約進度已有更新，請依照最新狀態安排交付或取貨。',
    actionUrl: walletUrl,
    actionText: '查看預約詳情',
    childrenHtml: emailHtml || `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${EMAIL_THEME.line};border-radius:14px;overflow:hidden;margin:0 0 18px 0;">
        <tr><td style="padding:12px 14px;border-bottom:1px solid ${EMAIL_THEME.line};color:${EMAIL_THEME.muted};width:32%;">服務檔期</td><td style="padding:12px 14px;border-bottom:1px solid ${EMAIL_THEME.line};font-weight:500;">${escapeHtml(title)}</td></tr>
        <tr><td style="padding:12px 14px;border-bottom:1px solid ${EMAIL_THEME.line};color:${EMAIL_THEME.muted};">交車點資訊</td><td style="padding:12px 14px;border-bottom:1px solid ${EMAIL_THEME.line};font-weight:500;">${escapeHtml(storeName)}</td></tr>
        <tr><td style="padding:12px 14px;color:${EMAIL_THEME.muted};">狀態</td><td style="padding:12px 14px;color:${EMAIL_THEME.primary};font-weight:500;">${escapeHtml(zh)}</td></tr>
      </table>
      <p style="margin:0 0 16px 0;">您可前往錢包查看預約詳情與完整進度。</p>
    `,
  });
  try{
    await transporter.sendMail({
      from: `${EMAIL_FROM_NAME} <${EMAIL_FROM_ADDRESS}>`,
      to: email,
      subject,
      html,
    });
    return { mailed: true };
  } catch (e) {
    console.error('sendReservationStatusEmail error:', e?.message || e);
    return { mailed: false, reason: e?.message || 'send_error' };
  }
}

async function sendOrderNotificationEmail({ to, username, orders = [], type = 'created', userId, lineMessages, lineText, emailSubject, emailHtml, cc } = {}) {
  const list = Array.isArray(orders) ? orders.filter(o => o && (o.code || o.id)) : [];
  const first = list[0] || {};
  const defaultLine = lineMessages ? null : (lineText || (type === 'completed'
    ? `【Leader Online】您的訂單${first.code ? ` ${first.code}` : ''} 已付款，匯款確認成功。${list.length ? `\n${buildAmountBreakdownText(first)}` : ''}`
    : `【Leader Online】已建立訂單${first.code ? ` ${first.code}` : ''}，請留意匯款資訊。${list.length ? `\n${buildAmountBreakdownText(first)}` : ''}`));
  const linePayload = lineMessages || defaultLine;
  if (userId && linePayload) {
    try { await notifyLineByUserId(userId, linePayload) } catch (_) { /* ignore line errors */ }
  }

  if (!mailerReady) return { mailed: false, reason: 'mailer_not_ready' };
  const email = String(to || '').trim();
  if (!email) return { mailed: false, reason: 'no_email' };
  if (!list.length) return { mailed: false, reason: 'no_orders' };

  const subjectBase = type === 'completed' ? '訂單已付款' : '訂單已建立';
  const defaultSubject = `${subjectBase}${list.length === 1 ? `：${list[0].code || list[0].id || ''}` : ''}`;
  const greeting = username ? `${username} 您好，` : '您好，';
  const intro = type === 'completed'
    ? '我們已確認以下訂單付款完成，感謝您的耐心等待。'
    : '已為您建立以下訂單，請依照匯款資訊完成付款。';

  const listHtml = list.map((o) => {
    const code = o.code || o.id || '';
    const amountText = `（總計：${formatCurrency(normalizeOrderAmounts(o).total)}）`;
    const status = o.status ? `（狀態：${o.status}）` : '';
    const detailsLines = Array.isArray(o.detailsSummary) ? o.detailsSummary : [];
    const detailHtml = detailsLines.length ? `<ul style="margin:8px 0 0 18px;padding:0;color:${EMAIL_THEME.text};">${detailsLines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : '';
    const amountHtml = buildAmountBreakdownHtml(o);
    return `
      <section style="border:1px solid ${EMAIL_THEME.line};border-radius:14px;padding:16px 16px;margin:0 0 14px 0;background:#ffffff;">
        <div style="font-size:13px;color:${EMAIL_THEME.muted};margin-bottom:4px;">訂單編號</div>
        <div style="font-size:18px;line-height:1.4;color:${EMAIL_THEME.primary};font-weight:500;">${escapeHtml(code)}</div>
        <div style="margin-top:8px;color:${EMAIL_THEME.text};">${escapeHtml(amountText)}${escapeHtml(status)}</div>
        ${detailHtml}
        ${amountHtml}
      </section>
    `;
  }).join('');

  const remittanceSource = list.find(o => o && o.remittance && Object.keys(o.remittance || {}).length);
  const remittance = remittanceSource ? remittanceSource.remittance : defaultRemittanceDetails();
  const remittanceItems = [];
  if (remittance.info) remittanceItems.push(['匯款說明', remittance.info]);
  if (remittance.bankCode) remittanceItems.push(['銀行代碼', remittance.bankCode]);
  if (remittance.bankAccount) remittanceItems.push(['銀行帳戶', remittance.bankAccount]);
  if (remittance.accountName) remittanceItems.push(['帳戶名稱', remittance.accountName]);
  if (remittance.bankName) remittanceItems.push(['銀行名稱', remittance.bankName]);
  const remittanceHtml = remittanceItems.length ? `
    <section style="border:1px solid #e7c0c4;background:${EMAIL_THEME.soft};border-radius:14px;padding:16px;margin:18px 0;">
      <h2 style="margin:0 0 10px 0;font-size:17px;line-height:1.4;color:${EMAIL_THEME.primary};font-weight:500;">匯款資訊</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${remittanceItems.map(([label, value]) => `
          <tr>
            <td style="padding:6px 0;color:${EMAIL_THEME.muted};width:96px;">${escapeHtml(label)}</td>
            <td style="padding:6px 0;color:${EMAIL_THEME.text};font-weight:500;">${escapeHtml(value)}</td>
          </tr>
        `).join('')}
      </table>
    </section>
  ` : '';

  const outro = type === 'completed'
    ? '我們已收到您的匯款並確認付款，祝您使用愉快！'
    : '若您已完成匯款，請耐心等候管理員確認。';

  const subject = emailSubject || defaultSubject;
  const html = buildLeaderEmailHtml({
    title: subject,
    intro,
    actionUrl: `${(process.env.PUBLIC_WEB_URL || 'http://localhost:5173').replace(/\/$/, '')}/wallet`,
    actionText: '查看我的錢包',
    childrenHtml: emailHtml || `
      <p style="margin:0 0 16px 0;">${escapeHtml(greeting)}</p>
      ${listHtml}
      ${remittanceHtml}
      <p style="margin:18px 0 16px 0;">${escapeHtml(outro)}</p>
    `,
  });
  let ccRecipients = [];
  try {
    ccRecipients = await resolveOrderEmailCcRecipients(email, cc);
  } catch (e) {
    console.error('resolveOrderEmailCcRecipients error:', e?.message || e);
  }

  try {
    const mailOptions = {
      from: `${EMAIL_FROM_NAME} <${EMAIL_FROM_ADDRESS}>`,
      to: email,
      subject,
      html,
    };
    if (ccRecipients.length) mailOptions.cc = ccRecipients;
    await transporter.sendMail(mailOptions);
    return { mailed: true };
  } catch (e) {
    console.error('sendOrderNotificationEmail error:', e?.message || e);
    return { mailed: false, reason: e?.message || 'send_error' };
  }
}

/** ======== Ticket expiry reminders ======== */
const TICKET_EXPIRY_NOTICE_DAYS = 7;
const TICKET_EXPIRY_NOTICE_LIMIT = 200;
const TICKET_EXPIRY_NOTICE_INTERVAL_MS = 60 * 60 * 1000;

async function sendTicketExpiryNotices(daysAhead = TICKET_EXPIRY_NOTICE_DAYS) {
  try {
    await ensureTicketLogsTable();
    const action = `expiry_notice_${daysAhead}d`;
    const [rows] = await pool.query(
      `
        SELECT t.id, t.type, t.expiry, t.user_id, u.email, u.username
        FROM tickets t
        JOIN users u ON u.id = t.user_id
        LEFT JOIN ticket_logs l ON l.ticket_id = t.id AND l.action = ?
        WHERE t.used = 0
          AND t.expiry IS NOT NULL
          AND t.expiry = DATE_ADD(CURRENT_DATE(), INTERVAL ? DAY)
          AND l.id IS NULL
        ORDER BY t.id ASC
        LIMIT ?
      `,
      [action, daysAhead, TICKET_EXPIRY_NOTICE_LIMIT]
    );
    if (!rows.length) return;
    const walletUrl = `${WEB_BASE}/wallet?tab=tickets`;

    for (const row of rows) {
      const ticketLabel = row.type || '票券';
      const expiryText = formatDateDisplay(row.expiry) || row.expiry;
      const meta = { days_before: daysAhead, email_sent: false, line_sent: false };
      const lineMessage = `【Leader Online】您的 ${ticketLabel} 將於 ${expiryText} 到期，請儘快預約使用。`;

      try {
        await notifyLineByUserId(row.user_id, lineMessage);
        meta.line_sent = true;
      } catch (err) {
        console.error('ticketExpiryNotice line error:', err?.message || err);
      }

      try {
        const email = String(row.email || '').trim();
        if (email && isMailerReady()) {
          const subject = '票券即將到期提醒';
          const html = `
            <p>${row.username || '您好'}，您的票券即將到期：</p>
            <ul>
              <li><strong>票券：</strong>${ticketLabel}</li>
              <li><strong>到期日：</strong>${expiryText}</li>
            </ul>
            <p>請在到期前使用，可至錢包查看：</p>
            <p><a href="${walletUrl}">${walletUrl}</a></p>
            <p style="color:#888; font-size:12px;">此信件由系統自動發送，請勿直接回覆。</p>
          `;
          await transporter.sendMail({
            from: `${EMAIL_FROM_NAME} <${EMAIL_FROM_ADDRESS}>`,
            to: email,
            subject,
            html,
          });
          meta.email_sent = true;
        }
      } catch (err) {
        console.error('ticketExpiryNotice email error:', err?.message || err);
      }

      try {
        await logTicket({ ticketId: row.id, userId: row.user_id, action, meta });
      } catch (err) {
        console.error('ticketExpiryNotice log error:', err?.message || err);
      }
    }
  } catch (err) {
    console.error('ticketExpiryNotice error:', err?.message || err);
  }
}

setInterval(() => { sendTicketExpiryNotices().catch(() => {}); }, TICKET_EXPIRY_NOTICE_INTERVAL_MS);
sendTicketExpiryNotices().catch(() => {});

/** ======== JWT 與驗證 ======== */
const JWT_SECRET = process.env.JWT_SECRET || 'change_me';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

function setAuthCookie(res, token) {
  res.cookie('auth_token', token, cookieOptions());
}

function shortCookieOptions(maxAgeMs = 5 * 60 * 1000) {
  const base = cookieOptions();
  return { ...base, maxAge: maxAgeMs };
}

function publicApiBase(req){
  const apiBase = (process.env.PUBLIC_API_BASE || '').replace(/\/$/, '');
  if (apiBase) return apiBase;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.get('host');
  return `${proto}://${host}`;
}

function toQuery(params){
  return Object.entries(params).map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v==null?'':String(v))}`).join('&');
}

const https = require('https');
const HTTPS_REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.OUTBOUND_HTTP_TIMEOUT_MS || 15000));
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  timeout: HTTPS_REQUEST_TIMEOUT_MS,
});

function requestWithTimeout(opts, onResponse) {
  return new Promise((resolve, reject) => {
    const req = https.request({ ...opts, agent: httpsAgent }, onResponse);
    req.setTimeout(HTTPS_REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Request timeout after ${HTTPS_REQUEST_TIMEOUT_MS}ms`));
    });
    req.on('error', reject);
    resolve(req);
  });
}

function httpsPostForm(url, bodyObj){
  return new Promise((resolve, reject) => {
    try{
      const data = toQuery(bodyObj);
      const u = new URL(url);
      const opts = {
        method: 'POST',
        hostname: u.hostname,
        path: u.pathname + (u.search || ''),
        port: u.port || 443,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) }
      };
      requestWithTimeout(opts, (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => buf += c);
        res.on('end', () => {
          try { resolve(JSON.parse(buf)); } catch (e) { reject(e) }
        });
      }).then((req) => {
        req.write(data);
        req.end();
      }).catch(reject);
    } catch (e){ reject(e) }
  })
}

function httpsGetJson(url, headers={}){
  return new Promise((resolve, reject) => {
    try{
      const u = new URL(url);
      const opts = { method: 'GET', hostname: u.hostname, path: u.pathname + (u.search||''), port: u.port || 443, headers };
      requestWithTimeout(opts, (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => buf += c);
        res.on('end', () => { try { resolve(JSON.parse(buf)) } catch (e) { reject(e) } });
      }).then((req) => {
        req.end();
      }).catch(reject);
    } catch (e){ reject(e) }
  })
}

function httpsPostJson(url, bodyObj, headers={}){
  return new Promise((resolve, reject) => {
    try{
      const data = JSON.stringify(bodyObj || {});
      const u = new URL(url);
      const opts = {
        method: 'POST',
        hostname: u.hostname,
        path: u.pathname + (u.search || ''),
        port: u.port || 443,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers }
      };
      requestWithTimeout(opts, (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => buf += c);
        res.on('end', () => {
          const status = res.statusCode || 0;
          let parsed;
          if (buf) {
            try { parsed = JSON.parse(buf); }
            catch { parsed = { raw: buf }; }
          } else {
            parsed = {};
          }
          if (status >= 400) {
            const err = new Error(`HTTP ${status}`);
            err.status = status;
            err.response = parsed;
            return reject(err);
          }
          resolve(parsed);
        });
      }).then((req) => {
        req.write(data);
        req.end();
      }).catch(reject);
    } catch (e){ reject(e) }
  })
}

// ======== LINE push helper ========
async function linePush(toUserId, messages) {
  try {
    if (!LINE_BOT_CHANNEL_ACCESS_TOKEN) {
      console.warn('linePush skipped: LINE_BOT_CHANNEL_ACCESS_TOKEN not configured');
      return;
    }
    if (!toUserId) {
      console.warn('linePush skipped: missing target user id');
      return;
    }
    const prepared = normalizeLineMessages(messages);
    if (!prepared.length) {
      console.warn('linePush skipped: no messages to send');
      return;
    }
    const body = { to: toUserId, messages: prepared };
    await httpsPostJson('https://api.line.me/v2/bot/message/push', body, {
      Authorization: `Bearer ${LINE_BOT_CHANNEL_ACCESS_TOKEN}`,
    });
    const typeLabel = prepared.length > 1 ? 'multi' : prepared[0]?.type || 'unknown';
    console.log('linePush success', { to: toUserId, type: typeLabel });
  } catch (err) {
    console.error('linePush error:', err?.response?.data || err?.message || err);
  }
}

async function getLineSubjectByUserId(userId) {
  try {
    await ensureOAuthIdentitiesTable();
    const [rows] = await pool.query('SELECT subject FROM oauth_identities WHERE user_id = ? AND provider = ? LIMIT 1', [userId, 'line']);
    if (!rows.length) {
      console.warn('getLineSubjectByUserId: line subject not found', { userId });
    }
    return rows.length ? String(rows[0].subject) : null;
  } catch (_) { return null }
}

async function notifyLineByUserId(userId, textOrMessages) {
  try {
    console.log('notifyLineByUserId invoked', {
      userId,
      type: typeof textOrMessages === 'string' ? 'text' : Array.isArray(textOrMessages) ? 'messages' : (textOrMessages?.type || 'unknown'),
    });
    const to = await getLineSubjectByUserId(userId);
    if (!to) {
      console.warn('notifyLineByUserId skipped: LINE subject not found for user', userId);
      return;
    }
    await linePush(to, textOrMessages);
  } catch (err) {
    console.error('notifyLineByUserId error:', err?.message || err);
  }
}

// ======== Magic Link (tokenized deep link) ========
function hmacSha256Hex(secret, text){
  return crypto.createHmac('sha256', secret).update(String(text)).digest('hex');
}
function safeEqual(a, b){
  try{
    const aa = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (aa.length !== bb.length) return false;
    return crypto.timingSafeEqual(aa, bb);
  } catch { return false }
}

// GET /auth/magic_link?provider=line&subject=<line_userId>&redirect=/account&ts=<ms>&sig=<hmac>
// ======== Flex message builders (LINE push) ========
function flex(altText, bubble){ return { type: 'flex', altText, contents: bubble } }
function flexText(text, opts = {}){
  const node = { type: 'text', text: String(text), wrap: true, size: opts.size || 'sm' };
  if (opts.color) node.color = opts.color;
  if (opts.weight) node.weight = opts.weight;
  if (opts.margin) node.margin = opts.margin;
  if (opts.align) node.align = opts.align;
  return node;
}
function flexButtonUri(label, uri, color = THEME_PRIMARY, style = 'primary'){
  return { type: 'button', style, color, action: { type: 'uri', label, uri } }
}
function flexButtonMsg(label, text){ return { type: 'button', style: 'link', color: THEME_PRIMARY, action: { type: 'message', label, text } } }
function flexBubble({ title, lines = [], footer = [], heroUrl = null }){
  const bubble = { type: 'bubble', body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [] } };
  if (title) {
    bubble.header = {
      type: 'box',
      layout: 'vertical',
      contents: [{ type: 'text', text: String(title), weight: 'bold', size: 'md', color: '#111111' }],
    };
    bubble.styles = bubble.styles || {};
    bubble.styles.header = { backgroundColor: '#FFFFFF' };
  }
  bubble.body.contents = Array.isArray(lines) ? lines : [flexText(String(lines||''))];
  if (footer && footer.length) bubble.footer = { type: 'box', layout: 'vertical', spacing: 'sm', contents: footer };
  if (heroUrl) bubble.hero = { type: 'image', url: heroUrl, size: 'full', aspectRatio: '20:13', aspectMode: 'cover' };
  return bubble;
}

function simpleFlexMessage(text, options = {}){
  const content = text == null ? '' : String(text);
  const title = options.title || options.altText || (content ? content.split('\n')[0] : '通知');
  const altText = (options.altText || content || title || '通知').slice(0, 299) || '通知';
  const lines = options.lines || [flexText(content || title || '通知')];
  return flex(altText, flexBubble({ title, lines: Array.isArray(lines) ? lines : [lines], footer: options.footer || [] }));
}

function imageFlexMessage(url, options = {}){
  const source = url || options.fallback || FLEX_DEFAULT_ICON;
  const caption = options.caption ? String(options.caption) : '';
  const title = options.title || '圖片通知';
  const altText = (options.altText || caption || title || '通知').slice(0, 299) || '通知';
  const lines = caption ? [flexText(caption)] : [flexText(title)];
  return flex(altText, flexBubble({ title, lines, heroUrl: source }));
}

function buildReservationFlexMessage({ title, lines = [], qrUrl = '', qrLabel = 'QR Code', altTextHint = '' }) {
  const textNodes = [];
  const altPieces = [];
  lines.forEach((entry, index) => {
    if (!entry) return;
    if (typeof entry === 'string') {
      const text = entry.trim();
      if (!text) return;
      const opts = index === 0 ? { weight: 'bold', size: 'md' } : {};
      textNodes.push(flexText(text, opts));
      altPieces.push(text);
      return;
    }
    if (typeof entry === 'object') {
      const rawText = typeof entry.text === 'string' ? entry.text : '';
      const text = rawText.trim();
      if (!text) return;
      const opts = { ...entry };
      delete opts.text;
      if (index === 0) {
        if (!opts.weight) opts.weight = 'bold';
        if (!opts.size) opts.size = 'md';
      }
      textNodes.push(flexText(text, opts));
      altPieces.push(text);
    }
  });

  if (!textNodes.length) {
    textNodes.push(flexText('最新預約資訊'));
    altPieces.push('最新預約資訊');
  }

  const bodyContents = [
    { type: 'box', layout: 'vertical', spacing: 'xs', contents: textNodes },
  ];

  const safeQrUrl = String(qrUrl || '').trim();
  if (safeQrUrl) {
    bodyContents.push({ type: 'separator', margin: 'md' });
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      alignItems: 'center',
      margin: 'md',
      contents: [
        flexText(qrLabel || 'QR Code', { size: 'xs', color: '#888888', align: 'center' }),
        {
          type: 'image',
          url: safeQrUrl,
          margin: 'sm',
          size: 'full',
          aspectRatio: '1:1',
          aspectMode: 'fit',
          backgroundColor: '#FFFFFF',
        },
      ],
    });
  }

  const altTextSource = typeof altTextHint === 'string' ? altTextHint.trim() : '';
  const altText = (altTextSource || altPieces.join(' ')).slice(0, 299) || '預約提醒';

  return flex(altText, flexBubble({ title: title || '預約提醒', lines: bodyContents }));
}

function normalizeLineMessages(messages){
  const arr = Array.isArray(messages) ? messages : (messages != null ? [messages] : []);
  const out = [];
  for (const msg of arr){
    const converted = convertToFlexMessage(msg);
    if (Array.isArray(converted)) out.push(...converted);
    else if (converted) out.push(converted);
  }
  return out;
}

function convertToFlexMessage(message){
  if (message == null) return null;
  if (typeof message === 'string') return simpleFlexMessage(message);
  if (Array.isArray(message)) return normalizeLineMessages(message);
  if (typeof message !== 'object') return simpleFlexMessage(String(message));
  if (message.type === 'flex') {
    if (!message.altText || !String(message.altText).trim()) {
      return { ...message, altText: deriveFlexAltText(message.contents) };
    }
    return message;
  }
  if (message.type === 'text') {
    const { quickReply, sender } = message;
    const flexMsg = simpleFlexMessage(message.text ?? '', { title: message.title, altText: message.altText });
    if (quickReply) flexMsg.quickReply = quickReply;
    if (sender) flexMsg.sender = sender;
    return flexMsg;
  }
  if (message.type === 'image') {
    const { quickReply, sender } = message;
    const flexMsg = imageFlexMessage(message.originalContentUrl || message.previewImageUrl, {
      caption: message.text,
      altText: message.altText,
      title: message.title,
    });
    if (quickReply) flexMsg.quickReply = quickReply;
    if (sender) flexMsg.sender = sender;
    return flexMsg;
  }
  return simpleFlexMessage(JSON.stringify(message));
}

function deriveFlexAltText(contents){
  try {
    if (!contents) return '通知';
    if (typeof contents?.altText === 'string') return contents.altText.slice(0, 299) || '通知';
    const nodes = contents.contents || contents;
    if (Array.isArray(nodes)) {
      const textNode = nodes.find((node) => node?.type === 'text' && node.text);
      if (textNode) return String(textNode.text).slice(0, 299) || '通知';
    }
  } catch (_) {}
  return '通知';
}

function buildOrderCreatedFlex(orderSummaries = [], remittance = null){
  const list = Array.isArray(orderSummaries) ? orderSummaries : [];
  if (!list.length) {
    return flex('訂單建立成功', flexBubble({ title: '訂單建立成功', lines: [flexText('已建立訂單。')] }));
  }
  const bubbles = list.map((order) => {
    const lines = [
      flexText(`訂單編號：${order.code || order.id || ''}`),
      flexText(`狀態：${order.status || '待匯款'}`),
    ].filter(Boolean);
    const detailLines = Array.isArray(order.detailsSummary) ? order.detailsSummary : [];
    if (detailLines.length) {
      lines.push(flexText('訂單詳情', { margin: 'md', weight: 'bold', size: 'sm' }));
      for (const d of detailLines) lines.push(flexText(`• ${d}`, { size: 'xs', color: '#555555' }));
    }
    const amountRows = buildAmountBreakdownEntries(order);
    if (amountRows.length) {
      lines.push(flexText('金額明細', { margin: 'md', weight: 'bold', size: 'sm' }));
      for (const row of amountRows) {
        lines.push(flexText(`${row.label}：${row.value}`, { size: 'xs', color: '#555555' }));
      }
    }
    const remittanceLines = [];
    if (remittance?.info) remittanceLines.push(flexText(remittance.info, { size: 'xs', color: '#555555' }));
    if (remittance?.bankCode) remittanceLines.push(flexText(`銀行代碼：${remittance.bankCode}`, { size: 'xs', color: '#555555' }));
    if (remittance?.bankAccount) remittanceLines.push(flexText(`銀行帳戶：${remittance.bankAccount}`, { size: 'xs', color: '#555555' }));
    if (remittance?.accountName) remittanceLines.push(flexText(`帳戶名稱：${remittance.accountName}`, { size: 'xs', color: '#555555' }));
    if (remittance?.bankName) remittanceLines.push(flexText(`銀行名稱：${remittance.bankName}`, { size: 'xs', color: '#555555' }));
    if (remittanceLines.length) {
      lines.push(flexText('匯款資訊', { margin: 'md', weight: 'bold', size: 'sm' }));
      lines.push(...remittanceLines);
    }
    return flexBubble({ title: '訂單建立成功', lines });
  });
  if (bubbles.length === 1) return flex('訂單建立成功', bubbles[0]);
  return flexCarousel('訂單建立成功', bubbles);
}
function buildOrderDoneFlex(orderOrCode, total = null){
  const order = orderOrCode && typeof orderOrCode === 'object' ? orderOrCode : { code: orderOrCode, total };
  const code = order.code || (typeof orderOrCode === 'string' ? orderOrCode : '');
  const lines = [flexText(`您的訂單 ${code || ''} 已付款。`)];
  const amountRows = buildAmountBreakdownEntries(order);
  if (amountRows.length) {
    lines.push(flexText('金額明細', { margin: 'md', weight: 'bold', size: 'sm' }));
    for (const row of amountRows) {
      lines.push(flexText(`${row.label}：${row.value}`, { size: 'xs', color: '#555555' }));
    }
  }
  lines.push(flexText('感謝您的匯款與支持！', { size: 'xs', color: '#555555' }));
  return flex('訂單已付款', flexBubble({ title: '訂單已付款', lines }));
}
function buildTransferAcceptedForSenderFlex(ticketType, recipientName){
  const name = recipientName ? String(recipientName) : '對方';
  const t = ticketType || '票券';
  const lines = [flexText(`您轉贈的 ${t} 已由 ${name} 接受。`)]
  return flex('轉贈完成通知', flexBubble({ title: '轉贈完成', lines }));
}
function buildTransferAcceptedForRecipientFlex(ticketType){
  const t = ticketType || '票券';
  const lines = [flexText(`您已成功領取 ${t}。`)]
  return flex('領取成功', flexBubble({ title: '領取成功', lines }));
}
function buildReservationStatusFlex(eventTitle, store, zhStatus){
  const title = '預約狀態更新';
  const lines = [
    flexText(`服務檔期：${eventTitle || '預約'}`),
    flexText(`交車點資訊：${store || '-'}`),
    flexText(`狀態：${zhStatus || '-'}`),
  ];
  return flex(title, flexBubble({ title, lines }));
}
function buildReservationProgressFlex(eventTitle, store, zhNext){
  const title = '預約進度';
  const lines = [
    flexText(`服務檔期：${eventTitle || '預約'}`),
    flexText(`交車點資訊：${store || '-'}`),
    flexText(`已進入：${zhNext || '-'}`),
  ];
  return flex(title, flexBubble({ title, lines }));
}

// 支援 Cookie 或 Authorization: Bearer
function extractToken(req) {
  if (req.cookies?.auth_token) return req.cookies.auth_token;
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

const normalizeRole = (role) => {
  const raw = String(role || '').toUpperCase();
  if (raw === 'STORE') return 'SERVICE_PROVIDER';
  if (raw === 'COACH') return 'SERVICE_PROVIDER';
  return raw;
};

function authRequired(req, res, next) {
  const token = extractToken(req);
  if (!token) return fail(res, 'AUTH_REQUIRED', '請先登入', 401);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return fail(res, 'AUTH_INVALID_TOKEN', '登入已過期或無效', 401);
  }
}

function isADMIN(role){ return normalizeRole(role) === 'ADMIN' }
function isSERVICE_PROVIDER(role){ return normalizeRole(role) === 'SERVICE_PROVIDER' }
function isDRIVER(role){ return normalizeRole(role) === 'DRIVER' }
function isDELIVERY_POINT(role){ return normalizeRole(role) === 'DELIVERY_POINT' }
function isSTORE(role){ return isSERVICE_PROVIDER(role) }
function isEDITOR(role){ return normalizeRole(role) === 'EDITOR' }
function hasBackofficeAccess(role){ return isADMIN(role) || isSERVICE_PROVIDER(role) || isDRIVER(role) || isDELIVERY_POINT(role) || isEDITOR(role) }
function canManageProducts(role){ return isADMIN(role) || isEDITOR(role) || isSERVICE_PROVIDER(role) }
function canManageEvents(role){ return isADMIN(role) || isSERVICE_PROVIDER(role) || isEDITOR(role) }
function canManageReservations(role){ return isADMIN(role) || isSERVICE_PROVIDER(role) || isDELIVERY_POINT(role) }
function canUseScan(_role){ return true }
function canManageOrders(role){ return isADMIN(role) }
function adminOnly(req, res, next){
  authRequired(req, res, () => {
    if (!isADMIN(req.user?.role)) return fail(res, 'FORBIDDEN', '需要管理員權限', 403);
    next();
  })
}
function staffRequired(req, res, next){
  authRequired(req, res, () => {
    if (!hasBackofficeAccess(req.user?.role)) return fail(res, 'FORBIDDEN', '需要後台權限', 403);
    next();
  })
}

function adminOrEditorOnly(req, res, next){
  authRequired(req, res, () => {
    if (!isADMIN(req.user?.role) && !isEDITOR(req.user?.role)) {
      return fail(res, 'FORBIDDEN', '需要管理員或編輯權限', 403);
    }
    next();
  })
}

function productManagerOnly(req, res, next){
  staffRequired(req, res, () => {
    if (!canManageProducts(req.user?.role)) return fail(res, 'FORBIDDEN', '需要票券商品管理權限', 403);
    next();
  })
}

function eventManagerOnly(req, res, next){
  staffRequired(req, res, () => {
    if (!canManageEvents(req.user?.role)) return fail(res, 'FORBIDDEN', '需要服務檔期管理權限', 403);
    next();
  })
}

function reservationManagerOnly(req, res, next){
  staffRequired(req, res, () => {
    if (!canManageReservations(req.user?.role)) return fail(res, 'FORBIDDEN', '需要預約管理權限', 403);
    next();
  })
}

function scanAccessOnly(req, res, next){
  authRequired(req, res, () => {
    if (!canUseScan(req.user?.role)) return fail(res, 'FORBIDDEN', '需要掃描權限', 403);
    next();
  })
}

function serviceProviderOnly(req, res, next){
  authRequired(req, res, () => {
    if (!isSERVICE_PROVIDER(req.user?.role) && !isADMIN(req.user?.role)) {
      return fail(res, 'FORBIDDEN', '需要服務商權限', 403);
    }
    next();
  })
}

function driverOnly(req, res, next){
  authRequired(req, res, () => {
    if (!isDRIVER(req.user?.role) && !isADMIN(req.user?.role)) {
      return fail(res, 'FORBIDDEN', '需要司機權限', 403);
    }
    next();
  })
}

function deliveryPointOnly(req, res, next){
  authRequired(req, res, () => {
    if (!isDELIVERY_POINT(req.user?.role) && !isADMIN(req.user?.role)) {
      return fail(res, 'FORBIDDEN', '需要交車點權限', 403);
    }
    next();
  })
}

function safeParseJSON(v, fallback = {}) {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

const CHECKLIST_STAGE_KEYS = ['pre_dropoff', 'pre_pickup', 'post_dropoff', 'post_pickup'];
const CHECKLIST_STAGES = new Set(CHECKLIST_STAGE_KEYS);
function cloneChecklistDefinitions(source = {}) {
  const result = {};
  for (const stage of CHECKLIST_STAGE_KEYS) {
    const entry = source && typeof source === 'object' ? source[stage] : null;
    const title = entry && typeof entry.title === 'string' ? entry.title : '';
    const itemsRaw = Array.isArray(entry?.items) ? entry.items : [];
    result[stage] = {
      title,
      items: itemsRaw.map((item) => (typeof item === 'string' ? item : (item && typeof item.label === 'string' ? item.label : ''))).filter(Boolean),
    };
  }
  return result;
}
function normalizeChecklistDefinitionStage(stage, input = {}) {
  const defaults = DEFAULT_RESERVATION_CHECKLIST_DEFINITIONS[stage] || { title: stage, items: [] };
  const source = input && typeof input === 'object' ? input : {};
  const maxItems = 12;
  const maxLabelLength = 120;
  const maxTitleLength = 120;
  let title = typeof source.title === 'string' ? source.title.trim() : '';
  if (!title) title = defaults.title || '';
  if (title.length > maxTitleLength) title = title.slice(0, maxTitleLength);
  let itemsRaw = [];
  if (Array.isArray(source.items)) itemsRaw = source.items;
  else if (typeof source.items === 'string') itemsRaw = source.items.split(/\r?\n/);
  const normalizedItems = [];
  for (const item of itemsRaw) {
    const label = typeof item === 'string'
      ? item.trim()
      : (item && typeof item.label === 'string' ? item.label.trim() : '');
    if (!label) continue;
    const short = label.length > maxLabelLength ? label.slice(0, maxLabelLength) : label;
    if (!normalizedItems.includes(short)) normalizedItems.push(short);
    if (normalizedItems.length >= maxItems) break;
  }
  if (!normalizedItems.length) {
    for (const item of defaults.items || []) {
      if (!item) continue;
      if (!normalizedItems.includes(item)) normalizedItems.push(item);
      if (normalizedItems.length >= maxItems) break;
    }
  }
  return {
    title,
    items: normalizedItems,
  };
}
function normalizeReservationChecklistDefinitions(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const result = {};
  for (const stage of CHECKLIST_STAGE_KEYS) {
    result[stage] = normalizeChecklistDefinitionStage(stage, source[stage]);
  }
  return result;
}
function getReservationChecklistDefinitions() {
  if (!reservationChecklistDefinitions) {
    reservationChecklistDefinitions = normalizeReservationChecklistDefinitions(DEFAULT_RESERVATION_CHECKLIST_DEFINITIONS);
  }
  return cloneChecklistDefinitions(reservationChecklistDefinitions);
}
async function loadReservationChecklistDefinitions() {
  try {
    const settings = await getAppSettings([CHECKLIST_DEFINITION_SETTING_KEY]);
    const raw = settings?.[CHECKLIST_DEFINITION_SETTING_KEY] || '';
    if (raw) {
      const parsed = safeParseJSON(raw, {});
      reservationChecklistDefinitions = normalizeReservationChecklistDefinitions(parsed);
    } else {
      reservationChecklistDefinitions = normalizeReservationChecklistDefinitions(DEFAULT_RESERVATION_CHECKLIST_DEFINITIONS);
    }
  } catch (err) {
    reservationChecklistDefinitions = normalizeReservationChecklistDefinitions(DEFAULT_RESERVATION_CHECKLIST_DEFINITIONS);
    throw err;
  }
  return getReservationChecklistDefinitions();
}
async function persistReservationChecklistDefinitions(definitions = {}) {
  const normalized = normalizeReservationChecklistDefinitions(definitions);
  const defaultNormalized = normalizeReservationChecklistDefinitions(DEFAULT_RESERVATION_CHECKLIST_DEFINITIONS);
  const serialized = JSON.stringify(normalized);
  const defaultSerialized = JSON.stringify(defaultNormalized);
  try {
    if (serialized === defaultSerialized) {
      await deleteAppSetting(CHECKLIST_DEFINITION_SETTING_KEY);
    } else {
      await setAppSetting(CHECKLIST_DEFINITION_SETTING_KEY, serialized);
    }
  } catch (err) {
    console.error('persistReservationChecklistDefinitions error:', err?.message || err);
    throw err;
  }
  reservationChecklistDefinitions = normalized;
  return getReservationChecklistDefinitions();
}
reservationChecklistDefinitions = normalizeReservationChecklistDefinitions(DEFAULT_RESERVATION_CHECKLIST_DEFINITIONS);
const CHECKLIST_ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/jpg'
]);
const MAX_CHECKLIST_IMAGE_BYTES = Number(process.env.CHECKLIST_MAX_IMAGE_BYTES || (8 * 1024 * 1024));
const CHECKLIST_PHOTO_LIMIT = Number(process.env.CHECKLIST_MAX_PHOTO_COUNT || 6);
const CHECKLIST_STORAGE_ROOT = 'checklists';
const EVENT_COVER_STORAGE_ROOT = 'event_covers';
const TICKET_COVER_STORAGE_ROOT = 'ticket_covers';
const PRODUCT_COVER_STORAGE_ROOT = 'product_covers';

function sanitizeStageForPath(stage) {
  const normalized = String(stage || '').toLowerCase();
  return CHECKLIST_STAGES.has(normalized) ? normalized : 'unknown';
}

function sanitizeReservationIdForPath(reservationId) {
  const text = String(reservationId || '').trim();
  return /^\d+$/.test(text) ? text : 'unknown';
}

function sanitizeTicketTypeForPath(type) {
  const text = String(type || '').trim().toLowerCase();
  const sanitized = text.replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return sanitized || 'default';
}

function buildChecklistStoragePath(reservationId, stage, extension, key = null) {
  const reservationFolder = sanitizeReservationIdForPath(reservationId);
  const stageFolder = sanitizeStageForPath(stage);
  const storageKey = key || storage.generateStorageKey(stageFolder);
  const ext = extension ? extension.replace(/^\.+/, '') : 'bin';
  return path.posix.join(
    CHECKLIST_STORAGE_ROOT,
    stageFolder,
    reservationFolder,
    `${storageKey}.${ext}`
  );
}

function buildChecklistPhotoUrl(reservationId, stage, photoId) {
  const reservationFolder = sanitizeReservationIdForPath(reservationId);
  const stageFolder = sanitizeStageForPath(stage);
  const photoKey = String(photoId || '').trim();
  return `/reservations/${reservationFolder}/checklists/${stageFolder}/photos/${photoKey}/raw`;
}

function buildEventCoverStoragePath(eventId, extension) {
  const eventFolder = sanitizeReservationIdForPath(eventId);
  const ext = extension ? extension.replace(/^\.+/, '') : 'bin';
  return path.posix.join(
    EVENT_COVER_STORAGE_ROOT,
    eventFolder,
    `${storage.generateStorageKey('cover')}.${ext}`
  );
}

function buildTicketCoverStoragePath(type, extension) {
  const typeFolder = sanitizeTicketTypeForPath(type);
  const ext = extension ? extension.replace(/^\.+/, '') : 'bin';
  return path.posix.join(
    TICKET_COVER_STORAGE_ROOT,
    typeFolder.substring(0, 64),
    `${storage.generateStorageKey('cover')}.${ext}`
  );
}

function buildProductCoverStoragePath(productId, extension) {
  const productFolder = sanitizeReservationIdForPath(productId);
  const ext = extension ? extension.replace(/^\.+/, '') : 'bin';
  return path.posix.join(
    PRODUCT_COVER_STORAGE_ROOT,
    productFolder,
    `${storage.generateStorageKey('cover')}.${ext}`
  );
}

function parseDataUri(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  const match = /^data:([^;]+);base64,(.+)$/i.exec(trimmed);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const base64 = match[2];
  try {
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) return null;
    return { mime, buffer };
  } catch {
    return null;
  }
}

const CHECKLIST_COLUMN_BY_STAGE = {
  pre_dropoff: 'pre_dropoff_checklist',
  pre_pickup: 'pre_pickup_checklist',
  post_dropoff: 'post_dropoff_checklist',
  post_pickup: 'post_pickup_checklist',
};

function checklistColumnByStage(stage) {
  return CHECKLIST_COLUMN_BY_STAGE[stage] || null;
}

function normalizeChecklist(raw) {
  const base = safeParseJSON(raw, {});
  const items = Array.isArray(base.items) ? base.items : [];
  const normalizedItems = items.map(item => {
    if (!item) return null;
    if (typeof item === 'string') return { label: item, checked: true };
    const label = typeof item.label === 'string' ? item.label : '';
    if (!label) return null;
    return { label, checked: !!item.checked };
  }).filter(Boolean);
  const completed = !!base.completed;
  const completedAt = base.completedAt || null;
  return { items: normalizedItems, completed, completedAt };
}

function encodePhotoToDataUrl(mime, buffer) {
  const safeMime = mime && typeof mime === 'string' ? mime : 'application/octet-stream';
  const base64 = Buffer.isBuffer(buffer) ? buffer.toString('base64') : '';
  return `data:${safeMime};base64,${base64}`;
}

async function listChecklistPhotos(reservationId) {
  const map = {};
  for (const stage of CHECKLIST_STAGE_KEYS) map[stage] = [];
  const [rows] = await pool.query(
    `SELECT id, reservation_id, stage, mime, original_name, size, storage_path, checksum, data, created_at
       FROM reservation_checklist_photos
      WHERE reservation_id = ?
      ORDER BY id`,
    [reservationId]
  );
  for (const row of rows) {
    if (!map[row.stage]) continue;
    const hasStoragePath = checklistPhotosHaveStoragePath && !!row.storage_path;
    const normalizedPath = hasStoragePath ? storage.normalizeRelativePath(row.storage_path) : null;
    const payload = {
      id: row.id,
      reservationId: row.reservation_id,
      stage: row.stage,
      mime: row.mime,
      originalName: row.original_name,
      size: row.size,
      uploadedAt: row.created_at,
      storagePath: normalizedPath,
      checksum: row.checksum || null,
      url: hasStoragePath
        ? buildChecklistPhotoUrl(row.reservation_id, row.stage, row.id)
        : (row.data ? encodePhotoToDataUrl(row.mime, row.data) : null),
      legacy: !hasStoragePath
    };
    map[row.stage].push(payload);
  }
  return map;
}

async function listChecklistPhotosBulk(reservationIds, { includeData = true } = {}) {
  const ids = Array.isArray(reservationIds) ? reservationIds : [];
  const stringIds = Array.from(new Set(ids.map((id) => {
    if (id === null || id === undefined) return null;
    if (typeof id === 'bigint') return id.toString();
    const text = String(id).trim();
    return /^\d+$/.test(text) ? text : null;
  }).filter(Boolean)));
  if (!stringIds.length) return new Map();

  if (!includeData) {
    const placeholders = stringIds.map(() => '?').join(',');
    const sql = `SELECT reservation_id, stage, COUNT(*) AS cnt
                   FROM reservation_checklist_photos
                  WHERE reservation_id IN (${placeholders})
                  GROUP BY reservation_id, stage`;
    const [rows] = await pool.query(sql, stringIds);
    const map = new Map();
    const ensureEntry = (reservationId) => {
      if (!map.has(reservationId)) {
        const stageMap = {};
        for (const stage of CHECKLIST_STAGE_KEYS) stageMap[stage] = 0;
        map.set(reservationId, stageMap);
      }
      return map.get(reservationId);
    };
    for (const id of stringIds) ensureEntry(id);
    for (const row of rows) {
      const reservationId = row.reservation_id == null ? null : String(row.reservation_id);
      if (!reservationId) continue;
      const stageMap = ensureEntry(reservationId);
      stageMap[row.stage] = Number(row.cnt || 0);
    }
    return map;
  }

  const placeholders = stringIds.map(() => '?').join(',');
  const sql = `SELECT reservation_id, id, stage, mime, original_name, size, storage_path, checksum, data, created_at
                 FROM reservation_checklist_photos
                WHERE reservation_id IN (${placeholders})
                ORDER BY reservation_id, id`;
  const [rows] = await pool.query(sql, stringIds);
  const map = new Map();
  const ensureEntry = (reservationId) => {
    if (!map.has(reservationId)) {
      const stageMap = {};
      for (const stage of CHECKLIST_STAGE_KEYS) stageMap[stage] = [];
      map.set(reservationId, stageMap);
    }
    return map.get(reservationId);
  };
  for (const id of stringIds) ensureEntry(String(id));
  for (const row of rows) {
    const reservationId = row.reservation_id == null ? null : String(row.reservation_id);
    if (!reservationId) continue;
    const stageMap = ensureEntry(reservationId);
    if (!stageMap[row.stage]) continue;
    const hasStoragePath = checklistPhotosHaveStoragePath && !!row.storage_path;
    const normalizedPath = hasStoragePath ? storage.normalizeRelativePath(row.storage_path) : null;
    stageMap[row.stage].push({
      id: row.id,
      reservationId: row.reservation_id,
      stage: row.stage,
      mime: row.mime,
      originalName: row.original_name,
      size: row.size,
      uploadedAt: row.created_at,
      storagePath: normalizedPath,
      checksum: row.checksum || null,
      url: hasStoragePath
        ? buildChecklistPhotoUrl(row.reservation_id, row.stage, row.id)
        : (row.data ? encodePhotoToDataUrl(row.mime, row.data) : null),
      legacy: !hasStoragePath
    });
  }
  return map;
}

const ensureChecklistHasPhotos = (checklist) => {
  if (!checklist) return false;
  if (typeof checklist.photoCount === 'number') return checklist.photoCount > 0;
  return Array.isArray(checklist.photos) && checklist.photos.length > 0;
};

function isChecklistStage(stage) {
  return CHECKLIST_STAGES.has(stage);
}

async function fetchReservationById(reservationId) {
  const [rows] = await pool.query('SELECT * FROM reservations WHERE id = ? LIMIT 1', [reservationId]);
  return rows && rows.length ? rows[0] : null;
}

async function isReservationAssignedDriver(reservation, reqUser) {
  const driverId = normalizeUserId(reqUser?.id);
  if (!driverId || !isDRIVER(reqUser?.role)) return false;
  if (String(normalizeUserId(reservation?.driver_id) || '') === String(driverId)) return true;

  const reservationId = normalizePositiveInt(reservation?.id);
  if (!reservationId) return false;
  try {
    await ensureReservationTasksTable();
    const [rows] = await pool.query(
      `SELECT id
         FROM reservation_tasks
        WHERE reservation_id = ?
          AND assignee_user_id = ?
          AND UPPER(assignee_role) = 'DRIVER'
          AND UPPER(COALESCE(status, 'OPEN')) <> 'CANCELLED'
        LIMIT 1`,
      [reservationId, driverId]
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE' || err?.code === 'ER_BAD_FIELD_ERROR') return false;
    throw err;
  }
}

async function ensureChecklistReservationAccess(reservationId, reqUser) {
  const reservation = await fetchReservationById(reservationId);
  if (!reservation) {
    return { ok: false, status: 404, code: 'RESERVATION_NOT_FOUND', message: '找不到預約' };
  }
  if (!reqUser || !reqUser.id) {
    return { ok: false, status: 401, code: 'AUTH_REQUIRED', message: '請先登入' };
  }
  const isOwner = String(reservation.user_id) === String(reqUser.id);
  let isDeliveryPointOwner = false;
  if (!isOwner && isDELIVERY_POINT(reqUser.role)) {
    const ownDeliveryPointId = await getDeliveryPointIdByUserId(reqUser.id);
    isDeliveryPointOwner = !!ownDeliveryPointId
      && ownDeliveryPointId === normalizePositiveInt(reservation.delivery_point_id);
  }
  const isAssignedDriver = !isOwner ? await isReservationAssignedDriver(reservation, reqUser) : false;
  const isStaff = isADMIN(reqUser.role) || isSTORE(reqUser.role) || isDeliveryPointOwner || isAssignedDriver;
  if (!isOwner && !isStaff) {
    return { ok: false, status: 403, code: 'FORBIDDEN', message: '無權限操作此預約' };
  }
  return { ok: true, reservation, isOwner, isStaff, isDeliveryPointOwner, isAssignedDriver };
}

function mergeChecklistWithPhotos(rawChecklist, photos, photoCountInput = null) {
  const list = Array.isArray(photos) ? photos : [];
  const photoCount = photoCountInput != null ? Number(photoCountInput) : list.length;
  return {
    items: Array.isArray(rawChecklist.items) ? rawChecklist.items : [],
    completed: !!rawChecklist.completed,
    completedAt: rawChecklist.completedAt || null,
    photos: list,
    photoCount: Number.isFinite(photoCount) ? Math.max(0, photoCount) : list.length,
  };
}

async function hydrateReservationChecklists(reservation, preloadedPhotoMap = null, options = {}) {
  const { includePhotos = true } = options;
  const reservationIdRaw = reservation?.id;
  const reservationIdKey = reservationIdRaw == null ? null : String(reservationIdRaw);
  let photoMap = null;
  if (preloadedPhotoMap && reservationIdKey && preloadedPhotoMap.has(reservationIdKey)) {
    photoMap = preloadedPhotoMap.get(reservationIdKey);
  } else if (reservationIdRaw != null) {
    photoMap = includePhotos ? await listChecklistPhotos(reservationIdRaw) : null;
  } else {
    photoMap = {};
    for (const stage of CHECKLIST_STAGE_KEYS) photoMap[stage] = [];
  }
  if (!photoMap) {
    photoMap = {};
    for (const stage of CHECKLIST_STAGE_KEYS) photoMap[stage] = [];
  }
  const result = {};
  for (const stage of CHECKLIST_STAGE_KEYS) {
    const column = checklistColumnByStage(stage);
    const raw = column ? normalizeChecklist(reservation[column]) : normalizeChecklist({});
    const entry = photoMap ? photoMap[stage] : null;
    let photos = [];
    let photoCount = 0;
    if (Array.isArray(entry)) {
      photos = includePhotos ? entry : [];
      photoCount = entry.length;
    } else if (entry && typeof entry === 'object' && Array.isArray(entry.photos)) {
      photos = includePhotos ? entry.photos : [];
      photoCount = Array.isArray(entry.photos) ? entry.photos.length : 0;
    } else if (typeof entry === 'number') {
      photoCount = entry;
    }
    result[stage] = mergeChecklistWithPhotos(raw, includePhotos ? photos : [], photoCount);
  }
  return result;
}

function reservationIdToKey(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  const text = String(value).trim();
  return /^\d+$/.test(text) ? text : null;
}

async function buildAdminReservationSummaries(rows, { includePhotos = false } = {}) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const keys = rows
    .map((row) => reservationIdToKey(row?.id))
    .filter(Boolean);
  const photoMap = keys.length
    ? await listChecklistPhotosBulk(keys, { includeData: includePhotos })
    : new Map();
  return rows.map((row) => {
    const key = reservationIdToKey(row?.id);
    const stagePhotos = (key && photoMap.has(key)) ? photoMap.get(key) : null;
    return formatAdminReservationRow(row, stagePhotos, { includePhotos });
  });
}

function formatAdminReservationRow(row, stagePhotos = null, { includePhotos = false } = {}) {
  const stageChecklist = {};
  const checklists = {};
  const stagePhotoInfo = stagePhotos || {};
  for (const stage of CHECKLIST_STAGE_KEYS) {
    const column = checklistColumnByStage(stage);
    const rawChecklist = column ? normalizeChecklist(row[column]) : normalizeChecklist({});
    const entry = stagePhotoInfo ? stagePhotoInfo[stage] : null;
    let photos = [];
    let photoCount = 0;
    if (Array.isArray(entry)) {
      photos = includePhotos ? entry : [];
      photoCount = entry.length;
    } else if (entry && typeof entry === 'object') {
      if (Array.isArray(entry.photos)) {
        photos = includePhotos ? entry.photos : [];
        photoCount = entry.photos.length;
      } else if (typeof entry.count === 'number') {
        photoCount = entry.count;
      }
    } else if (typeof entry === 'number') {
      photoCount = entry;
    }
    const merged = mergeChecklistWithPhotos(rawChecklist, includePhotos ? photos : [], photoCount);
    checklists[stage] = merged;
    stageChecklist[stage] = {
      found: merged.photoCount > 0,
      completed: !!merged.completed,
      photoCount: merged.photoCount,
    };
  }
  const payload = {
    id: row.id,
    user_id: row.user_id,
    username: row.username || '',
    email: row.email || '',
    driver_id: row.driver_id || null,
    driver_username: row.driver_username || '',
    driver_email: row.driver_email || '',
    delivery_point_id: row.delivery_point_id || null,
    delivery_point_name: row.delivery_point_name || '',
    ticket_type: row.ticket_type,
    store: row.store,
    store_address: row.store_address || null,
    event: row.event,
    event_address: row.event_address || null,
    reserved_at: row.reserved_at,
    status: row.status,
    verify_code: row.verify_code || null,
    verify_code_pre_dropoff: row.verify_code_pre_dropoff || null,
    verify_code_pre_pickup: row.verify_code_pre_pickup || null,
    verify_code_post_dropoff: row.verify_code_post_dropoff || null,
    verify_code_post_pickup: row.verify_code_post_pickup || null,
    pre_dropoff_checklist: checklists.pre_dropoff,
    pre_pickup_checklist: checklists.pre_pickup,
    post_dropoff_checklist: checklists.post_dropoff,
    post_pickup_checklist: checklists.post_pickup,
    stage_checklist: stageChecklist,
    checklists,
    task_id: row.task_id || null,
    task_status: row.task_status || null,
    task_stage: row.task_stage || null,
    task_store_id: row.task_store_id || null,
    task_completed_at: row.task_completed_at || null,
  };
  return payload;
}

const CART_ITEM_LIMIT = 200;
function normalizeCartItems(input) {
  const list = Array.isArray(input) ? input : [];
  const normalized = [];
  for (const raw of list) {
    if (!raw) continue;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) continue;
    const quantityNum = Number(raw.quantity);
    const quantity = Number.isFinite(quantityNum) ? Math.max(1, Math.min(999, Math.floor(quantityNum))) : 1;
    const priceNum = Number(raw.price);
    const price = Number.isFinite(priceNum) ? Math.max(0, Math.round(priceNum * 100) / 100) : 0;
    const item = { name: name.slice(0, 160), price, quantity };
    if (raw.id !== undefined) item.id = raw.id;
    if (raw.cover) item.cover = String(raw.cover);
    if (raw.sku) item.sku = String(raw.sku).slice(0, 120);
    normalized.push(item);
    if (normalized.length >= CART_ITEM_LIMIT) break;
  }
  return normalized;
}

async function ensureAppSettingsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`key\` VARCHAR(64) NOT NULL,
      \`value\` TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_app_settings_key (\`key\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

function getRemittanceConfig() {
  return { ...remittanceConfig };
}

async function loadRemittanceConfig() {
  try {
    const keys = Object.values(REMITTANCE_SETTING_KEYS);
    if (!keys.length) return getRemittanceConfig();
    const map = await getAppSettings(keys);
    const next = { ...REMITTANCE_ENV_DEFAULTS };
    for (const [field, settingKey] of Object.entries(REMITTANCE_SETTING_KEYS)) {
      const value = (map?.[settingKey] || '').trim();
      if (value) next[field] = value;
    }
    remittanceConfig = next;
  } catch (err) {
    // Keep existing config if loading fails
    throw err;
  }
  return getRemittanceConfig();
}

async function setAppSetting(key, value) {
  await ensureAppSettingsTable();
  await pool.query(
    'INSERT INTO app_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), updated_at = CURRENT_TIMESTAMP',
    [key, value]
  );
}

async function deleteAppSetting(key) {
  await ensureAppSettingsTable();
  await pool.query('DELETE FROM app_settings WHERE `key` = ? LIMIT 1', [key]);
}

async function getAppSettings(keys = []) {
  if (!Array.isArray(keys) || !keys.length) return {};
  try {
    await ensureAppSettingsTable();
    const [rows] = await pool.query('SELECT `key`, `value` FROM app_settings WHERE `key` IN (?)', [keys]);
    const map = {};
    for (const key of keys) map[key] = '';
    for (const row of rows) {
      map[row.key] = row.value == null ? '' : String(row.value);
    }
    return map;
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE') {
      return keys.reduce((acc, key) => { acc[key] = ''; return acc; }, {});
    }
    throw err;
  }
}

function isValidEmailAddress(value = '') {
  const email = normalizeEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseEmailRecipientValues(value) {
  const raw = Array.isArray(value)
    ? value.flatMap((item) => String(item || '').split(/[\s,;，；]+/))
    : String(value || '').split(/[\s,;，；]+/);
  const emails = [];
  const invalidEmails = [];
  const seen = new Set();
  for (const item of raw) {
    const original = String(item || '').trim();
    if (!original) continue;
    const email = normalizeEmail(original);
    if (!isValidEmailAddress(email)) {
      invalidEmails.push(original);
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }
  return { emails, invalidEmails };
}

function normalizeOrderEmailCcConfig(input = {}, options = {}) {
  const source = typeof input === 'string'
    ? safeParseJSON(input, {})
    : (input && typeof input === 'object' ? input : {});
  const emailInput = source.emails ?? source.emailAddresses ?? source.addresses ?? '';
  const parsedEmails = parseEmailRecipientValues(emailInput);
  if (options.strict && parsedEmails.invalidEmails.length) {
    const err = new Error(`Email 格式不正確：${parsedEmails.invalidEmails.join(', ')}`);
    err.code = 'ORDER_EMAIL_CC_INVALID_EMAIL';
    err.invalidEmails = parsedEmails.invalidEmails;
    throw err;
  }

  const rawUserIds = Array.isArray(source.userIds)
    ? source.userIds
    : (Array.isArray(source.accountIds) ? source.accountIds : (Array.isArray(source.users) ? source.users : []));
  const userIds = [];
  const seenUserIds = new Set();
  for (const raw of rawUserIds) {
    const id = normalizeUserId(raw && typeof raw === 'object' ? (raw.id ?? raw.userId ?? raw.user_id) : raw);
    if (!id || seenUserIds.has(id)) continue;
    seenUserIds.add(id);
    userIds.push(id);
  }

  return {
    emails: parsedEmails.emails.slice(0, 100),
    userIds: userIds.slice(0, 100),
  };
}

async function fetchOrderEmailCcUsers(userIds = []) {
  const ids = Array.from(new Set((Array.isArray(userIds) ? userIds : [])
    .map((id) => normalizeUserId(id))
    .filter(Boolean)));
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT id, username, email, role
       FROM users
      WHERE id IN (${placeholders})`,
    ids
  );
  const byId = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.id), {
    id: String(row.id),
    username: row.username || '',
    email: row.email || '',
    role: normalizeRole(row.role || 'USER'),
  }]));
  return ids.map((id) => byId.get(String(id))).filter(Boolean);
}

async function getOrderEmailCcConfig(options = {}) {
  const map = await getAppSettings([ORDER_EMAIL_CC_SETTING_KEY]);
  const config = normalizeOrderEmailCcConfig(map[ORDER_EMAIL_CC_SETTING_KEY] || {});
  if (options.includeUsers) {
    return {
      ...config,
      users: await fetchOrderEmailCcUsers(config.userIds),
    };
  }
  return config;
}

async function saveOrderEmailCcConfig(input = {}) {
  const config = normalizeOrderEmailCcConfig(input, { strict: true });
  const users = await fetchOrderEmailCcUsers(config.userIds);
  const foundIds = new Set(users.map((user) => String(user.id)));
  const missingUserIds = config.userIds.filter((id) => !foundIds.has(String(id)));
  if (missingUserIds.length) {
    const err = new Error(`找不到指定帳號：${missingUserIds.join(', ')}`);
    err.code = 'ORDER_EMAIL_CC_USER_NOT_FOUND';
    err.missingUserIds = missingUserIds;
    throw err;
  }

  if (config.emails.length || config.userIds.length) {
    await setAppSetting(ORDER_EMAIL_CC_SETTING_KEY, JSON.stringify({
      emails: config.emails,
      userIds: config.userIds,
    }));
  } else {
    await deleteAppSetting(ORDER_EMAIL_CC_SETTING_KEY);
  }
  return { ...config, users };
}

async function resolveOrderEmailCcRecipients(primaryEmail = '', extraCc = []) {
  const recipients = new Set();
  const appendEmail = (value) => {
    const email = normalizeEmail(value);
    if (email && isValidEmailAddress(email)) recipients.add(email);
  };

  parseEmailRecipientValues(extraCc).emails.forEach(appendEmail);
  const config = await getOrderEmailCcConfig({ includeUsers: true });
  config.emails.forEach(appendEmail);
  for (const user of config.users || []) appendEmail(user.email);

  const primary = normalizeEmail(primaryEmail);
  if (primary) recipients.delete(primary);
  return Array.from(recipients);
}

async function getSitePages() {
  const map = await getAppSettings(Object.values(SITE_PAGE_KEYS));
  return {
    terms: map[SITE_PAGE_KEYS.terms] || '',
    privacy: map[SITE_PAGE_KEYS.privacy] || '',
    reservationNotice: map[SITE_PAGE_KEYS.reservationNotice] || '',
    reservationRules: map[SITE_PAGE_KEYS.reservationRules] || '',
    insuranceTermsUrl: map[SITE_PAGE_KEYS.insuranceTermsUrl] || '',
    socialLinks: normalizeSiteSocialLinks(map[SITE_PAGE_KEYS.socialLinks] || []),
  };
}

function normalizeSiteSocialUrl(value = '', limit = 1000) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  const limited = text.length > limit ? text.slice(0, limit) : text;
  try {
    const parsed = new URL(limited);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch (_) {
    return '';
  }
}

function inferSocialLabelFromUrl(url = '') {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, '');
    if (!hostname) return '社群連結';
    const first = hostname.split('.')[0] || hostname;
    return first ? first.charAt(0).toUpperCase() + first.slice(1) : '社群連結';
  } catch (_) {
    return '社群連結';
  }
}

function normalizeSiteSocialLinks(input = []) {
  let list = input;
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.links) ? parsed.links : []);
    } catch (_) {
      list = [];
    }
  } else if (input && typeof input === 'object' && !Array.isArray(input)) {
    list = Array.isArray(input.links) ? input.links : [];
  }
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const result = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const url = normalizeSiteSocialUrl(item.url || item.href || '');
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const rawLabel = String(item.label || item.name || item.platform || '').trim();
    const label = (rawLabel || inferSocialLabelFromUrl(url)).slice(0, 40);
    result.push({ label, url });
    if (result.length >= 8) break;
  }
  return result;
}

function normalizeRemittanceText(value, limit = 255) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  return text.length > limit ? text.slice(0, limit) : text;
}

function normalizeRemittanceDetails(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    info: normalizeRemittanceText(source.info, REMITTANCE_FIELD_LIMITS.info),
    bankCode: normalizeRemittanceText(source.bankCode, REMITTANCE_FIELD_LIMITS.bankCode),
    bankAccount: normalizeRemittanceText(source.bankAccount, REMITTANCE_FIELD_LIMITS.bankAccount),
    accountName: normalizeRemittanceText(source.accountName, REMITTANCE_FIELD_LIMITS.accountName),
    bankName: normalizeRemittanceText(source.bankName, REMITTANCE_FIELD_LIMITS.bankName),
  };
}

function hasRemittanceDetails(input = {}) {
  return Object.values(normalizeRemittanceDetails(input)).some(Boolean);
}

function mergeRemittanceDetails(primary = {}, fallback = {}) {
  const base = normalizeRemittanceDetails(fallback);
  const override = normalizeRemittanceDetails(primary);
  const merged = {};
  Object.keys(REMITTANCE_FIELD_LIMITS).forEach((key) => {
    merged[key] = override[key] || base[key] || '';
  });
  return merged;
}

function remittanceDetailsFromLegacyFields(details = {}) {
  return normalizeRemittanceDetails({
    info: details?.remittance?.info || details?.bankInfo || '',
    bankCode: details?.remittance?.bankCode || details?.bankCode || '',
    bankAccount: details?.remittance?.bankAccount || details?.bankAccount || '',
    accountName: details?.remittance?.accountName || details?.bankAccountName || '',
    bankName: details?.remittance?.bankName || details?.bankName || '',
  });
}

function applyRemittanceDetails(details = {}, input = {}) {
  const next = normalizeRemittanceDetails(input);
  details.remittance = next;
  if (next.info) details.bankInfo = next.info;
  else delete details.bankInfo;
  if (next.bankCode) details.bankCode = next.bankCode;
  else delete details.bankCode;
  if (next.bankAccount) details.bankAccount = next.bankAccount;
  else delete details.bankAccount;
  if (next.accountName) details.bankAccountName = next.accountName;
  else delete details.bankAccountName;
  if (next.bankName) details.bankName = next.bankName;
  else delete details.bankName;
  return details;
}

function defaultRemittanceDetails() {
  return getRemittanceConfig();
}

function ensureRemittance(details = {}) {
  if (!details || typeof details !== 'object') return details || {};
  return applyRemittanceDetails(details, remittanceDetailsFromLegacyFields(details));
}

async function detectUserRemittanceColumns() {
  try {
    const [rows] = await pool.query("SHOW COLUMNS FROM users LIKE 'remittance_info'");
    usersHaveRemittanceColumns = Array.isArray(rows) && rows.length > 0;
  } catch (err) {
    console.warn('detectUserRemittanceColumns error:', err?.message || err);
    usersHaveRemittanceColumns = false;
  }
}

async function detectUserServiceTermsColumn() {
  try {
    const [rows] = await pool.query(`SHOW COLUMNS FROM users LIKE '${USER_SERVICE_TERMS_COLUMN}'`);
    usersHaveServiceTermsColumn = Array.isArray(rows) && rows.length > 0;
  } catch (err) {
    console.warn('detectUserServiceTermsColumn error:', err?.message || err);
    usersHaveServiceTermsColumn = false;
  }
}

async function detectEventStoreRemittanceColumns() {
  try {
    const [rows] = await pool.query("SHOW COLUMNS FROM event_stores LIKE 'remittance_info'");
    eventStoresHaveRemittanceColumns = Array.isArray(rows) && rows.length > 0;
  } catch (err) {
    console.warn('detectEventStoreRemittanceColumns error:', err?.message || err);
    eventStoresHaveRemittanceColumns = false;
  }
}

async function ensureUserRemittanceColumns() {
  await detectUserRemittanceColumns();
  if (usersHaveRemittanceColumns) return;
  for (const [columnName, definition] of USER_REMITTANCE_COLUMN_DEFINITIONS) {
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN ${columnName} ${definition}`);
    } catch (err) {
      if (!['ER_DUP_FIELDNAME', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(err?.code)) {
        console.warn(`ensureUserRemittanceColumns ${columnName} error:`, err?.message || err);
      }
    }
  }
  await detectUserRemittanceColumns();
}

async function ensureUserServiceTermsColumn() {
  await detectUserServiceTermsColumn();
  if (usersHaveServiceTermsColumn) return;
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN ${USER_SERVICE_TERMS_COLUMN} MEDIUMTEXT NULL AFTER remittance_bank_name`);
  } catch (err) {
    if (err?.code === 'ER_BAD_FIELD_ERROR') {
      try {
        await pool.query(`ALTER TABLE users ADD COLUMN ${USER_SERVICE_TERMS_COLUMN} MEDIUMTEXT NULL AFTER role`);
      } catch (fallbackErr) {
        if (!['ER_DUP_FIELDNAME', 'ER_NO_SUCH_TABLE'].includes(fallbackErr?.code)) {
          console.warn('ensureUserServiceTermsColumn fallback error:', fallbackErr?.message || fallbackErr);
        }
      }
    } else if (!['ER_DUP_FIELDNAME', 'ER_NO_SUCH_TABLE'].includes(err?.code)) {
      console.warn('ensureUserServiceTermsColumn error:', err?.message || err);
    }
  }
  await detectUserServiceTermsColumn();
}

async function ensureEventStoreRemittanceColumns() {
  await detectEventStoreRemittanceColumns();
  if (eventStoresHaveRemittanceColumns) return;
  for (const [columnName, definition] of EVENT_STORE_REMITTANCE_COLUMN_DEFINITIONS) {
    try {
      await pool.query(`ALTER TABLE event_stores ADD COLUMN ${columnName} ${definition}`);
    } catch (err) {
      if (!['ER_DUP_FIELDNAME', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(err?.code)) {
        console.warn(`ensureEventStoreRemittanceColumns ${columnName} error:`, err?.message || err);
      }
    }
  }
  await detectEventStoreRemittanceColumns();
}

async function ensureRemittanceColumns() {
  await Promise.all([
    ensureUserRemittanceColumns(),
    ensureEventStoreRemittanceColumns(),
  ]);
}

ensureUserServiceTermsColumn().catch((err) => {
  console.error('ensureUserServiceTermsColumn error:', err?.message || err);
});

function remittanceDetailsFromColumns(row = {}) {
  return normalizeRemittanceDetails({
    info: row?.remittance_info || '',
    bankCode: row?.remittance_bank_code || '',
    bankAccount: row?.remittance_bank_account || '',
    accountName: row?.remittance_account_name || '',
    bankName: row?.remittance_bank_name || '',
  });
}

async function getProviderRemittanceConfig(userId) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return normalizeRemittanceDetails();
  await ensureUserRemittanceColumns();
  try {
    const [rows] = await pool.query(
      'SELECT remittance_info, remittance_bank_code, remittance_bank_account, remittance_account_name, remittance_bank_name FROM users WHERE id = ? LIMIT 1',
      [normalizedUserId]
    );
    if (!rows.length) return normalizeRemittanceDetails();
    return remittanceDetailsFromColumns(rows[0]);
  } catch (err) {
    if (err?.code === 'ER_BAD_FIELD_ERROR') return normalizeRemittanceDetails();
    throw err;
  }
}

async function saveProviderRemittanceConfig(userId, input = {}) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    const err = new Error('找不到服務商帳號');
    err.code = 'PROVIDER_NOT_FOUND';
    throw err;
  }
  await ensureUserRemittanceColumns();
  const remittance = normalizeRemittanceDetails(input);
  const [result] = await pool.query(
    `UPDATE users
        SET remittance_info = ?,
            remittance_bank_code = ?,
            remittance_bank_account = ?,
            remittance_account_name = ?,
            remittance_bank_name = ?
      WHERE id = ?`,
    [
      remittance.info || null,
      remittance.bankCode || null,
      remittance.bankAccount || null,
      remittance.accountName || null,
      remittance.bankName || null,
      normalizedUserId,
    ]
  );
  if (!result?.affectedRows) {
    const err = new Error('找不到服務商帳號');
    err.code = 'PROVIDER_NOT_FOUND';
    throw err;
  }
  return getProviderRemittanceConfig(normalizedUserId);
}

function normalizeProviderServiceTerms(value = '', limit = USER_SERVICE_TERMS_LIMIT) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  return text.length > limit ? text.slice(0, limit) : text;
}

function mapProviderServiceTermsRow(row = {}) {
  const id = normalizeUserId(row.id);
  return {
    id,
    name: String(row.username || '').trim() || (id ? `服務商 ${id.slice(0, 8)}` : '服務商'),
    content: normalizeProviderServiceTerms(row.service_terms || ''),
    updated_at: row.updated_at || null,
  };
}

async function getProviderServiceTerms(userId) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return mapProviderServiceTermsRow({});
  await ensureUserServiceTermsColumn();
  try {
    const [rows] = await pool.query(
      `SELECT id, username, ${USER_SERVICE_TERMS_COLUMN}, updated_at FROM users WHERE id = ? LIMIT 1`,
      [normalizedUserId]
    );
    if (!rows.length) return mapProviderServiceTermsRow({ id: normalizedUserId });
    return mapProviderServiceTermsRow(rows[0]);
  } catch (err) {
    if (err?.code === 'ER_BAD_FIELD_ERROR') return mapProviderServiceTermsRow({ id: normalizedUserId });
    throw err;
  }
}

async function saveProviderServiceTerms(userId, value = '') {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    const err = new Error('找不到服務商帳號');
    err.code = 'PROVIDER_NOT_FOUND';
    throw err;
  }
  await ensureUserServiceTermsColumn();
  const terms = normalizeProviderServiceTerms(value);
  const [result] = await pool.query(
    `UPDATE users SET ${USER_SERVICE_TERMS_COLUMN} = ? WHERE id = ?`,
    [terms || null, normalizedUserId]
  );
  if (!result?.affectedRows) {
    const err = new Error('找不到服務商帳號');
    err.code = 'PROVIDER_NOT_FOUND';
    throw err;
  }
  return getProviderServiceTerms(normalizedUserId);
}

async function listProviderServiceTerms() {
  await ensureUserServiceTermsColumn();
  try {
    const [rows] = await pool.query(
      `SELECT id, username, ${USER_SERVICE_TERMS_COLUMN}, updated_at
         FROM users
        WHERE UPPER(role) IN ('SERVICE_PROVIDER', 'STORE', 'COACH')
          AND ${USER_SERVICE_TERMS_COLUMN} IS NOT NULL
          AND TRIM(${USER_SERVICE_TERMS_COLUMN}) <> ''
        ORDER BY username ASC, id ASC`
    );
    return (Array.isArray(rows) ? rows : []).map(mapProviderServiceTermsRow).filter((item) => item.content);
  } catch (err) {
    if (err?.code === 'ER_BAD_FIELD_ERROR') return [];
    throw err;
  }
}

function extractSelectionStoreIds(details = {}) {
  const selections = Array.isArray(details?.selections) ? details.selections : [];
  return Array.from(new Set(
    selections
      .map((selection) => normalizePositiveInt(selection?.storeId ?? selection?.store_id ?? selection?.storeID))
      .filter((id) => Number.isFinite(id) && id > 0)
  ));
}

function extractReservationEventId(details = {}) {
  return normalizePositiveInt(details?.event?.id ?? details?.event_id ?? details?.eventId);
}

async function resolveOrderRemittance(details = {}) {
  const base = ensureRemittance(details);
  if (hasRemittanceDetails(base.remittance)) {
    return {
      remittance: normalizeRemittanceDetails(base.remittance),
      multiple: false,
      missingStoreIds: [],
      missingConfigStoreIds: [],
      missingConfigProductIds: [],
      storeIds: extractSelectionStoreIds(base),
      items: [],
      source: 'order',
    };
  }

  const adminRemittance = normalizeRemittanceDetails(defaultRemittanceDetails());
  const hasAdminRemittance = hasRemittanceDetails(adminRemittance);
  const storeIds = extractSelectionStoreIds(base);
  const reservationEventId = extractReservationEventId(base);
  if (reservationEventId && !storeIds.length) {
    const [eventRows] = await pool.query('SELECT owner_user_id FROM events WHERE id = ? LIMIT 1', [reservationEventId]);
    const ownerUserId = normalizeUserId(eventRows?.[0]?.owner_user_id);
    if (ownerUserId) {
      const resolution = await getProviderRemittanceConfig(ownerUserId);
      if (hasRemittanceDetails(resolution)) {
        const remittance = normalizeRemittanceDetails(resolution);
        return {
          remittance,
          multiple: false,
          missingStoreIds: [],
          missingConfigStoreIds: [],
          missingConfigProductIds: [],
          storeIds: extractSelectionStoreIds(base),
          items: [{ eventId: reservationEventId, providerId: ownerUserId, remittance, source: 'event-owner' }],
          source: 'event-owner',
        };
      }
      if (hasAdminRemittance) {
        return {
          remittance: adminRemittance,
          multiple: false,
          missingStoreIds: [],
          missingConfigStoreIds: [],
          missingConfigProductIds: [],
          storeIds: extractSelectionStoreIds(base),
          items: [{ eventId: reservationEventId, providerId: ownerUserId, remittance: adminRemittance, source: 'admin-fallback' }],
          source: 'admin',
        };
      }
      return {
        remittance: normalizeRemittanceDetails(),
        multiple: false,
        missingStoreIds: [],
        missingConfigStoreIds: [reservationEventId],
        missingConfigProductIds: [],
        storeIds: extractSelectionStoreIds(base),
        items: [{ eventId: reservationEventId, providerId: ownerUserId, remittance: normalizeRemittanceDetails(), source: 'event-owner' }],
        source: 'event-owner',
      };
    }
  }

  const productId = normalizePositiveInt(base.productId ?? base.product_id ?? base.product?.id);
  if (productId) {
    try {
      await ensureProductManagementSchema();
      const [productRows] = await pool.query('SELECT id, owner_user_id FROM products WHERE id = ? LIMIT 1', [productId]);
      const product = productRows?.[0] || null;
      const ownerUserId = normalizeUserId(product?.owner_user_id);
      if (ownerUserId) {
        const resolution = await getProviderRemittanceConfig(ownerUserId);
        if (hasRemittanceDetails(resolution)) {
          const remittance = normalizeRemittanceDetails(resolution);
          return {
            remittance,
            multiple: false,
            missingStoreIds: [],
            missingConfigStoreIds: [],
            missingConfigProductIds: [],
            storeIds: [],
            productIds: [productId],
            items: [{ productId, providerId: ownerUserId, remittance, source: 'product-owner' }],
            source: 'product-owner',
          };
        }
        if (hasAdminRemittance) {
          return {
            remittance: adminRemittance,
            multiple: false,
            missingStoreIds: [],
            missingConfigStoreIds: [],
            missingConfigProductIds: [],
            storeIds: [],
            productIds: [productId],
            items: [{ productId, providerId: ownerUserId, remittance: adminRemittance, source: 'admin-fallback' }],
            source: 'admin',
          };
        }
        return {
          remittance: normalizeRemittanceDetails(),
          multiple: false,
          missingStoreIds: [],
          missingConfigStoreIds: [],
          missingConfigProductIds: [productId],
          storeIds: [],
          productIds: [productId],
          items: [{ productId, providerId: ownerUserId, remittance: normalizeRemittanceDetails(), source: 'product-owner' }],
          source: 'product-owner',
        };
      }
    } catch (err) {
      if (err?.code !== 'ER_NO_SUCH_TABLE' && err?.code !== 'ER_BAD_FIELD_ERROR') throw err;
    }
  }

  if (!storeIds.length) {
    return {
      remittance: normalizeRemittanceDetails(base.remittance),
      multiple: false,
      missingStoreIds: [],
      missingConfigStoreIds: [],
      missingConfigProductIds: [],
      storeIds: [],
      items: [],
      source: 'none',
    };
  }

  await ensureRemittanceColumns();
  const placeholders = storeIds.map(() => '?').join(',');
  let storeRows = [];
  try {
    const [rows] = await pool.query(
      `SELECT id, owner_user_id, remittance_info, remittance_bank_code, remittance_bank_account, remittance_account_name, remittance_bank_name
         FROM event_stores
        WHERE id IN (${placeholders})`,
      storeIds
    );
    storeRows = Array.isArray(rows) ? rows : [];
  } catch (err) {
    if (err?.code === 'ER_BAD_FIELD_ERROR') {
      try {
        const [rows] = await pool.query(
          `SELECT id, owner_user_id FROM event_stores WHERE id IN (${placeholders})`,
          storeIds
        );
        storeRows = Array.isArray(rows) ? rows : [];
      } catch (fallbackErr) {
        if (fallbackErr?.code === 'ER_BAD_FIELD_ERROR') {
          const [rows] = await pool.query(
            `SELECT id FROM event_stores WHERE id IN (${placeholders})`,
            storeIds
          );
          storeRows = Array.isArray(rows) ? rows : [];
        } else {
          throw fallbackErr;
        }
      }
    } else {
      throw err;
    }
  }

  const storeMap = new Map(
    storeRows
      .map((row) => [Number(row.id), row])
      .filter(([id]) => Number.isFinite(id) && id > 0)
  );
  const missingStoreIds = storeIds.filter((id) => !storeMap.has(id));

  const providerIds = Array.from(new Set(
    storeRows
      .map((row) => normalizeUserId(row.owner_user_id))
      .filter(Boolean)
  ));
  const providerMap = new Map();
  if (providerIds.length) {
    const providerPlaceholders = providerIds.map(() => '?').join(',');
    try {
      const [providerRows] = await pool.query(
        `SELECT id, remittance_info, remittance_bank_code, remittance_bank_account, remittance_account_name, remittance_bank_name
           FROM users
          WHERE id IN (${providerPlaceholders})`,
        providerIds
      );
      (Array.isArray(providerRows) ? providerRows : []).forEach((row) => {
        const id = normalizeUserId(row.id);
        if (id) providerMap.set(id, row);
      });
    } catch (err) {
      if (err?.code !== 'ER_BAD_FIELD_ERROR') throw err;
    }
  }

  const items = storeIds.map((storeId) => {
    const storeRow = storeMap.get(storeId) || null;
    const providerId = normalizeUserId(storeRow?.owner_user_id);
    const providerRow = providerId ? providerMap.get(providerId) || null : null;
    const storeRemittance = remittanceDetailsFromColumns(storeRow || {});
    const providerRemittance = remittanceDetailsFromColumns(providerRow || {});
    const providerOrAdminRemittance = mergeRemittanceDetails(providerRemittance, adminRemittance);
    const remittance = mergeRemittanceDetails(storeRemittance, providerOrAdminRemittance);
    return {
      storeId,
      providerId: providerId || null,
      remittance,
      source: hasRemittanceDetails(storeRemittance)
        ? 'store'
        : (hasRemittanceDetails(providerRemittance) ? 'provider' : (hasAdminRemittance ? 'admin' : 'none')),
    };
  });

  const missingConfigStoreIds = items
    .filter((item) => !hasRemittanceDetails(item.remittance))
    .map((item) => item.storeId);
  const uniqueKeys = Array.from(new Set(
    items
      .filter((item) => hasRemittanceDetails(item.remittance))
      .map((item) => JSON.stringify(item.remittance))
  ));
  const remittance = uniqueKeys.length === 1
    ? normalizeRemittanceDetails(JSON.parse(uniqueKeys[0]))
    : normalizeRemittanceDetails();

  return {
    remittance,
    multiple: uniqueKeys.length > 1,
    missingStoreIds,
    missingConfigStoreIds,
    missingConfigProductIds: [],
    storeIds,
    items,
    source: uniqueKeys.length === 1 && items.length ? items[0].source : 'mixed',
  };
}

async function hydrateOrderRemittance(details = {}, options = {}) {
  const next = ensureRemittance(details);
  if (hasRemittanceDetails(next.remittance)) return next;
  const resolution = await resolveOrderRemittance(next);
  if (!resolution.multiple && hasRemittanceDetails(resolution.remittance)) {
    return applyRemittanceDetails(next, resolution.remittance);
  }
  const allowGlobalFallbackForNonStoreOrder = options.allowGlobalFallbackForNonStoreOrder !== false;
  if (!resolution.storeIds.length && allowGlobalFallbackForNonStoreOrder) {
    const fallback = defaultRemittanceDetails();
    if (hasRemittanceDetails(fallback)) return applyRemittanceDetails(next, fallback);
  }
  return next;
}

async function ensureUserContactInfoReady(userId) {
  const [rows] = await pool.query('SELECT phone, remittance_last5 FROM users WHERE id = ? LIMIT 1', [userId]);
  if (!rows.length) {
    return { ok: false, code: 'USER_NOT_FOUND', message: '找不到使用者', status: 404 };
  }
  const phoneRaw = String(rows[0].phone || '').trim();
  const last5Raw = String(rows[0].remittance_last5 || '').trim();
  const phoneDigits = phoneRaw.replace(/\D/g, '');
  if (!phoneDigits || phoneDigits.length < 8) {
    return { ok: false, code: 'PHONE_REQUIRED', message: '請先於帳戶中心填寫手機號碼後再購買票券或預約', status: 400 };
  }
  if (!/^\d{5}$/.test(last5Raw)) {
    return { ok: false, code: 'REMITTANCE_LAST5_REQUIRED', message: '請先於帳戶中心填寫匯款帳號後五碼後再購買票券或預約', status: 400 };
  }
  return { ok: true, phone: phoneRaw, remittanceLast5: last5Raw };
}

function summarizeOrderDetails(details = {}) {
  const lines = [];
  const total = Number(details.total || 0);
  if (details.ticketType || details.quantity) {
    const qty = Number(details.quantity || 0);
    const base = [details.ticketType || '票券', qty ? `x${qty}` : null].filter(Boolean).join(' ');
    if (base) lines.push(base);
  }
  const selections = Array.isArray(details.selections) ? details.selections : [];
  if (selections.length) {
    for (const sel of selections) {
      const store = sel.store || sel.storeName || sel.store_name || '';
      const type = sel.type || sel.ticketType || '';
      const qty = Number(sel.qty || sel.quantity || 0);
      const subtotal = Number(sel.subtotal || 0);
      const parts = [store, type].filter(Boolean).join('｜') || type || store;
      let text = parts || '項目';
      if (qty) text += ` x${qty}`;
      if (subtotal) text += `（${subtotal.toLocaleString('zh-TW')}）`;
      lines.push(text);
    }
  }
  const addOn = Number(details.addOnCost || 0);
  const materialCount = Math.max(0, Math.floor(Number(details?.addOn?.materialCount || 0)));
  if (addOn) {
    const label = details?.addOn?.material && materialCount > 0
      ? `包材 x${materialCount}`
      : '加購項目';
    lines.push(`${label}（NT$${addOn.toLocaleString('zh-TW')}）`);
  }
  const discount = Number(details.discount || 0);
  if (discount) lines.push(`折扣：-NT$${discount.toLocaleString('zh-TW')}`);
  if (!lines.length && total) lines.push(`總金額：NT$${total.toLocaleString('zh-TW')}`);
  return lines;
}

function toSafeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeOrderAmounts(order = {}) {
  const details = order && typeof order === 'object' ? (order.detailsRaw || order.details || order) : {};
  const selections = Array.isArray(details.selections) ? details.selections : [];
  const totalRaw = Math.max(0, toSafeNumber(details.total));
  const subtotalRaw = toSafeNumber(details.subtotal);
  const subtotalFromSelections = selections.reduce((sum, sel) => {
    const qty = toSafeNumber(sel.qty || sel.quantity);
    const unit = toSafeNumber(sel.unitPrice || sel.price);
    const lineSubtotal = toSafeNumber(sel.subtotal || (qty && unit ? qty * unit : 0));
    const lineDiscount = toSafeNumber(sel.discount);
    const preDiscount = lineSubtotal + (lineDiscount > 0 ? lineDiscount : 0);
    return sum + preDiscount;
  }, 0);
  const baseSubtotal = subtotalRaw || subtotalFromSelections;
  const subtotal = Math.max(0, baseSubtotal || totalRaw);
  const addOnCost = Math.max(0, toSafeNumber(details.addOnCost));
  const quantityRaw = toSafeNumber(details.quantity);
  const quantityFromSelections = selections.reduce((sum, sel) => sum + toSafeNumber(sel.qty || sel.quantity), 0);
  const quantity = Math.max(0, quantityRaw || quantityFromSelections);
  let discount = Math.max(0, toSafeNumber(details.discount));
  if (!discount && selections.length) {
    discount = selections.reduce((sum, sel) => sum + Math.max(0, toSafeNumber(sel.discount)), 0);
  }
  if (!discount) {
    const delta = (subtotal || 0) + addOnCost - totalRaw;
    if (delta > 0) discount = delta;
  }
  discount = Math.max(0, discount);
  const total = totalRaw || Math.max((subtotal || 0) + addOnCost - discount, 0);

  return { quantity, subtotal: subtotal || 0, discount, addOnCost, total };
}

function formatCurrency(value) {
  const n = toSafeNumber(value);
  return `NT$ ${n.toLocaleString('zh-TW')}`;
}

function buildAmountBreakdownEntries(order = {}) {
  const { quantity, subtotal, discount, addOnCost, total } = normalizeOrderAmounts(order);
  return [
    { label: '總件數', value: `${quantity || 0}` },
    { label: '小計', value: formatCurrency(subtotal) },
    { label: '票卷折扣', value: `-NT$ ${Math.abs(discount).toLocaleString('zh-TW')}` },
    { label: '加購費用', value: formatCurrency(addOnCost) },
    { label: '總計', value: formatCurrency(total) },
  ];
}

function buildAmountBreakdownText(order = {}) {
  const entries = buildAmountBreakdownEntries(order);
  return entries.map((entry) => `${entry.label}：${entry.value}`).join('\n');
}

function buildAmountBreakdownHtml(order = {}) {
  const entries = buildAmountBreakdownEntries(order);
  const rows = entries.map((entry) => `
    <tr>
      <td style="padding:5px 0;color:${EMAIL_THEME.muted};">${escapeHtml(entry.label)}</td>
      <td style="padding:5px 0;text-align:right;color:${EMAIL_THEME.text};font-weight:500;">${escapeHtml(entry.value)}</td>
    </tr>
  `).join('');
  return `
    <div style="margin:14px 0 0 0;border-top:1px solid ${EMAIL_THEME.line};padding-top:10px;">
      <strong style="display:block;margin:0 0 4px 0;color:${EMAIL_THEME.text};font-weight:500;">金額明細</strong>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    </div>
  `.trim();
}

async function getUserContact(userId) {
  try {
    const [rows] = await pool.query('SELECT username, email FROM users WHERE id = ? LIMIT 1', [userId]);
    if (!rows.length) return { username: '', email: '' };
    return { username: rows[0].username || '', email: rows[0].email || '' };
  } catch (_) {
    return { username: '', email: '' };
  }
}

function formatDateYYYYMMDD(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateDisplay(value, { withTime = false } = {}) {
  if (!value && value !== 0) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (!withTime && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-');
    return `${y}/${m}/${d}`;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return withTime
    ? date.toLocaleString('zh-TW', { hour12: false })
    : date.toLocaleDateString('zh-TW');
}

function formatDateRangeDisplay(start, end, { withTime = false, fallback = '' } = {}) {
  const s = formatDateDisplay(start, { withTime });
  const e = formatDateDisplay(end, { withTime });
  if (s && e) return `${s} ~ ${e}`;
  return s || e || fallback;
}

function formatReservationDisplayId(id) {
  const num = Number(id);
  if (Number.isFinite(num)) return `R${String(num).padStart(6, '0')}`;
  const raw = String(id || '').trim();
  if (!raw) return '';
  if (/^R\d{6,}$/.test(raw)) return raw;
  return `R${raw}`;
}

const STATIC_API_BASE =
  (PUBLIC_API_BASE && PUBLIC_API_BASE.trim() ? PUBLIC_API_BASE.replace(/\/$/, '') : '') ||
  (process.env.SERVER_PUBLIC_URL && process.env.SERVER_PUBLIC_URL.trim()
    ? process.env.SERVER_PUBLIC_URL.replace(/\/$/, '')
    : `http://localhost:${process.env.PORT || 3020}`);

function buildQrUrl(data) {
  const value = String(data || '').trim();
  if (!value) return '';
  const base = STATIC_API_BASE;
  if (!base) return '';
  return `${base}/qr?data=${encodeURIComponent(value)}`;
}

function getReservationStageCode(record, stage) {
  if (!record || !stage) return '';
  const map = {
    pre_dropoff: record.verify_code_pre_dropoff,
    pre_pickup: record.verify_code_pre_pickup,
    post_dropoff: record.verify_code_post_dropoff,
    post_pickup: record.verify_code_post_pickup,
    done: record.verify_code_post_pickup || record.verify_code,
  };
  if (map[stage]) return String(map[stage]);
  if (stage === 'pre_dropoff' && record.verify_code) return String(record.verify_code);
  return '';
}

function parsePositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const int = Math.floor(num);
  if (int < min) return min;
  if (int > max) return max;
  return int;
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function normalizePositiveInt(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const n = Math.floor(value);
    return n > 0 ? n : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!/^\d+$/.test(trimmed)) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (typeof value === 'bigint') {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function normalizeNullableText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value || '').trim();
  return text || null;
}

function normalizeUserId(value) {
  if (value === undefined || value === null) return null;
  const text = String(value || '').trim();
  return text || null;
}

function reservationInsertColumns() {
  const base = ['user_id', 'ticket_type', 'store', 'event'];
  if (reservationHasEventIdColumn) base.push('event_id');
  if (reservationHasStoreIdColumn) base.push('store_id');
  if (reservationHasDriverIdColumn) base.push('driver_id');
  if (reservationHasOrderIdColumn) base.push('order_id');
  if (reservationHasDeliveryPointIdColumn) base.push('delivery_point_id');
  return base;
}

function buildReservationInsertRow(row = {}) {
  const userId = row.userId;
  const ticketType = String(row.ticketType || '');
  const storeName = String(row.storeName || row.store || '');
  const eventName = String(row.eventName || row.event || '');
  const payload = [
    userId,
    ticketType,
    storeName,
    eventName,
  ];
  if (reservationHasEventIdColumn) {
    payload.push(normalizePositiveInt(row.eventId));
  }
  if (reservationHasStoreIdColumn) {
    payload.push(normalizePositiveInt(row.storeId));
  }
  if (reservationHasDriverIdColumn) {
    payload.push(normalizeUserId(row.driverId));
  }
  if (reservationHasOrderIdColumn) {
    payload.push(normalizePositiveInt(row.orderId));
  }
  if (reservationHasDeliveryPointIdColumn) {
    payload.push(normalizePositiveInt(row.deliveryPointId ?? row.delivery_point_id));
  }
  return payload;
}

async function insertReservationsBulk(conn, rows) {
  if (!conn || !rows || !rows.length) return null;
  const columns = reservationInsertColumns();
  const payload = rows.map(buildReservationInsertRow);
  const sql = `INSERT INTO reservations (${columns.join(', ')}) VALUES ?;`;
  return conn.query(sql, [payload]);
}

async function getEventById(eventId, { useCache = true } = {}) {
  const normalized = normalizePositiveInt(eventId);
  if (!normalized) return null;
  const key = String(normalized);
  if (useCache) {
    const cached = cacheUtils.get(eventDetailCache, key);
    if (cached) return cached;
  }
  await ensureEventExclusiveColumn();
  await ensureEventListingStatusColumn();
  let rows = [];
  try {
    [rows] = await pool.query(
      'SELECT id, code, title, starts_at, ends_at, deadline, location, description, cover, cover_type, rules, owner_user_id, is_exclusive, listing_status, created_at, updated_at FROM events WHERE id = ? LIMIT 1',
      [normalized]
    );
  } catch (err) {
    if (err?.code !== 'ER_BAD_FIELD_ERROR') throw err;
    [rows] = await pool.query(
      "SELECT id, code, title, starts_at, ends_at, deadline, location, description, cover, cover_type, rules, owner_user_id, 0 AS is_exclusive, 'published' AS listing_status, created_at, updated_at FROM events WHERE id = ? LIMIT 1",
      [normalized]
    );
  }
  if (!rows.length) return null;
  const event = rows[0];
  if (event.cover_data) delete event.cover_data;
  if (!event.code) event.code = `EV${String(event.id).padStart(6, '0')}`;
  event.is_exclusive = Number(event.is_exclusive || 0) ? 1 : 0;
  event.listing_status = normalizeListingStatus(event.listing_status, LISTING_STATUS_PUBLISHED);
  cacheUtils.set(eventDetailCache, key, event);
  return event;
}

async function listEventStores(eventId, { useCache = true } = {}) {
  const normalized = normalizePositiveInt(eventId);
  if (!normalized) return [];
  const key = String(normalized);
  if (useCache) {
    const cached = cacheUtils.get(eventStoresCache, key);
    if (cached) return cached;
  }
  await ensureDeliveryPointSchema();
  await ensureEventExclusiveColumn();
  const attempts = [
    `SELECT s.id, s.event_id, COALESCE(s.owner_user_id, e.owner_user_id) AS provider_user_id,
            s.delivery_point_id, s.name, s.address, s.external_url, s.business_hours,
            s.capacity,
            s.is_active, s.pre_enabled, s.pre_start, s.pre_end, s.post_enabled, s.post_start, s.post_end,
            s.prices, s.created_at, s.updated_at
       FROM event_stores s
       LEFT JOIN events e ON e.id = s.event_id
      WHERE s.event_id = ?
        AND COALESCE(s.is_active, 1) = 1
        AND (COALESCE(e.is_exclusive, 0) = 0 OR COALESCE(s.owner_user_id, e.owner_user_id) = e.owner_user_id)
      ORDER BY s.id ASC`,
    'SELECT id, event_id, delivery_point_id, name, pre_start, pre_end, post_start, post_end, prices, created_at, updated_at FROM event_stores WHERE event_id = ? ORDER BY id ASC',
    'SELECT id, event_id, name, pre_start, pre_end, post_start, post_end, prices, created_at, updated_at FROM event_stores WHERE event_id = ? ORDER BY id ASC',
  ];

  let rows = [];
  let lastErr = null;
  for (const sql of attempts) {
    try {
      const [result] = await pool.query(sql, [normalized]);
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

  const sharedPrices = await listEventServicePrices(normalized, { useCache });
  const capacityUsage = await getReservationCapacityUsageForEvent(normalized);
  const list = rows.map((r) => ({
    ...r,
    address: normalizeNullableText(r.address),
    external_url: normalizeNullableText(r.external_url),
    business_hours: normalizeNullableText(r.business_hours),
    capacity: normalizeDeliveryPointCapacity(r.capacity),
    reserved_quantity: (r.delivery_point_id && normalizeDeliveryPointCapacity(r.capacity))
      ? (capacityUsage.get(normalizePositiveInt(r.delivery_point_id)) || 0)
      : 0,
    capacity_remaining: (r.delivery_point_id && normalizeDeliveryPointCapacity(r.capacity))
      ? Math.max(0, normalizeDeliveryPointCapacity(r.capacity) - (capacityUsage.get(normalizePositiveInt(r.delivery_point_id)) || 0))
      : null,
    is_active: r.is_active == null ? true : Number(r.is_active) !== 0,
    pre_enabled: r.pre_enabled == null ? true : Number(r.pre_enabled) !== 0,
    post_enabled: r.post_enabled == null ? true : Number(r.post_enabled) !== 0,
    // 新模型以各交車點服務的 prices 為主；僅在舊資料缺漏時回退到 event_service_prices
    prices: (function pickResolvedPrices() {
      const parsed = safeParseJSON(r.prices, {});
      const ownPrices = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      if (Object.keys(ownPrices).length) return ownPrices;
      return sharedPrices;
    })(),
  })).filter((item) => item.is_active !== false);
  cacheUtils.set(eventStoresCache, key, list);
  return list;
}

function parseBooleanParam(value, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

async function fetchReservationContext(reservationId) {
  if (!reservationId) return null;
  const [rows] = await pool.query('SELECT * FROM reservations WHERE id = ? LIMIT 1', [reservationId]);
  if (!rows.length) return null;
  const reservation = rows[0];
  let eventRow = null;
  const eventIdStored = normalizePositiveInt(reservation.event_id ?? reservation.eventId);
  if (eventIdStored) {
    eventRow = await getEventById(eventIdStored, { useCache: true });
  }
  const eventKey = (!eventRow && reservation.event) ? String(reservation.event).trim() : '';
  if (!eventRow && eventKey) {
    const [eRows] = await pool.query(
      'SELECT id, code, title, starts_at, ends_at, deadline, location FROM events WHERE title = ? OR code = ? LIMIT 1',
      [eventKey, eventKey]
    );
    if (eRows.length) eventRow = eRows[0];
  }
  let storeRow = null;
  const storeIdStored = normalizePositiveInt(reservation.store_id ?? reservation.storeId);
  if (storeIdStored && eventIdStored) {
    const storesList = await listEventStores(eventIdStored, { useCache: true });
    storeRow = storesList.find((s) => Number(s.id) === storeIdStored) || null;
  }
  if (!storeRow && storeIdStored) {
    const storeQueries = [
      'SELECT id, event_id, delivery_point_id, name, address, external_url, business_hours, pre_start, pre_end, post_start, post_end, prices, created_at, updated_at FROM event_stores WHERE id = ? LIMIT 1',
      'SELECT id, event_id, name, pre_start, pre_end, post_start, post_end, prices, created_at, updated_at FROM event_stores WHERE id = ? LIMIT 1',
    ];
    let sRows = [];
    let lastErrStore = null;
    for (const sql of storeQueries) {
      try {
        const [result] = await pool.query(sql, [storeIdStored]);
        sRows = result;
        break;
      } catch (err) {
        lastErrStore = err;
        if (err?.code !== 'ER_BAD_FIELD_ERROR') throw err;
      }
    }
    if (!sRows.length && lastErrStore && lastErrStore.code === 'ER_BAD_FIELD_ERROR') throw lastErrStore;
    if (sRows.length) {
      const s = sRows[0];
      storeRow = {
        ...s,
        address: normalizeNullableText(s.address),
        external_url: normalizeNullableText(s.external_url),
        business_hours: normalizeNullableText(s.business_hours),
        prices: safeParseJSON(s.prices, {}),
      };
      if (!eventRow && s.event_id) {
        eventRow = await getEventById(s.event_id, { useCache: true });
      }
    }
  }
  const storeName = reservation.store ? String(reservation.store).trim() : '';
  if (!storeRow && eventRow && storeName) {
    const storesList = await listEventStores(eventRow.id, { useCache: true });
    storeRow = storesList.find((s) => String(s.name || '').trim() === storeName) || null;
  } else if (!storeRow && !eventRow && storeName) {
    const [sRows] = await pool.query(
      `SELECT s.id, s.event_id, s.name, s.address, s.external_url, s.business_hours, s.pre_start, s.pre_end, s.post_start, s.post_end, s.prices, s.created_at, s.updated_at,
              e.id AS e_id, e.title AS e_title, e.code AS e_code, e.starts_at AS e_starts, e.ends_at AS e_ends, e.location AS e_location
         FROM event_stores s
         JOIN events e ON e.id = s.event_id
        WHERE s.name = ?
        LIMIT 1`,
      [storeName]
    );
    if (sRows.length) {
      const row = sRows[0];
      storeRow = {
        id: row.id,
        event_id: row.event_id,
        name: row.name,
        address: normalizeNullableText(row.address),
        external_url: normalizeNullableText(row.external_url),
        business_hours: normalizeNullableText(row.business_hours),
        pre_start: row.pre_start,
        pre_end: row.pre_end,
        post_start: row.post_start,
        post_end: row.post_end,
        prices: safeParseJSON(row.prices, {}),
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
      eventRow = {
        id: row.e_id,
        title: row.e_title,
        code: row.e_code,
        starts_at: row.e_starts,
        ends_at: row.e_ends,
        location: row.e_location,
      };
    }
  }
  return { reservation, event: eventRow, store: storeRow };
}

async function fetchReservationsContext(ids = []) {
  const list = Array.isArray(ids) ? ids : [ids];
  const unique = list
    .map((id) => Number(id) || null)
    .filter((id) => Number.isFinite(id) && id > 0)
    .filter((id, index, arr) => arr.indexOf(id) === index);
  const contexts = [];
  for (const id of unique) {
    try {
      const ctx = await fetchReservationContext(id);
      if (ctx) contexts.push(ctx);
    } catch (err) {
      console.error('fetchReservationsContext error:', err?.message || err);
    }
  }
  return contexts;
}

function summarizeReservationSchedule(context = {}) {
  const { reservation = {}, event = {}, store = {} } = context;
  const eventTitle = event.title || reservation.event || '';
  const storeName = store.name || reservation.store || '';
  const timings = {
    preWindow: formatDateRangeDisplay(store.pre_start, store.pre_end),
    postWindow: formatDateRangeDisplay(store.post_start, store.post_end),
    eventWindow: formatDateRangeDisplay(event.starts_at, event.ends_at, { withTime: true }),
    eventLocation: event.location || '',
  };
  return {
    eventTitle,
    storeName,
    timings,
  };
}

function buildReservationSectionHtml({ title, rows = [] }) {
  if (!rows.length) return '';
  const items = rows
    .map(
      (row) => `
        <tr>
          <td style="padding:9px 0;color:${EMAIL_THEME.muted};width:120px;vertical-align:top;">${escapeHtml(row.label)}</td>
          <td style="padding:9px 0;color:${EMAIL_THEME.text};font-weight:500;">${escapeHtml(row.value)}</td>
        </tr>`
    )
    .join('');
  return `
    <section style="margin:18px 0;border:1px solid ${EMAIL_THEME.line};border-radius:14px;padding:16px;background:#ffffff;">
      <h4 style="margin:0 0 8px 0;font-size:16px;line-height:1.4;color:${EMAIL_THEME.primary};font-weight:500;">${escapeHtml(title)}</h4>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table>
    </section>
  `;
}

function composeReservationPaymentContent({ contexts = [], tickets = [], orderSummary = {} }) {
  const reservationSections = contexts.map((ctx) => {
    const { reservation, eventTitle, storeName, timings } = (() => {
      const summary = summarizeReservationSchedule(ctx);
      return { reservation: ctx.reservation || {}, eventTitle: summary.eventTitle, storeName: summary.storeName, timings: summary.timings };
    })();
    const code = getReservationStageCode(reservation, 'pre_dropoff') || '（待交付時提供）';
    const rows = [
      { label: '服務檔期', value: eventTitle || '未命名服務檔期' },
      { label: '預約編號', value: formatReservationDisplayId(reservation.id || '') },
      storeName ? { label: '交車點資訊', value: storeName } : null,
      reservation.ticket_type ? { label: '票種', value: reservation.ticket_type } : null,
      timings.preWindow ? { label: '賽前交車時間', value: timings.preWindow } : null,
      timings.eventWindow ? { label: '服務時間', value: timings.eventWindow } : null,
      timings.eventLocation ? { label: '服務地點', value: timings.eventLocation } : null,
      { label: '交付驗證碼', value: code },
    ].filter(Boolean);
    return { rows, lineText: rows.map((r) => `${r.label}：${r.value}`).join('\n') };
  });

  const ticketLines = tickets.map((t) => {
    const expiryText = t.expiry ? formatDateDisplay(t.expiry) : '';
    return {
      label: '票號',
      value: `${t.uuid || t.id}${expiryText ? `（有效期限：${expiryText}）` : ''}`,
    };
  });

  const emailParts = [];
  if (reservationSections.length) {
    reservationSections.forEach((section, idx) => {
      emailParts.push(
        buildReservationSectionHtml({
          title: reservationSections.length > 1 ? `預約資訊 ${idx + 1}` : '預約資訊',
          rows: section.rows,
        })
      );
    });
  }
  if (ticketLines.length) {
    emailParts.push(
      buildReservationSectionHtml({
        title: '票券資訊',
        rows: ticketLines,
      })
    );
  }

  const amountEntries = buildAmountBreakdownEntries(orderSummary);
  if (amountEntries.length) {
    emailParts.push(
      buildReservationSectionHtml({
        title: '金額明細',
        rows: amountEntries,
      })
    );
  }
  emailParts.push(
    `<p style="margin:18px 0 6px 0;">提醒您：</p>
     <ul style="margin:0 0 18px 18px;padding:0;">
       <li>交付時請務必出示交付驗證碼，並與現場人員完成檢查表。</li>
       <li>檢查表完成後，系統會再傳送托運單與 QRCode，方便您後續追蹤。</li>
       <li>若有其他問題，歡迎回覆此信或洽客服專線。</li>
     </ul>`
  );

  const uniqueEvents = Array.from(
    new Set(
      reservationSections
        .map((s) => {
    const row = s.rows.find((r) => r.label === '服務檔期');
          return row ? row.value : '';
        })
        .filter(Boolean)
    )
  );

  const emailSubject = uniqueEvents.length
    ? `預約確認：${uniqueEvents.join('、')}`
    : '預約付款確認';
  const emailHtml = `
    <p>您好，我們已確認付款完成，以下為您的預約/票券資訊：</p>
    ${emailParts.join('\n')}
    <p style="color:#888;font-size:12px;">此信件由系統自動寄出，若有任何疑問請與我們聯絡。</p>
  `;

  const introText = '付款已完成，以下是您的預約資訊：';
  const lineMessages = [];
  const headerText = [introText, uniqueEvents.length ? `服務檔期：${uniqueEvents.join('、')}` : null]
    .filter(Boolean)
    .join('\n');
  if (headerText) lineMessages.push({ type: 'text', text: headerText });
  if (reservationSections.length) {
    reservationSections.forEach((section) => {
      lineMessages.push({ type: 'text', text: section.lineText });
    });
  }
  if (ticketLines.length) {
    const text = ticketLines.map((row) => `${row.label}：${row.value}`).join('\n');
    lineMessages.push({ type: 'text', text: text });
  }
  const amountText = buildAmountBreakdownText(orderSummary);
  if (amountText) {
    lineMessages.push({ type: 'text', text: amountText });
  }

  return { emailSubject, emailHtml, lineMessages };
}

function composeChecklistCompletionContent({ context, stage }) {
  const { reservation = {}, eventTitle, storeName, timings } = (() => {
    const summary = summarizeReservationSchedule(context);
    return { reservation: context.reservation || {}, eventTitle: summary.eventTitle, storeName: summary.storeName, timings: summary.timings };
  })();
  const code = getReservationStageCode(reservation, stage);
  const qrUrl = buildQrUrl(code);
  const reservationIdText = formatReservationDisplayId(reservation.id || '');
  const stageLabel = stage === 'pre_dropoff' ? '托運單' : '回程托運單';
  const extraNote =
    stage === 'pre_dropoff'
      ? '此驗證碼為托運單號，後續查詢或取貨時請出示。'
      : '此為回程托運單號，請保留供取貨時確認。';
  const codeDisplay = code ? code : '尚未建立驗證碼，請聯繫客服。';
  const lastFour = code ? code.slice(-4) : '';

  const subject = `${stageLabel}確認：${eventTitle || '預約'}`;
  const rows = [
    { label: '服務檔期', value: eventTitle || '預約' },
    { label: '預約編號', value: reservationIdText },
    storeName ? { label: '交車點資訊', value: storeName } : null,
    timings.preWindow && stage === 'pre_dropoff' ? { label: '賽前交車時間', value: timings.preWindow } : null,
    timings.postWindow && stage !== 'pre_dropoff' ? { label: '到貨後交付時間', value: timings.postWindow } : null,
    { label: `${stageLabel}驗證碼`, value: codeDisplay },
  ].filter(Boolean);

  const emailHtml = `
    <p>${stage === 'pre_dropoff' ? '檢查表已完成，我們已更新托運單資訊：' : '到貨後檢查表已完成，以下為回程托運單資訊：'}</p>
    ${buildReservationSectionHtml({ title: `${stageLabel}資訊`, rows })}
    <p>${extraNote}</p>
    ${qrUrl ? `<p>QRCode：<br/><img src="${qrUrl}" alt="QRCode" style="max-width:240px;border:1px solid #eee;padding:8px;margin-top:6px;" /></p>` : ''}
    <p style="color:#888;font-size:12px;">此信件由系統自動寄出。</p>
  `;

  const headline =
    stage === 'pre_dropoff'
      ? '托運檢查完成，以下是托運單資訊：'
      : '到貨後檢查完成，以下是回程托運單資訊：';
  const messageLines = [
    headline,
    `服務檔期：${eventTitle || '預約'}`,
    `預約編號：${reservationIdText}`,
    storeName ? `交車點資訊：${storeName}` : null,
    stage === 'pre_dropoff' && timings.preWindow ? `出貨前交付：${timings.preWindow}` : null,
    stage !== 'pre_dropoff' && timings.postWindow ? `到貨後交付：${timings.postWindow}` : null,
    code ? `${stageLabel}驗證碼：${code}` : `${stageLabel}驗證碼尚未建立，請聯繫客服`,
    stage === 'post_dropoff' && lastFour ? `回程托運單後四碼：${lastFour}` : null,
    extraNote ? { text: extraNote, size: 'xs', color: '#666666' } : null,
  ].filter(Boolean);

  const bubbleTitle = stage === 'pre_dropoff' ? '托運檢查完成' : '回程檢查完成';
  const altTextHint = messageLines
    .map((item) => (typeof item === 'string' ? item : item?.text || ''))
    .join(' ');
  const lineMessages = [
    buildReservationFlexMessage({
      title: bubbleTitle,
      lines: messageLines,
      qrUrl,
      qrLabel: `${stageLabel} QR Code`,
      altTextHint,
    }),
  ];

  return { emailSubject: subject, emailHtml, lineMessages };
}

function composeStageProgressContent({ context, stage }) {
  const { reservation = {}, eventTitle, storeName, timings } = (() => {
    const summary = summarizeReservationSchedule(context);
    return { reservation: context.reservation || {}, eventTitle: summary.eventTitle, storeName: summary.storeName, timings: summary.timings };
  })();
  const code = getReservationStageCode(reservation, stage);
  const reservationIdText = formatReservationDisplayId(reservation.id || '');
  const stageLabel = zhReservationStatus(stage);
  const qrUrl = code ? buildQrUrl(code) : '';

  const stageDetails = (() => {
    switch (stage) {
      case 'pre_pickup':
        return {
          headline: '賽前交車資訊如下：',
          rows: [
            timings.eventWindow ? { label: '服務時間', value: timings.eventWindow } : null,
            timings.eventLocation ? { label: '取貨地點', value: timings.eventLocation } : null,
            code ? { label: '取貨驗證碼', value: code } : null,
          ].filter(Boolean),
          reminder: '抵達取貨點時請出示取貨驗證碼與證件。',
        };
      case 'post_dropoff':
        return {
          headline: '賽前取車資訊如下：',
          rows: [
            timings.postWindow ? { label: '到貨後交付時間', value: timings.postWindow } : null,
            timings.eventLocation ? { label: '交付地點', value: timings.eventLocation } : null,
            code ? { label: '到貨後交付驗證碼', value: code } : null,
          ].filter(Boolean),
          reminder: '到貨後交付時請出示驗證碼，並與現場人員完成檢查。',
        };
      case 'post_pickup':
        return {
          headline: '賽後交車資訊如下：',
          rows: [
            storeName ? { label: '取貨點', value: storeName } : null,
            timings.postWindow ? { label: '取貨時間', value: timings.postWindow } : null,
            code ? { label: '取貨號', value: code } : null,
          ].filter(Boolean),
          reminder: '請攜帶取貨號與身分證件至取貨點完成領貨。',
        };
      case 'done':
        return {
          headline: '感謝您的使用！',
          rows: [],
          reminder: '若後續有任何需求，歡迎再次預約 Leader Online 服務。',
        };
      case 'pre_dropoff':
      default:
        return {
          headline: '預約已更新：',
          rows: [],
          reminder: '',
        };
    }
  })();

  const rows = [
    { label: '服務檔期', value: eventTitle || '預約' },
    { label: '預約編號', value: reservationIdText },
    storeName ? { label: '交車點資訊', value: storeName } : null,
    ...stageDetails.rows,
  ].filter(Boolean);

  const emailHtml = `
    <p>${stageDetails.headline}</p>
    ${buildReservationSectionHtml({ title: stageLabel, rows })}
    ${stageDetails.reminder ? `<p>${stageDetails.reminder}</p>` : ''}
    ${qrUrl && stage !== 'done' ? `<p>QRCode：<br/><img src="${qrUrl}" alt="QRCode" style="max-width:240px;border:1px solid #eee;padding:8px;margin-top:6px;" /></p>` : ''}
    <p style="color:#888;font-size:12px;">此信件由系統自動寄出。</p>
  `;

  const messageLines = [
    stageDetails.headline,
    `服務檔期：${eventTitle || '預約'}`,
    `預約編號：${reservationIdText}`,
    storeName ? `交車點資訊：${storeName}` : null,
    ...stageDetails.rows.map((row) => `${row.label}：${row.value}`),
    stageDetails.reminder ? { text: stageDetails.reminder, size: 'xs', color: '#666666' } : null,
  ].filter(Boolean);

  const includeQr = qrUrl && stage !== 'done';
  const altTextHint = messageLines
    .map((item) => (typeof item === 'string' ? item : item?.text || ''))
    .join(' ');
  const lineMessages = [
    buildReservationFlexMessage({
      title: stageLabel || '預約進度',
      lines: messageLines,
      qrUrl: includeQr ? qrUrl : '',
      qrLabel: includeQr ? `${stageLabel || '預約'} QR Code` : 'QR Code',
      altTextHint,
    }),
  ];

  const emailSubject =
    stage === 'done' ? `服務完成：${eventTitle || '預約'}` : `${stageLabel}提醒：${eventTitle || '預約'}`;

  return { emailSubject, emailHtml, lineMessages };
}

async function notifyReservationStageChange(reservationId, stage, fallbackReservation = null) {
  if (!reservationId || !stage) return;
  try {
    const context = await fetchReservationContext(reservationId);
    const reservation = context?.reservation || fallbackReservation;
    if (!reservation) return;

    let to = '';
    try {
      const [uRows] = await pool.query('SELECT email FROM users WHERE id = ? LIMIT 1', [reservation.user_id]);
      to = uRows?.[0]?.email || '';
    } catch (_) {
      to = '';
    }

    const eventTitle = context?.event?.title || reservation.event || '預約';
    const storeName = context?.store?.name || reservation.store || '交車點資訊';
    const notice = composeStageProgressContent({
      context: context || { reservation },
      stage,
    });

    await sendReservationStatusEmail({
      to,
      eventTitle,
      store: storeName,
      statusZh: zhReservationStatus(stage),
      userId: reservation.user_id,
      lineMessages: notice?.lineMessages,
      emailSubject: notice?.emailSubject,
      emailHtml: notice?.emailHtml,
    });
  } catch (err) {
    console.error('notifyReservationStageChange error:', err?.message || err);
  }
}

function normalizeEmail(e){ return (e || '').toString().trim().toLowerCase() }

async function ensureTicketLogsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ticket_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      ticket_id BIGINT UNSIGNED NOT NULL,
      user_id CHAR(36) NOT NULL,
      action VARCHAR(32) NOT NULL,
      meta JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_ticket_logs_user (user_id),
      KEY idx_ticket_logs_ticket (ticket_id),
      KEY idx_ticket_logs_action (action)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

async function backfillTicketProductIds(connOrPool = pool, { ensureColumn = true } = {}) {
  if (ensureColumn) {
    const hasColumn = await ensureTicketProductIdColumn(connOrPool);
    if (!hasColumn) {
      return { updated_by_order: 0, updated_by_unique_name: 0, remaining_unbound: 0 };
    }
  }
  await ensureProductManagementSchema();
  try { await ensureTicketLogsTable(); } catch (_) {}

  let updatedByOrder = 0;
  let updatedByUniqueName = 0;
  try {
    const [orderUpdate] = await connOrPool.query(
      `UPDATE tickets t
          JOIN (
            SELECT
              l.ticket_id,
              MAX(COALESCE(
                CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.details, '$.productId')), '') AS UNSIGNED),
                CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.details, '$.product_id')), '') AS UNSIGNED),
                CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.details, '$.product.id')), '') AS UNSIGNED)
              )) AS product_id
            FROM ticket_logs l
            JOIN orders o
              ON o.id = COALESCE(
                CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(l.meta, '$.order_id')), '') AS UNSIGNED),
                CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(l.meta, '$.orderId')), '') AS UNSIGNED)
              )
            WHERE l.ticket_id IS NOT NULL
            GROUP BY l.ticket_id
            HAVING product_id IS NOT NULL AND product_id > 0
          ) src ON src.ticket_id = t.id
          JOIN products p ON p.id = src.product_id
         SET t.product_id = p.id
       WHERE t.product_id IS NULL`
    );
    updatedByOrder = Number(orderUpdate?.affectedRows || 0);
  } catch (err) {
    if (!['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR', 'ER_INVALID_JSON_PATH', 'ER_INVALID_JSON_TEXT'].includes(err?.code)) throw err;
  }

  try {
    const [nameUpdate] = await connOrPool.query(
      `UPDATE tickets t
          JOIN (
            SELECT name, MIN(id) AS product_id, COUNT(*) AS product_count
              FROM products
             WHERE name IS NOT NULL AND name <> ''
             GROUP BY name
            HAVING product_count = 1
          ) p ON p.name = t.type
         SET t.product_id = p.product_id
       WHERE t.product_id IS NULL`
    );
    updatedByUniqueName = Number(nameUpdate?.affectedRows || 0);
  } catch (err) {
    if (!['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(err?.code)) throw err;
  }

  let remainingUnbound = 0;
  try {
    const [[row]] = await connOrPool.query('SELECT COUNT(*) AS total FROM tickets WHERE product_id IS NULL');
    remainingUnbound = Number(row?.total || 0);
  } catch (err) {
    if (!['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(err?.code)) throw err;
  }

  return {
    updated_by_order: updatedByOrder,
    updated_by_unique_name: updatedByUniqueName,
    remaining_unbound: remainingUnbound,
  };
}

async function ensureTicketProductIdColumn(connOrPool = pool) {
  if (ticketsHaveProductIdColumn && connOrPool === pool) return true;
  try {
    const [rows] = await connOrPool.query("SHOW COLUMNS FROM tickets LIKE 'product_id'");
    if (Array.isArray(rows) && rows.length > 0) {
      if (connOrPool === pool) ticketsHaveProductIdColumn = true;
      return true;
    }
    await connOrPool.query('ALTER TABLE tickets ADD COLUMN product_id INT UNSIGNED NULL AFTER type');
    try {
      await connOrPool.query('ALTER TABLE tickets ADD INDEX idx_tickets_product (product_id)');
    } catch (err) {
      if (!['ER_DUP_KEYNAME', 'ER_DUP_FIELDNAME'].includes(err?.code)) throw err;
    }
    await backfillTicketProductIds(connOrPool, { ensureColumn: false });
    if (connOrPool === pool) ticketsHaveProductIdColumn = true;
    return true;
  } catch (err) {
    if (connOrPool === pool) ticketsHaveProductIdColumn = false;
    console.warn('ensureTicketProductIdColumn error:', err?.message || err);
    return false;
  }
}

async function logTicket({ conn = pool, ticketId, userId, action, meta = {} }){
  try {
    await ensureTicketLogsTable();
    await conn.query('INSERT INTO ticket_logs (ticket_id, user_id, action, meta) VALUES (?, ?, ?, ?)', [ticketId, userId, action, JSON.stringify(meta || {})]);
  } catch (_) { /* ignore logging failure */ }
}

async function ensureOAuthIdentitiesTable(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS oauth_identities (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id CHAR(36) NOT NULL,
      provider VARCHAR(32) NOT NULL,
      subject VARCHAR(128) NOT NULL,
      email VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_provider_subject (provider, subject),
      KEY idx_oauth_user (user_id),
      KEY idx_oauth_provider_email (provider, email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

async function ensureAccountTombstonesTable(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_tombstones (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      provider VARCHAR(32) NULL,
      subject VARCHAR(128) NULL,
      email VARCHAR(255) NULL,
      reason VARCHAR(64) NOT NULL DEFAULT 'deleted',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_tombstone_provider_subject (provider, subject),
      KEY idx_tombstone_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

async function isTombstoned({ provider = null, subject = null, email = null }){
  try {
    await ensureAccountTombstonesTable();
    const p = (provider ? String(provider).trim().toLowerCase() : null);
    const s = (subject ? String(subject).trim() : null);
    const e = (email ? String(email).trim().toLowerCase() : null);
    if (p && s) {
      const [rows] = await pool.query('SELECT id FROM account_tombstones WHERE provider = ? AND subject = ? LIMIT 1', [p, s]);
      if (rows.length) return true;
    }
    if (e) {
      const [rowsE] = await pool.query('SELECT id FROM account_tombstones WHERE LOWER(email) = LOWER(?) LIMIT 1', [e]);
      if (rowsE.length) return true;
    }
    return false;
  } catch (_) { return false }
}

function getAuthedUser(req){
  try{
    const token = extractToken(req);
    if (!token) return null;
    const payload = jwt.verify(token, JWT_SECRET);
    return payload || null;
  } catch { return null }
}

// Auto-accept pending email transfers once the recipient registers
async function autoAcceptTransfersForEmail(userId, email) {
  const conn = await pool.getConnection();
  try {
    const norm = normalizeEmail(email);
    // 找出所有寄往該 Email、尚未指定 to_user_id、狀態仍為 pending 的轉贈
    const [list] = await conn.query(
      `SELECT id FROM ticket_transfers
       WHERE status = 'pending' AND to_user_id IS NULL AND LOWER(to_user_email) = LOWER(?)`,
      [norm]
    );
    for (const row of list) {
      try {
        await conn.beginTransaction();
        const [rows] = await conn.query('SELECT * FROM ticket_transfers WHERE id = ? AND status = "pending" LIMIT 1', [row.id]);
        if (!rows.length) { await conn.rollback(); continue }
        const tr = rows[0];
        if (String(tr.from_user_id) === String(userId)) { await conn.rollback(); continue }
        const [tkRows] = await conn.query('SELECT id, user_id, used FROM tickets WHERE id = ? LIMIT 1', [tr.ticket_id]);
        if (!tkRows.length) { await conn.rollback(); continue }
        const tk = tkRows[0];
        if (Number(tk.used)) { await conn.rollback(); continue }
        if (String(tk.user_id) !== String(tr.from_user_id)) { await conn.rollback(); continue }

        const [upd] = await conn.query('UPDATE tickets SET user_id = ? WHERE id = ? AND user_id = ?', [userId, tk.id, tr.from_user_id]);
        if (!upd.affectedRows) { await conn.rollback(); continue }
        await conn.query('UPDATE ticket_transfers SET status = "accepted", to_user_id = ? WHERE id = ?', [userId, tr.id]);
        await conn.query('UPDATE ticket_transfers SET status = "canceled" WHERE ticket_id = ? AND status = "pending" AND id <> ?', [tk.id, tr.id]);

        // Log transfer in/out
        try {
          const method = tr.code ? 'qr' : 'email'
          const [fromU] = await conn.query('SELECT email, username FROM users WHERE id = ? LIMIT 1', [tr.from_user_id])
          const metaCommon = { method, ticket_type: tk.type, transfer_id: tr.id, from_email: fromU?.[0]?.email || null, to_email: (email || null) }
          await logTicket({ conn, ticketId: tk.id, userId: tr.from_user_id, action: 'transferred_out', meta: metaCommon })
          await logTicket({ conn, ticketId: tk.id, userId, action: 'transferred_in', meta: metaCommon })
        } catch(_){}

        await conn.commit();
      } catch (_) {
        try { await conn.rollback() } catch {}
      }
    }
  } finally { conn.release() }
}

function normalizeDateInput(s) {
  if (!s) return null;
  if (typeof s !== 'string') return null;
  // Accept 'YYYY-MM-DD', 'YYYY/MM/DD', 'YYYY-MM-DDTHH:mm'
  let v = s.trim();
  if (!v) return null;
  v = v.replace('T', ' ').slice(0, 10).replaceAll('/', '-');
  return v;
}

function normalizeDateTimeInput(value) {
  if (value === undefined || value === null || value === '') return null;
  const pad = (n) => String(n).padStart(2, '0');
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  }
  const text = String(value || '').trim().replace('T', ' ');
  if (!text) return null;
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!match) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = match;
  return `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(s)}`;
}

function randomCode(n = 10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 避免混淆字元
  let s = '';
  for (let i = 0; i < n; i++) s += alphabet[crypto.randomInt(0, alphabet.length)];
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

async function generateEventCode() {
  let code;
  for (;;) {
    code = `EV${randomCode(6)}`;
    const [dup] = await pool.query('SELECT id FROM events WHERE code = ? LIMIT 1', [code]);
    if (!dup.length) break;
  }
  return code;
}

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

module.exports = {
  app,
  pool,
  ok,
  fail,
  storage,
  ALLOW_ORIGINS,
  corsConfig,
  authLimiter,
  cacheUtils,
  invalidateEventListCache,
  invalidateEventCaches,
  invalidateEventStoresCache,
  DEFAULT_CACHE_TTL,
  eventDetailCache,
  eventStoresCache,
  eventServicePricesCache,
  eventListCache,
  getEventById,
  listEventStores,
  listEventServicePrices,
  ensureReservationIdColumns,
  detectReservationIdColumns,
  detectChecklistPhotoStorageSupport,
  isChecklistPhotoStorageEnabled,
  detectEventCoverPathSupport,
  isEventCoverStorageEnabled,
  detectEventExclusiveColumn,
  ensureEventExclusiveColumn,
  detectEventListingStatusColumn,
  ensureEventListingStatusColumn,
  detectTicketCoverStorageSupport,
  isTicketCoverStorageEnabled,
  detectImageStorageColumns,
  reservationHasEventIdColumn,
  reservationHasStoreIdColumn,
  reservationHasDriverIdColumn,
  reservationHasDeliveryPointIdColumn,
  usersHaveProviderIdColumn,
  get usersHaveVipColumn(){ return usersHaveVipColumn; },
  get usersHaveServiceTermsColumn(){ return usersHaveServiceTermsColumn; },
  ensureUserVipColumn,
  ensureUserServiceTermsColumn,
  eventStoresHaveDeliveryPointIdColumn,
  ensureEventStoreCapacityColumn,
  ensureReservationAssignmentsTable,
  ensureEventDriverAssignmentsTable,
  ensureDeliveryPointsTable,
  ensureDeliveryPointCapacityColumn,
  ensureDeliveryPointProviderBindingsTable,
  ensureEventStoreDeliveryPointColumn,
  ensureEventStorePhaseColumns,
  ensureEventServicePricesTable,
  ensureReservationDeliveryPointColumn,
  ensureReservationTasksTable,
  ensureDeliveryPointSchema,
  listReservationAssignments,
  mapDeliveryPointRow,
  getDeliveryPointByUserId,
  getDeliveryPointIdByUserId,
  ensureDeliveryPointProfile,
  listDeliveryPoints,
  normalizeDeliveryPointCapacity,
  getReservationCapacityUsageForEvent,
  assertReservationCapacityAvailable,
  hasApprovedDeliveryPointProviderBinding,
  listStoreDeliveryPointRows,
  normalizeEventServicePriceMap,
  buildEventServicePriceRows,
  syncEventServicePrices,
  syncReservationTasksForIds,
  syncReservationTasksForDeliveryPointIds,
  listReservationTasksForAssignee,
  get checklistPhotosHaveStoragePath(){ return checklistPhotosHaveStoragePath; },
  get eventsHaveCoverPathColumn(){ return eventsHaveCoverPathColumn; },
  get eventsHaveExclusiveColumn(){ return eventsHaveExclusiveColumn; },
  get eventsHaveListingStatusColumn(){ return eventsHaveListingStatusColumn; },
  get ticketCoversHaveStoragePath(){ return ticketCoversHaveStoragePath; },
  get ticketsHaveProductIdColumn(){ return ticketsHaveProductIdColumn; },
  REQUIRE_EMAIL_VERIFICATION,
  RESTRICT_EMAIL_DOMAIN_TO_EDU_TW,
  PUBLIC_API_BASE,
  PUBLIC_WEB_URL,
  WEB_BASE,
  THEME_PRIMARY,
  FLEX_DEFAULT_ICON,
  EMAIL_FROM_NAME,
  EMAIL_FROM_ADDRESS,
  EMAIL_USER,
  EMAIL_PASS,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  LINE_CLIENT_ID,
  LINE_CLIENT_SECRET,
  LINE_BOT_CHANNEL_ACCESS_TOKEN,
  MAGIC_LINK_SECRET,
  LINE_BOT_QR_MAX_LENGTH,
  REMITTANCE_SETTING_KEYS,
  REMITTANCE_ENV_DEFAULTS,
  remittanceConfig,
  loadRemittanceConfig,
  LISTING_STATUS_DRAFT,
  LISTING_STATUS_PUBLISHED,
  normalizeListingStatus,
  isPublishedListingStatus,
  SITE_PAGE_KEYS,
  normalizeSiteSocialLinks,
  ORDER_EMAIL_CC_SETTING_KEY,
  getOrderEmailCcConfig,
  saveOrderEmailCcConfig,
  resolveOrderEmailCcRecipients,
  CHECKLIST_DEFINITION_SETTING_KEY,
  DEFAULT_RESERVATION_CHECKLIST_DEFINITIONS,
  reservationChecklistDefinitions,
  getReservationChecklistDefinitions,
  loadReservationChecklistDefinitions,
  persistReservationChecklistDefinitions,
  CHECKLIST_STAGE_KEYS,
  CHECKLIST_STAGES,
  CHECKLIST_ALLOWED_MIME,
  MAX_CHECKLIST_IMAGE_BYTES,
  CHECKLIST_PHOTO_LIMIT,
  isMailerReady,
  get mailerReady(){ return mailerReady; },
  transporter,
  escapeHtml,
  buildLeaderEmailHtml,
  zhReservationStatus,
  sendReservationStatusEmail,
  sendOrderNotificationEmail,
  signToken,
  cookieOptions,
  setAuthCookie,
  shortCookieOptions,
  publicApiBase,
  toQuery,
  httpsPostForm,
  httpsGetJson,
  httpsPostJson,
  hmacSha256Hex,
  safeEqual,
  flex,
  flexText,
  flexButtonUri,
  flexButtonMsg,
  flexBubble,
  simpleFlexMessage,
  imageFlexMessage,
  buildReservationFlexMessage,
  normalizeLineMessages,
  convertToFlexMessage,
  deriveFlexAltText,
  buildOrderCreatedFlex,
  buildOrderDoneFlex,
  buildTransferAcceptedForSenderFlex,
  buildTransferAcceptedForRecipientFlex,
  buildReservationStatusFlex,
  buildReservationProgressFlex,
  linePush,
  getLineSubjectByUserId,
  notifyLineByUserId,
  normalizeEmail,
  ensureTicketLogsTable,
  ensureTicketProductIdColumn,
  backfillTicketProductIds,
  ensureProductManagementSchema,
  logTicket,
  ensureOAuthIdentitiesTable,
  ensureAccountTombstonesTable,
  isTombstoned,
  getAuthedUser,
  autoAcceptTransfersForEmail,
  extractToken,
  normalizeRole,
  authRequired,
  isADMIN,
  isSERVICE_PROVIDER,
  isDRIVER,
  isDELIVERY_POINT,
  isSTORE,
  isEDITOR,
  hasBackofficeAccess,
  canManageProducts,
  canManageEvents,
  canManageReservations,
  canUseScan,
  canManageOrders,
  adminOnly,
  staffRequired,
  adminOrEditorOnly,
  productManagerOnly,
  eventManagerOnly,
  reservationManagerOnly,
  scanAccessOnly,
  serviceProviderOnly,
  driverOnly,
  deliveryPointOnly,
  safeParseJSON,
  ensureRemittanceColumns,
  ensureUserRemittanceColumns,
  ensureEventStoreRemittanceColumns,
  normalizeRemittanceDetails,
  hasRemittanceDetails,
  mergeRemittanceDetails,
  applyRemittanceDetails,
  getProviderRemittanceConfig,
  saveProviderRemittanceConfig,
  normalizeProviderServiceTerms,
  getProviderServiceTerms,
  saveProviderServiceTerms,
  listProviderServiceTerms,
  resolveOrderRemittance,
  hydrateOrderRemittance,
  cloneChecklistDefinitions,
  normalizeChecklistDefinitionStage,
  normalizeReservationChecklistDefinitions,
  sanitizeStageForPath,
  sanitizeReservationIdForPath,
  sanitizeTicketTypeForPath,
  buildChecklistStoragePath,
  buildChecklistPhotoUrl,
  buildEventCoverStoragePath,
  buildTicketCoverStoragePath,
  buildProductCoverStoragePath,
  parseDataUri,
  checklistColumnByStage,
  normalizeChecklist,
  encodePhotoToDataUrl,
  ensureChecklistHasPhotos,
  listChecklistPhotos,
  listChecklistPhotosBulk,
  ensureChecklistReservationAccess,
  fetchReservationById,
  hydrateReservationChecklists,
  isChecklistStage,
  mergeChecklistWithPhotos,
  reservationIdToKey,
  formatAdminReservationRow,
  buildAdminReservationSummaries,
  normalizeCartItems,
  normalizeUserId,
  getRemittanceConfig,
  defaultRemittanceDetails,
  ensureRemittance,
  ensureUserContactInfoReady,
  setAppSetting,
  deleteAppSetting,
  getSitePages,
  getUserContact,
  summarizeOrderDetails,
  formatDateYYYYMMDD,
  formatDateDisplay,
  formatDateRangeDisplay,
  formatReservationDisplayId,
  buildQrUrl,
  getReservationStageCode,
  randomCode,
  generateOrderCode,
  generateReservationStageCode,
  generateEventCode,
  generateProductCode,
  parsePositiveInt,
  parseBoolean,
  normalizePositiveInt,
  reservationInsertColumns,
  buildReservationInsertRow,
  insertReservationsBulk,
  parseBooleanParam,
  fetchReservationContext,
  fetchReservationsContext,
  summarizeReservationSchedule,
  buildReservationSectionHtml,
  composeReservationPaymentContent,
  composeChecklistCompletionContent,
  composeStageProgressContent,
  notifyReservationStageChange,
  normalizeDateInput,
  normalizeDateTimeInput,
};
