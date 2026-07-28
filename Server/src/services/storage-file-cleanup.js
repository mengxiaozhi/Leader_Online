const crypto = require('crypto');

const DEFAULT_LEASE_SECONDS = 60;
const DEFAULT_BATCH_SIZE = 10;
const MAX_ERROR_MESSAGE_LENGTH = 1000;

function safeInt(value, fallback, min, max) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function storageCleanupBackoffSeconds(attempt) {
  const exponent = Math.max(0, Math.min(8, Number(attempt || 1) - 1));
  return Math.min(15 * 60, 5 * (2 ** exponent));
}

function normalizeStorageCleanupPath(storage, value) {
  if (!storage || typeof storage.toSafeRelativePath !== 'function') {
    throw new TypeError('檔案清理工作缺少 storage 服務');
  }
  const normalized = storage.toSafeRelativePath(value);
  if (!normalized) {
    const error = new Error('檔案清理路徑不安全');
    error.code = 'UNSAFE_STORAGE_PATH';
    throw error;
  }
  return normalized;
}

async function enqueueStorageFileCleanup(queryable, storage, storagePath) {
  if (!queryable || typeof queryable.query !== 'function') {
    throw new TypeError('檔案清理工作缺少資料庫連線');
  }
  const normalizedPath = normalizeStorageCleanupPath(storage, storagePath);
  await queryable.query(
    `INSERT INTO storage_file_cleanup_jobs
       (storage_path, status, attempts, available_at, lease_owner, lease_expires_at,
        last_error_code, last_error_message, completed_at)
     VALUES (?, 'pending', 0, NOW(), NULL, NULL, NULL, NULL, NULL)
     ON DUPLICATE KEY UPDATE
       status = 'pending',
       attempts = 0,
       available_at = NOW(),
       lease_owner = NULL,
       lease_expires_at = NULL,
       last_error_code = NULL,
       last_error_message = NULL,
       completed_at = NULL`,
    [normalizedPath]
  );
  return normalizedPath;
}

async function claimStorageFileCleanupJob(pool, {
  storagePath = null,
  leaseSeconds = DEFAULT_LEASE_SECONDS,
  leaseOwner = `storage-${process.pid}-${crypto.randomUUID()}`,
} = {}) {
  const normalizedLeaseSeconds = safeInt(leaseSeconds, DEFAULT_LEASE_SECONDS, 10, 10 * 60);
  const clauses = [
    "((status = 'pending' AND available_at <= NOW()) OR (status = 'processing' AND lease_expires_at < NOW()))",
  ];
  const params = [leaseOwner, normalizedLeaseSeconds];
  if (storagePath) {
    clauses.push('storage_path = ?');
    params.push(String(storagePath));
  }
  await pool.query(
    `UPDATE storage_file_cleanup_jobs
        SET status = 'processing',
            lease_owner = ?,
            lease_expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND)
      WHERE ${clauses.join(' AND ')}
      ORDER BY available_at ASC, id ASC
      LIMIT 1`,
    params
  );
  const [rows] = await pool.query(
    `SELECT id, storage_path, attempts
       FROM storage_file_cleanup_jobs
      WHERE status = 'processing' AND lease_owner = ?
      ORDER BY id ASC
      LIMIT 1`,
    [leaseOwner]
  );
  return { leaseOwner, job: rows?.[0] || null };
}

async function processStorageFileCleanupJobs({
  pool,
  storage,
  storagePath = null,
  limit = DEFAULT_BATCH_SIZE,
  logger = console,
} = {}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('檔案清理 worker 缺少資料庫連線池');
  }
  const normalizedLimit = safeInt(limit, DEFAULT_BATCH_SIZE, 1, 100);
  const normalizedPath = storagePath
    ? normalizeStorageCleanupPath(storage, storagePath)
    : null;
  const results = [];
  for (let index = 0; index < normalizedLimit; index += 1) {
    const claimed = await claimStorageFileCleanupJob(pool, {
      storagePath: normalizedPath,
    });
    const job = claimed.job;
    if (!job) break;
    try {
      await storage.deleteFile(normalizeStorageCleanupPath(storage, job.storage_path));
      const [result] = await pool.query(
        `UPDATE storage_file_cleanup_jobs
            SET status = 'completed',
                lease_owner = NULL,
                lease_expires_at = NULL,
                last_error_code = NULL,
                last_error_message = NULL,
                completed_at = NOW()
          WHERE id = ? AND status = 'processing' AND lease_owner = ?`,
        [job.id, claimed.leaseOwner]
      );
      if (Number(result?.affectedRows || 0) > 0) {
        results.push({ id: job.id, storagePath: job.storage_path, ok: true });
      }
    } catch (error) {
      const attempt = Math.min(65_535, Number(job.attempts || 0) + 1);
      const code = String(error?.code || error?.name || 'STORAGE_DELETE_FAIL').slice(0, 64);
      const message = String(error?.message || 'Storage file cleanup failed')
        .slice(0, MAX_ERROR_MESSAGE_LENGTH);
      const [result] = await pool.query(
        `UPDATE storage_file_cleanup_jobs
            SET status = 'pending',
                attempts = ?,
                available_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
                lease_owner = NULL,
                lease_expires_at = NULL,
                last_error_code = ?,
                last_error_message = ?,
                completed_at = NULL
          WHERE id = ? AND status = 'processing' AND lease_owner = ?`,
        [
          attempt,
          storageCleanupBackoffSeconds(attempt),
          code,
          message,
          job.id,
          claimed.leaseOwner,
        ]
      );
      if (Number(result?.affectedRows || 0) > 0) {
        logger?.warn?.('[storage-cleanup] file deletion deferred', {
          storagePath: job.storage_path,
          code,
          attempts: attempt,
        });
        results.push({
          id: job.id,
          storagePath: job.storage_path,
          ok: false,
          retrying: true,
          code,
        });
      }
    }
  }
  return results;
}

function startStorageFileCleanupWorker({
  pool,
  storage,
  logger = console,
  intervalMs = Number(process.env.STORAGE_FILE_CLEANUP_INTERVAL_MS || 30_000),
} = {}) {
  const delay = safeInt(intervalMs, 30_000, 5_000, 10 * 60_000);
  let running = false;
  const run = async () => {
    if (running) return [];
    running = true;
    try {
      return await processStorageFileCleanupJobs({ pool, storage, logger });
    } catch (error) {
      if (error?.code !== 'ER_NO_SUCH_TABLE') {
        logger?.error?.('[storage-cleanup] worker error', {
          code: String(error?.code || error?.name || 'UNKNOWN'),
          message: String(error?.message || error),
        });
      }
      return [];
    } finally {
      running = false;
    }
  };
  const firstRun = setTimeout(run, 2_000);
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
  claimStorageFileCleanupJob,
  enqueueStorageFileCleanup,
  normalizeStorageCleanupPath,
  processStorageFileCleanupJobs,
  startStorageFileCleanupWorker,
  storageCleanupBackoffSeconds,
};
