const test = require('node:test');
const assert = require('node:assert/strict');

const {
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

test('a no-ticket NO_SHOW is retained as a zero-use anomaly', () => {
  assert.deepEqual(resolveAttendanceUsage('NO_SHOW'), {
    hasTicket: false,
    deltaUses: 0,
    anomaly: true,
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
      remainingUses: 3,
      heldUses: 1,
      availableUses: 2,
      rowVersion: 2,
    }
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

test('shared attend route delegates to the legacy handler when V2 is disabled', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/course-v2.js'), 'utf8');
  assert.match(source, /action === 'attend' && !courseV2\.enabled\) return next\(\)/);
});

test('freeze and unfreeze are explicit tenant-scoped V2 mutations', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/course-v2.js'), 'utf8');
  const domainSource = fs.readFileSync(path.join(__dirname, '../src/services/course-v2-domain.js'), 'utf8');
  assert.match(routeSource, /for \(const action of \['freeze', 'unfreeze'\]\)/);
  assert.match(domainSource, /COURSE_TICKET_ACTIVE_HOLD/);
  assert.match(domainSource, /state, started_at, reason, actor_user_id, metadata_json/);
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

test('attendance reversal vocabulary and invite booking linkage match the normalized contract', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../src/services/course-v2-domain.js'), 'utf8');
  assert.match(source, /eventType:\s*`\$\{original\.event_type\}_REVERSAL`/);
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
      if (normalized.startsWith('SELECT id, user_id, student_id')) {
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

  const releaseConn = {
    async query(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT * FROM course_ticket_holds')) {
        return [[{ id: 77, ticket_id: 9, status: 'active' }]];
      }
      if (normalized.startsWith('UPDATE course_ticket_holds')) return [{ affectedRows: 1 }];
      if (normalized.startsWith('SELECT id, user_id, student_id')) {
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

test('hold creation rejects paused, frozen, expired, and activation-expired tickets', async () => {
  const domain = createCourseV2Domain({ pool: runtimePool(), enabled: true });
  async function rejectsTicket(ticket, expectedCode) {
    const conn = {
      async query(sql) {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        if (normalized.startsWith('SELECT id, user_id, student_id')) return [[ticket]];
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
  assert.match(courses, /COURSE_ORDER_QUANTITY_IMMUTABLE/);
  assert.match(courses, /operation:\s*'order\.cancel'/);
  assert.match(
    courses,
    /courseV2\.enabled \? "'SERVICE_PROVIDER'" : "'SERVICE_PROVIDER', 'STORE', 'COACH'"/
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
        async query() {
          throw new Error('legacy staff access must not query V2 tables');
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
    assert.equal(result.data.capabilities.manageSettings, false);
    assert.equal(result.data.capabilities.manageStaff, false);
    assert.equal(result.data.capabilities.viewReports, false);
  }

  for (const role of ['USER', 'EDITOR', 'COACH']) {
    const result = await handler({ user: { id: `${role}-1`, role } }, {});
    assert.equal(result.data.capabilities.manageCatalog, false, `${role} cannot create courses`);
    assert.equal(result.data.capabilities.manageAttendance, false);
  }
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
      inactiveDays: '60',
      limit: '50',
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.match(observedSql, /e\.occurred_at >= \?/);
  assert.match(observedSql, /e\.occurred_at < DATE_ADD\(\?, INTERVAL 1 DAY\)/);
  assert.match(observedSql, /JSON_EXTRACT\(e\.metadata_json, '\$\.scenarioId'\)/);
  assert.match(observedSql, /JSON_EXTRACT\(e\.metadata_json, '\$\.coachProfileId'\)/);
  assert.match(observedSql, /JSON_EXTRACT\(e\.metadata_json, '\$\.location'\)/);
  assert.match(observedSql, /AND event\.student_id IS NOT NULL/);
  assert.deepEqual(observedParams, [
    60,
    '2026-07-01 00:00:00',
    '2026-07-31',
    12,
    34,
    '%台北%',
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
