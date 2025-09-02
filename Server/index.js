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

    return ok(res, { id, username, email, role: 'USER', token }, '註冊成功，已自動登入');
  } catch (err) {
    return fail(res, 'USER_CREATE_FAIL', err.message, 500);
  }
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

app.patch('/tickets/:id/use', authRequired, async (req, res) => {
  try {
    const [result] = await pool.query(
      'UPDATE tickets SET used = 1 WHERE id = ? AND user_id = ? AND used = 0 AND (expiry IS NULL OR expiry >= CURRENT_DATE())',
      [req.params.id, req.user.id]
    );
    if (!result.affectedRows) return fail(res, 'TICKET_NOT_FOUND', '找不到可用的票券', 404);
    return ok(res, null, '票券已使用');
  } catch (err) {
    return fail(res, 'TICKET_USE_FAIL', err.message, 500);
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

  try {
    const [rows] = await pool.query('SELECT * FROM reservations WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows.length) return fail(res, 'RESERVATION_NOT_FOUND', '找不到預約', 404);
    const cur = rows[0];
    if (isSTORE(req.user.role)){
      const [own] = await pool.query('SELECT owner_user_id FROM events WHERE title = ? LIMIT 1', [cur.event]);
      if (!own.length || String(own[0].owner_user_id || '') !== String(req.user.id)) return fail(res, 'FORBIDDEN', '無權限操作此預約', 403);
    }

    let verifyCode = cur.verify_code;
    // 在交車節點（賽前交車、賽後交車）生成取車碼
    if ((status === 'pre_dropoff' || status === 'post_dropoff')) {
      // 產生 6 位數驗證碼（不保證全域唯一，但足夠使用）
      verifyCode = String(Math.floor(100000 + Math.random() * 900000));
    }

    await pool.query('UPDATE reservations SET status = ?, verify_code = COALESCE(?, verify_code) WHERE id = ?', [status, verifyCode || null, cur.id]);
    return ok(res, { id: cur.id, status, verify_code: verifyCode || cur.verify_code }, '預約狀態已更新');
  } catch (err) {
    return fail(res, 'ADMIN_RESERVATION_STATUS_FAIL', err.message, 500);
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
              if (values.length) await conn.query('INSERT INTO tickets (user_id, type, expiry, uuid, discount, used) VALUES ?;', [values]);
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
            if (valuesRes.length) await conn.query('INSERT INTO reservations (user_id, ticket_type, store, event) VALUES ?;', [valuesRes]);
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
            await conn.query('INSERT INTO tickets (user_id, type, expiry, uuid, discount, used) VALUES ?;', [values]);
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
          await conn.query('INSERT INTO reservations (user_id, ticket_type, store, event) VALUES ?;', [valuesRes]);
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
