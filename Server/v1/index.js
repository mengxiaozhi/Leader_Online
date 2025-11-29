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
const storage = require('./storage');
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
let eventListCache = { value: null, expiresAt: 0 };

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
  eventListCache = { value: null, expiresAt: 0 };
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

let mailerReady = false;
const transporter = nodemailer.createTransport(EMAIL_USER && EMAIL_PASS ? {
  service: 'gmail',
  auth: { user: EMAIL_USER, pass: EMAIL_PASS },
} : {});

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
app.get('/auth/magic_link', async (req, res) => {
  try{
    if (!MAGIC_LINK_SECRET) return res.status(500).send('Magic link not configured');
    const provider = String(req.query?.provider || '').trim().toLowerCase();
    const subject = String(req.query?.subject || '').trim();
    const redirect = String(req.query?.redirect || '/store');
    const tsRaw = String(req.query?.ts || '');
    const sig = String(req.query?.sig || '');
    if (!provider || !subject || !tsRaw || !sig) return res.status(400).send('Missing params');
    if (!redirect.startsWith('/')) return res.status(400).send('Invalid redirect');
    const ts = Number(tsRaw);
    if (!Number.isFinite(ts)) return res.status(400).send('Bad ts');
    const now = Date.now();
    const webBase = (PUBLIC_WEB_URL || 'http://localhost:5173').replace(/\/$/, '');
    const renderExpired = () => {
      const loginUrl = `${webBase}/login`;
      return res.status(200).send(`<!DOCTYPE html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <title>連結已過期</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="3;url=${loginUrl}">
    <style>
      body { display:flex; align-items:center; justify-content:center; min-height:100vh; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#f9fafb; margin:0; }
      .card { max-width:360px; background:#fff; padding:32px; border:1px solid #e5e7eb; box-shadow:0 10px 30px -12px rgba(15, 23, 42, .35); text-align:center; border-radius:12px; }
      h1 { font-size:20px; margin-bottom:12px; color:#111827; }
      p { font-size:14px; color:#4b5563; line-height:1.6; margin-bottom:0; }
      .countdown { margin-top:18px; font-size:13px; color:#9ca3af; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>連結已過期</h1>
      <p>此登入連結已失效或超過有效時間，請重新透過 LINE 取得新的登入連結。</p>
      <p class="countdown">即將為您跳轉到登入頁面…</p>
    </div>
    <script>
      setTimeout(function () { window.location.href = '${loginUrl}'; }, 2900);
    </script>
  </body>
</html>`);
    };
    // 5 minutes window
    if (Math.abs(now - ts) > 5 * 60 * 1000) return renderExpired();
    const payload = `${provider}:${subject}:${redirect}:${ts}`;
    const expected = hmacSha256Hex(MAGIC_LINK_SECRET, payload);
    if (!safeEqual(sig, expected)) return res.status(400).send('Invalid signature');

    await ensureOAuthIdentitiesTable();
    // Block if this subject has been tombstoned (e.g., account deleted)
    try{
      const denied = await isTombstoned({ provider, subject });
      if (denied) return res.status(404).send('User not found');
    } catch(_){}
    const [rows] = await pool.query(
      'SELECT u.id, u.username, u.email, u.role FROM oauth_identities oi JOIN users u ON u.id = oi.user_id WHERE oi.provider = ? AND oi.subject = ? LIMIT 1',
      [provider, subject]
    );
    if (!rows.length) return res.status(404).send('User not found');
    const u = rows[0];
    const role = String(u.role || 'USER').toUpperCase();
    const token = signToken({ id: u.id, email: u.email, username: u.username, role });
    setAuthCookie(res, token);
    // Route via login page so front-end's existing #token handler takes effect even if third-party cookies are blocked
    const nextPath = (redirect && String(redirect).startsWith('/')) ? String(redirect) : '/store';
    const target = `${webBase}/login?redirect=${encodeURIComponent(nextPath)}#token=${encodeURIComponent(token)}`;
    return res.redirect(302, target);
  } catch (err) {
    return res.status(500).send('Magic link error');
  }
});

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

function normalizeDateInput(s) {
  if (!s) return null;
  if (typeof s !== 'string') return null;
  // Accept 'YYYY-MM-DD', 'YYYY/MM/DD', 'YYYY-MM-DDTHH:mm'
  let v = s.trim();
  if (!v) return null;
  v = v.replace('T', ' ').slice(0, 10).replaceAll('/', '-');
  return v;
}

/** ======== 驗證 Schema ======== */
const RegisterSchema = z.object({
  username: z.string().min(2).max(50),
  email: z.string().email(),
  password: z.string().min(8).max(100),
});
const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
});

/** ======== 健康檢查 / 偵錯 ======== */
app.get('/healthz', (req, res) => ok(res, { uptime: process.uptime() }, 'OK'));
app.get('/__debug/echo', (req, res) => {
  res.json({
    host: req.headers.host,
    origin: req.headers.origin || null,
    secure: req.secure,
    cookies_seen: Object.keys(req.cookies || {}),
    has_auth_token: Boolean(req.cookies?.auth_token),
    cors_allow_origins: ALLOW_ORIGINS,
  });
});

/** ======== Google OAuth 2.0 ======== */
app.get('/auth/google/start', (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return res.status(500).send('OAuth not configured');
  const next = (req.query.redirect || '/store').toString();
  const mode = (req.query.mode || 'login').toString(); // 'login' | 'link'
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('oauth_state', state, shortCookieOptions());
  res.cookie('oauth_next', next, shortCookieOptions());
  res.cookie('oauth_mode', mode, shortCookieOptions());
  const redirectUri = `${publicApiBase(req)}/auth/google/callback`;
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + toQuery({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return res.redirect(302, authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
  try{
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return res.status(500).send('OAuth not configured');
    const { code, state } = req.query || {};
    if (!code || !state) return res.status(400).send('Missing code/state');
    if (String(state) !== String(req.cookies?.oauth_state || '')) return res.status(400).send('Invalid state');
    const next = (req.cookies?.oauth_next || '/store').toString();
    const mode = (req.cookies?.oauth_mode || 'login').toString();
    // Clear temp cookies
    res.clearCookie('oauth_state', shortCookieOptions());
    res.clearCookie('oauth_next', shortCookieOptions());
    res.clearCookie('oauth_mode', shortCookieOptions());

    const redirectUri = `${publicApiBase(req)}/auth/google/callback`;
    // Exchange code for tokens
    const tokenResp = await httpsPostForm('https://oauth2.googleapis.com/token', {
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code: String(code),
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    const accessToken = tokenResp.access_token;
    if (!accessToken) return res.status(400).send('Token exchange failed');
    // Fetch userinfo
    const profile = await httpsGetJson('https://www.googleapis.com/oauth2/v3/userinfo', { Authorization: `Bearer ${accessToken}` });
    const email = (profile?.email || '').toLowerCase().trim();
    const name = (profile?.name || '').toString();
    const subject = (profile?.sub || '').toString();
    if (!email) return res.status(400).send('Google email not available');
    if (!subject) return res.status(400).send('Google subject not available');

    // 若此 subject/email 已被標記為 tombstone（帳號曾刪除），禁止登入或重新建立
    try{
      const denied = await isTombstoned({ provider: 'google', subject, email });
      if (denied){
        const back = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/login?oauth_error=account_deleted`;
        return res.redirect(302, back);
      }
    } catch(_){}

    await ensureOAuthIdentitiesTable();

    // Link mode: bind Google to current signed-in user
    if (mode === 'link'){
      const authed = getAuthedUser(req);
      if (!authed?.id) {
        const back = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/login?link_error=not_signed_in`;
        return res.redirect(302, back);
      }
      // Tombstone check: 若 subject 被封鎖，禁止綁定
      try{
        const denied = await isTombstoned({ provider: 'google', subject });
        if (denied){
          const back = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/account?link_error=google_tombstoned`;
          return res.redirect(302, back);
        }
      } catch(_){}
      const [ex] = await pool.query('SELECT user_id FROM oauth_identities WHERE provider = ? AND subject = ? LIMIT 1', ['google', subject]);
      if (ex.length && String(ex[0].user_id) !== String(authed.id)){
        const back = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/account?link_error=google_taken`;
        return res.redirect(302, back);
      }
      if (!ex.length){
        await pool.query('INSERT INTO oauth_identities (user_id, provider, subject, email) VALUES (?, ?, ?, ?)', [authed.id, 'google', subject, email]);
      }
      const back = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/account?linked=google`;
      return res.redirect(302, back);
    }

    // Login mode: prefer mapping by provider subject; else fallback to email; else create new user and link
    let userRow = null;
    const [mapped] = await pool.query('SELECT u.id, u.username, u.email, u.role FROM oauth_identities oi JOIN users u ON u.id = oi.user_id WHERE oi.provider = ? AND oi.subject = ? LIMIT 1', ['google', subject]);
    if (mapped.length){
      userRow = mapped[0];
    } else {
      const [found] = await pool.query('SELECT id, username, email, role FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [email]);
      if (found.length){
        userRow = found[0];
        try { await pool.query('INSERT INTO oauth_identities (user_id, provider, subject, email) VALUES (?, ?, ?, ?)', [userRow.id, 'google', subject, email]) } catch(_){}
      } else {
        const id = randomUUID();
        const username = name || email.split('@')[0];
        const randomPass = crypto.randomBytes(16).toString('hex');
        const hash = await bcrypt.hash(randomPass, 12);
        try {
          await pool.query('INSERT INTO users (id, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?)', [id, username, email, hash, 'USER']);
        } catch (e) {
          if (e?.code === 'ER_BAD_FIELD_ERROR') {
            await pool.query('INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)', [id, username, email, hash]);
          } else { throw e }
        }
        try { await autoAcceptTransfersForEmail(id, email) } catch(_){}
        try { await pool.query('INSERT INTO oauth_identities (user_id, provider, subject, email) VALUES (?, ?, ?, ?)', [id, 'google', subject, email]) } catch(_){}
        // Force first-time password setup
        try {
          await ensurePasswordResetsTable();
          const resetToken = generateResetToken();
          const tokenExpiry = Date.now() + 60 * 60 * 1000; // 1 時
          await pool.query('INSERT INTO password_resets (user_id, email, token, token_expiry, used) VALUES (?, ?, ?, ?, 0)', [id, email, resetToken, tokenExpiry]);
          const target = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/reset?token=${resetToken}&first=1`;
          return res.redirect(302, target);
        } catch (_) {
          // Fallback: allow login if reset link setup fails
          userRow = { id, username, email, role: 'USER' };
        }
      }
    }

    const role = String(userRow.role || 'USER').toUpperCase();
    const jwtToken = signToken({ id: userRow.id, email: userRow.email, username: userRow.username, role });
    setAuthCookie(res, jwtToken);
    // 同時透過 URL fragment 傳遞 Bearer，解決某些瀏覽器阻擋跨站 Cookie 的情況
    const webBase = PUBLIC_WEB_URL.replace(/\/$/, '');
    const nextPath = (next && String(next).startsWith('/')) ? String(next) : '/store';
    const target = `${webBase}/login?oauth=google&redirect=${encodeURIComponent(nextPath)}#token=${encodeURIComponent(jwtToken)}`;
  return res.redirect(302, target);
} catch (err) {
  console.error('Google OAuth error:', err?.message || err);
  const back = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/login?oauth_error=google`;
  return res.redirect(302, back);
}
});

/** ======== LINE Login (OAuth 2.0 + OIDC) ======== */
app.get('/auth/line/start', (req, res) => {
  if (!LINE_CLIENT_ID || !LINE_CLIENT_SECRET) return res.status(500).send('OAuth not configured');
  const next = (req.query.redirect || '/store').toString();
  const mode = (req.query.mode || 'login').toString(); // 'login' | 'link'
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('oauth_state', state, shortCookieOptions());
  res.cookie('oauth_next', next, shortCookieOptions());
  res.cookie('oauth_mode', mode, shortCookieOptions());
  const redirectUri = `${publicApiBase(req)}/auth/line/callback`;
  const authUrl = 'https://access.line.me/oauth2/v2.1/authorize?' + toQuery({
    response_type: 'code',
    client_id: LINE_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    prompt: 'consent',
    state,
  });
  return res.redirect(302, authUrl);
});

app.get('/auth/line/callback', async (req, res) => {
  try{
    if (!LINE_CLIENT_ID || !LINE_CLIENT_SECRET) return res.status(500).send('OAuth not configured');
    const { code, state } = req.query || {};
    if (!code || !state) return res.status(400).send('Missing code/state');
    if (String(state) !== String(req.cookies?.oauth_state || '')) return res.status(400).send('Invalid state');
    const next = (req.cookies?.oauth_next || '/store').toString();
    const mode = (req.cookies?.oauth_mode || 'login').toString();
    // Clear temp cookies
    res.clearCookie('oauth_state', shortCookieOptions());
    res.clearCookie('oauth_next', shortCookieOptions());
    res.clearCookie('oauth_mode', shortCookieOptions());

    const redirectUri = `${publicApiBase(req)}/auth/line/callback`;
    // Exchange code for tokens
    const tokenResp = await httpsPostForm('https://api.line.me/oauth2/v2.1/token', {
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: redirectUri,
      client_id: LINE_CLIENT_ID,
      client_secret: LINE_CLIENT_SECRET,
    });
    const accessToken = tokenResp.access_token;
    const idToken = tokenResp.id_token;
    if (!accessToken) return res.status(400).send('Token exchange failed');

    // Fetch profile (userId/displayName)
    const profile = await httpsGetJson('https://api.line.me/v2/profile', { Authorization: `Bearer ${accessToken}` });
    const subject = (profile?.userId || '').toString();
    const name = (profile?.displayName || '').toString();

    // Verify id_token to extract email when permission granted
    let email = '';
    try {
      if (idToken) {
        const v = await httpsPostForm('https://api.line.me/oauth2/v2.1/verify', { id_token: idToken, client_id: LINE_CLIENT_ID });
        email = (v?.email || '').toLowerCase().trim();
      }
    } catch (_) { /* ignore verify failure */ }

    // Block if tombstoned (by provider+subject or by email once available)
    try{
      const denied = await isTombstoned({ provider: 'line', subject, email: (email || null) });
      if (denied){
        const back = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/login?oauth_error=account_deleted`;
        return res.redirect(302, back);
      }
    } catch(_){}

    await ensureOAuthIdentitiesTable();

    // Link mode: bind LINE to current signed-in user
    if (mode === 'link'){
      const authed = getAuthedUser(req);
      if (!authed?.id) {
        const back = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/login?link_error=not_signed_in`;
        return res.redirect(302, back);
      }
      // 若 subject 已被 tombstone，禁止綁定（避免繞過封鎖）
      try{
        const denied = await isTombstoned({ provider: 'line', subject });
        if (denied){
          const back = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/account?link_error=line_tombstoned`;
          return res.redirect(302, back);
        }
      } catch(_){}
      const [ex] = await pool.query('SELECT user_id FROM oauth_identities WHERE provider = ? AND subject = ? LIMIT 1', ['line', subject]);
      if (ex.length && String(ex[0].user_id) !== String(authed.id)){
        const back = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/account?link_error=line_taken`;
        return res.redirect(302, back);
      }
      if (!ex.length){
        await pool.query('INSERT INTO oauth_identities (user_id, provider, subject, email) VALUES (?, ?, ?, ?)', [authed.id, 'line', subject, email || null]);
      }
      const back = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/account?linked=line`;
      return res.redirect(302, back);
    }

    // Login mode: prefer mapping by provider subject; else fallback to email; else create new user and link (requires email)
    let userRow = null;
    const [mapped] = await pool.query('SELECT u.id, u.username, u.email, u.role FROM oauth_identities oi JOIN users u ON u.id = oi.user_id WHERE oi.provider = ? AND oi.subject = ? LIMIT 1', ['line', subject]);
    if (mapped.length){
      userRow = mapped[0];
    } else {
      if (email){
        const [found] = await pool.query('SELECT id, username, email, role FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [email]);
        if (found.length){
          userRow = found[0];
          try { await pool.query('INSERT INTO oauth_identities (user_id, provider, subject, email) VALUES (?, ?, ?, ?)', [userRow.id, 'line', subject, email]) } catch(_){}
        } else {
          // Create new user if email available
          const id = randomUUID();
          const username = name || (email.split('@')[0]);
          const randomPass = crypto.randomBytes(16).toString('hex');
          const hash = await bcrypt.hash(randomPass, 12);
          try {
            await pool.query('INSERT INTO users (id, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?)', [id, username, email, hash, 'USER']);
          } catch (e) {
            if (e?.code === 'ER_BAD_FIELD_ERROR') {
              await pool.query('INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)', [id, username, email, hash]);
            } else { throw e }
          }
          try { await autoAcceptTransfersForEmail(id, email) } catch(_){}
          try { await pool.query('INSERT INTO oauth_identities (user_id, provider, subject, email) VALUES (?, ?, ?, ?)', [id, 'line', subject, email]) } catch(_){}
          // Force first-time password setup
          try {
            await ensurePasswordResetsTable();
            const resetToken = generateResetToken();
            const tokenExpiry = Date.now() + 60 * 60 * 1000; // 1 時
            await pool.query('INSERT INTO password_resets (user_id, email, token, token_expiry, used) VALUES (?, ?, ?, ?, 0)', [id, email, resetToken, tokenExpiry]);
            const target = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/reset?token=${resetToken}&first=1`;
            return res.redirect(302, target);
          } catch (_) {
            // Fallback: allow login if reset link setup fails
            userRow = { id, username, email, role: 'USER' };
          }
        }
      } else {
        // No mapping and no email available → cannot create account safely
        const back = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/login?oauth_error=line_no_email`;
        return res.redirect(302, back);
      }
    }

    // 若此 subject/email 已被標記為 tombstone（帳號曾刪除），禁止登入或重新建立
    try{
      const denied = await isTombstoned({ provider: 'line', subject, email: (email || null) });
      if (denied){
        const back = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/login?oauth_error=account_deleted`;
        return res.redirect(302, back);
      }
    } catch(_){}

    const role = String(userRow.role || 'USER').toUpperCase();
    const jwtToken = signToken({ id: userRow.id, email: userRow.email, username: userRow.username, role });
    setAuthCookie(res, jwtToken);
    const webBase = PUBLIC_WEB_URL.replace(/\/$/, '');
    const nextPath = (next && String(next).startsWith('/')) ? String(next) : '/store';
    const target = `${webBase}/login?oauth=line&redirect=${encodeURIComponent(nextPath)}#token=${encodeURIComponent(jwtToken)}`;
    return res.redirect(302, target);
  } catch (err) {
    console.error('LINE OAuth error:', err?.message || err);
    const back = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/login?oauth_error=line`;
    return res.redirect(302, back);
  }
});

/** ======== Users（對齊你的 users 表：id=INT, password=VARCHAR） ======== */
// 僅管理員可讀取使用者清單
app.get('/users', adminOnly, async (req, res) => {
  try {
    try {
      const [rows] = await pool.query(
        'SELECT id, username, email, role, created_at FROM users ORDER BY id DESC'
      );
      return ok(res, rows);
    } catch (e) {
      if (e?.code === 'ER_BAD_FIELD_ERROR') {
        const [rows2] = await pool.query(
          'SELECT id, username, email, created_at FROM users ORDER BY id DESC'
        );
        return ok(res, rows2.map(u => ({ ...u, role: 'USER' })));
      }
      throw e;
    }
  } catch (err) {
    return fail(res, 'USERS_LIST_FAIL', err.message, 500);
  }
});

// Admin: export full data of a specific user
app.get('/admin/users/:id/export', adminOnly, async (req, res) => {
  const userId = req.params.id;
  try {
    const [uRows] = await pool.query('SELECT id, username, email, role, created_at, updated_at FROM users WHERE id = ? LIMIT 1', [userId]);
    if (!uRows.length) return fail(res, 'USER_NOT_FOUND', '找不到使用者', 404);
    const u = uRows[0];

    const [tickets] = await pool.query('SELECT id, uuid, type, discount, used, expiry, created_at FROM tickets WHERE user_id = ? ORDER BY id DESC', [userId]);
    const [orders] = await pool.query('SELECT id, code, details, created_at FROM orders WHERE user_id = ? ORDER BY id DESC', [userId]);
    const [reservations] = await pool.query('SELECT id, ticket_type, store, event, reserved_at, verify_code, verify_code_pre_dropoff, verify_code_pre_pickup, verify_code_post_dropoff, verify_code_post_pickup, status FROM reservations WHERE user_id = ? ORDER BY id DESC', [userId]);
    const [transfersOut] = await pool.query('SELECT id, ticket_id, from_user_id, to_user_id, to_user_email, code, status, created_at, updated_at FROM ticket_transfers WHERE from_user_id = ? ORDER BY id DESC', [userId]);
    const [transfersIn] = await pool.query('SELECT id, ticket_id, from_user_id, to_user_id, to_user_email, code, status, created_at, updated_at FROM ticket_transfers WHERE to_user_id = ? ORDER BY id DESC', [userId]);
    try { await ensureTicketLogsTable() } catch (_) {}
    let logs = [];
    try {
      const [logRows] = await pool.query('SELECT id, ticket_id, user_id, action, meta, created_at FROM ticket_logs WHERE user_id = ? ORDER BY id DESC', [userId]);
      logs = logRows.map(r => ({ id: r.id, ticket_id: r.ticket_id, action: r.action, meta: safeParseJSON(r.meta, {}), created_at: r.created_at }));
    } catch (_) { logs = [] }

    const user = { id: u.id, username: u.username, email: u.email, role: u.role || null, created_at: u.created_at, updated_at: u.updated_at };
    return ok(res, { user, tickets, orders, reservations, transfers: { out: transfersOut, in: transfersIn }, logs }, 'EXPORT_OK');
  } catch (err) {
    return fail(res, 'ADMIN_USER_EXPORT_FAIL', err.message, 500);
  }
});

app.post('/users', async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);

  const { username, email, password } = parsed.data;
  try {
    // 檢查 email 重複
    const [dup] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (dup.length) return fail(res, 'EMAIL_TAKEN', '此 Email 已被註冊', 409);

    // 選擇性：要求先通過郵件驗證
    if (REQUIRE_EMAIL_VERIFICATION) {
      try {
        const [rows] = await pool.query('SELECT verified, token_expiry FROM email_verifications WHERE email = ? LIMIT 1', [email]);
        const v = rows?.[0] || null;
        const now = Date.now();
        const okVerified = v && Number(v.verified) === 1 && (!v.token_expiry || Number(v.token_expiry) >= now);
        if (!okVerified) return fail(res, 'EMAIL_NOT_VERIFIED', '請先完成 Email 驗證後再註冊', 400);
      } catch (_) { /* 若表不存在則視為未啟用驗證 */ }
    }

    // 以 UUID 為 id（對齊現有資料庫）
    const id = randomUUID();
    const hash = await bcrypt.hash(password, 12);
    try {
      await pool.query(
        'INSERT INTO users (id, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
        [id, username, email, hash, 'USER']
      );
    } catch (e) {
      if (e?.code === 'ER_BAD_FIELD_ERROR') {
        // 舊資料庫沒有 role 欄位時退回
        await pool.query(
          'INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)',
          [id, username, email, hash]
        );
      } else {
        throw e;
      }
    }
    // 簽 JWT + 設置 HttpOnly Cookie（附帶 role）
    const token = signToken({ id, email, username, role: 'USER' });
    setAuthCookie(res, token);
    // 註冊完成後：自動領取所有寄送到此 Email、尚在等待中的轉贈
    try { await autoAcceptTransfersForEmail(id, email); } catch (_) { /* 忽略失敗，不影響註冊流程 */ }

    return ok(res, { id, username, email, role: 'USER', token }, '註冊成功，已自動登入');
  } catch (err) {
    return fail(res, 'USER_CREATE_FAIL', err.message, 500);
  }
});

/** ======== Email 驗證 API ======== */
// 限定學校信箱（可選）：xxxxx@xxxxx.edu.tw
const eduEmailRegex = /^([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.edu\.tw)$/;

// 驗證：寄送驗證信
app.post('/verify-email', async (req, res) => {
  try {
    const email = (req.body?.email || '').toString().trim();
    if (!email) return fail(res, 'VALIDATION_ERROR', '缺少 email', 400);

    // 若 Email 已被註冊，直接回應提示，避免重複註冊
    try {
      const [dup] = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [email]);
      if (dup.length) return ok(res, { mailed: false, alreadyRegistered: true }, '此 Email 已被註冊，請直接登入或使用忘記密碼');
    } catch (_) { /* ignore lookup errors */ }

    // 可選：強制 .edu.tw
    if (RESTRICT_EMAIL_DOMAIN_TO_EDU_TW && !eduEmailRegex.test(email)) {
      return fail(res, 'EMAIL_DOMAIN_RESTRICTED', '僅允許使用 .edu.tw 學生信箱', 400);
    }

    const token = crypto.randomBytes(20).toString('hex');
    const tokenExpiry = Date.now() + 3 * 24 * 60 * 60 * 1000; // 三天有效

    // 建表（若不存在）+ upsert
    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_verifications (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        email VARCHAR(255) NOT NULL UNIQUE,
        token VARCHAR(128) NULL,
        token_expiry BIGINT UNSIGNED NULL,
        verified TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_email_verifications_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await pool.query(
      'INSERT INTO email_verifications (email, token, token_expiry, verified) VALUES (?, ?, ?, 0) ON DUPLICATE KEY UPDATE token = VALUES(token), token_expiry = VALUES(token_expiry), verified = 0',
      [email, token, tokenExpiry]
    );

    if (!mailerReady) return ok(res, { mailed: false }, '已建立驗證記錄，但郵件服務未設定');

    const apiBase = PUBLIC_API_BASE.replace(/\/$/, '');
    const confirmHref = apiBase ? `${apiBase}/confirm-email?token=${token}` : `${req.protocol}://${req.get('host')}/confirm-email?token=${token}`;

    await transporter.sendMail({
      from: `${EMAIL_FROM_NAME} <${EMAIL_FROM_ADDRESS}>`,
      to: email,
      subject: 'Email 驗證 - Leader Online',
      html: `
        <p>您好，請點擊以下連結驗證您的 Email：</p>
        <p><a href="${confirmHref}">${confirmHref}</a></p>
        <p>此連結三天內有效。若非您本人申請，請忽略本郵件。</p>
      `,
    });
    try {
      const [uRows] = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [email]);
      if (uRows.length) {
        await notifyLineByUserId(uRows[0].id, '【Leader Online】我們已寄出 Email 驗證連結，請於三天內完成確認。');
      }
    } catch (_) {}

    return ok(res, { mailed: true }, '驗證信已寄出，請至信箱完成驗證');
  } catch (err) {
    return fail(res, 'VERIFY_EMAIL_FAIL', err.message, 500);
  }
});

/** ======== Email 變更（需點擊驗證後才生效） ======== */
async function ensureEmailChangeRequestsTable(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_change_requests (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id CHAR(36) NOT NULL,
      new_email VARCHAR(255) NOT NULL,
      token VARCHAR(128) NOT NULL,
      token_expiry BIGINT UNSIGNED NULL,
      used TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_email_change_token (token),
      UNIQUE KEY uq_email_change_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

// 驗證：確認 Email 變更
app.get('/confirm-email-change', async (req, res) => {
  const token = (req.query?.token || '').toString().trim();
  if (!token) return res.status(400).send('<h1>缺少 token</h1>');
  let conn;
  try{
    await ensureEmailChangeRequestsTable();
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM email_change_requests WHERE token = ? AND used = 0 LIMIT 1', [token]);
    if (!rows.length) { await conn.rollback(); return res.status(400).send('<h1>無效或已使用的連結</h1>'); }
    const r = rows[0];
    if (r.token_expiry && Date.now() > Number(r.token_expiry)) { await conn.rollback(); return res.status(400).send('<h1>驗證連結已過期</h1>'); }

    const userId = String(r.user_id);
    const newEmail = String(r.new_email || '').trim();
    if (!newEmail) { await conn.rollback(); return res.status(400).send('<h1>新 Email 無效</h1>'); }

    // 確認新 Email 未被其他帳號使用
    const [dup] = await conn.query('SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id <> ? LIMIT 1', [newEmail, userId]);
    if (dup.length) { await conn.rollback(); return res.status(409).send('<h1>此 Email 已被其他帳號使用</h1>'); }

    const [uRows] = await conn.query('SELECT id, username, role FROM users WHERE id = ? LIMIT 1', [userId]);
    if (!uRows.length) { await conn.rollback(); return res.status(404).send('<h1>找不到使用者</h1>'); }

    const [upd] = await conn.query('UPDATE users SET email = ? WHERE id = ?', [newEmail, userId]);
    if (!upd.affectedRows) { await conn.rollback(); return res.status(500).send('<h1>更新失敗</h1>'); }
    await conn.query('UPDATE email_change_requests SET used = 1 WHERE id = ?', [r.id]);

    // 自動登入（以新 Email 重新簽發）
    try{
      const u = uRows[0];
      const role = String(u.role || 'USER').toUpperCase();
      const jwtToken = signToken({ id: u.id, email: newEmail, username: u.username, role });
      setAuthCookie(res, jwtToken);
    } catch(_){}

    await conn.commit();
    const back = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/account?email_changed=1`;
    return res.redirect(302, back);
  } catch (err) {
    try { if (conn) await conn.rollback(); } catch {}
    return res.status(500).send('<h1>伺服器錯誤，無法變更 Email</h1>');
  } finally { try { if (conn) conn.release() } catch {} }
});

// 驗證：確認 token
app.get('/confirm-email', async (req, res) => {
  const token = (req.query?.token || '').toString().trim();
  if (!token) return res.status(400).send('<h1>缺少 token</h1>');
  try {
    const [rows] = await pool.query('SELECT * FROM email_verifications WHERE token = ? LIMIT 1', [token]);
    if (!rows.length) return res.status(400).send('<h1>無效或過期的連結</h1>');
    const rec = rows[0];
    if (rec.token_expiry && Date.now() > Number(rec.token_expiry)) {
      return res.status(400).send('<h1>驗證連結已過期，請重新申請</h1>');
    }
    await pool.query('UPDATE email_verifications SET verified = 1, token = NULL, token_expiry = NULL WHERE id = ?', [rec.id]);

    const email = (rec.email || '').toString().trim();
    if (!email) {
      const back = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/login`;
      return res.redirect(302, back);
    }

    // 若使用者已存在：直接登入並導回首頁
    try {
      const [uRows] = await pool.query('SELECT id, email, username, role FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [email]);
      if (uRows.length) {
        const me = uRows[0];
        const role = String(me.role || 'USER').toUpperCase();
        const jwtToken = signToken({ id: me.id, email: me.email, username: me.username, role });
        setAuthCookie(res, jwtToken);
        const back = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/store`;
        return res.redirect(302, back);
      }
    } catch (_) { /* ignore; fallback to create */ }

    // 使用者不存在：自動建立帳號，並導向「重設密碼」完成首次設定
    const id = randomUUID();
    const local = email.split('@')[0] || 'user';
    const baseName = local.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 24) || 'user';
    const username = baseName;
    const tmpPass = generateResetToken();
    const hash = await bcrypt.hash(tmpPass, 12);
    try {
      // 嘗試含 role 欄位的版本
      await pool.query('INSERT INTO users (id, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?)', [id, username, email, hash, 'USER']);
    } catch (e) {
      if (e?.code === 'ER_BAD_FIELD_ERROR') {
        // 舊資料庫無 role 欄位
        await pool.query('INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)', [id, username, email, hash]);
      } else { throw e }
    }

    // 自動領取寄往該 Email 的待處理轉贈
    try { await autoAcceptTransfersForEmail(id, email) } catch (_) { }

    // 建立一次性重設密碼 token，導向前端完成密碼設定
    try {
      await ensurePasswordResetsTable();
      const resetToken = generateResetToken();
      const tokenExpiry = Date.now() + 60 * 60 * 1000; // 1 時
      await pool.query('INSERT INTO password_resets (user_id, email, token, token_expiry, used) VALUES (?, ?, ?, ?, 0)', [id, email, resetToken, tokenExpiry]);
      const target = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/reset?token=${resetToken}&first=1`;
      return res.redirect(302, target);
    } catch (_) {
      // 若建立重設連結失敗，仍導回登入頁（已完成註冊）
      const back = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/login?email=${encodeURIComponent(email)}&verified=1`;
      return res.redirect(302, back);
    }
  } catch (err) {
    return res.status(500).send('<h1>伺服器錯誤，無法驗證</h1>');
  }
});

// 查詢：檢查是否已驗證
app.get('/check-verification', async (req, res) => {
  const email = (req.query?.email || '').toString().trim();
  if (!email) return fail(res, 'VALIDATION_ERROR', '缺少 email', 400);
  try {
    const [rows] = await pool.query('SELECT verified FROM email_verifications WHERE email = ? LIMIT 1', [email]);
    const verified = rows.length ? Boolean(rows[0].verified) : false;
    return ok(res, { verified });
  } catch (err) {
    return fail(res, 'CHECK_VERIFICATION_FAIL', err.message, 500);
  }
});

/** ======== 密碼重設（忘記密碼 / 修改密碼需 Email 驗證） ======== */
async function ensurePasswordResetsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id CHAR(36) NOT NULL,
      email VARCHAR(255) NOT NULL,
      token VARCHAR(128) NOT NULL,
      token_expiry BIGINT UNSIGNED NULL,
      used TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_password_resets_token (token),
      KEY idx_password_resets_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

function generateResetToken() { return crypto.randomBytes(20).toString('hex'); }

// 送出重設密碼信（未登入：忘記密碼）
app.post('/forgot-password', async (req, res) => {
  const email = (req.body?.email || '').toString().trim();
  if (!email) return fail(res, 'VALIDATION_ERROR', '缺少 email', 400);
  try {
    const [rows] = await pool.query('SELECT id, email, username FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [email]);
    // 即使找不到帳號，也回傳成功以避免暴露帳號存在與否
    if (!rows.length) return ok(res, null, '若該 Email 存在，已寄出重設密碼信');

    const u = rows[0];
    await ensurePasswordResetsTable();
    const token = generateResetToken();
    const tokenExpiry = Date.now() + 60 * 60 * 1000; // 1 時
    await pool.query('INSERT INTO password_resets (user_id, email, token, token_expiry, used) VALUES (?, ?, ?, ?, 0)', [u.id, u.email, token, tokenExpiry]);

    if (!mailerReady) return ok(res, { mailed: false }, '已建立重設記錄，但郵件服務未設定');
    const link = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/login?reset_token=${token}`;
    await transporter.sendMail({
      from: `${EMAIL_FROM_NAME} <${EMAIL_FROM_ADDRESS}>`,
      to: u.email,
      subject: '重設密碼 - Leader Online',
      html: `
        <p>您好，您或他人請求重設此 Email 對應的帳號密碼。</p>
        <p>若是您本人，請點擊以下連結在 1 時內完成重設：</p>
        <p><a href="${link}">${link}</a></p>
        <p>若非您本人操作，請忽略此郵件。</p>
      `,
    });
    try { await notifyLineByUserId(u.id, '【Leader Online】密碼重設連結已寄至您的 Email，請於 1 時內完成設定。') } catch (_) {}
    return ok(res, { mailed: true }, '已寄出重設密碼信');
  } catch (err) {
    return fail(res, 'FORGOT_PASSWORD_FAIL', err.message, 500);
  }
});

// 已登入：修改密碼前，先寄送驗證信（需輸入目前密碼）
const SelfPasswordVerifySchema = z.object({ currentPassword: z.string().min(8).max(100) });
app.post('/me/password/send_reset', authRequired, async (req, res) => {
  const parsed = SelfPasswordVerifySchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  const { currentPassword } = parsed.data;
  try {
    const [rows] = await pool.query('SELECT id, email, username, password_hash FROM users WHERE id = ? LIMIT 1', [req.user.id]);
    if (!rows.length) return fail(res, 'USER_NOT_FOUND', '找不到使用者', 404);
    const u = rows[0];
    const match = u.password_hash ? await bcrypt.compare(currentPassword, u.password_hash) : false;
    if (!match) return fail(res, 'AUTH_INVALID_CREDENTIALS', '目前密碼不正確', 400);

    await ensurePasswordResetsTable();
    const token = generateResetToken();
    const tokenExpiry = Date.now() + 60 * 60 * 1000; // 1 時
    await pool.query('INSERT INTO password_resets (user_id, email, token, token_expiry, used) VALUES (?, ?, ?, ?, 0)', [u.id, u.email, token, tokenExpiry]);

    if (!mailerReady) return ok(res, { mailed: false }, '已建立重設記錄，但郵件服務未設定');
    const link = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/login?reset_token=${token}`;
    await transporter.sendMail({
      from: `${EMAIL_FROM_NAME} <${EMAIL_FROM_ADDRESS}>`,
      to: u.email,
      subject: '確認修改密碼 - Leader Online',
      html: `
        <p>您好，您正在要求修改密碼。</p>
        <p>請點擊以下連結在 1 時內完成變更密碼：</p>
        <p><a href="${link}">${link}</a></p>
        <p>若非您本人操作，請忽略此郵件。</p>
      `,
    });
    try { await notifyLineByUserId(u.id, '【Leader Online】密碼變更確認信已寄出，請於 1 時內完成設定。') } catch (_) {}
    return ok(res, { mailed: true }, '驗證信已寄出，請至信箱完成變更');
  } catch (err) {
    return fail(res, 'SELF_PASSWORD_SEND_RESET_FAIL', err.message, 500);
  }
});

// 查詢 Token 是否有效（前端可選擇呼叫）
app.get('/password_resets/validate', async (req, res) => {
  const token = (req.query?.token || '').toString().trim();
  if (!token) return fail(res, 'VALIDATION_ERROR', '缺少 token', 400);
  try {
    await ensurePasswordResetsTable();
    const [rows] = await pool.query('SELECT email, token_expiry, used FROM password_resets WHERE token = ? LIMIT 1', [token]);
    if (!rows.length) return ok(res, { valid: false });
    const r = rows[0];
    const valid = !Number(r.used) && (!r.token_expiry || Date.now() <= Number(r.token_expiry));
    return ok(res, { valid, email: r.email });
  } catch (err) { return fail(res, 'PASSWORD_RESET_VALIDATE_FAIL', err.message, 500); }
});

// 依 token 重設密碼
const ResetPasswordSchema = z.object({ token: z.string().min(10), password: z.string().min(8).max(100) });
app.post('/reset-password', async (req, res) => {
  const parsed = ResetPasswordSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  const { token, password } = parsed.data;
  let conn;
  try {
    await ensurePasswordResetsTable();
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT id, user_id, email, token_expiry, used FROM password_resets WHERE token = ? LIMIT 1', [token]);
    if (!rows.length) { await conn.rollback(); return fail(res, 'RESET_TOKEN_INVALID', '連結無效或已使用', 400); }
    const r = rows[0];
    if (Number(r.used)) { await conn.rollback(); return fail(res, 'RESET_TOKEN_USED', '連結已被使用', 400); }
    if (r.token_expiry && Date.now() > Number(r.token_expiry)) { await conn.rollback(); return fail(res, 'RESET_TOKEN_EXPIRED', '連結已過期', 400); }

    const hash = await bcrypt.hash(password, 12);
    const [uRows] = await conn.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, r.user_id]);
    if (!uRows.affectedRows) { await conn.rollback(); return fail(res, 'USER_NOT_FOUND', '找不到使用者', 404); }
    await conn.query('UPDATE password_resets SET used = 1 WHERE id = ?', [r.id]);

    // 自動登入
    try {
      const [u] = await conn.query('SELECT id, email, username, role FROM users WHERE id = ? LIMIT 1', [r.user_id]);
      if (u.length) {
        const me = u[0];
        const role = String(me.role || 'USER').toUpperCase();
        const jwtToken = signToken({ id: me.id, email: me.email, username: me.username, role });
        setAuthCookie(res, jwtToken);
        await conn.commit();
        return ok(res, { id: me.id, email: me.email, username: me.username, role, token: jwtToken }, '密碼已重設並已登入');
      }
    } catch (_) { /* 忽略自動登入失敗 */ }

    await conn.commit();
    return ok(res, null, '密碼已重設');
  } catch (err) {
    try { if (conn) await conn.rollback(); } catch {}
    return fail(res, 'RESET_PASSWORD_FAIL', err.message, 500);
  } finally { if (conn) conn.release(); }
});

app.post('/login', async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);

  const { email, password } = parsed.data;
  try {
    // 嘗試抓 role + password_hash；若 role 或新增欄位不存在則逐步退回
    let rows = [];
    const loginQueries = [
      'SELECT id, username, email, role, password_hash, phone, remittance_last5 FROM users WHERE email = ? LIMIT 1',
      'SELECT id, username, email, role, password_hash FROM users WHERE email = ? LIMIT 1',
      'SELECT id, username, email, password_hash FROM users WHERE email = ? LIMIT 1',
    ];
    for (const sql of loginQueries) {
      try {
        [rows] = await pool.query(sql, [email]);
        break;
      } catch (e) {
        if (e?.code === 'ER_BAD_FIELD_ERROR') continue;
        throw e;
      }
    }
    if (!rows.length) return fail(res, 'AUTH_INVALID_CREDENTIALS', '帳號或密碼錯誤', 401);

    const user = rows[0];
    const match = user.password_hash ? await bcrypt.compare(password, user.password_hash) : false;
    if (!match) return fail(res, 'AUTH_INVALID_CREDENTIALS', '帳號或密碼錯誤', 401);

    const token = signToken({ id: user.id, email: user.email, username: user.username, role: (user.role || 'USER') });
    setAuthCookie(res, token);

    const phone = user.phone == null ? null : String(user.phone);
    const remittanceLast5 = user.remittance_last5 == null ? null : String(user.remittance_last5);
    return ok(res, { id: user.id, email: user.email, username: user.username, role: user.role || 'user', phone, remittanceLast5, token }, '登入成功');
  } catch (err) {
    return fail(res, 'LOGIN_FAIL', err.message, 500);
  }
});

app.post('/logout', (req, res) => {
  res.clearCookie('auth_token', cookieOptions());
  return ok(res, null, '已登出');
});

app.get('/whoami', authRequired, async (req, res) => {
  try{
    let rows = [];
    try {
      [rows] = await pool.query('SELECT id, username, email, role, phone, remittance_last5 FROM users WHERE id = ? LIMIT 1', [req.user.id]);
    } catch (err) {
      if (err?.code === 'ER_BAD_FIELD_ERROR') {
        [rows] = await pool.query('SELECT id, username, email, role FROM users WHERE id = ? LIMIT 1', [req.user.id]);
      } else {
        throw err;
      }
    }
    if (rows.length){
      const u = rows[0];
      const raw = normalizeRole(u.role || req.user.role || 'USER');
      const allowedRoles = ['ADMIN','STORE','EDITOR','OPERATOR'];
      const role = allowedRoles.includes(raw) ? raw : 'USER';
      // 若 token 角色與 DB 不一致，重新簽發並覆寫 Cookie
      if (String(req.user.role || '').toUpperCase() !== role){
        const token = signToken({ id: u.id, email: u.email, username: u.username, role });
        setAuthCookie(res, token);
      }
      // 讀取當前使用者的 providers（正規化）
      let providers = [];
      try {
        const [pr] = await pool.query('SELECT TRIM(LOWER(provider)) AS provider FROM oauth_identities WHERE user_id = ?', [u.id]);
        providers = Array.from(new Set(pr.map(r => String(r.provider || '').trim().toLowerCase()).filter(Boolean)));
      } catch (_) { providers = [] }
      const phone = u.phone == null ? null : String(u.phone);
      const remittanceLast5 = u.remittance_last5 == null ? null : String(u.remittance_last5);
      return ok(res, { id: u.id, email: u.email, username: u.username, role, providers, phone, remittanceLast5 }, 'OK');
    }
    // 找不到使用者時仍回傳現有資訊（無 providers）
    const role = normalizeRole(req.user.role || 'USER');
    return ok(res, { id: req.user.id, email: req.user.email, username: req.user.username, role, providers: [], phone: null, remittanceLast5: null }, 'OK');
  } catch (e){
    const role = normalizeRole(req.user.role || 'USER');
    return ok(res, { id: req.user.id, email: req.user.email, username: req.user.username, role, providers: [], phone: null, remittanceLast5: null }, 'OK');
  }
});

/** ======== Admin：Users ======== */
app.get('/admin/users', adminOnly, async (req, res) => {
  try {
    const defaultLimit = 50;
    const limit = parsePositiveInt(req.query.limit, defaultLimit, { min: 1, max: 200 });
    const offsetRaw = req.query.offset ?? req.query.skip ?? 0;
    const offset = Math.max(0, parsePositiveInt(offsetRaw, 0, { min: 0 }));
    const queryRaw = String(req.query.q || req.query.query || '').trim();
    const searchTerm = queryRaw ? `%${queryRaw}%` : null;

    const where = [];
    const params = [];
    if (searchTerm) {
      where.push('(u.username LIKE ? OR u.email LIKE ? OR u.id LIKE ?)');
      params.push(searchTerm, searchTerm, searchTerm);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    let total = 0;
    try {
      const countSql = `SELECT COUNT(*) AS total FROM users u ${whereSql}`;
      const [[countRow]] = await pool.query(countSql, params);
      total = Number(countRow?.total || 0);
    } catch (e) {
      if (e?.code !== 'ER_BAD_FIELD_ERROR') throw e;
      const countSql = `SELECT COUNT(*) AS total FROM users u ${whereSql}`;
      const [[countRow]] = await pool.query(countSql, params);
      total = Number(countRow?.total || 0);
    }

    const listSql = `SELECT u.id, u.username, u.email, u.role, u.created_at FROM users u ${whereSql} ORDER BY u.id DESC LIMIT ? OFFSET ?`;
    let rows;
    try {
      const [result] = await pool.query(listSql, [...params, limit, offset]);
      rows = result;
    } catch (e) {
      if (e?.code !== 'ER_BAD_FIELD_ERROR') throw e;
      const legacySql = `SELECT u.id, u.username, u.email, u.created_at FROM users u ${whereSql} ORDER BY u.id DESC LIMIT ? OFFSET ?`;
      const [legacyRows] = await pool.query(legacySql, [...params, limit, offset]);
      rows = legacyRows.map((u) => ({ ...u, role: 'USER' }));
    }

    const items = rows.map((row) => ({
      id: row.id,
      username: row.username || '',
      email: row.email || '',
      role: row.role ? String(row.role).toUpperCase() : 'USER',
      created_at: row.created_at || null,
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
    return fail(res, 'ADMIN_USERS_LIST_FAIL', err.message, 500);
  }
});

app.patch('/admin/users/:id/role', adminOnly, async (req, res) => {
  const { role } = req.body || {};
  const norm = String(role || '').toUpperCase();
  const allowed = ['USER', 'ADMIN', 'STORE', 'EDITOR', 'OPERATOR'];
  if (!allowed.includes(norm)) return fail(res, 'VALIDATION_ERROR', 'role 必須為 USER / ADMIN / STORE / EDITOR / OPERATOR', 400);
  try {
    const [r] = await pool.query('UPDATE users SET role = ? WHERE id = ?', [norm, req.params.id]);
    if (!r.affectedRows) return fail(res, 'USER_NOT_FOUND', '找不到使用者', 404);
    return ok(res, null, '角色已更新');
  } catch (err) {
    return fail(res, 'ADMIN_USER_ROLE_FAIL', err.message, 500);
  }
});

/** ======== Self Account Center ======== */
// Get my profile
app.get('/me', authRequired, async (req, res) => {
  try {
    let rows = [];
    try {
      [rows] = await pool.query('SELECT id, username, email, role, phone, remittance_last5, created_at FROM users WHERE id = ? LIMIT 1', [req.user.id]);
    } catch (err) {
      if (err?.code === 'ER_BAD_FIELD_ERROR') {
        [rows] = await pool.query('SELECT id, username, email, role, created_at FROM users WHERE id = ? LIMIT 1', [req.user.id]);
      } else { throw err; }
    }
    if (!rows.length) return fail(res, 'USER_NOT_FOUND', '找不到使用者', 404);
    const u = rows[0];
    const role = String(u.role || req.user.role || 'USER').toUpperCase();
    // 讀取 providers（正規化）
    let providers = [];
    try {
      const [pr] = await pool.query('SELECT TRIM(LOWER(provider)) AS provider FROM oauth_identities WHERE user_id = ?', [u.id]);
      providers = Array.from(new Set(pr.map(r => String(r.provider || '').trim().toLowerCase()).filter(Boolean)));
    } catch (_) { providers = [] }
    const phone = u.phone == null ? null : String(u.phone);
    const remittanceLast5 = u.remittance_last5 == null ? null : String(u.remittance_last5);
    return ok(res, { id: u.id, username: u.username, email: u.email, role, created_at: u.created_at, providers, phone, remittanceLast5 });
  } catch (err) {
    return fail(res, 'ME_READ_FAIL', err.message, 500);
  }
});

// Update my username/email（Email 改為「驗證後才生效」）
const phoneRegex = /^[0-9+\-()\s]+$/;
const SelfUpdateSchema = z.object({
  username: z.string().min(2).max(50).optional(),
  email: z.string().email().optional(),
  phone: z.string().transform(v => v.trim()).refine((value) => {
    if (!value) return true;
    if (value.length < 8 || value.length > 20) return false;
    return phoneRegex.test(value);
  }, { message: '手機號碼格式不正確' }).optional(),
  remittanceLast5: z.string().transform(v => v.trim()).refine((value) => {
    if (!value) return true;
    return /^\d{5}$/.test(value);
  }, { message: '匯款帳號後五碼需為 5 位數字' }).optional(),
});
app.patch('/me', authRequired, async (req, res) => {
  const parsed = SelfUpdateSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  const fields = parsed.data;
  if (!Object.keys(fields).length) return ok(res, null, '無更新');
  try {
    // 讀取目前資料以判斷 Email 是否變更
    let curRows = [];
    try {
      [curRows] = await pool.query('SELECT id, email, username, role, phone, remittance_last5 FROM users WHERE id = ? LIMIT 1', [req.user.id]);
    } catch (err) {
      if (err?.code === 'ER_BAD_FIELD_ERROR') {
        [curRows] = await pool.query('SELECT id, email, username, role FROM users WHERE id = ? LIMIT 1', [req.user.id]);
      } else { throw err; }
    }
    if (!curRows.length) return fail(res, 'USER_NOT_FOUND', '找不到使用者', 404);
    const current = curRows[0];

    if (fields.email) {
      // .edu.tw 限制（若啟用）
      if (RESTRICT_EMAIL_DOMAIN_TO_EDU_TW && !eduEmailRegex.test(fields.email)) {
        return fail(res, 'EMAIL_DOMAIN_RESTRICTED', '僅允許使用 .edu.tw 學生信箱', 400);
      }
      // 不可與他人重複
      const [dup] = await pool.query('SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1', [fields.email, req.user.id]);
      if (dup.length) return fail(res, 'EMAIL_TAKEN', 'Email 已被使用', 409);
    }
    // 僅更新非 Email 欄位（Email 改走驗證流程）
    const sets = [];
    const values = [];
    if (fields.username && fields.username !== current.username) { sets.push('username = ?'); values.push(fields.username); }
    if (fields.phone !== undefined) {
      const nextPhone = fields.phone ? fields.phone : null;
      const currentPhone = current.phone == null ? null : String(current.phone).trim();
      if (nextPhone !== currentPhone) {
        sets.push('phone = ?');
        values.push(nextPhone);
      }
    }
    if (fields.remittanceLast5 !== undefined) {
      const nextLast5 = fields.remittanceLast5 ? fields.remittanceLast5 : null;
      const currentLast5 = current.remittance_last5 == null ? null : String(current.remittance_last5).trim();
      if (nextLast5 !== currentLast5) {
        sets.push('remittance_last5 = ?');
        values.push(nextLast5);
      }
    }
    if (sets.length){
      values.push(req.user.id);
      const [r] = await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, values);
      if (!r.affectedRows) return fail(res, 'USER_NOT_FOUND', '找不到使用者', 404);
    }

    // 若 Email 有變更：建立變更請求並寄送驗證信
    let mailed = false;
    let emailPending = null;
    if (fields.email && normalizeEmail(fields.email) !== normalizeEmail(current.email)) {
      try {
        await ensureEmailChangeRequestsTable();
        const token = crypto.randomBytes(20).toString('hex');
        const tokenExpiry = Date.now() + 3 * 24 * 60 * 60 * 1000; // 三天
        await pool.query(
          'INSERT INTO email_change_requests (user_id, new_email, token, token_expiry, used) VALUES (?, ?, ?, ?, 0) ON DUPLICATE KEY UPDATE new_email = VALUES(new_email), token = VALUES(token), token_expiry = VALUES(token_expiry), used = 0',
          [current.id, fields.email, token, tokenExpiry]
        );
        emailPending = fields.email;
        if (mailerReady){
          const apiBase = PUBLIC_API_BASE.replace(/\/$/, '');
          const confirmHref = apiBase ? `${apiBase}/confirm-email-change?token=${token}` : `${req.protocol}://${req.get('host')}/confirm-email-change?token=${token}`;
          await transporter.sendMail({
            from: `${EMAIL_FROM_NAME} <${EMAIL_FROM_ADDRESS}>`,
            to: fields.email,
            subject: 'Email 變更確認 - Leader Online',
            html: `
              <p>您好，您提出變更登入 Email 的請求，請點擊以下連結確認：</p>
              <p><a href="${confirmHref}">${confirmHref}</a></p>
              <p>此連結三天內有效。若非您本人操作，請忽略本郵件。</p>
            `,
          });
          mailed = true;
          try { await notifyLineByUserId(current.id, `【Leader Online】已寄出 Email 變更確認信至 ${fields.email}，請於三天內完成驗證。`) } catch (_) {}
        } else {
          try { await notifyLineByUserId(current.id, '【Leader Online】目前暫無法寄出 Email 變更確認信，請稍後再試或聯絡客服。') } catch (_) {}
        }
      } catch (_) { /* 忽略寄信失敗 */ }
    }

    // 重新簽發 Cookie（若 username 有變更）
    try {
      if (fields.username && fields.username !== current.username){
        const role = String(current.role || req.user.role || 'USER').toUpperCase();
        const token = signToken({ id: req.user.id, email: current.email, username: fields.username, role });
        setAuthCookie(res, token);
      }
    } catch (_) {}

    const msg = emailPending
      ? (mailed ? '已寄出 Email 變更驗證信，驗證成功後才會變更 Email' : '已建立 Email 變更請求，但郵件服務未設定')
      : (sets.length ? '已更新帳戶資料' : '無更新');
    return ok(res, { mailed: mailed || false, pendingEmail: emailPending || undefined }, msg);
  } catch (err) {
    return fail(res, 'ME_UPDATE_FAIL', err.message, 500);
  }
});

// Change my password (verify current password)
const SelfPasswordSchema = z.object({ currentPassword: z.string().min(8).max(100), newPassword: z.string().min(8).max(100) });
app.patch('/me/password', authRequired, async (req, res) => {
  const parsed = SelfPasswordSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  const { currentPassword, newPassword } = parsed.data;
  try {
    const [rows] = await pool.query('SELECT password_hash, email, username, role FROM users WHERE id = ? LIMIT 1', [req.user.id]);
    if (!rows.length) return fail(res, 'USER_NOT_FOUND', '找不到使用者', 404);
    const u = rows[0];
    const match = u.password_hash ? await bcrypt.compare(currentPassword, u.password_hash) : false;
    if (!match) return fail(res, 'AUTH_INVALID_CREDENTIALS', '目前密碼不正確', 400);
    const hash = await bcrypt.hash(newPassword, 12);
    const [r] = await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);
    if (!r.affectedRows) return fail(res, 'USER_NOT_FOUND', '找不到使用者', 404);
    // 重新簽發 token（帳號資料可能變更）
    const role = String(u.role || req.user.role || 'USER').toUpperCase();
    const token = signToken({ id: req.user.id, email: u.email, username: u.username, role });
    setAuthCookie(res, token);
    return ok(res, null, '密碼已更新');
  } catch (err) {
    return fail(res, 'ME_PASSWORD_CHANGE_FAIL', err.message, 500);
  }
});

// Export my full account data (requires password verification)
app.post('/me/export', authRequired, async (req, res) => {
  const parsed = SelfPasswordVerifySchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues?.[0]?.message || '格式錯誤', 400);
  const { currentPassword } = parsed.data;
  try {
    const [uRows] = await pool.query('SELECT id, username, email, role, password_hash, created_at, updated_at, phone, remittance_last5 FROM users WHERE id = ? LIMIT 1', [req.user.id]);
    if (!uRows.length) return fail(res, 'NOT_FOUND', '找不到帳號', 404);
    const u = uRows[0];
    const match = u.password_hash ? await bcrypt.compare(currentPassword, u.password_hash) : false;
    if (!match) return fail(res, 'AUTH_INVALID_CREDENTIALS', '目前密碼不正確', 400);

    // Collect related data
    const [tickets] = await pool.query('SELECT id, uuid, type, discount, used, expiry, created_at FROM tickets WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
    const [ordersRaw] = await pool.query('SELECT id, code, details, created_at FROM orders WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
    const orders = ordersRaw.map(row => ({
      id: row.id,
      code: row.code,
      created_at: row.created_at,
      details: ensureRemittance(safeParseJSON(row.details, {})),
    }));
    const [reservations] = await pool.query('SELECT id, ticket_type, store, event, reserved_at, verify_code, verify_code_pre_dropoff, verify_code_pre_pickup, verify_code_post_dropoff, verify_code_post_pickup, status FROM reservations WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
    const [transfersOut] = await pool.query('SELECT id, ticket_id, from_user_id, to_user_id, to_user_email, code, status, created_at, updated_at FROM ticket_transfers WHERE from_user_id = ? ORDER BY id DESC', [req.user.id]);
    const [transfersIn] = await pool.query('SELECT id, ticket_id, from_user_id, to_user_id, to_user_email, code, status, created_at, updated_at FROM ticket_transfers WHERE to_user_id = ? ORDER BY id DESC', [req.user.id]);
    try { await ensureTicketLogsTable() } catch (_) {}
    let logs = [];
    try {
      const [logRows] = await pool.query('SELECT id, ticket_id, user_id, action, meta, created_at FROM ticket_logs WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
      logs = logRows.map(r => ({ id: r.id, ticket_id: r.ticket_id, action: r.action, meta: safeParseJSON(r.meta, {}), created_at: r.created_at }));
    } catch (_) { logs = [] }

    // Linked OAuth providers
    let oauthIdentities = [];
    try {
      await ensureOAuthIdentitiesTable();
      const [oidRows] = await pool.query('SELECT id, provider, subject, email, created_at, updated_at FROM oauth_identities WHERE user_id = ? ORDER BY provider ASC, id DESC', [req.user.id]);
      oauthIdentities = oidRows.map(r => ({
        id: r.id,
        provider: r.provider ? String(r.provider).trim().toLowerCase() : null,
        subject: r.subject || null,
        email: r.email || null,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }));
    } catch (_) { oauthIdentities = []; }
    const providers = Array.from(new Set(oauthIdentities.map(o => o.provider).filter(Boolean)));

    // Pending email change requests
    let emailChangeRequests = [];
    try {
      await ensureEmailChangeRequestsTable();
      const [emailRows] = await pool.query('SELECT id, new_email, token, token_expiry, used, created_at, updated_at FROM email_change_requests WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
      emailChangeRequests = emailRows.map(r => ({
        id: r.id,
        new_email: r.new_email,
        token: r.token,
        token_expiry: r.token_expiry,
        used: Boolean(r.used),
        created_at: r.created_at,
        updated_at: r.updated_at,
      }));
    } catch (_) { emailChangeRequests = []; }

    // Password reset history
    let passwordResets = [];
    try {
      await ensurePasswordResetsTable();
      const [resetRows] = await pool.query('SELECT id, email, token, token_expiry, used, created_at, updated_at FROM password_resets WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
      passwordResets = resetRows.map(r => ({
        id: r.id,
        email: r.email,
        token: r.token,
        token_expiry: r.token_expiry,
        used: Boolean(r.used),
        created_at: r.created_at,
        updated_at: r.updated_at,
      }));
    } catch (_) { passwordResets = []; }

    // Shopping cart snapshot
    let cart = { items: [] };
    try {
      const [cartRows] = await pool.query('SELECT items, created_at, updated_at FROM user_carts WHERE user_id = ? LIMIT 1', [req.user.id]);
      if (cartRows.length) {
        cart = {
          items: normalizeCartItems(safeParseJSON(cartRows[0].items, [])),
          created_at: cartRows[0].created_at,
          updated_at: cartRows[0].updated_at,
        };
      }
    } catch (err) {
      if (err?.code === 'ER_NO_SUCH_TABLE') cart = { items: [] };
      else cart = { items: [], error: err.message };
    }

    const user = {
      id: u.id,
      username: u.username,
      email: u.email,
      role: u.role ? String(u.role).toUpperCase() : null,
      phone: u.phone || null,
      remittance_last5: u.remittance_last5 || null,
      created_at: u.created_at,
      updated_at: u.updated_at
    };
    return ok(res, {
      user,
      providers,
      cart,
      tickets,
      orders,
      reservations,
      transfers: { out: transfersOut, in: transfersIn },
      logs,
      security: {
        oauthIdentities,
        emailChangeRequests,
        passwordResets,
      },
      metadata: {
        exported_at: new Date().toISOString(),
      },
    }, 'EXPORT_OK');
  } catch (err) {
    return fail(res, 'ME_EXPORT_FAIL', err.message, 500);
  }
});

// Delete (anonymize) my account (requires password verification)
app.post('/me/delete', authRequired, async (req, res) => {
  const parsed = SelfPasswordVerifySchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues?.[0]?.message || '格式錯誤', 400);
  const { currentPassword } = parsed.data;
  const conn = await pool.getConnection();
  try {
    const [uRows] = await conn.query('SELECT id, email, username, password_hash FROM users WHERE id = ? LIMIT 1', [req.user.id]);
    if (!uRows.length) { conn.release(); return fail(res, 'NOT_FOUND', '找不到帳號', 404); }
    const u = uRows[0];
    const match = u.password_hash ? await bcrypt.compare(currentPassword, u.password_hash) : false;
    if (!match) { conn.release(); return fail(res, 'AUTH_INVALID_CREDENTIALS', '目前密碼不正確', 400); }

    // 封鎖此帳號已綁定的第三方登入（tombstone）並移除綁定
    try {
      await ensureOAuthIdentitiesTable();
      await ensureAccountTombstonesTable();
      const [ids] = await conn.query('SELECT provider, subject, email FROM oauth_identities WHERE user_id = ?', [u.id]);
      for (const it of (ids || [])){
        try { await conn.query('INSERT INTO account_tombstones (provider, subject, email, reason) VALUES (?, ?, ?, ?)', [String(it.provider||'').trim().toLowerCase(), String(it.subject||''), it.email || null, 'self_delete']); } catch(_){}
      }
      await conn.query('DELETE FROM oauth_identities WHERE user_id = ?', [u.id]);
    } catch (_) { /* ignore */ }

    // We cannot hard-delete due to FK, so anonymize the account
    const randomPass = crypto.randomBytes(16).toString('hex');
    const hash = await bcrypt.hash(randomPass, 12);
    const deletedEmail = `deleted+${u.id}+${Date.now()}@example.invalid`;
    await conn.query('UPDATE users SET email = ?, username = ?, password_hash = ? WHERE id = ?', [deletedEmail, 'Deleted User', hash, u.id]);

    // Clear auth cookie
    res.clearCookie('auth_token', cookieOptions());
    return ok(res, null, 'ACCOUNT_DELETED');
  } catch (err) {
    return fail(res, 'ME_DELETE_FAIL', err.message, 500);
  } finally { try { conn.release() } catch {} }
});

// Account cart sync
app.get('/cart', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT items FROM user_carts WHERE user_id = ? LIMIT 1', [req.user.id]);
    if (!rows.length) return ok(res, { items: [] }, 'OK');
    const items = normalizeCartItems(safeParseJSON(rows[0].items, []));
    return ok(res, { items }, 'OK');
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE') return ok(res, { items: [] }, 'OK');
    return fail(res, 'CART_FETCH_FAIL', err.message, 500);
  }
});

app.put('/cart', authRequired, async (req, res) => {
  const items = normalizeCartItems(req.body?.items);
  try {
    await pool.query(
      'INSERT INTO user_carts (user_id, items) VALUES (?, ?) ON DUPLICATE KEY UPDATE items = VALUES(items), updated_at = CURRENT_TIMESTAMP',
      [req.user.id, JSON.stringify(items)]
    );
    return ok(res, { items }, 'CART_SAVED');
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE') return ok(res, { items }, 'CART_SAVED');
    return fail(res, 'CART_SAVE_FAIL', err.message, 500);
  }
});

app.delete('/cart', authRequired, async (req, res) => {
  try {
    await pool.query('DELETE FROM user_carts WHERE user_id = ?', [req.user.id]);
    return ok(res, null, 'CART_CLEARED');
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE') return ok(res, null, 'CART_CLEARED');
    return fail(res, 'CART_CLEAR_FAIL', err.message, 500);
  }
});
// Admin: update user profile (username/email)
const AdminUserUpdateSchema = z.object({
  username: z.string().min(2).max(50).optional(),
  email: z.string().email().optional(),
});
app.patch('/admin/users/:id', adminOnly, async (req, res) => {
  const parsed = AdminUserUpdateSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  const fields = parsed.data;
  if (!Object.keys(fields).length) return ok(res, null, '無更新');

  try {
    // 讀取目前資料
    let current = null;
    try {
      const [uRows] = await pool.query('SELECT id, email, username FROM users WHERE id = ? LIMIT 1', [req.params.id]);
      current = uRows.length ? uRows[0] : null;
    } catch (_) { current = null }

    if (fields.email) {
      // .edu.tw 限制（若啟用）
      if (RESTRICT_EMAIL_DOMAIN_TO_EDU_TW && !eduEmailRegex.test(fields.email)) {
        return fail(res, 'EMAIL_DOMAIN_RESTRICTED', '僅允許使用 .edu.tw 學生信箱', 400);
      }
      const [dup] = await pool.query('SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1', [fields.email, req.params.id]);
      if (dup.length) return fail(res, 'EMAIL_TAKEN', 'Email 已被使用', 409);
    }
    // 僅更新非 Email 欄位
    const sets = [];
    const values = [];
    if (fields.username && current && fields.username !== current.username) { sets.push('username = ?'); values.push(fields.username); }
    if (sets.length){
      values.push(req.params.id);
      const [r] = await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, values);
      if (!r.affectedRows) return fail(res, 'USER_NOT_FOUND', '找不到使用者', 404);
    }

    // 若 Email 有變更：建立變更請求並寄送驗證信
    if (fields.email && current && normalizeEmail(fields.email) !== normalizeEmail(current.email)) {
      try {
        await ensureEmailChangeRequestsTable();
        const token = crypto.randomBytes(20).toString('hex');
        const tokenExpiry = Date.now() + 3 * 24 * 60 * 60 * 1000;
        await pool.query(
          'INSERT INTO email_change_requests (user_id, new_email, token, token_expiry, used) VALUES (?, ?, ?, ?, 0) ON DUPLICATE KEY UPDATE new_email = VALUES(new_email), token = VALUES(token), token_expiry = VALUES(token_expiry), used = 0',
          [current.id, fields.email, token, tokenExpiry]
        );
        if (mailerReady) {
          const apiBase = PUBLIC_API_BASE.replace(/\/$/, '');
          const confirmHref = apiBase ? `${apiBase}/confirm-email-change?token=${token}` : `${req.protocol}://${req.get('host')}/confirm-email-change?token=${token}`;
          await transporter.sendMail({
            from: `${EMAIL_FROM_NAME} <${EMAIL_FROM_ADDRESS}>`,
            to: fields.email,
            subject: 'Email 變更確認 - Leader Online',
            html: `
              <p>您好，管理員為您的帳號設定了新的 Email，請點擊以下連結確認此變更：</p>
              <p><a href="${confirmHref}">${confirmHref}</a></p>
              <p>此連結三天內有效。若非您本人操作，請忽略本郵件。</p>
            `,
          });
          try { await notifyLineByUserId(current.id, `【Leader Online】管理員已為您設定新的 Email，驗證信已寄至 ${fields.email}，請於三天內完成確認。`) } catch (_) {}
        } else {
          try { await notifyLineByUserId(current.id, '【Leader Online】管理員為您設定新的 Email，但目前無法寄出確認信，請稍後再試或聯絡客服。') } catch (_) {}
        }
      } catch (_) { /* ignore mail errors */ }
    }

    return ok(res, null, '已更新非 Email 欄位；若有 Email 變更，已寄出驗證信，驗證成功後才會生效');
  } catch (err) {
    return fail(res, 'ADMIN_USER_UPDATE_FAIL', err.message, 500);
  }
});

// Admin: reset user password
const AdminPasswordSchema = z.object({ password: z.string().min(8).max(100) });
app.patch('/admin/users/:id/password', adminOnly, async (req, res) => {
  const parsed = AdminPasswordSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  const { password } = parsed.data;
  try {
    const hash = await bcrypt.hash(password, 12);
    const [r] = await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.params.id]);
    if (!r.affectedRows) return fail(res, 'USER_NOT_FOUND', '找不到使用者', 404);
    return ok(res, null, '已重設密碼');
  } catch (err) {
    return fail(res, 'ADMIN_USER_RESET_PASSWORD_FAIL', err.message, 500);
  }
});

// Admin: delete user (and cleanup all associations)
app.delete('/admin/users/:id', adminOnly, async (req, res) => {
  const targetId = String(req.params.id || '').trim();
  if (!targetId) return fail(res, 'VALIDATION_ERROR', '缺少使用者 ID', 400);
  // 安全性：避免刪除自己（以免誤刪鎖帳）
  if (String(req.user?.id || '') === targetId) return fail(res, 'FORBIDDEN', '不可刪除自己', 400);

  let conn;
  let reservationPhotoPaths = [];
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // 確認使用者存在，並取得 email 供後續清理（可選）
    const [uRows] = await conn.query('SELECT id, email FROM users WHERE id = ? LIMIT 1', [targetId]);
    if (!uRows.length) { await conn.rollback(); return fail(res, 'USER_NOT_FOUND', '找不到使用者', 404); }
    const user = uRows[0];

    // 0) 封鎖此帳號已綁定的第三方登入（tombstone）並移除綁定
    try {
      await ensureOAuthIdentitiesTable();
      await ensureAccountTombstonesTable();
      const [ids] = await conn.query('SELECT provider, subject, email FROM oauth_identities WHERE user_id = ?', [targetId]);
      for (const it of (ids || [])){
        try { await conn.query('INSERT INTO account_tombstones (provider, subject, email, reason) VALUES (?, ?, ?, ?)', [String(it.provider||'').trim().toLowerCase(), String(it.subject||''), it.email || null, 'admin_delete']); } catch(_){}
      }
      await conn.query('DELETE FROM oauth_identities WHERE user_id = ?', [targetId]);
    } catch (_) { /* ignore */ }

    // 1) 刪除與票券轉贈相關的紀錄（來自/給予/所擁有票券）
    try {
      await conn.query(
        'DELETE FROM ticket_transfers WHERE from_user_id = ? OR to_user_id = ? OR ticket_id IN (SELECT id FROM tickets WHERE user_id = ?)',
        [targetId, targetId, targetId]
      );
    } catch (_) { /* 表可能不存在，忽略 */ }

    // 2) 刪除票券、預約、訂單
    if (checklistPhotosHaveStoragePath) {
      try {
        const [photoRows] = await conn.query(
          'SELECT storage_path FROM reservation_checklist_photos WHERE reservation_id IN (SELECT id FROM reservations WHERE user_id = ?)',
          [targetId]
        );
        reservationPhotoPaths = (photoRows || [])
          .map((row) => row?.storage_path ? storage.normalizeRelativePath(row.storage_path) : null)
          .filter(Boolean);
      } catch (_) { /* ignore */ }
    }

    try { await conn.query('DELETE FROM tickets WHERE user_id = ?', [targetId]); } catch (_) {}
    try { await conn.query('DELETE FROM reservations WHERE user_id = ?', [targetId]); } catch (_) {}
    try { await conn.query('DELETE FROM orders WHERE user_id = ?', [targetId]); } catch (_) {}

    // 3) 釋放活動擁有權（若存在外鍵會於刪除使用者時自動 SET NULL；此處顯式處理以兼容舊資料庫）
    try { await conn.query('UPDATE events SET owner_user_id = NULL WHERE owner_user_id = ?', [targetId]); } catch (_) {}

    // 4) 可選：刪除 email 驗證記錄（若表存在）
    try { await conn.query('DELETE FROM email_verifications WHERE LOWER(email) = LOWER(?)', [user.email || '']); } catch (_) {}

    // 5) 刪除使用者本身
    const [d] = await conn.query('DELETE FROM users WHERE id = ?', [targetId]);
    if (!d.affectedRows) { await conn.rollback(); return fail(res, 'USER_NOT_FOUND', '找不到使用者', 404); }

    await conn.commit();
    for (const relPath of reservationPhotoPaths) {
      await storage.deleteFile(relPath).catch(() => {});
    }
    return ok(res, null, '使用者與其關聯已刪除');
  } catch (err) {
    try { if (conn) await conn.rollback(); } catch {}
    return fail(res, 'ADMIN_USER_DELETE_FAIL', err.message, 500);
  } finally {
    if (conn) conn.release();
  }
});

/** ======== Products / Events ======== */
app.get('/products', async (req, res) => {
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

app.post('/admin/products', adminOrEditorOnly, async (req, res) => {
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

app.patch('/admin/products/:id', adminOrEditorOnly, async (req, res) => {
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

app.delete('/admin/products/:id', adminOrEditorOnly, async (req, res) => {
  try {
    const [r] = await pool.query('DELETE FROM products WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return fail(res, 'PRODUCT_NOT_FOUND', '找不到商品', 404);
    return ok(res, null, '商品已刪除');
  } catch (err) {
    return fail(res, 'ADMIN_PRODUCT_DELETE_FAIL', err.message, 500);
  }
});

app.get('/events', async (req, res) => {
  try {
    if (eventListCache.value && eventListCache.expiresAt > Date.now()) {
      return ok(res, eventListCache.value);
    }
    // 避免傳回 BLOB，明確排除 cover_data；僅返回未到期活動
    const [rows] = await pool.query(
      'SELECT id, code, title, starts_at, ends_at, deadline, location, description, cover, cover_type, rules, created_at, updated_at FROM events WHERE COALESCE(deadline, ends_at) IS NULL OR COALESCE(deadline, ends_at) >= NOW() ORDER BY starts_at ASC'
    );
    const list = rows.map(r => ({
      ...r,
      code: r.code || `EV${String(r.id).padStart(6, '0')}`,
    }));
    eventListCache = { value: list, expiresAt: Date.now() + DEFAULT_CACHE_TTL };
    return ok(res, list);
  } catch (err) {
    return fail(res, 'EVENTS_LIST_FAIL', err.message, 500);
  }
});

app.get('/events/:id', async (req, res) => {
  try {
    const event = await getEventById(req.params.id, { useCache: true });
    if (!event) return fail(res, 'EVENT_NOT_FOUND', '找不到活動', 404);
    return ok(res, event);
  } catch (err) {
    return fail(res, 'EVENT_READ_FAIL', err.message, 500);
  }
});

// Admin Events list (ADMIN: all, STORE: owned only)
app.get('/admin/events', eventManagerOnly, async (req, res) => {
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
app.get('/events/:id/stores', async (req, res) => {
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

app.post('/admin/events', eventManagerOnly, async (req, res) => {
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

app.patch('/admin/events/:id', eventManagerOnly, async (req, res) => {
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
app.delete('/admin/events/:id/cover', eventManagerOnly, async (req, res) => {
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
app.post('/admin/events/:id/cover_json', eventManagerOnly, async (req, res) => {
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return fail(res, 'VALIDATION_ERROR', '活動編號不正確', 400);
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
    if (eventsHaveCoverPathColumn) {
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
    }

    const sql = eventsHaveCoverPathColumn
      ? 'UPDATE events SET cover = NULL, cover_type = ?, cover_path = ?, cover_data = NULL WHERE id = ?'
      : 'UPDATE events SET cover_type = ?, cover_data = ? WHERE id = ?';
    const params = eventsHaveCoverPathColumn
      ? [contentType, storagePathRelative, eventId]
      : [contentType, buffer, eventId];
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
app.get('/events/:id/cover', async (req, res) => {
  try {
    const selectSql = eventsHaveCoverPathColumn
      ? 'SELECT cover, cover_type, cover_data, cover_path, updated_at FROM events WHERE id = ? LIMIT 1'
      : 'SELECT cover, cover_type, cover_data, updated_at FROM events WHERE id = ? LIMIT 1';
    const [rows] = await pool.query(selectSql, [req.params.id]);
    if (!rows.length) return res.status(404).end();
    const e = rows[0];
    if (eventsHaveCoverPathColumn && e.cover_path) {
      const relPath = storage.normalizeRelativePath(e.cover_path);
      if (await storage.fileExists(relPath)) {
        const stat = await storage.getFileStat(relPath);
        res.setHeader('Content-Type', e.cover_type || 'application/octet-stream');
        if (stat?.size) res.setHeader('Content-Length', stat.size);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        const stream = storage.createReadStream(relPath);
        stream.on('error', (err) => {
          console.error('serveEventCover stream error:', err?.message || err);
          if (!res.headersSent) res.status(500).end();
          else res.destroy();
        });
        stream.pipe(res);
        return;
      }
    }
    if (e.cover_data && e.cover_type) {
      res.setHeader('Content-Type', e.cover_type);
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

app.delete('/admin/events/:id', eventManagerOnly, async (req, res) => {
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
const StoreCreateSchema = z.object({
  name: z.string().min(1),
  pre_start: z.string().optional(),
  pre_end: z.string().optional(),
  post_start: z.string().optional(),
  post_end: z.string().optional(),
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
        pre_start DATE NULL,
        pre_end DATE NULL,
        post_start DATE NULL,
        post_end DATE NULL,
        prices TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`
    );
  } catch (_) { /* ignore */ }
}

app.get('/admin/store_templates', eventManagerOnly, async (req, res) => {
  try {
    await ensureStoreTemplatesTable();
    const [rows] = await pool.query('SELECT * FROM store_templates ORDER BY id DESC');
    const list = rows.map(r => ({ ...r, prices: safeParseJSON(r.prices, {}) }));
    return ok(res, list);
  } catch (err) {
    return fail(res, 'ADMIN_STORE_TEMPLATES_LIST_FAIL', err.message, 500);
  }
});

app.post('/admin/store_templates', eventManagerOnly, async (req, res) => {
  const parsed = StoreCreateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  const { name, pre_start, pre_end, post_start, post_end, prices } = parsed.data;
  try {
    await ensureStoreTemplatesTable();
    const [r] = await pool.query(
      'INSERT INTO store_templates (name, pre_start, pre_end, post_start, post_end, prices) VALUES (?, ?, ?, ?, ?, ?)',
      [name, normalizeDateInput(pre_start), normalizeDateInput(pre_end), normalizeDateInput(post_start), normalizeDateInput(post_end), JSON.stringify(prices)]
    );
    return ok(res, { id: r.insertId }, '模板已新增');
  } catch (err) {
    return fail(res, 'ADMIN_STORE_TEMPLATE_CREATE_FAIL', err.message, 500);
  }
});

app.patch('/admin/store_templates/:id', eventManagerOnly, async (req, res) => {
  const parsed = StoreUpdateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  const fields = parsed.data;
  if (fields.pre_start !== undefined) fields.pre_start = normalizeDateInput(fields.pre_start);
  if (fields.pre_end !== undefined) fields.pre_end = normalizeDateInput(fields.pre_end);
  if (fields.post_start !== undefined) fields.post_start = normalizeDateInput(fields.post_start);
  if (fields.post_end !== undefined) fields.post_end = normalizeDateInput(fields.post_end);
  if (fields.prices !== undefined) fields.prices = JSON.stringify(fields.prices);
  const sets = [];
  const values = [];
  for (const [k, v] of Object.entries(fields)) { sets.push(`${k} = ?`); values.push(v); }
  if (!sets.length) return ok(res, null, '無更新');
  values.push(req.params.id);
  try {
    await ensureStoreTemplatesTable();
    const [r] = await pool.query(`UPDATE store_templates SET ${sets.join(', ')} WHERE id = ?`, values);
    if (!r.affectedRows) return fail(res, 'STORE_TEMPLATE_NOT_FOUND', '找不到模板', 404);
    return ok(res, null, '模板已更新');
  } catch (err) {
    return fail(res, 'ADMIN_STORE_TEMPLATE_UPDATE_FAIL', err.message, 500);
  }
});

app.delete('/admin/store_templates/:id', eventManagerOnly, async (req, res) => {
  try {
    await ensureStoreTemplatesTable();
    const [r] = await pool.query('DELETE FROM store_templates WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return fail(res, 'STORE_TEMPLATE_NOT_FOUND', '找不到模板', 404);
    return ok(res, null, '模板已刪除');
  } catch (err) {
    return fail(res, 'ADMIN_STORE_TEMPLATE_DELETE_FAIL', err.message, 500);
  }
});

app.get('/admin/events/:id/stores', eventManagerOnly, async (req, res) => {
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

app.post('/admin/events/:id/stores', eventManagerOnly, async (req, res) => {
  const parsed = StoreCreateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  const { name, pre_start, pre_end, post_start, post_end, prices } = parsed.data;
  try {
    if (isSTORE(req.user.role)){
      const [e] = await pool.query('SELECT owner_user_id FROM events WHERE id = ? LIMIT 1', [req.params.id]);
      if (!e.length) return fail(res, 'EVENT_NOT_FOUND', '找不到活動', 404);
      if (String(e[0].owner_user_id || '') !== String(req.user.id)) return fail(res, 'FORBIDDEN', '無權限操作此活動', 403);
    }
    const [r] = await pool.query(
      'INSERT INTO event_stores (event_id, name, pre_start, pre_end, post_start, post_end, prices) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.params.id, name, normalizeDateInput(pre_start), normalizeDateInput(pre_end), normalizeDateInput(post_start), normalizeDateInput(post_end), JSON.stringify(prices)]
    );
    invalidateEventStoresCache(req.params.id);
    invalidateEventCaches(req.params.id);
    return ok(res, { id: r.insertId }, '店面已新增');
  } catch (err) {
    return fail(res, 'ADMIN_EVENT_STORE_CREATE_FAIL', err.message, 500);
  }
});

app.patch('/admin/events/stores/:storeId', eventManagerOnly, async (req, res) => {
  const parsed = StoreUpdateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  const fields = parsed.data;
  if (fields.pre_start !== undefined) fields.pre_start = normalizeDateInput(fields.pre_start);
  if (fields.pre_end !== undefined) fields.pre_end = normalizeDateInput(fields.pre_end);
  if (fields.post_start !== undefined) fields.post_start = normalizeDateInput(fields.post_start);
  if (fields.post_end !== undefined) fields.post_end = normalizeDateInput(fields.post_end);
  if (fields.prices !== undefined) fields.prices = JSON.stringify(fields.prices);
  const sets = [];
  const values = [];
  for (const [k, v] of Object.entries(fields)) { sets.push(`${k} = ?`); values.push(v); }
  if (!sets.length) return ok(res, null, '無更新');
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
    const [r] = await pool.query(`UPDATE event_stores SET ${sets.join(', ')} WHERE id = ?`, values);
    if (!r.affectedRows) return fail(res, 'STORE_NOT_FOUND', '找不到店面', 404);
    invalidateEventStoresCache(eventIdForCache);
    invalidateEventCaches(eventIdForCache);
    return ok(res, null, '店面已更新');
  } catch (err) {
    return fail(res, 'ADMIN_EVENT_STORE_UPDATE_FAIL', err.message, 500);
  }
});

app.delete('/admin/events/stores/:storeId', eventManagerOnly, async (req, res) => {
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

/** ======== Tickets（你的「優惠券」） ======== */
app.get('/tickets/me', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, uuid, type, discount, used, expiry FROM tickets WHERE user_id = ?',
      [req.user.id]
    );
    return ok(res, rows);
  } catch (err) {
    return fail(res, 'TICKETS_LIST_FAIL', err.message, 500);
  }
});

// List my ticket logs (issuance, transfers, usage)
app.get('/tickets/logs', authRequired, async (req, res) => {
  try {
    await ensureTicketLogsTable();
    const limit = Math.min(Math.max(parseInt(req.query?.limit || '100', 10) || 100, 1), 500);
    const [rows] = await pool.query('SELECT id, ticket_id, user_id, action, meta, created_at FROM ticket_logs WHERE user_id = ? ORDER BY id DESC LIMIT ?', [req.user.id, limit]);
    // Normalize rows: parse meta JSON
    const list = rows.map(r => ({ id: r.id, ticket_id: r.ticket_id, user_id: r.user_id, action: r.action, meta: safeParseJSON(r.meta, {}), created_at: r.created_at }));
    return ok(res, list);
  } catch (err) {
    return fail(res, 'TICKET_LOGS_FAIL', err.message, 500);
  }
});

app.patch('/tickets/:id/use', authRequired, async (req, res) => {
  try {
    const [result] = await pool.query(
      'UPDATE tickets SET used = 1 WHERE id = ? AND user_id = ? AND used = 0 AND (expiry IS NULL OR expiry >= CURRENT_DATE())',
      [req.params.id, req.user.id]
    );
    if (!result.affectedRows) return fail(res, 'TICKET_NOT_FOUND', '找不到可用的票券', 404);
    try { await logTicket({ ticketId: Number(req.params.id), userId: req.user.id, action: 'used', meta: {} }) } catch (_) {}
    return ok(res, null, '票券已使用');
  } catch (err) {
    return fail(res, 'TICKET_USE_FAIL', err.message, 500);
  }
});

/** ======== Ticket Transfers ======== */
function normalizeEmail(e){ return (e || '').toString().trim().toLowerCase() }

async function findUserIdByEmail(email){
  try {
    const [rows] = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [email]);
    return rows.length ? rows[0].id : null;
  } catch { return null }
}

async function hasPendingTransfer(ticketId){
  const [rows] = await pool.query('SELECT id FROM ticket_transfers WHERE ticket_id = ? AND status = "pending" LIMIT 1', [ticketId]);
  return rows.length > 0;
}

function randomAlnum(n = 10){ return randomCode(n) }
async function generateTransferCode(){
  for(;;){
    const code = randomAlnum(10)
    const [dup] = await pool.query('SELECT id FROM ticket_transfers WHERE code = ? LIMIT 1', [code])
    if (!dup.length) return code
  }
}

/** ======== Ticket Logs ======== */
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

/** ======== OAuth identities（綁定第三方登入） ======== */
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

/** ======== Account tombstones（封鎖已刪帳號的第三方登入） ======== */
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

// Expire old transfers to avoid stuck pendings
async function expireOldTransfers() {
  try {
    await pool.query(
      `UPDATE ticket_transfers
       SET status = 'expired'
       WHERE status = 'pending' AND (
         (code IS NOT NULL AND created_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)) OR
         (code IS NULL AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY))
       )`
    );
  } catch (_) { /* ignore */ }
}

// Initiate transfer by email or QR
app.post('/tickets/transfers/initiate', authRequired, async (req, res) => {
  const { ticketId, mode, email } = req.body || {};
  if (!Number(ticketId) || !['email','qr'].includes(mode)) return fail(res, 'VALIDATION_ERROR', '參數錯誤', 400);
  try {
    await expireOldTransfers();
    const [rows] = await pool.query('SELECT id, user_id, used FROM tickets WHERE id = ? LIMIT 1', [ticketId]);
    if (!rows.length) return fail(res, 'TICKET_NOT_FOUND', '找不到票券', 404);
    const t = rows[0];
    if (String(t.user_id) !== String(req.user.id)) return fail(res, 'FORBIDDEN', '僅限持有者轉贈', 403);
    if (Number(t.used)) return fail(res, 'TICKET_USED', '票券已使用，無法轉贈', 400);
    if (await hasPendingTransfer(t.id)) return fail(res, 'TRANSFER_EXISTS', '已有待處理的轉贈', 409);

  if (mode === 'email'){
    const targetEmail = normalizeEmail(email);
    if (!targetEmail) return fail(res, 'VALIDATION_ERROR', '需提供對方 Email', 400);
    if (targetEmail === normalizeEmail(req.user.email)) return fail(res, 'VALIDATION_ERROR', '不可轉贈給自己', 400);
    const toId = await findUserIdByEmail(targetEmail);
    await pool.query(
      'INSERT INTO ticket_transfers (ticket_id, from_user_id, to_user_id, to_user_email, code, status) VALUES (?, ?, ?, ?, NULL, "pending")',
      [t.id, req.user.id, toId, targetEmail]
    );
    // 若對方尚未註冊，寄送註冊邀請信
    try {
      if (!toId && mailerReady) {
        const link = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/login?email=${encodeURIComponent(targetEmail)}&register=1`;
        await transporter.sendMail({
          from: `${EMAIL_FROM_NAME} <${EMAIL_FROM_ADDRESS}>`,
          to: targetEmail,
          subject: '您收到一張票券轉贈 - Leader Online',
          html: `
            <p>您好，您收到一張來自 ${req.user?.username || '朋友'} 的票券轉贈。</p>
            <p>請使用此 Email 註冊帳號以自動領取票券：</p>
            <p><a href="${link}">${link}</a></p>
            <p>若非您本人操作，可忽略此郵件。</p>
          `,
        });
      }
    } catch (_) { /* 寄信失敗不影響流程 */ }
    return ok(res, null, '已發起轉贈（等待對方接受）');
  } else {
      const code = await generateTransferCode();
      await pool.query(
        'INSERT INTO ticket_transfers (ticket_id, from_user_id, code, status) VALUES (?, ?, ?, "pending")',
        [t.id, req.user.id, code]
      );
      return ok(res, { code }, '請出示 QR 給對方掃描立即轉贈');
    }
  } catch (err) {
    return fail(res, 'TRANSFER_INITIATE_FAIL', err.message, 500);
  }
});

// Recipient: accept or decline by ID
app.post('/tickets/transfers/:id/accept', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return fail(res, 'VALIDATION_ERROR', '參數錯誤', 400);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE ticket_transfers
       SET status = 'expired'
       WHERE status = 'pending' AND (
         (code IS NOT NULL AND created_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)) OR
         (code IS NULL AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY))
       )`
    );
    const [rows] = await conn.query('SELECT * FROM ticket_transfers WHERE id = ? AND status = "pending" LIMIT 1', [id]);
    if (!rows.length) { await conn.rollback(); return fail(res, 'TRANSFER_NOT_FOUND', '找不到待處理的轉贈', 404) }
    const tr = rows[0];
    const myEmail = normalizeEmail(req.user.email);
    if (String(tr.to_user_id || '') !== String(req.user.id) && normalizeEmail(tr.to_user_email || '') !== myEmail) {
      await conn.rollback(); return fail(res, 'FORBIDDEN', '僅限被指定的帳號接受', 403)
    }
    if (String(tr.from_user_id) === String(req.user.id)) { await conn.rollback(); return fail(res, 'FORBIDDEN', '不可自行接受', 403) }

    const [tkRows] = await conn.query('SELECT id, user_id, used FROM tickets WHERE id = ? LIMIT 1', [tr.ticket_id]);
    if (!tkRows.length) { await conn.rollback(); return fail(res, 'TICKET_NOT_FOUND', '票券不存在', 404) }
    const tk = tkRows[0];
    if (Number(tk.used)) { await conn.rollback(); return fail(res, 'TICKET_USED', '票券已使用', 400) }
    if (String(tk.user_id) !== String(tr.from_user_id)) { await conn.rollback(); return fail(res, 'TRANSFER_INVALID', '票券持有者已變更', 409) }

    // Transfer ownership atomically
    const [upd] = await conn.query('UPDATE tickets SET user_id = ? WHERE id = ? AND user_id = ?', [req.user.id, tk.id, tr.from_user_id]);
    if (!upd.affectedRows) { await conn.rollback(); return fail(res, 'TRANSFER_CONFLICT', '轉贈競態，請重試', 409) }

    // Mark transfer accepted and cancel other pendings for this ticket
    await conn.query('UPDATE ticket_transfers SET status = "accepted", to_user_id = COALESCE(to_user_id, ?) WHERE id = ?', [req.user.id, id]);
    await conn.query('UPDATE ticket_transfers SET status = "canceled" WHERE ticket_id = ? AND status = "pending" AND id <> ?', [tk.id, id]);

    // Log transfer in/out
    try {
      const method = tr.code ? 'qr' : 'email'
      const [fromU] = await conn.query('SELECT email, username FROM users WHERE id = ? LIMIT 1', [tr.from_user_id])
      const metaCommon = { method, ticket_type: tk.type, transfer_id: tr.id, from_email: fromU?.[0]?.email || null, to_email: req.user.email || null }
      await logTicket({ conn, ticketId: tk.id, userId: tr.from_user_id, action: 'transferred_out', meta: metaCommon })
      await logTicket({ conn, ticketId: tk.id, userId: req.user.id, action: 'transferred_in', meta: metaCommon })
    } catch (_) { /* ignore */ }

    await conn.commit();
    // 推送給雙方（Flex，最佳努力）
    try {
      const lineFrom = await getLineSubjectByUserId(tr.from_user_id);
      const lineTo = await getLineSubjectByUserId(req.user.id);
      if (lineFrom) await linePush(lineFrom, buildTransferAcceptedForSenderFlex(tk.type, req.user?.username));
      if (lineTo) await linePush(lineTo, buildTransferAcceptedForRecipientFlex(tk.type));
    } catch (_) {}
    return ok(res, null, '已接受並完成轉贈');
  } catch (err) {
    try { await conn.rollback() } catch(_){}
    return fail(res, 'TRANSFER_ACCEPT_FAIL', err.message, 500);
  } finally { conn.release() }
});

app.post('/tickets/transfers/:id/decline', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return fail(res, 'VALIDATION_ERROR', '參數錯誤', 400);
  try {
    await expireOldTransfers();
    const [r] = await pool.query(
      'UPDATE ticket_transfers SET status = "declined" WHERE id = ? AND status = "pending" AND (to_user_id = ? OR LOWER(to_user_email) = LOWER(?))',
      [id, req.user.id, req.user.email || '']
    );
    if (!r.affectedRows) return fail(res, 'TRANSFER_NOT_FOUND', '找不到待處理的轉贈', 404);
    return ok(res, null, '已拒絕轉贈');
  } catch (err) {
    return fail(res, 'TRANSFER_DECLINE_FAIL', err.message, 500);
  }
});

// Recipient: claim by QR code (immediate transfer)
app.post('/tickets/transfers/claim_code', authRequired, async (req, res) => {
  const raw = (req.body?.code || '').toString().trim();
  if (!raw) return fail(res, 'VALIDATION_ERROR', '缺少驗證碼', 400);
  const code = raw.replace(/\s+/g, '');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE ticket_transfers
       SET status = 'expired'
       WHERE status = 'pending' AND (
         (code IS NOT NULL AND created_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)) OR
         (code IS NULL AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY))
       )`
    );
    const [rows] = await conn.query('SELECT * FROM ticket_transfers WHERE code = ? AND status = "pending" LIMIT 1', [code]);
    if (!rows.length) { await conn.rollback(); return fail(res, 'CODE_NOT_FOUND', '無效或已處理的轉贈碼', 404) }
    const tr = rows[0];
    if (String(tr.from_user_id) === String(req.user.id)) { await conn.rollback(); return fail(res, 'FORBIDDEN', '不可轉贈給自己', 403) }
    const [tkRows] = await conn.query('SELECT id, user_id, used FROM tickets WHERE id = ? LIMIT 1', [tr.ticket_id]);
    if (!tkRows.length) { await conn.rollback(); return fail(res, 'TICKET_NOT_FOUND', '票券不存在', 404) }
    const tk = tkRows[0];
    if (Number(tk.used)) { await conn.rollback(); return fail(res, 'TICKET_USED', '票券已使用', 400) }
    if (String(tk.user_id) !== String(tr.from_user_id)) { await conn.rollback(); return fail(res, 'TRANSFER_INVALID', '票券持有者已變更', 409) }

    const [upd] = await conn.query('UPDATE tickets SET user_id = ? WHERE id = ? AND user_id = ?', [req.user.id, tk.id, tr.from_user_id]);
    if (!upd.affectedRows) { await conn.rollback(); return fail(res, 'TRANSFER_CONFLICT', '轉贈競態，請重試', 409) }

    await conn.query('UPDATE ticket_transfers SET status = "accepted", to_user_id = ? WHERE id = ?', [req.user.id, tr.id]);
    await conn.query('UPDATE ticket_transfers SET status = "canceled" WHERE ticket_id = ? AND status = "pending" AND id <> ?', [tk.id, tr.id]);

    // Log transfer in/out
    try {
      const method = tr.code ? 'qr' : 'email'
      const [fromU] = await conn.query('SELECT email, username FROM users WHERE id = ? LIMIT 1', [tr.from_user_id])
      const metaCommon = { method, ticket_type: tk.type, transfer_id: tr.id, from_email: fromU?.[0]?.email || null, to_email: req.user.email || null }
      await logTicket({ conn, ticketId: tk.id, userId: tr.from_user_id, action: 'transferred_out', meta: metaCommon })
      await logTicket({ conn, ticketId: tk.id, userId: req.user.id, action: 'transferred_in', meta: metaCommon })
    } catch (_) { /* ignore */ }

    await conn.commit();
    // 推送給雙方（Flex，最佳努力）
    try {
      const lineFrom = await getLineSubjectByUserId(tr.from_user_id);
      const lineTo = await getLineSubjectByUserId(req.user.id);
      if (lineFrom) await linePush(lineFrom, buildTransferAcceptedForSenderFlex(tk.type, req.user?.username));
      if (lineTo) await linePush(lineTo, buildTransferAcceptedForRecipientFlex(tk.type));
    } catch (_) {}
    return ok(res, null, '已完成轉贈');
  } catch (err) {
    try { await conn.rollback() } catch(_){}
    return fail(res, 'TRANSFER_CLAIM_FAIL', err.message, 500);
  } finally { conn.release() }
});

// Receiver: list pending incoming transfers
app.get('/tickets/transfers/incoming', authRequired, async (req, res) => {
  try {
    await expireOldTransfers();
    const [rows] = await pool.query(
      `SELECT tt.*, t.type, t.expiry, u.username AS from_username, u.email AS from_email
       FROM ticket_transfers tt
       JOIN tickets t ON t.id = tt.ticket_id
       JOIN users u ON u.id = tt.from_user_id
       WHERE tt.status = 'pending'
         AND (tt.to_user_id = ? OR (tt.to_user_id IS NULL AND LOWER(tt.to_user_email) = LOWER(?)))
       ORDER BY tt.id ASC`,
      [req.user.id, req.user.email || '']
    );
    return ok(res, rows);
  } catch (err) {
    return fail(res, 'INCOMING_TRANSFERS_FAIL', err.message, 500);
  }
});

// Sender: cancel current pending transfer(s) for a ticket
app.post('/tickets/transfers/cancel_pending', authRequired, async (req, res) => {
  const { ticketId } = req.body || {};
  if (!Number(ticketId)) return fail(res, 'VALIDATION_ERROR', '參數錯誤', 400);
  try {
    const [t] = await pool.query('SELECT id, user_id FROM tickets WHERE id = ? LIMIT 1', [ticketId]);
    if (!t.length) return fail(res, 'TICKET_NOT_FOUND', '找不到票券', 404);
    if (String(t[0].user_id) !== String(req.user.id)) return fail(res, 'FORBIDDEN', '僅限持有者取消', 403);
    await pool.query('UPDATE ticket_transfers SET status = "canceled" WHERE ticket_id = ? AND from_user_id = ? AND status = "pending"', [ticketId, req.user.id]);
    return ok(res, null, '已取消待處理的轉贈');
  } catch (err) {
    return fail(res, 'TRANSFER_CANCEL_FAIL', err.message, 500);
  }
});

/** ======== Auth providers (link/unlink) ======== */
app.get('/auth/providers', authRequired, async (req, res) => {
  try {
    await ensureOAuthIdentitiesTable();
    // SQL 層先做 TRIM+LOWER，前端顯示更穩健
    const [rows] = await pool.query(
      'SELECT TRIM(LOWER(provider)) AS provider FROM oauth_identities WHERE user_id = ? ORDER BY provider ASC',
      [req.user.id]
    );
    // 仍保留一道保險（去重與過濾空值）
    const providers = Array.from(new Set(rows
      .map(r => String(r.provider || '').trim().toLowerCase())
      .filter(Boolean)));
    return ok(res, providers);
  } catch (err) {
    return fail(res, 'AUTH_PROVIDERS_LIST_FAIL', err.message, 500);
  }
});

app.delete('/auth/providers/google', authRequired, async (req, res) => {
  try {
    await ensureOAuthIdentitiesTable();
    await pool.query('DELETE FROM oauth_identities WHERE user_id = ? AND provider = ? LIMIT 1', [req.user.id, 'google']);
    return ok(res, null, 'UNLINKED');
  } catch (err) {
    return fail(res, 'AUTH_PROVIDER_UNLINK_FAIL', err.message, 500);
  }
});

app.delete('/auth/providers/line', authRequired, async (req, res) => {
  try {
    await ensureOAuthIdentitiesTable();
    await pool.query('DELETE FROM oauth_identities WHERE user_id = ? AND provider = ? LIMIT 1', [req.user.id, 'line']);
    return ok(res, null, 'UNLINKED');
  } catch (err) {
    return fail(res, 'AUTH_PROVIDER_UNLINK_FAIL', err.message, 500);
  }
});

// Admin: manage OAuth bindings per user
const AdminOAuthBindSchema = z.object({
  provider: z.string().min(2),
  subject: z.string().min(3),
  email: z.string().email().optional(),
});

// List a user's oauth identities
app.get('/admin/users/:id/oauth_identities', adminOnly, async (req, res) => {
  try {
    await ensureOAuthIdentitiesTable();
    const [rows] = await pool.query(
      'SELECT id, provider, subject, email, created_at, updated_at FROM oauth_identities WHERE user_id = ? ORDER BY provider ASC, id DESC',
      [req.params.id]
    );
    const list = rows.map(r => ({ ...r, provider: String(r.provider || '').trim().toLowerCase() }));
    return ok(res, list);
  } catch (err) {
    return fail(res, 'ADMIN_OAUTH_IDENTITIES_LIST_FAIL', err.message, 500);
  }
});

// Add or update a binding (provider+subject) for a specific user
app.post('/admin/users/:id/oauth_identities', adminOnly, async (req, res) => {
  const parsed = AdminOAuthBindSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  const { provider, subject } = parsed.data;
  const email = (parsed.data.email || null);
  const p = String(provider || '').trim().toLowerCase();
  if (!['google', 'line'].includes(p)) return fail(res, 'VALIDATION_ERROR', 'provider 僅支援 google 或 line', 400);
  try {
    await ensureOAuthIdentitiesTable();
    // 確認使用者存在
    const [uRows] = await pool.query('SELECT id FROM users WHERE id = ? LIMIT 1', [req.params.id]);
    if (!uRows.length) return fail(res, 'USER_NOT_FOUND', '找不到使用者', 404);
    // 同一 subject 不可綁到不同 user
    const [dup] = await pool.query('SELECT user_id FROM oauth_identities WHERE provider = ? AND subject = ? LIMIT 1', [p, subject]);
    if (dup.length && String(dup[0].user_id) !== String(req.params.id)) {
      return fail(res, 'SUBJECT_TAKEN', '此第三方帳號已綁定到其他使用者', 409);
    }
    // upsert by unique (provider, subject)
    await pool.query(
      'INSERT INTO oauth_identities (user_id, provider, subject, email) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), email = VALUES(email)',
      [req.params.id, p, subject, email]
    );
    return ok(res, null, 'LINKED');
  } catch (err) {
    return fail(res, 'ADMIN_OAUTH_IDENTITY_LINK_FAIL', err.message, 500);
  }
});

// Remove a binding by provider for a specific user
app.delete('/admin/users/:id/oauth_identities/:provider', adminOnly, async (req, res) => {
  try {
    const p = String(req.params.provider || '').trim().toLowerCase();
    await ensureOAuthIdentitiesTable();
    await pool.query('DELETE FROM oauth_identities WHERE user_id = ? AND provider = ?', [req.params.id, p]);
    return ok(res, null, 'UNLINKED');
  } catch (err) {
    return fail(res, 'ADMIN_OAUTH_IDENTITY_UNLINK_FAIL', err.message, 500);
  }
});

// Admin: one-click cleanup (normalize providers)
app.post('/admin/oauth/cleanup_providers', adminOnly, async (req, res) => {
  try {
    await ensureOAuthIdentitiesTable();
    // 先去除 normalize 後的重複（保留每組最小 id）
    const [d] = await pool.query(`
      DELETE oi FROM oauth_identities oi
      JOIN (
        SELECT LOWER(TRIM(provider)) AS provider, subject, MIN(id) AS keep_id
        FROM oauth_identities
        GROUP BY LOWER(TRIM(provider)), subject
      ) k ON LOWER(TRIM(oi.provider)) = k.provider AND oi.subject = k.subject
      WHERE oi.id <> k.keep_id;
    `);
    // 再將 provider 做 TRIM+LOWER
    const [u] = await pool.query('UPDATE oauth_identities SET provider = LOWER(TRIM(provider))');
    // 清除空 provider（極端情況）
    const [z] = await pool.query("DELETE FROM oauth_identities WHERE provider = ''");
    return ok(res, {
      duplicates_removed: Number(d?.affectedRows || 0),
      normalized: Number(u?.affectedRows || 0),
      emptied_removed: Number(z?.affectedRows || 0),
    }, 'CLEANED');
  } catch (err) {
    return fail(res, 'ADMIN_OAUTH_PROVIDER_CLEANUP_FAIL', err.message, 500);
  }
});

// Admin: account tombstones (list/create/delete)
const AdminTombstoneCreateSchema = z.object({
  provider: z.string().min(2).optional(),
  subject: z.string().min(1).optional(),
  email: z.string().email().optional(),
  reason: z.string().min(1).max(64).optional(),
}).refine((v) => Boolean(v.subject || v.email), { message: 'subject 或 email 至少需一個' });

app.get('/admin/tombstones', adminOnly, async (req, res) => {
  try {
    await ensureAccountTombstonesTable();
    const provider = String(req.query?.provider || '').trim().toLowerCase();
    const subject = String(req.query?.subject || '').trim();
    const email = String(req.query?.email || '').trim().toLowerCase();
    const limit = Math.min(Math.max(parseInt(req.query?.limit || '100', 10) || 100, 1), 500);
    const offset = Math.max(parseInt(req.query?.offset || '0', 10) || 0, 0);
    const where = [];
    const args = [];
    if (provider) { where.push('provider = ?'); args.push(provider); }
    if (subject) { where.push('subject LIKE ?'); args.push(`%${subject}%`); }
    if (email) { where.push('LOWER(email) = LOWER(?)'); args.push(email); }
    const sql = `SELECT id, provider, subject, email, reason, created_at FROM account_tombstones ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ? OFFSET ?`;
    args.push(limit, offset);
    const [rows] = await pool.query(sql, args);
    return ok(res, rows);
  } catch (err) {
    return fail(res, 'ADMIN_TOMBSTONES_LIST_FAIL', err.message, 500);
  }
});

app.post('/admin/tombstones', adminOnly, async (req, res) => {
  const parsed = AdminTombstoneCreateSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  const { provider, subject, email, reason } = parsed.data;
  try {
    await ensureAccountTombstonesTable();
    const p = provider ? String(provider).trim().toLowerCase() : null;
    await pool.query('INSERT INTO account_tombstones (provider, subject, email, reason) VALUES (?, ?, ?, ?)', [p, subject || null, email || null, reason || 'manual_block']);
    return ok(res, null, 'TOMBSTONED');
  } catch (err) {
    return fail(res, 'ADMIN_TOMBSTONE_CREATE_FAIL', err.message, 500);
  }
});

app.delete('/admin/tombstones/:id', adminOnly, async (req, res) => {
  try {
    await ensureAccountTombstonesTable();
    const [r] = await pool.query('DELETE FROM account_tombstones WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', '找不到紀錄', 404);
    return ok(res, null, 'DELETED');
  } catch (err) {
    return fail(res, 'ADMIN_TOMBSTONE_DELETE_FAIL', err.message, 500);
  }
});

function mapAdminTicketRow(row = {}) {
  if (!row) return null;
  return {
    id: Number(row.id),
    uuid: row.uuid || '',
    type: row.type || '',
    discount: row.discount == null ? 0 : Number(row.discount),
    used: row.used === 1 || row.used === true,
    expiry: row.expiry || null,
    user_id: row.user_id == null ? null : String(row.user_id),
    username: row.username || '',
    email: row.email || '',
    created_at: row.created_at || null,
  };
}

app.get('/admin/tickets', adminOnly, async (req, res) => {
  try {
    const defaultLimit = 50;
    const limit = parsePositiveInt(req.query.limit, defaultLimit, { min: 1, max: 200 });
    const offsetRaw = req.query.offset ?? 0;
    const offset = Math.max(0, parsePositiveInt(offsetRaw, 0, { min: 0 }));
    const q = String(req.query.q || req.query.query || '').trim();
    const statusRaw = String(req.query.status || 'all').trim().toLowerCase();
    const allowedStatuses = new Set(['all', 'available', 'used', 'expired']);
    const status = allowedStatuses.has(statusRaw) ? statusRaw : 'all';
    const includeSummary = parseBoolean(req.query.includeSummary ?? req.query.summary, true);

    const where = [];
    const params = [];
    if (q) {
      const like = `%${q}%`;
      where.push('(t.uuid LIKE ? OR t.type LIKE ? OR u.email LIKE ? OR u.username LIKE ? OR CAST(t.id AS CHAR) LIKE ?)');
      params.push(like, like, like, like, like);
    }
    if (status === 'available') {
      where.push('t.used = 0 AND (t.expiry IS NULL OR t.expiry >= CURRENT_DATE())');
    } else if (status === 'used') {
      where.push('t.used = 1');
    } else if (status === 'expired') {
      where.push('t.used = 0 AND t.expiry IS NOT NULL AND t.expiry < CURRENT_DATE()');
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) AS total FROM tickets t LEFT JOIN users u ON u.id = t.user_id ${whereSql}`;
    const [[countRow]] = await pool.query(countSql, params);
    const total = Number(countRow?.total || 0);

    const listSql = `
      SELECT t.id, t.uuid, t.type, t.discount, t.used, t.expiry, t.created_at, t.user_id,
             u.username, u.email
      FROM tickets t
      LEFT JOIN users u ON u.id = t.user_id
      ${whereSql}
      ORDER BY t.id DESC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await pool.query(listSql, [...params, limit, offset]);
    const items = rows.map(mapAdminTicketRow).filter(Boolean);

    let summaryPayload = null;
    if (includeSummary) {
      const [[summaryRow]] = await pool.query(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN t.used = 0 AND (t.expiry IS NULL OR t.expiry >= CURRENT_DATE()) THEN 1 ELSE 0 END) AS available,
          SUM(CASE WHEN t.used = 1 THEN 1 ELSE 0 END) AS used,
          SUM(CASE WHEN t.used = 0 AND t.expiry IS NOT NULL AND t.expiry < CURRENT_DATE() THEN 1 ELSE 0 END) AS expired
        FROM tickets t
      `);
      summaryPayload = {
        total: Number(summaryRow?.total || 0),
        available: Number(summaryRow?.available || 0),
        used: Number(summaryRow?.used || 0),
        expired: Number(summaryRow?.expired || 0),
      };
    }

    return ok(res, {
      items,
      meta: {
        total,
        limit,
        offset,
        hasMore: offset + items.length < total,
        status,
        query: q,
      },
      summary: summaryPayload,
    });
  } catch (err) {
    return fail(res, 'ADMIN_TICKETS_LIST_FAIL', err.message, 500);
  }
});

app.get('/admin/tickets/:id/logs', adminOnly, async (req, res) => {
  const ticketId = normalizePositiveInt(req.params.id);
  if (!ticketId) return fail(res, 'VALIDATION_ERROR', '無效的票券編號', 400);
  try {
    await ensureTicketLogsTable();
    const limit = parsePositiveInt(req.query.limit, 200, { min: 1, max: 500 });
    const [rows] = await pool.query(
      `
        SELECT l.id, l.ticket_id, l.user_id, l.action, l.meta, l.created_at,
               u.username, u.email
        FROM ticket_logs l
        LEFT JOIN users u ON u.id = l.user_id
        WHERE l.ticket_id = ?
        ORDER BY l.id DESC
        LIMIT ?
      `,
      [ticketId, limit]
    );
    const items = rows.map((row) => ({
      id: Number(row.id),
      ticket_id: Number(row.ticket_id),
      user_id: row.user_id == null ? null : String(row.user_id),
      action: row.action || '',
      meta: safeParseJSON(row.meta, {}),
      created_at: row.created_at || null,
      username: row.username || '',
      email: row.email || '',
    }));
    return ok(res, { items });
  } catch (err) {
    return fail(res, 'ADMIN_TICKET_LOGS_FAIL', err.message, 500);
  }
});

app.patch('/admin/tickets/:id', adminOnly, async (req, res) => {
  const ticketId = normalizePositiveInt(req.params.id);
  if (!ticketId) return fail(res, 'VALIDATION_ERROR', '無效的票券編號', 400);
  const body = req.body || {};
  const fields = [];
  const params = [];
  const changeMeta = {};
  let assignedUser = null;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `
        SELECT t.id, t.uuid, t.type, t.discount, t.used, t.expiry, t.user_id, t.created_at,
               u.username, u.email
        FROM tickets t
        LEFT JOIN users u ON u.id = t.user_id
        WHERE t.id = ?
        FOR UPDATE
      `,
      [ticketId]
    );
    if (!rows.length) {
      await conn.rollback();
      return fail(res, 'TICKET_NOT_FOUND', '找不到票券', 404);
    }
    const current = rows[0];
    const currentUserId = current.user_id == null ? null : String(current.user_id);
    let targetUserId = currentUserId;
    assignedUser = { id: currentUserId, username: current.username || '', email: current.email || '' };

    if (Object.prototype.hasOwnProperty.call(body, 'type')) {
      const rawType = typeof body.type === 'string' ? body.type.trim() : '';
      const targetType = rawType || null;
      const currentType = current.type ? String(current.type) : null;
      if ((targetType || null) !== (currentType || null)) {
        if (targetType) {
          fields.push('type = ?');
          params.push(targetType);
        } else {
          fields.push('type = NULL');
        }
        changeMeta.type = { before: currentType, after: targetType };
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'expiry')) {
      let expiryValue;
      if (body.expiry === null || body.expiry === '') {
        expiryValue = null;
      } else if (body.expiry instanceof Date) {
        expiryValue = formatDateYYYYMMDD(body.expiry);
      } else if (typeof body.expiry === 'string') {
        const trimmed = body.expiry.trim();
        if (!trimmed) {
          expiryValue = null;
        } else if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
          await conn.rollback();
          return fail(res, 'VALIDATION_ERROR', '到期日格式需為 YYYY-MM-DD', 400);
        } else {
          expiryValue = trimmed;
        }
      } else {
        await conn.rollback();
        return fail(res, 'VALIDATION_ERROR', '到期日格式不正確', 400);
      }
      const currentExpiry =
        current.expiry instanceof Date
          ? formatDateYYYYMMDD(current.expiry)
          : current.expiry
          ? String(current.expiry)
          : null;
      if ((expiryValue || null) !== (currentExpiry || null)) {
        if (expiryValue === null) {
          fields.push('expiry = NULL');
        } else {
          fields.push('expiry = ?');
          params.push(expiryValue);
        }
        changeMeta.expiry = { before: currentExpiry, after: expiryValue };
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'used')) {
      const rawUsed = body.used;
      let usedValue;
      if (typeof rawUsed === 'boolean') usedValue = rawUsed ? 1 : 0;
      else if (rawUsed === 1 || rawUsed === '1' || (typeof rawUsed === 'string' && rawUsed.trim().toLowerCase() === 'true')) usedValue = 1;
      else if (rawUsed === 0 || rawUsed === '0' || (typeof rawUsed === 'string' && rawUsed.trim().toLowerCase() === 'false')) usedValue = 0;
      else {
        await conn.rollback();
        return fail(res, 'VALIDATION_ERROR', '使用狀態格式不正確', 400);
      }
      const currentUsed = current.used === 1 || current.used === true ? 1 : 0;
      if (usedValue !== currentUsed) {
        fields.push('used = ?');
        params.push(usedValue);
        changeMeta.used = { before: currentUsed, after: usedValue };
      }
    }

    let reassignedUserInfo = null;
    if (Object.prototype.hasOwnProperty.call(body, 'userId') && body.userId) {
      const [uRows] = await conn.query('SELECT id, username, email FROM users WHERE id = ? LIMIT 1', [body.userId]);
      if (!uRows.length) {
        await conn.rollback();
        return fail(res, 'USER_NOT_FOUND', '找不到指定的使用者', 404);
      }
      targetUserId = String(uRows[0].id);
      reassignedUserInfo = { id: targetUserId, username: uRows[0].username || '', email: uRows[0].email || '' };
    } else if (Object.prototype.hasOwnProperty.call(body, 'userEmail')) {
      const emailRaw = String(body.userEmail || '').trim().toLowerCase();
      if (emailRaw) {
        const [uRows] = await conn.query('SELECT id, username, email FROM users WHERE LOWER(email) = ? LIMIT 1', [emailRaw]);
        if (!uRows.length) {
          await conn.rollback();
          return fail(res, 'USER_NOT_FOUND', '找不到指定的使用者 Email', 404);
        }
        targetUserId = String(uRows[0].id);
        reassignedUserInfo = { id: targetUserId, username: uRows[0].username || '', email: uRows[0].email || '' };
      }
    }

    if (reassignedUserInfo && reassignedUserInfo.id === currentUserId) {
      reassignedUserInfo = null;
      targetUserId = currentUserId;
    }
    if (reassignedUserInfo) {
      fields.push('user_id = ?');
      params.push(reassignedUserInfo.id);
      changeMeta.user = { before: currentUserId, after: reassignedUserInfo.id };
      assignedUser = reassignedUserInfo;
    }

    if (!fields.length) {
      await conn.rollback();
      return fail(res, 'NO_CHANGES', '沒有任何變更', 400);
    }

    await conn.query(`UPDATE tickets SET ${fields.join(', ')} WHERE id = ?`, [...params, ticketId]);
    const [updatedRows] = await conn.query(
      `
        SELECT t.id, t.uuid, t.type, t.discount, t.used, t.expiry, t.created_at, t.user_id,
               u.username, u.email
        FROM tickets t
        LEFT JOIN users u ON u.id = t.user_id
        WHERE t.id = ?
        LIMIT 1
      `,
      [ticketId]
    );
    const updatedTicket = mapAdminTicketRow(updatedRows[0]);

    const adminMeta = { admin_id: req.user.id, admin_email: req.user.email || null };
    try {
      if (changeMeta.user) {
        await logTicket({
          conn,
          ticketId,
          userId: changeMeta.user.before,
          action: 'admin_reassign_out',
          meta: { ...adminMeta, to_user_id: changeMeta.user.after },
        });
        await logTicket({
          conn,
          ticketId,
          userId: changeMeta.user.after,
          action: 'admin_reassign_in',
          meta: { ...adminMeta, from_user_id: changeMeta.user.before },
        });
      }
      if (Object.keys(changeMeta).length) {
        await logTicket({
          conn,
          ticketId,
          userId: assignedUser?.id || changeMeta.user?.after || changeMeta.user?.before || req.user.id,
          action: 'admin_updated',
          meta: { ...adminMeta, changes: changeMeta },
        });
      }
    } catch (_) {
      // ignore logging failure
    }

    await conn.commit();
    return ok(res, { ticket: updatedTicket }, 'TICKET_UPDATED');
  } catch (err) {
    await conn.rollback();
    return fail(res, 'ADMIN_TICKET_UPDATE_FAIL', err.message, 500);
  } finally {
    conn.release();
  }
});

// Admin Tickets: list distinct types with cover status
app.get('/admin/tickets/types', adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT DISTINCT t.type AS type FROM tickets t WHERE t.type IS NOT NULL AND t.type <> "" ORDER BY t.type ASC'
    );
    const types = rows.map(r => r.type);
    if (!types.length) return ok(res, []);
    const placeholders = types.map(() => '?').join(',');
    const coverSelect = ticketCoversHaveStoragePath
      ? `SELECT type, cover_url, cover_type, storage_path, (cover_data IS NOT NULL) AS has_blob FROM ticket_covers WHERE type IN (${placeholders})`
      : `SELECT type, cover_url, cover_type, NULL AS storage_path, (cover_data IS NOT NULL) AS has_blob FROM ticket_covers WHERE type IN (${placeholders})`;
    const [covers] = await pool.query(coverSelect, types);
    const coverMap = new Map();
    for (const c of covers) {
      coverMap.set(c.type, {
        cover_url: c.cover_url,
        cover_type: c.cover_type,
        has_blob: !!c.has_blob,
        storage_path: c.storage_path ? storage.normalizeRelativePath(c.storage_path) : null
      });
    }
    const result = types.map(t => ({ type: t, cover: coverMap.get(t) || null }));
    return ok(res, result);
  } catch (err) {
    return fail(res, 'ADMIN_TICKET_TYPES_FAIL', err.message, 500);
  }
});

// Admin Tickets: upload cover for a type (dataUrl or mime+base64)
app.post('/admin/tickets/types/:type/cover_json', adminOnly, async (req, res) => {
  try {
    const type = req.params.type;
    if (!type) return fail(res, 'VALIDATION_ERROR', '缺少票券類型', 400);
    const { dataUrl, mime, base64 } = req.body || {};
    let contentType = null; let buffer = null;
    if (dataUrl && typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
      const m = /^data:([\w\-/.+]+);base64,(.*)$/.exec(dataUrl);
      if (!m) return fail(res, 'VALIDATION_ERROR', 'dataUrl 格式錯誤', 400);
      contentType = m[1]; buffer = Buffer.from(m[2], 'base64');
    } else if (mime && base64) {
      contentType = String(mime); buffer = Buffer.from(String(base64), 'base64');
    } else return fail(res, 'VALIDATION_ERROR', '缺少上傳內容', 400);
    if (!buffer?.length) return fail(res, 'VALIDATION_ERROR', '檔案為空', 400);
    if (buffer.length > 10 * 1024 * 1024) return fail(res, 'PAYLOAD_TOO_LARGE', '檔案過大（>10MB）', 413);
    contentType = contentType || 'application/octet-stream';
    let previousPath = null;
    if (ticketCoversHaveStoragePath) {
      try {
        const [[row]] = await pool.query('SELECT storage_path FROM ticket_covers WHERE type = ? LIMIT 1', [type]);
        if (row && row.storage_path) previousPath = storage.normalizeRelativePath(row.storage_path);
      } catch (err) {
        console.warn('fetchTicketCoverPath error:', err?.message || err);
      }
    }

    let storagePathRelative = null;
    if (ticketCoversHaveStoragePath) {
      const extension = storage.mimeToExtension(contentType);
      let attempts = 0;
      while (attempts < 5) {
        attempts += 1;
        const candidate = buildTicketCoverStoragePath(type, extension);
        try {
          await storage.writeBuffer(candidate, buffer, { mode: 0o600 });
          storagePathRelative = storage.normalizeRelativePath(candidate);
          break;
        } catch (err) {
          if (err?.code === 'EEXIST' && attempts < 5) {
            continue;
          }
          console.error('writeTicketCover error:', err?.message || err);
          return fail(res, 'ADMIN_TICKET_COVER_UPLOAD_FAIL', '封面儲存失敗，請稍後再試', 500);
        }
      }
    }

    const sql = ticketCoversHaveStoragePath
      ? 'INSERT INTO ticket_covers (type, cover_url, cover_type, storage_path, cover_data) VALUES (?, NULL, ?, ?, NULL) ON DUPLICATE KEY UPDATE cover_url = VALUES(cover_url), cover_type = VALUES(cover_type), storage_path = VALUES(storage_path), cover_data = NULL'
      : 'INSERT INTO ticket_covers (type, cover_url, cover_type, cover_data) VALUES (?, NULL, ?, ?) ON DUPLICATE KEY UPDATE cover_url = VALUES(cover_url), cover_type = VALUES(cover_type), cover_data = VALUES(cover_data)';
    const params = ticketCoversHaveStoragePath
      ? [type, contentType, storagePathRelative]
      : [type, contentType, buffer];
    try {
      await pool.query(sql, params);
    } catch (err) {
      if (storagePathRelative) await storage.deleteFile(storagePathRelative).catch(() => {});
      throw err;
    }

    if (previousPath && previousPath !== storagePathRelative) {
      await storage.deleteFile(previousPath).catch(() => {});
    }

    return ok(res, {
      type,
      size: buffer.length,
      typeMime: contentType,
      path: ticketCoversHaveStoragePath ? storagePathRelative : null
    }, '票券封面已更新');
  } catch (err) {
    return fail(res, 'ADMIN_TICKET_COVER_UPLOAD_FAIL', err.message, 500);
  }
});

// Admin Tickets: delete cover for a type
app.delete('/admin/tickets/types/:type/cover', adminOnly, async (req, res) => {
  try {
    const type = req.params.type;
    let storagePath = null;
    if (ticketCoversHaveStoragePath) {
      try {
        const [[row]] = await pool.query('SELECT storage_path FROM ticket_covers WHERE type = ? LIMIT 1', [type]);
        if (row && row.storage_path) storagePath = storage.normalizeRelativePath(row.storage_path);
      } catch (err) {
        console.warn('fetchTicketCoverForDelete error:', err?.message || err);
      }
    }
    const [r] = await pool.query('DELETE FROM ticket_covers WHERE type = ?', [type]);
    if (!r.affectedRows) return ok(res, null, '已刪除或不存在');
    if (storagePath) await storage.deleteFile(storagePath).catch(() => {});
    return ok(res, null, '封面已刪除');
  } catch (err) {
    return fail(res, 'ADMIN_TICKET_COVER_DELETE_FAIL', err.message, 500);
  }
});

// Public: serve ticket cover by type
app.get('/tickets/cover/:type', async (req, res) => {
  try {
    const type = req.params.type;
    const selectSql = ticketCoversHaveStoragePath
      ? 'SELECT cover_url, cover_type, cover_data, storage_path FROM ticket_covers WHERE type = ? LIMIT 1'
      : 'SELECT cover_url, cover_type, cover_data, NULL AS storage_path FROM ticket_covers WHERE type = ? LIMIT 1';
    const [rows] = await pool.query(selectSql, [type]);
    if (!rows.length) return res.status(404).end();
    const row = rows[0];
    if (ticketCoversHaveStoragePath && row.storage_path) {
      const relPath = storage.normalizeRelativePath(row.storage_path);
      if (await storage.fileExists(relPath)) {
        const stat = await storage.getFileStat(relPath);
        res.setHeader('Content-Type', row.cover_type || 'application/octet-stream');
        if (stat?.size) res.setHeader('Content-Length', stat.size);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        const stream = storage.createReadStream(relPath);
        stream.on('error', (err) => {
          console.error('serveTicketCover stream error:', err?.message || err);
          if (!res.headersSent) res.status(500).end();
          else res.destroy();
        });
        stream.pipe(res);
        return;
      }
    }
    if (row.cover_data && row.cover_type) {
      res.setHeader('Content-Type', row.cover_type);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.end(row.cover_data);
    }
    if (row.cover_url) return res.redirect(302, row.cover_url);
    return res.status(404).end();
  } catch (err) {
    return res.status(500).end();
  }
});

// Public QR code generator for LINE bot and others
app.get('/qr', async (req, res) => {
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
app.get('/reservations/me', authRequired, async (req, res) => {
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

app.post('/reservations', authRequired, async (req, res) => {
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

app.post('/reservations/:id/checklists/:stage/photos', authRequired, async (req, res) => {
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

  let storagePathRelative = null;
  let checksum = null;
  if (checklistPhotosHaveStoragePath) {
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
    const insertSql = checklistPhotosHaveStoragePath
      ? 'INSERT INTO reservation_checklist_photos (reservation_id, stage, mime, original_name, size, storage_path, checksum, data) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)'
      : 'INSERT INTO reservation_checklist_photos (reservation_id, stage, mime, original_name, size, data) VALUES (?, ?, ?, ?, ?, ?)';
    const insertParams = checklistPhotosHaveStoragePath
      ? [reservationId, stage, parsed.mime, originalName, parsed.buffer.length, storagePathRelative, checksum]
      : [reservationId, stage, parsed.mime, originalName, parsed.buffer.length, parsed.buffer];
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

app.delete('/reservations/:id/checklists/:stage/photos/:photoId', authRequired, async (req, res) => {
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
  if (checklistPhotosHaveStoragePath) {
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

app.get('/reservations/:id/checklists/:stage/photos/:photoId/raw', authRequired, async (req, res) => {
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

    if (checklistPhotosHaveStoragePath && row.storage_path) {
      const relPath = storage.normalizeRelativePath(row.storage_path);
      if (await storage.fileExists(relPath)) {
        const stat = await storage.getFileStat(relPath);
        if (stat?.size) res.setHeader('Content-Length', stat.size);
        const stream = storage.createReadStream(relPath);
        stream.on('error', (err) => {
          console.error('streamChecklistPhoto error:', err?.message || err);
          if (!res.headersSent) {
            res.status(500).end();
          } else {
            res.destroy();
          }
        });
        stream.pipe(res);
        return;
      }
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

app.patch('/reservations/:id/checklists/:stage', authRequired, async (req, res) => {
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
app.get('/admin/reservations', reservationManagerOnly, async (req, res) => {
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
app.get('/admin/reservations/:id/checklists', reservationManagerOnly, async (req, res) => {
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
app.patch('/admin/reservations/:id/status', reservationManagerOnly, async (req, res) => {
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
app.post('/admin/reservations/progress_scan', scanAccessOnly, async (req, res) => {
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

app.get('/orders/me', authRequired, async (req, res) => {
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

app.post('/orders', authRequired, async (req, res) => {
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
            const ids = ticketsUsed.map(n => Number(n)).filter(n => Number.isFinite(n));
            if (ids.length) {
              const placeholders = ids.map(() => '?').join(',');
              await conn.query(
                `UPDATE tickets SET used = 1
                 WHERE user_id = ?
                   AND used = 0
                   AND (expiry IS NULL OR expiry >= CURRENT_DATE())
                   AND id IN (${placeholders})`,
                [req.user.id, ...ids]
              );
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
    return fail(res, 'ORDER_CREATE_FAIL', err.message, 500);
  } finally {
    conn.release();
  }
});

// Admin Remittance Settings
app.get('/admin/remittance', adminOnly, async (req, res) => {
  try {
    const data = await loadRemittanceConfig();
    return ok(res, data);
  } catch (err) {
    return fail(res, 'ADMIN_REMITTANCE_GET_FAIL', err.message || '讀取匯款資訊失敗', 500);
  }
});

app.patch('/admin/remittance', adminOnly, async (req, res) => {
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

app.get('/admin/site_pages', adminOnly, async (req, res) => {
  try {
    const data = await getSitePages();
    return ok(res, data);
  } catch (err) {
    return fail(res, 'ADMIN_SITE_PAGES_GET_FAIL', err.message || '讀取頁面內容失敗', 500);
  }
});

app.patch('/admin/site_pages', adminOnly, async (req, res) => {
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

app.get('/admin/reservation_checklists', adminOnly, (req, res) => {
  try {
    const data = getReservationChecklistDefinitions();
    return ok(res, data);
  } catch (err) {
    return fail(res, 'ADMIN_RESERVATION_CHECKLISTS_GET_FAIL', err?.message || '讀取檢核項目失敗', 500);
  }
});

app.patch('/admin/reservation_checklists', adminOnly, async (req, res) => {
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

app.get('/app/reservation_checklists', (req, res) => {
  try {
    const data = getReservationChecklistDefinitions();
    return ok(res, data);
  } catch (err) {
    return fail(res, 'RESERVATION_CHECKLISTS_GET_FAIL', err?.message || '讀取檢核項目失敗', 500);
  }
});

app.get('/pages/:slug', async (req, res) => {
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
app.get('/admin/orders', adminOnly, async (req, res) => {
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

app.patch('/admin/orders/:id/status', adminOnly, async (req, res) => {
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
        const ids = ticketsUsed.map(n => Number(n)).filter(n => Number.isFinite(n));
        if (ids.length) {
          const placeholders = ids.map(() => '?').join(',');
          await conn.query(
            `UPDATE tickets SET used = 1
             WHERE user_id = ?
               AND used = 0
               AND (expiry IS NULL OR expiry >= CURRENT_DATE())
               AND id IN (${placeholders})`,
            [order.user_id, ...ids]
          );
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
    return fail(res, 'ADMIN_ORDER_STATUS_FAIL', err.message, 500);
  } finally {
    conn.release();
  }
});

/** ======== 錯誤處理 ======== */
app.use((err, req, res, next) => {
  console.error('UnhandledError:', err);
  return fail(res, 'UNHANDLED', '系統發生未預期錯誤', 500);
});

/** ======== 啟動 ======== */
const port = process.env.PORT || 3020;
const server = app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});

function shutdown() {
  console.log('🛑 Shutting down...');
  server.close(() => {
    pool.end().then(() => {
      console.log('✅ DB pool closed. Bye.');
      process.exit(0);
    });
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
