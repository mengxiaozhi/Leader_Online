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
require('dotenv').config();

const app = express();

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

/** ======== Email 相關（驗證信） ======== */
const REQUIRE_EMAIL_VERIFICATION = (process.env.REQUIRE_EMAIL_VERIFICATION || '0') === '1';
const RESTRICT_EMAIL_DOMAIN_TO_EDU_TW = (process.env.RESTRICT_EMAIL_DOMAIN_TO_EDU_TW || '0') === '1';
const PUBLIC_API_BASE = process.env.PUBLIC_API_BASE || '';
const PUBLIC_WEB_URL = process.env.PUBLIC_WEB_URL || 'http://localhost:5173';
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'Leader Online';
const EMAIL_USER = process.env.EMAIL_USER || '';
const EMAIL_PASS = process.env.EMAIL_PASS || '';
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

async function sendReservationStatusEmail({ to, eventTitle, store, statusZh }){
  if (!mailerReady) return { mailed: false, reason: 'mailer_not_ready' };
  const email = String(to || '').trim();
  if (!email) return { mailed: false, reason: 'no_email' };
  const title = String(eventTitle || '預約');
  const storeName = String(store || '門市');
  const zh = String(statusZh || '狀態更新');
  const web = (process.env.PUBLIC_WEB_URL || 'http://localhost:5173').replace(/\/$/, '');
  const walletUrl = `${web}/wallet?tab=reservations`;
  try{
    await transporter.sendMail({
      from: `${EMAIL_FROM_NAME} <${EMAIL_USER}>`,
      to: email,
      subject: `預約狀態更新：${title} - ${zh}`,
      html: `
        <p>您好，您的預約狀態已更新：</p>
        <ul>
          <li><strong>活動：</strong>${title}</li>
          <li><strong>門市：</strong>${storeName}</li>
          <li><strong>狀態：</strong>${zh}</li>
        </ul>
        <p>您可前往錢包查看預約詳情與進度：</p>
        <p><a href="${walletUrl}">${walletUrl}</a></p>
        <p style="color:#888; font-size:12px;">此信件由系統自動發送，請勿直接回覆。</p>
      `,
    });
    return { mailed: true };
  } catch (e) {
    console.error('sendReservationStatusEmail error:', e?.message || e);
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
          try { resolve(buf ? JSON.parse(buf) : {}) } catch(e){ resolve({}) }
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
    if (!LINE_BOT_CHANNEL_ACCESS_TOKEN || !toUserId) return;
    const body = { to: toUserId, messages: Array.isArray(messages) ? messages : [messages] };
    await httpsPostJson('https://api.line.me/v2/bot/message/push', body, {
      Authorization: `Bearer ${LINE_BOT_CHANNEL_ACCESS_TOKEN}`,
    });
  } catch (_) { /* ignore push errors */ }
}

async function getLineSubjectByUserId(userId) {
  try {
    await ensureOAuthIdentitiesTable();
    const [rows] = await pool.query('SELECT subject FROM oauth_identities WHERE user_id = ? AND provider = ? LIMIT 1', [userId, 'line']);
    return rows.length ? String(rows[0].subject) : null;
  } catch (_) { return null }
}

async function notifyLineByUserId(userId, textOrMessages) {
  try {
    const to = await getLineSubjectByUserId(userId);
    if (!to) return;
    if (typeof textOrMessages === 'string') {
      await linePush(to, { type: 'text', text: textOrMessages });
    } else {
      await linePush(to, textOrMessages);
    }
  } catch (_) {}
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
    // 5 minutes window
    if (Math.abs(now - ts) > 5 * 60 * 1000) return res.status(400).send('Link expired');
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
    const webBase = PUBLIC_WEB_URL.replace(/\/$/, '');
    const nextPath = (redirect && String(redirect).startsWith('/')) ? String(redirect) : '/store';
    const target = `${webBase}/login?redirect=${encodeURIComponent(nextPath)}#token=${encodeURIComponent(token)}`;
    return res.redirect(302, target);
  } catch (err) {
    return res.status(500).send('Magic link error');
  }
});

// ======== Flex message builders (LINE push) ========
function flex(altText, bubble){ return { type: 'flex', altText, contents: bubble } }
function flexText(text, opts = {}){ return { type: 'text', text: String(text), wrap: true, size: opts.size || 'sm' } }
function flexButtonUri(label, uri, color = '#06c755', style = 'primary'){
  return { type: 'button', style, color, action: { type: 'uri', label, uri } }
}
function flexButtonMsg(label, text){ return { type: 'button', style: 'link', action: { type: 'message', label, text } } }
function flexBubble({ title, lines = [], footer = [] }){
  const bubble = { type: 'bubble', body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [] } };
  if (title) bubble.header = { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: String(title), weight: 'bold', size: 'md' }] };
  bubble.body.contents = Array.isArray(lines) ? lines : [flexText(String(lines||''))];
  if (footer && footer.length) bubble.footer = { type: 'box', layout: 'vertical', spacing: 'sm', contents: footer };
  return bubble;
}

function buildOrderCreatedFlex(codes = []){
  const arr = Array.isArray(codes) ? codes.filter(Boolean) : [];
  const lines = arr.length ? arr.map(c => flexText(`#${c}`)) : [flexText('已建立訂單。')];
  return flex('訂單建立成功', flexBubble({ title: '訂單建立成功', lines }));
}
function buildOrderDoneFlex(code){
  const lines = [flexText(`您的訂單 ${code || ''} 已完成。`)]
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

function isADMIN(role){ return String(role).toUpperCase() === 'ADMIN' || role === 'admin' }
function isSTORE(role){ return role === 'STORE' }
function adminOnly(req, res, next){
  authRequired(req, res, () => {
    if (!isADMIN(req.user?.role)) return fail(res, 'FORBIDDEN', '需要管理員權限', 403);
    next();
  })
}
function staffRequired(req, res, next){
  authRequired(req, res, () => {
    if (!isADMIN(req.user?.role) && !isSTORE(req.user?.role)) return fail(res, 'FORBIDDEN', '需要後台權限', 403);
    next();
  })
}

function safeParseJSON(v, fallback = {}) {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

function formatDateYYYYMMDD(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
          const tokenExpiry = Date.now() + 60 * 60 * 1000; // 1 小時
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
            const tokenExpiry = Date.now() + 60 * 60 * 1000; // 1 小時
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
      from: `${EMAIL_FROM_NAME} <${EMAIL_USER}>`,
      to: email,
      subject: 'Email 驗證 - Leader Online',
      html: `
        <p>您好，請點擊以下連結驗證您的 Email：</p>
        <p><a href="${confirmHref}">${confirmHref}</a></p>
        <p>此連結三天內有效。若非您本人申請，請忽略本郵件。</p>
      `,
    });

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
      const tokenExpiry = Date.now() + 60 * 60 * 1000; // 1 小時
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
    const tokenExpiry = Date.now() + 60 * 60 * 1000; // 1 小時
    await pool.query('INSERT INTO password_resets (user_id, email, token, token_expiry, used) VALUES (?, ?, ?, ?, 0)', [u.id, u.email, token, tokenExpiry]);

    if (!mailerReady) return ok(res, { mailed: false }, '已建立重設記錄，但郵件服務未設定');
    const link = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/login?reset_token=${token}`;
    await transporter.sendMail({
      from: `${EMAIL_FROM_NAME} <${EMAIL_USER}>`,
      to: u.email,
      subject: '重設密碼 - Leader Online',
      html: `
        <p>您好，您或他人請求重設此 Email 對應的帳號密碼。</p>
        <p>若是您本人，請點擊以下連結在 1 小時內完成重設：</p>
        <p><a href="${link}">${link}</a></p>
        <p>若非您本人操作，請忽略此郵件。</p>
      `,
    });
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
    const tokenExpiry = Date.now() + 60 * 60 * 1000; // 1 小時
    await pool.query('INSERT INTO password_resets (user_id, email, token, token_expiry, used) VALUES (?, ?, ?, ?, 0)', [u.id, u.email, token, tokenExpiry]);

    if (!mailerReady) return ok(res, { mailed: false }, '已建立重設記錄，但郵件服務未設定');
    const link = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/login?reset_token=${token}`;
    await transporter.sendMail({
      from: `${EMAIL_FROM_NAME} <${EMAIL_USER}>`,
      to: u.email,
      subject: '確認修改密碼 - Leader Online',
      html: `
        <p>您好，您正在要求修改密碼。</p>
        <p>請點擊以下連結在 1 小時內完成變更密碼：</p>
        <p><a href="${link}">${link}</a></p>
        <p>若非您本人操作，請忽略此郵件。</p>
      `,
    });
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
    // 嘗試抓 role + password_hash；若 role 欄位不存在則退回無 role 的查詢
    let rows;
    try {
      [rows] = await pool.query(
        'SELECT id, username, email, role, password_hash FROM users WHERE email = ? LIMIT 1',
        [email]
      );
    } catch (e) {
      if (e?.code === 'ER_BAD_FIELD_ERROR') {
        [rows] = await pool.query(
          'SELECT id, username, email, password_hash FROM users WHERE email = ? LIMIT 1',
          [email]
        );
      } else {
        throw e;
      }
    }
    if (!rows.length) return fail(res, 'AUTH_INVALID_CREDENTIALS', '帳號或密碼錯誤', 401);

    const user = rows[0];
    const match = user.password_hash ? await bcrypt.compare(password, user.password_hash) : false;
    if (!match) return fail(res, 'AUTH_INVALID_CREDENTIALS', '帳號或密碼錯誤', 401);

    const token = signToken({ id: user.id, email: user.email, username: user.username, role: (user.role || 'USER') });
    setAuthCookie(res, token);

    return ok(res, { id: user.id, email: user.email, username: user.username, role: user.role || 'user', token }, '登入成功');
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
    const [rows] = await pool.query('SELECT id, username, email, role FROM users WHERE id = ? LIMIT 1', [req.user.id]);
    if (rows.length){
      const u = rows[0];
      const raw = String(u.role || req.user.role || 'USER').toUpperCase();
      const role = (raw === 'ADMIN' || raw === 'STORE') ? raw : 'USER';
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
      return ok(res, { id: u.id, email: u.email, username: u.username, role, providers }, 'OK');
    }
    // 找不到使用者時仍回傳現有資訊（無 providers）
    const role = String(req.user.role || 'USER').toUpperCase();
    return ok(res, { id: req.user.id, email: req.user.email, username: req.user.username, role, providers: [] }, 'OK');
  } catch (e){
    const role = String(req.user.role || 'USER').toUpperCase();
    return ok(res, { id: req.user.id, email: req.user.email, username: req.user.username, role, providers: [] }, 'OK');
  }
});

/** ======== Admin：Users ======== */
app.get('/admin/users', adminOnly, async (req, res) => {
  try {
    try {
      const [rows] = await pool.query('SELECT id, username, email, role, created_at FROM users ORDER BY id DESC');
      return ok(res, rows);
    } catch (e) {
      if (e?.code === 'ER_BAD_FIELD_ERROR') {
        const [rows2] = await pool.query('SELECT id, username, email, created_at FROM users ORDER BY id DESC');
        return ok(res, rows2.map(u => ({ ...u, role: 'user' })));
      }
      throw e;
    }
  } catch (err) {
    return fail(res, 'ADMIN_USERS_LIST_FAIL', err.message, 500);
  }
});

app.patch('/admin/users/:id/role', adminOnly, async (req, res) => {
  const { role } = req.body || {};
  const norm = String(role || '').toUpperCase();
  if (!['USER', 'ADMIN', 'STORE'].includes(norm)) return fail(res, 'VALIDATION_ERROR', 'role 必須為 USER / ADMIN / STORE', 400);
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
    const [rows] = await pool.query('SELECT id, username, email, role, created_at FROM users WHERE id = ? LIMIT 1', [req.user.id]);
    if (!rows.length) return fail(res, 'USER_NOT_FOUND', '找不到使用者', 404);
    const u = rows[0];
    const role = String(u.role || req.user.role || 'USER').toUpperCase();
    // 讀取 providers（正規化）
    let providers = [];
    try {
      const [pr] = await pool.query('SELECT TRIM(LOWER(provider)) AS provider FROM oauth_identities WHERE user_id = ?', [u.id]);
      providers = Array.from(new Set(pr.map(r => String(r.provider || '').trim().toLowerCase()).filter(Boolean)));
    } catch (_) { providers = [] }
    return ok(res, { id: u.id, username: u.username, email: u.email, role, created_at: u.created_at, providers });
  } catch (err) {
    return fail(res, 'ME_READ_FAIL', err.message, 500);
  }
});

// Update my username/email（Email 改為「驗證後才生效」）
const SelfUpdateSchema = z.object({ username: z.string().min(2).max(50).optional(), email: z.string().email().optional() });
app.patch('/me', authRequired, async (req, res) => {
  const parsed = SelfUpdateSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  const fields = parsed.data;
  if (!Object.keys(fields).length) return ok(res, null, '無更新');
  try {
    // 讀取目前資料以判斷 Email 是否變更
    const [curRows] = await pool.query('SELECT id, email, username, role FROM users WHERE id = ? LIMIT 1', [req.user.id]);
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
            from: `${EMAIL_FROM_NAME} <${EMAIL_USER}>`,
            to: fields.email,
            subject: 'Email 變更確認 - Leader Online',
            html: `
              <p>您好，您提出變更登入 Email 的請求，請點擊以下連結確認：</p>
              <p><a href="${confirmHref}">${confirmHref}</a></p>
              <p>此連結三天內有效。若非您本人操作，請忽略本郵件。</p>
            `,
          });
          mailed = true;
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
    const [uRows] = await pool.query('SELECT id, username, email, password_hash, created_at, updated_at FROM users WHERE id = ? LIMIT 1', [req.user.id]);
    if (!uRows.length) return fail(res, 'NOT_FOUND', '找不到帳號', 404);
    const u = uRows[0];
    const match = u.password_hash ? await bcrypt.compare(currentPassword, u.password_hash) : false;
    if (!match) return fail(res, 'AUTH_INVALID_CREDENTIALS', '目前密碼不正確', 400);

    // Collect related data
    const [tickets] = await pool.query('SELECT id, uuid, type, discount, used, expiry, created_at FROM tickets WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
    const [orders] = await pool.query('SELECT id, code, details, created_at FROM orders WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
    const [reservations] = await pool.query('SELECT id, ticket_type, store, event, reserved_at, verify_code, verify_code_pre_dropoff, verify_code_pre_pickup, verify_code_post_dropoff, verify_code_post_pickup, status FROM reservations WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
    const [transfersOut] = await pool.query('SELECT id, ticket_id, from_user_id, to_user_id, to_user_email, code, status, created_at, updated_at FROM ticket_transfers WHERE from_user_id = ? ORDER BY id DESC', [req.user.id]);
    const [transfersIn] = await pool.query('SELECT id, ticket_id, from_user_id, to_user_id, to_user_email, code, status, created_at, updated_at FROM ticket_transfers WHERE to_user_id = ? ORDER BY id DESC', [req.user.id]);
    try { await ensureTicketLogsTable() } catch (_) {}
    let logs = [];
    try {
      const [logRows] = await pool.query('SELECT id, ticket_id, user_id, action, meta, created_at FROM ticket_logs WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
      logs = logRows.map(r => ({ id: r.id, ticket_id: r.ticket_id, action: r.action, meta: safeParseJSON(r.meta, {}), created_at: r.created_at }));
    } catch (_) { logs = [] }

    const user = { id: u.id, username: u.username, email: u.email, created_at: u.created_at, updated_at: u.updated_at };
    return ok(res, { user, tickets, orders, reservations, transfers: { out: transfersOut, in: transfersIn }, logs }, 'EXPORT_OK');
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
            from: `${EMAIL_FROM_NAME} <${EMAIL_USER}>`,
            to: fields.email,
            subject: 'Email 變更確認 - Leader Online',
            html: `
              <p>您好，管理員為您的帳號設定了新的 Email，請點擊以下連結確認此變更：</p>
              <p><a href="${confirmHref}">${confirmHref}</a></p>
              <p>此連結三天內有效。若非您本人操作，請忽略本郵件。</p>
            `,
          });
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

app.post('/admin/products', adminOnly, async (req, res) => {
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

app.patch('/admin/products/:id', adminOnly, async (req, res) => {
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

app.delete('/admin/products/:id', adminOnly, async (req, res) => {
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
    // 避免傳回 BLOB，明確排除 cover_data
    const [rows] = await pool.query('SELECT id, code, title, starts_at, ends_at, deadline, location, description, cover, cover_type, rules, created_at, updated_at FROM events');
    const list = rows.map(r => ({
      ...r,
      code: r.code || `EV${String(r.id).padStart(6, '0')}`,
    }));
    return ok(res, list);
  } catch (err) {
    return fail(res, 'EVENTS_LIST_FAIL', err.message, 500);
  }
});

app.get('/events/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!rows.length) return fail(res, 'EVENT_NOT_FOUND', '找不到活動', 404);
    const e = rows[0];
    // 避免返回巨大 BLOB，隱藏 cover_data
    if (e.cover_data) delete e.cover_data;
    if (!e.code) e.code = `EV${String(e.id).padStart(6, '0')}`;
    return ok(res, e);
  } catch (err) {
    return fail(res, 'EVENT_READ_FAIL', err.message, 500);
  }
});

// Admin Events list (ADMIN: all, STORE: owned only)
app.get('/admin/events', staffRequired, async (req, res) => {
  try {
    if (isADMIN(req.user.role)) {
      const [rows] = await pool.query('SELECT id, code, title, starts_at, ends_at, deadline, location, description, cover, cover_type, rules, owner_user_id, created_at, updated_at FROM events ORDER BY id DESC');
      const list = rows.map(r => ({ ...r, code: r.code || `EV${String(r.id).padStart(6, '0')}` }));
      return ok(res, list);
    } else {
      const [rows] = await pool.query('SELECT id, code, title, starts_at, ends_at, deadline, location, description, cover, cover_type, rules, owner_user_id, created_at, updated_at FROM events WHERE owner_user_id = ? ORDER BY id DESC', [req.user.id]);
      const list = rows.map(r => ({ ...r, code: r.code || `EV${String(r.id).padStart(6, '0')}` }));
      return ok(res, list);
    }
  } catch (err) {
    return fail(res, 'ADMIN_EVENTS_LIST_FAIL', err.message, 500);
  }
});

// Event Stores (public list)
app.get('/events/:id/stores', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, event_id, name, pre_start, pre_end, post_start, post_end, prices, created_at, updated_at FROM event_stores WHERE event_id = ? ORDER BY id ASC',
      [req.params.id]
    );
    const list = rows.map(r => ({
      id: r.id,
      event_id: r.event_id,
      name: r.name,
      pre_start: r.pre_start,
      pre_end: r.pre_end,
      post_start: r.post_start,
      post_end: r.post_end,
      prices: safeParseJSON(r.prices, {}),
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
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

app.post('/admin/events', staffRequired, async (req, res) => {
  const parsed = EventCreateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  let { code, title, starts_at, ends_at, deadline, location, description, cover, rules } = parsed.data;
  const ownerId = isADMIN(req.user.role) ? (req.body?.ownerId || null) : req.user.id;
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
    return ok(res, { id: r.insertId }, '活動已新增');
  } catch (err) {
    return fail(res, 'ADMIN_EVENT_CREATE_FAIL', err.message, 500);
  }
});

app.patch('/admin/events/:id', staffRequired, async (req, res) => {
  if (isSTORE(req.user.role)){
    const [e] = await pool.query('SELECT owner_user_id FROM events WHERE id = ? LIMIT 1', [req.params.id]);
    if (!e.length) return fail(res, 'EVENT_NOT_FOUND', '找不到活動', 404);
    if (String(e[0].owner_user_id || '') !== String(req.user.id)) return fail(res, 'FORBIDDEN', '無權限操作此活動', 403);
  }
  const parsed = EventUpdateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  const fields = parsed.data;
  if (fields.rules !== undefined) fields.rules = normalizeRules(fields.rules);
  if (!isADMIN(req.user.role)) delete fields.owner_user_id;
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
    return ok(res, null, '活動已更新');
  } catch (err) {
    return fail(res, 'ADMIN_EVENT_UPDATE_FAIL', err.message, 500);
  }
});

// Admin: delete event cover (both url and blob)
app.delete('/admin/events/:id/cover', staffRequired, async (req, res) => {
  if (isSTORE(req.user.role)){
    const [e] = await pool.query('SELECT owner_user_id FROM events WHERE id = ? LIMIT 1', [req.params.id]);
    if (!e.length) return fail(res, 'EVENT_NOT_FOUND', '找不到活動', 404);
    if (String(e[0].owner_user_id || '') !== String(req.user.id)) return fail(res, 'FORBIDDEN', '無權限操作此活動', 403);
  }
  try {
    const [r] = await pool.query('UPDATE events SET cover = NULL, cover_type = NULL, cover_data = NULL WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return fail(res, 'EVENT_NOT_FOUND', '找不到活動', 404);
    return ok(res, null, '封面已刪除');
  } catch (err) {
    return fail(res, 'ADMIN_EVENT_COVER_DELETE_FAIL', err.message, 500);
  }
});

// Admin: upload event cover as base64 JSON
app.post('/admin/events/:id/cover_json', staffRequired, async (req, res) => {
  const { dataUrl, mime, base64 } = req.body || {};
  let contentType = null;
  let buffer = null;
  try {
    if (isSTORE(req.user.role)){
      const [e] = await pool.query('SELECT owner_user_id FROM events WHERE id = ? LIMIT 1', [req.params.id]);
      if (!e.length) return fail(res, 'EVENT_NOT_FOUND', '找不到活動', 404);
      if (String(e[0].owner_user_id || '') !== String(req.user.id)) return fail(res, 'FORBIDDEN', '無權限操作此活動', 403);
    }
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

    const [r] = await pool.query('UPDATE events SET cover_type = ?, cover_data = ? WHERE id = ?', [contentType, buffer, req.params.id]);
    if (!r.affectedRows) return fail(res, 'EVENT_NOT_FOUND', '找不到活動', 404);
    return ok(res, { id: Number(req.params.id), size: buffer.length, type: contentType }, '封面已更新');
  } catch (err) {
    return fail(res, 'ADMIN_EVENT_COVER_UPLOAD_FAIL', err.message, 500);
  }
});

// Public: serve event cover
app.get('/events/:id/cover', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT cover, cover_type, cover_data, updated_at FROM events WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows.length) return res.status(404).end();
    const e = rows[0];
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

app.delete('/admin/events/:id', staffRequired, async (req, res) => {
  if (isSTORE(req.user.role)){
    const [e] = await pool.query('SELECT owner_user_id FROM events WHERE id = ? LIMIT 1', [req.params.id]);
    if (!e.length) return fail(res, 'EVENT_NOT_FOUND', '找不到活動', 404);
    if (String(e[0].owner_user_id || '') !== String(req.user.id)) return fail(res, 'FORBIDDEN', '無權限操作此活動', 403);
  }
  try {
    const [r] = await pool.query('DELETE FROM events WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return fail(res, 'EVENT_NOT_FOUND', '找不到活動', 404);
    return ok(res, null, '活動已刪除');
  } catch (err) {
    return fail(res, 'ADMIN_EVENT_DELETE_FAIL', err.message, 500);
  }
});

// Admin Event Stores CRUD
const PricesSchema = z.record(z.string().min(1), z.object({ normal: z.number().nonnegative(), early: z.number().nonnegative() }));
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

app.get('/admin/store_templates', staffRequired, async (req, res) => {
  try {
    await ensureStoreTemplatesTable();
    const [rows] = await pool.query('SELECT * FROM store_templates ORDER BY id DESC');
    const list = rows.map(r => ({ ...r, prices: safeParseJSON(r.prices, {}) }));
    return ok(res, list);
  } catch (err) {
    return fail(res, 'ADMIN_STORE_TEMPLATES_LIST_FAIL', err.message, 500);
  }
});

app.post('/admin/store_templates', staffRequired, async (req, res) => {
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

app.patch('/admin/store_templates/:id', staffRequired, async (req, res) => {
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

app.delete('/admin/store_templates/:id', staffRequired, async (req, res) => {
  try {
    await ensureStoreTemplatesTable();
    const [r] = await pool.query('DELETE FROM store_templates WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return fail(res, 'STORE_TEMPLATE_NOT_FOUND', '找不到模板', 404);
    return ok(res, null, '模板已刪除');
  } catch (err) {
    return fail(res, 'ADMIN_STORE_TEMPLATE_DELETE_FAIL', err.message, 500);
  }
});

app.get('/admin/events/:id/stores', staffRequired, async (req, res) => {
  try {
    if (isSTORE(req.user.role)){
      const [e] = await pool.query('SELECT owner_user_id FROM events WHERE id = ? LIMIT 1', [req.params.id]);
      if (!e.length) return fail(res, 'EVENT_NOT_FOUND', '找不到活動', 404);
      if (String(e[0].owner_user_id || '') !== String(req.user.id)) return fail(res, 'FORBIDDEN', '無權限操作此活動', 403);
    }
    const [rows] = await pool.query('SELECT * FROM event_stores WHERE event_id = ? ORDER BY id ASC', [req.params.id]);
    const list = rows.map(r => ({ ...r, prices: safeParseJSON(r.prices, {}) }));
    return ok(res, list);
  } catch (err) {
    return fail(res, 'ADMIN_EVENT_STORES_LIST_FAIL', err.message, 500);
  }
});

app.post('/admin/events/:id/stores', staffRequired, async (req, res) => {
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
    return ok(res, { id: r.insertId }, '店面已新增');
  } catch (err) {
    return fail(res, 'ADMIN_EVENT_STORE_CREATE_FAIL', err.message, 500);
  }
});

app.patch('/admin/events/stores/:storeId', staffRequired, async (req, res) => {
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
  try {
    if (isSTORE(req.user.role)){
      const [r0] = await pool.query('SELECT e.owner_user_id FROM event_stores s JOIN events e ON e.id = s.event_id WHERE s.id = ? LIMIT 1', [req.params.storeId]);
      if (!r0.length) return fail(res, 'STORE_NOT_FOUND', '找不到店面', 404);
      if (String(r0[0].owner_user_id || '') !== String(req.user.id)) return fail(res, 'FORBIDDEN', '無權限操作此活動', 403);
    }
    const [r] = await pool.query(`UPDATE event_stores SET ${sets.join(', ')} WHERE id = ?`, values);
    if (!r.affectedRows) return fail(res, 'STORE_NOT_FOUND', '找不到店面', 404);
    return ok(res, null, '店面已更新');
  } catch (err) {
    return fail(res, 'ADMIN_EVENT_STORE_UPDATE_FAIL', err.message, 500);
  }
});

app.delete('/admin/events/stores/:storeId', staffRequired, async (req, res) => {
  try {
    if (isSTORE(req.user.role)){
      const [r0] = await pool.query('SELECT e.owner_user_id FROM event_stores s JOIN events e ON e.id = s.event_id WHERE s.id = ? LIMIT 1', [req.params.storeId]);
      if (!r0.length) return fail(res, 'STORE_NOT_FOUND', '找不到店面', 404);
      if (String(r0[0].owner_user_id || '') !== String(req.user.id)) return fail(res, 'FORBIDDEN', '無權限操作此活動', 403);
    }
    const [r] = await pool.query('DELETE FROM event_stores WHERE id = ?', [req.params.storeId]);
    if (!r.affectedRows) return fail(res, 'STORE_NOT_FOUND', '找不到店面', 404);
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
          from: `${EMAIL_FROM_NAME} <${EMAIL_USER}>`,
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

// Admin Tickets: list distinct types with cover status
app.get('/admin/tickets/types', adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT DISTINCT t.type AS type FROM tickets t WHERE t.type IS NOT NULL AND t.type <> "" ORDER BY t.type ASC'
    );
    const types = rows.map(r => r.type);
    if (!types.length) return ok(res, []);
    const placeholders = types.map(() => '?').join(',');
    const [covers] = await pool.query(`SELECT type, cover_url, cover_type, (cover_data IS NOT NULL) AS has_blob FROM ticket_covers WHERE type IN (${placeholders})`, types);
    const coverMap = new Map();
    for (const c of covers) coverMap.set(c.type, { cover_url: c.cover_url, cover_type: c.cover_type, has_blob: !!c.has_blob });
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
    await pool.query(
      'INSERT INTO ticket_covers (type, cover_url, cover_type, cover_data) VALUES (?, NULL, ?, ?) ON DUPLICATE KEY UPDATE cover_url = VALUES(cover_url), cover_type = VALUES(cover_type), cover_data = VALUES(cover_data)',
      [type, contentType, buffer]
    );
    return ok(res, { type, size: buffer.length, typeMime: contentType }, '票券封面已更新');
  } catch (err) {
    return fail(res, 'ADMIN_TICKET_COVER_UPLOAD_FAIL', err.message, 500);
  }
});

// Admin Tickets: delete cover for a type
app.delete('/admin/tickets/types/:type/cover', adminOnly, async (req, res) => {
  try {
    const type = req.params.type;
    const [r] = await pool.query('DELETE FROM ticket_covers WHERE type = ?', [type]);
    if (!r.affectedRows) return ok(res, null, '已刪除或不存在');
    return ok(res, null, '封面已刪除');
  } catch (err) {
    return fail(res, 'ADMIN_TICKET_COVER_DELETE_FAIL', err.message, 500);
  }
});

// Public: serve ticket cover by type
app.get('/tickets/cover/:type', async (req, res) => {
  try {
    const type = req.params.type;
    const [rows] = await pool.query('SELECT cover_url, cover_type, cover_data FROM ticket_covers WHERE type = ? LIMIT 1', [type]);
    if (!rows.length) return res.status(404).end();
    const row = rows[0];
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
    return ok(res, rows);
  } catch (err) {
    return fail(res, 'RESERVATIONS_LIST_FAIL', err.message, 500);
  }
});

app.post('/reservations', authRequired, async (req, res) => {
  const { ticketType, store, event } = req.body;
  if (!ticketType || !store || !event) return fail(res, 'VALIDATION_ERROR', '缺少必要欄位', 400);
  try {
    const [result] = await pool.query(
      'INSERT INTO reservations (user_id, ticket_type, store, event) VALUES (?, ?, ?, ?)',
      [req.user.id, ticketType, store, event]
    );
    return ok(res, { id: result.insertId }, '預約建立成功');
  } catch (err) {
    return fail(res, 'RESERVATION_CREATE_FAIL', err.message, 500);
  }
});

// Admin Reservations: list all
app.get('/admin/reservations', staffRequired, async (req, res) => {
  try {
    if (isADMIN(req.user.role)){
      const [rows] = await pool.query(
        'SELECT r.*, u.username, u.email FROM reservations r JOIN users u ON u.id = r.user_id ORDER BY r.id DESC'
      );
      return ok(res, rows);
    } else { // STORE: 僅能看到自己擁有活動的預約（用標題比對）
      const [rows] = await pool.query(
        'SELECT r.*, u.username, u.email FROM reservations r JOIN users u ON u.id = r.user_id JOIN events e ON e.title = r.event WHERE e.owner_user_id = ? ORDER BY r.id DESC',
        [req.user.id]
      );
      return ok(res, rows);
    }
  } catch (err) {
    return fail(res, 'ADMIN_RESERVATIONS_LIST_FAIL', err.message, 500);
  }
});

// Admin Reservations: update status (six-stage flow)
app.patch('/admin/reservations/:id/status', staffRequired, async (req, res) => {
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
    // 通知：LINE + Email（最佳努力）
    try {
      const zhLineMap = {
        service_booking: '建立預約',
        pre_dropoff: '等待前置交件',
        pre_pickup: '等待前置取件',
        post_dropoff: '等待後置交件',
        post_pickup: '等待後置取件',
        done: '已完成',
      };
      const zhLine = zhLineMap[status] || status;
      const title = String(cur.event || '預約');
      const store = String(cur.store || '門市');
      await notifyLineByUserId(cur.user_id, buildReservationStatusFlex(title, store, zhLine));
      // Email 使用「賽前交車/賽前取車/賽後交車/賽後取車/完成」等詞
      try {
        const [uRows] = await pool.query('SELECT email FROM users WHERE id = ? LIMIT 1', [cur.user_id]);
        const to = uRows?.[0]?.email || '';
        await sendReservationStatusEmail({ to, eventTitle: title, store, statusZh: zhReservationStatus(status) });
      } catch (_) {}
    } catch (_) {}
    return ok(res, resp, '預約狀態已更新');
  } catch (err) {
    return fail(res, 'ADMIN_RESERVATION_STATUS_FAIL', err.message, 500);
  }
});

// Staff scan QR: progress reservation to next stage by stage-specific code
app.post('/admin/reservations/progress_scan', staffRequired, async (req, res) => {
  const raw = (req.body?.code ?? '').toString().trim();
  if (!raw) return fail(res, 'VALIDATION_ERROR', '缺少驗證碼', 400);
  const code = raw.replace(/\s+/g, '');

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
    if (r.status !== stage) return fail(res, 'STATUS_NOT_MATCH', '預約不在此階段或已被處理', 409);

    const nextMap = {
      pre_dropoff: 'pre_pickup',
      pre_pickup: 'post_dropoff',
      post_dropoff: 'post_pickup',
      post_pickup: 'done',
    };
    const next = nextMap[stage] || null;
    if (!next) return fail(res, 'ALREADY_DONE', '已完成，無法再進入下一階段', 400);

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

    // 通知：LINE + Email（最佳努力）
    try {
      const map = {
        pre_dropoff: '等待前置交件',
        pre_pickup: '等待前置取件',
        post_dropoff: '等待後置交件',
        post_pickup: '等待後置取件',
        done: '已完成',
      };
      const zhLine = map[next] || next;
      await notifyLineByUserId(r.user_id, buildReservationProgressFlex(r.event || '預約', r.store || '門市', zhLine));
      try {
        const [uRows] = await pool.query('SELECT email FROM users WHERE id = ? LIMIT 1', [r.user_id]);
        const to = uRows?.[0]?.email || '';
        await sendReservationStatusEmail({ to, eventTitle: r.event || '預約', store: r.store || '門市', statusZh: zhReservationStatus(next) });
      } catch (_) {}
    } catch (_) {}

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
    return ok(res, rows);
  } catch (err) {
    return fail(res, 'ORDERS_LIST_FAIL', err.message, 500);
  }
});

app.post('/orders', authRequired, async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) return fail(res, 'VALIDATION_ERROR', '缺少 items', 400);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const created = [];
    for (const it of items) {
      const code = await generateOrderCode();
      const details = safeParseJSON(it, {});
      const total = Number(details.total || 0);
      // 狀態：0 元強制完成，否則沿用或預設待匯款
      details.status = (total <= 0 ? '已完成' : (details.status || '待匯款'));

      const [r] = await conn.query('INSERT INTO orders (user_id, code, details) VALUES (?, ?, ?)', [req.user.id, code, JSON.stringify(details)]);
      const orderId = r.insertId;
      created.push({ id: orderId, code });

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
          if (isReservationOrder && !details.reservations_granted) {
            const valuesRes = [];
            for (const sel of selections) {
              const qty = Number(sel.qty || sel.quantity || 0);
              const type = sel.type || sel.ticketType || '';
              const store = sel.store || '';
              for (let i = 0; i < qty; i++) valuesRes.push([req.user.id, type, store, eventName]);
            }
            if (valuesRes.length) {
              const [ins] = await conn.query('INSERT INTO reservations (user_id, ticket_type, store, event) VALUES ?;', [valuesRes]);
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

    await conn.commit();
    // LINE 通知（Flex，最佳努力）
    try {
      const codes = created.map(c => c.code).filter(Boolean);
      await notifyLineByUserId(req.user.id, buildOrderCreatedFlex(codes));
    } catch (_) {}
    return ok(res, created, '訂單建立成功');
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    return fail(res, 'ORDER_CREATE_FAIL', err.message, 500);
  } finally {
    conn.release();
  }
});

// Admin Orders
app.get('/admin/orders', staffRequired, async (req, res) => {
  try {
    if (isADMIN(req.user.role)){
      const [rows] = await pool.query(
        'SELECT o.id, o.code, o.details, o.created_at, u.id AS user_id, u.username, u.email FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.id DESC'
      );
      return ok(res, rows);
    } else {
      // STORE：僅能看到自己擁有活動的訂單（僅限 event-reservation 類型）
      const [rows] = await pool.query(
        `SELECT o.id, o.code, o.details, o.created_at, u.id AS user_id, u.username, u.email
         FROM orders o
         JOIN users u ON u.id = o.user_id
         JOIN events e ON e.id = CAST(JSON_UNQUOTE(JSON_EXTRACT(o.details, '$.event.id')) AS UNSIGNED)
         WHERE e.owner_user_id = ?
         ORDER BY o.id DESC`,
        [req.user.id]
      );
      return ok(res, rows);
    }
  } catch (err) {
    return fail(res, 'ADMIN_ORDERS_LIST_FAIL', err.message, 500);
  }
});

app.patch('/admin/orders/:id/status', staffRequired, async (req, res) => {
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
    const details = safeParseJSON(order.details, {});
    if (isSTORE(req.user.role)){
      const eventId = Number(details?.event?.id || 0);
      if (!eventId) { await conn.rollback(); return fail(res, 'FORBIDDEN', '僅能管理賽事預約訂單', 403); }
      const [own] = await conn.query('SELECT owner_user_id FROM events WHERE id = ? LIMIT 1', [eventId]);
      if (!own.length || String(own[0].owner_user_id || '') !== String(req.user.id)) { await conn.rollback(); return fail(res, 'FORBIDDEN', '無權限操作此訂單', 403); }
    }
    const prevStatus = details.status || '';

    // 更新 details.status
    details.status = status;
    await conn.query('UPDATE orders SET details = ? WHERE id = ?', [JSON.stringify(details), order.id]);

    // 若由非「已完成」狀態 → 「已完成」，進行發券、建立預約與標記已用票券（避免重複發放/重複標記）
    if (status === '已完成' && prevStatus !== '已完成') {
      // 判斷是否為「預約型」訂單（有 selections 即視為預約，不發券）
      const selections = Array.isArray(details.selections) ? details.selections : [];
      const isReservationOrder = selections.length > 0;

      // 發券（僅限非預約型的「票券型訂單」）
      if (!isReservationOrder) {
        const ticketType = details.ticketType || details?.event?.name || null;
        const quantity = Number(details.quantity || 0);
        if (!details.granted && ticketType && quantity > 0) {
          const today = new Date();
          const expiry = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());
          const expiryStr = formatDateYYYYMMDD(expiry);
          const values = [];
          for (let i = 0; i < quantity; i++) values.push([order.user_id, ticketType, expiryStr, randomUUID(), 0, 0]);
          if (values.length) {
            const [ins3] = await conn.query('INSERT INTO tickets (user_id, type, expiry, uuid, discount, used) VALUES ?;', [values]);
            // Log issuance per ticket
            try {
              const firstId = Number(ins3.insertId || 0);
              const count = Number(ins3.affectedRows || values.length);
              for (let i = 0; i < count; i++) {
                const tid = firstId ? (firstId + i) : null;
                if (tid) await logTicket({ conn, ticketId: tid, userId: order.user_id, action: 'issued', meta: { type: ticketType, order_id: order.id, order_code: order.code } });
              }
            } catch (_) { /* ignore */ }
            details.granted = true;
            await conn.query('UPDATE orders SET details = ? WHERE id = ?', [JSON.stringify(details), order.id]);
          }
        }
      }

      // 建立預約（針對含 selections 的預約型訂單）
      const eventName = details?.event?.name || details?.event || null;
      if (!details.reservations_granted && isReservationOrder) {
        const valuesRes = [];
        for (const sel of selections) {
          const qty = Number(sel.qty || sel.quantity || 0);
          const type = sel.type || sel.ticketType || '';
          const store = sel.store || '';
          for (let i = 0; i < qty; i++) valuesRes.push([order.user_id, type, store, eventName]);
        }
        if (valuesRes.length) {
          const [ins2] = await conn.query('INSERT INTO reservations (user_id, ticket_type, store, event) VALUES ?;', [valuesRes]);
          // Best-effort: seed pre_dropoff verification codes for newly created reservations
          try {
            const startId = Number(ins2.insertId || 0);
            const count = Number(ins2.affectedRows || 0);
            for (let i = 0; i < count; i++) {
              const id = startId + i;
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
    // 若已完成，推送 LINE Flex 通知
    try {
      if (status === '已完成') {
        await notifyLineByUserId(order.user_id, buildOrderDoneFlex(order.code));
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
