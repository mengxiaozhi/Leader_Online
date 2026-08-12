'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('bank submission idempotency replays before stale version and expired deadline checks', async () => {
  const { createCourseTermDomain } = require('../src/services/course-term-domain');
  const { requestHash } = require('../src/services/course-term-policy');
  const calls = [];
  const order = {
    id: 88,
    user_id: 'member-1',
    owner_user_id: 'provider-1',
    order_purpose: 'TERM_ENROLLMENT',
    payment_method: 'BANK_TRANSFER',
    payment_status: 'reviewing',
    pay_by_at: '2020-01-01 00:00:00',
    row_version: 9,
  };
  const conn = {
    async beginTransaction() { calls.push('begin'); },
    async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); },
    release() { calls.push('release'); },
    async query(sql) {
      calls.push(sql);
      if (sql.includes('FROM course_orders')) return [[order]];
      if (sql.includes('FROM course_payment_submissions')) {
        return [[{
          id: 19,
          request_hash: requestHash({ orderId: 88, last5: '12345' }),
          status: 'REVIEWING',
        }]];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const domain = createCourseTermDomain({
    enabled: true,
    advancedPaymentsEnabled: true,
    pool: {
      async query(sql) {
        assert.match(sql, /course_schema_versions/);
        return [[
          { version: '052_course_fixed_term_productization' },
          { version: '053_course_term_payments_notifications' },
        ]];
      },
      async getConnection() { return conn; },
    },
  });

  const replay = await domain.submitBankTransfer({
    orderId: 88,
    userId: 'member-1',
    last5: '12345',
    idempotencyKey: 'bank-submit-replay-88',
    expectedOrderRowVersion: 1,
  });
  assert.deepEqual(replay, {
    orderId: 88,
    submissionId: 19,
    paymentStatus: 'reviewing',
    rowVersion: 9,
    replay: true,
  });
  assert.deepEqual(calls.filter((call) => typeof call === 'string' && call.startsWith('UPDATE')), []);
  assert.ok(calls.includes('commit'));
  assert.ok(!calls.includes('rollback'));
});

test('fixed-term routes are registered once through the shared course router', () => {
  const courses = read('src/routes/courses.js');
  const routes = read('src/routes/course-terms.js');
  const main = read('index.js');
  const v1 = read('v1/index.js');
  assert.match(courses, /registerCourseTermRoutes\(\{ router, ctx, domain: courseTerms \}\)/);
  assert.match(routes, /\/courses\/terms\/:id\/quote/);
  assert.match(routes, /\/courses\/terms\/:id\/eligibility/);
  assert.match(routes, /\/courses\/terms\/checkout/);
  assert.match(routes, /\/courses\/orders\/:id\/payment-submissions/);
  assert.match(routes, /\/courses\/term-entitlements\/:id\/leave/);
  assert.match(routes, /\/courses\/makeup\/:id\/book/);
  assert.match(routes, /\/courses\/makeup-bookings\/:id\/cancel/);
  assert.match(routes, /\/admin\/courses\/makeup-bookings'/);
  assert.match(routes, /mb\.owner_user_id = \?/);
  assert.match(routes, /schema\.paymentSchemaReady[\s\S]*course_makeup_insurance_coverages/);
  assert.match(routes, /\/admin\/courses\/makeup-bookings\/:id\/\$\{action\}/);
  assert.match(routes, /\/courses\/me\/notifications/);
  assert.match(routes, /\/courses\/terms\/:id\/payment-options/);
  assert.match(routes, /\/courses\/makeup\/:id\/insurance-checkout/);
  assert.match(routes, /\/admin\/courses\/makeup-insurance-policies/);
  assert.match(routes, /\/admin\/courses\/makeup-routes'/);
  assert.match(routes, /\/admin\/courses\/makeup-routes\/:id/);
  assert.match(main, /startCourseProductizationWorker/);
  assert.match(v1, /startCourseProductizationWorker/);
});

test('term attendance is isolated from count-card SUCCESS and NO_SHOW ledger', () => {
  const domain = read('src/services/course-term-domain.js');
  const attendanceStart = domain.indexOf('async function markTermAttendance');
  const attendanceEnd = domain.indexOf('async function expireDueHolds', attendanceStart);
  const attendance = domain.slice(attendanceStart, attendanceEnd);
  assert.match(attendance, /course_term_session_entitlements/);
  assert.doesNotMatch(attendance, /course_usage_events/);
  assert.doesNotMatch(attendance, /SUCCESS|NO_SHOW/);
});

test('checkout derives seats from allocations and fulfillment creates entitlements atomically', () => {
  const domain = read('src/services/course-term-domain.js');
  assert.match(domain, /countTermAllocations\(conn, quote\.term_id, \{ forUpdate: true \}\)/);
  assert.match(domain, /INSERT INTO course_seat_allocations/);
  assert.match(domain, /INSERT INTO course_term_session_entitlements/);
  assert.match(domain, /INSERT INTO course_bookings[\s\S]*'TERM_ROSTER'/);
  assert.match(domain, /SET booking_id = \?/);
  assert.match(domain, /enqueueCourseNotificationOutbox/);
  assert.match(domain, /payment_deadline_expired/);
});

test('fixed-term leave and makeup use snapshotted term rules and roster projections', () => {
  const domain = read('src/services/course-term-domain.js');
  assert.match(domain, /leaveQuota: Number\(resolved\.term\.leave_quota\)/);
  assert.match(domain, /leaveCutoffMinutes: Number\(resolved\.term\.leave_cutoff_minutes\)/);
  assert.match(domain, /makeupValidDays: Number\(resolved\.term\.makeup_valid_days\)/);
  assert.match(domain, /COURSE_TERM_LEAVE_QUOTA_EXCEEDED/);
  assert.doesNotMatch(domain, /makeupValidDays, 180/);
  assert.match(domain, /INSERT INTO course_bookings[\s\S]*'MAKEUP'/);
  assert.match(domain, /async function transitionMakeupBooking/);
  assert.match(domain, /course_makeup_entitlements SET status = 'USED'/);
});

test('member schedule and makeup DTOs match the productized member controls', async () => {
  const source = read('src/services/course-term-domain.js');
  assert.match(source, /insurance_order\.row_version AS insurance_order_row_version/);
  assert.match(source, /rowVersion: Number\(row\.insurance_order_row_version \|\| 1\)/);
  const { createCourseTermDomain } = require('../src/services/course-term-domain');
  const termMarker = [{ version: '052_course_fixed_term_productization' }];
  const scheduleDomain = createCourseTermDomain({
    enabled: true,
    advancedPaymentsEnabled: false,
    pool: {
      async query(sql) {
        if (sql.includes('course_schema_versions')) return [termMarker];
        assert.match(sql, /leave_request\.row_version AS leave_row_version/);
        return [[{
          id: 41,
          enrollment_id: 5,
          enrollment_code: 'ENR-5',
          term_name: '進階班',
          session_id: 12,
          session_code: 'SESSION-12',
          title: '第三堂',
          starts_at: '2026-09-01 09:00:00',
          ends_at: '2026-09-01 10:00:00',
          status: 'LEAVE',
          entitlement_kind: 'REGULAR',
          leave_id: 77,
          leave_row_version: 3,
          row_version: 4,
        }]];
      },
    },
  });
  const schedule = await scheduleDomain.getMemberSchedule({ userId: 'member-1' });
  assert.equal(schedule[0].leaveId, 77);
  assert.equal(schedule[0].leaveRowVersion, 3);

  const makeupDomain = createCourseTermDomain({
    enabled: true,
    advancedPaymentsEnabled: false,
    pool: {
      async query(sql) {
        if (sql.includes('course_schema_versions')) return [termMarker];
        if (sql.includes('FROM course_makeup_entitlements m')) {
          assert.doesNotMatch(sql, /JOIN course_makeup_insurance_coverages/);
          return [[{
            id: 8,
            enrollment_id: 5,
            source_session_id: 12,
            source_title: '第三堂',
            status: 'AVAILABLE',
            valid_until: '2026-10-01 23:59:59',
            row_version: 2,
          }]];
        }
        assert.match(sql, /route\.booking_open_at/);
        return [[{
          id: 91,
          code: 'MAKEUP-91',
          title: '補課場次',
          starts_at: '2026-09-20 09:00:00',
          ends_at: '2026-09-20 10:00:00',
          capacity: 10,
          allocated: 4,
        }]];
      },
    },
  });
  const makeup = await makeupDomain.listMakeupEntitlements({ userId: 'member-1' });
  assert.deepEqual(makeup[0].targetSessions[0], {
    id: 91,
    code: 'MAKEUP-91',
    title: '補課場次',
    location: '',
    city: '',
    startsAt: '2026-09-20 09:00:00',
    endsAt: '2026-09-20 10:00:00',
    bookingOpenAt: undefined,
    bookingCloseAt: undefined,
    requiresInsurance: false,
    capacity: 10,
    availableSeats: 6,
  });
});

test('term roster and makeup projections never write count-card attendance usage', () => {
  const domain = read('src/services/course-term-domain.js');
  const rosterStart = domain.indexOf('async function ensureTermRosterProjections');
  const rosterEnd = domain.indexOf('async function fulfillOrder', rosterStart);
  const rosterAndActivation = domain.slice(rosterStart, rosterEnd);
  assert.match(rosterAndActivation, /origin, booked_at[\s\S]*'TERM_ROSTER'/);
  assert.doesNotMatch(rosterAndActivation, /'SUCCESS'|'NO_SHOW'/);
  assert.doesNotMatch(rosterAndActivation, /INSERT INTO course_usage_events/);

  const makeupStart = domain.indexOf('async function bookMakeup');
  const makeupEnd = domain.indexOf('async function transitionMakeupBooking', makeupStart);
  const makeupBooking = domain.slice(makeupStart, makeupEnd);
  assert.match(makeupBooking, /origin, booked_at[\s\S]*'MAKEUP'/);
  assert.doesNotMatch(makeupBooking, /course_usage_events|'SUCCESS'|'NO_SHOW'/);
});

test('052-only runtime safely skips the 053 outbox table', async () => {
  const { createCourseTermDomain } = require('../src/services/course-term-domain');
  const domain = createCourseTermDomain({
    pool: {},
    enabled: true,
    advancedPaymentsEnabled: false,
  });
  let writes = 0;
  const result = await domain.enqueueOutbox({
    async query() { writes += 1; return [{ affectedRows: 1 }]; },
  }, {
    ownerUserId: 'provider',
    userId: 'member',
    eventType: 'TERM_LEAVE_APPROVED',
    dedupeKey: 'leave:1',
  });
  assert.deepEqual(result, { queued: false, reason: 'advanced_payments_disabled' });
  assert.equal(writes, 0);
});

test('052-only makeup transitions do not reference 053 insurance tables', () => {
  const domain = read('src/services/course-term-domain.js');
  const transitionStart = domain.indexOf('async function transitionMakeupBooking');
  const transitionEnd = domain.indexOf('async function markTermAttendance', transitionStart);
  const transition = domain.slice(transitionStart, transitionEnd);
  assert.match(transition, /schema\.paymentSchemaReady/);
  assert.match(transition, /NULL AS insurance_status/);
  assert.match(transition, /LEFT JOIN course_makeup_insurance_coverages coverage/);
});

test('bank submission preserves a timely seat for manual review', () => {
  const domain = read('src/services/course-term-domain.js');
  assert.match(domain, /payment_status = 'reviewing'/);
  assert.match(domain, /UPDATE course_seat_allocations SET expires_at = NULL/);
  assert.match(domain, /COURSE_PAYMENT_DEADLINE_EXPIRED/);
});

test('advanced fixed-term payment instruments close atomically through fulfillment', () => {
  const domain = read('src/services/course-term-domain.js');
  assert.match(domain, /instrument_type = 'TRIAL_DISCOUNT'/);
  assert.match(domain, /status = 'RESERVED'[\s\S]*course_ticket_holds/);
  assert.match(domain, /consumeReservedTrialDiscount\(conn,[\s\S]*activatePaidEnrollment/);
  assert.match(domain, /instrument_type,\s*course_ticket_id[\s\S]*'COURSE_TICKET'/);
  assert.match(domain, /COURSE_PAYMENT_INSTRUMENT_CONFLICT/);
  assert.match(domain, /COURSE_TICKET'[\s\S]*activatePaidEnrollment\(conn/);
});

test('makeup insurance reserves a target-session seat and activates only after payment', () => {
  const domain = read('src/services/course-term-domain.js');
  const routes = read('src/routes/course-terms.js');
  const sharedOrders = read('src/routes/courses.js');
  assert.match(routes, /createMakeupInsuranceCheckout/);
  assert.match(domain, /allocation_type, status, expires_at[\s\S]*'MAKEUP_INSURANCE', 'HELD'/);
  assert.match(domain, /status = 'active', effective_at = NOW\(\)/);
  assert.match(domain, /course_makeup_bookings SET status = 'BOOKED'/);
  assert.match(domain, /course_makeup_entitlements SET status = 'BOOKED'/);
  assert.match(domain, /MAKEUP_INSURANCE_ACTIVATED/);
  assert.match(domain, /policy\.required AS target_insurance_required/);
  assert.match(domain, /Number\(makeup\.target_insurance_required\) !== 1/);
  assert.doesNotMatch(domain, /Number\(makeup\.requires_insurance\) !== 1/);
  assert.match(sharedOrders, /\['TERM_ENROLLMENT', 'MAKEUP_INSURANCE'\][\s\S]*courseTerms\.fulfillOrder/);
});

test('makeup insurance policy administration delegates versioned idempotent tenant checks', () => {
  const routes = read('src/routes/course-terms.js');
  const domain = read('src/services/course-term-admin-domain.js');
  assert.match(routes, /createCourseTermAdminDomain\(\{ pool, termDomain: courseTerms \}\)/);
  assert.match(routes, /courseTermAdmin\.createMakeupInsurancePolicy\(/);
  assert.match(routes, /courseTermAdmin\.updateMakeupInsurancePolicy\([\s\S]*rowVersionFromRequest/);
  assert.match(routes, /session\.owner_user_id = policy\.owner_user_id/);
  assert.match(routes, /product\.owner_user_id = policy\.owner_user_id/);
  const references = domain.slice(
    domain.indexOf('async function assertInsurancePolicyReferences'),
    domain.indexOf('async function listCatalog')
  );
  assert.match(references, /course_sessions[\s\S]*owner_user_id = \?[\s\S]*FOR UPDATE/);
  assert.match(references, /course_products[\s\S]*owner_user_id = \?[\s\S]*FOR UPDATE/);
  const create = domain.slice(
    domain.indexOf('async function createMakeupInsurancePolicy'),
    domain.indexOf('async function updateMakeupInsurancePolicy')
  );
  const updateStart = domain.indexOf('async function updateMakeupInsurancePolicy');
  const update = domain.slice(updateStart, domain.indexOf('\n  return {', updateStart));
  assert.match(create, /claimMutation\(conn[\s\S]*if \(mutation\.replay\) return mutation\.replay/);
  assert.match(create, /completeMutation\(conn/);
  assert.match(update, /claimMutation\(conn[\s\S]*if \(mutation\.replay\) return mutation\.replay[\s\S]*ensureRowVersion/);
  assert.match(update, /expectedRowVersion/);
});

test('makeup routes are provider scoped, idempotent and version controlled', () => {
  const domain = read('src/services/course-term-domain.js');
  const routes = read('src/routes/course-terms.js');
  assert.match(domain, /async function listMakeupRoutes[\s\S]*WHERE route\.owner_user_id = \?/);
  assert.match(domain, /async function validateMakeupRouteScope[\s\S]*source_owner_user_id[\s\S]*target_owner_user_id/);
  assert.match(domain, /term\.makeup-route\.create[\s\S]*claimMutation/);
  assert.match(domain, /term\.makeup-route\.update[\s\S]*ensureRowVersion/);
  assert.match(routes, /createMakeupRoute[\s\S]*mutationKeyFromRequest/);
  assert.match(routes, /updateMakeupRoute[\s\S]*rowVersionFromRequest/);
});

test('manual bank confirmation also confirms the payment submission atomically', () => {
  const domain = read('src/services/course-term-domain.js');
  const start = domain.indexOf('async function fulfillOrder');
  const end = domain.indexOf('async function submitBankTransfer', start);
  const fulfillment = domain.slice(start, end);
  assert.match(fulfillment, /await activatePaidEnrollment/);
  assert.match(fulfillment, /await activateMakeupInsurance/);
  assert.match(fulfillment, /UPDATE course_payment_submissions[\s\S]*status = 'CONFIRMED'/);
  assert.match(fulfillment, /reviewed_by = \?, reviewed_at = NOW\(\)/);
  assert.match(fulfillment, /status IN \('SUBMITTED','REVIEWING'\)/);
});

test('ordinary term quotes require a current, unexpired level in the target scheme', () => {
  const domain = read('src/services/course-term-domain.js');
  const start = domain.indexOf('async function resolveTermQuote');
  const end = domain.indexOf('async function getTermEligibility', start);
  const quote = domain.slice(start, end);
  assert.match(domain, /l\.scheme_id AS level_scheme_id/);
  assert.match(quote, /slr\.scheme_id = \? AND slr\.level_id = \?/);
  assert.match(quote, /slr\.is_current = 1/);
  assert.match(quote, /slr\.assessment_status = 'PASSED'/);
  assert.match(quote, /slr\.expires_at IS NULL OR slr\.expires_at >= NOW\(\)/);
  assert.match(quote, /requiredLevelSchemeId/);
});

test('admin enrollment rows expose provider-threshold payment review SLA warnings', () => {
  const routes = read('src/routes/course-terms.js');
  const start = routes.indexOf("router.get('/admin/courses/enrollments'");
  const end = routes.indexOf("router.get('/admin/courses/students'", start);
  const enrollments = routes.slice(start, end);
  assert.match(enrollments, /courseTerms\.readSchemaState\(\)/);
  assert.match(enrollments, /payment_submission\.submitted_at AS payment_submitted_at/);
  assert.match(enrollments, /provider_payment_settings\.bank_transfer_hold_hours/);
  assert.match(enrollments, /payment_review_sla_due_at/);
  assert.match(enrollments, /payment_review_sla_overdue/);
  assert.match(enrollments, /payment_submission\.status IN \('SUBMITTED','REVIEWING'\)/);
});

test('payment cancellation and expiry release all reserved rights through the outbox', () => {
  const domain = read('src/services/course-term-domain.js');
  assert.match(domain, /async function releaseReservedPaymentInstruments/);
  assert.match(domain, /course_order_discounts SET status = 'released'/);
  assert.match(domain, /course_makeup_entitlements SET status = 'AVAILABLE'/);
  assert.match(domain, /MAKEUP_INSURANCE_EXPIRED/);
  assert.match(domain, /cancelOrderResources\(conn,[\s\S]*payment_deadline_expired/);
});
