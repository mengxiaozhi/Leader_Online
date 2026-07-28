const crypto = require('crypto');
const { GoogleAuth } = require('google-auth-library');

const GOOGLE_WALLET_ISSUER_SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';
const GOOGLE_WALLET_GENERIC_OBJECT_URL =
  'https://walletobjects.googleapis.com/walletobjects/v1/genericObject';
const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_LEASE_SECONDS = 120;
const DEFAULT_BATCH_SIZE = 10;
const MAX_GENERATION_DRAINS = 20;
const MAX_ERROR_MESSAGE_LENGTH = 1000;
const CONFIGURATION_RETRY_SECONDS = 5 * 60;

function configurationError(message, missing = []) {
  const error = new Error(message);
  error.name = 'GoogleWalletConfigurationError';
  error.code = 'GOOGLE_WALLET_NOT_CONFIGURED';
  error.missing = missing;
  error.terminal = true;
  return error;
}

function parseServiceAccount(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;
  const candidates = [raw];
  if (!raw.startsWith('{')) {
    try {
      candidates.push(Buffer.from(raw, 'base64').toString('utf8'));
    } catch (_) {}
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (_) {}
  }
  throw configurationError('Google Wallet Service Account JSON 格式不正確');
}

function normalizePrivateKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.replace(/\\n/g, '\n').trim();
  if (normalized.includes('-----BEGIN ')) return normalized;
  try {
    const decoded = Buffer.from(normalized, 'base64').toString('utf8').replace(/\\n/g, '\n').trim();
    return decoded.includes('-----BEGIN ') ? decoded : normalized;
  } catch (_) {
    return normalized;
  }
}

function resolveGoogleWalletRestCredentials(env = process.env) {
  const serviceAccount = parseServiceAccount(env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON);
  const clientEmail = String(
    serviceAccount?.client_email || env.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL || ''
  ).trim();
  const privateKey = normalizePrivateKey(
    serviceAccount?.private_key || env.GOOGLE_WALLET_PRIVATE_KEY || ''
  );
  const missing = [];
  if (!clientEmail) missing.push('GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL');
  if (!privateKey) missing.push('GOOGLE_WALLET_PRIVATE_KEY');
  if (missing.length) {
    throw configurationError(`Google Wallet REST 同步尚未完成設定：${missing.join('、')}`, missing);
  }
  try {
    const signingKey = crypto.createPrivateKey(privateKey);
    if (signingKey.asymmetricKeyType !== 'rsa') {
      throw new Error('not_rsa');
    }
  } catch (_) {
    throw configurationError('Google Wallet REST 同步需要有效的 RSA PEM 私鑰');
  }
  return { client_email: clientEmail, private_key: privateKey };
}

async function createGoogleWalletApiRequester(env = process.env) {
  const auth = new GoogleAuth({
    credentials: resolveGoogleWalletRestCredentials(env),
    scopes: [GOOGLE_WALLET_ISSUER_SCOPE],
  });
  const client = await auth.getClient();
  return (options) => client.request(options);
}

function httpStatus(error) {
  const value = Number(error?.response?.status ?? error?.status ?? error?.statusCode);
  return Number.isFinite(value) ? value : null;
}

function googleWalletSyncErrorCode(error) {
  const status = httpStatus(error);
  if (status) return `HTTP_${status}`;
  return String(error?.code || error?.name || 'GOOGLE_WALLET_SYNC_FAIL').slice(0, 64);
}

function isGoogleWalletNotFound(error) {
  return httpStatus(error) === 404;
}

function isGoogleWalletTransientError(error) {
  const status = httpStatus(error);
  if (status === 408 || status === 429 || (status !== null && status >= 500)) return true;
  const code = String(error?.code || '').toUpperCase();
  return [
    'ETIMEDOUT',
    'ESOCKETTIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'EAI_AGAIN',
    'ENETUNREACH',
    'UND_ERR_CONNECT_TIMEOUT',
    'ABORT_ERR',
  ].includes(code);
}

function isGoogleWalletTerminalError(error) {
  if (error?.terminal) return true;
  const status = httpStatus(error);
  return status === 400 || status === 401 || status === 403;
}

function genericObjectUrl(objectId) {
  const id = String(objectId || '').trim();
  if (!id) throw new TypeError('Google Wallet Generic Object 缺少 object id');
  return `${GOOGLE_WALLET_GENERIC_OBJECT_URL}/${encodeURIComponent(id)}`;
}

async function syncGenericObjectIfSaved({
  object,
  env = process.env,
  request,
} = {}) {
  if (!object || typeof object !== 'object' || !String(object.id || '').trim()) {
    throw new TypeError('Google Wallet Generic Object 內容不正確');
  }
  const requester = request || await createGoogleWalletApiRequester(env);
  const url = genericObjectUrl(object.id);
  const timeout = safeInt(env.GOOGLE_WALLET_SYNC_TIMEOUT_MS, 5_000, 1_000, 30_000);
  try {
    await requester({ url, method: 'GET', timeout });
  } catch (error) {
    if (isGoogleWalletNotFound(error)) {
      return { saved: false, updated: false, objectId: object.id };
    }
    throw error;
  }
  await requester({ url, method: 'PUT', data: object, timeout });
  return { saved: true, updated: true, objectId: object.id };
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('Google Wallet outbox payload 必須是物件');
  }
  if (!String(payload.id || '').trim()) {
    throw new TypeError('Google Wallet outbox payload 缺少 object id');
  }
  return payload;
}

async function enqueueGoogleWalletObjectSync(queryable, {
  resourceType = 'reservation',
  resourceId = null,
  holderUserId = null,
  objectId,
  action = 'UPSERT',
  payload,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
} = {}) {
  if (!queryable || typeof queryable.query !== 'function') {
    throw new TypeError('Google Wallet outbox 缺少資料庫連線');
  }
  const normalizedPayload = normalizePayload(payload);
  const normalizedObjectId = String(objectId || normalizedPayload.id || '').trim();
  const normalizedAction = String(action || 'UPSERT').toUpperCase() === 'INACTIVATE'
    ? 'INACTIVATE'
    : 'UPSERT';
  const normalizedMaxAttempts = Math.max(1, Math.min(50, Number(maxAttempts) || DEFAULT_MAX_ATTEMPTS));
  await queryable.query(
    `INSERT INTO google_wallet_object_sync_jobs
       (object_type, resource_type, resource_id, holder_user_id, object_id, action, payload,
        generation, status, attempts, max_attempts, available_at, lease_owner, lease_expires_at,
        last_error_code, last_error_message, completed_at)
     VALUES ('generic', ?, ?, ?, ?, ?, CAST(? AS JSON), 1, 'pending', 0, ?, NOW(), NULL, NULL, NULL, NULL, NULL)
     ON DUPLICATE KEY UPDATE
       object_type = VALUES(object_type),
       resource_type = VALUES(resource_type),
       resource_id = VALUES(resource_id),
       holder_user_id = VALUES(holder_user_id),
       action = VALUES(action),
       payload = VALUES(payload),
       generation = generation + 1,
       attempts = 0,
       max_attempts = VALUES(max_attempts),
       available_at = NOW(),
       lease_owner = IF(
         status = 'processing' AND lease_owner IS NOT NULL AND lease_expires_at > NOW(),
         lease_owner,
         NULL
       ),
       lease_expires_at = IF(
         lease_owner IS NOT NULL AND lease_expires_at > NOW(),
         lease_expires_at,
         NULL
       ),
       status = IF(
         lease_owner IS NOT NULL AND lease_expires_at > NOW(),
         'processing',
         'pending'
       ),
       last_error_code = NULL,
       last_error_message = NULL,
       completed_at = NULL`,
    [
      String(resourceType || 'reservation').slice(0, 32),
      resourceId == null ? null : Number(resourceId),
      holderUserId == null ? null : String(holderUserId).slice(0, 36),
      normalizedObjectId,
      normalizedAction,
      JSON.stringify(normalizedPayload),
      normalizedMaxAttempts,
    ]
  );
  return { objectId: normalizedObjectId, action: normalizedAction };
}

function safeInt(value, fallback, min, max) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function backoffSeconds(attempt) {
  const exponent = Math.max(0, Math.min(8, Number(attempt || 1) - 1));
  return Math.min(15 * 60, 5 * (2 ** exponent));
}

async function claimGoogleWalletObjectSyncJobs(pool, {
  objectId = null,
  limit = DEFAULT_BATCH_SIZE,
  leaseSeconds = DEFAULT_LEASE_SECONDS,
  leaseOwner = `wallet-${process.pid}-${crypto.randomUUID()}`,
} = {}) {
  const normalizedLimit = safeInt(limit, DEFAULT_BATCH_SIZE, 1, 100);
  const normalizedLeaseSeconds = safeInt(leaseSeconds, DEFAULT_LEASE_SECONDS, 10, 10 * 60);
  const clauses = [
    "((status = 'pending' AND available_at <= NOW()) OR (status = 'processing' AND lease_expires_at < NOW()))",
  ];
  const params = [leaseOwner, normalizedLeaseSeconds];
  if (objectId) {
    clauses.push('object_id = ?');
    params.push(String(objectId));
  }
  await pool.query(
    `UPDATE google_wallet_object_sync_jobs
        SET status = 'processing',
            lease_owner = ?,
            lease_expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND)
      WHERE ${clauses.join(' AND ')}
      ORDER BY available_at ASC, id ASC
      LIMIT ${normalizedLimit}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT id, object_id, action, payload, generation, attempts, max_attempts
       FROM google_wallet_object_sync_jobs
      WHERE status = 'processing' AND lease_owner = ?
      ORDER BY id ASC`,
    [leaseOwner]
  );
  return { leaseOwner, rows: Array.isArray(rows) ? rows : [] };
}

function parseJobPayload(value) {
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) return value;
  return JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : String(value || '{}'));
}

function errorMessage(error) {
  return String(error?.message || 'Google Wallet object sync failed').slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

async function completeJob(pool, job, leaseOwner) {
  const [result] = await pool.query(
    `UPDATE google_wallet_object_sync_jobs
        SET status = 'completed',
            lease_owner = NULL,
            lease_expires_at = NULL,
            last_error_code = NULL,
            last_error_message = NULL,
            completed_at = NOW()
      WHERE id = ? AND generation = ? AND status = 'processing' AND lease_owner = ?`,
    [job.id, job.generation, leaseOwner]
  );
  return Number(result?.affectedRows || 0) > 0;
}

async function failJob(pool, job, leaseOwner, error) {
  const attempt = Number(job.attempts || 0) + 1;
  const configurationPending = error?.code === 'GOOGLE_WALLET_NOT_CONFIGURED';
  const terminal = isGoogleWalletTerminalError(error)
    || !isGoogleWalletTransientError(error)
    || attempt >= Number(job.max_attempts || DEFAULT_MAX_ATTEMPTS);
  const code = googleWalletSyncErrorCode(error);
  const message = errorMessage(error);
  if (configurationPending) {
    const [result] = await pool.query(
      `UPDATE google_wallet_object_sync_jobs
          SET status = 'pending',
              available_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
              lease_owner = NULL,
              lease_expires_at = NULL,
              last_error_code = ?,
              last_error_message = ?,
              completed_at = NULL
        WHERE id = ? AND generation = ? AND status = 'processing' AND lease_owner = ?`,
      [
        CONFIGURATION_RETRY_SECONDS,
        code,
        message,
        job.id,
        job.generation,
        leaseOwner,
      ]
    );
    return {
      updated: Number(result?.affectedRows || 0) > 0,
      terminal: false,
      attempt: Number(job.attempts || 0),
      code,
    };
  }
  if (terminal) {
    const [result] = await pool.query(
      `UPDATE google_wallet_object_sync_jobs
          SET status = 'failed',
              attempts = ?,
              lease_owner = NULL,
              lease_expires_at = NULL,
              last_error_code = ?,
              last_error_message = ?,
              completed_at = NULL
        WHERE id = ? AND generation = ? AND status = 'processing' AND lease_owner = ?`,
      [attempt, code, message, job.id, job.generation, leaseOwner]
    );
    return {
      updated: Number(result?.affectedRows || 0) > 0,
      terminal: true,
      attempt,
      code,
    };
  }
  const [result] = await pool.query(
    `UPDATE google_wallet_object_sync_jobs
        SET status = 'pending',
            attempts = ?,
            available_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
            lease_owner = NULL,
            lease_expires_at = NULL,
            last_error_code = ?,
            last_error_message = ?,
            completed_at = NULL
      WHERE id = ? AND generation = ? AND status = 'processing' AND lease_owner = ?`,
    [attempt, backoffSeconds(attempt), code, message, job.id, job.generation, leaseOwner]
  );
  return {
    updated: Number(result?.affectedRows || 0) > 0,
    terminal: false,
    attempt,
    code,
  };
}

async function renewJobLease(pool, job, leaseOwner, leaseSeconds) {
  const [result] = await pool.query(
    `UPDATE google_wallet_object_sync_jobs
        SET lease_expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND)
      WHERE id = ? AND generation = ? AND status = 'processing' AND lease_owner = ?`,
    [leaseSeconds, job.id, job.generation, leaseOwner]
  );
  return Number(result?.affectedRows || 0) > 0;
}

async function loadLatestLeasedJob(pool, jobId, leaseOwner) {
  const [rows] = await pool.query(
    `SELECT id, object_id, action, payload, generation, attempts, max_attempts
       FROM google_wallet_object_sync_jobs
      WHERE id = ? AND status = 'processing' AND lease_owner = ?
      LIMIT 1`,
    [jobId, leaseOwner]
  );
  return rows?.[0] || null;
}

async function releaseLeasedJob(pool, job, leaseOwner) {
  await pool.query(
    `UPDATE google_wallet_object_sync_jobs
        SET status = 'pending',
            available_at = NOW(),
            lease_owner = NULL,
            lease_expires_at = NULL
      WHERE id = ? AND generation = ? AND status = 'processing' AND lease_owner = ?`,
    [job.id, job.generation, leaseOwner]
  );
}

async function processGoogleWalletObjectSyncJobs({
  pool,
  env = process.env,
  request,
  objectId = null,
  limit = DEFAULT_BATCH_SIZE,
  leaseSeconds = DEFAULT_LEASE_SECONDS,
  logger = console,
} = {}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('Google Wallet worker 缺少資料庫連線池');
  }
  const normalizedLimit = safeInt(limit, DEFAULT_BATCH_SIZE, 1, 100);
  const requestTimeoutMs = safeInt(env.GOOGLE_WALLET_SYNC_TIMEOUT_MS, 5_000, 1_000, 30_000);
  const minimumLeaseSeconds = Math.ceil((requestTimeoutMs * 2) / 1000) + 30;
  const normalizedLeaseSeconds = Math.max(
    safeInt(leaseSeconds, DEFAULT_LEASE_SECONDS, 10, 10 * 60),
    minimumLeaseSeconds
  );
  const results = [];
  let requester = request;
  for (let claimedCount = 0; claimedCount < normalizedLimit; claimedCount += 1) {
    const claimed = await claimGoogleWalletObjectSyncJobs(pool, {
      objectId,
      limit: 1,
      leaseSeconds: normalizedLeaseSeconds,
    });
    let job = claimed.rows[0] || null;
    if (!job) break;
    let generationDrains = 0;
    while (job) {
      const renewed = await renewJobLease(
        pool,
        job,
        claimed.leaseOwner,
        normalizedLeaseSeconds
      );
      if (!renewed) {
        job = await loadLatestLeasedJob(pool, job.id, claimed.leaseOwner);
        if (job) continue;
        break;
      }
      try {
        const object = parseJobPayload(job.payload);
        if (!requester) requester = await createGoogleWalletApiRequester(env);
        const result = await syncGenericObjectIfSaved({ object, env, request: requester });
        const completed = await completeJob(pool, job, claimed.leaseOwner);
        if (completed) {
          results.push({ id: job.id, objectId: job.object_id, ok: true, ...result });
          break;
        }
      } catch (error) {
        const failure = await failJob(pool, job, claimed.leaseOwner, error);
        if (failure.updated) {
          if (failure.terminal) {
            logger?.error?.('[google-wallet] object sync failed', {
              objectId: job.object_id,
              code: failure.code,
              attempts: failure.attempt,
            });
          }
          results.push({
            id: job.id,
            objectId: job.object_id,
            ok: false,
            retrying: !failure.terminal,
            code: failure.code,
          });
          break;
        }
      }

      const latest = await loadLatestLeasedJob(pool, job.id, claimed.leaseOwner);
      if (!latest) break;
      generationDrains += 1;
      if (generationDrains >= MAX_GENERATION_DRAINS) {
        await releaseLeasedJob(pool, latest, claimed.leaseOwner);
        break;
      }
      job = latest;
    }
  }
  return results;
}

function startGoogleWalletObjectSyncWorker({
  pool,
  env = process.env,
  logger = console,
  intervalMs = Number(env.GOOGLE_WALLET_SYNC_INTERVAL_MS || 30_000),
} = {}) {
  if (String(env.GOOGLE_WALLET_SYNC_WORKER || '1') === '0') {
    return { run: async () => [], stop() {} };
  }
  const delay = safeInt(intervalMs, 30_000, 5_000, 10 * 60_000);
  let running = false;
  const run = async () => {
    if (running) return [];
    running = true;
    try {
      return await processGoogleWalletObjectSyncJobs({ pool, env, logger });
    } catch (error) {
      if (error?.code !== 'ER_NO_SUCH_TABLE') {
        logger?.error?.('[google-wallet] worker error', {
          code: String(error?.code || error?.name || 'UNKNOWN'),
          message: errorMessage(error),
        });
      }
      return [];
    } finally {
      running = false;
    }
  };
  const firstRun = setTimeout(run, 1_000);
  const timer = setInterval(run, delay);
  firstRun.unref?.();
  timer.unref?.();
  return {
    run,
    stop() {
      clearTimeout(firstRun);
      clearInterval(timer);
    },
  };
}

module.exports = {
  GOOGLE_WALLET_ISSUER_SCOPE,
  backoffSeconds,
  claimGoogleWalletObjectSyncJobs,
  createGoogleWalletApiRequester,
  enqueueGoogleWalletObjectSync,
  googleWalletSyncErrorCode,
  isGoogleWalletNotFound,
  isGoogleWalletTerminalError,
  isGoogleWalletTransientError,
  processGoogleWalletObjectSyncJobs,
  resolveGoogleWalletRestCredentials,
  startGoogleWalletObjectSyncWorker,
  syncGenericObjectIfSaved,
};
