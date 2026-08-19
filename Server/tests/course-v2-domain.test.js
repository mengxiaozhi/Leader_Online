const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  assertCountCardBookingBoundary,
  assertCountCardSessionBoundary,
  createCourseV2Domain,
  mutationKeyFromRequest,
  requireRowVersion,
  resolveAttendanceUsage,
  rowVersionFromRequest,
  toTicketBalance,
} = require('../src/services/course-v2-domain');
const { registerCourseV2Routes } = require('../src/routes/course-v2');

function runtimePool({ state = 'active', maintenanceMode = 0 } = {}) {
  return {
    async query(sql) {
      if (sql.includes('course_schema_versions')) {
        return [[{ version: '049_course_count_card_normalization' }]];
      }
      if (sql.includes('course_v2_cutover_state')) {
        return [[{
          state,
          schema_version: '049_course_count_card_normalization',
          maintenance_mode: maintenanceMode,
          notes: 'test cutover',
        }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

test('SUCCESS and ticketed NO_SHOW require an active hold and consume its quantity', () => {
  assert.deepEqual(
    resolveAttendanceUsage('SUCCESS', {
      ticketId: 9,
      hold: { quantity: 1 },
    }),
    {
      hasTicket: true,
      usageMode: 'finite',
      quantity: 1,
      deltaUses: -1,
      anomaly: false,
    }
  );
  assert.throws(
    () => resolveAttendanceUsage('SUCCESS', { ticketId: 9 }),
    (error) => error.code === 'COURSE_BOOKING_HOLD_MISSING'
  );
  assert.throws(
    () => resolveAttendanceUsage('NO_SHOW', { ticketId: 9 }),
    (error) => error.code === 'COURSE_BOOKING_HOLD_MISSING'
  );
});

test('count-card domain rejects fixed-term sessions and roster or makeup projections', () => {
  assert.equal(assertCountCardSessionBoundary({ session_kind: 'COUNT_CARD' }).session_kind, 'COUNT_CARD');
  assert.throws(
    () => assertCountCardSessionBoundary({ term_id: 31, session_kind: 'TERM' }),
    (error) => error.code === 'COURSE_COUNT_CARD_SESSION_REQUIRED' && error.statusCode === 409
  );
  assert.throws(
    () => assertCountCardSessionBoundary({ session_kind: 'UNRECOGNIZED' }),
    (error) => error.code === 'COURSE_COUNT_CARD_SESSION_REQUIRED'
  );
  for (const origin of ['TERM_ROSTER', 'MAKEUP']) {
    assert.throws(
      () => assertCountCardBookingBoundary({ origin }),
      (error) => (
        error.code === 'COURSE_COUNT_CARD_BOOKING_REQUIRED'
        && error.details?.origin === origin
      )
    );
  }
  assert.equal(
    assertCountCardBookingBoundary({ origin: 'MEMBER_RSVP' }).origin,
    'MEMBER_RSVP'
  );
});

test('count-card booking and attendance mutations enforce the fixed-term boundary before writes', () => {
  const domainSource = fs.readFileSync(path.join(__dirname, '../src/services/course-v2-domain.js'), 'utf8');
  const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/courses.js'), 'utf8');
  const attendance = domainSource.slice(
    domainSource.indexOf('async function attendanceAction'),
    domainSource.indexOf('async function undoAttendance')
  );
  const cancellation = domainSource.slice(
    domainSource.indexOf('async function cancelBooking'),
    domainSource.indexOf('async function changeTicketState')
  );
  const bookingRoute = routeSource.slice(
    routeSource.indexOf("router.post('/courses/sessions/:id/book'"),
    routeSource.indexOf("router.delete('/courses/bookings/:id'"),
  );
  const sharedCapabilities = routeSource.slice(
    routeSource.indexOf('async function enrichCourseBookingPolicies'),
    routeSource.indexOf('function toCourseBooking')
  );

  assert.ok(attendance.indexOf('assertCountCardBookingBoundary(scopeRows[0])')
    < attendance.indexOf('claimMutation(conn'));
  assert.ok(cancellation.indexOf('assertCountCardBookingBoundary(booking)')
    < cancellation.indexOf('claimMutation(conn'));
  assert.match(bookingRoute, /assertCountCardSessionBoundary\(session\)/);
  assert.ok(bookingRoute.indexOf('assertCountCardSessionBoundary(session)')
    < bookingRoute.indexOf('claimMutation(conn'));
  assert.match(sharedCapabilities, /\['TERM_ROSTER', 'MAKEUP'\]/);
  assert.match(sharedCapabilities, /attend: false/);
  assert.match(sharedCapabilities, /noShow: false/);
});

test('cancel and attendance APIs reject fixed-term projections without claiming a mutation', async () => {
  async function rejectedMutation(origin, run) {
    const observed = [];
    const runtimeRows = (sql) => {
      if (sql.includes('course_schema_versions')) {
        return [[{ version: '049_course_count_card_normalization' }]];
      }
      if (sql.includes('course_v2_cutover_state')) {
        return [[{
          state: 'active',
          schema_version: '049_course_count_card_normalization',
          maintenance_mode: 0,
        }]];
      }
      return null;
    };
    const conn = {
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
      release() {},
      async query(sql) {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        observed.push(normalized);
        const runtime = runtimeRows(normalized);
        if (runtime) return runtime;
        if (normalized.startsWith('SELECT s.owner_user_id, b.origin,')) {
          return [[{ owner_user_id: 'provider-1', origin }]];
        }
        if (normalized.startsWith('SELECT b.*, s.starts_at')) {
          return [[{
            id: 21,
            origin,
            status: 'booked',
            row_version: 1,
            owner_user_id: 'provider-1',
          }]];
        }
        throw new Error(`Unexpected SQL: ${normalized}`);
      },
    };
    const pool = {
      async query(sql) {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        observed.push(normalized);
        const runtime = runtimeRows(normalized);
        if (runtime) return runtime;
        throw new Error(`Unexpected SQL: ${normalized}`);
      },
      async getConnection() {
        return conn;
      },
    };
    const domain = createCourseV2Domain({ pool, enabled: true });
    await assert.rejects(
      run(domain),
      (error) => (
        error.code === 'COURSE_COUNT_CARD_BOOKING_REQUIRED'
        && error.details?.origin === origin
      )
    );
    assert.equal(
      observed.some((sql) => sql.includes('course_mutation_commands')),
      false
    );
  }

  await rejectedMutation('TERM_ROSTER', (domain) => domain.cancelBooking({
    bookingId: 21,
    actorUserId: 'member-1',
    userId: 'member-1',
    idempotencyKey: 'cancel-term-roster-21',
    expectedRowVersion: 1,
  }));
  await rejectedMutation('MAKEUP', (domain) => domain.attendanceAction({
    bookingId: 21,
    action: 'attend',
    actorUserId: 'staff-1',
    idempotencyKey: 'attend-term-makeup-21',
    expectedRowVersion: 1,
  }));
});

test('a no-ticket NO_SHOW is retained as a zero-use anomaly', () => {
  assert.deepEqual(resolveAttendanceUsage('NO_SHOW'), {
    hasTicket: false,
    usageMode: 'finite',
    quantity: 0,
    deltaUses: 0,
    anomaly: true,
  });
});

test('redeem quantity is consumed consistently while unlimited passes record zero delta', () => {
  assert.deepEqual(resolveAttendanceUsage('SUCCESS', {
    ticketId: 9,
    hold: { quantity: 3 },
  }), {
    hasTicket: true,
    usageMode: 'finite',
    quantity: 3,
    deltaUses: -3,
    anomaly: false,
  });
  assert.deepEqual(resolveAttendanceUsage('NO_SHOW', {
    ticketId: 10,
    hold: { quantity: 3 },
    usageMode: 'unlimited',
  }), {
    hasTicket: true,
    usageMode: 'unlimited',
    quantity: 3,
    deltaUses: 0,
    anomaly: false,
  });
});

test('course mutations read idempotency and weak If-Match headers', () => {
  const request = {
    get(name) {
      if (name === 'Idempotency-Key') return 'course-action-123';
      if (name === 'If-Match') return 'W/"17"';
      return undefined;
    },
    headers: {},
    body: {},
  };
  assert.equal(mutationKeyFromRequest(request), 'course-action-123');
  assert.equal(rowVersionFromRequest(request), 17);
  assert.equal(requireRowVersion(17, '預約'), 17);
  assert.throws(
    () => requireRowVersion(null, '預約'),
    (error) => error.code === 'COURSE_ROW_VERSION_REQUIRED' && error.statusCode === 428
  );
});

test('ticket balance DTO preserves camel and snake case cache values', () => {
  assert.deepEqual(
    toTicketBalance({
      id: 8,
      remainingUses: 5,
      heldUses: 2,
      row_version: 4,
    }),
    {
      ticketId: 8,
      usageMode: 'finite',
      unlimited: false,
      remainingUses: 5,
      heldUses: 2,
      availableUses: 3,
      rowVersion: 4,
    }
  );
  assert.deepEqual(
    toTicketBalance({
      ticket_id: 9,
      remaining_uses_cache: 3,
      active_holds: 1,
      row_version: 2,
    }),
    {
      ticketId: 9,
      usageMode: 'finite',
      unlimited: false,
      remainingUses: 3,
      heldUses: 1,
      availableUses: 2,
      rowVersion: 2,
    }
  );
  assert.deepEqual(toTicketBalance({
    id: 10,
    usage_mode: 'unlimited',
    remaining_uses_cache: 0,
    active_holds: 6,
    row_version: 1,
  }), {
    ticketId: 10,
    usageMode: 'unlimited',
    unlimited: true,
    remainingUses: 0,
    heldUses: 6,
    availableUses: null,
    rowVersion: 1,
  });
});

test('first consumption fails closed when a legacy ticket has no validity snapshot', async () => {
  const domain = createCourseV2Domain({ pool: runtimePool(), enabled: true });
  const conn = {
    async query(sql) {
      if (String(sql).includes('SELECT t.status, t.activated_at')) {
        return [[{
          status: 'pending',
          activated_at: null,
          expires_at: null,
          product_valid_days_snapshot: null,
          usage_mode: 'finite',
        }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  await assert.rejects(
    domain.syncTicketBalanceCache(conn, 42, {
      unlimited: false,
      remainingUses: 9,
      heldUses: 0,
      ticket: {
        product_class_count_snapshot: 10,
        total_uses: 10,
      },
    }, { activateOnConsume: true }),
    (error) => (
      error.code === 'COURSE_TICKET_VALIDITY_SNAPSHOT_REQUIRED'
      && error.statusCode === 409
    )
  );
});

test('completed mutation commands replay with their stable command id', async () => {
  const { requestHash } = require('../src/services/course-v2-domain');
  const payload = { bookingId: 12, action: 'attend' };
  let calls = 0;
  const conn = {
    async query(sql) {
      calls += 1;
      if (sql.startsWith('INSERT IGNORE')) return [{ affectedRows: 0 }];
      return [[{
        id: 77,
        request_hash: requestHash(payload),
        status: 'completed',
        response_json: JSON.stringify({ bookingId: 12, status: 'attended' }),
      }]];
    },
  };
  const domain = createCourseV2Domain({ pool: runtimePool(), enabled: true });
  const result = await domain.claimMutation(conn, {
    actorUserId: '11111111-1111-1111-1111-111111111111',
    operation: 'booking.attend',
    idempotencyKey: 'attend-replay-12',
    payload,
  });
  assert.equal(result.commandId, 77);
  assert.deepEqual(result.replay, { bookingId: 12, status: 'attended' });
  assert.equal(calls, 2);
});

test('cutover mutation guard blocks frozen writes and active-v2 flag mismatch', async () => {
  const frozen = createCourseV2Domain({
    pool: runtimePool({ state: 'frozen', maintenanceMode: 1 }),
    enabled: false,
  });
  await assert.rejects(
    frozen.assertMutationAllowed(),
    (error) => error.code === 'COURSE_WRITES_FROZEN' && error.statusCode === 503
  );

  const staleLegacy = createCourseV2Domain({
    pool: runtimePool({ state: 'active' }),
    enabled: false,
  });
  await assert.rejects(
    staleLegacy.assertMutationAllowed(),
    (error) => error.code === 'COURSE_V2_RUNTIME_MISMATCH' && error.statusCode === 503
  );
});

test('051 count-card operations require runtime, schema, and provider flags', async () => {
  const runtimeDisabled = createCourseV2Domain({
    pool: runtimePool(),
    enabled: true,
    countCardParityEnabled: false,
  });
  await assert.rejects(
    runtimeDisabled.assertCountCardParity(),
    (error) => error.code === 'COURSE_COUNT_CARD_PARITY_DISABLED'
  );

  const missingSchema = createCourseV2Domain({
    pool: {
      async query() { return [[]]; },
    },
    enabled: true,
    countCardParityEnabled: true,
  });
  await assert.rejects(
    missingSchema.assertCountCardParity(),
    (error) => error.code === 'COURSE_COUNT_CARD_PARITY_SCHEMA_REQUIRED'
  );

  const providerDisabled = createCourseV2Domain({
    pool: {
      async query(sql) {
        if (String(sql).includes('course_settings')) {
          return [[
            { scope: 'provider', count_card_parity_enabled: 0 },
            { scope: 'platform', count_card_parity_enabled: 1 },
          ]];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    },
    enabled: true,
    countCardParityEnabled: true,
  });
  await assert.rejects(
    providerDisabled.assertProviderCountCardParity({
      async query(sql) {
        if (String(sql).includes('course_settings')) {
          return [[
            { scope: 'provider', count_card_parity_enabled: 0 },
            { scope: 'platform', count_card_parity_enabled: 1 },
          ]];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    }, 'provider-1'),
    (error) => error.code === 'COURSE_COUNT_CARD_PARITY_PROVIDER_DISABLED'
  );
});

test('settings remain a schema-aware bootstrap surface while V2 cutover is legacy', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/course-v2.js'), 'utf8');
  const settings = source.slice(
    source.indexOf("router.get('/admin/courses/settings'"),
    source.indexOf("router.patch('/admin/courses/sessions/:id/policy'", source.indexOf("router.get('/admin/courses/settings'"))
  );
  assert.match(settings, /readCourseSettingsFeatureState\(\{ refresh: true \}\)/);
  assert.match(source, /countCardParityReadOnly/);
  assert.match(source, /COURSE_COUNT_CARD_PARITY_READ_ONLY/);
  assert.doesNotMatch(settings, /if \(!await assertV2\(res\)\)/);
  assert.match(settings, /fixed_term_enabled/);
  assert.match(settings, /advanced_payments_enabled/);
});

test('legacy V2 runtime can read provider-scoped fixed-term settings without activating cutover', async () => {
  const registered = new Map();
  const router = {};
  for (const method of ['get', 'post', 'patch', 'delete']) {
    router[method] = (route, ...handlers) => registered.set(`${method.toUpperCase()} ${route}`, handlers);
  }
  const pool = {
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (normalized === 'SELECT id, role FROM users WHERE id = ? LIMIT 1') {
        return [[{ id: params[0], role: 'ADMIN' }]];
      }
      if (normalized.includes('WHERE version IN (?, ?, ?)')) {
        return [[
          { version: '051_course_count_card_operational_parity' },
          { version: '052_course_fixed_term_productization' },
          { version: '053_course_term_payments_notifications' },
        ]];
      }
      if (normalized.includes('FROM course_settings WHERE scope_key = ?')) {
        assert.equal(params[0], 'provider:provider-1');
        return [[{
          id: 8,
          timezone: 'Asia/Taipei',
          count_card_parity_enabled: 1,
          fixed_term_enabled: 1,
          advanced_payments_enabled: 1,
          row_version: 4,
        }]];
      }
      throw new Error(`unexpected query: ${normalized}`);
    },
  };
  registerCourseV2Routes({
    router,
    ctx: {
      pool,
      ok(_res, data) { return { ok: true, data }; },
      fail(_res, code, message, status) { return { ok: false, code, message, status }; },
      authRequired(_req, _res, next) { return next(); },
    },
    domain: {
      enabled: false,
      async readRuntimeState() {
        return { enabled: false, active: false, cutoverState: 'legacy' };
      },
    },
    termDomain: {
      COURSE_TERM_SCHEMA_VERSION: '052_course_fixed_term_productization',
      COURSE_PAYMENT_SCHEMA_VERSION: '053_course_term_payments_notifications',
      async readSchemaState() {
        return { enabled: true, advancedPaymentsEnabled: true };
      },
    },
  });
  const handler = registered.get('GET /admin/courses/settings').at(-1);
  const result = await handler({
    user: { id: 'admin-1', role: 'ADMIN' },
    query: { ownerUserId: 'provider-1' },
    body: {},
  }, {});
  assert.equal(result.ok, true);
  assert.equal(result.data.ownerUserId, 'provider-1');
  assert.equal(result.data.fixedTermEnabled, true);
  assert.equal(result.data.advancedPaymentsEnabled, true);
  assert.equal(result.data.countCardParityEnabled, false);
  assert.equal(result.data.countCardParityReadOnly, true);
  assert.equal(result.data.v2CutoverState, 'legacy');
});

test('051 catalog drafts and readiness are schema-gated while operations stay rollout-gated', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/course-v2.js'), 'utf8');
  const catalog = source.slice(
    source.indexOf("router.get('/admin/courses/ticket-products'"),
    source.indexOf("router.get('/admin/courses/settings'")
  );
  for (const route of [
    "router.get('/admin/courses/ticket-products'",
    "router.post('/admin/courses/ticket-products'",
    "router.patch('/admin/courses/ticket-products/:id'",
    "router.get('/admin/courses/scenarios'",
    "router.post('/admin/courses/scenarios'",
    "router.patch('/admin/courses/scenarios/:id'",
    "router.get('/admin/courses/scenarios/:id/readiness'",
    "router.get('/admin/courses/products/:id/readiness'",
  ]) assert.match(catalog, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal((catalog.match(/requireEnabled: false/g) || []).length >= 8, true);
  const walkIn = source.slice(
    source.indexOf("router.post('/admin/courses/sessions/:id/walk-ins'"),
    source.indexOf("router.get('/admin/courses/sessions/:id/eligibility'")
  );
  assert.match(walkIn, /providerScoped: true/);
});

test('051 session dimensions are loaded only after runtime, schema, and provider checks', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../src/services/course-v2-domain.js'), 'utf8');
  const loader = source.slice(
    source.indexOf('async function withCountCardSessionFields'),
    source.indexOf('async function loadSession')
  );
  assert.match(loader, /if \(!countCardParityEnabled \|\| !sessionId\) return scopedSession/);
  assert.match(loader, /count_card_parity_enabled/);
  assert.match(loader, /await assertCountCardParity\(queryable\)/);
  assert.match(loader, /SELECT venue_name, city, cancel_close_at/);

  const recordUsage = source.slice(
    source.indexOf('async function recordUsageEvent'),
    source.indexOf('async function recordIssuance')
  );
  const legacyLookup = recordUsage.slice(
    recordUsage.indexOf('if (sessionId && ('),
    recordUsage.indexOf('const resolvedProviderUserId')
  );
  assert.doesNotMatch(legacyLookup, /s\.venue_name|s\.city|s\.cancel_close_at/);
  assert.match(recordUsage, /operationalParityActive[\s\S]*SELECT venue_name, city/);
});

test('walk-in and attendance invite contracts require a registered tenant student and restricted override', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const domain = fs.readFileSync(path.join(__dirname, '../src/services/course-v2-domain.js'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/course-v2.js'), 'utf8');
  assert.match(domain, /JOIN users u ON u\.id = s\.user_id/);
  assert.match(domain, /COURSE_REGISTERED_STUDENT_REQUIRED/);
  assert.match(domain, /COURSE_CAPACITY_OVERRIDE_REASON_REQUIRED/);
  assert.match(domain, /capacity_override, capacity_override_reason/);
  assert.match(routes, /allowCapacityOverride:[\s\S]*manageTicketExceptions/);
  assert.match(routes, /allowCapacityOverride:[\s\S]*manageSettings/);
  const inviteCreate = domain.slice(
    domain.indexOf('async function createAttendanceInvite'),
    domain.indexOf('async function createWalkIn')
  );
  const walkInCreate = domain.slice(
    domain.indexOf('async function createWalkIn'),
    domain.indexOf('async function confirmAttendanceInvite')
  );
  assert.match(inviteCreate, /session\.status[\s\S]*COURSE_SESSION_CANCELLED/);
  assert.match(walkInCreate, /session\.status[\s\S]*COURSE_SESSION_CANCELLED/);
});

test('released attendance invite pending review rebuilds an exact hold before ops resolution', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/course-v2-domain.js'), 'utf8');
  const consume = source.slice(
    source.indexOf('async function consumeAttendance'),
    source.indexOf('async function attendanceAction')
  );
  assert.match(consume, /origin \|\| ''\)\.toUpperCase\(\) === 'ATTENDANCE_INVITE'/);
  assert.match(consume, /status = 'expired' AND expiry_action = 'release'/);
  assert.match(consume, /await createHold\(conn,[\s\S]*scenario_redeem_quantity/);
  assert.match(consume, /purpose: 'ATTENDANCE_CONFIRMATION'/);
  assert.ok(consume.indexOf('await createHold(conn') < consume.indexOf('recordUsageEvent(conn'));
});

test('member ledger authorization uses only the current ticket or linked-student holder', async () => {
  let observedSql = '';
  const domain = createCourseV2Domain({
    pool: {
      async query(sql) {
        observedSql = sql;
        return [[]];
      },
    },
    enabled: true,
  });
  await domain.listTicketLedger({ ticketId: 8, userId: 'current-holder' });
  assert.match(observedSql, /t\.user_id = \?/);
  assert.match(observedSql, /t\.user_id IS NULL AND student\.user_id = \?/);
  assert.doesNotMatch(observedSql, /e\.user_id = \?/);
});

test('normalized order issuance is paid-only and snapshots TicketProduct facts', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/courses.js'), 'utf8');
  assert.match(source, /String\(order\.status\) !== 'paid'/);
  assert.match(source, /COURSE_ORDER_NOT_PAID/);
  assert.match(source, /product_code_snapshot/);
  assert.match(source, /course_order_items/);
});

test('manual ticket qualification is explicit and auditable', () => {
  const courseRoutes = fs.readFileSync(path.join(__dirname, '../src/routes/courses.js'), 'utf8');
  const sales = fs.readFileSync(path.join(__dirname, '../src/services/course-v2-sales.js'), 'utf8');
  assert.match(courseRoutes, /COURSE_MANUAL_ISSUE_QUALIFICATION_DECISION_REQUIRED/);
  assert.match(courseRoutes, /countsTowardReturningEligibility/);
  assert.match(courseRoutes, /issuanceSourceType:[\s\S]*'manual_qualification'/);
  assert.match(sales, /qualifying_order\.payment_status = 'paid'/);
  assert.match(sales, /qualifying_order\.fulfillment_status = 'fulfilled'/);
  assert.match(sales, /manual_issuance\.source_type = 'manual_qualification'/);
});

test('shared attend route delegates to the legacy handler when V2 is disabled', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/course-v2.js'), 'utf8');
  assert.match(source, /action === 'attend' && !courseV2\.enabled\) return next\(\)/);
});

test('ticket exceptions are explicit tenant-scoped V2 mutations', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/course-v2.js'), 'utf8');
  const domainSource = fs.readFileSync(path.join(__dirname, '../src/services/course-v2-domain.js'), 'utf8');
  assert.match(routeSource, /for \(const action of \['freeze', 'unfreeze'\]\)/);
  assert.match(routeSource, /tickets\/:id\/reactivate/);
  assert.match(domainSource, /COURSE_TICKET_ACTIVE_HOLD/);
  assert.match(domainSource, /COURSE_TICKET_PAUSE_LIMIT_REACHED/);
  assert.match(domainSource, /pause_max_days_snapshot/);
  assert.match(domainSource, /async function processDuePausedTickets/);
  assert.match(domainSource, /AUTO_RESUME_PAUSE_LIMIT/);
  assert.match(domainSource, /\['active', 'exhausted', 'expired'\]/);
  assert.match(domainSource, /state, started_at, ended_at, extension_days/);
  assert.match(domainSource, /state, started_at, reason, actor_user_id, metadata_json/);
});

test('reports count redeemed quantity for unlimited passes without classifying them as low balance', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/course-v2.js'), 'utf8');
  assert.match(source, /eventQuantitySql[\s\S]*e\.quantity_snapshot/);
  assert.match(source, /e\.event_type = 'SUCCESS'[\s\S]*\$\{eventQuantitySql\}/);
  assert.match(source, /e\.event_type = 'NO_SHOW'[\s\S]*\$\{eventQuantitySql\}/);
  assert.match(source, /AS unlimited_ticket_count/);
  assert.match(source, /unlimitedTicketCount === 0[\s\S]*availableRemainingUses/);
});

test('excused leave is a typed booking fact and never mutates the usage ledger', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../src/services/course-v2-domain.js'), 'utf8');
  const excusedLeaveBranch = source.slice(
    source.indexOf("} else if (action === 'excused-leave')"),
    source.indexOf("} else if (action === 'undo')")
  );
  assert.match(excusedLeaveBranch, /resolution_type = 'excused_leave'/);
  assert.match(excusedLeaveBranch, /usageEvent: null/);
  assert.doesNotMatch(excusedLeaveBranch, /recordUsageEvent/);
});

test('usage reversal is a privileged, reasoned exception and is not window-bound', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/course-v2.js'), 'utf8');
  const domainSource = fs.readFileSync(path.join(__dirname, '../src/services/course-v2-domain.js'), 'utf8');
  const undo = domainSource.slice(
    domainSource.indexOf('async function undoAttendance'),
    domainSource.indexOf('async function adjustTicket')
  );
  assert.match(routeSource, /action === 'undo' \? 'manageTicketExceptions' : 'manageAttendance'/);
  assert.match(routeSource, /COURSE_REVERSAL_REASON_REQUIRED/);
  assert.match(undo, /COURSE_REVERSAL_REASON_REQUIRED/);
  assert.doesNotMatch(undo, /COURSE_UNDO_OUTSIDE_WINDOW|canRedeemOnsite/);
  assert.match(undo, /deltaUses: -Number\(original\.delta_uses\)/);
  assert.match(undo, /quantity: Math\.max\([\s\S]*Math\.abs\(Number\(original\.delta_uses/);
});

test('verified-email student claim attaches imported tickets, bookings, orders, and invites', async () => {
  const queries = [];
  const queryable = {
    async query(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      queries.push(normalized);
      if (normalized.includes('course_schema_versions')) {
        return [[{ version: '049_course_count_card_normalization' }]];
      }
      if (normalized.includes('course_v2_cutover_state')) {
        return [[{
          state: 'active',
          schema_version: '049_course_count_card_normalization',
          maintenance_mode: 0,
        }]];
      }
      if (normalized.startsWith('SELECT id, tenant_key, user_id FROM course_students')) {
        return [[{ id: 41, tenant_key: 'provider:owner-1', user_id: null }]];
      }
      if (normalized.startsWith('SELECT id, tenant_key FROM course_students')) return [[]];
      if (normalized.startsWith('SELECT id FROM course_tickets')) return [[]];
      if (normalized.startsWith('SELECT id FROM course_attendance_invites')) return [[]];
      if (normalized.startsWith('SELECT id, session_id, user_id FROM course_bookings')) {
        return [[{ id: 81, session_id: 91, user_id: null }]];
      }
      if (normalized.startsWith('SELECT id, session_id FROM course_bookings')) return [[]];
      if (normalized.startsWith('SELECT id, user_id FROM course_orders')) {
        return [[{ id: 71, user_id: null }]];
      }
      if (normalized.startsWith('UPDATE course_students')) return [{ affectedRows: 1 }];
      if (normalized.startsWith('UPDATE course_tickets')) return [{ affectedRows: 2 }];
      if (normalized.startsWith('UPDATE course_attendance_invites')) return [{ affectedRows: 1 }];
      if (normalized.startsWith('UPDATE course_bookings')) return [{ affectedRows: 1 }];
      if (normalized.startsWith('UPDATE course_orders')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
  };
  const domain = createCourseV2Domain({ pool: runtimePool(), enabled: true });
  const result = await domain.claimStudentForVerifiedEmail(queryable, {
    userId: '11111111-1111-1111-1111-111111111111',
    email: ' Student@Example.com ',
  });

  assert.deepEqual(result, {
    claimed: 1,
    studentIds: [41],
    ticketClaims: 2,
    bookingClaims: 1,
    orderClaims: 1,
    inviteClaims: 1,
  });
  assert.ok(queries.some((sql) => (
    sql.includes('UPDATE course_bookings')
    && sql.includes('student_id IN (?) AND user_id IS NULL')
  )));
  assert.ok(queries.some((sql) => (
    sql.includes('UPDATE course_orders')
    && sql.includes('student_id IN (?) AND user_id IS NULL')
  )));
});

test('verified-email student claim rejects an already-owned booking for the same session', async () => {
  const queryable = {
    async query(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (normalized.includes('course_schema_versions')) {
        return [[{ version: '049_course_count_card_normalization' }]];
      }
      if (normalized.includes('course_v2_cutover_state')) {
        return [[{
          state: 'active',
          schema_version: '049_course_count_card_normalization',
          maintenance_mode: 0,
        }]];
      }
      if (normalized.startsWith('SELECT id, tenant_key, user_id FROM course_students')) {
        return [[{ id: 41, tenant_key: 'provider:owner-1', user_id: null }]];
      }
      if (normalized.startsWith('SELECT id, tenant_key FROM course_students')) return [[]];
      if (normalized.startsWith('SELECT id FROM course_tickets')) return [[]];
      if (normalized.startsWith('SELECT id FROM course_attendance_invites')) return [[]];
      if (normalized.startsWith('SELECT id, session_id, user_id FROM course_bookings')) {
        return [[{ id: 81, session_id: 91, user_id: null }]];
      }
      if (normalized.startsWith('SELECT id, session_id FROM course_bookings')) {
        return [[{ id: 82, session_id: 91 }]];
      }
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
  };
  const domain = createCourseV2Domain({ pool: runtimePool(), enabled: true });
  await assert.rejects(
    domain.claimStudentForVerifiedEmail(queryable, {
      userId: '11111111-1111-1111-1111-111111111111',
      email: 'student@example.com',
    }),
    (error) => (
      error.code === 'COURSE_STUDENT_CLAIM_CONFLICT'
      && error.details?.bookingIds?.[0] === 82
    )
  );
});

test('main and v1 MySQL pools decode DATETIME values as Asia/Taipei', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const file of ['../src/context.js', '../v1/index.js']) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.match(source, /mysql\.createPool\(\{[\s\S]*?timezone:\s*'\+08:00'/);
  }
});

test('main and v1 mount the same course router with STORE-only role canonicalization', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const mainRouter = fs.readFileSync(path.join(__dirname, '../src/router.js'), 'utf8');
  const v1 = fs.readFileSync(path.join(__dirname, '../v1/index.js'), 'utf8');
  const courses = fs.readFileSync(path.join(__dirname, '../src/routes/courses.js'), 'utf8');
  const courseV2 = fs.readFileSync(path.join(__dirname, '../src/routes/course-v2.js'), 'utf8');
  const { normalizeCoursePlatformRole } = require('../src/services/course-role');

  assert.match(mainRouter, /router\.use\(buildCourseRoutes\(ctx\)\)/);
  assert.match(v1, /app\.use\(buildCourseRoutes\(\{/);
  assert.match(courses, /require\('\.\.\/services\/course-role'\)/);
  assert.match(courseV2, /require\('\.\.\/services\/course-role'\)/);
  assert.equal(normalizeCoursePlatformRole('STORE'), 'SERVICE_PROVIDER');
  assert.equal(normalizeCoursePlatformRole('COACH'), 'COACH');
});

test('attendance reversal vocabulary and invite booking linkage match the normalized contract', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../src/services/course-v2-domain.js'), 'utf8');
  assert.match(source, /eventType:\s*'REVERSAL'/);
  assert.doesNotMatch(source, /eventType:\s*`UNDO_\$\{original\.event_type\}`/);
  assert.match(
    source,
    /SET status = 'confirmed', confirmed_at = NOW\(\),\s*booking_id = \?, redeemed_usage_event_id = \?/
  );
  assert.match(source, /if \(ticket\.frozen_at\) \{\s*throw domainError\('COURSE_TICKET_FROZEN'/);
});

test('creating and releasing a hold advances the ticket row version', async () => {
  const domain = createCourseV2Domain({ pool: runtimePool(), enabled: true });
  const createConn = {
    async query(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT COALESCE(rs.redeem_quantity')) {
        return [[{ redeem_quantity: 1 }]];
      }
      if (normalized.startsWith('SELECT t.id, t.user_id, t.student_id')) {
        return [[{ id: 9, row_version: 4, total_uses: 3, status: 'active', frozen_at: null }]];
      }
      if (normalized.startsWith('SELECT COALESCE(SUM(delta_uses)')) {
        return [[{ balance: 3 }]];
      }
      if (normalized.startsWith('SELECT COALESCE(SUM(quantity)')) {
        return [[{ active_holds: 1 }]];
      }
      if (normalized.startsWith('INSERT INTO course_ticket_holds')) {
        return [{ insertId: 77 }];
      }
      if (normalized.startsWith('UPDATE course_tickets')) {
        assert.match(normalized, /SET row_version = row_version \+ 1/);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
  };
  const created = await domain.createHold(createConn, {
    ticketId: 9,
    bookingId: 12,
  });
  assert.equal(created.ticketRowVersion, 5);
  assert.equal(created.availableUses, 1);
  assert.equal(created.quantity, 1);

  const releaseConn = {
    async query(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT * FROM course_ticket_holds')) {
        return [[{ id: 77, ticket_id: 9, status: 'active' }]];
      }
      if (normalized.startsWith('UPDATE course_ticket_holds')) return [{ affectedRows: 1 }];
      if (normalized.startsWith('SELECT t.id, t.user_id, t.student_id')) {
        return [[{ id: 9, row_version: 5, total_uses: 3, status: 'active', frozen_at: null }]];
      }
      if (normalized.startsWith('SELECT COALESCE(SUM(delta_uses)')) {
        return [[{ balance: 3 }]];
      }
      if (normalized.startsWith('SELECT COALESCE(SUM(quantity)')) {
        return [[{ active_holds: 0 }]];
      }
      if (normalized.startsWith('UPDATE course_tickets')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
  };
  const released = await domain.releaseHold(releaseConn, {
    bookingId: 12,
    actorUserId: '11111111-1111-1111-1111-111111111111',
  });
  assert.equal(released.ticketRowVersion, 6);
  assert.equal(released.rowVersion, 6);
  assert.equal(released.availableUses, 3);
});

test('hold creation reserves the scenario redeem quantity and unlimited passes ignore balance', async () => {
  const inserted = [];
  const domain = createCourseV2Domain({ pool: runtimePool(), enabled: true });
  const conn = {
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT COALESCE(rs.redeem_quantity')) {
        return [[{ redeem_quantity: 3 }]];
      }
      if (normalized.startsWith('SELECT t.id, t.user_id, t.student_id')) {
        return [[{
          id: 19,
          row_version: 4,
          total_uses: 0,
          status: 'active',
          frozen_at: null,
          usage_mode: 'unlimited',
        }]];
      }
      if (normalized.startsWith('SELECT COALESCE(SUM(delta_uses)')) return [[{ balance: 0 }]];
      if (normalized.startsWith('SELECT COALESCE(SUM(quantity)')) return [[{ active_holds: 50 }]];
      if (normalized.startsWith('INSERT INTO course_ticket_holds')) {
        inserted.push(params);
        return [{ insertId: 88 }];
      }
      if (normalized.startsWith('UPDATE course_tickets')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
  };
  const hold = await domain.createHold(conn, {
    ticketId: 19,
    bookingId: 22,
  });
  assert.equal(hold.quantity, 3);
  assert.equal(hold.usageMode, 'unlimited');
  assert.equal(hold.availableUses, null);
  assert.equal(inserted[0][3], 3);
});

test('hold creation rejects paused, frozen, expired, and activation-expired tickets', async () => {
  const domain = createCourseV2Domain({ pool: runtimePool(), enabled: true });
  async function rejectsTicket(ticket, expectedCode) {
    const conn = {
      async query(sql) {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        if (normalized.startsWith('SELECT COALESCE(rs.redeem_quantity')) {
          return [[{ redeem_quantity: 1 }]];
        }
        if (normalized.startsWith('SELECT t.id, t.user_id, t.student_id')) return [[ticket]];
        if (normalized.startsWith('SELECT COALESCE(SUM(delta_uses)')) return [[{ balance: 3 }]];
        if (normalized.startsWith('SELECT COALESCE(SUM(quantity)')) return [[{ active_holds: 0 }]];
        throw new Error(`Unexpected SQL: ${normalized}`);
      },
    };
    await assert.rejects(
      domain.createHold(conn, { ticketId: ticket.id, bookingId: 12 }),
      (error) => error.code === expectedCode
    );
  }
  await rejectsTicket({ id: 1, status: 'paused', row_version: 1 }, 'COURSE_TICKET_UNAVAILABLE');
  await rejectsTicket({ id: 2, status: 'active', frozen_at: new Date(), row_version: 1 }, 'COURSE_TICKET_FROZEN');
  await rejectsTicket({ id: 3, status: 'active', expires_at: '2020-01-01', row_version: 1 }, 'COURSE_TICKET_EXPIRED');
  await rejectsTicket({
    id: 4,
    status: 'pending',
    activation_deadline: '2020-01-01',
    row_version: 1,
  }, 'COURSE_TICKET_ACTIVATION_EXPIRED');
});

test('expired attendance invite release policy returns the held quantity without usage', async () => {
  const observed = [];
  const conn = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      observed.push(normalized);
      if (normalized.includes('course_schema_versions')) {
        return [[{ version: '049_course_count_card_normalization' }]];
      }
      if (normalized.includes('course_v2_cutover_state')) {
        return [[{
          state: 'active',
          schema_version: '049_course_count_card_normalization',
          maintenance_mode: 0,
        }]];
      }
      if (normalized.startsWith('SELECT * FROM course_settings')) {
        return [[
          { scope: 'provider', count_card_parity_enabled: 1 },
          { scope: 'platform', count_card_parity_enabled: 1 },
        ]];
      }
      if (normalized.startsWith('SELECT * FROM course_attendance_invites')) {
        return [[{
          id: 7,
          owner_user_id: 'provider-1',
          session_id: 17,
          student_id: 27,
          user_id: 'student-user-1',
          ticket_id: 9,
          hold_id: 77,
          expiry_action: 'release',
          status: 'pending',
        }]];
      }
      if (normalized.startsWith('SELECT s.id, s.user_id')) {
        return [[{
          id: 27,
          user_id: 'student-user-1',
          display_name: '學員',
          email: 'student@example.com',
          user_email: 'student@example.com',
        }]];
      }
      if (normalized.startsWith('INSERT INTO course_bookings')) return [{ insertId: 37 }];
      if (normalized.startsWith('UPDATE course_ticket_holds SET booking_id')) return [{ affectedRows: 1 }];
      if (normalized.startsWith('UPDATE course_attendance_invites SET booking_id')) return [{ affectedRows: 1 }];
      if (normalized.startsWith('SELECT * FROM course_ticket_holds')) {
        return [[{ id: 77, ticket_id: 9, invite_id: 7, quantity: 3, status: 'active' }]];
      }
      if (normalized.startsWith('UPDATE course_ticket_holds')) return [{ affectedRows: 1 }];
      if (normalized.startsWith('SELECT t.id, t.user_id, t.student_id')) {
        return [[{ id: 9, row_version: 4, status: 'active', usage_mode: 'finite' }]];
      }
      if (normalized.startsWith('SELECT COALESCE(SUM(delta_uses)')) return [[{ balance: 5 }]];
      if (normalized.startsWith('SELECT COALESCE(SUM(quantity)')) return [[{ active_holds: 0 }]];
      if (normalized.startsWith('UPDATE course_tickets')) return [{ affectedRows: 1 }];
      if (normalized.startsWith('UPDATE course_attendance_invites')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
  };
  const pool = {
    async getConnection() {
      return conn;
    },
    async query(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      observed.push(normalized);
      if (normalized.includes('course_schema_versions')) {
        return [[{ version: '049_course_count_card_normalization' }]];
      }
      if (normalized.includes('course_v2_cutover_state')) {
        return [[{
          state: 'active',
          schema_version: '049_course_count_card_normalization',
          maintenance_mode: 0,
        }]];
      }
      if (normalized.startsWith('SELECT i.id FROM course_attendance_invites')) return [[{ id: 7 }]];
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
  };
  const domain = createCourseV2Domain({
    pool,
    enabled: true,
    countCardParityEnabled: true,
  });
  const result = await domain.processDueAttendanceInvites({
    now: new Date('2026-08-12T00:00:00Z'),
  });
  assert.deepEqual(result, [{
    id: 7,
    status: 'expired',
    expiryAction: 'release',
    holdReleased: true,
    bookingId: 37,
    pendingReview: true,
    notificationQueued: false,
  }]);
  assert.equal(observed.some((sql) => sql.includes('INSERT INTO course_usage_events')), false);
  assert.equal(observed.some((sql) => sql.includes("SET status = 'expired'")), true);
});

test('V2 management mutations preserve normalized route contracts', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/course-v2.js'), 'utf8');
  const courses = fs.readFileSync(path.join(__dirname, '../src/routes/courses.js'), 'utf8');
  const context = fs.readFileSync(path.join(__dirname, '../src/context.js'), 'utf8');
  const v1 = fs.readFileSync(path.join(__dirname, '../v1/index.js'), 'utf8');
  const domain = fs.readFileSync(path.join(__dirname, '../src/services/course-v2-domain.js'), 'utf8');

  assert.match(routes, /INSERT INTO course_coach_profiles\s*\(owner_user_id, code, user_id/);
  assert.match(routes, /router\.patch\('\/admin\/courses\/coach-profiles\/:id'/);
  assert.match(routes, /router\.patch\('\/admin\/courses\/staff-memberships\/:id'/);
  assert.doesNotMatch(routes, /ON DUPLICATE KEY UPDATE role = VALUES\(role\)/);
  assert.match(routes, /router\.post\('\/admin\/courses\/tickets\/:id\/refunds'/);
  assert.match(domain, /eventType:\s*'REFUND'/);
  assert.match(courses, /appendManagerOwnerScope\(req, 'p', where, params\)/);
  assert.match(courses, /action:\s*'customer-update'/);
  assert.match(courses, /DELETE FROM course_order_items WHERE order_id = \?/);
  assert.match(courses, /quantity = \?, unit_price = \?, total_amount = \?/);
  assert.match(courses, /operation:\s*'order\.cancel'/);
  assert.match(
    courses,
    /courseV2\.enabled \? "'SERVICE_PROVIDER'" : "'SERVICE_PROVIDER', 'STORE'"/
  );
  for (const source of [context, v1]) {
    assert.match(
      source,
      /process\.env\.COURSE_V2_ENABLED[\s\S]{0,250}return;[\s\S]{0,250}Legacy course tables/
    );
  }
});

test('legacy staff access keeps course creation available to admins and providers', async () => {
  const registered = new Map();
  const router = {};
  for (const method of ['get', 'post', 'patch', 'delete']) {
    router[method] = (path, ...handlers) => {
      registered.set(`${method.toUpperCase()} ${path}`, handlers);
    };
  }
  registerCourseV2Routes({
    router,
    ctx: {
      pool: {
        async query(sql, params = []) {
          const normalized = String(sql).replace(/\s+/g, ' ').trim();
          if (normalized === 'SELECT id, role FROM users WHERE id = ? LIMIT 1') {
            return [[{
              id: params[0],
              role: String(params[0]).replace(/-1$/, ''),
            }]];
          }
          throw new Error(`legacy staff access must not query V2 tables: ${normalized}`);
        },
      },
      ok(_res, data) {
        return { ok: true, data };
      },
      fail(_res, code, message, status) {
        return { ok: false, code, message, status };
      },
      authRequired(_req, _res, next) {
        return next();
      },
    },
    domain: { enabled: false },
  });

  const handler = registered.get('GET /courses/staff/me').at(-1);
  for (const role of ['ADMIN', 'SERVICE_PROVIDER', 'STORE']) {
    const result = await handler({ user: { id: `${role}-1`, role } }, {});
    assert.equal(result.ok, true);
    assert.equal(result.data.enabled, false);
    assert.equal(result.data.capabilities.manageCatalog, true, `${role} can create courses`);
    assert.equal(result.data.capabilities.manageAttendance, true);
    assert.equal(result.data.capabilities.manageSettings, true);
    assert.equal(result.data.capabilities.manageStaff, false);
    assert.equal(result.data.capabilities.viewReports, false);
  }

  for (const role of ['USER', 'EDITOR', 'COACH']) {
    const result = await handler({ user: { id: `${role}-1`, role } }, {});
    assert.equal(result.data.capabilities.manageCatalog, false, `${role} cannot create courses`);
    assert.equal(result.data.capabilities.manageAttendance, false);
    assert.equal(result.data.capabilities.manageSettings, false);
  }

  const promotedAdmin = await handler({ user: { id: 'ADMIN-1', role: 'USER' } }, {});
  assert.equal(promotedAdmin.data.capabilities.manageCatalog, true);
  const demotedCoach = await handler({ user: { id: 'COACH-1', role: 'ADMIN' } }, {});
  assert.equal(demotedCoach.data.capabilities.manageCatalog, false);
});

test('V2 staff access refreshes DB roles and treats STORE as SERVICE_PROVIDER without promoting COACH', async () => {
  const registered = new Map();
  const router = {};
  for (const method of ['get', 'post', 'patch', 'delete']) {
    router[method] = (path, ...handlers) => {
      registered.set(`${method.toUpperCase()} ${path}`, handlers);
    };
  }
  const roles = new Map([
    ['admin-1', 'ADMIN'],
    ['provider-1', 'SERVICE_PROVIDER'],
    ['store-1', 'STORE'],
    ['coach-1', 'COACH'],
  ]);
  const ownerQueries = [];
  const pool = {
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (normalized === 'SELECT id, role FROM users WHERE id = ? LIMIT 1') {
        const role = roles.get(params[0]);
        return [role ? [{ id: params[0], role }] : []];
      }
      if (normalized.includes('FROM course_staff_memberships')) return [[]];
      if (normalized.includes('FROM course_sessions s') && normalized.includes('LEFT JOIN course_coach_profiles')) {
        return [[]];
      }
      if (normalized.startsWith('SELECT * FROM course_ticket_products')) {
        ownerQueries.push(params);
        return [[]];
      }
      throw new Error(`unexpected query: ${normalized}`);
    },
  };
  registerCourseV2Routes({
    router,
    ctx: {
      pool,
      ok(_res, data) {
        return { ok: true, data };
      },
      fail(_res, code, message, status) {
        return { ok: false, code, message, status };
      },
      authRequired(_req, _res, next) {
        return next();
      },
    },
    domain: {
      enabled: true,
      async assertSchema() {
        return { active: true };
      },
      async assertCountCardParity() {
        return { ready: true };
      },
      async assertProviderCountCardParity() {
        return { ready: true };
      },
    },
  });

  const staffHandler = registered.get('GET /courses/staff/me').at(-1);
  for (const [id, tokenRole] of [
    ['admin-1', 'USER'],
    ['provider-1', 'USER'],
    ['store-1', 'USER'],
  ]) {
    const result = await staffHandler({ user: { id, role: tokenRole }, body: {}, query: {} }, {});
    assert.equal(result.ok, true);
    assert.equal(result.data.capabilities.manageCatalog, true, `${id} can manage catalog`);
    assert.equal(result.data.capabilities.manageAttendance, true);
  }
  const coach = await staffHandler({
    user: { id: 'coach-1', role: 'ADMIN' },
    body: {},
    query: {},
  }, {});
  assert.equal(coach.data.capabilities.manageCatalog, false);
  assert.equal(coach.data.capabilities.manageAttendance, false);

  const ticketProductsHandler = registered.get('GET /admin/courses/ticket-products').at(-1);
  const storeList = await ticketProductsHandler({
    user: { id: 'store-1', role: 'USER' },
    body: {},
    query: {},
  }, {});
  assert.equal(storeList.ok, true);
  assert.deepEqual(ownerQueries, [['store-1']]);

  const deniedCoach = await ticketProductsHandler({
    user: { id: 'coach-1', role: 'ADMIN' },
    body: {},
    query: {},
  }, {});
  assert.equal(deniedCoach.code, 'COURSE_TENANT_REQUIRED');
  assert.equal(deniedCoach.status, 403);
});

test('student report scopes event insights by every report filter without changing ticket balances', async () => {
  const registered = new Map();
  const router = {};
  for (const method of ['get', 'post', 'patch']) {
    router[method] = (path, ...handlers) => {
      registered.set(`${method.toUpperCase()} ${path}`, handlers);
    };
  }

  let observedSql = '';
  let observedParams = [];
  const pool = {
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (normalized === 'SELECT id, role FROM users WHERE id = ? LIMIT 1') {
        return [[{ id: params[0], role: 'ADMIN' }]];
      }
      if (normalized.startsWith('SELECT * FROM course_settings')) {
        return [[{
          scope: 'provider',
          push_plan_max_available_uses: 3,
          expiring_ticket_days: 30,
          dormant_student_days: 90,
        }]];
      }
      if (normalized === 'SELECT * FROM course_settings WHERE scope_key IN (\'platform\', ?) ORDER BY CASE WHEN scope_key = ? THEN 0 ELSE 1 END') {
        return [[{
          scope: 'provider',
          push_plan_max_available_uses: 3,
          expiring_ticket_days: 30,
          dormant_student_days: 90,
        }]];
      }
      observedSql = String(sql);
      observedParams = params;
      return [[{
        id: 41,
        display_name: '測試學員',
        email: 'student@example.com',
        status: 'active',
        source_system: 'gas',
        source_id: 'GAS-STUDENT-41',
        ticket_count: 4,
        remaining_uses: 10,
        available_remaining_uses: 8,
        paused_remaining_uses: 1,
        expired_remaining_uses: 2,
        activation_expired_remaining_uses: 0,
        frozen_remaining_uses: 0,
        purchased_ticket_count: 2,
        transferred_ticket_count: 1,
        manual_ticket_count: 1,
        held_uses: 2,
        success_count: 3,
        no_show_count: 1,
        recent_success_count: 2,
        last_success_at: '2026-07-20 09:00:00',
        expiring_30_count: 1,
      }]];
    },
  };
  registerCourseV2Routes({
    router,
    ctx: {
      pool,
      ok(res, data) {
        return res.status(200).json({ ok: true, data });
      },
      fail(res, code, message, status) {
        return res.status(status).json({ ok: false, code, message });
      },
      authRequired(_req, _res, next) {
        return next();
      },
    },
    domain: {
      async assertSchema() {
        return true;
      },
      async assertCountCardParity() {
        return true;
      },
      async assertProviderCountCardParity() {
        return true;
      },
      async loadSettings() {
        return {
          provider: {
            push_plan_max_available_uses: 3,
            expiring_ticket_days: 30,
            dormant_student_days: 90,
          },
          platform: {},
        };
      },
    },
  });

  const handlers = registered.get('GET /admin/courses/reports/students');
  assert.ok(handlers);
  let responseBody = null;
  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return body;
    },
  };
  await handlers.at(-1)({
    user: { id: 'admin-1', role: 'ADMIN' },
    body: {},
    query: {
      ownerUserId: 'owner-1',
      from: '2026-07-01',
      to: '2026-07-31',
      scenarioId: '12',
      coachProfileId: '34',
      location: '台北',
      itemType: 'class',
      venueName: '大安泳池',
      city: '台北市',
      inactiveDays: '60',
      limit: '50',
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(responseBody?.ok, true, JSON.stringify(responseBody));
  assert.match(observedSql, /e\.occurred_at >= \?/);
  assert.match(observedSql, /e\.occurred_at < DATE_ADD\(\?, INTERVAL 1 DAY\)/);
  assert.match(observedSql, /JSON_EXTRACT\(e\.metadata_json, '\$\.scenarioId'\)/);
  assert.match(observedSql, /JSON_EXTRACT\(e\.metadata_json, '\$\.coachProfileId'\)/);
  assert.match(observedSql, /JSON_EXTRACT\(e\.metadata_json, '\$\.location'\)/);
  assert.match(observedSql, /JSON_EXTRACT\(e\.metadata_json, '\$\.scenarioItemType'\)/);
  assert.match(observedSql, /JSON_EXTRACT\(e\.metadata_json, '\$\.venueName'\)/);
  assert.match(observedSql, /JSON_EXTRACT\(e\.metadata_json, '\$\.city'\)/);
  assert.match(observedSql, /count_card_provider\.count_card_parity_enabled = 1/);
  assert.match(observedSql, /AND event\.student_id IS NOT NULL/);
  assert.deepEqual(observedParams, [
    30,
    60,
    '2026-07-01 00:00:00',
    '2026-07-31',
    12,
    34,
    '%台北%',
    'class',
    '%大安泳池%',
    '%台北市%',
    'owner-1',
    50,
  ]);

  const student = responseBody.data[0];
  assert.equal(student.successCount, 3);
  assert.equal(student.noShowCount, 1);
  assert.equal(student.lastSuccessAt, '2026-07-20 09:00:00');
  assert.equal(student.remainingUses, 10);
  assert.equal(student.availableUses, 6);
  assert.deepEqual(student.source, ['自購', '下單購買', '轉贈']);
  assert.deepEqual(student.ticketSources, [
    { code: 'self_purchase', label: '自購', ticketCount: 1 },
    { code: 'order_purchase', label: '下單購買', ticketCount: 2 },
    { code: 'transfer', label: '轉贈', ticketCount: 1 },
  ]);
  assert.deepEqual(student.ticketSourceBreakdown, {
    purchased: 2,
    transferredIn: 1,
    manualOrImported: 1,
  });
  assert.deepEqual(student.migrationSource, {
    system: 'gas',
    id: 'GAS-STUDENT-41',
  });
});
