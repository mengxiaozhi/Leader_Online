'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createCourseTermDomain } = require('../src/services/course-term-domain');

const TERM_VERSION = '052_course_fixed_term_productization';
const PAYMENT_VERSION = '053_course_term_payments_notifications';

function currentSession() {
  const now = Date.now();
  return {
    id: 31,
    owner_user_id: 'provider-1',
    session_kind: 'TERM',
    status: 'open',
    starts_at: new Date(now - 5 * 60 * 1000),
    ends_at: new Date(now + 55 * 60 * 1000),
    redeem_open_at: null,
    redeem_close_at: null,
  };
}

function futureSession() {
  const now = Date.now();
  return {
    id: 31,
    owner_user_id: 'provider-1',
    session_kind: 'TERM',
    status: 'open',
    starts_at: new Date(now + 24 * 60 * 60 * 1000),
    ends_at: new Date(now + 25 * 60 * 60 * 1000),
    redeem_open_at: null,
    redeem_close_at: null,
  };
}

function attendanceHarness({
  entitlementStatus = 'SCHEDULED',
  session = currentSession(),
  makeup = null,
  makeupBookings = [],
  coverages = [],
  revokeAffectedRows = 1,
  paymentSchemaReady = true,
} = {}) {
  const writes = [];
  const locks = { makeup: 0, bookings: 0, coverages: 0, session: 0 };
  const transaction = { committed: false, rolledBack: false, released: false };
  const entitlement = {
    id: 11,
    owner_user_id: 'provider-1',
    enrollment_id: 21,
    session_id: 31,
    student_id: 41,
    user_id: 'member-1',
    booking_id: 51,
    status: entitlementStatus,
    row_version: 3,
  };
  const conn = {
    async beginTransaction() {},
    async commit() { transaction.committed = true; },
    async rollback() { transaction.rolledBack = true; },
    release() { transaction.released = true; },
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.includes('SELECT se.* FROM course_term_session_entitlements se')) {
        return [[{ ...entitlement }]];
      }
      if (normalized.startsWith('INSERT IGNORE INTO course_mutation_commands')) {
        return [{ affectedRows: 1, insertId: 701 }];
      }
      if (normalized.startsWith('SELECT * FROM course_makeup_entitlements')) {
        locks.makeup += 1;
        return [makeup ? [{ ...makeup }] : []];
      }
      if (normalized.startsWith('SELECT id, status FROM course_makeup_bookings')) {
        locks.bookings += 1;
        return [makeupBookings.map((row) => ({ ...row }))];
      }
      if (normalized.startsWith('SELECT id, status FROM course_makeup_insurance_coverages')) {
        locks.coverages += 1;
        return [coverages.map((row) => ({ ...row }))];
      }
      if (normalized.startsWith('SELECT * FROM course_sessions')) {
        locks.session += 1;
        return [[{ ...session }]];
      }
      if (normalized.includes('FROM course_settings')) {
        return [[{
          scope_key: params[0],
          fixed_term_enabled: 1,
          advanced_payments_enabled: 1,
          timezone: 'Asia/Taipei',
          redeem_open_minutes_before: 120,
          redeem_close_minutes_after: 1440,
        }]];
      }
      if (normalized.startsWith('UPDATE course_makeup_entitlements')) {
        writes.push('makeup-revoke');
        return [{ affectedRows: revokeAffectedRows }];
      }
      if (normalized.startsWith('UPDATE course_term_session_entitlements')) {
        writes.push('entitlement-update');
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith('UPDATE course_bookings')) {
        writes.push('booking-update');
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith('UPDATE course_mutation_commands')) {
        writes.push('mutation-complete');
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
  };
  const versions = [TERM_VERSION, ...(paymentSchemaReady ? [PAYMENT_VERSION] : [])];
  const pool = {
    async query(sql) {
      assert.match(sql, /course_schema_versions/);
      return [versions.map((version) => ({ version }))];
    },
    async getConnection() { return conn; },
  };
  return {
    domain: createCourseTermDomain({
      pool,
      enabled: true,
      advancedPaymentsEnabled: paymentSchemaReady,
    }),
    locks,
    transaction,
    writes,
  };
}

function attendanceInput(overrides = {}) {
  return {
    entitlementId: 11,
    action: 'attend',
    actorUserId: 'operator-1',
    ownerUserId: 'provider-1',
    reason: '',
    idempotencyKey: 'term-attendance-guard-1',
    expectedRowVersion: 3,
    allowOutsideWindow: true,
    ...overrides,
  };
}

for (const [makeupStatus, bookingStatus] of [
  ['RESERVED', 'RESERVED'],
  ['BOOKED', 'BOOKED'],
  ['USED', 'ATTENDED'],
]) {
  test(`LEAVE to ATTENDED rejects ${makeupStatus} makeup before changing the original entitlement`, async () => {
    const harness = attendanceHarness({
      entitlementStatus: 'LEAVE',
      makeup: { id: 61, owner_user_id: 'provider-1', status: makeupStatus, row_version: 2 },
      makeupBookings: [{ id: 71, status: bookingStatus }],
    });
    await assert.rejects(
      harness.domain.markTermAttendance(attendanceInput()),
      (error) => error.code === 'COURSE_TERM_COMPENSATION_REQUIRED' && error.statusCode === 409
    );
    assert.deepEqual(harness.locks, { makeup: 1, bookings: 1, coverages: 1, session: 0 });
    assert.deepEqual(harness.writes, []);
    assert.equal(harness.transaction.rolledBack, true);
  });
}

test('LEAVE to ATTENDED rejects an active insurance coverage even if makeup status looks revocable', async () => {
  const harness = attendanceHarness({
    entitlementStatus: 'LEAVE',
    makeup: { id: 61, owner_user_id: 'provider-1', status: 'AVAILABLE', row_version: 2 },
    coverages: [{ id: 81, status: 'active' }],
  });
  await assert.rejects(
    harness.domain.markTermAttendance(attendanceInput()),
    (error) => (
      error.code === 'COURSE_TERM_COMPENSATION_REQUIRED'
      && error.details?.insuranceCoverageId === 81
    )
  );
  assert.deepEqual(harness.writes, []);
  assert.equal(harness.transaction.rolledBack, true);
});

test('LEAVE to ATTENDED rejects a linked booked makeup seat even if makeup status looks revocable', async () => {
  const harness = attendanceHarness({
    entitlementStatus: 'LEAVE',
    makeup: { id: 61, owner_user_id: 'provider-1', status: 'AVAILABLE', row_version: 2 },
    makeupBookings: [{ id: 71, status: 'BOOKED' }],
  });
  await assert.rejects(
    harness.domain.markTermAttendance(attendanceInput()),
    (error) => (
      error.code === 'COURSE_TERM_COMPENSATION_REQUIRED'
      && error.details?.makeupBookingId === 71
    )
  );
  assert.deepEqual(harness.writes, []);
  assert.equal(harness.transaction.rolledBack, true);
});

test('LEAVE to ATTENDED revokes an unused makeup right before changing the original entitlement', async () => {
  const harness = attendanceHarness({
    entitlementStatus: 'LEAVE',
    makeup: { id: 61, owner_user_id: 'provider-1', status: 'AVAILABLE', row_version: 2 },
  });
  const result = await harness.domain.markTermAttendance(attendanceInput());
  assert.equal(result.status, 'ATTENDED');
  assert.ok(harness.writes.indexOf('makeup-revoke') < harness.writes.indexOf('entitlement-update'));
  assert.equal(harness.transaction.committed, true);
  assert.equal(harness.transaction.rolledBack, false);
});

test('052-only LEAVE to ATTENDED safely revokes unused makeup without touching 053 coverage', async () => {
  const harness = attendanceHarness({
    entitlementStatus: 'LEAVE',
    makeup: { id: 61, owner_user_id: 'provider-1', status: 'AVAILABLE', row_version: 2 },
    paymentSchemaReady: false,
  });
  const result = await harness.domain.markTermAttendance(attendanceInput());
  assert.equal(result.status, 'ATTENDED');
  assert.equal(harness.locks.coverages, 0);
  assert.ok(harness.writes.indexOf('makeup-revoke') < harness.writes.indexOf('entitlement-update'));
  assert.equal(harness.transaction.committed, true);
});

test('LEAVE to ATTENDED rolls back when the guarded makeup revocation loses its race', async () => {
  const harness = attendanceHarness({
    entitlementStatus: 'LEAVE',
    makeup: { id: 61, owner_user_id: 'provider-1', status: 'AVAILABLE', row_version: 2 },
    revokeAffectedRows: 0,
  });
  await assert.rejects(
    harness.domain.markTermAttendance(attendanceInput()),
    (error) => error.code === 'COURSE_TERM_COMPENSATION_REQUIRED'
  );
  assert.deepEqual(harness.writes, ['makeup-revoke']);
  assert.equal(harness.transaction.rolledBack, true);
});

test('assigned coach cannot mark a future fixed-term session', async () => {
  const harness = attendanceHarness({ session: futureSession() });
  await assert.rejects(
    harness.domain.markTermAttendance(attendanceInput({
      action: 'absent',
      actorUserId: 'coach-1',
      allowOutsideWindow: false,
    })),
    (error) => error.code === 'COURSE_TERM_ATTENDANCE_TOO_EARLY' && error.statusCode === 409
  );
  assert.deepEqual(harness.writes, []);
  assert.equal(harness.transaction.rolledBack, true);
});

test('assigned coach can still mark attendance after the fixed-term session starts', async () => {
  const harness = attendanceHarness();
  const result = await harness.domain.markTermAttendance(attendanceInput({
    actorUserId: 'coach-1',
    allowOutsideWindow: false,
  }));
  assert.equal(result.status, 'ATTENDED');
  assert.deepEqual(harness.writes, [
    'entitlement-update',
    'booking-update',
    'mutation-complete',
  ]);
  assert.equal(harness.transaction.committed, true);
  assert.equal(harness.transaction.rolledBack, false);
});

test('ops or admin must supply a reason for an out-of-window attendance override', async () => {
  const harness = attendanceHarness({ session: futureSession() });
  await assert.rejects(
    harness.domain.markTermAttendance(attendanceInput({ allowOutsideWindow: true })),
    (error) => (
      error.code === 'COURSE_TERM_ATTENDANCE_OVERRIDE_REASON_REQUIRED'
      && error.statusCode === 400
    )
  );
  assert.deepEqual(harness.writes, []);
  assert.equal(harness.transaction.rolledBack, true);
});

test('ops or admin can make an auditable out-of-window attendance override', async () => {
  const harness = attendanceHarness({ session: futureSession() });
  const result = await harness.domain.markTermAttendance(attendanceInput({
    action: 'absent',
    reason: '課務確認需提前結案',
    allowOutsideWindow: true,
  }));
  assert.equal(result.status, 'ABSENT');
  assert.ok(harness.writes.includes('entitlement-update'));
  assert.equal(harness.transaction.committed, true);
});

test('attendance routes grant out-of-window override only to the managed operations route', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/routes/course-terms.js'),
    'utf8'
  );
  const adminStart = source.indexOf("router.post(`/admin/courses/term-entitlements/:id/${action}`");
  const coachStart = source.indexOf("router.post(`/courses/coach/term-entitlements/:id/${action}`");
  const coachEnd = source.indexOf("router.get('/courses/coach/sessions/:sessionId'", coachStart);
  assert.ok(adminStart >= 0 && coachStart > adminStart && coachEnd > coachStart);
  assert.match(source.slice(adminStart, coachStart), /allowOutsideWindow: true/);
  assert.match(source.slice(coachStart, coachEnd), /allowOutsideWindow: false/);
});
