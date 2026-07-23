const crypto = require('crypto');
const { randomUUID } = require('crypto');
const {
  PASSWORD_BCRYPT_COST,
  isValidNewPassword,
  characterLength,
  utf8ByteLength,
} = require('../security/password-policy');

const REGISTRATION_TOKEN_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const REGISTRATION_RESEND_SECONDS = 60;
const REGISTRATION_SEND_WINDOW_MS = 15 * 60 * 1000;
const REGISTRATION_MAX_SEND_ATTEMPTS = 5;

const DUPLICATE_SCHEMA_ERROR_CODES = new Set(['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME']);

function normalizeEmailAddress(value) {
  return String(value || '').trim().toLowerCase();
}

function isEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

function maskEmailAddress(value) {
  const email = normalizeEmailAddress(value);
  const separator = email.lastIndexOf('@');
  if (separator <= 0) return '';
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(2, Math.min(6, local.length - visible.length)))}@${domain}`;
}

function dateToMs(value) {
  if (value == null || value === '') return 0;
  if (value instanceof Date) return value.getTime();
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(value) {
  const ms = dateToMs(value);
  return ms ? new Date(ms).toISOString() : null;
}

function sanitizeSmtpText(value) {
  return String(value || '')
    .replace(/[^\s<>@]+@[^\s<>]+/g, '[redacted-email]')
    .slice(0, 500);
}

function deliveryDomains(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map(normalizeEmailAddress)
    .map((value) => value.split('@')[1] || '')
    .filter(Boolean)));
}

function logDelivery(logger, level, metadata) {
  const method = typeof logger?.[level] === 'function'
    ? logger[level].bind(logger)
    : console[level === 'error' ? 'error' : 'info'].bind(console);
  try {
    method('registration-email-delivery', metadata);
  } catch (_) {
    // Delivery state must not be changed by an observability sink failure.
  }
}

function buildRegistrationEmailHtml({
  buildLeaderEmailHtml,
  escapeHtml,
  registrationName,
  link,
  requestedAt,
  expiresAt,
}) {
  const safe = typeof escapeHtml === 'function'
    ? escapeHtml
    : (value) => String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  const requestedLabel = requestedAt.toLocaleString('zh-TW', { hour12: false, timeZone: 'Asia/Taipei' });
  const expiresLabel = expiresAt.toLocaleString('zh-TW', { hour12: false, timeZone: 'Asia/Taipei' });
  const childrenHtml = `
    <p style="margin:0 0 14px 0;">${safe(registrationName)} 您好，請點擊下方按鈕設定密碼並完成註冊。</p>
    <p style="margin:0 0 18px 0;"><a href="${safe(link)}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#d90000;color:#fff;text-decoration:none;">設定密碼並完成註冊</a></p>
    <p style="margin:0 0 8px 0;color:#64748b;">申請時間：${safe(requestedLabel)}</p>
    <p style="margin:0 0 8px 0;color:#64748b;">到期時間：${safe(expiresLabel)}</p>
    <p style="margin:0;color:#64748b;">連結三天內有效；期間重寄會沿用相同連結，且不會延長到期時間。若非您本人申請，請忽略本郵件。</p>
  `;
  if (typeof buildLeaderEmailHtml === 'function') {
    return buildLeaderEmailHtml({
      title: '設定密碼並完成註冊',
      intro: '請完成最後一步，以建立 Leader Online 帳號。',
      actionUrl: link,
      actionText: '設定密碼並完成註冊',
      childrenHtml,
    });
  }
  return childrenHtml;
}

function createEmailRegistrationService({
  pool,
  bcrypt,
  ok,
  fail,
  normalizeRegistrationName,
  isValidRegistrationName,
  restrictEmailDomainToEduTw = false,
  isMailerReady,
  transporter,
  emailFromName = 'Leader Online',
  emailFromAddress = '',
  publicApiBase = '',
  publicWebUrl = 'http://localhost:5173',
  buildLeaderEmailHtml,
  escapeHtml,
  signToken,
  setAuthCookie,
  autoAcceptTransfersForEmail,
  autoAcceptReservationTransfersForEmail,
  featureEnabled = process.env.REGISTRATION_COMPLETION_V2 === '1',
  logger = console,
  now = () => Date.now(),
} = {}) {
  let schemaReady = false;
  const webBase = String(publicWebUrl || 'http://localhost:5173').replace(/\/$/, '');
  const apiBase = String(publicApiBase || '').replace(/\/$/, '');
  const eduEmailRegex = /^([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.edu\.tw)$/;

  async function ensureSchema() {
    if (schemaReady) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_verifications (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        email VARCHAR(255) NOT NULL,
        registration_name VARCHAR(50) NULL,
        token VARCHAR(128) NULL,
        token_expiry BIGINT UNSIGNED NULL,
        verified TINYINT(1) NOT NULL DEFAULT 0,
        last_send_attempt_at DATETIME NULL,
        send_window_started_at DATETIME NULL,
        send_attempt_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        delivered_at DATETIME NULL,
        used_at DATETIME NULL,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_email_verifications_email (email),
        UNIQUE KEY uq_email_verifications_token (token)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    const additions = [
      'ALTER TABLE email_verifications ADD COLUMN registration_name VARCHAR(50) NULL AFTER email',
      'ALTER TABLE email_verifications ADD COLUMN last_send_attempt_at DATETIME NULL AFTER verified',
      'ALTER TABLE email_verifications ADD COLUMN send_window_started_at DATETIME NULL AFTER last_send_attempt_at',
      'ALTER TABLE email_verifications ADD COLUMN send_attempt_count SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER send_window_started_at',
      'ALTER TABLE email_verifications ADD COLUMN delivered_at DATETIME NULL AFTER send_attempt_count',
      'ALTER TABLE email_verifications ADD COLUMN used_at DATETIME NULL AFTER delivered_at',
      'ALTER TABLE email_verifications ADD UNIQUE KEY uq_email_verifications_token (token)',
    ];
    for (const sql of additions) {
      try {
        await pool.query(sql);
      } catch (error) {
        if (!DUPLICATE_SCHEMA_ERROR_CODES.has(error?.code)) throw error;
      }
    }
    schemaReady = true;
  }

  function rateLimited(res, code, message, retryAfter, data = {}) {
    const retryAfterSeconds = Math.max(1, Math.ceil(Number(retryAfter) || 1));
    return res.status(429).json({
      ok: false,
      code,
      message,
      data: {
        mailed: false,
        alreadyRegistered: false,
        expiresAt: data.expiresAt ?? null,
        resendAfter: retryAfterSeconds,
        ...data,
        retryAfter: retryAfterSeconds,
      },
    });
  }

  async function requestVerification(req, res) {
    const email = normalizeEmailAddress(req.body?.email);
    const registrationName = normalizeRegistrationName(req.body?.username ?? req.body?.registrationName);
    if (!isEmailAddress(email)) return fail(res, 'VALIDATION_ERROR', '請輸入有效的 email', 400);
    if (!isValidRegistrationName(registrationName)) {
      return fail(res, 'REAL_NAME_REQUIRED', '請填寫 2 至 50 個字的真實姓名', 400);
    }
    if (restrictEmailDomainToEduTw && !eduEmailRegex.test(email)) {
      return fail(res, 'EMAIL_DOMAIN_RESTRICTED', '僅允許使用 .edu.tw 學生信箱', 400);
    }
    const requestId = String(req.get?.('x-request-id') || req.headers?.['x-request-id'] || randomUUID());
    const emailDomain = email.split('@')[1] || '';
    const emailHash = crypto.createHash('sha256').update(email).digest('hex').slice(0, 16);

    let conn;
    try {
      const [duplicates] = await pool.query(
        'SELECT id FROM users WHERE email = ? LIMIT 1',
        [email]
      );
      if (duplicates.length) {
        return ok(res, {
          mailed: false,
          alreadyRegistered: true,
          expiresAt: null,
          resendAfter: 0,
        }, '此 Email 已被註冊，請直接登入或使用忘記密碼');
      }

      await ensureSchema();
      conn = await pool.getConnection();
      await conn.beginTransaction();
      await conn.query(
        `INSERT INTO email_verifications
          (email, registration_name, token, token_expiry, verified, send_attempt_count)
         VALUES (?, ?, NULL, NULL, 0, 0)
         ON DUPLICATE KEY UPDATE email = VALUES(email)`,
        [email, registrationName]
      );
      const [rows] = await conn.query(
        'SELECT * FROM email_verifications WHERE email = ? LIMIT 1 FOR UPDATE',
        [email]
      );
      const record = rows[0];
      const [registeredNow] = await conn.query(
        'SELECT id FROM users WHERE email = ? LIMIT 1 FOR UPDATE',
        [email]
      );
      if (registeredNow.length) {
        await conn.rollback();
        conn.release();
        conn = null;
        return ok(res, {
          mailed: false,
          alreadyRegistered: true,
          expiresAt: null,
          resendAfter: 0,
        }, '此 Email 已被註冊，請直接登入或使用忘記密碼');
      }
      const currentMs = now();
      const lastAttemptMs = dateToMs(record.last_send_attempt_at);
      const previousExpiry = Number(record.token_expiry || 0);
      const reusable = Boolean(
        record.token
        && !record.used_at
        && Number(record.verified || 0) === 0
        && previousExpiry > currentMs
      );
      const storedRegistrationName = normalizeRegistrationName(record.registration_name);
      const effectiveRegistrationName = reusable && isValidRegistrationName(storedRegistrationName)
        ? storedRegistrationName
        : registrationName;
      const expiresAtMs = reusable ? previousExpiry : currentMs + REGISTRATION_TOKEN_TTL_MS;
      const token = reusable ? String(record.token) : crypto.randomBytes(32).toString('hex');
      if (lastAttemptMs && currentMs - lastAttemptMs < REGISTRATION_RESEND_SECONDS * 1000) {
        await conn.rollback();
        conn.release();
        conn = null;
        return rateLimited(
          res,
          'REGISTRATION_EMAIL_COOLDOWN',
          '請稍後再寄送',
          (REGISTRATION_RESEND_SECONDS * 1000 - (currentMs - lastAttemptMs)) / 1000,
          { expiresAt: new Date(expiresAtMs).toISOString() }
        );
      }

      const windowStartedMs = dateToMs(record.send_window_started_at);
      const withinWindow = windowStartedMs > 0 && currentMs - windowStartedMs < REGISTRATION_SEND_WINDOW_MS;
      const attempts = withinWindow ? Number(record.send_attempt_count || 0) : 0;
      if (attempts >= REGISTRATION_MAX_SEND_ATTEMPTS) {
        await conn.rollback();
        conn.release();
        conn = null;
        const retryAfter = Math.max(1, Math.ceil((REGISTRATION_SEND_WINDOW_MS - (currentMs - windowStartedMs)) / 1000));
        return rateLimited(
          res,
          'REGISTRATION_EMAIL_RATE_LIMITED',
          '寄送次數過多，請稍後再試',
          retryAfter,
          { expiresAt: new Date(expiresAtMs).toISOString() }
        );
      }

      await conn.query(
        `UPDATE email_verifications
            SET registration_name = ?,
                token = ?,
                token_expiry = ?,
                verified = 0,
                used_at = NULL,
                delivered_at = CASE WHEN ? THEN delivered_at ELSE NULL END,
                last_send_attempt_at = NOW(),
                send_window_started_at = CASE WHEN ? THEN send_window_started_at ELSE NOW() END,
                send_attempt_count = ?
          WHERE id = ?`,
        [effectiveRegistrationName, token, expiresAtMs, reusable ? 1 : 0, withinWindow ? 1 : 0, attempts + 1, record.id]
      );
      await conn.commit();
      conn.release();
      conn = null;

      const expiresAt = new Date(expiresAtMs);
      const directCompletionLink = `${webBase}/register/complete#token=${encodeURIComponent(token)}`;
      const compatibilityLink = `${apiBase || ''}/confirm-email?token=${encodeURIComponent(token)}`;
      const link = featureEnabled || !apiBase ? directCompletionLink : compatibilityLink;
      const commonData = {
        mailed: false,
        alreadyRegistered: false,
        expiresAt: expiresAt.toISOString(),
        resendAfter: REGISTRATION_RESEND_SECONDS,
      };
      const linkHost = (() => {
        try { return new URL(link).host; } catch (_) { return ''; }
      })();

      if (typeof isMailerReady !== 'function' || !isMailerReady()) {
        logDelivery(logger, 'error', {
          requestId,
          emailDomain,
          emailHash,
          linkHost,
          result: 'mailer_not_ready',
        });
        return res.status(503).json({
          ok: false,
          code: 'REGISTRATION_EMAIL_UNAVAILABLE',
          message: '郵件服務目前無法使用，請稍後再試',
          data: commonData,
        });
      }

      let delivery;
      try {
        delivery = await transporter.sendMail({
          from: `${emailFromName} <${emailFromAddress}>`,
          to: email,
          subject: '設定密碼並完成註冊 - Leader Online',
          html: buildRegistrationEmailHtml({
            buildLeaderEmailHtml,
            escapeHtml,
            registrationName: effectiveRegistrationName,
            link,
            requestedAt: new Date(currentMs),
            expiresAt,
          }),
        });
        const accepted = Array.isArray(delivery?.accepted) ? delivery.accepted : null;
        const rejected = Array.isArray(delivery?.rejected) ? delivery.rejected : [];
        const explicitlyRejected = rejected.map(normalizeEmailAddress).includes(email);
        if (explicitlyRejected || (accepted && accepted.length === 0)) {
          const error = new Error('SMTP did not accept the recipient');
          error.code = 'SMTP_RECIPIENT_REJECTED';
          throw error;
        }
      } catch (error) {
        logDelivery(logger, 'error', {
          requestId,
          emailDomain,
          emailHash,
          linkHost,
          result: 'rejected',
          messageId: delivery?.messageId || null,
          accepted: deliveryDomains(delivery?.accepted),
          rejected: deliveryDomains(delivery?.rejected),
          smtpResponse: sanitizeSmtpText(delivery?.response || error?.response || error?.message),
        });
        return res.status(503).json({
          ok: false,
          code: 'REGISTRATION_EMAIL_DELIVERY_FAIL',
          message: '驗證信未成功寄出，請稍後再試',
          data: commonData,
        });
      }

      try {
        await pool.query(
          'UPDATE email_verifications SET delivered_at = NOW() WHERE id = ? AND token = ?',
          [record.id, token]
        );
      } catch (error) {
        logDelivery(logger, 'error', {
          requestId,
          emailDomain,
          emailHash,
          linkHost,
          result: 'accepted_delivery_marker_failed',
          messageId: delivery?.messageId || null,
          accepted: deliveryDomains(delivery?.accepted),
          rejected: deliveryDomains(delivery?.rejected),
          smtpResponse: sanitizeSmtpText(delivery?.response),
          persistenceError: sanitizeSmtpText(error?.message),
        });
      }
      logDelivery(logger, 'info', {
        requestId,
        emailDomain,
        emailHash,
        linkHost,
        result: 'accepted',
        messageId: delivery?.messageId || null,
        accepted: deliveryDomains(delivery?.accepted),
        rejected: deliveryDomains(delivery?.rejected),
        smtpResponse: sanitizeSmtpText(delivery?.response),
      });
      return ok(res, { ...commonData, mailed: true }, '驗證信已寄出，請至信箱設定密碼');
    } catch (error) {
      try { if (conn) await conn.rollback(); } catch (_) {}
      logDelivery(logger, 'error', {
        requestId,
        emailDomain,
        emailHash,
        result: 'request_failed',
        persistenceError: sanitizeSmtpText(error?.message || error),
      });
      return fail(res, 'VERIFY_EMAIL_FAIL', '目前無法寄送驗證信，請稍後再試', 500);
    } finally {
      try { if (conn) conn.release(); } catch (_) {}
    }
  }

  async function validateVerification(req, res) {
    const token = String(req.body?.token || '').trim();
    if (!token) return fail(res, 'VALIDATION_ERROR', '缺少 token', 400);
    try {
      await ensureSchema();
      const [rows] = await pool.query(
        'SELECT email, token_expiry, verified, used_at FROM email_verifications WHERE token = ? LIMIT 1',
        [token]
      );
      if (!rows.length) {
        return ok(res, { valid: false, status: 'invalid', email: '', expiresAt: null });
      }
      const record = rows[0];
      const expiresAtMs = Number(record.token_expiry || 0);
      let status = 'valid';
      if (record.used_at || Number(record.verified || 0) === 1) status = 'used';
      else if (!expiresAtMs || now() > expiresAtMs) status = 'expired';
      return ok(res, {
        valid: status === 'valid',
        status,
        email: maskEmailAddress(record.email),
        expiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
      });
    } catch (error) {
      return fail(res, 'EMAIL_VERIFICATION_VALIDATE_FAIL', '目前無法驗證連結，請稍後再試', 500);
    }
  }

  async function completeRegistration(req, res) {
    const token = String(req.body?.token || '').trim();
    const password = req.body?.password;
    if (!token) return fail(res, 'VALIDATION_ERROR', '缺少 token', 400);
    if (!isValidNewPassword(password)) {
      const message = characterLength(password) < 8
        ? '密碼至少需要 8 個字元'
        : `密碼不可超過 72 個 UTF-8 bytes（目前 ${utf8ByteLength(password)} bytes）`;
      return fail(res, 'VALIDATION_ERROR', message, 400);
    }

    let conn;
    let created = null;
    try {
      await ensureSchema();
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const [rows] = await conn.query(
        'SELECT * FROM email_verifications WHERE token = ? LIMIT 1 FOR UPDATE',
        [token]
      );
      if (!rows.length) {
        await conn.rollback();
        return fail(res, 'REGISTRATION_TOKEN_INVALID', '連結無效或已使用', 400);
      }
      const record = rows[0];
      if (record.used_at || Number(record.verified || 0) === 1) {
        await conn.rollback();
        return fail(res, 'REGISTRATION_TOKEN_USED', '連結已被使用', 409);
      }
      if (!record.token_expiry || now() > Number(record.token_expiry)) {
        await conn.rollback();
        return fail(res, 'REGISTRATION_TOKEN_EXPIRED', '連結已過期，請重新申請', 400);
      }
      const email = normalizeEmailAddress(record.email);
      const username = normalizeRegistrationName(record.registration_name);
      if (!isEmailAddress(email) || !isValidRegistrationName(username)) {
        await conn.rollback();
        return fail(res, 'REGISTRATION_DATA_INVALID', '註冊資料不完整，請重新申請', 400);
      }
      const [duplicates] = await conn.query(
        'SELECT id FROM users WHERE email = ? LIMIT 1 FOR UPDATE',
        [email]
      );
      if (duplicates.length) {
        await conn.rollback();
        return fail(res, 'EMAIL_TAKEN', '此 Email 已被註冊，請直接登入或使用忘記密碼', 409);
      }

      const id = randomUUID();
      const hash = await bcrypt.hash(password, PASSWORD_BCRYPT_COST);
      try {
        await conn.query(
          'INSERT INTO users (id, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
          [id, username, email, hash, 'USER']
        );
      } catch (error) {
        if (error?.code === 'ER_BAD_FIELD_ERROR') {
          await conn.query(
            'INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)',
            [id, username, email, hash]
          );
        } else {
          throw error;
        }
      }
      const [consumed] = await conn.query(
        `UPDATE email_verifications
            SET verified = 1, used_at = NOW(), token = NULL, token_expiry = NULL
          WHERE id = ? AND token = ? AND used_at IS NULL`,
        [record.id, token]
      );
      if (!consumed.affectedRows) {
        const error = new Error('Registration token changed during completion');
        error.code = 'REGISTRATION_TOKEN_CONFLICT';
        throw error;
      }
      const jwtToken = signToken({ id, email, username, role: 'USER' });
      await conn.commit();
      created = { id, username, email, role: 'USER' };
      conn.release();
      conn = null;

      try { await autoAcceptTransfersForEmail?.(id, email); } catch (_) {}
      try { await autoAcceptReservationTransfersForEmail?.(id, email); } catch (_) {}
      try { setAuthCookie(res, jwtToken); } catch (_) {}
      return ok(res, { ...created, token: jwtToken }, '註冊成功，已自動登入');
    } catch (error) {
      try { if (conn) await conn.rollback(); } catch (_) {}
      if (error?.code === 'ER_DUP_ENTRY') {
        return fail(res, 'EMAIL_TAKEN', '此 Email 已被註冊，請直接登入或使用忘記密碼', 409);
      }
      logDelivery(logger, 'error', {
        requestId: String(req.get?.('x-request-id') || req.headers?.['x-request-id'] || randomUUID()),
        tokenHash: crypto.createHash('sha256').update(token).digest('hex').slice(0, 16),
        result: 'completion_failed',
        persistenceError: sanitizeSmtpText(error?.message || error),
      });
      return fail(res, 'REGISTRATION_COMPLETE_FAIL', '目前無法完成註冊，請稍後再試', 500);
    } finally {
      try { if (conn) conn.release(); } catch (_) {}
    }
  }

  function redirectToCompletion(req, res) {
    const token = String(req.query?.token || '').trim();
    const target = token
      ? `${webBase}/register/complete#token=${encodeURIComponent(token)}`
      : `${webBase}/register/complete`;
    return res.redirect(302, target);
  }

  return {
    ensureSchema,
    requestVerification,
    validateVerification,
    completeRegistration,
    redirectToCompletion,
  };
}

module.exports = {
  REGISTRATION_TOKEN_TTL_MS,
  REGISTRATION_RESEND_SECONDS,
  REGISTRATION_SEND_WINDOW_MS,
  REGISTRATION_MAX_SEND_ATTEMPTS,
  normalizeEmailAddress,
  maskEmailAddress,
  createEmailRegistrationService,
};
