// server.js
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { randomUUID, randomInt } = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { z } = require('zod');
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
let checklistPhotosHaveStoragePath = false;
let eventsHaveCoverPathColumn = false;
let ticketCoversHaveStoragePath = false;
const DEFAULT_CACHE_TTL = 30 * 1000;
const eventDetailCache = new Map();
const eventStoresCache = new Map();
const eventListCache = { value: null, expiresAt: 0 };

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
}
ensureReservationIdColumns().catch((err) => {
  console.error('ensureReservationIdColumns error:', err?.message || err);
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
let remittanceConfig = { ...REMITTANCE_ENV_DEFAULTS };
const SITE_PAGE_KEYS = {
  terms: 'site_terms',
  privacy: 'site_privacy',
  reservationNotice: 'site_reservation_notice',
  reservationRules: 'site_reservation_rules',
};
const CHECKLIST_DEFINITION_SETTING_KEY = 'reservation_checklist_definitions';
const DEFAULT_RESERVATION_CHECKLIST_DEFINITIONS = {
  pre_dropoff: {
    title: '賽前交車檢核表',
    items: [
      '車輛與配件與預約資訊相符',
      '托運文件、標籤與聯絡方式已確認',
      '完成車況拍照（含序號、特殊配件）',
    ],
  },
  pre_pickup: {
    title: '賽前取車檢核表',
    items: [
      '車輛外觀、輪胎與配件無異常',
      '車牌、證件與隨車用品已領取',
      '與店員完成車況紀錄或拍照存證',
    ],
  },
  post_dropoff: {
    title: '賽後交車檢核表',
    items: [
      '車輛停放於指定區域並妥善固定',
      '與店員核對賽後車況與隨車用品',
      '拍攝交車現場與車況照片備查',
    ],
  },
  post_pickup: {
    title: '賽後取車檢核表',
    items: [
      '車輛外觀無新增損傷與污漬',
      '賽前寄存的隨車用品已領回',
      '與店員完成賽後車況點交紀錄',
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
  const storeName = String(store || '門市');
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
  const html = emailHtml || `
        <p>您好，您的預約狀態已更新：</p>
        <ul>
          <li><strong>活動：</strong>${title}</li>
          <li><strong>門市：</strong>${storeName}</li>
          <li><strong>狀態：</strong>${zh}</li>
        </ul>
        <p>您可前往錢包查看預約詳情與進度：</p>
        <p><a href="${walletUrl}">${walletUrl}</a></p>
        <p style="color:#888; font-size:12px;">此信件由系統自動發送，請勿直接回覆。</p>
      `;
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

async function sendOrderNotificationEmail({ to, username, orders = [], type = 'created', userId, lineMessages, lineText, emailSubject, emailHtml } = {}) {
  const list = Array.isArray(orders) ? orders.filter(o => o && (o.code || o.id)) : [];
  const first = list[0] || {};
  const defaultLine = lineMessages ? null : (lineText || (type === 'completed'
    ? `【Leader Online】您的訂單${first.code ? ` ${first.code}` : ''} 已完成，匯款確認成功。`
    : `【Leader Online】已建立訂單${first.code ? ` ${first.code}` : ''}，請留意匯款資訊。`));
  const linePayload = lineMessages || defaultLine;
  if (userId && linePayload) {
    try { await notifyLineByUserId(userId, linePayload) } catch (_) { /* ignore line errors */ }
  }

  if (!mailerReady) return { mailed: false, reason: 'mailer_not_ready' };
  const email = String(to || '').trim();
  if (!email) return { mailed: false, reason: 'no_email' };
  if (!list.length) return { mailed: false, reason: 'no_orders' };

  const subjectBase = type === 'completed' ? '訂單已完成' : '訂單已建立';
  const defaultSubject = `${subjectBase}${list.length === 1 ? `：${list[0].code || list[0].id || ''}` : ''}`;
  const greeting = username ? `${username} 您好，` : '您好，';
  const intro = type === 'completed'
    ? '我們已確認以下訂單完成匯款，感謝您的耐心等待。'
    : '已為您建立以下訂單，請依照匯款資訊完成付款。';

  const listHtml = list.map((o) => {
    const code = o.code || o.id || '';
    const amount = Number(o.total || 0);
    const amountText = amount > 0 ? `（金額：NT$${amount.toLocaleString('zh-TW')}）` : '';
    const status = o.status ? `（狀態：${o.status}）` : '';
    const detailsLines = Array.isArray(o.detailsSummary) ? o.detailsSummary : [];
    const detailHtml = detailsLines.length ? `<ul style="margin:6px 0 0 18px;padding:0;">${detailsLines.map(line => `<li>${line}</li>`).join('')}</ul>` : '';
    return `<li><strong>訂單編號：</strong>${code}${amountText}${status}${detailHtml}</li>`;
  }).join('');

  const remittanceSource = list.find(o => o && o.remittance && Object.keys(o.remittance || {}).length);
  const remittance = remittanceSource ? remittanceSource.remittance : defaultRemittanceDetails();
  const remittanceItems = [];
  if (remittance.info) remittanceItems.push(`<li>${remittance.info}</li>`);
  if (remittance.bankCode) remittanceItems.push(`<li>銀行代碼：${remittance.bankCode}</li>`);
  if (remittance.bankAccount) remittanceItems.push(`<li>銀行帳戶：${remittance.bankAccount}</li>`);
  if (remittance.accountName) remittanceItems.push(`<li>帳戶名稱：${remittance.accountName}</li>`);
  if (remittance.bankName) remittanceItems.push(`<li>銀行名稱：${remittance.bankName}</li>`);
  const remittanceHtml = remittanceItems.length ? `<p>匯款資訊：</p><ul>${remittanceItems.join('')}</ul>` : '';

  const outro = type === 'completed'
    ? '我們已收到您的匯款並完成訂單，祝您使用愉快！'
    : '若您已完成匯款，請耐心等候管理員確認。';

  const htmlDefault = `
        <p>${greeting}</p>
        <p>${intro}</p>
        <ul>${listHtml}</ul>
        ${remittanceHtml}
        <p>${outro}</p>
        <p style="color:#888; font-size:12px;">此信件由系統自動發送，請勿直接回覆。</p>
      `;
  const subject = emailSubject || defaultSubject;
  const html = emailHtml || htmlDefault;

  try {
    await transporter.sendMail({
      from: `${EMAIL_FROM_NAME} <${EMAIL_FROM_ADDRESS}>`,
      to: email,
      subject,
      html,
    });
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
      const req = https.request(opts, (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => buf += c);
        res.on('end', () => {
          try { resolve(JSON.parse(buf)); } catch (e) { reject(e) }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    } catch (e){ reject(e) }
  })
}

function httpsGetJson(url, headers={}){
  return new Promise((resolve, reject) => {
    try{
      const u = new URL(url);
      const opts = { method: 'GET', hostname: u.hostname, path: u.pathname + (u.search||''), port: u.port || 443, headers };
      const req = https.request(opts, (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => buf += c);
        res.on('end', () => { try { resolve(JSON.parse(buf)) } catch (e) { reject(e) } });
      });
      req.on('error', reject);
      req.end();
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
      const req = https.request(opts, (res) => {
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
      });
      req.on('error', reject);
      req.write(data);
      req.end();
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
      Number(order.total || 0) ? flexText(`總金額：NT$${Number(order.total || 0).toLocaleString('zh-TW')}`) : null,
    ].filter(Boolean);
    const detailLines = Array.isArray(order.detailsSummary) ? order.detailsSummary : [];
    if (detailLines.length) {
      lines.push(flexText('訂單詳情', { margin: 'md', weight: 'bold', size: 'sm' }));
      for (const d of detailLines) lines.push(flexText(`• ${d}`, { size: 'xs', color: '#555555' }));
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
function buildOrderDoneFlex(code, total = null){
  const lines = [flexText(`您的訂單 ${code || ''} 已完成。`)];
  if (Number(total || 0)) {
    lines.push(flexText(`金額：NT$${Number(total || 0)}`, { size: 'xs', color: '#555555' }));
  }
  lines.push(flexText('感謝您的匯款與支持！', { size: 'xs', color: '#555555' }));
  return flex('訂單已完成', flexBubble({ title: '訂單已完成', lines }));
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
    flexText(`活動：${eventTitle || '預約'}`),
    flexText(`門市：${store || '-'}`),
    flexText(`狀態：${zhStatus || '-'}`),
  ];
  return flex(title, flexBubble({ title, lines }));
}
function buildReservationProgressFlex(eventTitle, store, zhNext){
  const title = '預約進度';
  const lines = [
    flexText(`活動：${eventTitle || '預約'}`),
    flexText(`門市：${store || '-'}`),
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

const normalizeRole = (role) => String(role || '').toUpperCase();

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
function isSTORE(role){ return normalizeRole(role) === 'STORE' }
function isEDITOR(role){ return normalizeRole(role) === 'EDITOR' }
function isOPERATOR(role){ return normalizeRole(role) === 'OPERATOR' }
function hasBackofficeAccess(role){ return isADMIN(role) || isSTORE(role) || isEDITOR(role) || isOPERATOR(role) }
function canManageProducts(role){ return isADMIN(role) || isEDITOR(role) }
function canManageEvents(role){ return isADMIN(role) || isSTORE(role) || isEDITOR(role) }
function canManageReservations(role){ return isADMIN(role) || isSTORE(role) }
function canUseScan(role){ return isADMIN(role) || isSTORE(role) || isOPERATOR(role) }
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

function eventManagerOnly(req, res, next){
  staffRequired(req, res, () => {
    if (!canManageEvents(req.user?.role)) return fail(res, 'FORBIDDEN', '需要活動管理權限', 403);
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
  staffRequired(req, res, () => {
    if (!canUseScan(req.user?.role)) return fail(res, 'FORBIDDEN', '需要掃描權限', 403);
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

async function ensureChecklistReservationAccess(reservationId, reqUser) {
  const reservation = await fetchReservationById(reservationId);
  if (!reservation) {
    return { ok: false, status: 404, code: 'RESERVATION_NOT_FOUND', message: '找不到預約' };
  }
  if (!reqUser || !reqUser.id) {
    return { ok: false, status: 401, code: 'AUTH_REQUIRED', message: '請先登入' };
  }
  const isOwner = String(reservation.user_id) === String(reqUser.id);
  const isStaff = isADMIN(reqUser.role) || isSTORE(reqUser.role);
  if (!isOwner && !isStaff) {
    return { ok: false, status: 403, code: 'FORBIDDEN', message: '無權限操作此預約' };
  }
  return { ok: true, reservation, isOwner, isStaff };
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
    ticket_type: row.ticket_type,
    store: row.store,
    event: row.event,
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

async function getSitePages() {
  const map = await getAppSettings(Object.values(SITE_PAGE_KEYS));
  return {
    terms: map[SITE_PAGE_KEYS.terms] || '',
    privacy: map[SITE_PAGE_KEYS.privacy] || '',
    reservationNotice: map[SITE_PAGE_KEYS.reservationNotice] || '',
    reservationRules: map[SITE_PAGE_KEYS.reservationRules] || '',
  };
}

function defaultRemittanceDetails() {
  return getRemittanceConfig();
}

function ensureRemittance(details = {}) {
  if (!details || typeof details !== 'object') return details || {};
  const defaults = defaultRemittanceDetails();
  const current = (details && typeof details.remittance === 'object' && details.remittance) ? details.remittance : {};
  for (const [key, value] of Object.entries(defaults)) {
    if (value && (current[key] == null || current[key] === '')) current[key] = value;
  }
  details.remittance = current;
  if (!details.bankInfo && current.info) details.bankInfo = current.info;
  if (!details.bankCode && current.bankCode) details.bankCode = current.bankCode;
  if (!details.bankAccount && current.bankAccount) details.bankAccount = current.bankAccount;
  if (!details.bankAccountName && current.accountName) details.bankAccountName = current.accountName;
  if (!details.bankName && current.bankName) details.bankName = current.bankName;
  return details;
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
      const store = sel.store || '';
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
  if (addOn) lines.push(`加購：NT$${addOn.toLocaleString('zh-TW')}`);
  const discount = Number(details.discount || 0);
  if (discount) lines.push(`折扣：-NT$${discount.toLocaleString('zh-TW')}`);
  if (!lines.length && total) lines.push(`總金額：NT$${total.toLocaleString('zh-TW')}`);
  return lines;
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

function reservationInsertColumns() {
  const base = ['user_id', 'ticket_type', 'store', 'event'];
  if (reservationHasEventIdColumn) base.push('event_id');
  if (reservationHasStoreIdColumn) base.push('store_id');
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
  const [rows] = await pool.query(
    'SELECT id, code, title, starts_at, ends_at, deadline, location, description, cover, cover_type, rules, owner_user_id, created_at, updated_at FROM events WHERE id = ? LIMIT 1',
    [normalized]
  );
  if (!rows.length) return null;
  const event = rows[0];
  if (event.cover_data) delete event.cover_data;
  if (!event.code) event.code = `EV${String(event.id).padStart(6, '0')}`;
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
  const [rows] = await pool.query(
    'SELECT id, event_id, name, pre_start, pre_end, post_start, post_end, prices, created_at, updated_at FROM event_stores WHERE event_id = ? ORDER BY id ASC',
    [normalized]
  );
  const list = rows.map(r => ({
    ...r,
    prices: safeParseJSON(r.prices, {}),
  }));
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
    const [sRows] = await pool.query(
      'SELECT id, event_id, name, pre_start, pre_end, post_start, post_end, prices, created_at, updated_at FROM event_stores WHERE id = ? LIMIT 1',
      [storeIdStored]
    );
    if (sRows.length) {
      const s = sRows[0];
      storeRow = s;
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
      `SELECT s.id, s.event_id, s.name, s.pre_start, s.pre_end, s.post_start, s.post_end, s.prices, s.created_at, s.updated_at,
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
        pre_start: row.pre_start,
        pre_end: row.pre_end,
        post_start: row.post_start,
        post_end: row.post_end,
        prices: row.prices,
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
        <li>
          <strong>${row.label}：</strong>${row.value}
        </li>`
    )
    .join('');
  return `
    <section style="margin:18px 0;">
      <h4 style="margin:0 0 6px 0;font-size:16px;color:#b00000;">${title}</h4>
      <ul style="margin:0;padding:0 0 0 18px;">${items}</ul>
    </section>
  `;
}

function composeReservationPaymentContent({ contexts = [], tickets = [], orderSummary = {} }) {
  const reservationSections = contexts.map((ctx) => {
    const { reservation, eventTitle, storeName, timings } = (() => {
      const summary = summarizeReservationSchedule(ctx);
      return { reservation: ctx.reservation || {}, eventTitle: summary.eventTitle, storeName: summary.storeName, timings: summary.timings };
    })();
    const code = getReservationStageCode(reservation, 'pre_dropoff') || '（待交車時提供）';
    const rows = [
      { label: '活動', value: eventTitle || '未命名活動' },
      { label: '預約編號', value: formatReservationDisplayId(reservation.id || '') },
      storeName ? { label: '門市', value: storeName } : null,
      reservation.ticket_type ? { label: '票種', value: reservation.ticket_type } : null,
      timings.preWindow ? { label: '賽前交車時間', value: timings.preWindow } : null,
      timings.eventWindow ? { label: '賽事時間', value: timings.eventWindow } : null,
      timings.eventLocation ? { label: '賽事地點', value: timings.eventLocation } : null,
      { label: '交車驗證碼', value: code },
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

  const payable = Number(orderSummary.total || 0);
  if (payable > 0) {
    emailParts.push(`<p style="margin:12px 0;">訂單金額：NT$${payable.toLocaleString('zh-TW')}</p>`);
  }
  emailParts.push(
    `<p style="margin:18px 0 6px 0;">提醒您：</p>
     <ul style="margin:0 0 18px 18px;padding:0;">
       <li>交車時請務必出示交車驗證碼，並與現場人員完成檢查表。</li>
       <li>檢查表完成後，系統會再傳送託運單與 QRCode，方便您後續追蹤。</li>
       <li>若有其他問題，歡迎回覆此信或洽客服專線。</li>
     </ul>`
  );

  const uniqueEvents = Array.from(
    new Set(
      reservationSections
        .map((s) => {
          const row = s.rows.find((r) => r.label === '活動');
          return row ? row.value : '';
        })
        .filter(Boolean)
    )
  );

  const emailSubject = uniqueEvents.length
    ? `預約確認：${uniqueEvents.join('、')}`
    : '預約付款確認';
  const emailHtml = `
    <p>您好，我們已完成匯款確認，以下為您的預約/票券資訊：</p>
    ${emailParts.join('\n')}
    <p style="color:#888;font-size:12px;">此信件由系統自動寄出，若有任何疑問請與我們聯絡。</p>
  `;

  const introText = '匯款已完成，以下是您的預約資訊：';
  const lineMessages = [];
  const headerText = [introText, uniqueEvents.length ? `活動：${uniqueEvents.join('、')}` : null]
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
  const stageLabel = stage === 'pre_dropoff' ? '託運單' : '回程託運單';
  const extraNote =
    stage === 'pre_dropoff'
      ? '此驗證碼為託運單號，後續查詢或取車時請出示。'
      : '此為回程託運單號，請保留供車店取車時確認。';
  const codeDisplay = code ? code : '尚未建立驗證碼，請聯繫客服。';
  const lastFour = code ? code.slice(-4) : '';

  const subject = `${stageLabel}確認：${eventTitle || '預約'}`;
  const rows = [
    { label: '活動', value: eventTitle || '預約' },
    { label: '預約編號', value: reservationIdText },
    storeName ? { label: '門市', value: storeName } : null,
    timings.preWindow && stage === 'pre_dropoff' ? { label: '賽前交車時間', value: timings.preWindow } : null,
    timings.postWindow && stage !== 'pre_dropoff' ? { label: '賽後交車時間', value: timings.postWindow } : null,
    { label: `${stageLabel}驗證碼`, value: codeDisplay },
  ].filter(Boolean);

  const emailHtml = `
    <p>${stage === 'pre_dropoff' ? '檢查表已完成，我們已更新託運單資訊：' : '賽後檢查表已完成，以下為回程託運單資訊：'}</p>
    ${buildReservationSectionHtml({ title: `${stageLabel}資訊`, rows })}
    <p>${extraNote}</p>
    ${qrUrl ? `<p>QRCode：<br/><img src="${qrUrl}" alt="QRCode" style="max-width:240px;border:1px solid #eee;padding:8px;margin-top:6px;" /></p>` : ''}
    <p style="color:#888;font-size:12px;">此信件由系統自動寄出。</p>
  `;

  const headline =
    stage === 'pre_dropoff'
      ? '託運檢查完成，以下是託運單資訊：'
      : '賽後檢查完成，以下是回程託運單資訊：';
  const messageLines = [
    headline,
    `活動：${eventTitle || '預約'}`,
    `預約編號：${reservationIdText}`,
    storeName ? `門市：${storeName}` : null,
    stage === 'pre_dropoff' && timings.preWindow ? `賽前交車：${timings.preWindow}` : null,
    stage !== 'pre_dropoff' && timings.postWindow ? `賽後交車：${timings.postWindow}` : null,
    code ? `${stageLabel}驗證碼：${code}` : `${stageLabel}驗證碼尚未建立，請聯繫客服`,
    stage === 'post_dropoff' && lastFour ? `回程託運單後四碼：${lastFour}` : null,
    extraNote ? { text: extraNote, size: 'xs', color: '#666666' } : null,
  ].filter(Boolean);

  const bubbleTitle = stage === 'pre_dropoff' ? '託運檢查完成' : '回程檢查完成';
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
          headline: '賽場取車資訊如下：',
          rows: [
            timings.eventWindow ? { label: '賽事時間', value: timings.eventWindow } : null,
            timings.eventLocation ? { label: '賽事地點', value: timings.eventLocation } : null,
            code ? { label: '取車驗證碼', value: code } : null,
          ].filter(Boolean),
          reminder: '抵達賽場取車時請出示取車驗證碼與證件。',
        };
      case 'post_dropoff':
        return {
          headline: '賽後交車資訊如下：',
          rows: [
            timings.postWindow ? { label: '賽後交車時間', value: timings.postWindow } : null,
            timings.eventLocation ? { label: '交車地點', value: timings.eventLocation } : null,
            code ? { label: '賽後交車驗證碼', value: code } : null,
          ].filter(Boolean),
          reminder: '賽後交車時請出示驗證碼，並與現場人員完成檢查。',
        };
      case 'post_pickup':
        return {
          headline: '車店取車資訊如下：',
          rows: [
            storeName ? { label: '車店', value: storeName } : null,
            timings.postWindow ? { label: '車店取車時間', value: timings.postWindow } : null,
            code ? { label: '取車號', value: code } : null,
          ].filter(Boolean),
          reminder: '請攜帶取車號與身分證件至車店完成領車。',
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
    { label: '活動', value: eventTitle || '預約' },
    { label: '預約編號', value: reservationIdText },
    storeName ? { label: '門市', value: storeName } : null,
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
    `活動：${eventTitle || '預約'}`,
    `預約編號：${reservationIdText}`,
    storeName ? `門市：${storeName}` : null,
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
    const storeName = context?.store?.name || reservation.store || '門市';
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
  eventListCache,
  getEventById,
  listEventStores,
  ensureReservationIdColumns,
  detectReservationIdColumns,
  detectChecklistPhotoStorageSupport,
  isChecklistPhotoStorageEnabled,
  detectEventCoverPathSupport,
  detectTicketCoverStorageSupport,
  detectImageStorageColumns,
  reservationHasEventIdColumn,
  reservationHasStoreIdColumn,
  checklistPhotosHaveStoragePath,
  eventsHaveCoverPathColumn,
  ticketCoversHaveStoragePath,
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
  SITE_PAGE_KEYS,
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
  isSTORE,
  isEDITOR,
  isOPERATOR,
  hasBackofficeAccess,
  canManageProducts,
  canManageEvents,
  canManageReservations,
  canUseScan,
  canManageOrders,
  adminOnly,
  staffRequired,
  adminOrEditorOnly,
  eventManagerOnly,
  reservationManagerOnly,
  scanAccessOnly,
  safeParseJSON,
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
};
