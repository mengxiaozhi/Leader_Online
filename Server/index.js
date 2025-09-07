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

    const back = `${PUBLIC_WEB_URL.replace(/\/$/, '')}/login`;
    return res.status(200).send(`
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, 'Apple Color Emoji', 'Segoe UI Emoji'; padding: 24px;">
        <h1>✅ 郵件驗證成功</h1>
        <p>請回到網站完成註冊或登入。</p>
        <p><a href="${back}">返回登入/註冊頁</a></p>
      </div>
    `);
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
      return ok(res, { id: u.id, email: u.email, username: u.username, role }, 'OK');
    }
    // 找不到使用者時仍回傳現有資訊
    const role = String(req.user.role || 'USER').toUpperCase();
    return ok(res, { id: req.user.id, email: req.user.email, username: req.user.username, role }, 'OK');
  } catch (e){
    const role = String(req.user.role || 'USER').toUpperCase();
    return ok(res, { id: req.user.id, email: req.user.email, username: req.user.username, role }, 'OK');
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
    return ok(res, { id: u.id, username: u.username, email: u.email, role, created_at: u.created_at });
  } catch (err) {
    return fail(res, 'ME_READ_FAIL', err.message, 500);
  }
});

// Update my username/email
const SelfUpdateSchema = z.object({ username: z.string().min(2).max(50).optional(), email: z.string().email().optional() });
app.patch('/me', authRequired, async (req, res) => {
  const parsed = SelfUpdateSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);
  const fields = parsed.data;
  if (!Object.keys(fields).length) return ok(res, null, '無更新');
  try {
    if (fields.email) {
      const [dup] = await pool.query('SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1', [fields.email, req.user.id]);
      if (dup.length) return fail(res, 'EMAIL_TAKEN', 'Email 已被使用', 409);
    }
    const sets = [];
    const values = [];
    for (const [k, v] of Object.entries(fields)) { sets.push(`${k} = ?`); values.push(v); }
    values.push(req.user.id);
    const [r] = await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, values);
    if (!r.affectedRows) return fail(res, 'USER_NOT_FOUND', '找不到使用者', 404);
    return ok(res, null, '已更新帳戶資料');
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
    if (fields.email) {
      const [dup] = await pool.query('SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1', [fields.email, req.params.id]);
      if (dup.length) return fail(res, 'EMAIL_TAKEN', 'Email 已被使用', 409);
    }
    const sets = [];
    const values = [];
    for (const [k, v] of Object.entries(fields)) { sets.push(`${k} = ?`); values.push(v); }
    values.push(req.params.id);
    const [r] = await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, values);
    if (!r.affectedRows) return fail(res, 'USER_NOT_FOUND', '找不到使用者', 404);
    return ok(res, null, '使用者資料已更新');
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
