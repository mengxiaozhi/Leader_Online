const express = require('express');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const crypto = require('crypto');
const { z } = require('zod');

function buildAccountRoutes(ctx) {
  const router = express.Router();
  const {
    ok,
    fail,
    pool,
    storage,
    REQUIRE_EMAIL_VERIFICATION,
    RESTRICT_EMAIL_DOMAIN_TO_EDU_TW,
    PUBLIC_API_BASE,
    PUBLIC_WEB_URL,
    EMAIL_FROM_NAME,
    EMAIL_FROM_ADDRESS,
    mailerReady,
    transporter,
    shortCookieOptions,
    publicApiBase,
    toQuery,
    httpsPostForm,
    httpsGetJson,
    hmacSha256Hex,
    safeEqual,
    parsePositiveInt,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    LINE_CLIENT_ID,
    LINE_CLIENT_SECRET,
    MAGIC_LINK_SECRET,
    LINE_BOT_QR_MAX_LENGTH,
    THEME_PRIMARY,
    FLEX_DEFAULT_ICON,
    signToken,
    setAuthCookie,
    notifyLineByUserId,
    authRequired,
    adminOnly,
    safeParseJSON,
    ensureOAuthIdentitiesTable,
    ensureAccountTombstonesTable,
    isTombstoned,
    getAuthedUser,
    autoAcceptTransfersForEmail,
    normalizeRole,
    normalizeCartItems,
    ensureTicketLogsTable,
    ensureRemittance,
    isADMIN,
    isSTORE,
    isEDITOR,
    isOPERATOR,
  } = ctx;

  // Express 5 deprecates passing maxAge to clearCookie; strip it when clearing temp OAuth cookies.
  const clearShortCookieOptions = () => {
    const opts = shortCookieOptions();
    delete opts.maxAge;
    return opts;
  };

  router.get('/auth/magic_link', async (req, res) => {
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
router.get('/healthz', (req, res) => ok(res, { uptime: process.uptime() }, 'OK'));
router.get('/__debug/echo', (req, res) => {
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
router.get('/auth/google/start', (req, res) => {
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

router.get('/auth/google/callback', async (req, res) => {
  try{
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return res.status(500).send('OAuth not configured');
    const { code, state } = req.query || {};
    if (!code || !state) return res.status(400).send('Missing code/state');
    if (String(state) !== String(req.cookies?.oauth_state || '')) return res.status(400).send('Invalid state');
    const next = (req.cookies?.oauth_next || '/store').toString();
    const mode = (req.cookies?.oauth_mode || 'login').toString();
    // Clear temp cookies
    res.clearCookie('oauth_state', clearShortCookieOptions());
    res.clearCookie('oauth_next', clearShortCookieOptions());
    res.clearCookie('oauth_mode', clearShortCookieOptions());

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
router.get('/auth/line/start', (req, res) => {
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

router.get('/auth/line/callback', async (req, res) => {
  try{
    if (!LINE_CLIENT_ID || !LINE_CLIENT_SECRET) return res.status(500).send('OAuth not configured');
    const { code, state } = req.query || {};
    if (!code || !state) return res.status(400).send('Missing code/state');
    if (String(state) !== String(req.cookies?.oauth_state || '')) return res.status(400).send('Invalid state');
    const next = (req.cookies?.oauth_next || '/store').toString();
    const mode = (req.cookies?.oauth_mode || 'login').toString();
    // Clear temp cookies
    res.clearCookie('oauth_state', clearShortCookieOptions());
    res.clearCookie('oauth_next', clearShortCookieOptions());
    res.clearCookie('oauth_mode', clearShortCookieOptions());

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
router.get('/users', adminOnly, async (req, res) => {
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
router.get('/admin/users/:id/export', adminOnly, async (req, res) => {
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

router.post('/users', async (req, res) => {
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
router.post('/verify-email', async (req, res) => {
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
router.get('/confirm-email-change', async (req, res) => {
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
router.get('/confirm-email', async (req, res) => {
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
router.get('/check-verification', async (req, res) => {
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
router.post('/forgot-password', async (req, res) => {
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
router.post('/me/password/send_reset', authRequired, async (req, res) => {
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
router.get('/password_resets/validate', async (req, res) => {
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
router.post('/reset-password', async (req, res) => {
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

router.post('/login', async (req, res) => {
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

router.post('/logout', (req, res) => {
  res.clearCookie('auth_token', cookieOptions());
  return ok(res, null, '已登出');
});

router.get('/whoami', authRequired, async (req, res) => {
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
router.get('/admin/users', adminOnly, async (req, res) => {
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

router.patch('/admin/users/:id/role', adminOnly, async (req, res) => {
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
router.get('/me', authRequired, async (req, res) => {
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
router.patch('/me', authRequired, async (req, res) => {
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
router.patch('/me/password', authRequired, async (req, res) => {
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
router.post('/me/export', authRequired, async (req, res) => {
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
router.post('/me/delete', authRequired, async (req, res) => {
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
router.get('/cart', authRequired, async (req, res) => {
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

router.put('/cart', authRequired, async (req, res) => {
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

router.delete('/cart', authRequired, async (req, res) => {
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
router.patch('/admin/users/:id', adminOnly, async (req, res) => {
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
router.patch('/admin/users/:id/password', adminOnly, async (req, res) => {
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
router.delete('/admin/users/:id', adminOnly, async (req, res) => {
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

  return router;
}

module.exports = buildAccountRoutes;
