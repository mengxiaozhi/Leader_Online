'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  enqueueCourseNotificationOutbox,
  notificationCopy,
  processCourseNotificationOutbox,
} = require('../src/services/course-notification-outbox');

test('outbox notification copy makes payment and leave consequences explicit', () => {
  assert.match(notificationCopy({
    event_type: 'TERM_PAYMENT_SUBMITTED',
    payload_json: '{}',
  }).body, /人工確認或駁回/);
  assert.match(notificationCopy({
    event_type: 'TERM_LEAVE_APPROVED',
    payload_json: '{}',
  }).body, /補課權益/);
  assert.match(notificationCopy({
    event_type: 'TERM_WAITLIST_OFFERED',
    payload_json: JSON.stringify({ expiresAt: '2026-08-13T10:00:00Z' }),
  }).body, /逾期將自動輪給/);
  assert.match(notificationCopy({
    event_type: 'COUNT_BOOKING_CREATED',
    payload_json: JSON.stringify({ sessionTitle: '游泳訓練' }),
  }).title, /游泳訓練/);
  const invite = notificationCopy({
    event_type: 'COUNT_ATTENDANCE_INVITE_CREATED',
    payload_json: JSON.stringify({
      inviteToken: 'token with symbols/+',
      rowVersion: 1,
      expiryAction: 'auto_redeem',
    }),
  });
  assert.match(invite.body, /自動核銷/);
  assert.match(invite.actionUrl, /attendanceInvite=token%20with%20symbols%2F%2B/);
  assert.match(notificationCopy({
    event_type: 'COUNT_ATTENDANCE_INVITE_EXPIRED',
    payload_json: JSON.stringify({ status: 'expired' }),
  }).body, /未扣堂/);
  assert.match(notificationCopy({
    event_type: 'COUNT_PARTIAL_TRANSFER_ACCEPTED',
    payload_json: JSON.stringify({ role: 'recipient', quantity: 3 }),
  }).body, /3 堂子票/);
});

test('shared outbox enqueue is gated by 053 runtime, schema, and provider flags', async () => {
  const disabledCalls = [];
  const disabled = await enqueueCourseNotificationOutbox({
    async query(sql) { disabledCalls.push(sql); throw new Error('must not query'); },
  }, {
    eventType: 'COUNT_BOOKING_CREATED',
    dedupeKey: 'count-booking:disabled',
  }, {
    runtimeEnabled: false,
    ownerUserId: 'provider-1',
    requireProviderAdvancedPayments: true,
  });
  assert.deepEqual(disabled, { queued: false, reason: 'advanced_payments_disabled' });
  assert.equal(disabledCalls.length, 0);

  const queries = [];
  const conn = {
    async query(sql, params) {
      const query = String(sql).replace(/\s+/g, ' ').trim();
      queries.push({ query, params });
      if (query.startsWith('SELECT version FROM course_schema_versions')) {
        return [[{ version: '053_course_term_payments_notifications' }]];
      }
      if (query.startsWith('SELECT scope_key, advanced_payments_enabled')) {
        return [[
          { scope_key: 'platform', advanced_payments_enabled: 1 },
          { scope_key: 'provider:provider-1', advanced_payments_enabled: 1 },
        ]];
      }
      if (query.startsWith('INSERT INTO course_notification_outbox')) {
        return [{ affectedRows: 1 }];
      }
      throw new Error(`unexpected query: ${query}`);
    },
  };
  const queued = await enqueueCourseNotificationOutbox(conn, [
    {
      ownerUserId: 'provider-1',
      userId: 'sender',
      eventType: 'COUNT_PARTIAL_TRANSFER_ACCEPTED',
      dedupeKey: 'count-transfer:7:accepted:sender',
      payload: { transferId: 7, role: 'sender' },
    },
    {
      ownerUserId: 'provider-1',
      userId: 'recipient',
      eventType: 'COUNT_PARTIAL_TRANSFER_ACCEPTED',
      dedupeKey: 'count-transfer:7:accepted:recipient',
      payload: { transferId: 7, role: 'recipient' },
    },
  ], {
    runtimeEnabled: true,
    ownerUserId: 'provider-1',
    requireProviderAdvancedPayments: true,
  });
  assert.deepEqual(queued, { queued: true, count: 2 });
  assert.equal(queries.filter(({ query }) => query.startsWith('INSERT INTO course_notification_outbox')).length, 2);
  assert.deepEqual(
    queries.find(({ query }) => query.startsWith('SELECT scope_key'))?.params,
    ['platform', 'provider:provider-1']
  );

  const providerDisabled = await enqueueCourseNotificationOutbox({
    async query(sql) {
      const query = String(sql).replace(/\s+/g, ' ').trim();
      if (query.startsWith('SELECT scope_key')) {
        return [[
          { scope_key: 'platform', advanced_payments_enabled: 1 },
          { scope_key: 'provider:provider-1', advanced_payments_enabled: 0 },
        ]];
      }
      throw new Error(`unexpected query: ${query}`);
    },
  }, {
    eventType: 'COUNT_BOOKING_CREATED',
    dedupeKey: 'count-booking:provider-disabled',
  }, {
    runtimeEnabled: true,
    schemaReady: true,
    ownerUserId: 'provider-1',
    requireProviderAdvancedPayments: true,
  });
  assert.deepEqual(providerDisabled, {
    queued: false,
    reason: 'provider_advanced_payments_disabled',
  });
});

test('outbox sends only after claiming a committed row and materializes in-app inbox', async () => {
  const queries = [];
  let sentMail = null;
  const connection = {
    async beginTransaction() { queries.push('BEGIN'); },
    async commit() { queries.push('COMMIT'); },
    async rollback() { queries.push('ROLLBACK'); },
    release() { queries.push('RELEASE'); },
    async query(sql) {
      queries.push(String(sql).replace(/\s+/g, ' ').trim());
      if (String(sql).includes('SELECT * FROM course_notification_outbox')) {
        return [[{
          id: 9,
          owner_user_id: 'provider-1',
          user_id: 'user-1',
          event_type: 'TERM_ENROLLMENT_CONFIRMED',
          dedupe_key: 'term-confirmed:9',
          payload_json: JSON.stringify({ enrollmentId: 7 }),
        }]];
      }
      return [{ affectedRows: 1 }];
    },
  };
  const pool = {
    async getConnection() { return connection; },
    async query(sql) {
      queries.push(String(sql).replace(/\s+/g, ' ').trim());
      if (String(sql).startsWith('SELECT email')) return [[{ email: 'member@example.com' }]];
      return [{ affectedRows: 1 }];
    },
  };
  const results = await processCourseNotificationOutbox({
    pool,
    transporter: { async sendMail(mail) { sentMail = mail; } },
    isMailerReady: () => true,
    fromAddress: 'noreply@example.com',
  });
  assert.deepEqual(results, [{ id: 9, sent: true }]);
  assert.ok(queries.indexOf('COMMIT') < queries.findIndex((query) => query.includes('course_user_notifications')));
  assert.ok(queries.some((query) => query.includes("status = 'PROCESSING'") && query.includes('INTERVAL 15 MINUTE')));
  assert.match(sentMail.subject, /報名完成/);
  assert.ok(queries.some((query) => query.includes("status = 'SENT'")));
});

test('outbox retries email recipients while SMTP is unavailable', async () => {
  const queries = [];
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql) {
      const query = String(sql).replace(/\s+/g, ' ').trim();
      queries.push(query);
      if (query.includes('SELECT * FROM course_notification_outbox')) {
        return [[{
          id: 10,
          owner_user_id: 'provider-1',
          user_id: 'user-1',
          event_type: 'TERM_ENROLLMENT_CONFIRMED',
          dedupe_key: 'term-confirmed:10',
          payload_json: '{}',
        }]];
      }
      return [{ affectedRows: 1 }];
    },
  };
  const pool = {
    async getConnection() { return connection; },
    async query(sql) {
      const query = String(sql).replace(/\s+/g, ' ').trim();
      queries.push(query);
      if (query.startsWith('SELECT email')) return [[{ email: 'member@example.com' }]];
      return [{ affectedRows: 1 }];
    },
  };
  const results = await processCourseNotificationOutbox({
    pool,
    transporter: null,
    isMailerReady: () => false,
    logger: { error() {} },
  });
  assert.deepEqual(results, [{ id: 10, sent: false }]);
  assert.ok(queries.some((query) => query.includes("status = CASE WHEN attempts >= 10 THEN 'DEAD' ELSE 'FAILED' END")));
  assert.equal(queries.some((query) => query.includes("status = 'SENT'")), false);
});
