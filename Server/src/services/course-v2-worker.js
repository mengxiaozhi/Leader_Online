const { createCourseV2Domain } = require('./course-v2-domain');

const COURSE_V2_WORKER_LOCK = 'leader_online_course_v2_invites';

function enabledByEnvironment(value = process.env.COURSE_V2_ENABLED) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

async function processCourseV2AttendanceInvites({
  pool,
  domain = null,
  limit = 50,
  logger = console,
} = {}) {
  if (!pool) throw new TypeError('course v2 worker requires a database pool');
  const courseV2 = domain || createCourseV2Domain({ pool });
  if (!courseV2.enabled) return { enabled: false, acquired: false, processed: [] };
  await courseV2.assertSchema();

  // MySQL named locks are connection-scoped. Keeping this connection until the
  // batch finishes gives main/v1 and horizontally scaled processes one shared
  // lease without holding a business transaction open.
  const lease = await pool.getConnection();
  let acquired = false;
  try {
    const [[lockRow]] = await lease.query('SELECT GET_LOCK(?, 0) AS acquired', [
      COURSE_V2_WORKER_LOCK,
    ]);
    acquired = Number(lockRow?.acquired || 0) === 1;
    if (!acquired) return { enabled: true, acquired: false, processed: [] };
    const invites = await courseV2.processDueAttendanceInvites({ limit });
    const autoNoShows = await courseV2.processDueAutoNoShows({ limit });
    return {
      enabled: true,
      acquired: true,
      processed: invites,
      invites,
      autoNoShows,
    };
  } catch (error) {
    logger?.error?.('[course-v2-worker] attendance invite batch failed:', error?.message || error);
    throw error;
  } finally {
    if (acquired) {
      try {
        await lease.query('SELECT RELEASE_LOCK(?) AS released', [COURSE_V2_WORKER_LOCK]);
      } catch (error) {
        logger?.error?.('[course-v2-worker] lease release failed:', error?.message || error);
      }
    }
    lease.release();
  }
}

function startCourseV2Worker({
  pool,
  intervalMs = Number(process.env.COURSE_V2_WORKER_INTERVAL_MS || 60000),
  batchSize = Number(process.env.COURSE_V2_WORKER_BATCH_SIZE || 50),
  logger = console,
  enabled = enabledByEnvironment(),
} = {}) {
  if (!enabled) return { enabled: false, stop() {} };
  const domain = createCourseV2Domain({ pool, enabled: true });
  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await processCourseV2AttendanceInvites({
        pool,
        domain,
        limit: batchSize,
        logger,
      });
    } catch (_) {
      // The next leased tick retries. Business mutations remain transactional.
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, Math.max(5000, intervalMs));
  timer.unref?.();
  setImmediate(tick);
  return {
    enabled: true,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

module.exports = {
  COURSE_V2_WORKER_LOCK,
  enabledByEnvironment,
  processCourseV2AttendanceInvites,
  startCourseV2Worker,
};
