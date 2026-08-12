'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createCourseTermDomain } = require('../src/services/course-term-domain');

const TERM_VERSION = '052_course_fixed_term_productization';
const PAYMENT_VERSION = '053_course_term_payments_notifications';

function mockPool({ versions = [TERM_VERSION], query }) {
  const transaction = { committed: false, rolledBack: false, released: false };
  const conn = {
    async beginTransaction() {},
    async commit() { transaction.committed = true; },
    async rollback() { transaction.rolledBack = true; },
    release() { transaction.released = true; },
    query,
  };
  return {
    transaction,
    pool: {
      async query(sql, params) {
        if (sql.includes('course_schema_versions')) {
          return [versions.map((version) => ({ version }))];
        }
        return query(sql, params);
      },
      async getConnection() { return conn; },
    },
  };
}

function providerSettings(sql, params) {
  if (!sql.includes('FROM course_settings')) return null;
  return [[{
    scope_key: params[0],
    fixed_term_enabled: 1,
    advanced_payments_enabled: 1,
  }]];
}

test('makeup route creation is idempotent and validates both resources in the provider scope', async () => {
  const writes = [];
  const { pool, transaction } = mockPool({
    async query(sql, params = []) {
      const settings = providerSettings(sql, params);
      if (settings) return settings;
      if (sql.includes('FROM course_terms source') && sql.includes('JOIN course_sessions target')) {
        return [[{
          source_term_id: 12,
          source_owner_user_id: 'provider-1',
          target_session_id: 91,
          target_owner_user_id: 'provider-1',
          target_term_id: 13,
        }]];
      }
      if (sql.includes('INSERT IGNORE INTO course_mutation_commands')) {
        assert.equal(params[0], 'operator-1');
        assert.equal(params[1], 'term.makeup-route.create');
        return [{ affectedRows: 1, insertId: 501 }];
      }
      if (sql.includes('SELECT id FROM course_makeup_routes')) return [[]];
      if (sql.includes('INSERT INTO course_makeup_routes')) {
        writes.push({ sql, params });
        return [{ affectedRows: 1, insertId: 77 }];
      }
      if (sql.includes('UPDATE course_mutation_commands')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  });
  const domain = createCourseTermDomain({ pool, enabled: true });
  const result = await domain.createMakeupRoute({
    ownerUserId: 'provider-1',
    actorUserId: 'operator-1',
    idempotencyKey: 'makeup-route-create-1',
    body: {
      sourceTermId: 12,
      targetSessionId: 91,
      capacityOverride: 4,
      bookingOpenAt: '2026-09-01 09:00:00',
      bookingCloseAt: '2026-09-10 09:00:00',
      status: 'active',
    },
  });
  assert.equal(result.id, 77);
  assert.equal(result.rowVersion, 1);
  assert.deepEqual(writes[0].params.slice(0, 4), ['provider-1', 12, 91, 'active']);
  assert.equal(transaction.committed, true);
  assert.equal(transaction.rolledBack, false);
  assert.equal(transaction.released, true);
});

test('makeup route creation rejects a cross-tenant target before writing', async () => {
  let mutations = 0;
  const { pool, transaction } = mockPool({
    async query(sql, params = []) {
      const settings = providerSettings(sql, params);
      if (settings) return settings;
      if (sql.includes('FROM course_terms source') && sql.includes('JOIN course_sessions target')) {
        return [[{
          source_term_id: 12,
          source_owner_user_id: 'provider-1',
          target_session_id: 91,
          target_owner_user_id: 'provider-2',
        }]];
      }
      if (sql.includes('course_mutation_commands') || sql.includes('INSERT INTO course_makeup_routes')) mutations += 1;
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  });
  const domain = createCourseTermDomain({ pool, enabled: true });
  await assert.rejects(
    domain.createMakeupRoute({
      ownerUserId: 'provider-1',
      actorUserId: 'operator-1',
      idempotencyKey: 'makeup-route-create-2',
      body: { sourceTermId: 12, targetSessionId: 91 },
    }),
    (error) => error.code === 'COURSE_MAKEUP_ROUTE_TENANT_CONFLICT' && error.statusCode === 409
  );
  assert.equal(mutations, 0);
  assert.equal(transaction.rolledBack, true);
});

test('makeup route update honors If-Match and can clear optional overrides', async () => {
  let updateParams = null;
  const { pool, transaction } = mockPool({
    async query(sql, params = []) {
      const settings = providerSettings(sql, params);
      if (settings) return settings;
      if (sql.includes('SELECT * FROM course_makeup_routes')) {
        return [[{
          id: 77,
          owner_user_id: 'provider-1',
          source_term_id: 12,
          target_session_id: 91,
          status: 'active',
          capacity_override: 4,
          booking_open_at: '2026-09-01 09:00:00',
          booking_close_at: '2026-09-10 09:00:00',
          row_version: 3,
        }]];
      }
      if (sql.includes('INSERT IGNORE INTO course_mutation_commands')) return [{ affectedRows: 1, insertId: 502 }];
      if (sql.includes('FROM course_terms source') && sql.includes('JOIN course_sessions target')) {
        return [[{
          source_owner_user_id: 'provider-1',
          target_owner_user_id: 'provider-1',
        }]];
      }
      if (sql.includes('SELECT id FROM course_makeup_routes') && sql.includes('id <> ?')) return [[]];
      if (sql.includes('UPDATE course_makeup_routes')) {
        updateParams = params;
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('UPDATE course_mutation_commands')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  });
  const domain = createCourseTermDomain({ pool, enabled: true });
  const result = await domain.updateMakeupRoute({
    routeId: 77,
    ownerUserId: 'provider-1',
    actorUserId: 'operator-1',
    idempotencyKey: 'makeup-route-update-1',
    expectedRowVersion: 3,
    body: { capacityOverride: null, bookingOpenAt: null, bookingCloseAt: null },
  });
  assert.equal(result.rowVersion, 4);
  assert.equal(result.capacityOverride, null);
  assert.deepEqual(updateParams.slice(0, 6), [12, 91, 'active', null, null, null]);
  assert.equal(transaction.committed, true);
});

test('ordinary makeup follows the selected target policy instead of the legacy entitlement flag', async () => {
  const { pool, transaction } = mockPool({
    versions: [TERM_VERSION, PAYMENT_VERSION],
    async query(sql, params = []) {
      const settings = providerSettings(sql, params);
      if (settings) return settings;
      if (sql.includes('FROM course_makeup_entitlements m') && sql.includes('JOIN course_term_enrollments e')) {
        return [[{
          id: 8,
          owner_user_id: 'provider-1',
          enrollment_id: 5,
          source_term_id: 12,
          student_id: 3,
          user_id: 'member-1',
          status: 'PENDING_INSURANCE',
          requires_insurance: 1,
          valid_until: '2099-12-31 23:59:59',
          row_version: 1,
        }]];
      }
      if (sql.includes('FROM course_makeup_bookings') && sql.includes('idempotency_key')) return [[]];
      if (sql.includes('FROM course_makeup_routes r')) {
        assert.match(sql, /policy\.required AS target_insurance_required/);
        return [[{
          id: 21,
          owner_user_id: 'provider-1',
          student_id: 3,
          display_name: '學員',
          email: 'member@example.com',
          starts_at: '2099-11-01 09:00:00',
          session_status: 'open',
          session_capacity: null,
          capacity_override: null,
          target_insurance_required: 0,
        }]];
      }
      if (sql.includes('SELECT id FROM course_makeup_bookings') && sql.includes("status IN ('RESERVED','BOOKED')")) return [[]];
      if (sql.includes('INSERT INTO course_bookings')) return [{ affectedRows: 1, insertId: 41 }];
      if (sql.includes('INSERT INTO course_makeup_bookings')) return [{ affectedRows: 1, insertId: 42 }];
      if (sql.includes('UPDATE course_makeup_entitlements')) {
        assert.match(sql, /status IN \('AVAILABLE','PENDING_INSURANCE'\)/);
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('INSERT INTO course_notification_outbox')) return [{ affectedRows: 1, insertId: 43 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  });
  const domain = createCourseTermDomain({ pool, enabled: true, advancedPaymentsEnabled: true });
  const result = await domain.bookMakeup({
    makeupEntitlementId: 8,
    targetSessionId: 91,
    userId: 'member-1',
    idempotencyKey: 'makeup-book-policy-optional',
    expectedRowVersion: 1,
  });
  assert.equal(result.bookingId, 42);
  assert.equal(result.status, 'BOOKED');
  assert.equal(transaction.committed, true);
});

test('ordinary makeup is blocked when the selected target has a required active insurance policy', async () => {
  const { pool, transaction } = mockPool({
    versions: [TERM_VERSION, PAYMENT_VERSION],
    async query(sql) {
      if (sql.includes('FROM course_makeup_entitlements m')) {
        return [[{
          id: 8,
          owner_user_id: 'provider-1',
          enrollment_id: 5,
          source_term_id: 12,
          status: 'AVAILABLE',
          requires_insurance: 0,
          valid_until: '2099-12-31 23:59:59',
          row_version: 1,
        }]];
      }
      if (sql.includes('FROM course_makeup_bookings') && sql.includes('idempotency_key')) return [[]];
      if (sql.includes('FROM course_makeup_routes r')) {
        return [[{
          id: 21,
          owner_user_id: 'provider-1',
          target_insurance_required: 1,
        }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  });
  const domain = createCourseTermDomain({ pool, enabled: true, advancedPaymentsEnabled: true });
  await assert.rejects(
    domain.bookMakeup({
      makeupEntitlementId: 8,
      targetSessionId: 91,
      userId: 'member-1',
      idempotencyKey: 'makeup-book-policy-required',
      expectedRowVersion: 1,
    }),
    (error) => error.code === 'COURSE_MAKEUP_INSURANCE_REQUIRED' && error.statusCode === 409
  );
  assert.equal(transaction.rolledBack, true);
});

test('insurance checkout refuses a target whose active policy is optional', async () => {
  const { pool, transaction } = mockPool({
    versions: [TERM_VERSION, PAYMENT_VERSION],
    async query(sql) {
      if (sql.includes('FROM course_makeup_insurance_coverages coverage')) return [[]];
      if (sql.includes('FROM course_makeup_entitlements m')) {
        assert.match(sql, /policy\.required AS target_insurance_required/);
        return [[{
          id: 8,
          owner_user_id: 'provider-1',
          status: 'AVAILABLE',
          target_insurance_required: 0,
          valid_until: '2099-12-31 23:59:59',
          starts_at: '2099-11-01 09:00:00',
          row_version: 1,
        }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  });
  const domain = createCourseTermDomain({ pool, enabled: true, advancedPaymentsEnabled: true });
  await assert.rejects(
    domain.createMakeupInsuranceCheckout({
      makeupEntitlementId: 8,
      targetSessionId: 91,
      userId: 'member-1',
      idempotencyKey: 'makeup-insurance-optional-policy',
      expectedRowVersion: 1,
    }),
    (error) => error.code === 'COURSE_MAKEUP_INSURANCE_NOT_AVAILABLE' && error.statusCode === 409
  );
  assert.equal(transaction.rolledBack, true);
});
