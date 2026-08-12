'use strict';

const { createCourseTermDomain } = require('./course-term-domain');
const { createCourseTermAdminDomain } = require('./course-term-admin-domain');
const { processCourseNotificationOutbox } = require('./course-notification-outbox');

const COURSE_PRODUCTIZATION_WORKER_LOCK = 'leader_online_course_productization';

function enabledByEnvironment({
  fixedTerm = process.env.COURSE_FIXED_TERM_ENABLED,
  advancedPayments = process.env.COURSE_ADVANCED_PAYMENTS_ENABLED,
} = {}) {
  const truthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
  return truthy(fixedTerm) || truthy(advancedPayments);
}

function advancedPaymentsEnabledByEnvironment(
  value = process.env.COURSE_ADVANCED_PAYMENTS_ENABLED
) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

async function processCourseProductizationJobs({
  pool,
  domain = null,
  adminDomain = null,
  notificationProcessor = processCourseNotificationOutbox,
  limit = 50,
  logger = console,
  transporter = null,
  isMailerReady = () => false,
  fromName = 'Leader Online',
  fromAddress = '',
  publicWebUrl = 'http://localhost:5173',
  advancedPaymentsEnabled = advancedPaymentsEnabledByEnvironment(),
  fixedTermEnabled = enabledByEnvironment({ fixedTerm: process.env.COURSE_FIXED_TERM_ENABLED, advancedPayments: false }),
} = {}) {
  if (!pool) throw new TypeError('course productization worker requires a database pool');
  const courseTerms = domain || createCourseTermDomain({
    pool,
    enabled: fixedTermEnabled,
    advancedPaymentsEnabled,
  });
  const termAdmin = adminDomain || createCourseTermAdminDomain({ pool, termDomain: courseTerms });
  const lease = await pool.getConnection();
  let acquired = false;
  try {
    const [[lock]] = await lease.query('SELECT GET_LOCK(?, 0) AS acquired', [COURSE_PRODUCTIZATION_WORKER_LOCK]);
    acquired = Number(lock?.acquired || 0) === 1;
    if (!acquired) return { enabled: true, acquired: false, expiredOrders: [] };
    // Feature flags gate new business resources, not compensation for rows
    // already committed before a rollback. Migration readiness is the safe
    // boundary for expiry and outbox delivery.
    const schema = await courseTerms.readSchemaState({ refresh: true });
    const termSchemaReady = Boolean(schema?.termSchemaReady);
    const paymentSchemaReady = Boolean(schema?.paymentSchemaReady);
    const expiredOrders = termSchemaReady && paymentSchemaReady
      ? await courseTerms.expireDueHolds({ limit, requireEnabled: false })
      : [];
    const expiredWaitlistOffers = termSchemaReady
      ? await termAdmin.expireDueSeatOffers({ limit, requireEnabled: false })
      : [];
    const createdWaitlistOffers = termSchemaReady && fixedTermEnabled
      ? await termAdmin.fillAvailableWaitlistOffers({ limit })
      : [];
    const notifications = paymentSchemaReady
      ? await notificationProcessor({
        pool,
        transporter,
        isMailerReady,
        fromName,
        fromAddress,
        publicWebUrl,
        limit,
        logger,
      })
      : [];
    return {
      enabled: true,
      acquired: true,
      expiredOrders,
      expiredWaitlistOffers,
      createdWaitlistOffers,
      notifications,
    };
  } catch (error) {
    logger?.error?.('[course-productization-worker] batch failed:', error?.message || error);
    throw error;
  } finally {
    if (acquired) {
      try { await lease.query('SELECT RELEASE_LOCK(?) AS released', [COURSE_PRODUCTIZATION_WORKER_LOCK]); } catch (_) {}
    }
    lease.release();
  }
}

function startCourseProductizationWorker({
  pool,
  intervalMs = Number(process.env.COURSE_PRODUCTIZATION_WORKER_INTERVAL_MS || 60000),
  batchSize = Number(process.env.COURSE_PRODUCTIZATION_WORKER_BATCH_SIZE || 50),
  logger = console,
  // Keep compensation alive when product feature flags are rolled back.
  // Callers may still supply an explicit worker-level kill switch.
  enabled = true,
  advancedPaymentsEnabled = advancedPaymentsEnabledByEnvironment(),
  fixedTermEnabled = enabledByEnvironment({ fixedTerm: process.env.COURSE_FIXED_TERM_ENABLED, advancedPayments: false }),
  transporter = null,
  isMailerReady = () => false,
  fromName = 'Leader Online',
  fromAddress = '',
  publicWebUrl = 'http://localhost:5173',
} = {}) {
  if (!enabled) return { enabled: false, stop() {} };
  const domain = createCourseTermDomain({
    pool,
    enabled: fixedTermEnabled,
    advancedPaymentsEnabled,
  });
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await processCourseProductizationJobs({
        pool,
        domain,
        limit: batchSize,
        logger,
        transporter,
        isMailerReady,
        fromName,
        fromAddress,
        publicWebUrl,
        advancedPaymentsEnabled,
        fixedTermEnabled,
      });
    } catch (_) {
      // The next leased tick retries; domain writes are transactional.
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
  COURSE_PRODUCTIZATION_WORKER_LOCK,
  advancedPaymentsEnabledByEnvironment,
  enabledByEnvironment,
  processCourseProductizationJobs,
  startCourseProductizationWorker,
};
