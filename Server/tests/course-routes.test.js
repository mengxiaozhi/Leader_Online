const assert = require('node:assert/strict');
const test = require('node:test');

const buildCourseRoutes = require('../src/routes/courses');
const { helpers } = buildCourseRoutes;

test('course products keep external URLs separate from uploaded-cover state', () => {
  assert.deepEqual(
    helpers.toProduct({ id: 7, cover_url: 'https://example.com/course.jpg', cover_path: null }),
    {
      id: 7,
      code: undefined,
      name: undefined,
      category: '',
      summary: '',
      description: '',
      coverUrl: 'https://example.com/course.jpg',
      hasCover: false,
      price: 0,
      classCount: 0,
      validDays: 0,
      activationDays: 0,
      transferable: false,
      externalPurchaseUrl: '',
      status: 'draft',
      sortOrder: 0,
      providerUserId: null,
      provider_user_id: null,
      providerName: '',
      isPlatformCourse: true,
      createdAt: undefined,
      updatedAt: undefined,
    }
  );

  const uploaded = helpers.toProduct({ id: 8, cover_url: null, cover_path: 'course_product_covers/8/cover.jpg' });
  assert.equal(uploaded.coverUrl, '');
  assert.equal(uploaded.hasCover, true);
});

test('course cover storage paths stay inside the dedicated product folder', () => {
  const storage = { generateStorageKey: () => 'cover-fixed' };
  assert.equal(
    helpers.buildCourseProductCoverStoragePath(42, '../../jpg', storage),
    'course_product_covers/42/cover-fixed.jpg'
  );
});

test('course cover URLs only allow HTTP and HTTPS', () => {
  assert.equal(helpers.normalizeCourseCoverUrl('https://example.com/cover image.jpg'), 'https://example.com/cover%20image.jpg');
  assert.equal(helpers.normalizeCourseCoverUrl('ftp://example.com/cover.jpg'), null);
  assert.throws(
    () => helpers.normalizeCourseCoverUrl('javascript:alert(1)', { strict: true }),
    (error) => error?.code === 'VALIDATION_ERROR' && error?.statusCode === 400
  );
});

test('course transfer emails are trimmed, normalized, and validated', () => {
  assert.equal(helpers.normalizeCourseTransferEmail('  Member.Name+Course@Example.COM  '), 'member.name+course@example.com');
  assert.equal(helpers.normalizeCourseTransferEmail('member@example.com'), 'member@example.com');
  assert.equal(helpers.normalizeCourseTransferEmail('member @example.com'), '');
  assert.equal(helpers.normalizeCourseTransferEmail('member@example'), '');
  assert.equal(helpers.normalizeCourseTransferEmail('not-an-email'), '');
  assert.equal(helpers.normalizeCourseTransferEmail(null), '');
});

test('course user-data confirmation is versioned and must match the sent fields', () => {
  const expected = { buyerName: '王小明', buyerEmail: 'buyer@example.com', remittanceLast5: '12345' };
  assert.equal(helpers.courseUserDataConfirmationMatches({
    version: 1,
    confirmed: true,
    buyerName: ' 王小明 ',
    buyerEmail: 'BUYER@example.com',
    remittanceLast5: '12345',
  }, expected), true);
  assert.equal(helpers.courseUserDataConfirmationMatches({ ...expected, version: 1, confirmed: false }, expected), false);
  assert.equal(helpers.courseUserDataConfirmationMatches({ ...expected, version: 1, confirmed: true, buyerEmail: 'other@example.com' }, expected), false);
});

test('course ticket transfer eligibility preserves valid remaining-use transfers', () => {
  const now = Date.parse('2026-07-15T12:00:00.000Z');
  const baseTicket = {
    transferable: 1,
    status: 'active',
    remaining_uses: 3,
    expires_at: '2026-07-16T12:00:00.000Z',
  };

  assert.equal(helpers.courseTicketTransferBlockReason(baseTicket, { now }), '');
  assert.equal(helpers.courseTicketTransferBlockReason({ ...baseTicket, status: 'pending' }, { now }), '');
  assert.equal(helpers.courseTicketTransferBlockReason({ ...baseTicket, status: 'PAUSED', remaining_uses: undefined, remainingUses: 1 }, { now }), '');
  assert.equal(helpers.courseTicketTransferBlockReason({ ...baseTicket, expires_at: new Date(now) }, { now }), '');
});

test('course ticket transfer eligibility rejects unavailable tickets', () => {
  const now = Date.parse('2026-07-15T12:00:00.000Z');
  const eligible = { transferable: 1, status: 'active', remaining_uses: 2 };

  assert.equal(helpers.courseTicketTransferBlockReason(null, { now }), '找不到課程票券');
  assert.equal(
    helpers.courseTicketTransferBlockReason({ ...eligible, transferable: 0 }, { now }),
    '此票券目前不可轉讓'
  );
  assert.equal(
    helpers.courseTicketTransferBlockReason({ ...eligible, status: 'exhausted' }, { now }),
    '此票券目前不可轉讓'
  );
  assert.equal(
    helpers.courseTicketTransferBlockReason({ ...eligible, remaining_uses: 0 }, { now }),
    '此票券已無剩餘堂數，無法轉讓'
  );
  assert.equal(
    helpers.courseTicketTransferBlockReason({ ...eligible, expires_at: '2026-07-15T11:59:59.999Z' }, { now }),
    '此票券已過期，無法轉讓'
  );
  assert.equal(
    helpers.courseTicketTransferBlockReason(eligible, { hasActiveBooking: true, now }),
    '此票券仍有未出席預約，請先取消預約再轉讓'
  );
});

test('course transfer codes use the dedicated CTK prefix', () => {
  assert.equal(helpers.isCourseTicketTransferCode('CTK-ABC123'), true);
  assert.equal(helpers.isCourseTicketTransferCode(' ctk-ab 12 '), true);
  assert.equal(helpers.isCourseTicketTransferCode('RSV-ABC123'), false);
  assert.equal(helpers.isCourseTicketTransferCode('CTK-'), false);
  assert.equal(helpers.isCourseTicketTransferCode('CTK-ABC_123'), false);
  assert.equal(helpers.isCourseTicketTransferCode(''), false);
});

test('course transfer expiry matches email and QR lifetimes', () => {
  const now = Date.parse('2026-07-15T12:00:00.000Z');
  assert.equal(helpers.isCourseTicketTransferExpired({ created_at: new Date(now - 14 * 60 * 1000), code: 'CTK-ABC123' }, { now }), false);
  assert.equal(helpers.isCourseTicketTransferExpired({ created_at: new Date(now - 15 * 60 * 1000), code: 'CTK-ABC123' }, { now }), true);
  assert.equal(helpers.isCourseTicketTransferExpired({ created_at: new Date(now - 6 * 86400000), code: null }, { now }), false);
  assert.equal(helpers.isCourseTicketTransferExpired({ created_at: new Date(now - 7 * 86400000), code: null }, { now }), true);
  assert.equal(helpers.isCourseTicketTransferExpired({ created_at: 'invalid', code: null }, { now }), true);
});

test('course booking QR codes are normalized and kept separate from transfer codes', () => {
  assert.equal(helpers.normalizeCourseBookingVerificationCode(' cbk-aabb ccdd eeff 0011 '), 'CBK-AABBCCDDEEFF0011');
  assert.equal(helpers.isCourseBookingVerificationCode('CBK-AABBCCDDEEFF0011'), true);
  assert.equal(helpers.isCourseBookingVerificationCode('CTK-AABBCCDDEEFF0011'), false);
  assert.equal(helpers.isCourseBookingVerificationCode('CBK-SHORT'), false);
});

test('course redemption enforces status, Taiwan dates, and the attendance window', () => {
  const now = Date.parse('2026-07-15T00:30:00+08:00');
  const eligible = {
    status: 'booked',
    session_status: 'open',
    starts_at: '2026-07-14T23:30:00+08:00',
    ends_at: '2026-07-15T01:00:00+08:00',
    ticket_status: 'active',
    remaining_uses: 2,
    ticket_expires_at: '2026-07-15',
  };
  assert.equal(helpers.courseBookingRedemptionBlockReason(eligible, { now }), '');
  assert.equal(helpers.courseBookingRedemptionBlockReason({ ...eligible, status: 'attended' }, { now }), '此預約目前不能核銷');
  assert.equal(helpers.courseBookingRedemptionBlockReason({ ...eligible, session_status: 'cancelled' }, { now }), '課程場次已取消，不能核銷');
  assert.equal(helpers.courseBookingRedemptionBlockReason({ ...eligible, session_status: 'draft' }, { now }), '課程場次尚未開放，不能核銷');
  assert.equal(
    helpers.courseBookingRedemptionBlockReason({ ...eligible, starts_at: '2026-07-15T03:00:01+08:00', ends_at: '2026-07-15T04:00:00+08:00' }, { now }),
    '課程尚未開放核銷'
  );
  assert.equal(
    helpers.courseBookingRedemptionBlockReason({ ...eligible, starts_at: '2026-07-12T22:00:00+08:00', ends_at: '2026-07-13T00:29:59+08:00' }, { now }),
    '課程核銷期限已截止'
  );
  assert.equal(helpers.courseBookingRedemptionBlockReason({ ...eligible, remaining_uses: 0 }, { now }), '課程票券已無剩餘堂數');
  assert.equal(helpers.courseBookingRedemptionBlockReason({ ...eligible, ticket_expires_at: '2026-07-14' }, { now }), '課程票券已過期，不能核銷');
  assert.equal(
    helpers.courseBookingRedemptionBlockReason({ ...eligible, ticket_status: 'pending', ticket_expires_at: null, activation_deadline: '2026-07-14' }, { now }),
    '課程票券已超過開卡期限，不能核銷'
  );
});

test('course transfer history uses immutable event snapshots', () => {
  const row = {
    id: 91,
    transfer_id: 12,
    ticket_id: 7,
    ticket_code: 'CT-IMMUTABLE',
    user_id: 'recipient',
    action: 'transferred_in',
    method: 'email',
    product_name: '原始課程名稱',
    from_email: 'sender@example.com',
    to_email: 'recipient@example.com',
    created_at: '2026-07-15 12:00:00',
  };
  assert.deepEqual(helpers.toCourseTicketTransferLog(row, 'recipient'), {
    id: 91,
    ticket_id: 'CT-IMMUTABLE',
    course_ticket_id: 7,
    user_id: 'recipient',
    action: 'transferred_in',
    record_type: 'course_ticket',
    meta: {
      method: 'email',
      ticket_type: '原始課程名稱',
      transfer_id: 12,
      from_email: 'sender@example.com',
      to_email: 'recipient@example.com',
    },
    created_at: '2026-07-15 12:00:00',
  });
});

test('course router registers the complete general-ticket-style transfer surface', () => {
  const passthrough = (_req, _res, next) => next();
  const router = buildCourseRoutes({
    ok: () => {},
    fail: () => {},
    pool: {},
    storage: {},
    authRequired: passthrough,
    staffRequired: passthrough,
  });
  const registeredRoutes = new Set(
    router.stack
      .filter((layer) => layer.route)
      .flatMap((layer) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`))
  );

  const expectedRoutes = [
    'GET /courses/tickets/logs',
    'POST /courses/tickets/transfers/initiate',
    'POST /courses/tickets/transfers/:id/accept',
    'POST /courses/tickets/transfers/:id/decline',
    'POST /courses/tickets/transfers/claim_code',
    'GET /courses/tickets/transfers/incoming',
    'POST /courses/tickets/transfers/cancel_pending',
    'POST /courses/tickets/:id/transfer',
    'GET /courses/products/:id',
    'GET /courses/sessions/:id',
    'PATCH /courses/orders/:id',
    'POST /courses/orders/:id/cancel',
    'PATCH /admin/courses/products/:id/owner',
    'PATCH /admin/courses/orders/bulk',
    'GET /admin/courses/orders/:id',
    'GET /admin/courses/tickets/:id/activity',
    'GET /admin/courses/bookings/:id',
    'PATCH /admin/courses/bookings/:id/status',
    'POST /admin/courses/bookings/progress_scan',
    'POST /admin/courses/bookings/:id/attend',
  ];

  for (const route of expectedRoutes) assert.equal(registeredRoutes.has(route), true, `missing route: ${route}`);
});

function routeHandler(router, method, path) {
  const layer = router.stack.find((item) => item.route?.path === path && item.route.methods?.[method]);
  assert.ok(layer, `missing ${method.toUpperCase()} ${path}`);
  return layer.route.stack.at(-1).handle;
}

function schemaQueryResult(sql) {
  const normalized = String(sql).replace(/\s+/g, ' ').trim();
  if (normalized === 'SHOW COLUMNS FROM course_products') {
    return [[{ Field: 'cover_type' }, { Field: 'cover_path' }, { Field: 'owner_user_id' }]];
  }
  if (normalized === 'SHOW COLUMNS FROM course_sessions') {
    return [[{ Field: 'owner_user_id' }]];
  }
  if (normalized === 'SHOW COLUMNS FROM course_orders') {
    return [[{ Field: 'buyer_phone' }]];
  }
  if (normalized === 'SHOW COLUMNS FROM course_ticket_transfers') {
    return [[
      { Field: 'to_user_id', Null: 'YES' },
      { Field: 'to_email', Null: 'YES' },
      { Field: 'code', Null: 'YES' },
      { Field: 'status', Null: 'NO', Default: 'accepted' },
      { Field: 'updated_at', Null: 'NO', Extra: 'DEFAULT_GENERATED on update CURRENT_TIMESTAMP' },
    ]];
  }
  if (normalized === 'SHOW COLUMNS FROM course_bookings') {
    return [[{ Field: 'verify_code' }]];
  }
  if (normalized === 'SHOW INDEX FROM course_bookings') {
    return [[{ Key_name: 'uq_course_bookings_verify_code' }]];
  }
  if (normalized === 'SHOW INDEX FROM course_products') {
    return [[{ Key_name: 'idx_course_products_owner_status_sort' }]];
  }
  if (normalized === 'SHOW INDEX FROM course_sessions') {
    return [[{ Key_name: 'idx_course_sessions_owner_status_time' }]];
  }
  if (normalized === 'SHOW INDEX FROM course_attendance_logs') {
    return [[{ Key_name: 'uq_course_attendance_booking_action' }]];
  }
  if (normalized === 'SHOW INDEX FROM course_ticket_transfers') {
    return [[
      { Key_name: 'uq_course_ticket_transfers_code' },
      { Key_name: 'idx_course_ticket_transfers_to_user' },
      { Key_name: 'idx_course_ticket_transfers_to_email' },
      { Key_name: 'idx_course_ticket_transfers_status' },
    ]];
  }
  if (normalized.startsWith('CREATE TABLE IF NOT EXISTS course_')) return [{ affectedRows: 0 }];
  if (normalized.startsWith('SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS')) {
    return [[{ CONSTRAINT_NAME: 'present' }]];
  }
  if (normalized.startsWith('UPDATE course_ticket_transfers SET ')) return [{ affectedRows: 0 }];
  if (normalized.startsWith('UPDATE course_bookings SET verify_code = ')) return [{ affectedRows: 0 }];
  if (normalized.startsWith('INSERT IGNORE INTO course_ticket_transfer_logs')) return [{ affectedRows: 0 }];
  return null;
}

function courseRouteResponseHelpers() {
  return {
    ok: (_res, data, message) => ({ ok: true, data, message }),
    fail: (_res, code, message, status) => ({ ok: false, code, message, status }),
  };
}

function courseRouteMiddleware() {
  return (_req, _res, next) => next();
}

test('course email transfer locks sender and existing recipient before transfers', async () => {
  const events = [];
  const conn = {
    beginTransaction: async () => { events.push('begin'); },
    commit: async () => { events.push('commit'); },
    rollback: async () => { events.push('rollback'); },
    release: () => {},
    query: async (sql, params = []) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      events.push(normalized);
      if (normalized === 'SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1') {
        return [[{ id: 'recipient-1' }]];
      }
      if (normalized.startsWith('SELECT id, username, email FROM users WHERE id IN')) {
        assert.deepEqual(params, ['recipient-1', 'sender-1']);
        return [[
          { id: 'recipient-1', username: '收件人', email: 'recipient@example.com' },
          { id: 'sender-1', username: '寄件人', email: 'sender@example.com' },
        ]];
      }
      if (normalized.startsWith('UPDATE course_ticket_transfers tr JOIN course_tickets')) return [{ affectedRows: 0 }];
      if (normalized.startsWith('SELECT t.*, p.name AS product_name FROM course_tickets t')) {
        return [[{
          id: 9,
          owner_user_id: 'provider-1',
          code: 'COURSE-009',
          user_id: 'sender-1',
          product_name: '團練課',
          transferable: 1,
          status: 'active',
          remaining_uses: 3,
          expires_at: '2099-01-01T00:00:00.000Z',
        }]];
      }
      if (normalized === "SELECT id FROM course_bookings WHERE ticket_id = ? AND status = 'booked' LIMIT 1") return [[]];
      if (normalized === "SELECT id FROM course_ticket_transfers WHERE ticket_id = ? AND status = 'pending' LIMIT 1") return [[]];
      if (normalized.startsWith('INSERT INTO course_ticket_transfers')) return [{ insertId: 77, affectedRows: 1 }];
      throw new Error(`unexpected connection query: ${normalized}`);
    },
  };
  const pool = {
    getConnection: async () => conn,
    query: async (sql) => {
      const schemaResult = schemaQueryResult(sql);
      if (schemaResult) return schemaResult;
      throw new Error(`unexpected pool query: ${String(sql).replace(/\s+/g, ' ').trim()}`);
    },
  };
  const router = buildCourseRoutes({
    ...courseRouteResponseHelpers(),
    pool,
    storage: {},
    authRequired: courseRouteMiddleware(),
    staffRequired: courseRouteMiddleware(),
    isMailerReady: () => false,
  });
  const result = await routeHandler(router, 'post', '/courses/tickets/transfers/initiate')({
    user: { id: 'sender-1', role: 'USER' },
    body: { ticketId: 9, mode: 'email', email: 'recipient@example.com' },
  }, {});

  const usersLock = events.findIndex((entry) => entry.startsWith?.('SELECT id, username, email FROM users WHERE id IN'));
  const transferExpiry = events.findIndex((entry) => entry.startsWith?.('UPDATE course_ticket_transfers tr JOIN course_tickets'));
  const transferInsert = events.findIndex((entry) => entry.startsWith?.('INSERT INTO course_ticket_transfers'));
  assert.equal(result.ok, true);
  assert.ok(usersLock > -1 && usersLock < transferExpiry);
  assert.ok(usersLock < transferInsert);
});

test('course QR scan previews, confirms once, and rejects replay', async () => {
  let bookingStatus = 'booked';
  let remainingUses = 2;
  let attendanceLogs = 0;
  const sessionStartsAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const sessionEndsAt = new Date(Date.now() + 45 * 60 * 1000).toISOString();
  const bookingRow = () => ({
    id: 81,
    session_id: 7,
    ticket_id: 9,
    user_id: 'member-1',
    attendee_name: '學員甲',
    attendee_email: 'member@example.com',
    verify_code: 'CBK-AABBCCDDEEFF0011',
    status: bookingStatus,
    session_code: 'CS-001',
    session_title: '游泳團練',
    starts_at: sessionStartsAt,
    ends_at: sessionEndsAt,
    location: '泳池',
    session_status: 'open',
    coach_user_id: 'coach-1',
    ticket_code: 'COURSE-001',
    remaining_uses: remainingUses,
    ticket_status: 'active',
    activated_at: '2026-07-01 10:00:00',
    activation_deadline: '2026-12-31',
    ticket_expires_at: '2026-12-31',
    product_name: '游泳課',
    product_id: 3,
    owner_user_id: 'provider-1',
    provider_name: '服務商甲',
    valid_days: 120,
  });
  const findBookingQuery = (sql) => String(sql).replace(/\s+/g, ' ').trim().startsWith('SELECT b.*, s.code AS session_code');
  const conn = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    query: async (sql, params = []) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (findBookingQuery(sql)) return params.includes('other-provider') ? [[]] : [[bookingRow()]];
      if (normalized.startsWith('UPDATE course_tickets t JOIN course_products p')) {
        remainingUses -= 1;
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("UPDATE course_bookings b JOIN course_tickets t")) {
        if (bookingStatus !== 'booked') return [{ affectedRows: 0 }];
        bookingStatus = 'attended';
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith('INSERT INTO course_attendance_logs')) {
        attendanceLogs += 1;
        return [{ insertId: attendanceLogs }];
      }
      throw new Error(`unexpected connection query: ${normalized}`);
    },
  };
  const pool = {
    getConnection: async () => conn,
    query: async (sql, params = []) => {
      const schemaResult = schemaQueryResult(sql);
      if (schemaResult) return schemaResult;
      if (findBookingQuery(sql)) return params.includes('other-provider') ? [[]] : [[bookingRow()]];
      throw new Error(`unexpected pool query: ${String(sql).replace(/\s+/g, ' ').trim()}`);
    },
  };
  const router = buildCourseRoutes({
    ...courseRouteResponseHelpers(),
    pool,
    storage: {},
    authRequired: courseRouteMiddleware(),
    staffRequired: courseRouteMiddleware(),
  });
  const handler = routeHandler(router, 'post', '/admin/courses/bookings/progress_scan');
  const request = (body) => ({ body, user: { id: 'admin-1', role: 'ADMIN' } });

  const forbidden = await handler({
    body: { code: 'CBK-AABBCCDDEEFF0011', preview: true },
    user: { id: 'other-provider', role: 'SERVICE_PROVIDER' },
  }, {});
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.code, 'COURSE_BOOKING_NOT_FOUND');
  assert.equal(forbidden.status, 404);

  const preview = await handler(request({ code: 'CBK-AABBCCDDEEFF0011', preview: true }), {});
  assert.equal(preview.ok, true);
  assert.equal(preview.data.needsConfirmation, true);
  assert.equal(preview.data.booking.remainingUses, 2);

  const confirmed = await handler(request({ code: 'CBK-AABBCCDDEEFF0011', confirm: true }), {});
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.data.remainingUses, 1);
  assert.equal(attendanceLogs, 1);

  const replay = await handler(request({ code: 'CBK-AABBCCDDEEFF0011', confirm: true }), {});
  assert.equal(replay.ok, false);
  assert.equal(replay.code, 'COURSE_BOOKING_NOT_REDEEMABLE');
  assert.equal(replay.status, 409);
  assert.equal(attendanceLogs, 1);
});

test('course providers list and mutate only owner-scoped course records', async () => {
  const observed = [];
  const pool = {
    query: async (sql, params = []) => {
      const schemaResult = schemaQueryResult(sql);
      if (schemaResult) return schemaResult;
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      observed.push({ sql: normalized, params });
      if (normalized.startsWith('SELECT s.*, p.name AS product_name')) return [[]];
      if (normalized.startsWith('SELECT b.*, s.code AS session_code')) return [[]];
      if (normalized.startsWith('SELECT * FROM course_sessions WHERE id = ? AND owner_user_id = ?')) return [[]];
      if (normalized.startsWith('SELECT id, status FROM course_sessions WHERE id = ? AND owner_user_id = ?')) return [[]];
      if (normalized.startsWith("UPDATE course_sessions SET status = 'cancelled'")) return [{ affectedRows: 0 }];
      throw new Error(`unexpected query: ${normalized}`);
    },
  };
  pool.getConnection = async () => ({
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    query: pool.query,
  });
  const router = buildCourseRoutes({
    ...courseRouteResponseHelpers(),
    pool,
    storage: {},
    authRequired: courseRouteMiddleware(),
    staffRequired: courseRouteMiddleware(),
  });
  const coachRequest = { user: { id: 'coach-current', role: 'SERVICE_PROVIDER' } };

  const sessions = await routeHandler(router, 'get', '/admin/courses/sessions')(coachRequest, {});
  const bookings = await routeHandler(router, 'get', '/admin/courses/bookings')(coachRequest, {});
  assert.equal(sessions.ok, true);
  assert.equal(bookings.ok, true);
  assert.equal(observed.find((entry) => entry.sql.startsWith('SELECT s.*, p.name AS product_name')).params[0], 'coach-current');
  assert.match(observed.find((entry) => entry.sql.startsWith('SELECT s.*, p.name AS product_name')).sql, /WHERE s\.owner_user_id = \?/);
  assert.equal(observed.find((entry) => entry.sql.startsWith('SELECT b.*, s.code AS session_code')).params[0], 'coach-current');
  assert.match(observed.find((entry) => entry.sql.startsWith('SELECT b.*, s.code AS session_code')).sql, /WHERE p\.owner_user_id = \?/);

  const update = await routeHandler(router, 'patch', '/admin/courses/sessions/:id')({
    ...coachRequest,
    params: { id: '7' },
    body: {},
  }, {});
  assert.equal(update.code, 'COURSE_SESSION_NOT_FOUND');
  assert.equal(update.status, 404);

  const cancel = await routeHandler(router, 'delete', '/admin/courses/sessions/:id')({
    ...coachRequest,
    params: { id: '7' },
  }, {});
  assert.equal(cancel.code, 'COURSE_SESSION_NOT_FOUND');
  assert.equal(cancel.status, 404);
});

test('course session updates cannot reclaim a concurrently reassigned session', async () => {
  let updateQuery = null;
  const pool = {
    query: async (sql, params = []) => {
      const schemaResult = schemaQueryResult(sql);
      if (schemaResult) return schemaResult;
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT * FROM course_sessions WHERE id = ? AND owner_user_id = ?')) {
        return [[{
          id: 7,
          owner_user_id: 'coach-current',
          coach_user_id: 'coach-current',
          title: '團練',
          starts_at: '2026-07-15T10:00:00+08:00',
          ends_at: '2026-07-15T11:00:00+08:00',
          capacity: 20,
          status: 'open',
        }]];
      }
      if (normalized.startsWith('UPDATE course_sessions SET owner_user_id = ?')) {
        updateQuery = { sql: normalized, params };
        return [{ affectedRows: 0 }];
      }
      if (normalized === 'SELECT owner_user_id FROM course_sessions WHERE id = ? LIMIT 1') {
        return [[{ owner_user_id: 'coach-reassigned' }]];
      }
      throw new Error(`unexpected query: ${normalized}`);
    },
  };
  pool.getConnection = async () => ({
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    query: pool.query,
  });
  const router = buildCourseRoutes({
    ...courseRouteResponseHelpers(),
    pool,
    storage: {},
    authRequired: courseRouteMiddleware(),
    staffRequired: courseRouteMiddleware(),
  });
  const result = await routeHandler(router, 'patch', '/admin/courses/sessions/:id')({
    user: { id: 'coach-current', role: 'SERVICE_PROVIDER' },
    params: { id: '7' },
    body: { title: '更新團練' },
  }, {});

  assert.match(updateQuery.sql, /WHERE id = \? AND owner_user_id = \?$/);
  assert.equal(updateQuery.params.at(-1), 'coach-current');
  assert.equal(result.code, 'COURSE_SESSION_UPDATE_CONFLICT');
  assert.equal(result.status, 409);
});

test('course purchase sends one confirmation email with order details', async () => {
  const sent = [];
  const events = [];
  const execute = async (sql, params = []) => {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();
    if (normalized.startsWith('SELECT p.*, provider.username AS provider_name FROM course_products p')) {
      return [[{ id: 7, name: '鐵人基礎課 <script>', price: 1800, status: 'published', owner_user_id: 'provider-1' }]];
    }
    if (normalized.startsWith('SELECT id FROM course_orders WHERE code = ?')) return [[]];
    if (normalized.startsWith('INSERT INTO course_orders')) {
      events.push('insert');
      assert.equal(params[1], 'user-1');
      assert.equal(params[3], 'buyer@example.com');
      return [{ insertId: 41 }];
    }
    throw new Error(`unexpected connection query: ${normalized}`);
  };
  const conn = {
    beginTransaction: async () => { events.push('begin'); },
    commit: async () => { events.push('commit'); },
    rollback: async () => { events.push('rollback'); },
    release: () => {},
    query: execute,
  };
  const pool = {
    getConnection: async () => conn,
    query: async (sql) => {
      const schemaResult = schemaQueryResult(sql);
      if (schemaResult) return schemaResult;
      throw new Error(`unexpected pool query: ${String(sql).replace(/\s+/g, ' ').trim()}`);
    },
  };
  const router = buildCourseRoutes({
    ...courseRouteResponseHelpers(),
    pool,
    storage: {},
    authRequired: courseRouteMiddleware(),
    staffRequired: courseRouteMiddleware(),
    isMailerReady: () => true,
    transporter: {
      sendMail: async (mail) => {
        events.push('send');
        sent.push(mail);
      },
    },
    EMAIL_FROM_NAME: 'Leader Online',
    EMAIL_FROM_ADDRESS: 'noreply@example.test',
    PUBLIC_WEB_URL: 'https://leader.example.test',
  });
  const result = await routeHandler(router, 'post', '/courses/orders')({
    user: { id: 'user-1', username: '王小明', email: 'buyer@example.com' },
    body: {
      productId: 7,
      buyerName: '王小明',
      buyerEmail: 'BUYER@example.com',
      quantity: 2,
      remittanceLast5: '12345',
      termsAccepted: true,
      userDataConfirmation: {
        version: 1,
        confirmed: true,
        buyerName: '王小明',
        buyerEmail: 'buyer@example.com',
        remittanceLast5: '12345',
      },
    },
  }, {});

  assert.equal(result.ok, true);
  assert.equal(result.data.id, 41);
  assert.deepEqual(events, ['begin', 'insert', 'commit', 'send']);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'buyer@example.com');
  assert.match(sent[0].subject, /^\u8ab2\u7a0b\u8a02\u55ae\u5df2\u5efa\u7acb：CO/);
  assert.match(sent[0].text, /鐵人基礎課 <script>/);
  assert.match(sent[0].text, /數量：2/);
  assert.match(sent[0].text, /總金額：NT\$ 3,600/);
  assert.match(sent[0].html, /鐵人基礎課 &lt;script&gt;/);
  assert.doesNotMatch(sent[0].html, /<script>/);
  assert.match(sent[0].html, /https:\/\/leader\.example\.test\/store\?tab=courses&amp;orders=1&amp;category=course/);
});

test('course booking commits before sending its confirmation email', async () => {
  const sent = [];
  const events = [];
  const startsAt = new Date(Date.now() + 60 * 60 * 1000);
  const endsAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const conn = {
    beginTransaction: async () => { events.push('begin'); },
    commit: async () => { events.push('commit'); },
    rollback: async () => { events.push('rollback'); },
    release: () => { events.push('release'); },
    query: async (sql) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT s.*, (SELECT COUNT(*) FROM course_bookings')) {
        return [[{
          id: 9,
          owner_user_id: 'provider-1',
          code: 'CS-ROAD',
          title: '公路團騎訓練',
          product_id: 7,
          starts_at: startsAt,
          ends_at: endsAt,
          booking_open_at: null,
          booking_close_at: null,
          capacity: 20,
          booked_count: 3,
          status: 'open',
          location: '大安森林公園',
          coach_name: '陳教練',
        }]];
      }
      if (normalized.startsWith('SELECT t.*, p.valid_days, p.owner_user_id FROM course_tickets')) {
        return [[{ id: 22, code: 'TK-COURSE22', user_id: 'user-1', product_id: 7, owner_user_id: 'provider-1', status: 'active', remaining_uses: 4, expires_at: null }]];
      }
      if (normalized.startsWith('SELECT id, status FROM course_bookings')) return [[]];
      if (normalized.startsWith('SELECT id FROM course_bookings WHERE verify_code = ?')) return [[]];
      if (normalized.startsWith('INSERT INTO course_bookings')) {
        events.push('insert');
        return [{ insertId: 88 }];
      }
      throw new Error(`unexpected connection query: ${normalized}`);
    },
  };
  const pool = {
    getConnection: async () => conn,
    query: async (sql) => {
      const schemaResult = schemaQueryResult(sql);
      if (schemaResult) return schemaResult;
      throw new Error(`unexpected pool query: ${String(sql).replace(/\s+/g, ' ').trim()}`);
    },
  };
  const router = buildCourseRoutes({
    ...courseRouteResponseHelpers(),
    pool,
    storage: {},
    authRequired: courseRouteMiddleware(),
    staffRequired: courseRouteMiddleware(),
    isMailerReady: () => true,
    transporter: {
      sendMail: async (mail) => {
        events.push('send');
        sent.push(mail);
      },
    },
    EMAIL_FROM_NAME: 'Leader Online',
    EMAIL_FROM_ADDRESS: 'noreply@example.test',
    PUBLIC_WEB_URL: 'https://leader.example.test/',
  });
  const result = await routeHandler(router, 'post', '/courses/sessions/:id/book')({
    params: { id: '9' },
    user: { id: 'user-1', username: '林同學', email: 'attendee@example.com' },
    body: {
      ticketId: 22,
      attendeeName: '林同學',
      attendeeEmail: 'attendee@example.com',
      userDataConfirmation: {
        version: 1,
        confirmed: true,
        attendeeName: '林同學',
        attendeeEmail: 'attendee@example.com',
      },
    },
  }, {});

  assert.equal(result.ok, true);
  assert.equal(result.data.id, 88);
  assert.match(result.data.verifyCode, /^CBK-[A-F0-9]{24}$/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'attendee@example.com');
  assert.equal(sent[0].subject, '課程預約成功：公路團騎訓練');
  assert.match(sent[0].text, /大安森林公園/);
  assert.match(sent[0].text, /TK-COURSE22/);
  assert.ok(events.indexOf('commit') < events.indexOf('send'));
  assert.equal(events.includes('rollback'), false);
  assert.deepEqual(events.slice(-2), ['send', 'release']);
});

test('course purchase still succeeds when email delivery fails', async () => {
  const execute = async (sql) => {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();
    if (normalized.startsWith('SELECT p.*, provider.username AS provider_name FROM course_products p')) {
      return [[{ id: 7, name: '游泳基礎課', price: 900, status: 'published', owner_user_id: 'provider-1' }]];
    }
    if (normalized.startsWith('SELECT id FROM course_orders WHERE code = ?')) return [[]];
    if (normalized.startsWith('INSERT INTO course_orders')) return [{ insertId: 42 }];
    throw new Error(`unexpected connection query: ${normalized}`);
  };
  const conn = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    query: execute,
  };
  const pool = {
    getConnection: async () => conn,
    query: async (sql) => {
      const schemaResult = schemaQueryResult(sql);
      if (schemaResult) return schemaResult;
      throw new Error(`unexpected pool query: ${String(sql).replace(/\s+/g, ' ').trim()}`);
    },
  };
  const router = buildCourseRoutes({
    ...courseRouteResponseHelpers(),
    pool,
    storage: {},
    authRequired: courseRouteMiddleware(),
    staffRequired: courseRouteMiddleware(),
    isMailerReady: () => true,
    transporter: { sendMail: async () => { throw new Error('smtp unavailable'); } },
    EMAIL_FROM_ADDRESS: 'noreply@example.test',
  });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const result = await routeHandler(router, 'post', '/courses/orders')({
      user: { id: 'user-1', username: '黃小姐', email: 'buyer@example.com' },
      body: {
        productId: 7,
        quantity: 1,
        termsAccepted: true,
        userDataConfirmation: {
          version: 1,
          confirmed: true,
          buyerName: '黃小姐',
          buyerEmail: 'buyer@example.com',
          remittanceLast5: '',
        },
      },
    }, {});
    assert.equal(result.ok, true);
    assert.equal(result.data.id, 42);
  } finally {
    console.error = originalConsoleError;
  }
});

test('course manager middleware excludes editors and normalizes provider aliases', async () => {
  const router = buildCourseRoutes({
    ...courseRouteResponseHelpers(),
    pool: {},
    storage: {},
    authRequired: courseRouteMiddleware(),
    staffRequired: courseRouteMiddleware(),
  });
  const layer = router.stack.find((item) => item.route?.path === '/admin/courses/products' && item.route.methods?.get);
  const middleware = layer.route.stack[0].handle;
  const denied = await middleware({ user: { id: 'editor-1', role: 'EDITOR' } }, {}, () => 'next');
  assert.equal(denied.code, 'FORBIDDEN');
  for (const role of ['ADMIN', 'SERVICE_PROVIDER', 'STORE', 'COACH']) {
    const allowed = await middleware({ user: { id: `${role}-1`, role } }, {}, () => 'next');
    assert.equal(allowed, 'next', `${role} should be allowed`);
  }
});

test('course DTOs expose canonical provider identity and platform state', () => {
  const providerProduct = helpers.toProduct({ id: 2, owner_user_id: 'provider-2', provider_name: '甲服務商' });
  assert.equal(providerProduct.providerUserId, 'provider-2');
  assert.equal(providerProduct.provider_user_id, 'provider-2');
  assert.equal(providerProduct.providerName, '甲服務商');
  assert.equal(providerProduct.isPlatformCourse, false);
  const platformSession = helpers.toSession({ id: 3, status: 'open', capacity: 5, booked_count: 2 });
  assert.equal(platformSession.providerUserId, null);
  assert.equal(platformSession.isPlatformCourse, true);
  assert.equal(platformSession.remainingCapacity, 3);
});

test('public course products support opt-in full-dataset pagination and filters', async () => {
  const observed = [];
  const pool = {
    query: async (sql, params = []) => {
      const schemaResult = schemaQueryResult(sql);
      if (schemaResult) return schemaResult;
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      observed.push({ sql: normalized, params });
      if (normalized.startsWith('SELECT p.*, provider.username AS provider_name')) {
        return [[{ id: 8, code: 'CP8', name: '游泳課', status: 'published', owner_user_id: 'provider-1', provider_name: '甲服務商', price: 900 }]];
      }
      if (normalized.startsWith('SELECT COUNT(*) AS total FROM course_products p')) return [[{ total: 13 }]];
      throw new Error(`unexpected query: ${normalized}`);
    },
  };
  const router = buildCourseRoutes({
    ...courseRouteResponseHelpers(), pool, storage: {},
    authRequired: courseRouteMiddleware(), staffRequired: courseRouteMiddleware(),
  });
  const result = await routeHandler(router, 'get', '/courses/products')({
    query: { paged: '1', limit: '10', offset: '0', q: '游泳', ownerType: 'provider', sort: 'priceAsc' },
  }, {});
  assert.equal(result.ok, true);
  assert.equal(result.data.items.length, 1);
  assert.equal(result.data.meta.total, 13);
  assert.equal(result.data.meta.hasMore, true);
  assert.match(observed[0].sql, /p\.owner_user_id IS NOT NULL/);
  assert.match(observed[0].sql, /ORDER BY p\.price ASC, p\.id DESC LIMIT \? OFFSET \?/);
});

test('admin ownership transfer moves linked sessions in one transaction', async () => {
  const events = [];
  const conn = {
    beginTransaction: async () => events.push('begin'),
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
    release: () => events.push('release'),
    query: async (sql, params = []) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT p.*, provider.username AS provider_name')) {
        assert.match(normalized, /FOR UPDATE$/);
        return [[{ id: 9, owner_user_id: 'provider-old' }]];
      }
      if (normalized === 'UPDATE course_products SET owner_user_id = ? WHERE id = ?') {
        events.push(['product', ...params]);
        return [{ affectedRows: 1 }];
      }
      if (normalized === 'UPDATE course_sessions SET owner_user_id = ? WHERE product_id = ?') {
        events.push(['sessions', ...params]);
        return [{ affectedRows: 3 }];
      }
      throw new Error(`unexpected connection query: ${normalized}`);
    },
  };
  const pool = {
    getConnection: async () => conn,
    query: async (sql) => {
      const schemaResult = schemaQueryResult(sql);
      if (schemaResult) return schemaResult;
      throw new Error(`unexpected pool query: ${String(sql).replace(/\s+/g, ' ').trim()}`);
    },
  };
  const router = buildCourseRoutes({
    ...courseRouteResponseHelpers(), pool, storage: {},
    authRequired: courseRouteMiddleware(), staffRequired: courseRouteMiddleware(),
  });
  const result = await routeHandler(router, 'patch', '/admin/courses/products/:id/owner')({
    params: { id: '9' }, body: { ownerUserId: null }, user: { id: 'admin-1', role: 'ADMIN' },
  }, {});
  assert.equal(result.ok, true);
  assert.equal(result.data.providerUserId, null);
  assert.equal(result.data.movedSessions, 3);
  assert.deepEqual(events.slice(0, -1), ['begin', ['product', null, 9], ['sessions', null, 9], 'commit']);
});

test('course booking rejects a ticket from another provider', async () => {
  const startsAt = new Date(Date.now() + 3600000);
  const conn = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT s.*, (SELECT COUNT(*) FROM course_bookings')) {
        return [[{ id: 4, owner_user_id: 'provider-a', product_id: null, status: 'open', starts_at: startsAt, ends_at: new Date(startsAt.getTime() + 3600000), capacity: 10, booked_count: 0 }]];
      }
      if (normalized.startsWith('SELECT t.*, p.valid_days, p.owner_user_id')) {
        return [[{ id: 5, code: 'TK5', product_id: 5, owner_user_id: 'provider-b', status: 'active', remaining_uses: 1 }]];
      }
      throw new Error(`unexpected connection query: ${normalized}`);
    },
  };
  const pool = {
    getConnection: async () => conn,
    query: async (sql) => {
      const schemaResult = schemaQueryResult(sql);
      if (schemaResult) return schemaResult;
      throw new Error(`unexpected pool query: ${String(sql).replace(/\s+/g, ' ').trim()}`);
    },
  };
  const router = buildCourseRoutes({
    ...courseRouteResponseHelpers(), pool, storage: {},
    authRequired: courseRouteMiddleware(), staffRequired: courseRouteMiddleware(),
  });
  const result = await routeHandler(router, 'post', '/courses/sessions/:id/book')({
    params: { id: '4' }, user: { id: 'member-1', username: '學員', email: 'm@example.com' },
    body: { ticketId: 5, userDataConfirmation: { version: 1, confirmed: true, attendeeName: '學員', attendeeEmail: 'm@example.com' } },
  }, {});
  assert.equal(result.code, 'COURSE_TICKET_NOT_APPLICABLE');
  assert.equal(result.status, 409);
});

test('course order idempotency replays one committed result without a second insert or email', async () => {
  let storedResponse = null;
  let orderInserts = 0;
  let claims = 0;
  let emails = 0;
  let requestHash = '';
  const execute = async (sql, params = []) => {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();
    if (normalized.startsWith('INSERT IGNORE INTO course_request_idempotency_keys')) {
      claims += 1;
      if (claims === 1) requestHash = params[3];
      return [{ affectedRows: claims === 1 ? 1 : 0 }];
    }
    if (normalized.startsWith('SELECT request_hash, status, response_json')) {
      return [[{ request_hash: createHashForTestPayload(), status: 'completed', response_json: storedResponse }]];
    }
    if (normalized.startsWith('SELECT username, email, phone, remittance_last5 FROM users')) {
      return [[{ username: '王小明', email: 'buyer@example.com', phone: '0912345678', remittance_last5: '12345' }]];
    }
    if (normalized.startsWith('SELECT p.*, provider.username AS provider_name')) {
      return [[{ id: 7, name: '課程', price: 1000, status: 'published', owner_user_id: 'provider-1' }]];
    }
    if (normalized.startsWith('SELECT id FROM course_orders WHERE code = ?')) return [[]];
    if (normalized.startsWith('INSERT INTO course_orders')) { orderInserts += 1; return [{ insertId: 71 }]; }
    if (normalized.startsWith('UPDATE course_request_idempotency_keys')) { storedResponse = params[0]; return [{ affectedRows: 1 }]; }
    throw new Error(`unexpected connection query: ${normalized}`);
  };
  function createHashForTestPayload() { return requestHash; }
  const pool = {
    getConnection: async () => ({ beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {}, query: execute }),
    query: async (sql) => {
      const schemaResult = schemaQueryResult(sql);
      if (schemaResult) return schemaResult;
      throw new Error(`unexpected pool query: ${String(sql).replace(/\s+/g, ' ').trim()}`);
    },
  };
  const router = buildCourseRoutes({
    ...courseRouteResponseHelpers(), pool, storage: {}, authRequired: courseRouteMiddleware(), staffRequired: courseRouteMiddleware(),
    isMailerReady: () => true,
    transporter: { sendMail: async () => { emails += 1; } },
    EMAIL_FROM_ADDRESS: 'noreply@example.test',
  });
  const body = {
    productId: 7, quantity: 1, termsAccepted: true, idempotencyKey: 'course-order-key-1',
    expectedUnitPrice: 1000, expectedOwnerUserId: 'provider-1',
    contactConfirmation: { username: '王小明', email: 'buyer@example.com', phone: '0912345678', remittanceLast5: '12345' },
  };
  const request = () => ({ user: { id: 'member-1', username: '王小明', email: 'buyer@example.com' }, body });
  const handler = routeHandler(router, 'post', '/courses/orders');
  const first = await handler(request(), {});
  assert.equal(first.ok, true);
  const second = await handler(request(), {});
  assert.equal(second.ok, true);
  assert.equal(second.data.id, 71);
  assert.equal(orderInserts, 1);
  assert.equal(emails, 1);

  const { contactConfirmation, ...snakeBody } = body;
  const conflict = await handler({
    user: { id: 'member-1', username: '王小明', email: 'buyer@example.com' },
    body: {
      ...snakeBody,
      contact_confirmation: { ...contactConfirmation, phone: '0987654321' },
    },
  }, {});
  assert.equal(conflict.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal(conflict.status, 409);
  assert.equal(orderInserts, 1);
  assert.equal(emails, 1);
});

test('course purchase rejects a price or provider change after the review snapshot', async () => {
  let inserts = 0;
  const conn = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT p.*, provider.username AS provider_name')) {
        return [[{ id: 7, name: '課程', price: 1000, status: 'published', owner_user_id: 'provider-1' }]];
      }
      if (normalized.startsWith('INSERT INTO course_orders')) { inserts += 1; return [{ insertId: 72 }]; }
      if (normalized.startsWith('SELECT id FROM course_orders WHERE code = ?')) return [[]];
      throw new Error(`unexpected connection query: ${normalized}`);
    },
  };
  const pool = {
    getConnection: async () => conn,
    query: async (sql) => {
      const schemaResult = schemaQueryResult(sql);
      if (schemaResult) return schemaResult;
      throw new Error(`unexpected pool query: ${String(sql).replace(/\s+/g, ' ').trim()}`);
    },
  };
  const router = buildCourseRoutes({
    ...courseRouteResponseHelpers(), pool, storage: {},
    authRequired: courseRouteMiddleware(), staffRequired: courseRouteMiddleware(),
  });
  const handler = routeHandler(router, 'post', '/courses/orders');
  const baseBody = {
    productId: 7,
    quantity: 1,
    buyerName: '王小明',
    buyerEmail: 'buyer@example.com',
    remittanceLast5: '12345',
    termsAccepted: true,
    userDataConfirmation: {
      version: 1,
      confirmed: true,
      buyerName: '王小明',
      buyerEmail: 'buyer@example.com',
      remittanceLast5: '12345',
    },
  };
  const request = (body) => ({ user: { id: 'member-1', username: '王小明', email: 'buyer@example.com' }, body });

  const priceChanged = await handler(request({ ...baseBody, expectedUnitPrice: 900, expectedOwnerUserId: 'provider-1' }), {});
  assert.equal(priceChanged.code, 'COURSE_PRODUCT_PRICE_CHANGED');
  assert.equal(priceChanged.status, 409);

  const ownerChanged = await handler(request({ ...baseBody, expectedUnitPrice: 1000, expectedOwnerUserId: 'provider-2' }), {});
  assert.equal(ownerChanged.code, 'COURSE_PRODUCT_OWNER_CHANGED');
  assert.equal(ownerChanged.status, 409);
  assert.equal(inserts, 0);
});
