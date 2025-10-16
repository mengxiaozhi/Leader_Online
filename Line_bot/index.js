// Lightweight LINE Messaging API bot server (no external web framework)
// - Verifies LINE signature
// - Handles follow/message events
// - Links to site via existing /auth/line/start?mode=link flow
// - Reads MySQL to fetch user data when linked (via oauth_identities)

require('dotenv').config();
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');

// ==== Environment ====
const PORT = parseInt(process.env.LINE_BOT_PORT || process.env.PORT || '3021', 10);
const CHANNEL_SECRET = process.env.LINE_BOT_CHANNEL_SECRET || process.env.LINE_CHANNEL_SECRET || process.env.LINE_CLIENT_SECRET || '';
const CHANNEL_ACCESS_TOKEN = process.env.LINE_BOT_CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const MAGIC_LINK_SECRET = process.env.MAGIC_LINK_SECRET || process.env.LINK_SIGNING_SECRET || '';

const PUBLIC_API_BASE = (process.env.PUBLIC_API_BASE || '').replace(/\/$/, '');
const PUBLIC_WEB_URL = (process.env.PUBLIC_WEB_URL || 'http://localhost:5173').replace(/\/$/, '');
const QR_API_OVERRIDE = (process.env.LINE_BOT_QR_BASE || process.env.LINE_BOT_QR_API || process.env.LINE_BOT_PUBLIC_BASE || process.env.LINE_BOT_PUBLIC_URL || process.env.LINE_BOT_BASE_URL || '').replace(/\/$/, '');
const QR_API_FALLBACK = (process.env.LINE_BOT_QR_FALLBACK || `http://localhost:3020`).replace(/\/$/, '');
const QR_API_BASE = QR_API_OVERRIDE || PUBLIC_API_BASE;
// Theme colors (align with Web/src/style.css)
const THEME_PRIMARY = (process.env.THEME_PRIMARY || process.env.WEB_THEME_PRIMARY || '#D90000');
const THEME_SECONDARY = (process.env.THEME_SECONDARY || process.env.WEB_THEME_SECONDARY || '#B00000');
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || process.env.EMAIL_USER_NAME || 'Leader Online';
const EMAIL_USER = process.env.EMAIL_USER || '';
const EMAIL_PASS = process.env.EMAIL_PASS || '';
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
const EMAIL_FROM_ADDRESS = process.env.EMAIL_FROM_USER || process.env.EMAIL_FROM_ADDRESS || EMAIL_USER;

if (!CHANNEL_SECRET || !CHANNEL_ACCESS_TOKEN) {
  console.warn('Line Bot 沒有配置完成，請設定 LINE_BOT_CHANNEL_SECRET 以及 LINE_BOT_CHANNEL_ACCESS_TOKEN');
}

let mailerReady = false;
const transporter = nodemailer.createTransport(EMAIL_USER && EMAIL_PASS ? {
  service: 'gmail',
  auth: { user: EMAIL_USER, pass: EMAIL_PASS },
} : {});

if (EMAIL_USER && EMAIL_PASS) {
  transporter.verify((err) => {
    if (err) {
      console.error('LINE bot mailer verify failed:', err?.message || err);
      mailerReady = false;
    } else {
      mailerReady = true;
    }
  });
} else {
  console.warn('Line Bot Email部分沒有配置完成');
}

// ==== DB pool (shared with main Server via env) ====
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

loadRemittanceConfig().catch((err) => {
  console.error('LINE bot remittance load error:', err?.message || err);
});
setInterval(() => {
  loadRemittanceConfig().catch(() => {});
}, 5 * 60 * 1000);

// Track multi-step interactions (simple in-memory state per LINE user)
const pendingActions = new Map();
function setPendingAction(lineSubject, action) {
  if (!lineSubject) return;
  if (action) pendingActions.set(lineSubject, action);
  else pendingActions.delete(lineSubject);
}
function getPendingAction(lineSubject) {
  if (!lineSubject) return null;
  return pendingActions.get(lineSubject) || null;
}

// ==== Helpers ====
function hmacBase64(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('base64');
}

function verifySignature(signature, rawBody) {
  if (!CHANNEL_SECRET) return false;
  if (!signature) return false;
  const expected = hmacBase64(CHANNEL_SECRET, rawBody);
  // timing safe compare
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function httpsPostJson(url, bodyObj, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(bodyObj || {});
    const u = new URL(url);
    const opts = {
      method: 'POST',
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + (u.search || ''),
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers,
      },
    };
    const req = https.request(opts, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (buf += c));
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
  });
}

async function reply(replyToken, messages) {
  if (!CHANNEL_ACCESS_TOKEN) return;
  const body = { replyToken, messages: Array.isArray(messages) ? messages : [messages] };
  await httpsPostJson('https://api.line.me/v2/bot/message/reply', body, {
    Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
  });
}

async function pushToUserId(userId, messages) {
  if (!CHANNEL_ACCESS_TOKEN) return;
  const body = { to: userId, messages: Array.isArray(messages) ? messages : [messages] };
  await httpsPostJson('https://api.line.me/v2/bot/message/push', body, {
    Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
  });
}

function linkUrl() {
  const api = PUBLIC_API_BASE || '';
  const base = api || `${PUBLIC_WEB_URL}`; // fallback to web if api not set
  const authBase = api || `${base}`;
  // Use server OAuth link mode (bind to signed-in account)
  return `${authBase}/auth/line/start?mode=link&redirect=/account`;
}

function hmacSha256Hex(secret, text){ return crypto.createHmac('sha256', secret).update(String(text)).digest('hex') }
function magicLink(path, lineSubject){
  try{
    const api = PUBLIC_API_BASE || '';
    if (!api || !MAGIC_LINK_SECRET || !lineSubject) return `${PUBLIC_WEB_URL}${path}`;
    const ts = Date.now();
    const p = path && String(path).startsWith('/') ? String(path) : '/store';
    const payload = `line:${lineSubject}:${p}:${ts}`;
    const sig = hmacSha256Hex(MAGIC_LINK_SECRET, payload);
    const q = new URLSearchParams({ provider: 'line', subject: lineSubject, redirect: p, ts: String(ts), sig }).toString();
    return `${api}/auth/magic_link?${q}`;
  } catch { return `${PUBLIC_WEB_URL}${path}` }
}

function helpText(linked) {
  const lines = [
    linked ? '您已綁定網站帳號，可以查詢以下資訊：' : '請先點擊下方按鈕綁定網站帳號',
    linked ? '· 我的訂單 · 我的票券 · 代領取 · 我的預約' : '綁定後可查詢訂單、票券與預約狀態',
  ];
  return lines.join('\n');
}

async function findLinkedUserIdByLineSubject(subject) {
  const [rows] = await pool.query(
    'SELECT user_id FROM oauth_identities WHERE provider = ? AND subject = ? LIMIT 1',
    ['line', subject]
  );
  return rows.length ? rows[0].user_id : null;
}

async function queryUserProfile(userId) {
  const [rows] = await pool.query('SELECT id, username, email, role, created_at FROM users WHERE id = ? LIMIT 1', [userId]);
  return rows.length ? rows[0] : null;
}

async function queryUserProviders(userId) {
  try{
    const [rows] = await pool.query('SELECT provider FROM oauth_identities WHERE user_id = ? ORDER BY provider ASC', [userId]);
    return rows.map(r => String(r.provider || '').toLowerCase());
  } catch { return [] }
}

async function queryOrders(userId, limit = 3) {
  const [rows] = await pool.query('SELECT id, code, details, created_at FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT ?', [userId, Number(limit)]);
  return rows;
}

async function queryProducts(limit = 6, offset = 0) {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, description, price FROM products ORDER BY id DESC LIMIT ? OFFSET ?',
      [Number(limit), Number(offset)]
    );
    return rows;
  } catch {
    return [];
  }
}

async function queryTickets(userId, limit = 3) {
  const [rows] = await pool.query('SELECT id, uuid, type, used, expiry FROM tickets WHERE user_id = ? ORDER BY id DESC LIMIT ?', [userId, Number(limit)]);
  return rows;
}

async function queryReservations(userId, limit = 3) {
  const [rows] = await pool.query(
    `SELECT r.id, r.event, r.store, r.status, r.reserved_at,
            (SELECT e.cover FROM events e WHERE e.title = r.event ORDER BY e.id DESC LIMIT 1) AS cover
       FROM reservations r
      WHERE r.user_id = ?
      ORDER BY r.id DESC
      LIMIT ?`,
    [userId, Number(limit)]
  );
  return rows;
}

// Events list for sessions (align with Web store: show all, newest first)
async function queryBookableEvents(limit = 12, offset = 0) {
  try {
    const effectiveLimit = Math.max(1, Number(limit) || 12);
    const effectiveOffset = Math.max(0, Number(offset) || 0);
    const [rows] = await pool.query(
      `SELECT id, code, title, starts_at, ends_at, deadline, description, cover, rules
         FROM events
        WHERE COALESCE(deadline, ends_at) IS NULL OR COALESCE(deadline, ends_at) >= NOW()
        ORDER BY starts_at ASC
        LIMIT ? OFFSET ?`,
      [effectiveLimit + 1, effectiveOffset]
    );
    const page = rows.slice(0, effectiveLimit);
    page.hasMore = rows.length > effectiveLimit;
    page.nextOffset = effectiveOffset + page.length;
    return page;
  } catch {
    const fallbackOffset = Math.max(0, Number(offset) || 0);
    return Object.assign([], { hasMore: false, nextOffset: fallbackOffset });
  }
}


function safeParseJSON(v){ try { return typeof v === 'string' ? JSON.parse(v) : (v || {}) } catch { return {} } }

function getRemittanceConfig() {
  return { ...remittanceConfig };
}

async function loadRemittanceConfig() {
  try {
    const keys = Object.values(REMITTANCE_SETTING_KEYS);
    if (!keys.length) return getRemittanceConfig();
    const [rows] = await pool.query('SELECT `key`, `value` FROM app_settings WHERE `key` IN (?)', [keys]);
    const map = new Map(rows.map((row) => [row.key, row.value == null ? '' : String(row.value)]));
    const next = { ...REMITTANCE_ENV_DEFAULTS };
    for (const [field, settingKey] of Object.entries(REMITTANCE_SETTING_KEYS)) {
      const value = (map.get(settingKey) || '').trim();
      if (value) next[field] = value;
    }
    remittanceConfig = next;
  } catch (err) {
    if (err?.code !== 'ER_NO_SUCH_TABLE' && err?.code !== 'ER_ACCESS_DENIED_ERROR') {
      throw err;
    }
  }
  return getRemittanceConfig();
}

function defaultRemittanceDetails(){
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

function formatOrders(rows) {
  if (!rows.length) return [];
  return rows.map((r) => {
    const d = ensureRemittance(safeParseJSON(r.details));
    return ({
      code: r.code || String(r.id),
      created: r.created_at ? new Date(r.created_at).toLocaleString('zh-TW') : '',
      status: d.status || '處理中',
      total: Number(d.total || 0),
      ticketType: d.ticketType || (d?.event?.name || ''),
      eventId: (d?.event?.id ? Number(d.event.id) : null) || null,
      quantity: Number(d.quantity || 0),
      remittance: d.remittance || defaultRemittanceDetails(),
    })
  });
}

function formatProducts(rows) {
  if (!rows.length) return [];
  return rows.map((r) => ({
    id: r.id,
    name: r.name || '-',
    description: r.description || '',
    price: Number(r.price || 0),
  }));
}

function formatTickets(rows) {
  if (!rows.length) return [];
  return rows.map((r) => ({
    id: r.uuid || String(r.id),
    ticketId: Number(r.id) || null,
    uuid: r.uuid || null,
    type: r.type || '-',
    status: r.used ? '已使用' : '未使用',
    expiry: r.expiry ? new Date(r.expiry).toLocaleDateString('zh-TW') : '',
  }));
}

function formatReservations(rows) {
  if (!rows.length) return [];
  return rows.map((r) => ({
    event: r.event || '-',
    store: r.store || '-',
    status: r.status || '-',
    time: r.reserved_at ? new Date(r.reserved_at).toLocaleString('zh-TW') : '-',
    cover: r.cover || null,
  }));
}

function formatEvents(rows) {
  if (!rows.length) return [];
  return rows.map((e) => {
    const id = e.id;
    const code = (e.code && String(e.code).trim()) || (id ? `EV${String(id).padStart(6, '0')}` : '');
    const starts = e.starts_at ? new Date(e.starts_at).toLocaleDateString('zh-TW') : '';
    const ends = e.ends_at ? new Date(e.ends_at).toLocaleDateString('zh-TW') : '';
    const date = starts && ends ? `${starts} ~ ${ends}` : (starts || ends || '');
    const rules = (() => {
      const raw = e.rules;
      if (Array.isArray(raw)) return raw;
      try { const p = typeof raw === 'string' ? JSON.parse(raw) : []; return Array.isArray(p) ? p : []; } catch { return [] }
    })();
    return ({ id, code, title: e.title || '-', date, cover: e.cover || '', deadline: e.deadline || '', rules });
  });
}

// ===== Flex message builders =====
function quickReply(items = []) {
  return items && items.length ? { quickReply: { items } } : {};
}

function qrItemMessage(label, text) {
  return { type: 'action', action: { type: 'message', label, text } };
}
function qrItemUri(label, uri) {
  return { type: 'action', action: { type: 'uri', label, uri } };
}
function qrItemPostback(label, data, displayText = '') {
  return { type: 'action', action: { type: 'postback', label, data, displayText: displayText || label } };
}

function bubbleBase({ title, bodyContents = [], footerButtons = [], heroUrl = null }) {
  const header = title
    ? { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: title, weight: 'bold', size: 'md', color: '#ffffff' }] }
    : undefined;
  const body = { type: 'box', layout: 'vertical', spacing: 'md', contents: bodyContents };
  const footer = footerButtons.length
    ? { type: 'box', layout: 'vertical', spacing: 'sm', contents: footerButtons }
    : undefined;
  const bubble = { type: 'bubble', body, styles: { header: { backgroundColor: THEME_PRIMARY }, footer: { } } };
  if (heroUrl) {
    bubble.hero = { type: 'image', url: heroUrl, size: 'full', aspectRatio: '20:13', aspectMode: 'cover' };
  }
  if (header) bubble.header = header;
  if (footer) bubble.footer = footer;
  return bubble;
}

function textComponent(text, opts = {}) {
  return { type: 'text', text: String(text), wrap: true, size: opts.size || 'sm', color: opts.color || '#222222' };
}

function buttonUri(label, uri, color = THEME_PRIMARY, style = 'primary') {
  return { type: 'button', style, color, action: { type: 'uri', label, uri } };
}

function buttonMessage(label, text) {
  return { type: 'button', style: 'link', color: THEME_PRIMARY, action: { type: 'message', label, text } };
}

function buttonPostback(label, data, displayText = '') {
  return { type: 'button', style: 'secondary', color: '#666666', action: { type: 'postback', label, data, displayText: displayText || label } };
}

function flex(altText, contents) { return { type: 'flex', altText, contents } }
function flexCarousel(altText, bubbles) { return flex(altText, { type: 'carousel', contents: bubbles }) }

// Images and URLs
const DEFAULT_ICON = `${PUBLIC_WEB_URL}/icon.png`;
const API_BASE = PUBLIC_API_BASE || '';
const IMAGE_BASE = API_BASE || PUBLIC_WEB_URL || '';
function ticketCoverUrl(type){
  if (!type) return DEFAULT_ICON;
  if (!IMAGE_BASE) return DEFAULT_ICON;
  const base = IMAGE_BASE.endsWith('/') ? IMAGE_BASE.slice(0, -1) : IMAGE_BASE;
  return `${base}/tickets/cover/${encodeURIComponent(type)}`;
}
function normalizeCoverUrl(cover){
  if (!cover) return DEFAULT_ICON;
  try { return new URL(cover).toString(); }
  catch {
    if (!IMAGE_BASE) return DEFAULT_ICON;
    try {
      const scopedBase = IMAGE_BASE.endsWith('/') ? IMAGE_BASE : `${IMAGE_BASE}/`;
      return new URL(cover, scopedBase).toString();
    } catch {
      return DEFAULT_ICON;
    }
  }
}

function qrImageUrl(text){
  const v = String(text || '').trim();
  if (!v) return DEFAULT_ICON;
  const base = QR_API_BASE || QR_API_FALLBACK;
  if (!base) return DEFAULT_ICON;
  try {
    const normalizedBase = base.endsWith('/') ? base : `${base}/`;
    const url = new URL('qr', normalizedBase);
    url.searchParams.set('data', v);
    return url.toString();
  } catch (_) {
    return DEFAULT_ICON;
  }
}

// 商品封面共用 ticketCoverUrl

function buildHelpFlex(linked) {
  const title = 'Leader Online 幫助';
  const body = [ textComponent(helpText(linked)) ];
  const footer = linked
    ? [
        buttonMessage('商店', '商店'),
        buttonMessage('場次', '場次'),
        buttonMessage('我的訂單', '我的訂單'),
        buttonMessage('我的票券', '我的票券'),
        buttonMessage('代領取', '代領取'),
        buttonMessage('我的預約', '我的預約'),
        buttonMessage('個人資料', '個人資料'),
      ]
    : [buttonUri('綁定帳號', linkUrl())];
  return flex(title, bubbleBase({ title, bodyContents: body, footerButtons: footer, heroUrl: DEFAULT_ICON }));
}

function buildLinkFlex() {
  const title = '綁定網站帳號';
  const body = [textComponent('點擊下方按鈕前往綁定，完成後即可在此查詢訂單、票券與預約')];
  const footer = [buttonUri('前往綁定', linkUrl())];
  return flex(title, bubbleBase({ title, bodyContents: body, footerButtons: footer, heroUrl: DEFAULT_ICON }));
}

function buildProfileFlex(u, providers = [], lineSubject = '') {
  const title = '個人資料';
  const uuid = String(u?.uuid || u?.id || '').trim();
  const lines = [
    textComponent(`姓名：${u?.username || '-'}`),
    textComponent(`Email：${u?.email || '-'}`),
    uuid ? textComponent(`UUID：${uuid}`, { size: 'xs', color: '#666666' }) : null,
  ].filter(Boolean);
  const footer = [buttonUri('前往個人資料', magicLink('/account', lineSubject))];
  const bodyContents = [
    { type: 'box', layout: 'vertical', spacing: 'xs', contents: lines },
  ];
  if (uuid) {
    bodyContents.push({ type: 'separator', margin: 'md' });
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      alignItems: 'center',
      contents: [
        textComponent('QR Code', { size: 'xs', color: '#999999' }),
        {
          type: 'image',
          url: qrImageUrl(uuid),
          margin: 'sm',
          size: 'xxl',
          aspectRatio: '1:1',
          aspectMode: 'fit',
          backgroundColor: '#FFFFFF',
        },
      ],
    });
  }
  return flex(title, bubbleBase({ title, bodyContents, footerButtons: footer }));
}

function buildOrdersFlex(list, lineSubject = '') {
  const title = '我的訂單';
  if (!list.length) {
    return flex(title, bubbleBase({ title, bodyContents: [textComponent('目前查無訂單紀錄。')], heroUrl: DEFAULT_ICON }));
  }
  const bubbles = list.map((o) => {
    const hero = o.eventId && API_BASE ? `${API_BASE}/events/${o.eventId}/cover` : DEFAULT_ICON;
    const body = [
      { type: 'box', layout: 'vertical', spacing: 'xs', contents: [
        o.ticketType ? textComponent(o.ticketType, { size: 'md' }) : textComponent('訂單', { size: 'md' }),
        textComponent(`訂單編號：${o.code}`),
        textComponent(`狀態：${o.status}`),
        o.quantity ? textComponent(`數量：${o.quantity}`) : null,
        o.total ? textComponent(`金額：$${o.total}`) : null,
        textComponent(`建立：${o.created}`),
      ].filter(Boolean) },
    ];
    const remittanceLines = [];
    const remittance = o.remittance || defaultRemittanceDetails();
    if (remittance.info) remittanceLines.push(textComponent(remittance.info, { size: 'xs', color: '#666666' }));
    if (remittance.bankCode) remittanceLines.push(textComponent(`銀行代碼：${remittance.bankCode}`, { size: 'xs', color: '#666666' }));
    if (remittance.bankAccount) remittanceLines.push(textComponent(`銀行帳戶：${remittance.bankAccount}`, { size: 'xs', color: '#666666' }));
    if (remittance.accountName) remittanceLines.push(textComponent(`帳戶名稱：${remittance.accountName}`, { size: 'xs', color: '#666666' }));
    if (remittance.bankName) remittanceLines.push(textComponent(`銀行名稱：${remittance.bankName}`, { size: 'xs', color: '#666666' }));
    if (remittanceLines.length) {
      body.push({ type: 'separator', margin: 'md' });
      body.push({
        type: 'box',
        layout: 'vertical',
        spacing: 'xs',
        contents: [textComponent('匯款資訊', { size: 'sm', color: '#111111' }), ...remittanceLines],
      });
    }
    const footer = [
      buttonUri('查看訂單', magicLink('/order', lineSubject)),
      buttonMessage('更多訂單', '我的訂單'),
    ];
    return bubbleBase({ title: '訂單', heroUrl: hero, bodyContents: body, footerButtons: footer });
  });
  return flexCarousel('我的訂單', bubbles);
}

function buildTicketsFlex(list, lineSubject = '') {
  if (!list.length) {
    const title = '我的票券';
    return flex(title, bubbleBase({ title, bodyContents: [textComponent('目前沒有可用票券。')], heroUrl: DEFAULT_ICON }));
  }
  const bubbles = list.map((t) => {
    const hero = ticketCoverUrl(t.type);
    const body = [
      { type: 'box', layout: 'vertical', spacing: 'xs', contents: [
        textComponent(t.type || '票券', { size: 'md' }),
        textComponent(`狀態：${t.status}`),
        t.id ? textComponent(`識別碼：${t.id}`, { size: 'xs', color: '#666666' }) : null,
        t.expiry ? textComponent(`到期：${t.expiry}`) : null,
      ].filter(Boolean) },
    ];
    const footer = [
      buttonUri('查看票券', magicLink('/wallet', lineSubject)),
      t.ticketId ? buttonPostback('Email 轉贈', `action=transfer_email&ticket=${t.ticketId}`, 'Email 轉贈') : null,
      t.ticketId ? buttonPostback('QR 轉贈', `action=transfer_qr&ticket=${t.ticketId}`, 'QR 轉贈') : null,
      buttonMessage('更多票券', '我的票券'),
    ];
    return bubbleBase({ title: `票券 ${t.type || ''}`, heroUrl: hero, bodyContents: body, footerButtons: footer.filter(Boolean) });
  });
  return flexCarousel('我的票券', bubbles);
}

function buildTransferPendingFlex({ ticketType, fromName, transferId } = {}) {
  const title = '收到票券轉贈';
  const contents = [
    textComponent(`來自：${fromName || '朋友'}`),
    textComponent(`票券：${ticketType || '票券'}`),
    transferId
      ? textComponent('可直接在此接受或拒絕，或輸入「認領轉贈」輸入轉贈碼。', { size: 'xs', color: '#666666' })
      : textComponent('請輸入「代領取」查看待處理轉贈，或輸入「認領轉贈」。', { size: 'xs', color: '#666666' }),
  ];
  const footer = transferId
    ? [
        buttonPostback('接受轉贈', `action=transfer_accept&id=${transferId}`, '接受轉贈'),
        buttonPostback('拒絕轉贈', `action=transfer_decline&id=${transferId}`, '拒絕轉贈'),
        buttonMessage('輸入轉贈碼', '認領轉贈'),
      ]
    : [
        buttonMessage('代領取', '代領取'),
        buttonMessage('認領轉贈', '認領轉贈'),
      ];
  const message = flex(title, bubbleBase({ title, bodyContents: contents, footerButtons: footer, heroUrl: DEFAULT_ICON }));
  const quick = transferId
    ? quickReply([
        qrItemPostback('接受轉贈', `action=transfer_accept&id=${transferId}`, '接受轉贈'),
        qrItemPostback('拒絕轉贈', `action=transfer_decline&id=${transferId}`, '拒絕轉贈'),
        qrItemMessage('認領轉贈', '認領轉贈'),
      ])
    : quickReply([
        qrItemMessage('代領取', '代領取'),
        qrItemMessage('認領轉贈', '認領轉贈'),
      ]);
  return { ...message, ...quick };
}

function buildTransferAcceptedForSenderFlex(ticketType, recipientName) {
  const name = recipientName ? String(recipientName) : '對方';
  const t = ticketType || '票券';
  const bodyContents = [
    textComponent(`您轉贈的 ${t} 已由 ${name} 接受。`),
  ];
  const footer = [buttonMessage('查看票券', '我的票券')];
  return flex('轉贈完成', bubbleBase({ title: '轉贈完成', bodyContents, footerButtons: footer, heroUrl: DEFAULT_ICON }));
}

function buildTransferAcceptedForRecipientFlex(ticketType) {
  const t = ticketType || '票券';
  const bodyContents = [
    textComponent(`您已成功領取 ${t}。`),
  ];
  const footer = [buttonMessage('查看票券', '我的票券')];
  return flex('領取成功', bubbleBase({ title: '領取成功', bodyContents, footerButtons: footer, heroUrl: DEFAULT_ICON }));
}

function buildTransferQrFlex(code, ticketType = '') {
  const title = '轉贈 QR Code';
  const contents = [
    textComponent(`票券：${ticketType || '票券'}`),
    textComponent('請將此 QR Code 提供給對方，即可立即完成轉贈。'),
    textComponent(`轉贈碼：${code}`, { size: 'xs', color: '#666666' }),
    {
      type: 'image',
      url: qrImageUrl(code),
      margin: 'md',
      size: 'full',
      aspectRatio: '1:1',
      aspectMode: 'fit',
      backgroundColor: '#FFFFFF',
    },
    textComponent('若要取消此轉贈，輸入「取消轉贈」。', { size: 'xs', color: '#999999' }),
  ];
  const footer = [
    buttonMessage('提醒對方', '代領取'),
    buttonMessage('查看票券', '我的票券'),
  ];
  return flex('轉贈 QR Code', bubbleBase({ title, bodyContents: contents, footerButtons: footer, heroUrl: DEFAULT_ICON }));
}

function buildReservationsFlex(list, lineSubject = '') {
  if (!list.length) {
    const title = '我的預約';
    return flex(title, bubbleBase({ title, bodyContents: [textComponent('目前沒有預約紀錄。')] }));
  }
  const bubbles = list.map((r) => {
    const body = [
      { type: 'box', layout: 'vertical', spacing: 'xs', contents: [
        textComponent(r.event || '-', { size: 'md' }),
        r.store ? textComponent(`門市：${r.store}`) : null,
        r.status ? textComponent(`狀態：${r.status}`) : null,
        r.time ? textComponent(`預約：${r.time}`) : null,
      ].filter(Boolean) },
    ];
    const footer = [ buttonUri('查看預約', magicLink('/wallet?tab=reservations', lineSubject)) ];
    return bubbleBase({ title: '預約', bodyContents: body, footerButtons: footer });
  });
  return flexCarousel('我的預約', bubbles);
}

function buildIncomingTransfersFlex(list) {
  const title = '代領取轉贈';
  if (!list.length) {
    return flex(title, bubbleBase({ title, bodyContents: [textComponent('目前沒有待處理的轉贈。')], heroUrl: DEFAULT_ICON }));
  }
  const bubbles = list.map((row) => {
    const created = row.created_at ? new Date(row.created_at).toLocaleString('zh-TW') : '';
    const method = row.code ? 'QR 即時轉贈' : 'Email 轉贈';
    const contents = [
      textComponent(`來源：${row.from_username || row.from_email || '朋友'}`),
      textComponent(`票券：${row.type || '票券'}`),
      row.expiry ? textComponent(`到期：${new Date(row.expiry).toLocaleDateString('zh-TW')}`) : null,
      textComponent(`方式：${method}`),
      created ? textComponent(`發起：${created}`, { size: 'xs', color: '#666666' }) : null,
    ].filter(Boolean);
    const footer = [
      buttonPostback('接受', `action=transfer_accept&id=${row.id}`, '接受'),
      buttonPostback('拒絕', `action=transfer_decline&id=${row.id}`, '拒絕'),
      buttonMessage('認領轉贈', '認領轉贈'),
    ];
    return bubbleBase({ title: row.type || '票券', bodyContents: contents, footerButtons: footer, heroUrl: DEFAULT_ICON });
  });
  return flexCarousel(title, bubbles);
}

function buildSessionsFlex(list, lineSubject = '', opts = {}) {
  if (!list.length) {
    const title = '場次列表';
    return flex(title, bubbleBase({ title, bodyContents: [textComponent('目前沒有可預約的場次。')], heroUrl: DEFAULT_ICON }));
  }
  const limit = Number(opts.limit ?? 12) || 12;
  const offset = Number(opts.offset ?? 0) || 0;
  const hasMore = opts.hasMore ?? Boolean(list.hasMore ?? (list.length >= limit));
  const nextOffset = opts.nextOffset ?? (offset + list.length);
  const bubbles = list.map((e) => {
    // Prefer API cover endpoint when available to ensure absolute URL
    const hero = API_BASE && e.id ? `${API_BASE}/events/${e.id}/cover` : normalizeCoverUrl(e.cover || '');
    const body = [
      { type: 'box', layout: 'vertical', spacing: 'xs', contents: [
        textComponent(e.title || '-', { size: 'md' }),
        e.date ? textComponent(`📅 ${e.date}`) : null,
        e.deadline ? textComponent(`🛑 報名截止：${e.deadline}`) : null,
        // Show up to 3 rules
        ...(Array.isArray(e.rules) ? e.rules.slice(0, 3).map(r => textComponent(`• ${r}`)) : []),
      ].filter(Boolean) },
    ];
    const footer = [
      buttonUri('立即預約', magicLink(`/booking/${encodeURIComponent(e.code || '')}`, lineSubject)),
    ];
    return bubbleBase({ title: '場次', heroUrl: hero, bodyContents: body, footerButtons: footer });
  });
  if (hasMore) {
    const moreBubble = bubbleBase({
      title: '更多場次',
      bodyContents: [textComponent('點擊下方按鈕載入更多場次')],
      footerButtons: [buttonPostback('載入更多', `action=events_more&offset=${nextOffset}`, '載入更多')],
      heroUrl: DEFAULT_ICON,
    });
    bubbles.push(moreBubble);
  }
  return flexCarousel('場次列表', bubbles);
}

// 票券商店（同步網頁資料）

function buildProductsFlex(list, lineSubject = '') {
  if (!list.length) {
    const title = '票券商店';
    return flex(title, bubbleBase({ title, bodyContents: [textComponent('目前沒有販售中的票券。')], heroUrl: DEFAULT_ICON }));
  }
  const formatPrice = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return 'NT$ 0';
    return `NT$ ${num.toLocaleString('zh-TW', { minimumFractionDigits: 0 })}`;
  };
  const bubbles = list.map((p) => {
    const hero = ticketCoverUrl(p.name);
    const body = [
      { type: 'box', layout: 'vertical', spacing: 'xs', contents: [
        textComponent(p.name || '-', { size: 'md' }),
        p.description ? textComponent(p.description) : null,
        textComponent(`價格：${formatPrice(p.price)}`),
      ].filter(Boolean) },
    ];
    const footer = [
      buttonUri('前往購買', magicLink('/store', lineSubject)),
      buttonMessage('查看場次', '場次'),
    ];
    return bubbleBase({ title: p.name || '票券', heroUrl: hero, bodyContents: body, footerButtons: footer });
  });
  bubbles.push(bubbleBase({
    title: '開啟完整商店',
    bodyContents: [textComponent('前往網站查看完整票券與預約功能。')],
    footerButtons: [buttonUri('開啟商店', magicLink('/store', lineSubject))],
    heroUrl: DEFAULT_ICON,
  }));
  return flexCarousel('票券商店', bubbles);
}

function buildBindingsFlex(providers = []){
  const title = '綁定狀態';
  const hasGoogle = providers.includes('google');
  const hasLine = providers.includes('line');
  const body = [
    textComponent(`Google：${hasGoogle ? '已綁定' : '未綁定'}`),
    textComponent(`LINE：${hasLine ? '已綁定' : '未綁定'}`),
  ];
  const footer = [ buttonMessage('解除綁定', '解除綁定'), buttonMessage('幫助', '幫助') ];
  return flex(title, bubbleBase({ title, bodyContents: body, footerButtons: footer }));
}

async function sendForgotPassword(email){
  if (!email || !PUBLIC_API_BASE) return { ok: false, message: 'Email 或 API 未設定' };
  try{
    const resp = await httpsPostJson(`${PUBLIC_API_BASE}/forgot-password`, { email });
    return resp?.ok ? { ok: true } : { ok: false, message: resp?.message || '寄送失敗' };
  } catch (e) { return { ok: false, message: e?.message || '寄送失敗' } }
}

async function handlePendingAction({ pending, rawText, replyToken, lineSubject, linkedUserId }) {
  if (!pending) return false;
  const trimmed = String(rawText || '').trim();
  const normalized = trimmed.replace(/\s+/g, '').toLowerCase();

  // Allow universal cancel keywords
  if (['取消', 'cancel', 'exit', 'no', '取消轉贈'].includes(normalized)) {
    setPendingAction(lineSubject, null);
    await reply(replyToken, { type: 'text', text: '已取消操作。' });
    return true;
  }

  if (pending.type === 'transfer_email') {
    if (!linkedUserId) {
      await reply(replyToken, { type: 'text', text: '請先綁定網站帳號後才能轉贈票券。輸入「綁定」取得連結。' });
      setPendingAction(lineSubject, null);
      return true;
    }
    const result = await initiateTransferEmail({ fromUserId: linkedUserId, ticketId: pending.ticketId, targetEmail: trimmed });
    if (result.ok) {
      setPendingAction(lineSubject, null);
      await reply(replyToken, {
        type: 'flex',
        altText: '轉贈已發起',
        contents: bubbleBase({
          title: '轉贈已發起',
          bodyContents: [textComponent('已發起 Email 轉贈，等待對方接受。')],
          footerButtons: [buttonMessage('代領取', '代領取'), buttonMessage('我的票券', '我的票券')],
          heroUrl: DEFAULT_ICON,
        }),
      });
      return true;
    }
    if (result.code === 'TRANSFER_EXISTS') {
      setPendingAction(lineSubject, {
        type: 'confirm_retry_transfer',
        ticketId: pending.ticketId,
        mode: 'email',
        email: trimmed,
      });
      await reply(replyToken, { type: 'text', text: '已有待處理的轉贈。輸入「是」取消舊轉贈並重新發起，或輸入「取消」放棄。' });
      return true;
    }
    if (result.code === 'VALIDATION_ERROR') {
      await reply(replyToken, { type: 'text', text: result.message || 'Email 有誤，請重新輸入或輸入「取消」。' });
      // Keep pending to allow retry
      setPendingAction(lineSubject, { type: 'transfer_email', ticketId: pending.ticketId });
      return true;
    }
    setPendingAction(lineSubject, null);
    await reply(replyToken, { type: 'text', text: result.message || '發起失敗，請稍後再試。' });
    return true;
  }

  if (pending.type === 'transfer_claim') {
    if (!linkedUserId) {
      await reply(replyToken, { type: 'text', text: '請先綁定網站帳號後才能認領票券。輸入「綁定」取得連結。' });
      setPendingAction(lineSubject, null);
      return true;
    }
    const result = await claimTransferByCode({ code: trimmed, recipientId: linkedUserId });
    if (result.ok) {
      setPendingAction(lineSubject, null);
      await reply(replyToken, {
        type: 'flex',
        altText: '已完成轉贈',
        contents: bubbleBase({
          title: '已完成轉贈',
          bodyContents: [textComponent('✅ 已認領票券。')],
          footerButtons: [buttonMessage('查看票券', '我的票券')],
          heroUrl: DEFAULT_ICON,
        }),
      });
      return true;
    }
    if (['VALIDATION_ERROR', 'CODE_NOT_FOUND'].includes(result.code)) {
      // Allow retry without clearing state
      setPendingAction(lineSubject, pending);
      await reply(replyToken, { type: 'text', text: `${result.message || '認領失敗'}，請重新輸入或輸入「取消」。` });
      return true;
    }
    setPendingAction(lineSubject, null);
    await reply(replyToken, { type: 'text', text: result.message || '認領失敗，請稍後再試。' });
    return true;
  }

  if (pending.type === 'confirm_retry_transfer') {
    if (!linkedUserId) {
      await reply(replyToken, { type: 'text', text: '請先綁定網站帳號後再操作。輸入「綁定」取得連結。' });
      setPendingAction(lineSubject, null);
      return true;
    }
    if (['是', 'yes', 'y', '好', '確認'].includes(normalized)) {
      await cancelPendingTransfers(pending.ticketId, linkedUserId);
      if (pending.mode === 'email') {
        const res = await initiateTransferEmail({ fromUserId: linkedUserId, ticketId: pending.ticketId, targetEmail: pending.email });
        if (res.ok) {
          setPendingAction(lineSubject, null);
          await reply(replyToken, {
            type: 'flex',
            altText: '轉贈已發起',
            contents: bubbleBase({
              title: '轉贈已發起',
              bodyContents: [textComponent('已重新發起 Email 轉贈。')],
              footerButtons: [buttonMessage('代領取', '代領取'), buttonMessage('我的票券', '我的票券')],
              heroUrl: DEFAULT_ICON,
            }),
          });
          return true;
        }
        if (res.code === 'TRANSFER_EXISTS') {
          // Rare but handle by prompting again
          setPendingAction(lineSubject, pending);
          await reply(replyToken, { type: 'text', text: '仍有待處理的轉贈，請稍後再試。' });
          return true;
        }
        setPendingAction(lineSubject, null);
        await reply(replyToken, { type: 'text', text: res.message || '重新發起失敗，請稍後再試。' });
        return true;
      }
      if (pending.mode === 'qr') {
        const res = await initiateTransferQr({ fromUserId: linkedUserId, ticketId: pending.ticketId });
        if (res.ok) {
          setPendingAction(lineSubject, null);
          await reply(replyToken, buildTransferQrFlex(res.data.code, res.data.ticketType));
          return true;
        }
        if (res.code === 'TRANSFER_EXISTS') {
          setPendingAction(lineSubject, pending);
          await reply(replyToken, { type: 'text', text: '仍有待處理的轉贈，請稍後再試。' });
          return true;
        }
        setPendingAction(lineSubject, null);
        await reply(replyToken, { type: 'text', text: res.message || '產生 QR 失敗，請稍後再試。' });
        return true;
      }
    }
    setPendingAction(lineSubject, null);
    await reply(replyToken, { type: 'text', text: '已取消重新發起。' });
    return true;
  }

  return false;
}

// ==== Ticket transfer helpers ====
function normalizeEmail(val) {
  return String(val || '').trim().toLowerCase();
}

async function findUserIdByEmail(email) {
  const norm = normalizeEmail(email);
  if (!norm) return null;
  try {
    const [rows] = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [norm]);
    return rows.length ? rows[0].id : null;
  } catch (_) {
    return null;
  }
}

async function ensureOAuthIdentitiesTable() {
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

async function getLineSubjectByUserId(userId) {
  if (!userId) return null;
  try {
    await ensureOAuthIdentitiesTable();
    const [rows] = await pool.query('SELECT subject FROM oauth_identities WHERE user_id = ? AND provider = ? LIMIT 1', [userId, 'line']);
    return rows.length ? String(rows[0].subject || '') : null;
  } catch (_) {
    return null;
  }
}

async function notifyLineByUserId(userId, messages) {
  try {
    const subject = await getLineSubjectByUserId(userId);
    if (!subject) return;
    await pushToUserId(subject, messages);
  } catch (_) { /* ignore push errors */ }
}

function randomCode(length = 10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const idx = crypto.randomInt(0, alphabet.length);
    out += alphabet[idx];
  }
  return out;
}

async function generateTransferCode() {
  for (;;) {
    const code = randomCode(10);
    const [dup] = await pool.query('SELECT id FROM ticket_transfers WHERE code = ? LIMIT 1', [code]);
    if (!dup.length) return code;
  }
}

async function hasPendingTransfer(ticketId) {
  const [rows] = await pool.query('SELECT id FROM ticket_transfers WHERE ticket_id = ? AND status = "pending" LIMIT 1', [ticketId]);
  return rows.length > 0;
}

async function expireOldTransfers(conn = pool) {
  try {
    await conn.query(
      `UPDATE ticket_transfers
         SET status = 'expired'
       WHERE status = 'pending' AND (
         (code IS NOT NULL AND created_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)) OR
         (code IS NULL AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY))
       )`
    );
  } catch (_) { /* ignore */ }
}

async function cancelPendingTransfers(ticketId, fromUserId) {
  try {
    await pool.query(
      'UPDATE ticket_transfers SET status = "canceled" WHERE ticket_id = ? AND from_user_id = ? AND status = "pending"',
      [ticketId, fromUserId]
    );
  } catch (_) { /* ignore */ }
}

async function cancelAllPendingTransfers(fromUserId) {
  const [result] = await pool.query(
    'UPDATE ticket_transfers SET status = "canceled" WHERE from_user_id = ? AND status = "pending"',
    [fromUserId]
  );
  return Number(result?.affectedRows || 0);
}

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

async function logTicket({ conn = pool, ticketId, userId, action, meta = {} }) {
  try {
    await ensureTicketLogsTable();
    await conn.query('INSERT INTO ticket_logs (ticket_id, user_id, action, meta) VALUES (?, ?, ?, ?)', [ticketId, userId, action, JSON.stringify(meta || {})]);
  } catch (_) { /* ignore logging errors */ }
}

async function sendTransferInviteEmail({ toEmail, fromName }) {
  if (!mailerReady) return;
  const target = String(toEmail || '').trim();
  if (!target) return;
  try {
    const link = `${PUBLIC_WEB_URL}/login?email=${encodeURIComponent(target)}&register=1`;
    await transporter.sendMail({
      from: `${EMAIL_FROM_NAME} <${EMAIL_FROM_ADDRESS}>`,
      to: target,
      subject: '您收到一張票券轉贈 - Leader Online',
      html: `
        <p>您好，您收到一張來自 ${fromName || '朋友'} 的票券轉贈。</p>
        <p>請使用此 Email 登入或註冊以領取票券：</p>
        <p><a href="${link}">${link}</a></p>
        <p style="color:#888; font-size:12px;">若非您本人操作，可忽略此郵件。</p>
      `,
    });
  } catch (_) { /* mail best-effort */ }
}

async function queryIncomingTransfers(recipientId, email) {
  const normEmail = normalizeEmail(email);
  const [rows] = await pool.query(
    `SELECT tt.*, t.type, t.expiry, u.username AS from_username, u.email AS from_email
       FROM ticket_transfers tt
       JOIN tickets t ON t.id = tt.ticket_id
       JOIN users u ON u.id = tt.from_user_id
      WHERE tt.status = 'pending'
        AND (tt.to_user_id = ? OR (tt.to_user_id IS NULL AND LOWER(tt.to_user_email) = LOWER(?)))
      ORDER BY tt.id ASC`,
    [recipientId, normEmail || '']
  );
  return rows;
}

async function initiateTransferEmail({ fromUserId, ticketId, targetEmail }) {
  const conn = pool;
  await expireOldTransfers(conn);
  const [tickets] = await conn.query('SELECT id, user_id, used, type FROM tickets WHERE id = ? LIMIT 1', [ticketId]);
  if (!tickets.length) return { ok: false, code: 'TICKET_NOT_FOUND', message: '找不到票券' };
  const ticket = tickets[0];
  if (String(ticket.user_id) !== String(fromUserId)) return { ok: false, code: 'FORBIDDEN', message: '僅限持有者轉贈' };
  if (Number(ticket.used)) return { ok: false, code: 'TICKET_USED', message: '票券已使用，無法轉贈' };
  if (await hasPendingTransfer(ticket.id)) return { ok: false, code: 'TRANSFER_EXISTS', message: '已有待處理的轉贈' };

  const profile = await queryUserProfile(fromUserId);
  const fromEmail = normalizeEmail(profile?.email || '');
  const target = normalizeEmail(targetEmail);
  if (!target) return { ok: false, code: 'VALIDATION_ERROR', message: '需提供對方 Email' };
  if (fromEmail && target === fromEmail) return { ok: false, code: 'VALIDATION_ERROR', message: '不可轉贈給自己' };

  const toId = await findUserIdByEmail(target);
  const [insert] = await conn.query(
    'INSERT INTO ticket_transfers (ticket_id, from_user_id, to_user_id, to_user_email, code, status) VALUES (?, ?, ?, ?, NULL, "pending")',
    [ticket.id, fromUserId, toId, target]
  );
  const transferId = Number(insert?.insertId || 0) || null;

  if (!toId) {
    await sendTransferInviteEmail({ toEmail: target, fromName: profile?.username || '朋友' });
  } else if (String(toId) !== String(fromUserId)) {
    try {
      await notifyLineByUserId(toId, buildTransferPendingFlex({ ticketType: ticket.type, fromName: profile?.username || '朋友', transferId }));
    } catch (_) { /* ignore push errors */ }
  }

  return { ok: true, message: '已發起轉贈，等待對方接受' };
}

async function initiateTransferQr({ fromUserId, ticketId }) {
  await expireOldTransfers(pool);
  const [tickets] = await pool.query('SELECT id, user_id, used, type FROM tickets WHERE id = ? LIMIT 1', [ticketId]);
  if (!tickets.length) return { ok: false, code: 'TICKET_NOT_FOUND', message: '找不到票券' };
  const ticket = tickets[0];
  if (String(ticket.user_id) !== String(fromUserId)) return { ok: false, code: 'FORBIDDEN', message: '僅限持有者轉贈' };
  if (Number(ticket.used)) return { ok: false, code: 'TICKET_USED', message: '票券已使用，無法轉贈' };
  if (await hasPendingTransfer(ticket.id)) return { ok: false, code: 'TRANSFER_EXISTS', message: '已有待處理的轉贈' };

  const code = await generateTransferCode();
  await pool.query(
    'INSERT INTO ticket_transfers (ticket_id, from_user_id, code, status) VALUES (?, ?, ?, "pending")',
    [ticket.id, fromUserId, code]
  );
  return { ok: true, data: { code, ticketType: ticket.type || '票券' }, message: '請出示 QR 給對方掃描立即轉贈' };
}

async function acceptTransferById({ transferId, recipientId }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await expireOldTransfers(conn);
    const [rows] = await conn.query('SELECT * FROM ticket_transfers WHERE id = ? AND status = "pending" LIMIT 1', [transferId]);
    if (!rows.length) { await conn.rollback(); return { ok: false, code: 'TRANSFER_NOT_FOUND', message: '找不到待處理的轉贈' }; }
    const transfer = rows[0];

    const profile = await queryUserProfile(recipientId);
    const myEmail = normalizeEmail(profile?.email || '');
    if (String(transfer.to_user_id || '') !== String(recipientId) && normalizeEmail(transfer.to_user_email || '') !== myEmail) {
      await conn.rollback();
      return { ok: false, code: 'FORBIDDEN', message: '僅限被指定的帳號接受' };
    }
    if (String(transfer.from_user_id) === String(recipientId)) {
      await conn.rollback();
      return { ok: false, code: 'FORBIDDEN', message: '不可自行接受' };
    }

    const [ticketRows] = await conn.query('SELECT id, user_id, used, type FROM tickets WHERE id = ? LIMIT 1', [transfer.ticket_id]);
    if (!ticketRows.length) { await conn.rollback(); return { ok: false, code: 'TICKET_NOT_FOUND', message: '票券不存在' }; }
    const ticket = ticketRows[0];
    if (Number(ticket.used)) { await conn.rollback(); return { ok: false, code: 'TICKET_USED', message: '票券已使用' }; }
    if (String(ticket.user_id) !== String(transfer.from_user_id)) {
      await conn.rollback();
      return { ok: false, code: 'TRANSFER_INVALID', message: '票券持有者已變更' };
    }

    const [upd] = await conn.query('UPDATE tickets SET user_id = ? WHERE id = ? AND user_id = ?', [recipientId, ticket.id, transfer.from_user_id]);
    if (!upd.affectedRows) {
      await conn.rollback();
      return { ok: false, code: 'TRANSFER_CONFLICT', message: '轉贈競態，請重試' };
    }

    await conn.query('UPDATE ticket_transfers SET status = "accepted", to_user_id = COALESCE(to_user_id, ?) WHERE id = ?', [recipientId, transfer.id]);
    await conn.query('UPDATE ticket_transfers SET status = "canceled" WHERE ticket_id = ? AND status = "pending" AND id <> ?', [ticket.id, transfer.id]);

    try {
      const method = transfer.code ? 'qr' : 'email';
      const [fromUserRows] = await conn.query('SELECT email, username FROM users WHERE id = ? LIMIT 1', [transfer.from_user_id]);
      const metaCommon = {
        method,
        ticket_type: ticket.type,
        transfer_id: transfer.id,
        from_email: fromUserRows?.[0]?.email || null,
        to_email: profile?.email || null,
      };
      await logTicket({ conn, ticketId: ticket.id, userId: transfer.from_user_id, action: 'transferred_out', meta: metaCommon });
      await logTicket({ conn, ticketId: ticket.id, userId: recipientId, action: 'transferred_in', meta: metaCommon });
    } catch (_) { /* ignore */ }

    await conn.commit();

    try {
      await notifyLineByUserId(transfer.from_user_id, buildTransferAcceptedForSenderFlex(ticket.type, profile?.username));
      await notifyLineByUserId(recipientId, buildTransferAcceptedForRecipientFlex(ticket.type));
    } catch (_) { /* ignore push errors */ }

    return { ok: true, message: '已接受並完成轉贈' };
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    return { ok: false, code: 'TRANSFER_ACCEPT_FAIL', message: err?.message || '接受失敗' };
  } finally {
    conn.release();
  }
}

async function declineTransferById({ transferId, recipientId }) {
  await expireOldTransfers(pool);
  const profile = await queryUserProfile(recipientId);
  const email = normalizeEmail(profile?.email || '');
  const [result] = await pool.query(
    'UPDATE ticket_transfers SET status = "declined" WHERE id = ? AND status = "pending" AND (to_user_id = ? OR LOWER(to_user_email) = LOWER(?))',
    [transferId, recipientId, email || '']
  );
  if (!result.affectedRows) return { ok: false, code: 'TRANSFER_NOT_FOUND', message: '找不到待處理的轉贈' };
  return { ok: true, message: '已拒絕轉贈' };
}

async function claimTransferByCode({ code, recipientId }) {
  const trimmed = String(code || '').trim();
  if (!trimmed) return { ok: false, code: 'VALIDATION_ERROR', message: '缺少驗證碼' };
  const normalized = trimmed.replace(/\s+/g, '');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await expireOldTransfers(conn);
    const [rows] = await conn.query('SELECT * FROM ticket_transfers WHERE code = ? AND status = "pending" LIMIT 1', [normalized]);
    if (!rows.length) { await conn.rollback(); return { ok: false, code: 'CODE_NOT_FOUND', message: '無效或已處理的轉贈碼' }; }
    const transfer = rows[0];
    if (String(transfer.from_user_id) === String(recipientId)) { await conn.rollback(); return { ok: false, code: 'FORBIDDEN', message: '不可轉贈給自己' }; }

    const [ticketRows] = await conn.query('SELECT id, user_id, used, type FROM tickets WHERE id = ? LIMIT 1', [transfer.ticket_id]);
    if (!ticketRows.length) { await conn.rollback(); return { ok: false, code: 'TICKET_NOT_FOUND', message: '票券不存在' }; }
    const ticket = ticketRows[0];
    if (Number(ticket.used)) { await conn.rollback(); return { ok: false, code: 'TICKET_USED', message: '票券已使用' }; }
    if (String(ticket.user_id) !== String(transfer.from_user_id)) { await conn.rollback(); return { ok: false, code: 'TRANSFER_INVALID', message: '票券持有者已變更' }; }

    const [upd] = await conn.query('UPDATE tickets SET user_id = ? WHERE id = ? AND user_id = ?', [recipientId, ticket.id, transfer.from_user_id]);
    if (!upd.affectedRows) { await conn.rollback(); return { ok: false, code: 'TRANSFER_CONFLICT', message: '轉贈競態，請重試' }; }

    await conn.query('UPDATE ticket_transfers SET status = "accepted", to_user_id = ? WHERE id = ?', [recipientId, transfer.id]);
    await conn.query('UPDATE ticket_transfers SET status = "canceled" WHERE ticket_id = ? AND status = "pending" AND id <> ?', [ticket.id, transfer.id]);

    try {
      const method = transfer.code ? 'qr' : 'email';
      const [fromUserRows] = await conn.query('SELECT email, username FROM users WHERE id = ? LIMIT 1', [transfer.from_user_id]);
      const profile = await queryUserProfile(recipientId);
      const metaCommon = {
        method,
        ticket_type: ticket.type,
        transfer_id: transfer.id,
        from_email: fromUserRows?.[0]?.email || null,
        to_email: profile?.email || null,
      };
      await logTicket({ conn, ticketId: ticket.id, userId: transfer.from_user_id, action: 'transferred_out', meta: metaCommon });
      await logTicket({ conn, ticketId: ticket.id, userId: recipientId, action: 'transferred_in', meta: metaCommon });
    } catch (_) { /* ignore */ }

    await conn.commit();

    try {
      const profile = await queryUserProfile(recipientId);
      await notifyLineByUserId(transfer.from_user_id, buildTransferAcceptedForSenderFlex(ticket.type, profile?.username));
      await notifyLineByUserId(recipientId, buildTransferAcceptedForRecipientFlex(ticket.type));
    } catch (_) { /* ignore push errors */ }

    return { ok: true, message: '已完成轉贈' };
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    return { ok: false, code: 'TRANSFER_CLAIM_FAIL', message: err?.message || '認領失敗' };
  } finally {
    conn.release();
  }
}

// Cart-related logic removed for LINE bot store simplification

async function handleTextMessage(event) {
  const raw = (event.message?.text || '').toString();
  const text = raw.trim();
  const replyToken = event.replyToken;
  const lineSubject = event.source?.userId || '';
  if (!lineSubject) return;

  const normalized = text.replace(/\s+/g, '').toLowerCase();

  if (normalized === '綁定' || normalized === '綁定帳號' || normalized === 'link') {
    setPendingAction(lineSubject, null);
    return reply(replyToken, { ...buildLinkFlex(), ...quickReply([qrItemMessage('幫助', '幫助'), qrItemMessage('我的訂單', '我的訂單')]) });
  }

  const linkedUserId = await findLinkedUserIdByLineSubject(lineSubject);

  const pending = getPendingAction(lineSubject);
  if (pending) {
    const handled = await handlePendingAction({ pending, rawText: text, replyToken, lineSubject, linkedUserId });
    if (handled) return;
  }

  if (normalized === '幫助' || normalized === 'help' || normalized === '說明' || normalized === 'menu' || normalized === '功能') {
    return reply(replyToken, {
      ...buildHelpFlex(!!linkedUserId),
      ...quickReply([
        qrItemMessage('商店', '商店'),
        qrItemMessage('場次', '場次'),
        qrItemMessage('我的訂單', '我的訂單'),
        qrItemMessage('我的票券', '我的票券'),
        qrItemMessage('代領取', '代領取'),
        qrItemMessage('認領轉贈', '認領轉贈'),
      ]),
    });
  }

  if (!linkedUserId) {
    return reply(replyToken, { ...buildHelpFlex(false), ...quickReply([qrItemUri('去綁定', linkUrl()), qrItemMessage('幫助', '幫助'), qrItemMessage('商店', '商店')]) });
  }

  if (normalized === '商店' || normalized === 'store' || normalized === '購買') {
    const [productRows, eventRows] = await Promise.all([
      queryProducts(6, 0),
      queryBookableEvents(6, 0),
    ]);
    const products = formatProducts(productRows);
    const eventsHasMore = Boolean(eventRows.hasMore);
    const eventsNextOffset = typeof eventRows.nextOffset === 'number' ? eventRows.nextOffset : eventRows.length || 0;
    const events = formatEvents(eventRows);
    const quick = quickReply([
      qrItemUri('開啟商店', magicLink('/store', lineSubject)),
      qrItemMessage('場次', '場次'),
      qrItemMessage('我的訂單', '我的訂單'),
      qrItemMessage('我的票券', '我的票券'),
    ]);
    const messages = [
      { ...buildProductsFlex(products, lineSubject), ...quick },
      buildSessionsFlex(events, lineSubject, { limit: 6, offset: 0, hasMore: eventsHasMore, nextOffset: eventsNextOffset }),
    ];
    return reply(replyToken, messages);
  }

  if (normalized === '個人資料' || normalized === '我' || normalized === 'profile' || normalized === 'whoami') {
    const u = await queryUserProfile(linkedUserId);
    const providers = await queryUserProviders(linkedUserId);
    if (!u) return reply(replyToken, buildProfileFlex(null, providers, lineSubject));
    return reply(replyToken, buildProfileFlex(u, providers, lineSubject));
  }

  if (normalized === '我的訂單' || normalized === '訂單' || normalized === 'orders') {
    const rows = await queryOrders(linkedUserId, 5);
    return reply(replyToken, buildOrdersFlex(formatOrders(rows), lineSubject));
  }

  if (normalized === '我的票券' || normalized === '票券' || normalized === 'tickets') {
    const rows = await queryTickets(linkedUserId, 5);
    return reply(replyToken, {
      ...buildTicketsFlex(formatTickets(rows), lineSubject),
      ...quickReply([
        qrItemMessage('代領取', '代領取'),
        qrItemMessage('認領轉贈', '認領轉贈'),
        qrItemMessage('取消轉贈', '取消轉贈'),
      ]),
    });
  }

  if (normalized === '代領取' || normalized === '代領取轉贈' || normalized === '待領取' || normalized === '待領取轉贈' || normalized === 'incoming') {
    const profile = await queryUserProfile(linkedUserId);
    const incoming = await queryIncomingTransfers(linkedUserId, profile?.email || '');
    return reply(replyToken, {
      ...buildIncomingTransfersFlex(incoming),
      ...quickReply([
        qrItemMessage('認領轉贈', '認領轉贈'),
        qrItemMessage('我的票券', '我的票券'),
      ]),
    });
  }

  if (normalized === '認領轉贈' || normalized === '掃描轉贈碼' || normalized === 'claim') {
    setPendingAction(lineSubject, { type: 'transfer_claim' });
    return reply(replyToken, {
      type: 'text',
      text: '請輸入對方提供的 10 碼轉贈碼，或輸入「取消」結束流程。',
    });
  }

  if (normalized === '取消轉贈' || normalized === 'canceltransfer') {
    const canceled = await cancelAllPendingTransfers(linkedUserId);
    if (canceled > 0) {
      return reply(replyToken, { type: 'text', text: `已取消 ${canceled} 筆待處理的轉贈。` });
    }
    return reply(replyToken, { type: 'text', text: '目前沒有待取消的轉贈。' });
  }

  if (normalized === '場次' || normalized === '預約場次' || normalized === '可預約場次' || normalized === 'events' || normalized === 'sessions') {
    const rows = await queryBookableEvents(12, 0);
    const hasMore = Boolean(rows.hasMore);
    const nextOffset = typeof rows.nextOffset === 'number' ? rows.nextOffset : rows.length || 0;
    return reply(replyToken, buildSessionsFlex(formatEvents(rows), lineSubject, { limit: 12, offset: 0, hasMore, nextOffset }));
  }

  if (normalized === '我的預約' || normalized === '預約' || normalized === 'reservations') {
    const rows = await queryReservations(linkedUserId, 5);
    return reply(replyToken, buildReservationsFlex(formatReservations(rows), lineSubject));
  }

  if (normalized === '綁定狀態' || normalized === '我的綁定' || normalized === 'providers') {
    const providers = await queryUserProviders(linkedUserId);
    return reply(replyToken, buildBindingsFlex(providers));
  }

  if (normalized === '重設密碼' || normalized === '忘記密碼' || normalized === 'resetpassword') {
    const profile = await queryUserProfile(linkedUserId);
    const email = profile?.email || '';
    if (!email) {
      return reply(replyToken, flex('無法寄送', bubbleBase({ title: '無法寄送', bodyContents: [textComponent('您的帳號缺少 Email，請先至網站補齊。')], footerButtons: [buttonUri('前往個人資料', magicLink('/account', lineSubject))] })));
    }
    const r = await sendForgotPassword(email);
    if (r.ok) {
      return reply(replyToken, flex('已寄送連結', bubbleBase({ title: '已寄送連結', bodyContents: [textComponent('已寄送重設密碼連結至您的 Email。請於一小時內完成設定。')] })));
    }
    return reply(replyToken, flex('寄送失敗', bubbleBase({ title: '寄送失敗', bodyContents: [textComponent(r.message || '請稍後再試或至網站操作。')], footerButtons: [buttonUri('前往登入', `${PUBLIC_WEB_URL}/login`)] })));
  }

  if (normalized === '解除綁定' || normalized === 'unlink') {
    await pool.query('DELETE FROM oauth_identities WHERE provider = ? AND subject = ? LIMIT 1', ['line', lineSubject]);
    return reply(replyToken, flex('已解除綁定', bubbleBase({ title: '已解除綁定', bodyContents: [textComponent('若要再次綁定，請點擊下方按鈕或輸入「綁定」')], footerButtons: [buttonUri('前往綁定', linkUrl())] })));
  }

  if (normalized === '轉贈' || normalized === 'transfer') {
    return reply(replyToken, {
      type: 'text',
      text: '請先輸入「我的票券」，在票券卡片底下可選擇 Email 或 QR 轉贈。',
    });
  }

  return reply(replyToken, flex('未識別的指令', bubbleBase({ title: '未識別的指令', bodyContents: [textComponent('輸入「幫助」查看可用功能。')] })));
}

async function handleEvent(event) {
  try {
    if (event.type === 'follow') {
      const replyToken = event.replyToken;
      const userId = event.source?.userId || '';
      const linkedUserId = userId ? await findLinkedUserIdByLineSubject(userId) : null;
      return reply(replyToken, { ...buildHelpFlex(!!linkedUserId), ...quickReply([qrItemUri('綁定帳號', linkUrl()), qrItemMessage('商店', '商店'), qrItemMessage('幫助', '幫助')]) });
    }
    if (event.type === 'unfollow') {
      // Optional: keep mapping for when user re-adds the bot; do nothing.
      return;
    }
    if (event.type === 'message' && event.message?.type === 'text') {
      return handleTextMessage(event);
    }
    if (event.type === 'postback') {
      const data = String(event.postback?.data || '');
      if (data === 'action=unlink') {
        const userId = event.source?.userId || '';
        if (userId) await pool.query('DELETE FROM oauth_identities WHERE provider = ? AND subject = ? LIMIT 1', ['line', userId]);
        return reply(event.replyToken, flex('已解除綁定', bubbleBase({ title: '已解除綁定', bodyContents: [textComponent('LINE 綁定已移除')] })));
      }
      // Events pagination via postback
      try {
        const params = new URLSearchParams(data);
        const action = params.get('action') || '';
        const subject = event.source?.userId || '';
        const linkedUserId = subject ? await findLinkedUserIdByLineSubject(subject) : null;

        if (action === 'events_more') {
          const offset = Math.max(0, Number(params.get('offset') || 0));
          const rows = await queryBookableEvents(12, offset);
          const hasMore = Boolean(rows.hasMore);
          const nextOffset = typeof rows.nextOffset === 'number' ? rows.nextOffset : offset + rows.length;
          return reply(
            event.replyToken,
            buildSessionsFlex(formatEvents(rows), subject, { limit: 12, offset, hasMore, nextOffset })
          );
        }

        if (action === 'transfer_email') {
          const ticketId = Number(params.get('ticket') || 0);
          if (!ticketId) return reply(event.replyToken, { type: 'text', text: '找不到票券資料。' });
          if (!linkedUserId) {
            return reply(event.replyToken, { type: 'text', text: '請先綁定網站帳號後再轉贈票券。輸入「綁定」取得連結。' });
          }
          const [rows] = await pool.query('SELECT id, type FROM tickets WHERE id = ? AND user_id = ? LIMIT 1', [ticketId, linkedUserId]);
          if (!rows.length) return reply(event.replyToken, { type: 'text', text: '找不到可轉贈的票券。' });
          setPendingAction(subject, { type: 'transfer_email', ticketId });
          return reply(event.replyToken, { type: 'text', text: `請輸入 Email 轉贈「${rows[0].type || '票券'}」，或輸入「取消」結束。` });
        }

        if (action === 'transfer_qr') {
          const ticketId = Number(params.get('ticket') || 0);
          if (!ticketId) return reply(event.replyToken, { type: 'text', text: '找不到票券資料。' });
          if (!linkedUserId) {
            return reply(event.replyToken, { type: 'text', text: '請先綁定網站帳號後再轉贈票券。輸入「綁定」取得連結。' });
          }
          const result = await initiateTransferQr({ fromUserId: linkedUserId, ticketId });
          if (result.ok) {
            return reply(event.replyToken, buildTransferQrFlex(result.data.code, result.data.ticketType));
          }
          if (result.code === 'TRANSFER_EXISTS') {
            setPendingAction(subject, { type: 'confirm_retry_transfer', ticketId, mode: 'qr' });
            return reply(event.replyToken, { type: 'text', text: '已有待處理的轉贈。輸入「是」取消舊轉贈並重新產生 QR，或輸入「取消」。' });
          }
          return reply(event.replyToken, { type: 'text', text: result.message || '產生 QR 失敗，請稍後再試。' });
        }

        if (action === 'transfer_accept') {
          const transferId = Number(params.get('id') || 0);
          if (!transferId) return reply(event.replyToken, { type: 'text', text: '找不到轉贈資訊。' });
          if (!linkedUserId) {
            return reply(event.replyToken, { type: 'text', text: '請先綁定網站帳號後再接受轉贈。輸入「綁定」取得連結。' });
          }
          const result = await acceptTransferById({ transferId, recipientId: linkedUserId });
          if (result.ok) {
            return reply(event.replyToken, {
              type: 'text',
              text: '已接受轉贈，票券已加入您的錢包。',
              ...quickReply([qrItemMessage('查看票券', '我的票券')]),
            });
          }
          return reply(event.replyToken, { type: 'text', text: result.message || '接受失敗，請稍後再試。' });
        }

        if (action === 'transfer_decline') {
          const transferId = Number(params.get('id') || 0);
          if (!transferId) return reply(event.replyToken, { type: 'text', text: '找不到轉贈資訊。' });
          if (!linkedUserId) {
            return reply(event.replyToken, { type: 'text', text: '請先綁定網站帳號後再操作。' });
          }
          const result = await declineTransferById({ transferId, recipientId: linkedUserId });
          if (result.ok) {
            return reply(event.replyToken, { type: 'text', text: '已拒絕轉贈。' });
          }
          return reply(event.replyToken, { type: 'text', text: result.message || '拒絕失敗，請稍後再試。' });
        }
      } catch (_) {
        // ignore
      }
      return reply(event.replyToken, flex('已收到', bubbleBase({ title: '已收到', bodyContents: [textComponent('操作已處理')] })));
    }
  } catch (e) {
    console.error('handleEvent error:', e?.message || e);
  }
}

// ==== HTTP server ====
const server = http.createServer(async (req, res) => {
  let parsedUrl;
  try {
    parsedUrl = new URL(req.url || '/', `http://localhost:${PORT}`);
  } catch (_) {
    parsedUrl = new URL('/', `http://localhost:${PORT}`);
  }

  // Health check
  if (req.method === 'GET' && (parsedUrl.pathname === '/' || parsedUrl.pathname.startsWith('/healthz'))) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'line-bot', time: Date.now() }));
    return;
  }

  if (!parsedUrl.pathname.startsWith('/webhook')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, message: 'Not found' }));
    return;
  }

  // Accept GET/HEAD/OPTIONS on webhook endpoint for diagnostics and platform probes
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, method: req.method }));
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, message: 'Method Not Allowed' }));
    return;
  }

  // Read raw body
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const raw = Buffer.concat(chunks);
    const signature = req.headers['x-line-signature'] || '';
    if (!verifySignature(String(signature), raw)) {
      // Return 200 to satisfy platform probe; log and ignore events
      try { console.warn('LINE webhook: invalid signature'); } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ignored: true }));
      return;
    }
    let body;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: 'Bad JSON' }));
      return;
    }
    const events = Array.isArray(body?.events) ? body.events : [];
    // Respond 200 ASAP, and process asynchronously
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    // Process events sequentially
    for (const ev of events) {
      await handleEvent(ev);
    }
  });
});

server.listen(PORT, () => {
  console.log(`LINE bot server listening on :${PORT}`);
});
