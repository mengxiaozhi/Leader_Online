'use strict';

const COURSE_NOTIFICATION_SCHEMA_VERSION = '053_course_term_payments_notifications';

function text(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function enabledFlag(value) {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

async function courseNotificationOutboxAvailability(conn, {
  runtimeEnabled = false,
  schemaReady = null,
  schemaVersion = COURSE_NOTIFICATION_SCHEMA_VERSION,
  ownerUserId = null,
  requireProviderAdvancedPayments = false,
} = {}) {
  if (!enabledFlag(runtimeEnabled)) {
    return { available: false, reason: 'advanced_payments_disabled' };
  }

  let resolvedSchemaReady = schemaReady;
  if (resolvedSchemaReady == null) {
    const [versions] = await conn.query(
      'SELECT version FROM course_schema_versions WHERE version = ? LIMIT 1',
      [schemaVersion]
    );
    resolvedSchemaReady = Boolean(versions[0]);
  }
  if (!resolvedSchemaReady) {
    return { available: false, reason: 'payment_schema_not_ready' };
  }

  if (!requireProviderAdvancedPayments) return { available: true };

  const scopeKeys = ownerUserId
    ? ['platform', `provider:${ownerUserId}`]
    : ['platform'];
  const [settingsRows] = await conn.query(
    `SELECT scope_key, advanced_payments_enabled
       FROM course_settings
      WHERE scope_key IN (${scopeKeys.map(() => '?').join(',')})`,
    scopeKeys
  );
  const settings = new Map(settingsRows.map((row) => [String(row.scope_key), row]));
  const platformEnabled = Number(settings.get('platform')?.advanced_payments_enabled || 0) === 1;
  const providerEnabled = ownerUserId
    ? Number(settings.get(`provider:${ownerUserId}`)?.advanced_payments_enabled || 0) === 1
    : platformEnabled;
  if (!platformEnabled || !providerEnabled) {
    return { available: false, reason: 'provider_advanced_payments_disabled' };
  }
  return { available: true };
}

async function enqueueCourseNotificationOutbox(conn, notifications, options = {}) {
  if (!conn?.query) throw new TypeError('notification outbox enqueue requires a database connection');
  const entries = (Array.isArray(notifications) ? notifications : [notifications])
    .filter((entry) => entry?.eventType && entry?.dedupeKey);
  if (!entries.length) return { queued: false, reason: 'notification_missing' };

  const availability = await courseNotificationOutboxAvailability(conn, options);
  if (!availability.available) return { queued: false, reason: availability.reason };

  for (const entry of entries) {
    await conn.query(
      `INSERT INTO course_notification_outbox
        (owner_user_id, user_id, event_type, dedupe_key, payload_json,
         status, attempts, available_at)
       VALUES (?, ?, ?, ?, ?, 'PENDING', 0, NOW())
       ON DUPLICATE KEY UPDATE id = id`,
      [
        entry.ownerUserId ?? options.ownerUserId ?? null,
        entry.userId || null,
        entry.eventType,
        entry.dedupeKey,
        JSON.stringify(entry.payload || {}),
      ]
    );
  }
  return { queued: true, count: entries.length };
}

function notificationCopy(row = {}) {
  const payload = parseJson(row.payload_json, {});
  const eventType = String(row.event_type || '').toUpperCase();
  const copy = {
    TERM_ORDER_CREATED: {
      title: '固定班訂單已建立',
      body: payload.payByAt ? `請於 ${payload.payByAt} 前完成匯款資料提交。` : '固定班訂單已建立。',
      actionUrl: '/me/courses/orders',
    },
    TERM_PAYMENT_SUBMITTED: {
      title: '匯款資料已送出',
      body: '席位會保留至人工確認或駁回，管理延遲不會自動釋位。',
      actionUrl: '/me/courses/orders',
    },
    TERM_ENROLLMENT_CONFIRMED: {
      title: '固定班報名完成',
      body: '付款與席位已確認，逐堂課程權益已建立。',
      actionUrl: '/me/courses/enrollments',
    },
    TERM_WAITLIST_OFFERED: {
      title: '候補名額已釋出',
      body: payload.expiresAt ? `請於 ${payload.expiresAt} 前接受並完成報名，逾期將自動輪給下一位。` : '請在限時內接受並完成報名。',
      actionUrl: '/me/courses/enrollments',
    },
    TERM_WAITLIST_ACCEPTED: {
      title: '候補名額已接受',
      body: '候補席位已為你保留，請依頁面指示完成報名與付款。',
      actionUrl: '/me/courses/enrollments',
    },
    TERM_WAITLIST_DECLINED: {
      title: '候補名額已放棄',
      body: '本次候補名額已釋放給下一位學員。',
      actionUrl: '/me/courses/enrollments',
    },
    TERM_WAITLIST_OFFER_EXPIRED: {
      title: '候補名額已逾期',
      body: '限時候補名額已釋放，可回固定班頁面查看其他班期。',
      actionUrl: '/me/courses/enrollments',
    },
    TERM_WAITLIST_JOINED: {
      title: '已加入固定班候補',
      body: '名額釋出後會依順位建立限時 offer，並再次通知。',
      actionUrl: '/me/courses/enrollments',
    },
    TERM_PUBLISHED: {
      title: '固定班已發布',
      body: '班期、價格與規則版本已鎖定並開放報名。',
      actionUrl: '/admin/courses/classes',
    },
    TERM_LEAVE_APPROVED: {
      title: '固定班請假完成',
      body: '有效請假已建立補課權益，請於效期內安排補課。',
      actionUrl: '/me/courses/makeup',
    },
    TERM_LEAVE_CANCELLED: {
      title: '固定班請假已取消',
      body: '原堂權益已恢復，尚未使用的補課權益已收回。',
      actionUrl: '/me/courses/schedule',
    },
    MAKEUP_BOOKED: {
      title: '補課預約完成',
      body: '補課名額已保留，請依場次時間報到。',
      actionUrl: '/me/courses/makeup',
    },
    MAKEUP_CANCELLED: {
      title: '補課預約已取消',
      body: '本次補課席位已釋放，補課權益恢復為可預約。',
      actionUrl: '/me/courses/makeup',
    },
    MAKEUP_ATTENDED: {
      title: '補課出席已確認',
      body: '補課權益已完成履約。',
      actionUrl: '/me/courses/schedule',
    },
    MAKEUP_NO_SHOW: {
      title: '補課未到紀錄已建立',
      body: '本次補課權益已完成判定，如有疑問請聯絡課務人員。',
      actionUrl: '/me/courses/makeup',
    },
    MAKEUP_INSURANCE_ORDER_CREATED: {
      title: '補課保險訂單已建立',
      body: payload.payByAt ? `請於 ${payload.payByAt} 前完成匯款資料提交。` : '請完成補課保險付款。',
      actionUrl: '/me/courses/orders',
    },
    MAKEUP_INSURANCE_ACTIVATED: {
      title: '補課保險已生效',
      body: '付款已確認，補課名額與補課權益已正式生效。',
      actionUrl: '/me/courses/makeup',
    },
    MAKEUP_INSURANCE_EXPIRED: {
      title: '補課保險訂單已逾期',
      body: '付款期限已過，保險訂單與本次補課占位已取消。',
      actionUrl: '/me/courses/makeup',
    },
    MAKEUP_INSURANCE_CANCELLED: {
      title: '補課保險訂單已取消',
      body: '保險訂單與本次補課占位已取消，可重新選擇補課場次。',
      actionUrl: '/me/courses/makeup',
    },
    TERM_ORDER_CANCELLED: {
      title: '固定班訂單已取消',
      body: '訂單、付款工具保留與席位已一併釋放。',
      actionUrl: '/me/courses/orders',
    },
    TERM_ORDER_EXPIRED: {
      title: '固定班訂單已逾期',
      body: '付款期限已過，訂單取消且席位已釋放。',
      actionUrl: '/me/courses/orders',
    },
    COUNT_BOOKING_CREATED: {
      title: payload.sessionTitle ? `課程預約完成：${text(payload.sessionTitle, 120)}` : '課程預約完成',
      body: payload.startsAt
        ? `已保留 ${payload.startsAt} 的場次；預約當下不會扣除堂數。`
        : '場次已保留；預約當下不會扣除堂數。',
      actionUrl: '/me/courses/schedule',
    },
    COUNT_ATTENDANCE_INVITE_CREATED: {
      title: '課程出席補登邀請',
      body: payload.expiryAction === 'auto_redeem'
        ? `請於 ${payload.expiresAt || '邀請到期前'} 確認；到期未回覆將依建立時快照自動核銷。`
        : `請於 ${payload.expiresAt || '邀請到期前'} 登入同一會員帳號確認出席。`,
      actionUrl: payload.inviteToken
        ? `/store?tab=courses&attendanceInvite=${encodeURIComponent(payload.inviteToken)}&version=${encodeURIComponent(payload.rowVersion || 1)}`
        : '/me/courses/schedule',
    },
    COUNT_ATTENDANCE_INVITE_EXPIRED: {
      title: '課程出席補登邀請已到期',
      body: payload.status === 'auto_redeemed'
        ? '已依邀請建立時的明示政策自動核銷出席。'
        : payload.status === 'blocked'
          ? '資料異常，本次未自動扣堂，已保留人工課務判定。'
          : '本次未扣堂，保留已釋放並進入人工課務判定。',
      actionUrl: '/me/courses/schedule',
    },
    COUNT_PARTIAL_TRANSFER_INITIATED: {
      title: '課程票券轉讓待確認',
      body: payload.role === 'recipient'
        ? `有 ${Number(payload.quantity || 0)} 堂票券等待你接受，請於 ${payload.expiresAt || '到期前'} 回覆。`
        : `已為 ${Number(payload.quantity || 0)} 堂轉讓建立保留，等待受讓人回覆。`,
      actionUrl: '/me/courses/passes',
    },
    COUNT_PARTIAL_TRANSFER_ACCEPTED: {
      title: '課程票券轉讓已完成',
      body: payload.role === 'recipient'
        ? `已取得 ${Number(payload.quantity || 0)} 堂子票，可於課程票券查看。`
        : `受讓人已接受 ${Number(payload.quantity || 0)} 堂，來源票已完成帳本轉出。`,
      actionUrl: '/me/courses/passes',
    },
    COUNT_PARTIAL_TRANSFER_DECLINED: {
      title: '課程票券轉讓已婉拒',
      body: '轉讓保留已釋放，堂數回復可用。',
      actionUrl: '/me/courses/passes',
    },
    COUNT_PARTIAL_TRANSFER_CANCELLED: {
      title: '課程票券轉讓已取消',
      body: '轉讓保留已釋放，未產生帳本轉出。',
      actionUrl: '/me/courses/passes',
    },
    COUNT_PARTIAL_TRANSFER_EXPIRED: {
      title: '課程票券轉讓已逾期',
      body: '受讓期限已過，保留堂數已回復可用。',
      actionUrl: '/me/courses/passes',
    },
  }[eventType] || {
    title: '課程通知',
    body: text(payload.message || eventType, 1000),
    actionUrl: '/me/courses',
  };
  return { ...copy, payload };
}

async function claimCourseNotificationBatch(conn, limit = 50) {
  // A process may stop after committing a claim but before delivery. Reclaim
  // stale leases so durable notifications never remain PROCESSING forever.
  await conn.query(
    `UPDATE course_notification_outbox
        SET status = 'FAILED', available_at = NOW(), locked_at = NULL,
            last_error = COALESCE(last_error, 'stale processing lease recovered'),
            row_version = row_version + 1
      WHERE status = 'PROCESSING'
        AND locked_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)`
  );
  const [rows] = await conn.query(
    `SELECT * FROM course_notification_outbox
      WHERE status IN ('PENDING','FAILED') AND available_at <= NOW()
        AND attempts < 10
      ORDER BY available_at, id LIMIT ? FOR UPDATE SKIP LOCKED`,
    [Math.max(1, Math.min(200, Number(limit) || 50))]
  );
  if (!rows.length) return [];
  const ids = rows.map((row) => Number(row.id));
  await conn.query(
    `UPDATE course_notification_outbox
        SET status = 'PROCESSING', attempts = attempts + 1,
            locked_at = NOW(), row_version = row_version + 1
      WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids
  );
  return rows;
}

async function processCourseNotificationOutbox({
  pool,
  transporter = null,
  isMailerReady = () => false,
  fromName = 'Leader Online',
  fromAddress = '',
  publicWebUrl = 'http://localhost:5173',
  limit = 50,
  logger = console,
} = {}) {
  if (!pool) throw new TypeError('notification outbox requires a database pool');
  const conn = await pool.getConnection();
  let rows = [];
  try {
    await conn.beginTransaction();
    rows = await claimCourseNotificationBatch(conn, limit);
    await conn.commit();
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    throw error;
  } finally {
    conn.release();
  }

  const results = [];
  for (const row of rows) {
    const copy = notificationCopy(row);
    try {
      let email = '';
      if (row.user_id) {
        const [users] = await pool.query('SELECT email FROM users WHERE id = ? LIMIT 1', [row.user_id]);
        email = text(users[0]?.email, 255).toLowerCase();
      }
      await pool.query(
        `INSERT INTO course_user_notifications
          (owner_user_id, user_id, event_type, dedupe_key, title, body,
           action_url, payload_json, row_version)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, 1
          WHERE ? IS NOT NULL
         ON DUPLICATE KEY UPDATE id = id`,
        [
          row.owner_user_id,
          row.user_id,
          row.event_type,
          row.dedupe_key,
          copy.title,
          copy.body,
          copy.actionUrl,
          JSON.stringify(copy.payload),
          row.user_id,
        ]
      );
      if (email && (!transporter || !isMailerReady())) {
        const unavailable = new Error('SMTP transport is not ready');
        unavailable.code = 'SMTP_NOT_READY';
        throw unavailable;
      }
      if (email) {
        await transporter.sendMail({
          from: `"${fromName}" <${fromAddress}>`,
          to: email,
          subject: copy.title,
          text: `${copy.body}\n\n${new URL(copy.actionUrl, publicWebUrl).href}`,
        });
      }
      await pool.query(
        `UPDATE course_notification_outbox SET status = 'SENT', sent_at = NOW(),
                locked_at = NULL, last_error = NULL, row_version = row_version + 1
          WHERE id = ? AND status = 'PROCESSING'`,
        [row.id]
      );
      results.push({ id: Number(row.id), sent: true });
    } catch (error) {
      logger?.error?.('[course-notification-outbox] delivery failed:', error?.message || error);
      await pool.query(
        `UPDATE course_notification_outbox
            SET status = CASE WHEN attempts >= 10 THEN 'DEAD' ELSE 'FAILED' END,
                available_at = DATE_ADD(NOW(), INTERVAL LEAST(60, POW(2, attempts)) MINUTE),
                locked_at = NULL, last_error = ?, row_version = row_version + 1
          WHERE id = ? AND status = 'PROCESSING'`,
        [text(error?.message || error, 4000), row.id]
      );
      results.push({ id: Number(row.id), sent: false });
    }
  }
  return results;
}

module.exports = {
  COURSE_NOTIFICATION_SCHEMA_VERSION,
  claimCourseNotificationBatch,
  courseNotificationOutboxAvailability,
  enqueueCourseNotificationOutbox,
  notificationCopy,
  parseJson,
  processCourseNotificationOutbox,
};
