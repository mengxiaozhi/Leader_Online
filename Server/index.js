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

/** ======== 反向代理（Secure Cookie 需要） ======== */
app.set('trust proxy', 1);

/** ======== 安全與中介層 ======== */
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json());
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

/** ======== Schema ======== */
const RegisterSchema = z.object({
  username: z.string().min(2).max(50),
  email: z.string().email(),
  password: z.string().min(8).max(100),
});
const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
});

/** ======== Debug ======== */
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

/** ======== Users（對齊：users.id=INT, password=VARCHAR） ======== */
app.get('/users', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, username, email, created_at FROM users ORDER BY id DESC'
    );
    return ok(res, rows);
  } catch (err) {
    return fail(res, 'USERS_LIST_FAIL', err.message, 500);
  }
});

app.post('/users', async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);

  const { username, email, password } = parsed.data;
  try {
    const [dup] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (dup.length) return fail(res, 'EMAIL_TAKEN', '此 Email 已被註冊', 409);

    const hash = await bcrypt.hash(password, 12);
    const [result] = await pool.query(
      'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
      [username, email, hash]
    );

    const id = result.insertId;
    const token = signToken({ id, email, username });
    setAuthCookie(res, token);

    return ok(res, { id, username, email, token }, '註冊成功，已自動登入');
  } catch (err) {
    return fail(res, 'USER_CREATE_FAIL', err.message, 500);
  }
});

app.post('/login', async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0].message, 400);

  const { email, password } = parsed.data;
  try {
    const [rows] = await pool.query(
      'SELECT id, username, email, password FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    if (!rows.length) return fail(res, 'AUTH_INVALID_CREDENTIALS', '帳號或密碼錯誤', 401);

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return fail(res, 'AUTH_INVALID_CREDENTIALS', '帳號或密碼錯誤', 401);

    const token = signToken({ id: user.id, email: user.email, username: user.username });
    setAuthCookie(res, token);
    return ok(res, { id: user.id, email: user.email, username: user.username, token }, '登入成功');
  } catch (err) {
    return fail(res, 'LOGIN_FAIL', err.message, 500);
  }
});

app.post('/logout', (req, res) => {
  res.clearCookie('auth_token', cookieOptions());
  return ok(res, null, '已登出');
});

app.get('/whoami', authRequired, (req, res) => ok(res, req.user, 'OK'));

/** ======== Products / Events ======== */
app.get('/products', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM products');
    return ok(res, rows);
  } catch (err) {
    return fail(res, 'PRODUCTS_LIST_FAIL', err.message, 500);
  }
});

app.get('/events', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM events');
    return ok(res, rows);
  } catch (err) {
    return fail(res, 'EVENTS_LIST_FAIL', err.message, 500);
  }
});

app.get('/events/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!rows.length) return fail(res, 'EVENT_NOT_FOUND', '找不到活動', 404);
    return ok(res, rows[0]);
  } catch (err) {
    return fail(res, 'EVENT_READ_FAIL', err.message, 500);
  }
});

/** ======== Tickets（優惠券） ======== */
app.get('/tickets/me', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, uuid, discount, used, expiry FROM tickets WHERE user_id = ?',
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
      'UPDATE tickets SET used = 1 WHERE id = ? AND user_id = ? AND used = 0',
      [req.params.id, req.user.id]
    );
    if (!result.affectedRows) return fail(res, 'TICKET_NOT_FOUND', '找不到可用的票券', 404);
    return ok(res, null, '票券已使用');
  } catch (err) {
    return fail(res, 'TICKET_USE_FAIL', err.message, 500);
  }
});

/** ======== Reservations ======== */
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

/** ======== Orders（隨機碼 code） ======== */
function randomCode(n = 10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
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

  try {
    if (items.length > 0) {
      const values = [];
      for (const it of items) {
        const code = await generateOrderCode();
        values.push([req.user.id, code, JSON.stringify(it)]);
      }
      await pool.query('INSERT INTO orders (user_id, code, details) VALUES ?', [values]);
    }
    return ok(res, null, '訂單建立成功');
  } catch (err) {
    return fail(res, 'ORDER_CREATE_FAIL', err.message, 500);
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