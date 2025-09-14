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

// ==== Environment ====
const PORT = parseInt(process.env.LINE_BOT_PORT || process.env.PORT || '3021', 10);
const CHANNEL_SECRET = process.env.LINE_BOT_CHANNEL_SECRET || process.env.LINE_CHANNEL_SECRET || process.env.LINE_CLIENT_SECRET || '';
const CHANNEL_ACCESS_TOKEN = process.env.LINE_BOT_CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const MAGIC_LINK_SECRET = process.env.MAGIC_LINK_SECRET || process.env.LINK_SIGNING_SECRET || '';

const PUBLIC_API_BASE = (process.env.PUBLIC_API_BASE || '').replace(/\/$/, '');
const PUBLIC_WEB_URL = (process.env.PUBLIC_WEB_URL || 'http://localhost:5173').replace(/\/$/, '');
// Theme colors (align with Web/src/style.css)
const THEME_PRIMARY = (process.env.THEME_PRIMARY || process.env.WEB_THEME_PRIMARY || '#D90000');
const THEME_SECONDARY = (process.env.THEME_SECONDARY || process.env.WEB_THEME_SECONDARY || '#B00000');

if (!CHANNEL_SECRET || !CHANNEL_ACCESS_TOKEN) {
  console.warn('LINE bot is not fully configured. Please set LINE_BOT_CHANNEL_SECRET and LINE_BOT_CHANNEL_ACCESS_TOKEN');
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
        try {
          resolve(buf ? JSON.parse(buf) : {});
        } catch (e) {
          resolve({});
        }
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
    linked ? '· 我的訂單 · 我的票券 · 我的預約' : '綁定後可查詢訂單、票券與預約狀態',
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

function safeParseJSON(v){ try { return typeof v === 'string' ? JSON.parse(v) : (v || {}) } catch { return {} } }

function formatOrders(rows) {
  if (!rows.length) return [];
  return rows.map((r) => {
    const d = safeParseJSON(r.details);
    return ({
      code: r.code || String(r.id),
      created: r.created_at ? new Date(r.created_at).toLocaleString('zh-TW') : '',
      status: d.status || '處理中',
      total: Number(d.total || 0),
      ticketType: d.ticketType || (d?.event?.name || ''),
      quantity: Number(d.quantity || 0),
    })
  });
}

function formatTickets(rows) {
  if (!rows.length) return [];
  return rows.map((r) => ({
    id: r.uuid || String(r.id),
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

function flex(altText, contents) { return { type: 'flex', altText, contents } }
function flexCarousel(altText, bubbles) { return flex(altText, { type: 'carousel', contents: bubbles }) }

// Images and URLs
const DEFAULT_ICON = `${PUBLIC_WEB_URL}/icon.png`;
const API_BASE = PUBLIC_API_BASE || '';
function ticketCoverUrl(type){
  if (!type) return DEFAULT_ICON;
  if (API_BASE) return `${API_BASE}/tickets/cover/${encodeURIComponent(type)}`;
  return DEFAULT_ICON;
}
function normalizeCoverUrl(cover){
  if (!cover) return DEFAULT_ICON;
  try { new URL(cover); return cover } catch { return DEFAULT_ICON }
}

function buildHelpFlex(linked) {
  const title = 'Leader Online 幫助';
  const body = [ textComponent(helpText(linked)) ];
  const footer = linked
    ? [
        buttonMessage('商店', '商店'),
        buttonMessage('我的訂單', '我的訂單'),
        buttonMessage('我的票券', '我的票券'),
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
  const lines = [
    textComponent(`使用者 ID：${u?.id || '-'}`),
    textComponent(`名稱：${u?.username || '-'}`),
    textComponent(`Email：${u?.email || '-'}`),
    textComponent(`角色：${(u?.role || 'USER').toString().toUpperCase()}`),
    u?.created_at ? textComponent(`建立時間：${new Date(u.created_at).toLocaleString('zh-TW')}`) : null,
    providers.length ? textComponent(`綁定：${providers.join('、')}`) : null,
  ].filter(Boolean);
  const footer = [buttonUri('前往個人資料', magicLink('/account', lineSubject))];
  // 無圖片（不設定 heroUrl）
  return flex(title, bubbleBase({ title, bodyContents: [{ type: 'box', layout: 'vertical', spacing: 'xs', contents: lines }], footerButtons: footer }));
}

function buildOrdersFlex(list, lineSubject = '') {
  const title = '我的訂單';
  const body = list.length
    ? list.map((o) => ({ type: 'box', layout: 'vertical', spacing: 'xs', contents: [
        textComponent(`#${o.code}`, { size: 'md' }),
        textComponent(`狀態：${o.status}`),
        o.ticketType ? textComponent(`票券：${o.ticketType}`) : null,
        o.quantity ? textComponent(`數量：${o.quantity}`) : null,
        textComponent(`建立：${o.created}`),
        o.total ? textComponent(`總額：$${o.total}`) : null,
      ].filter(Boolean) }))
    : [textComponent('目前查無訂單紀錄。')];
  const footer = [buttonUri('前往訂單', magicLink('/order', lineSubject)), buttonMessage('商店', '商店')];
  return flex(title, bubbleBase({ title, bodyContents: body, footerButtons: footer }));
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
        t.expiry ? textComponent(`到期：${t.expiry}`) : null,
      ].filter(Boolean) },
    ];
    const footer = [
      buttonUri('查看票券', magicLink('/wallet', lineSubject)),
      buttonMessage('更多票券', '我的票券'),
    ];
    return bubbleBase({ title: `票券 ${t.id}`, heroUrl: hero, bodyContents: body, footerButtons: footer });
  });
  return flexCarousel('我的票券', bubbles);
}

function buildReservationsFlex(list, lineSubject = '') {
  if (!list.length) {
    const title = '我的預約';
    return flex(title, bubbleBase({ title, bodyContents: [textComponent('目前沒有預約紀錄。')], heroUrl: DEFAULT_ICON }));
  }
  const bubbles = list.map((r) => {
    const hero = normalizeCoverUrl(r.cover || '');
    const body = [
      { type: 'box', layout: 'vertical', spacing: 'xs', contents: [
        textComponent(r.event || '-', { size: 'md' }),
        r.store ? textComponent(`門市：${r.store}`) : null,
        r.status ? textComponent(`狀態：${r.status}`) : null,
        r.time ? textComponent(`預約：${r.time}`) : null,
      ].filter(Boolean) },
    ];
    const footer = [ buttonUri('查看預約', magicLink('/order', lineSubject)), buttonMessage('更多預約', '我的預約') ];
    return bubbleBase({ title: '預約', heroUrl: hero, bodyContents: body, footerButtons: footer });
  });
  return flexCarousel('我的預約', bubbles);
}

function buildStoreFlex(lineSubject = ''){
  const title = '前往商店';
  const body = [ textComponent('選購票券、建立預約，或查看活動資訊。') ];
  const footer = [ buttonUri('開啟商店', magicLink('/store', lineSubject)), buttonMessage('我的訂單', '我的訂單') ];
  return flex(title, bubbleBase({ title, bodyContents: body, footerButtons: footer, heroUrl: DEFAULT_ICON }));
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

async function handleTextMessage(event) {
  const text = (event.message?.text || '').toString().trim();
  const replyToken = event.replyToken;
  const userId = event.source?.userId || '';
  if (!userId) return;

  // Normalize simple keywords
  const t = text.replace(/\s+/g, '').toLowerCase();

  // Linking path
  if (t === '綁定' || t === '綁定帳號' || t === 'link') {
    return reply(replyToken, { ...buildLinkFlex(), ...quickReply([qrItemMessage('幫助', '幫助'), qrItemMessage('我的訂單', '我的訂單')]) });
  }

  // Find linked user
  const linkedUserId = await findLinkedUserIdByLineSubject(userId);
  if (!linkedUserId) {
    return reply(replyToken, { ...buildHelpFlex(false), ...quickReply([qrItemUri('去綁定', linkUrl()), qrItemMessage('幫助', '幫助'), qrItemMessage('商店', '商店')]) });
  }

  // Linked features
  if (t === '幫助' || t === 'help' || t === '說明' || t === 'menu' || t === '功能') {
    return reply(replyToken, { ...buildHelpFlex(true), ...quickReply([
      qrItemMessage('商店', '商店'),
      qrItemMessage('我的訂單', '我的訂單'),
      qrItemMessage('我的票券', '我的票券'),
      qrItemMessage('我的預約', '我的預約'),
      qrItemMessage('個人資料', '個人資料'),
    ]) });
  }

  if (t === '商店' || t === 'store' || t === '購買') {
    return reply(replyToken, buildStoreFlex(userId));
  }

  if (t === '個人資料' || t === '我' || t === 'profile' || t === 'whoami') {
    const u = await queryUserProfile(linkedUserId);
    const providers = await queryUserProviders(linkedUserId);
    if (!u) return reply(replyToken, buildProfileFlex(null, providers, userId));
    return reply(replyToken, buildProfileFlex(u, providers, userId));
  }

  if (t === '我的訂單' || t === '訂單' || t === 'orders') {
    const rows = await queryOrders(linkedUserId, 5);
    return reply(replyToken, buildOrdersFlex(formatOrders(rows), userId));
  }

  if (t === '我的票券' || t === '票券' || t === 'tickets') {
    const rows = await queryTickets(linkedUserId, 5);
    return reply(replyToken, buildTicketsFlex(formatTickets(rows), userId));
  }

  if (t === '我的預約' || t === '預約' || t === 'reservations') {
    const rows = await queryReservations(linkedUserId, 5);
    return reply(replyToken, buildReservationsFlex(formatReservations(rows), userId));
  }

  if (t === '綁定狀態' || t === '我的綁定' || t === 'providers') {
    const providers = await queryUserProviders(linkedUserId);
    return reply(replyToken, buildBindingsFlex(providers));
  }

  if (t === '重設密碼' || t === '忘記密碼' || t === 'resetpassword') {
    const profile = await queryUserProfile(linkedUserId);
    const email = profile?.email || '';
    if (!email) return reply(replyToken, flex('無法寄送', bubbleBase({ title: '無法寄送', bodyContents: [textComponent('您的帳號缺少 Email，請先至網站補齊。')], footerButtons: [buttonUri('前往個人資料', magicLink('/account', userId))] })));
    const r = await sendForgotPassword(email);
    if (r.ok) return reply(replyToken, flex('已寄送連結', bubbleBase({ title: '已寄送連結', bodyContents: [textComponent('已寄送重設密碼連結至您的 Email。請於一小時內完成設定。')] })));
    return reply(replyToken, flex('寄送失敗', bubbleBase({ title: '寄送失敗', bodyContents: [textComponent(r.message || '請稍後再試或至網站操作。')], footerButtons: [buttonUri('前往登入', `${PUBLIC_WEB_URL}/login`)] })));
  }

  if (t === '解除綁定' || t === 'unlink') {
    await pool.query('DELETE FROM oauth_identities WHERE provider = ? AND subject = ? LIMIT 1', ['line', userId]);
    return reply(replyToken, flex('已解除綁定', bubbleBase({ title: '已解除綁定', bodyContents: [textComponent('若要再次綁定，請點擊下方按鈕或輸入「綁定」')], footerButtons: [buttonUri('前往綁定', linkUrl())] })));
  }

  // default
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
      return reply(event.replyToken, flex('已收到', bubbleBase({ title: '已收到', bodyContents: [textComponent('操作已處理')] })));
    }
  } catch (e) {
    console.error('handleEvent error:', e?.message || e);
  }
}

// ==== HTTP server ====
const server = http.createServer(async (req, res) => {
  // Health check
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/healthz'))) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'line-bot', time: Date.now() }));
    return;
  }

  if (!req.url.startsWith('/webhook')) {
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
