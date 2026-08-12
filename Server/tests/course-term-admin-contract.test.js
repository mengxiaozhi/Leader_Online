'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('fixed-term catalog mutations expose provider-scoped create, update, readiness, and publish routes', () => {
  const shared = read('src/routes/course-terms.js');
  const routes = read('src/routes/course-term-admin.js');
  const domain = read('src/services/course-term-admin-domain.js');
  assert.match(shared, /registerCourseTermAdminRoutes\(\{ router, ctx, termDomain: courseTerms \}\)/);
  for (const route of [
    '/admin/courses/programs',
    '/admin/courses/level-schemes',
    '/admin/courses/levels',
    '/admin/courses/terms',
    '/admin/courses/terms/:id/sessions',
    '/admin/courses/terms/:id/pricing-rules',
    '/admin/courses/terms/:id/readiness',
    '/admin/courses/terms/:id/publish',
    '/admin/courses/renewal-rules',
    '/admin/courses/students/:id/level',
    '/admin/courses/enrollments/:id/complete',
  ]) assert.ok(routes.includes(route), `missing ${route}`);
  assert.match(routes, /mutationKey\(req\)/);
  assert.match(routes, /rowVersion\(req\)/);
  assert.match(routes, /COURSE_TENANT_REQUIRED/);
  assert.match(domain, /sessions: sessions\[0\]/);
  assert.match(domain, /s\.session_kind = 'TERM'/);
});

test('fixed-term writes fail closed outside the legacy-safe Asia Taipei timezone', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/course-term-admin-domain.js'), 'utf8');
  assert.match(source, /COURSE_TIMEZONE_UNSUPPORTED/);
  assert.match(source, /timezone !== 'Asia\/Taipei'/);
  assert.match(source, /nextTimezone !== 'Asia\/Taipei'/);
});

test('student level and enrollment completion are provider-scoped versioned mutations', () => {
  const routes = read('src/routes/course-term-admin.js');
  const domain = read('src/services/course-term-admin-domain.js');
  assert.match(routes, /resourceOwner\(req, 'course_students'/);
  assert.match(routes, /resourceOwner\(req, 'course_term_enrollments'/);
  assert.match(domain, /async function upsertStudentLevel/);
  assert.match(domain, /course_student_level_records[\s\S]*is_current = 0/);
  assert.match(domain, /async function completeEnrollment/);
  assert.match(domain, /COURSE_TERM_COMPLETION_NOT_READY/);
  assert.match(domain, /status = 'COMPLETED', completed_at = NOW\(\)/);
});

test('fixed-term publish readiness locks sessions and pricing before opening a term', () => {
  const domain = read('src/services/course-term-admin-domain.js');
  const start = domain.indexOf('async function termReadiness');
  const end = domain.indexOf('async function upsertRenewalRule', start);
  const contract = domain.slice(start, end);
  assert.match(contract, /session_kind = 'TERM'/);
  assert.match(contract, /course_term_pricing_rules/);
  assert.match(contract, /COURSE_TERM_NOT_READY/);
  assert.match(contract, /ensureRowVersion/);
  assert.match(contract, /status = 'published'/);
  assert.match(contract, /status = 'open'/);
});

test('waitlist offers use the seat-allocation truth, row locks, outbox, and automatic progression', () => {
  const domain = read('src/services/course-term-admin-domain.js');
  assert.match(domain, /allocation_type, status, expires_at[\s\S]*'WAITLIST_OFFER', 'HELD'/);
  assert.match(domain, /status = 'WAITING'[\s\S]*FOR UPDATE SKIP LOCKED/);
  assert.match(domain, /TERM_WAITLIST_OFFERED/);
  assert.match(domain, /TERM_WAITLIST_ACCEPTED/);
  assert.match(domain, /TERM_WAITLIST_DECLINED/);
  assert.match(domain, /status IN \('OFFERED','ACCEPTED'\) AND o\.expires_at <= NOW\(\)/);
  assert.match(domain, /waitlist_offer_expired/);
  assert.match(domain, /UPDATE course_term_seat_offers[\s\S]*SET expires_at = \?/);
  assert.match(domain, /UPDATE course_seat_allocations[\s\S]*SET expires_at = \?/);
  assert.match(domain, /nextOffer = await offerNextWaitlisted/);
  const worker = read('src/services/course-productization-worker.js');
  assert.ok(worker.indexOf('expireDueSeatOffers') < worker.indexOf('fillAvailableWaitlistOffers'));
});

test('renewal eligibility is tied to the source completion, target level, window, and target term', () => {
  const admin = read('src/services/course-term-admin-domain.js');
  const member = read('src/services/course-term-domain.js');
  assert.match(admin, /SOURCE_TERM_NOT_COMPLETED/);
  assert.match(admin, /TARGET_LEVEL_REQUIRED/);
  assert.match(admin, /RENEWAL_WINDOW_CLOSED/);
  assert.match(admin, /TARGET_ALREADY_ENROLLED/);
  assert.match(admin, /expectedRuleRowVersion/);
  assert.match(member, /e\.status = 'COMPLETED'/);
  assert.match(member, /target\.status = 'published'/);
  assert.match(member, /course_student_level_records/);
});

test('fixed-term catalog foreign keys are locked and tenant scoped before writes', () => {
  const domain = read('src/services/course-term-admin-domain.js');
  const termRefs = domain.slice(
    domain.indexOf('async function assertOwnedTermReferences'),
    domain.indexOf('async function assertPricingSessionBounds')
  );
  assert.match(termRefs, /course_programs[\s\S]*owner_user_id = \?[\s\S]*FOR UPDATE/);
  assert.match(termRefs, /course_levels[\s\S]*owner_user_id = \?[\s\S]*FOR UPDATE/);
  const updateTerm = domain.slice(
    domain.indexOf('async function updateTerm'),
    domain.indexOf('async function createTermSession')
  );
  assert.match(updateTerm, /assertOwnedTermReferences\(conn/);
  assert.match(updateTerm, /SET program_id = \?/);

  const pricingRefs = domain.slice(
    domain.indexOf('async function assertPricingSessionBounds'),
    domain.indexOf('async function assertInsurancePolicyReferences')
  );
  assert.match(pricingRefs, /owner_user_id = \? AND term_id = \?/);
  assert.match(pricingRefs, /session_kind = 'TERM'/);
  assert.match(pricingRefs, /FOR UPDATE/);
  assert.match(domain, /await assertPricingSessionBounds\(conn/);

  const renewal = domain.slice(
    domain.indexOf('async function upsertRenewalRule'),
    domain.indexOf('async function renewalEligibility')
  );
  assert.match(renewal, /term\.owner_user_id = \?/);
  assert.match(renewal, /level\.owner_user_id AS level_owner_user_id/);
  assert.match(renewal, /COURSE_RENEWAL_LEVEL_NOT_FOUND/);
});

test('makeup insurance policy create and patch claim and replay idempotency atomically', async () => {
  const { createCourseTermAdminDomain } = require('../src/services/course-term-admin-domain');
  const commands = new Map();
  const policy = {
    id: 44,
    owner_user_id: 'provider-1',
    target_session_id: 7,
    fee_product_id: 9,
    required: 1,
    fee_amount: 100,
    currency: 'TWD',
    payment_hold_minutes: 1440,
    cancel_close_at: null,
    status: 'active',
    row_version: 1,
  };
  let policyInserts = 0;
  let policyUpdates = 0;
  let outboxWrites = 0;
  const conn = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('INSERT IGNORE INTO course_mutation_commands')) {
        const commandKey = `${params[0]}:${params[1]}:${params[2]}`;
        if (commands.has(commandKey)) return [{ affectedRows: 0, insertId: 0 }];
        commands.set(commandKey, {
          id: commands.size + 1,
          request_hash: params[3],
          status: 'processing',
          response_json: null,
        });
        return [{ affectedRows: 1, insertId: commands.size }];
      }
      if (normalized.includes('FROM course_mutation_commands')) {
        const commandKey = `${params[0]}:${params[1]}:${params[2]}`;
        return [[commands.get(commandKey)]];
      }
      if (normalized.startsWith('UPDATE course_mutation_commands')) {
        const commandKey = `${params[3]}:${params[4]}:${params[5]}`;
        const command = commands.get(commandKey);
        command.status = 'completed';
        command.response_json = params[0];
        return [{ affectedRows: 1 }];
      }
      if (normalized.includes('SELECT id FROM course_sessions')) return [[{ id: params[0] }]];
      if (normalized.includes('SELECT id FROM course_products')) return [[{ id: params[0] }]];
      if (normalized.startsWith('INSERT INTO course_makeup_insurance_policies')) {
        policyInserts += 1;
        return [{ affectedRows: 1, insertId: policy.id }];
      }
      if (normalized.startsWith('SELECT * FROM course_makeup_insurance_policies')) {
        return [[{ ...policy }]];
      }
      if (normalized.startsWith('UPDATE course_makeup_insurance_policies')) {
        policyUpdates += 1;
        policy.target_session_id = params[0];
        policy.fee_product_id = params[1];
        policy.fee_amount = params[3];
        policy.row_version += 1;
        return [{ affectedRows: 1 }];
      }
      throw new Error(`unexpected SQL: ${normalized}`);
    },
  };
  const termDomain = {
    async assertSchema() {},
    async assertProviderRuntime() {},
    async enqueueOutbox() { outboxWrites += 1; return { queued: true }; },
  };
  const admin = createCourseTermAdminDomain({
    pool: { async getConnection() { return conn; } },
    termDomain,
  });
  const createInput = {
    ownerUserId: 'provider-1',
    actorUserId: 'admin-1',
    body: { targetSessionId: 7, feeProductId: 9, feeAmount: 100 },
    idempotencyKey: 'insurance-create-1',
  };
  const created = await admin.createMakeupInsurancePolicy(createInput);
  const createReplay = await admin.createMakeupInsurancePolicy(createInput);
  assert.deepEqual(createReplay, created);
  assert.equal(policyInserts, 1);

  const updateInput = {
    policyId: policy.id,
    ownerUserId: 'provider-1',
    actorUserId: 'admin-1',
    body: { targetSessionId: 8, feeProductId: null, feeAmount: 150 },
    idempotencyKey: 'insurance-update-1',
    expectedRowVersion: 1,
  };
  const updated = await admin.updateMakeupInsurancePolicy(updateInput);
  const updateReplay = await admin.updateMakeupInsurancePolicy(updateInput);
  assert.deepEqual(updateReplay, updated);
  assert.equal(policyUpdates, 1, 'replay must return before the now-stale row-version lock');
  assert.equal(outboxWrites, 2, 'each committed mutation queues exactly one event');

  await assert.rejects(
    () => admin.updateMakeupInsurancePolicy({ ...updateInput, idempotencyKey: 'insurance-update-2', expectedRowVersion: null }),
    (error) => error.code === 'COURSE_ROW_VERSION_REQUIRED' && error.statusCode === 428
  );
});
