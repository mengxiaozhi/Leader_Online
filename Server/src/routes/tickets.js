const express = require('express');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');
const { z } = require('zod');

function buildTicketRoutes(ctx) {
  const router = express.Router();
  const {
    ok,
    fail,
    pool,
    storage,
    authRequired,
    adminOnly,
    isADMIN,
    isMailerReady,
    transporter,
    EMAIL_FROM_NAME,
    EMAIL_FROM_ADDRESS,
    PUBLIC_WEB_URL,
    normalizeEmail,
    ensureTicketLogsTable,
    logTicket,
    linePush,
    buildTransferAcceptedForSenderFlex,
    buildTransferAcceptedForRecipientFlex,
    safeParseJSON,
    ensureOAuthIdentitiesTable,
    ensureAccountTombstonesTable,
    isTombstoned,
    getAuthedUser,
    getLineSubjectByUserId,
    notifyLineByUserId,
    ticketCoversHaveStoragePath,
    buildTicketCoverStoragePath,
    randomCode,
    parsePositiveInt,
    parseBoolean,
    normalizePositiveInt,
    formatDateYYYYMMDD,
    sanitizeTicketTypeForPath,
  } = ctx;

  router.get('/tickets/me', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         id,
         uuid,
         type,
         discount,
         used,
         expiry,
         created_at,
         (expiry IS NOT NULL AND expiry < CURRENT_DATE()) AS expired
       FROM tickets
       WHERE user_id = ?
       ORDER BY created_at DESC, id DESC`,
      [req.user.id]
    );
    return ok(res, rows);
  } catch (err) {
    return fail(res, 'TICKETS_LIST_FAIL', err.message, 500);
  }
});

// List my ticket logs (issuance, transfers, usage)
router.get('/tickets/logs', authRequired, async (req, res) => {
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

router.patch('/tickets/:id/use', authRequired, async (req, res) => {
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

// Expire old transfers to avoid stuck pendings
async function expireOldTransfers() {
  try {
    await pool.query(
      `UPDATE ticket_transfers tt
       LEFT JOIN tickets t ON t.id = tt.ticket_id
       SET tt.status = 'expired'
       WHERE tt.status = 'pending' AND (
         (tt.code IS NOT NULL AND tt.created_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)) OR
         (tt.code IS NULL AND tt.created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)) OR
         (t.expiry IS NOT NULL AND t.expiry < CURRENT_DATE())
       )`
    );
  } catch (_) { /* ignore */ }
}

// Initiate transfer by email or QR
router.post('/tickets/transfers/initiate', authRequired, async (req, res) => {
  const { ticketId, mode, email } = req.body || {};
  if (!Number(ticketId) || !['email','qr'].includes(mode)) return fail(res, 'VALIDATION_ERROR', '參數錯誤', 400);
  try {
    await expireOldTransfers();
    const [rows] = await pool.query(
      `SELECT id, user_id, used, expiry, (expiry IS NOT NULL AND expiry < CURRENT_DATE()) AS expired
       FROM tickets
       WHERE id = ?
       LIMIT 1`,
      [ticketId]
    );
    if (!rows.length) return fail(res, 'TICKET_NOT_FOUND', '找不到票券', 404);
    const t = rows[0];
    if (String(t.user_id) !== String(req.user.id)) return fail(res, 'FORBIDDEN', '僅限持有者轉贈', 403);
    if (Number(t.used)) return fail(res, 'TICKET_USED', '票券已使用，無法轉贈', 400);
    if (Number(t.expired)) return fail(res, 'TICKET_EXPIRED', '票券已過期，無法轉贈', 400);
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
      if (!toId && isMailerReady()) {
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
router.post('/tickets/transfers/:id/accept', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return fail(res, 'VALIDATION_ERROR', '參數錯誤', 400);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE ticket_transfers tt
       LEFT JOIN tickets t ON t.id = tt.ticket_id
       SET tt.status = 'expired'
       WHERE tt.status = 'pending' AND (
         (tt.code IS NOT NULL AND tt.created_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)) OR
         (tt.code IS NULL AND tt.created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)) OR
         (t.expiry IS NOT NULL AND t.expiry < CURRENT_DATE())
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

    const [tkRows] = await conn.query(
      `SELECT id, user_id, used, expiry, (expiry IS NOT NULL AND expiry < CURRENT_DATE()) AS expired
       FROM tickets
       WHERE id = ?
       LIMIT 1`,
      [tr.ticket_id]
    );
    if (!tkRows.length) { await conn.rollback(); return fail(res, 'TICKET_NOT_FOUND', '票券不存在', 404) }
    const tk = tkRows[0];
    if (Number(tk.used)) { await conn.rollback(); return fail(res, 'TICKET_USED', '票券已使用', 400) }
    if (Number(tk.expired)) { await conn.rollback(); return fail(res, 'TICKET_EXPIRED', '票券已過期，無法轉贈', 400) }
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

router.post('/tickets/transfers/:id/decline', authRequired, async (req, res) => {
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
router.post('/tickets/transfers/claim_code', authRequired, async (req, res) => {
  const raw = (req.body?.code || '').toString().trim();
  if (!raw) return fail(res, 'VALIDATION_ERROR', '缺少驗證碼', 400);
  const code = raw.replace(/\s+/g, '');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE ticket_transfers tt
       LEFT JOIN tickets t ON t.id = tt.ticket_id
       SET tt.status = 'expired'
       WHERE tt.status = 'pending' AND (
         (tt.code IS NOT NULL AND tt.created_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)) OR
         (tt.code IS NULL AND tt.created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)) OR
         (t.expiry IS NOT NULL AND t.expiry < CURRENT_DATE())
       )`
    );
    const [rows] = await conn.query('SELECT * FROM ticket_transfers WHERE code = ? AND status = "pending" LIMIT 1', [code]);
    if (!rows.length) { await conn.rollback(); return fail(res, 'CODE_NOT_FOUND', '無效或已處理的轉贈碼', 404) }
    const tr = rows[0];
    if (String(tr.from_user_id) === String(req.user.id)) { await conn.rollback(); return fail(res, 'FORBIDDEN', '不可轉贈給自己', 403) }
    const [tkRows] = await conn.query(
      `SELECT id, user_id, used, expiry, (expiry IS NOT NULL AND expiry < CURRENT_DATE()) AS expired
       FROM tickets
       WHERE id = ?
       LIMIT 1`,
      [tr.ticket_id]
    );
    if (!tkRows.length) { await conn.rollback(); return fail(res, 'TICKET_NOT_FOUND', '票券不存在', 404) }
    const tk = tkRows[0];
    if (Number(tk.used)) { await conn.rollback(); return fail(res, 'TICKET_USED', '票券已使用', 400) }
    if (Number(tk.expired)) { await conn.rollback(); return fail(res, 'TICKET_EXPIRED', '票券已過期，無法轉贈', 400) }
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
router.get('/tickets/transfers/incoming', authRequired, async (req, res) => {
  try {
    await expireOldTransfers();
    const [rows] = await pool.query(
      `SELECT tt.*, t.type, t.expiry, u.username AS from_username, u.email AS from_email
       FROM ticket_transfers tt
       JOIN tickets t ON t.id = tt.ticket_id
       JOIN users u ON u.id = tt.from_user_id
       WHERE tt.status = 'pending'
         AND (t.expiry IS NULL OR t.expiry >= CURRENT_DATE())
         AND (tt.to_user_id = ? OR (tt.to_user_id IS NULL AND LOWER(tt.to_user_email) = LOWER(?)))
       ORDER BY tt.created_at DESC, tt.id DESC`,
      [req.user.id, req.user.email || '']
    );
    return ok(res, rows);
  } catch (err) {
    return fail(res, 'INCOMING_TRANSFERS_FAIL', err.message, 500);
  }
});

// Sender: cancel current pending transfer(s) for a ticket
router.post('/tickets/transfers/cancel_pending', authRequired, async (req, res) => {
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
router.get('/auth/providers', authRequired, async (req, res) => {
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

router.delete('/auth/providers/google', authRequired, async (req, res) => {
  try {
    await ensureOAuthIdentitiesTable();
    await pool.query('DELETE FROM oauth_identities WHERE user_id = ? AND provider = ? LIMIT 1', [req.user.id, 'google']);
    return ok(res, null, 'UNLINKED');
  } catch (err) {
    return fail(res, 'AUTH_PROVIDER_UNLINK_FAIL', err.message, 500);
  }
});

router.delete('/auth/providers/line', authRequired, async (req, res) => {
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
router.get('/admin/users/:id/oauth_identities', adminOnly, async (req, res) => {
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
router.post('/admin/users/:id/oauth_identities', adminOnly, async (req, res) => {
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
router.delete('/admin/users/:id/oauth_identities/:provider', adminOnly, async (req, res) => {
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
router.post('/admin/oauth/cleanup_providers', adminOnly, async (req, res) => {
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

router.get('/admin/tombstones', adminOnly, async (req, res) => {
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

router.post('/admin/tombstones', adminOnly, async (req, res) => {
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

router.delete('/admin/tombstones/:id', adminOnly, async (req, res) => {
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

router.get('/admin/tickets', adminOnly, async (req, res) => {
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

router.get('/admin/tickets/:id/logs', adminOnly, async (req, res) => {
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

router.patch('/admin/tickets/:id', adminOnly, async (req, res) => {
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
router.get('/admin/tickets/types', adminOnly, async (req, res) => {
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
router.post('/admin/tickets/types/:type/cover_json', adminOnly, async (req, res) => {
  try {
    const type = req.params.type;
    if (!type) return fail(res, 'VALIDATION_ERROR', '缺少票券類型', 400);
    if (!ticketCoversHaveStoragePath) {
      return fail(res, 'STORAGE_PATH_UNAVAILABLE', '票券封面儲存未初始化，請聯繫客服', 500);
    }
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
    try {
      const [[row]] = await pool.query('SELECT storage_path FROM ticket_covers WHERE type = ? LIMIT 1', [type]);
      if (row && row.storage_path) previousPath = storage.normalizeRelativePath(row.storage_path);
    } catch (err) {
      console.warn('fetchTicketCoverPath error:', err?.message || err);
    }

    let storagePathRelative = null;
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

    const sql = 'INSERT INTO ticket_covers (type, cover_url, cover_type, storage_path, cover_data) VALUES (?, NULL, ?, ?, NULL) ON DUPLICATE KEY UPDATE cover_url = VALUES(cover_url), cover_type = VALUES(cover_type), storage_path = VALUES(storage_path), cover_data = NULL';
    const params = [type, contentType, storagePathRelative];
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
router.delete('/admin/tickets/types/:type/cover', adminOnly, async (req, res) => {
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
router.get('/tickets/cover/:type', async (req, res) => {
  try {
    const type = req.params.type;
    const normalizeTypeCandidates = (value) => {
      const attempts = [];
      const raw = (value ?? '').toString().trim();
      if (raw) attempts.push(raw);
      const sanitized = sanitizeTicketTypeForPath(raw);
      if (sanitized && sanitized !== raw) attempts.push(sanitized);
      if (!attempts.includes('default')) attempts.push('default');
      return attempts;
    };

    const selectSql = ticketCoversHaveStoragePath
      ? 'SELECT type, cover_url, cover_type, cover_data, cover, storage_path FROM ticket_covers WHERE type = ? LIMIT 1'
      : 'SELECT type, cover_url, cover_type, cover_data, cover, NULL AS storage_path FROM ticket_covers WHERE type = ? LIMIT 1';
    const selectSqlFallback = ticketCoversHaveStoragePath
      ? 'SELECT type, cover_url, cover_type, cover_data, storage_path FROM ticket_covers WHERE type = ? LIMIT 1'
      : 'SELECT type, cover_url, cover_type, cover_data, NULL AS storage_path FROM ticket_covers WHERE type = ? LIMIT 1';

    let row = null;
    const candidates = normalizeTypeCandidates(type);
    console.log('[tickets/cover] start', { type, candidates, ticketCoversHaveStoragePath });
    for (const candidate of candidates) {
      let rows = [];
      try {
        [rows] = await pool.query(selectSql, [candidate]);
      } catch (err) {
        if (err?.code === 'ER_BAD_FIELD_ERROR') {
          console.warn('[tickets/cover] fallback query (legacy schema)', { err: err?.message });
          const [fallbackRows] = await pool.query(selectSqlFallback, [candidate]);
          rows = fallbackRows;
        } else {
          throw err;
        }
      }
      if (rows.length) {
        row = rows[0];
        break;
      }
    }
    console.log('[tickets/cover] lookup', { type, candidates, found: !!row, foundType: row?.type || null, hasData: !!row?.cover_data, hasUrl: !!row?.cover_url, hasLegacyUrl: !!row?.cover });
    if (!row) return res.status(404).end();

    const normalizeStoragePath = (p) => {
      if (!p) return { rel: null, abs: null };
      const raw = String(p);
      const root = storage.STORAGE_ROOT ? path.resolve(storage.STORAGE_ROOT) : '';
      let rel = storage.normalizeRelativePath(raw);
      let abs = null;
      if (root && raw.startsWith(root)) {
        const trimmed = path.relative(root, raw);
        if (trimmed && !trimmed.startsWith('..')) rel = storage.normalizeRelativePath(trimmed);
      }
      try {
        abs = path.isAbsolute(raw) ? raw : path.resolve(root || process.cwd(), raw);
      } catch (_) { abs = null; }
      return { rel, abs };
    };

    if (ticketCoversHaveStoragePath && row.storage_path) {
      const { rel, abs } = normalizeStoragePath(row.storage_path);
      const trySendStream = async (streamFactory, pathLabel) => {
        const stream = streamFactory();
        res.setHeader('Content-Type', row.cover_type || 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        stream.on('error', (err) => {
          console.error('serveTicketCover stream error:', { err: err?.message || err, path: pathLabel });
          if (!res.headersSent) res.status(500).end();
          else res.destroy();
        });
        stream.pipe(res);
        return true;
      };

      if (rel && await storage.fileExists(rel)) {
        const stat = await storage.getFileStat(rel);
        if (stat?.size) res.setHeader('Content-Length', stat.size);
        await trySendStream(() => storage.createReadStream(rel), rel);
        return;
      }
      if (abs && fs.existsSync(abs)) {
        const stat = fs.statSync(abs);
        if (stat?.size) res.setHeader('Content-Length', stat.size);
        await trySendStream(() => fs.createReadStream(abs), abs);
        return;
      }
      console.warn('[tickets/cover] storage path missing', { type, path: row.storage_path, normalized: rel, abs });
    }
    if (row.cover_data) {
      res.setHeader('Content-Type', row.cover_type || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.end(row.cover_data);
    }
    const url = row.cover_url || row.cover || null;
    if (url) {
      console.log('[tickets/cover] redirecting to url', { type, url });
      return res.redirect(302, url);
    }
    // Fallback: try to read from storage directory directly (legacy manual files)
    const slug = sanitizeTicketTypeForPath(type);
    const storageRoot = storage.STORAGE_ROOT || path.resolve(__dirname, '../storage');
    const dirCandidates = [
      path.join(storageRoot, 'ticket_covers', slug.substring(0, 64)),
      path.join(storageRoot, 'ticket_covers', type),
    ];
    for (const dir of dirCandidates) {
      try {
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
        const files = fs.readdirSync(dir).filter(f => !fs.statSync(path.join(dir, f)).isDirectory());
        if (!files.length) continue;
        const target = path.join(dir, files[0]);
        const mimeType = mime.lookup(target) || 'application/octet-stream';
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        const stat = fs.statSync(target);
        if (stat?.size) res.setHeader('Content-Length', stat.size);
        console.warn('[tickets/cover] fallback disk file', { type, dir, file: files[0] });
        const stream = fs.createReadStream(target);
        stream.on('error', (err) => {
          console.error('serveTicketCover fallback stream error:', err?.message || err);
          if (!res.headersSent) res.status(500).end();
          else res.destroy();
        });
        stream.pipe(res);
        return;
      } catch (err) {
        console.error('tickets/cover fallback disk error:', err?.message || err);
      }
    }

    console.warn('[tickets/cover] no content found', { type, rowType: row.type });
    return res.status(404).end();
  } catch (err) {
    console.error('serveTicketCover error:', err?.message || err);
    return res.status(500).end();
  }
});

  return router;
}

module.exports = buildTicketRoutes;
