'use strict';

const {
  schemaReady, syncHandoverRecipients, storeRecipients, notificationIsRelevant,
  handoverEmail, sqlDate,
} = require('./handover-schedule');
const WORKER_LOCK = 'leader_online_handover_notifications';

async function deliverJob({ pool, connection, job, transporter, isMailerReady, fromName, fromAddress, publicWebUrl, buildLeaderEmailHtml, now }) {
  const startedAt = Date.now();
  const conn = connection || await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Serialize delivery with schedule changes. Current holder rows are locked
    // through SMTP submission so a committed transfer cannot leak to the old holder.
    const [[store]] = await conn.query(`SELECT s.*, e.title AS event_title, e.location AS event_location
      FROM event_stores s LEFT JOIN events e ON e.id = s.event_id WHERE s.id = ? FOR UPDATE`, [job.store_id]);
    const rows = store ? (await storeRecipients(conn, job.store_id, { lock: true })).filter(row => String(row.user_id) === String(job.user_id)) : [];
    const [[user]] = await conn.query('SELECT email FROM users WHERE id = ?', [job.user_id]);
    const checkedAt = new Date(now.getTime() + Date.now() - startedAt);
    if (!store || !notificationIsRelevant(job, store, rows, checkedAt)) {
      await conn.query("UPDATE handover_notification_outbox SET status = 'SKIPPED', locked_at = NULL, last_error = '預約、持有人或時程已變更' WHERE id = ?", [job.id]);
      await conn.commit();
      return { id: job.id, status: 'SKIPPED' };
    }
    if (!user?.email) throw new Error('用戶尚未設定 Email');
    if (!transporter || !isMailerReady()) throw new Error('SMTP 尚未設定或未就緒');
    const content = handoverEmail(job, store, rows);
    const actionUrl = `${publicWebUrl.replace(/\/$/, '')}/wallet?tab=reservations`;
    const escaped = content.text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const message = {
      from: `"${fromName}" <${fromAddress}>`, to: user.email, subject: content.subject,
      messageId: `<handover-${job.dedupe_key}@leader-online>`,
      text: `${content.text}\n\n查看預約詳情：${actionUrl}`,
      html: buildLeaderEmailHtml ? buildLeaderEmailHtml({ title: content.subject, childrenHtml: `<p style="white-space:pre-line">${escaped}</p>`, actionUrl, actionText: '查看預約詳情' }) : undefined,
    };
    await transporter.sendMail(message);
    await conn.query("UPDATE handover_notification_outbox SET status = 'SENT', sent_at = ?, locked_at = NULL, last_error = NULL WHERE id = ?", [sqlDate(new Date(now.getTime() + Date.now() - startedAt)), job.id]);
    await conn.commit();
    return { id: job.id, status: 'SENT' };
  } catch (error) {
    await conn.rollback();
    const attempts = Number(job.attempts || 0) + 1;
    const dueAt = new Date(now.getTime() + Math.min(60, 2 ** attempts) * 60000);
    await conn.query(`UPDATE handover_notification_outbox SET status = ?, due_at = ?, locked_at = NULL, last_error = ? WHERE id = ?`,
      [attempts >= 10 ? 'DEAD' : 'FAILED', sqlDate(dueAt), String(error.message || error).slice(0, 2000), job.id]);
    return { id: job.id, status: attempts >= 10 ? 'DEAD' : 'FAILED' };
  } finally { if (!connection) conn.release(); }
}

async function processHandoverNotifications({ pool, transporter, isMailerReady = () => false, fromName = 'Leader Online', fromAddress = '',
  publicWebUrl = 'http://localhost:5173', buildLeaderEmailHtml, now = new Date(), limit = 50, afterStoreId = 0, logger = console } = {}) {
  const startedAt = Date.now();
  if (!(await schemaReady(pool))) return { available: false, results: [], afterStoreId: 0 };
  const lease = await pool.getConnection();
  let acquired = false;
  try {
    const [[lock]] = await lease.query('SELECT GET_LOCK(?, 0) AS acquired', [WORKER_LOCK]);
    acquired = Number(lock.acquired) === 1;
    if (!acquired) return { available: true, acquired: false, results: [], afterStoreId };
    const [stores] = await lease.query('SELECT id FROM event_stores WHERE id > ? ORDER BY id LIMIT ?', [afterStoreId, limit]);
    const reconciliationErrors = [];
    for (const store of stores) {
      await lease.beginTransaction();
      try {
        await syncHandoverRecipients(lease, { storeIds: [store.id], now, ready: true });
        await lease.commit();
      } catch (error) {
        await lease.rollback();
        reconciliationErrors.push(store.id);
        logger.error('[handover-notifications] recipient reconciliation failed', store.id, error.message);
      }
    }
    await lease.query(`UPDATE handover_notification_outbox SET status = CASE WHEN attempts >= 10 THEN 'DEAD' ELSE 'FAILED' END, locked_at = NULL,
      last_error = '寄送工作逾時，重新排程' WHERE status = 'PROCESSING' AND locked_at < ?`, [sqlDate(new Date(now.getTime() - 15 * 60000))]);
    const [jobs] = await lease.query(`SELECT * FROM handover_notification_outbox
      WHERE status IN ('PENDING','FAILED') AND due_at <= ? AND attempts < 10 ORDER BY due_at, id LIMIT ?`, [sqlDate(now), limit]);
    const results = [];
    for (const job of jobs) {
      const [claimed] = await lease.query("UPDATE handover_notification_outbox SET status = 'PROCESSING', attempts = attempts + 1, locked_at = ? WHERE id = ? AND status IN ('PENDING','FAILED')", [sqlDate(now), job.id]);
      if (!claimed.affectedRows) continue;
      results.push(await deliverJob({ pool, connection: lease, job, transporter, isMailerReady, fromName, fromAddress, publicWebUrl, buildLeaderEmailHtml,
        now: new Date(now.getTime() + Date.now() - startedAt) }));
    }
    return { available: true, acquired: true, results, reconciliationErrors, afterStoreId: stores.length === limit ? Number(stores.at(-1).id) : 0 };
  } finally {
    if (acquired) { try { await lease.query('SELECT RELEASE_LOCK(?)', [WORKER_LOCK]); } catch {} }
    lease.release();
  }
}

function startHandoverNotificationWorker(options = {}) {
  let running = false;
  let stopped = false;
  let afterStoreId = 0;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const result = await processHandoverNotifications({ ...options, afterStoreId });
      afterStoreId = result.afterStoreId;
    } catch (error) { (options.logger || console).error('[handover-notifications]', error.message); }
    finally { running = false; }
  };
  const timer = setInterval(tick, options.intervalMs || 60000);
  timer.unref?.();
  void tick();
  return { stop() { stopped = true; clearInterval(timer); } };
}

module.exports = { WORKER_LOCK, deliverJob, processHandoverNotifications, startHandoverNotificationWorker };
