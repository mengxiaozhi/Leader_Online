const test = require('node:test');
const assert = require('node:assert/strict');

const {
  enqueueStorageFileCleanup,
  processStorageFileCleanupJobs,
  storageCleanupBackoffSeconds,
} = require('../src/services/storage-file-cleanup');

function createStorage({
  deleteFile = async () => true,
} = {}) {
  return {
    toSafeRelativePath(value) {
      const normalized = String(value || '').replace(/^\/+/, '');
      return normalized.startsWith('reservation-checklists/') ? normalized : '';
    },
    deleteFile,
  };
}

function createWorkerPool(job) {
  const calls = [];
  let claimed = false;
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (
        sql.includes('SELECT id, storage_path, attempts')
        && sql.includes("WHERE status = 'processing' AND lease_owner = ?")
      ) {
        if (claimed) return [[]];
        claimed = true;
        return [[job]];
      }
      return [{ affectedRows: 1 }];
    },
  };
}

test('storage cleanup enqueue validates the path and persists it transactionally', async () => {
  const calls = [];
  const queryable = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
  };
  const storage = createStorage();

  const path = await enqueueStorageFileCleanup(
    queryable,
    storage,
    '/reservation-checklists/9/photo.webp'
  );

  assert.equal(path, 'reservation-checklists/9/photo.webp');
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /ON DUPLICATE KEY UPDATE/);
  assert.deepEqual(calls[0].params, ['reservation-checklists/9/photo.webp']);
  await assert.rejects(
    enqueueStorageFileCleanup(queryable, storage, '../../private-key.pem'),
    (error) => error?.code === 'UNSAFE_STORAGE_PATH'
  );
});

test('storage cleanup worker treats an already-missing file as completed', async () => {
  const job = {
    id: 7,
    storage_path: 'reservation-checklists/9/missing.webp',
    attempts: 0,
  };
  const pool = createWorkerPool(job);
  const deleted = [];
  const storage = createStorage({
    async deleteFile(path) {
      deleted.push(path);
      return false;
    },
  });

  const results = await processStorageFileCleanupJobs({
    pool,
    storage,
    limit: 1,
  });

  assert.deepEqual(deleted, [job.storage_path]);
  assert.equal(results[0].ok, true);
  assert.ok(pool.calls.some((call) => call.sql.includes("SET status = 'completed'")));
});

test('storage cleanup worker retains failed deletions with exponential backoff', async () => {
  const job = {
    id: 8,
    storage_path: 'reservation-checklists/9/retry.webp',
    attempts: 2,
  };
  const pool = createWorkerPool(job);
  const storage = createStorage({
    async deleteFile() {
      const error = new Error('volume temporarily unavailable');
      error.code = 'EIO';
      throw error;
    },
  });

  const results = await processStorageFileCleanupJobs({
    pool,
    storage,
    limit: 1,
    logger: { warn() {} },
  });

  assert.equal(results[0].retrying, true);
  const pending = pool.calls.find((call) => call.sql.includes("SET status = 'pending'"));
  assert.ok(pending);
  assert.equal(pending.params[0], 3);
  assert.equal(pending.params[1], 20);
  assert.equal(pending.params[2], 'EIO');
  assert.equal(storageCleanupBackoffSeconds(10), 900);
});
