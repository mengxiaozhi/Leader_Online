'use strict';

const { randomBytes } = require('crypto');
const {
  assertIdempotencyKey,
  bankTransferDeadline,
  calculateTermQuote,
  canCancelTermLeave,
  courseTermError,
  dateMs,
  ensureRowVersion,
  money,
  mysqlDateTime,
  normalizePaymentMethod,
  positiveInteger,
  requestHash,
  stableStringify,
  termCapacity,
  text,
} = require('./course-term-policy');
const { resolveCoursePolicy } = require('./course-v2-policy');
const { enqueueCourseNotificationOutbox } = require('./course-notification-outbox');

const COURSE_TERM_SCHEMA_VERSION = '052_course_fixed_term_productization';
const COURSE_PAYMENT_SCHEMA_VERSION = '053_course_term_payments_notifications';
const BLOCKING_MAKEUP_BOOKING_STATUSES = new Set([
  'RESERVED',
  'BOOKED',
  'ATTENDED',
  'NO_SHOW',
]);

function environmentFlag(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function randomCode(prefix, bytes = 5) {
  return `${prefix}-${randomBytes(bytes).toString('hex').toUpperCase()}`;
}

function ownerScopeSql(ownerUserId, column = 'owner_user_id') {
  return ownerUserId ? { sql: `${column} = ?`, params: [ownerUserId] } : { sql: `${column} IS NULL`, params: [] };
}

function mutationKeyFromRequest(req) {
  return text(
    req?.get?.('Idempotency-Key')
      || req?.headers?.['idempotency-key']
      || req?.body?.idempotencyKey
      || req?.body?.idempotency_key,
    128
  );
}

function rowVersionFromRequest(req) {
  const header = req?.get?.('If-Match') || req?.headers?.['if-match'];
  const value = header !== undefined && header !== null && header !== ''
    ? String(header).replace(/^W\//, '').replace(/^"|"$/g, '')
    : (req?.body?.rowVersion ?? req?.body?.row_version);
  return positiveInteger(value, null);
}

function toPublicTerm(row = {}, capacity = null) {
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    summary: row.summary || '',
    description: row.description || '',
    ownerUserId: row.owner_user_id || null,
    providerName: row.provider_name || '',
    programId: row.program_id == null ? null : Number(row.program_id),
    programName: row.program_name || '',
    levelId: row.level_id == null ? null : Number(row.level_id),
    levelName: row.level_name || '',
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    enrollmentOpenAt: row.enrollment_open_at,
    enrollmentCloseAt: row.enrollment_close_at,
    capacity: row.capacity == null ? null : Number(row.capacity),
    seatAvailability: capacity,
    timezone: row.timezone || 'Asia/Taipei',
    status: row.status || 'draft',
    rowVersion: Number(row.row_version || 1),
  };
}

function createCourseTermDomain({
  pool,
  enabled = environmentFlag(process.env.COURSE_FIXED_TERM_ENABLED, false),
  advancedPaymentsEnabled = environmentFlag(process.env.COURSE_ADVANCED_PAYMENTS_ENABLED, false),
  termSchemaVersion = COURSE_TERM_SCHEMA_VERSION,
  paymentSchemaVersion = COURSE_PAYMENT_SCHEMA_VERSION,
} = {}) {
  if (!pool) throw new TypeError('course term domain requires a database pool');

  let readinessCache = null;
  let readinessExpiresAt = 0;

  async function readSchemaState({ refresh = false } = {}) {
    if (!refresh && readinessCache && Date.now() < readinessExpiresAt) return readinessCache;
    try {
      const [rows] = await pool.query(
        `SELECT version FROM course_schema_versions
          WHERE version IN (?, ?)`,
        [termSchemaVersion, paymentSchemaVersion]
      );
      const versions = new Set(rows.map((row) => row.version));
      readinessCache = {
        enabled,
        advancedPaymentsEnabled,
        termSchemaReady: versions.has(termSchemaVersion),
        paymentSchemaReady: versions.has(paymentSchemaVersion),
        termSchemaVersion,
        paymentSchemaVersion,
      };
    } catch (error) {
      if (!['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(error?.code)) throw error;
      readinessCache = {
        enabled,
        advancedPaymentsEnabled,
        termSchemaReady: false,
        paymentSchemaReady: false,
        termSchemaVersion,
        paymentSchemaVersion,
      };
    }
    readinessExpiresAt = Date.now() + 5000;
    return readinessCache;
  }

  async function assertSchema({ requirePayments = false, requireEnabled = true } = {}) {
    if (requireEnabled && !enabled) {
      throw courseTermError('COURSE_FIXED_TERM_DISABLED', '固定班功能尚未啟用', 503);
    }
    const state = await readSchemaState();
    if (!state.termSchemaReady) {
      throw courseTermError(
        'COURSE_FIXED_TERM_SCHEMA_REQUIRED',
        `固定班資料庫 migration ${termSchemaVersion} 尚未完成`,
        503,
        state
      );
    }
    if (requirePayments && (
      !state.paymentSchemaReady
      || (requireEnabled && !advancedPaymentsEnabled)
    )) {
      throw courseTermError(
        'COURSE_ADVANCED_PAYMENTS_UNAVAILABLE',
        `進階付款需要啟用旗標並完成 migration ${paymentSchemaVersion}`,
        503,
        state
      );
    }
    return state;
  }

  async function assertProviderRuntime(queryable, ownerUserId, { requirePayments = false, forUpdate = false } = {}) {
    const settings = await assertProviderFeature(
      queryable,
      ownerUserId,
      requirePayments ? 'advanced_payments_enabled' : 'fixed_term_enabled',
      { forUpdate }
    );
    if (requirePayments) {
      await assertProviderFeature(queryable, ownerUserId, 'fixed_term_enabled', { forUpdate: false });
    }
    return settings;
  }

  async function withTransaction(work) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await work(conn);
      await conn.commit();
      return result;
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      throw error;
    } finally {
      conn.release();
    }
  }

  async function claimMutation(conn, {
    actorUserId,
    operation,
    idempotencyKey,
    payload,
    resourceType = null,
    resourceId = null,
  }) {
    const key = assertIdempotencyKey(idempotencyKey);
    const hash = requestHash(payload);
    const [insert] = await conn.query(
      `INSERT IGNORE INTO course_mutation_commands
        (actor_user_id, operation, idempotency_key, request_hash,
         resource_type, resource_id, status)
       VALUES (?, ?, ?, ?, ?, ?, 'processing')`,
      [actorUserId, operation, key, hash, resourceType, resourceId]
    );
    if (Number(insert.affectedRows || 0) === 1) {
      return { key, commandId: Number(insert.insertId), replay: null };
    }
    const [rows] = await conn.query(
      `SELECT id, request_hash, status, response_json
         FROM course_mutation_commands
        WHERE actor_user_id = ? AND operation = ? AND idempotency_key = ?
        LIMIT 1 FOR UPDATE`,
      [actorUserId, operation, key]
    );
    const current = rows[0];
    if (!current || current.request_hash !== hash) {
      throw courseTermError('IDEMPOTENCY_KEY_REUSED', '此 Idempotency-Key 已用於不同資料', 409);
    }
    if (current.status === 'completed') {
      return { key, commandId: Number(current.id), replay: parseJson(current.response_json, null) };
    }
    throw courseTermError('IDEMPOTENCY_IN_PROGRESS', '同一操作仍在處理中', 409);
  }

  async function completeMutation(conn, {
    actorUserId,
    operation,
    mutation,
    response,
    resourceType = null,
    resourceId = null,
  }) {
    await conn.query(
      `UPDATE course_mutation_commands
          SET status = 'completed', response_json = ?,
              resource_type = COALESCE(?, resource_type),
              resource_id = COALESCE(?, resource_id)
        WHERE actor_user_id = ? AND operation = ? AND idempotency_key = ?`,
      [JSON.stringify(response), resourceType, resourceId, actorUserId, operation, mutation.key]
    );
  }

  async function getProviderSettings(queryable, ownerUserId, { forUpdate = false } = {}) {
    const [rows] = await queryable.query(
      `SELECT * FROM course_settings
        WHERE scope_key = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [ownerUserId ? `provider:${ownerUserId}` : 'platform']
    );
    return rows[0] || {};
  }

  async function assertProviderFeature(queryable, ownerUserId, feature, { forUpdate = false } = {}) {
    const provider = await getProviderSettings(queryable, ownerUserId, { forUpdate });
    const platform = ownerUserId
      ? await getProviderSettings(queryable, null, { forUpdate: false })
      : provider;
    const providerEnabled = Number(provider[feature] ?? 0) === 1;
    const platformEnabled = ownerUserId ? Number(platform[feature] ?? 0) === 1 : true;
    if (!providerEnabled || !platformEnabled) {
      throw courseTermError('COURSE_PROVIDER_FEATURE_DISABLED', '此課程服務商尚未開啟固定班功能', 503, {
        feature,
        ownerUserId,
      });
    }
    return { provider, platform };
  }

  async function ensureStudent(conn, {
    ownerUserId,
    userId,
    forUpdate = false,
    create = true,
  }) {
    const tenantKey = ownerUserId || '00000000-0000-0000-0000-000000000000';
    const [rows] = await conn.query(
      `SELECT s.* FROM course_students s
        WHERE s.tenant_key = ? AND s.user_id = ?
        LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [tenantKey, userId]
    );
    if (rows[0]) return rows[0];
    const [users] = await conn.query(
      `SELECT id, email, username, phone FROM users WHERE id = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [userId]
    );
    const user = users[0];
    if (!user) throw courseTermError('AUTH_INVALID_TOKEN', '登入帳號不存在', 401);
    if (!create) {
      return {
        id: null,
        owner_user_id: ownerUserId,
        tenant_key: tenantKey,
        user_id: userId,
        email: text(user.email, 255).toLowerCase(),
        display_name: text(user.username || user.email, 255),
        persisted: false,
      };
    }
    const email = text(user.email, 255).toLowerCase();
    const [insert] = await conn.query(
      `INSERT INTO course_students
        (owner_user_id, tenant_key, user_id, email, email_normalized,
         display_name, phone, status, source_system, claimed_at, row_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'leader', NOW(), 1)`,
      [ownerUserId, tenantKey, userId, email, email, text(user.username || email, 255), text(user.phone, 32) || null]
    );
    return { id: Number(insert.insertId), owner_user_id: ownerUserId, tenant_key: tenantKey, user_id: userId };
  }

  async function loadTerm(queryable, termId, { forUpdate = false, publishedOnly = false } = {}) {
    const [rows] = await queryable.query(
      `SELECT t.*, p.name AS program_name, l.name AS level_name,
              l.scheme_id AS level_scheme_id,
              provider.username AS provider_name
         FROM course_terms t
         JOIN course_programs p ON p.id = t.program_id
         LEFT JOIN course_levels l ON l.id = t.level_id
         LEFT JOIN users provider ON provider.id = t.owner_user_id
        WHERE t.id = ? ${publishedOnly ? "AND t.status = 'published'" : ''}
        LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [positiveInteger(termId)]
    );
    return rows[0] || null;
  }

  async function countTermAllocations(queryable, termId, { forUpdate = false } = {}) {
    const [rows] = await queryable.query(
      `SELECT id FROM course_seat_allocations
        WHERE term_id = ? AND status IN ('HELD','ACTIVE')
          AND allocation_type <> 'MAKEUP_INSURANCE'
          AND (expires_at IS NULL OR expires_at > NOW())${forUpdate ? ' FOR UPDATE' : ''}`,
      [termId]
    );
    return rows.length;
  }

  async function listTerms({ ownerUserId = undefined, includeDraft = false } = {}) {
    await assertSchema();
    const where = [];
    const params = [];
    if (ownerUserId !== undefined) {
      const scope = ownerScopeSql(ownerUserId, 't.owner_user_id');
      where.push(scope.sql);
      params.push(...scope.params);
    }
    if (!includeDraft) {
      where.push("t.status = 'published'");
      where.push('(t.enrollment_open_at IS NULL OR t.enrollment_open_at <= NOW())');
      where.push('(t.enrollment_close_at IS NULL OR t.enrollment_close_at >= NOW())');
    }
    where.push(`EXISTS (
      SELECT 1 FROM course_settings feature_settings
       WHERE feature_settings.scope_key = CONCAT('provider:', t.owner_user_id)
         AND feature_settings.fixed_term_enabled = 1
    )`);
    where.push(`EXISTS (
      SELECT 1 FROM course_settings platform_feature_settings
       WHERE platform_feature_settings.scope_key = 'platform'
         AND platform_feature_settings.fixed_term_enabled = 1
    )`);
    const [rows] = await pool.query(
      `SELECT t.*, p.name AS program_name, l.name AS level_name,
              provider.username AS provider_name,
              (SELECT COUNT(*) FROM course_seat_allocations a
                WHERE a.term_id = t.id AND a.status IN ('HELD','ACTIVE')
                  AND a.allocation_type <> 'MAKEUP_INSURANCE'
                  AND (a.expires_at IS NULL OR a.expires_at > NOW())) AS allocated_seats
         FROM course_terms t
         JOIN course_programs p ON p.id = t.program_id
         LEFT JOIN course_levels l ON l.id = t.level_id
         LEFT JOIN users provider ON provider.id = t.owner_user_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY t.starts_on, t.id`,
      params
    );
    return rows.map((row) => toPublicTerm(row, termCapacity({
      capacity: row.capacity,
      activeAllocations: row.allocated_seats,
    })));
  }

  async function getTermDetails({ termId, publishedOnly = true } = {}) {
    await assertSchema();
    const term = await loadTerm(pool, termId, { publishedOnly });
    if (!term) throw courseTermError('COURSE_TERM_NOT_FOUND', '找不到固定班期', 404);
    await assertProviderRuntime(pool, term.owner_user_id);
    const [sessions] = await pool.query(
      `SELECT id, code, title, location, city, starts_at, ends_at, status,
              capacity, row_version
         FROM course_sessions WHERE term_id = ?
        ORDER BY starts_at, id`,
      [term.id]
    );
    const allocated = await countTermAllocations(pool, term.id);
    return {
      ...toPublicTerm(term, termCapacity({ capacity: term.capacity, activeAllocations: allocated })),
      rules: parseJson(term.rules_snapshot_json, {}),
      sessions: sessions.map((session) => ({
        id: Number(session.id),
        code: session.code,
        title: session.title,
        location: session.location || '',
        city: session.city || '',
        startsAt: session.starts_at,
        endsAt: session.ends_at,
        status: session.status,
        capacity: session.capacity == null ? null : Number(session.capacity),
        rowVersion: Number(session.row_version || 1),
      })),
    };
  }

  async function resolveTermQuote(conn, {
    termId,
    userId,
    startSessionId = null,
    expectedTermRowVersion = null,
    lock = false,
    createStudent = true,
  }) {
    const term = await loadTerm(conn, termId, { forUpdate: lock, publishedOnly: true });
    if (!term) throw courseTermError('COURSE_TERM_NOT_FOUND', '找不到可報名的固定班期', 404);
    if (expectedTermRowVersion !== null) ensureRowVersion(term.row_version, expectedTermRowVersion, '班期');
    await assertProviderRuntime(conn, term.owner_user_id, { forUpdate: lock });
    const now = Date.now();
    const opensAt = dateMs(term.enrollment_open_at);
    const closesAt = dateMs(term.enrollment_close_at);
    if (Number.isFinite(opensAt) && now < opensAt) {
      throw courseTermError('COURSE_TERM_ENROLLMENT_NOT_OPEN', '固定班尚未開放報名', 409);
    }
    if (Number.isFinite(closesAt) && now > closesAt) {
      throw courseTermError('COURSE_TERM_ENROLLMENT_CLOSED', '固定班報名已截止', 409);
    }
    const student = await ensureStudent(conn, {
      ownerUserId: term.owner_user_id,
      userId,
      forUpdate: lock,
      create: createStudent,
    });
    const [existing] = await conn.query(
      `SELECT id, status FROM course_term_enrollments
        WHERE term_id = ? AND student_id = ? AND status NOT IN ('CANCELLED','REJECTED')
        LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [term.id, student.id]
    );
    if (existing[0]) throw courseTermError('COURSE_TERM_ALREADY_ENROLLED', '此學員已有本班期報名或待付款紀錄', 409);
    let levelRows = [];
    if (term.level_id) {
      [levelRows] = await conn.query(
        `SELECT slr.level_id, slr.scheme_id, slr.assessment_status,
                slr.expires_at
           FROM course_student_level_records slr
          WHERE slr.student_id = ? AND slr.owner_user_id <=> ?
            AND slr.scheme_id = ? AND slr.level_id = ?
            AND slr.is_current = 1
            AND slr.assessment_status = 'PASSED'
            AND (slr.expires_at IS NULL OR slr.expires_at >= NOW())
          ORDER BY slr.assessed_at DESC, slr.id DESC LIMIT 1`,
        [student.id, term.owner_user_id, term.level_scheme_id, term.level_id]
      );
    }
    if (term.level_id && !levelRows[0]) {
      throw courseTermError('COURSE_TERM_LEVEL_REQUIRED', '學員程度尚未符合此班期資格', 409, {
        requiredLevelId: Number(term.level_id),
        requiredLevelSchemeId: term.level_scheme_id ? Number(term.level_scheme_id) : null,
        currentLevelId: null,
      });
    }
    const [sessions] = await conn.query(
      `SELECT id, starts_at, ends_at, status FROM course_sessions
        WHERE term_id = ? ORDER BY starts_at, id${lock ? ' FOR UPDATE' : ''}`,
      [term.id]
    );
    const [pricingRows] = await conn.query(
      `SELECT * FROM course_term_pricing_rules
        WHERE term_id = ? AND status = 'active'
        ORDER BY priority, id LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [term.id]
    );
    const pricingRule = pricingRows[0];
    if (!pricingRule) throw courseTermError('COURSE_TERM_PRICING_MISSING', '固定班尚未設定有效定價', 409);
    const pricing = calculateTermQuote({ term, pricingRule, sessions, startSessionId, now });
    const allocated = await countTermAllocations(conn, term.id, { forUpdate: lock });
    const seats = termCapacity({ capacity: term.capacity, activeAllocations: allocated });
    return { term, student, pricingRule, pricing, seats };
  }

  async function getTermEligibility({ termId, userId, startSessionId = null } = {}) {
    await assertSchema();
    try {
      const resolved = await resolveTermQuote(pool, {
        termId,
        userId,
        startSessionId,
        lock: false,
        createStudent: false,
      });
      const reasons = [];
      if (resolved.seats.full) reasons.push({
        code: 'COURSE_TERM_CAPACITY_FULL',
        message: '固定班名額已滿，可加入候補',
      });
      return {
        eligible: reasons.length === 0,
        reasons,
        term: toPublicTerm(resolved.term, resolved.seats),
        pricing: resolved.pricing,
        studentRecordExists: Boolean(resolved.student.id),
      };
    } catch (error) {
      if (Number(error?.statusCode || error?.status) !== 409) throw error;
      return {
        eligible: false,
        reasons: [{
          code: error.code || 'COURSE_TERM_NOT_ELIGIBLE',
          message: error.message || '目前不符合固定班報名資格',
          details: error.details || null,
        }],
      };
    }
  }

  async function createQuote({
    termId,
    userId,
    startSessionId = null,
    idempotencyKey,
    expectedTermRowVersion,
  }) {
    await assertSchema();
    const key = assertIdempotencyKey(idempotencyKey);
    return withTransaction(async (conn) => {
      const payload = { termId: Number(termId), userId, startSessionId: startSessionId || null };
      const hash = requestHash(payload);
      const [existing] = await conn.query(
        `SELECT * FROM course_term_quotes
          WHERE user_id = ? AND idempotency_key = ? LIMIT 1 FOR UPDATE`,
        [userId, key]
      );
      if (existing[0]) {
        if (existing[0].request_hash !== hash) {
          throw courseTermError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key 已用於不同固定班報價', 409);
        }
        return publicQuote(existing[0]);
      }
      const resolved = await resolveTermQuote(conn, {
        termId,
        userId,
        startSessionId,
        expectedTermRowVersion,
        lock: true,
      });
      const expiresAt = mysqlDateTime(Date.now() + 15 * 60 * 1000);
      const quoteCode = randomCode('CQ', 6);
      const rulesSnapshot = {
        ...parseJson(resolved.term.rules_snapshot_json, {}),
        leaveQuota: Number(resolved.term.leave_quota),
        leaveCutoffMinutes: Number(resolved.term.leave_cutoff_minutes),
        makeupValidDays: Number(resolved.term.makeup_valid_days),
      };
      const [insert] = await conn.query(
        `INSERT INTO course_term_quotes
          (quote_code, owner_user_id, term_id, user_id, student_id,
           idempotency_key, request_hash, session_ids_json,
           pricing_snapshot_json, rules_snapshot_json, total_amount,
           currency, status, expires_at, row_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, 1)`,
        [
          quoteCode,
          resolved.term.owner_user_id,
          resolved.term.id,
          userId,
          resolved.student.id,
          key,
          hash,
          JSON.stringify(resolved.pricing.sessionIds),
          JSON.stringify(resolved.pricing),
          JSON.stringify(rulesSnapshot),
          resolved.pricing.totalAmount,
          resolved.pricing.currency,
          expiresAt,
        ]
      );
      return {
        id: Number(insert.insertId),
        quoteCode,
        term: toPublicTerm(resolved.term, resolved.seats),
        ...resolved.pricing,
        rules: rulesSnapshot,
        expiresAt,
        rowVersion: 1,
      };
    });
  }

  function publicQuote(row) {
    const pricing = parseJson(row.pricing_snapshot_json, {});
    return {
      id: Number(row.id),
      quoteCode: row.quote_code,
      termId: Number(row.term_id),
      ...pricing,
      rules: parseJson(row.rules_snapshot_json, {}),
      expiresAt: row.expires_at,
      status: row.status,
      rowVersion: Number(row.row_version || 1),
    };
  }

  async function enqueueOutbox(conn, {
    ownerUserId = null,
    userId = null,
    eventType,
    dedupeKey,
    payload = {},
  }) {
    if (!advancedPaymentsEnabled) {
      return enqueueCourseNotificationOutbox(conn, {
        ownerUserId,
        userId,
        eventType,
        dedupeKey,
        payload,
      }, { runtimeEnabled: false });
    }
    const schema = await readSchemaState();
    return enqueueCourseNotificationOutbox(conn, {
      ownerUserId,
      userId,
      eventType,
      dedupeKey,
      payload,
    }, {
      runtimeEnabled: advancedPaymentsEnabled,
      schemaReady: schema.paymentSchemaReady,
      ownerUserId,
      // Fixed-term mutations already enforce their provider capability before
      // enqueueing. Count-card callers opt into the shared helper's stricter
      // advanced-payments provider gate directly.
      requireProviderAdvancedPayments: false,
    });
  }

  function paymentTicketPolicy(row = {}) {
    return parseJson(row.product_redemption_policy_snapshot || row.redemption_policy_json, {});
  }

  function trialDiscountFaceValue(row = {}) {
    const policy = paymentTicketPolicy(row);
    return money(
      policy.trialDiscountAmount
        ?? policy.trial_discount_amount
        ?? policy.faceValue
        ?? policy.face_value
        ?? policy.amount,
      0
    );
  }

  async function loadPaymentTicket(conn, {
    ticketId,
    userId,
    ownerUserId,
    forUpdate = false,
  }) {
    const [rows] = await conn.query(
      `SELECT t.*,
              COALESCE(t.usage_mode_snapshot, tp.usage_mode, 'finite') AS usage_mode,
              COALESCE(t.product_type_snapshot, tp.product_type, 'count_pass') AS product_type,
              COALESCE(t.product_redemption_policy_snapshot, tp.redemption_policy_json) AS redemption_policy_json,
              COALESCE(t.provider_user_id_snapshot, tp.owner_user_id) AS effective_owner_user_id,
              tp.name AS ticket_product_name,
              COALESCE((SELECT SUM(ev.delta_uses) FROM course_usage_events ev
                         WHERE ev.ticket_id = t.id), 0) AS ledger_balance,
              COALESCE((SELECT SUM(h.quantity) FROM course_ticket_holds h
                         WHERE h.ticket_id = t.id AND h.status = 'active'), 0) AS active_holds,
              EXISTS(
                SELECT 1 FROM course_redeem_scenarios scenario
                JOIN course_scenario_allowed_products allowed
                  ON allowed.scenario_id = scenario.id
               WHERE scenario.owner_user_id <=> ? AND scenario.item_type = 'term'
                 AND scenario.status = 'active' AND allowed.ticket_product_id = t.ticket_product_id
              ) AS term_payment_allowed
         FROM course_tickets t
         JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
        WHERE t.id = ? AND (t.user_id = ? OR EXISTS(
          SELECT 1 FROM course_students s WHERE s.id = t.student_id AND s.user_id = ?
        )) AND COALESCE(t.provider_user_id_snapshot, tp.owner_user_id) <=> ?
        LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [ownerUserId, positiveInteger(ticketId), userId, userId, ownerUserId]
    );
    return rows[0] || null;
  }

  function assertPaymentTicketUsable(ticket, { expectedRowVersion = null } = {}) {
    if (!ticket || !['active', 'pending'].includes(String(ticket.status || '').toLowerCase())) {
      throw courseTermError('COURSE_PAYMENT_TICKET_NOT_ELIGIBLE', '課程券不可用於本次固定班付款', 409);
    }
    if (ticket.frozen_at || String(ticket.status).toLowerCase() === 'paused') {
      throw courseTermError('COURSE_PAYMENT_TICKET_NOT_ELIGIBLE', '凍結或暫停中的課程券不可作為付款工具', 409);
    }
    if (ticket.expires_at && dateMs(ticket.expires_at) < Date.now()) {
      throw courseTermError('COURSE_PAYMENT_TICKET_EXPIRED', '課程券已過期', 409);
    }
    if (String(ticket.status).toLowerCase() === 'pending'
      && ticket.activation_deadline && dateMs(ticket.activation_deadline) < Date.now()) {
      throw courseTermError('COURSE_PAYMENT_TICKET_ACTIVATION_EXPIRED', '課程券已超過開卡期限', 409);
    }
    if (expectedRowVersion !== null) ensureRowVersion(ticket.row_version, expectedRowVersion, '付款課程券');
    const unlimited = String(ticket.usage_mode).toLowerCase() === 'unlimited';
    const available = unlimited ? null : Number(ticket.ledger_balance || 0) - Number(ticket.active_holds || 0);
    if (!unlimited && available < 1) {
      throw courseTermError('COURSE_PAYMENT_TICKET_BALANCE_LOW', '課程券可用堂數不足', 409);
    }
    return { unlimited, available };
  }

  async function listPaymentOptions({ termId, userId }) {
    await assertSchema({ requirePayments: true });
    const term = await loadTerm(pool, termId, { publishedOnly: true });
    if (!term) throw courseTermError('COURSE_TERM_NOT_FOUND', '找不到可報名的固定班期', 404);
    await assertProviderRuntime(pool, term.owner_user_id, { requirePayments: true });
    const [rows] = await pool.query(
      `SELECT t.id, t.code, t.status, t.expires_at, t.activation_deadline, t.row_version,
              COALESCE(t.usage_mode_snapshot, tp.usage_mode, 'finite') AS usage_mode,
              COALESCE(t.product_type_snapshot, tp.product_type, 'count_pass') AS product_type,
              COALESCE(t.product_name_snapshot, tp.name) AS product_name,
              COALESCE(t.product_redemption_policy_snapshot, tp.redemption_policy_json) AS redemption_policy_json,
              COALESCE((SELECT SUM(ev.delta_uses) FROM course_usage_events ev WHERE ev.ticket_id = t.id), 0) AS ledger_balance,
              COALESCE((SELECT SUM(h.quantity) FROM course_ticket_holds h
                         WHERE h.ticket_id = t.id AND h.status = 'active'), 0) AS active_holds,
              EXISTS(
                SELECT 1 FROM course_redeem_scenarios scenario
                JOIN course_scenario_allowed_products allowed ON allowed.scenario_id = scenario.id
               WHERE scenario.owner_user_id = ? AND scenario.item_type = 'term'
                 AND scenario.status = 'active' AND allowed.ticket_product_id = t.ticket_product_id
              ) AS term_payment_allowed
         FROM course_tickets t
         JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
        WHERE (t.user_id = ? OR EXISTS(
          SELECT 1 FROM course_students student
           WHERE student.id = t.student_id AND student.user_id = ?
        ))
          AND COALESCE(t.provider_user_id_snapshot, tp.owner_user_id) = ?
          AND t.status IN ('pending','active') AND t.frozen_at IS NULL
        ORDER BY t.expires_at, t.issued_at, t.id`,
      [term.owner_user_id, userId, userId, term.owner_user_id]
    );
    const items = [];
    for (const row of rows) {
      const unlimited = String(row.usage_mode).toLowerCase() === 'unlimited';
      const availableUses = unlimited
        ? null
        : Number(row.ledger_balance || 0) - Number(row.active_holds || 0);
      const expired = Boolean(row.expires_at && dateMs(row.expires_at) < Date.now());
      const activationExpired = Boolean(
        String(row.status).toLowerCase() === 'pending'
        && row.activation_deadline
        && dateMs(row.activation_deadline) < Date.now()
      );
      if (expired || activationExpired || (!unlimited && availableUses < 1)) continue;
      const kind = String(row.product_type).toLowerCase() === 'trial_discount'
        ? 'TRIAL_DISCOUNT'
        : (Number(row.term_payment_allowed) === 1 ? 'COURSE_TICKET' : null);
      if (!kind) continue;
      const discountAmount = kind === 'TRIAL_DISCOUNT' ? trialDiscountFaceValue(row) : 0;
      if (kind === 'TRIAL_DISCOUNT' && discountAmount <= 0) continue;
      items.push({
        ticketId: Number(row.id),
        ticketCode: row.code,
        ticketProductName: row.product_name,
        instrumentType: kind,
        discountAmount,
        usageMode: row.usage_mode,
        availableUses,
        expiresAt: row.expires_at,
        activationDeadline: row.activation_deadline,
        rowVersion: Number(row.row_version || 1),
      });
    }
    return { termId: Number(term.id), items };
  }

  async function reserveTrialDiscount(conn, {
    ticketId,
    orderId,
    enrollmentId,
    userId,
    ownerUserId,
    originalAmount,
    currency = 'TWD',
    idempotencyKey,
    expectedTicketRowVersion,
  }) {
    const ticket = await loadPaymentTicket(conn, {
      ticketId, userId, ownerUserId, forUpdate: true,
    });
    assertPaymentTicketUsable(ticket, { expectedRowVersion: expectedTicketRowVersion });
    if (String(ticket.product_type).toLowerCase() !== 'trial_discount') {
      throw courseTermError('COURSE_TRIAL_DISCOUNT_NOT_ELIGIBLE', '所選票券不是體驗折抵券', 409);
    }
    const faceValue = trialDiscountFaceValue(ticket);
    if (faceValue <= 0) {
      throw courseTermError('COURSE_TRIAL_DISCOUNT_AMOUNT_MISSING', '體驗折抵券未設定有效面額', 409);
    }
    const amountApplied = Math.min(money(originalAmount, 0), faceValue);
    const normalizedCurrency = text(currency, 3).toUpperCase() || 'TWD';
    const [holdInsert] = await conn.query(
      `INSERT INTO course_ticket_holds
        (ticket_id, purpose, source_type, source_id, quantity, status, row_version)
       VALUES (?, 'PAYMENT_INSTRUMENT', 'term_order', ?, 1, 'active', 1)`,
      [ticket.id, String(orderId)]
    );
    const policySnapshot = {
      ticketProductId: Number(ticket.ticket_product_id),
      faceValue,
      originalAmount: money(originalAmount, 0),
      amountApplied,
      currency: normalizedCurrency,
    };
    const [instrumentInsert] = await conn.query(
      `INSERT INTO course_order_payment_instruments
        (owner_user_id, order_id, enrollment_id, instrument_type,
         course_ticket_id, hold_id, units_applied, amount_applied, currency,
         status, idempotency_key, policy_snapshot_json, row_version)
       VALUES (?, ?, ?, 'TRIAL_DISCOUNT', ?, ?, 1, ?, ?,
               'RESERVED', ?, ?, 1)`,
      [ownerUserId, orderId, enrollmentId, ticket.id, holdInsert.insertId,
        amountApplied, normalizedCurrency, idempotencyKey, JSON.stringify(policySnapshot)]
    );
    await conn.query(
      `INSERT INTO course_order_discounts
        (owner_user_id, order_id, payment_instrument_id, discount_type,
         amount, currency, status, discount_snapshot_json, row_version)
       VALUES (?, ?, ?, 'trial_discount', ?, ?, 'reserved', ?, 1)`,
      [ownerUserId, orderId, instrumentInsert.insertId, amountApplied,
        normalizedCurrency, JSON.stringify(policySnapshot)]
    );
    const [ticketUpdate] = await conn.query(
      'UPDATE course_tickets SET row_version = row_version + 1 WHERE id = ? AND row_version = ?',
      [ticket.id, expectedTicketRowVersion]
    );
    if (!ticketUpdate.affectedRows) {
      throw courseTermError('COURSE_ROW_VERSION_CONFLICT', '付款課程券已變更，請重新載入', 412);
    }
    return {
      instrumentId: Number(instrumentInsert.insertId),
      ticketId: Number(ticket.id),
      holdId: Number(holdInsert.insertId),
      amountApplied,
      payableAmount: money(Number(originalAmount) - amountApplied, 0),
      ticketRowVersion: Number(expectedTicketRowVersion) + 1,
    };
  }

  async function checkout({
    quoteCode,
    userId,
    paymentMethod,
    idempotencyKey,
    expectedQuoteRowVersion,
    termsAccepted = false,
    courseTicketId = null,
    trialTicketId = null,
    expectedTicketRowVersion = null,
  }) {
    await assertSchema({ requirePayments: true });
    const key = assertIdempotencyKey(idempotencyKey);
    const normalizedMethod = normalizePaymentMethod(paymentMethod);
    if (!termsAccepted) throw courseTermError('COURSE_TERMS_REQUIRED', '請先閱讀並同意固定班規則', 400);
    if (courseTicketId && trialTicketId) {
      throw courseTermError('COURSE_PAYMENT_INSTRUMENT_CONFLICT', '課程券支付與體驗折抵不可同時使用', 409);
    }
    if (normalizedMethod === 'COURSE_TICKET' && !courseTicketId) {
      throw courseTermError('COURSE_PAYMENT_TICKET_REQUIRED', '請選擇可支付本班期的課程券', 400);
    }
    if (courseTicketId && normalizedMethod !== 'COURSE_TICKET') {
      throw courseTermError('COURSE_PAYMENT_METHOD_MISMATCH', '課程券只能用於全額課程券支付', 409);
    }
    if ((courseTicketId || trialTicketId) && !positiveInteger(expectedTicketRowVersion)) {
      throw courseTermError('COURSE_ROW_VERSION_REQUIRED', '使用付款票券需要票券 If-Match', 428);
    }
    if (trialTicketId && normalizedMethod !== 'BANK_TRANSFER') {
      throw courseTermError('COURSE_TRIAL_DISCOUNT_PAYMENT_INVALID', '體驗折抵僅能搭配匯款支付剩餘金額', 409);
    }
    return withTransaction(async (conn) => {
      const [quoteRows] = await conn.query(
        `SELECT q.*, t.name AS term_name, t.capacity, t.status AS term_status,
                t.row_version AS term_row_version
           FROM course_term_quotes q
           JOIN course_terms t ON t.id = q.term_id
          WHERE q.quote_code = ? AND q.user_id = ? LIMIT 1 FOR UPDATE`,
        [text(quoteCode, 64), userId]
      );
      const quote = quoteRows[0];
      if (!quote) throw courseTermError('COURSE_TERM_QUOTE_NOT_FOUND', '找不到固定班報價', 404);
      const checkoutRequestHash = requestHash({
        quoteId: Number(quote.id),
        userId,
        paymentMethod: normalizedMethod,
        courseTicketId: courseTicketId ? Number(courseTicketId) : null,
        trialTicketId: trialTicketId ? Number(trialTicketId) : null,
        termsAccepted: Boolean(termsAccepted),
      });
      if (String(quote.status).toUpperCase() === 'CONSUMED') {
        const [enrollments] = await conn.query(
          `SELECT e.*, o.code AS order_code, o.pay_by_at, o.payment_method,
                  o.payment_status, o.total_amount, o.currency,
                  COALESCE((SELECT SUM(d.amount) FROM course_order_discounts d
                             WHERE d.order_id = o.id AND d.status IN ('reserved','applied')), 0) AS discount_amount
             FROM course_term_enrollments e
             LEFT JOIN course_orders o ON o.id = e.order_id
            WHERE e.quote_id = ? LIMIT 1`,
          [quote.id]
        );
        if (enrollments[0]) {
          const snapshot = parseJson(enrollments[0].rules_snapshot_json, {});
          if (snapshot.checkoutRequestHash && snapshot.checkoutRequestHash !== checkoutRequestHash) {
            throw courseTermError('IDEMPOTENCY_KEY_REUSED', '固定班報價已由不同付款內容使用', 409);
          }
          return enrollmentCheckoutPayload(enrollments[0]);
        }
      }
      ensureRowVersion(quote.row_version, expectedQuoteRowVersion, '固定班報價');
      if (String(quote.status).toUpperCase() !== 'OPEN' || dateMs(quote.expires_at) < Date.now()) {
        throw courseTermError('COURSE_TERM_QUOTE_EXPIRED', '固定班報價已過期，請重新報價', 409);
      }
      const [replayRows] = await conn.query(
          `SELECT e.*, o.code AS order_code, o.pay_by_at, o.payment_method,
                  o.payment_status, o.total_amount, o.currency,
                COALESCE((SELECT SUM(d.amount) FROM course_order_discounts d
                           WHERE d.order_id = o.id AND d.status IN ('reserved','applied')), 0) AS discount_amount
           FROM course_term_enrollments e
           LEFT JOIN course_orders o ON o.id = e.order_id
          WHERE e.user_id = ? AND e.checkout_idempotency_key = ? LIMIT 1 FOR UPDATE`,
        [userId, key]
      );
      if (replayRows[0]) {
        const snapshot = parseJson(replayRows[0].rules_snapshot_json, {});
        if (snapshot.checkoutRequestHash && snapshot.checkoutRequestHash !== checkoutRequestHash) {
          throw courseTermError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key 已用於不同固定班結帳內容', 409);
        }
        return enrollmentCheckoutPayload(replayRows[0]);
      }
      await assertProviderRuntime(conn, quote.owner_user_id, { requirePayments: true, forUpdate: true });
      const [offeredRows] = await conn.query(
        `SELECT a.* FROM course_seat_allocations a
          WHERE a.term_id = ? AND a.student_id = ? AND a.user_id = ?
            AND a.allocation_type = 'WAITLIST_OFFER' AND a.status = 'HELD'
            AND a.expires_at > NOW()
          ORDER BY a.id LIMIT 1 FOR UPDATE`,
        [quote.term_id, quote.student_id, userId]
      );
      const offeredAllocation = offeredRows[0] || null;
      const allocated = await countTermAllocations(conn, quote.term_id, { forUpdate: true });
      if (!offeredAllocation && termCapacity({ capacity: quote.capacity, activeAllocations: allocated }).full) {
        throw courseTermError('COURSE_TERM_CAPACITY_FULL', '固定班名額已滿，可加入候補', 409);
      }
      const settings = await getProviderSettings(conn, quote.owner_user_id, { forUpdate: true });
      const holdHours = positiveInteger(settings.bank_transfer_hold_hours, 24);
      let payByAt = normalizedMethod === 'BANK_TRANSFER'
        ? bankTransferDeadline({ hours: holdHours })
        : null;
      let effectivePaymentMethod = normalizedMethod;
      const orderCode = randomCode('CO', 6);
      const pricing = parseJson(quote.pricing_snapshot_json, {});
      const [userRows] = await conn.query(
        'SELECT username, email, phone FROM users WHERE id = ? LIMIT 1 FOR UPDATE',
        [userId]
      );
      const buyer = userRows[0] || {};
      const [orderInsert] = await conn.query(
        `INSERT INTO course_orders
          (code, owner_user_id, user_id, student_id,
           buyer_name, buyer_email, buyer_phone, product_id, term_id,
           quantity, unit_price, total_amount, currency, status, payment_status,
           fulfillment_status, order_purpose, payment_method, pay_by_at,
           terms_accepted_at, row_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, ?, ?, 'pending',
                 'pending', 'pending', 'TERM_ENROLLMENT', ?, ?, NOW(), 1)`,
        [
          orderCode,
          quote.owner_user_id,
          userId,
          quote.student_id,
          text(buyer.username || buyer.email, 255),
          text(buyer.email, 255),
          text(buyer.phone, 20) || null,
          quote.term_id,
          Number(quote.total_amount),
          Number(quote.total_amount),
          pricing.currency || quote.currency || 'TWD',
          normalizedMethod,
          payByAt,
        ]
      );
      const orderId = Number(orderInsert.insertId);
      const enrollmentCode = randomCode('ENR', 6);
      const enrollmentRulesSnapshot = {
        ...parseJson(quote.rules_snapshot_json, {}),
        checkoutRequestHash,
        paymentMethod: normalizedMethod,
        courseTicketId: courseTicketId ? Number(courseTicketId) : null,
        trialTicketId: trialTicketId ? Number(trialTicketId) : null,
      };
      const [enrollmentInsert] = await conn.query(
        `INSERT INTO course_term_enrollments
          (enrollment_code, owner_user_id, term_id, student_id, user_id,
           order_id, quote_id, start_session_id, status,
           quote_snapshot_json, rules_snapshot_json,
           checkout_idempotency_key, row_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_PAYMENT', ?, ?, ?, 1)`,
        [
          enrollmentCode,
          quote.owner_user_id,
          quote.term_id,
          quote.student_id,
          userId,
          orderId,
          quote.id,
          pricing.startSessionId || null,
          quote.pricing_snapshot_json,
          JSON.stringify(enrollmentRulesSnapshot),
          key,
        ]
      );
      const enrollmentId = Number(enrollmentInsert.insertId);
      let allocationId;
      if (offeredAllocation) {
        await conn.query(
          `UPDATE course_seat_allocations
              SET enrollment_id = ?, order_id = ?, quote_id = ?,
                  allocation_type = 'CHECKOUT_HOLD', expires_at = ?,
                  row_version = row_version + 1
            WHERE id = ? AND status = 'HELD' AND allocation_type = 'WAITLIST_OFFER'`,
          [enrollmentId, orderId, quote.id, payByAt, offeredAllocation.id]
        );
        allocationId = Number(offeredAllocation.id);
        await conn.query(
          `UPDATE course_term_seat_offers SET status = 'ACCEPTED', accepted_at = NOW(),
                  row_version = row_version + 1
            WHERE seat_allocation_id = ? AND status = 'OFFERED'`,
          [offeredAllocation.id]
        );
        await conn.query(
          `UPDATE course_term_waitlist_entries SET status = 'ACCEPTED',
                  row_version = row_version + 1
            WHERE id = ? AND status = 'OFFERED'`,
          [offeredAllocation.waitlist_entry_id]
        );
      } else {
        const [allocationInsert] = await conn.query(
          `INSERT INTO course_seat_allocations
            (owner_user_id, term_id, student_id, enrollment_id, order_id,
             quote_id, user_id,
             allocation_type, status, expires_at, row_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'CHECKOUT_HOLD', 'HELD', ?, 1)`,
          [quote.owner_user_id, quote.term_id, quote.student_id, enrollmentId, orderId, quote.id, userId, payByAt]
        );
        allocationId = Number(allocationInsert.insertId);
      }
      let trialDiscount = null;
      if (trialTicketId) {
        trialDiscount = await reserveTrialDiscount(conn, {
          ticketId: trialTicketId,
          orderId,
          enrollmentId,
          userId,
          ownerUserId: quote.owner_user_id,
          originalAmount: Number(quote.total_amount),
          currency: pricing.currency || quote.currency || 'TWD',
          idempotencyKey: key,
          expectedTicketRowVersion,
        });
        if (trialDiscount.payableAmount <= 0) {
          effectivePaymentMethod = 'NONE';
          payByAt = null;
        }
        await conn.query(
          `UPDATE course_orders SET total_amount = ?, payment_method = ?, pay_by_at = ?
            WHERE id = ?`,
          [trialDiscount.payableAmount, effectivePaymentMethod, payByAt, orderId]
        );
        await conn.query(
          'UPDATE course_seat_allocations SET expires_at = ? WHERE id = ?',
          [payByAt, allocationId]
        );
      }
      let courseTicketPayment = null;
      if (normalizedMethod === 'COURSE_TICKET') {
        if (!courseTicketId) throw courseTermError('COURSE_PAYMENT_TICKET_REQUIRED', '請選擇可支付本班期的課程券', 400);
        courseTicketPayment = await consumePaymentTicket(conn, {
          ticketId: courseTicketId,
          orderId,
          enrollmentId,
          userId,
          ownerUserId: quote.owner_user_id,
          amount: Number(quote.total_amount),
          currency: pricing.currency || quote.currency || 'TWD',
          idempotencyKey: key,
          expectedTicketRowVersion,
        });
      }
      await conn.query(
        `UPDATE course_term_quotes SET status = 'CONSUMED', consumed_at = NOW(),
                row_version = row_version + 1
          WHERE id = ? AND status = 'OPEN' AND row_version = ?`,
        [quote.id, expectedQuoteRowVersion]
      );
      await conn.query(
        `INSERT INTO order_lifecycle_events
          (domain, order_id, actor_user_id, action,
           to_payment_status, to_fulfillment_status, idempotency_key, metadata)
         VALUES ('course', ?, ?, 'term-checkout', 'pending', 'pending', ?, ?)`,
        [orderId, userId, key, JSON.stringify({ termId: quote.term_id, enrollmentId })]
      );
      await enqueueOutbox(conn, {
        ownerUserId: quote.owner_user_id,
        userId,
        eventType: 'TERM_ORDER_CREATED',
        dedupeKey: `term-order-created:${orderId}`,
        payload: {
          orderId, orderCode, enrollmentId, enrollmentCode, payByAt,
          originalAmount: Number(quote.total_amount),
          discountAmount: trialDiscount?.amountApplied || 0,
        },
      });
      if (normalizedMethod === 'COURSE_TICKET' || effectivePaymentMethod === 'NONE') {
        await activatePaidEnrollment(conn, {
          orderId,
          enrollmentId,
          allocationId,
          actorUserId: userId,
          idempotencyKey: key,
        });
      }
      return {
        orderId,
        orderCode,
        enrollmentId,
        enrollmentCode,
        paymentMethod: effectivePaymentMethod,
        paymentStatus: (normalizedMethod === 'COURSE_TICKET' || effectivePaymentMethod === 'NONE') ? 'paid' : 'pending',
        enrollmentStatus: (normalizedMethod === 'COURSE_TICKET' || effectivePaymentMethod === 'NONE') ? 'CONFIRMED' : 'PENDING_PAYMENT',
        originalAmount: Number(quote.total_amount),
        discountAmount: trialDiscount?.amountApplied || 0,
        payableAmount: trialDiscount?.payableAmount ?? Number(quote.total_amount),
        paymentTicketRowVersion: trialDiscount?.ticketRowVersion
          || courseTicketPayment?.ticketRowVersion
          || null,
        payByAt,
        rowVersion: (normalizedMethod === 'COURSE_TICKET' || effectivePaymentMethod === 'NONE') ? 2 : 1,
      };
    });
  }

  function enrollmentCheckoutPayload(row = {}) {
    return {
      orderId: Number(row.order_id),
      orderCode: row.order_code,
      enrollmentId: Number(row.id),
      enrollmentCode: row.enrollment_code,
      enrollmentStatus: row.status,
      paymentMethod: row.payment_method,
      paymentStatus: row.payment_status,
      payableAmount: row.total_amount == null ? null : Number(row.total_amount),
      discountAmount: Number(row.discount_amount || 0),
      currency: row.currency || 'TWD',
      payByAt: row.pay_by_at,
      rowVersion: Number(row.row_version || 1),
      replay: true,
    };
  }

  async function consumePaymentTicket(conn, {
    ticketId,
    orderId,
    enrollmentId,
    userId,
    ownerUserId,
    amount,
    currency = 'TWD',
    idempotencyKey,
    expectedTicketRowVersion,
  }) {
    const ticket = await loadPaymentTicket(conn, {
      ticketId, userId, ownerUserId, forUpdate: true,
    });
    const usability = assertPaymentTicketUsable(ticket, { expectedRowVersion: expectedTicketRowVersion });
    if (Number(ticket.term_payment_allowed) !== 1) {
      throw courseTermError('COURSE_PAYMENT_TICKET_NOT_ELIGIBLE', '此課程券未被設定為固定班付款工具', 409);
    }
    if (String(ticket.product_type).toLowerCase() === 'trial_discount') {
      throw courseTermError('COURSE_PAYMENT_TICKET_NOT_ELIGIBLE', '體驗折抵券不可作全額課程券支付', 409);
    }
    const useQuantity = usability.unlimited ? 0 : 1;
    const [allocation] = await conn.query(
      `INSERT INTO course_order_payment_instruments
        (owner_user_id, order_id, enrollment_id, instrument_type,
         course_ticket_id, amount_applied, units_applied, currency, status,
         idempotency_key, policy_snapshot_json, row_version)
       VALUES (?, ?, ?, 'COURSE_TICKET', ?, ?, ?, ?, 'CONSUMED', ?, ?, 1)`,
      [
        ownerUserId,
        orderId,
        enrollmentId,
        ticket.id,
        amount,
        useQuantity,
        text(currency, 3).toUpperCase() || 'TWD',
        idempotencyKey,
        JSON.stringify({ scenarioItemType: 'term', ticketProductId: Number(ticket.ticket_product_id) }),
      ]
    );
    if (useQuantity) {
      const balanceAfter = Number(ticket.ledger_balance) - useQuantity;
      await conn.query(
        `INSERT INTO course_usage_events
          (ticket_id, student_id, user_id, event_type, delta_uses,
           balance_after, source_type, source_id, occurred_at,
           actor_user_id, note, metadata_json, usage_method, quantity_snapshot)
         VALUES (?, ?, ?, 'ADJUSTMENT', ?, ?, 'course_order_payment_instrument',
                 ?, NOW(), ?, '固定班課程券支付', ?, 'course_payment', ?)`,
        [ticket.id, ticket.student_id, userId, -useQuantity, balanceAfter, allocation.insertId, userId, JSON.stringify({ orderId }), useQuantity]
      );
      const [usageRows] = await conn.query(
        `SELECT id FROM course_usage_events
          WHERE source_type = 'course_order_payment_instrument'
            AND source_id = ? AND event_type = 'ADJUSTMENT' LIMIT 1`,
        [String(allocation.insertId)]
      );
      await conn.query(
        `UPDATE course_order_payment_instruments
            SET usage_event_id = ? WHERE id = ?`,
        [usageRows[0]?.id || null, allocation.insertId]
      );
      const [ticketUpdate] = await conn.query(
        `UPDATE course_tickets
            SET remaining_uses = ?, remaining_uses_cache = ?,
                status = CASE WHEN ? <= 0 AND status IN ('pending','active') THEN 'exhausted' ELSE status END,
                row_version = row_version + 1
          WHERE id = ? AND row_version = ?`,
        [balanceAfter, balanceAfter, balanceAfter, ticket.id, expectedTicketRowVersion]
      );
      if (!ticketUpdate.affectedRows) {
        throw courseTermError('COURSE_ROW_VERSION_CONFLICT', '付款課程券已變更，請重新載入', 412);
      }
    } else {
      const [ticketUpdate] = await conn.query(
        'UPDATE course_tickets SET row_version = row_version + 1 WHERE id = ? AND row_version = ?',
        [ticket.id, expectedTicketRowVersion]
      );
      if (!ticketUpdate.affectedRows) {
        throw courseTermError('COURSE_ROW_VERSION_CONFLICT', '付款課程券已變更，請重新載入', 412);
      }
    }
    return {
      instrumentId: Number(allocation.insertId),
      ticketId: Number(ticket.id),
      unitsApplied: useQuantity,
      amountApplied: Number(amount),
      ticketRowVersion: Number(expectedTicketRowVersion) + 1,
    };
  }

  async function consumeReservedTrialDiscount(conn, {
    orderId,
    actorUserId,
    idempotencyKey,
  }) {
    const [rows] = await conn.query(
      `SELECT instrument.*, h.status AS hold_status, h.quantity AS hold_quantity,
              t.row_version AS ticket_row_version,
              COALESCE((SELECT SUM(ev.delta_uses) FROM course_usage_events ev
                         WHERE ev.ticket_id = instrument.course_ticket_id), 0) AS ledger_balance
         FROM course_order_payment_instruments instrument
         JOIN course_ticket_holds h ON h.id = instrument.hold_id
         JOIN course_tickets t ON t.id = instrument.course_ticket_id
        WHERE instrument.order_id = ? AND instrument.instrument_type = 'TRIAL_DISCOUNT'
        LIMIT 1 FOR UPDATE`,
      [orderId]
    );
    const instrument = rows[0];
    if (!instrument) return null;
    if (instrument.status === 'CONSUMED') return instrument;
    if (instrument.status !== 'RESERVED' || instrument.hold_status !== 'active') {
      throw courseTermError('COURSE_TRIAL_DISCOUNT_STATE_CONFLICT', '體驗折抵保留狀態已變更', 409);
    }
    const units = Math.max(1, Number(instrument.units_applied || instrument.hold_quantity || 1));
    const balanceAfter = Number(instrument.ledger_balance || 0) - units;
    if (balanceAfter < 0) {
      throw courseTermError('COURSE_PAYMENT_TICKET_BALANCE_LOW', '體驗折抵券可用堂數不足', 409);
    }
    const eventKey = `${idempotencyKey}:trial:${instrument.id}`.slice(0, 191);
    const [eventInsert] = await conn.query(
      `INSERT INTO course_usage_events
        (ticket_id, student_id, user_id, event_type, usage_method,
         delta_uses, quantity_snapshot, balance_after, source_type, source_id,
         occurred_at, idempotency_key, actor_user_id, note, metadata_json)
       SELECT t.id, t.student_id, t.user_id, 'ADJUSTMENT', 'course_payment',
              ?, ?, ?, 'course_order_payment_instrument', ?, NOW(), ?, ?,
              '固定班體驗折抵', ?
         FROM course_tickets t WHERE t.id = ?`,
      [
        -units,
        units,
        balanceAfter,
        String(instrument.id),
        eventKey,
        actorUserId,
        JSON.stringify({ orderId: Number(orderId), instrumentType: 'TRIAL_DISCOUNT' }),
        instrument.course_ticket_id,
      ]
    );
    await conn.query(
      `UPDATE course_ticket_holds
          SET status = 'consumed', consumed_at = NOW(), consumed_usage_event_id = ?,
              row_version = row_version + 1
        WHERE id = ? AND status = 'active'`,
      [eventInsert.insertId, instrument.hold_id]
    );
    await conn.query(
      `UPDATE course_order_payment_instruments
          SET status = 'CONSUMED', usage_event_id = ?, row_version = row_version + 1
        WHERE id = ? AND status = 'RESERVED'`,
      [eventInsert.insertId, instrument.id]
    );
    await conn.query(
      `UPDATE course_order_discounts SET status = 'applied', row_version = row_version + 1
        WHERE payment_instrument_id = ? AND status = 'reserved'`,
      [instrument.id]
    );
    await conn.query(
      `UPDATE course_tickets
          SET remaining_uses = ?, remaining_uses_cache = ?,
              status = CASE WHEN ? <= 0 AND status IN ('pending','active') THEN 'exhausted' ELSE status END,
              row_version = row_version + 1
        WHERE id = ? AND row_version = ?`,
      [balanceAfter, balanceAfter, balanceAfter, instrument.course_ticket_id, instrument.ticket_row_version]
    );
    return { ...instrument, status: 'CONSUMED', usage_event_id: Number(eventInsert.insertId) };
  }

  async function releaseReservedPaymentInstruments(conn, {
    orderId,
    actorUserId = null,
    reason = 'order_cancelled',
  }) {
    const [rows] = await conn.query(
      `SELECT instrument.id, instrument.hold_id, instrument.course_ticket_id,
              instrument.instrument_type
         FROM course_order_payment_instruments instrument
        WHERE instrument.order_id = ? AND instrument.status = 'RESERVED'
        FOR UPDATE`,
      [orderId]
    );
    for (const instrument of rows) {
      if (instrument.hold_id) {
        await conn.query(
          `UPDATE course_ticket_holds
              SET status = 'released', released_at = NOW(), release_reason = ?,
                  released_by_user_id = ?, row_version = row_version + 1
            WHERE id = ? AND status = 'active'`,
          [text(reason, 64), actorUserId, instrument.hold_id]
        );
      }
      await conn.query(
        `UPDATE course_order_payment_instruments
            SET status = 'RELEASED', row_version = row_version + 1
          WHERE id = ? AND status = 'RESERVED'`,
        [instrument.id]
      );
      await conn.query(
        `UPDATE course_order_discounts SET status = 'released', row_version = row_version + 1
          WHERE payment_instrument_id = ? AND status = 'reserved'`,
        [instrument.id]
      );
      await conn.query(
        'UPDATE course_tickets SET row_version = row_version + 1 WHERE id = ?',
        [instrument.course_ticket_id]
      );
    }
    return rows.length;
  }

  async function ensureTermRosterProjections(conn, enrollment, sessionIds) {
    const [studentRows] = await conn.query(
      `SELECT id, display_name, email
         FROM course_students
        WHERE id = ? AND owner_user_id <=> ? LIMIT 1 FOR UPDATE`,
      [enrollment.student_id, enrollment.owner_user_id]
    );
    const student = studentRows[0];
    if (!student) throw courseTermError('COURSE_STUDENT_NOT_FOUND', '找不到固定班學員', 404);
    for (const sessionId of sessionIds) {
      const [entitlementInsert] = await conn.query(
        `INSERT INTO course_term_session_entitlements
          (owner_user_id, enrollment_id, session_id, student_id, user_id,
           status, entitlement_kind, row_version)
         VALUES (?, ?, ?, ?, ?, 'SCHEDULED', 'REGULAR', 1)
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
        [enrollment.owner_user_id, enrollment.id, sessionId, enrollment.student_id, enrollment.user_id]
      );
      const entitlementId = Number(entitlementInsert.insertId);
      const [bookingRows] = await conn.query(
        `SELECT id, origin FROM course_bookings
          WHERE session_id = ? AND student_id = ? LIMIT 1 FOR UPDATE`,
        [sessionId, enrollment.student_id]
      );
      let bookingId = Number(bookingRows[0]?.id || 0);
      if (bookingId && String(bookingRows[0].origin).toUpperCase() !== 'TERM_ROSTER') {
        throw courseTermError(
          'COURSE_TERM_ROSTER_PROJECTION_CONFLICT',
          '此學員在場次已有非固定班預約投影',
          409,
          { sessionId: Number(sessionId), bookingId }
        );
      }
      if (!bookingId) {
        const [bookingInsert] = await conn.query(
          `INSERT INTO course_bookings
            (session_id, ticket_id, user_id, student_id, attendee_name,
             attendee_email, verify_code, status, origin, booked_at, row_version)
           VALUES (?, NULL, ?, ?, ?, ?, ?, 'booked', 'TERM_ROSTER', NOW(), 1)`,
          [
            sessionId,
            enrollment.user_id,
            enrollment.student_id,
            text(student.display_name, 255),
            text(student.email, 255).toLowerCase(),
            randomCode('CBK', 10),
          ]
        );
        bookingId = Number(bookingInsert.insertId);
      }
      const [link] = await conn.query(
        `UPDATE course_term_session_entitlements
            SET booking_id = ?, row_version = row_version + IF(booking_id IS NULL, 1, 0)
          WHERE id = ? AND (booking_id IS NULL OR booking_id = ?)`,
        [bookingId, entitlementId, bookingId]
      );
      if (!link.affectedRows) {
        throw courseTermError('COURSE_TERM_ROSTER_PROJECTION_CONFLICT', '逐堂權益已連結其他預約', 409);
      }
    }
  }

  async function activatePaidEnrollment(conn, {
    orderId,
    enrollmentId = null,
    allocationId = null,
    actorUserId,
    idempotencyKey,
  }) {
    const [rows] = await conn.query(
      `SELECT e.*, o.payment_status, o.fulfillment_status
         FROM course_term_enrollments e
         JOIN course_orders o ON o.id = e.order_id
        WHERE e.order_id = ? ${enrollmentId ? 'AND e.id = ?' : ''}
        LIMIT 1 FOR UPDATE`,
      [orderId, ...(enrollmentId ? [enrollmentId] : [])]
    );
    const enrollment = rows[0];
    if (!enrollment) throw courseTermError('COURSE_TERM_ENROLLMENT_NOT_FOUND', '找不到固定班報名', 404);
    const sessionIds = parseJson(enrollment.quote_snapshot_json, {}).sessionIds || [];
    if (!sessionIds.length) throw courseTermError('COURSE_TERM_QUOTE_INVALID', '固定班報價缺少逐堂權益', 409);
    await ensureTermRosterProjections(conn, enrollment, sessionIds);
    if (enrollment.status === 'CONFIRMED') return enrollment;
    await consumeReservedTrialDiscount(conn, { orderId, actorUserId, idempotencyKey });
    await conn.query(
      `UPDATE course_term_enrollments SET status = 'CONFIRMED', enrolled_at = NOW(),
              row_version = row_version + 1
        WHERE id = ? AND status = 'PENDING_PAYMENT'`,
      [enrollment.id]
    );
    await conn.query(
      `UPDATE course_seat_allocations
          SET allocation_type = 'ENROLLMENT', status = 'ACTIVE', expires_at = NULL,
              row_version = row_version + 1
        WHERE ${allocationId ? 'id = ?' : 'enrollment_id = ?'} AND status = 'HELD'`,
      [allocationId || enrollment.id]
    );
    await conn.query(
      `UPDATE course_orders SET payment_status = 'paid', fulfillment_status = 'fulfilled',
              status = 'issued', row_version = row_version + 1
        WHERE id = ?`,
      [orderId]
    );
    await conn.query(
      `INSERT INTO order_lifecycle_events
        (domain, order_id, actor_user_id, action,
         to_payment_status, to_fulfillment_status, idempotency_key, metadata)
       VALUES ('course', ?, ?, 'term-fulfill', 'paid', 'fulfilled', ?, ?)`,
      [orderId, actorUserId, idempotencyKey, JSON.stringify({ enrollmentId: enrollment.id })]
    );
    await enqueueOutbox(conn, {
      ownerUserId: enrollment.owner_user_id,
      userId: enrollment.user_id,
      eventType: 'TERM_ENROLLMENT_CONFIRMED',
      dedupeKey: `term-enrollment-confirmed:${enrollment.id}`,
      payload: { orderId, enrollmentId: enrollment.id, sessionIds },
    });
    return { ...enrollment, status: 'CONFIRMED' };
  }

  async function fulfillOrder(conn, { order, actorUserId, idempotencyKey }) {
    const purpose = String(order?.order_purpose || '').toUpperCase();
    let fulfilled = null;
    if (purpose === 'TERM_ENROLLMENT') {
      fulfilled = await activatePaidEnrollment(conn, {
        orderId: order.id,
        actorUserId,
        idempotencyKey,
      });
    } else if (purpose === 'MAKEUP_INSURANCE') {
      fulfilled = await activateMakeupInsurance(conn, {
        orderId: order.id,
        actorUserId,
        idempotencyKey,
      });
    } else {
      return null;
    }
    await conn.query(
      `UPDATE course_payment_submissions
          SET status = 'CONFIRMED', reviewed_by = ?, reviewed_at = NOW(),
              reason = NULL, row_version = row_version + 1
        WHERE order_id = ? AND status IN ('SUBMITTED','REVIEWING')`,
      [actorUserId, order.id]
    );
    return fulfilled;
  }

  async function submitBankTransfer({
    orderId,
    userId,
    last5,
    idempotencyKey,
    expectedOrderRowVersion,
  }) {
    await assertSchema({ requirePayments: true });
    const key = assertIdempotencyKey(idempotencyKey);
    const normalizedLast5 = text(last5, 5);
    if (!/^\d{5}$/.test(normalizedLast5)) {
      throw courseTermError('COURSE_PAYMENT_LAST5_INVALID', '匯款帳號後五碼需為 5 位數字', 400);
    }
    return withTransaction(async (conn) => {
      const [rows] = await conn.query(
        `SELECT * FROM course_orders
          WHERE id = ? AND user_id = ?
            AND order_purpose IN ('TERM_ENROLLMENT','MAKEUP_INSURANCE')
          LIMIT 1 FOR UPDATE`,
        [positiveInteger(orderId), userId]
      );
      const order = rows[0];
      if (!order) throw courseTermError('COURSE_ORDER_NOT_FOUND', '找不到固定班訂單', 404);
      const hash = requestHash({ orderId: Number(order.id), last5: normalizedLast5 });
      const [existing] = await conn.query(
        `SELECT * FROM course_payment_submissions
          WHERE user_id = ? AND idempotency_key = ? LIMIT 1 FOR UPDATE`,
        [userId, key]
      );
      if (existing[0]) {
        if (existing[0].request_hash !== hash) throw courseTermError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key 已用於不同匯款資料', 409);
        const paymentStatus = String(order.payment_status || '').toLowerCase() === 'payment_review'
          ? 'reviewing'
          : String(order.payment_status || 'reviewing').toLowerCase();
        return {
          orderId: Number(order.id),
          submissionId: Number(existing[0].id),
          paymentStatus,
          rowVersion: Number(order.row_version),
          replay: true,
        };
      }
      ensureRowVersion(order.row_version, expectedOrderRowVersion, '課程訂單');
      if (String(order.payment_method).toUpperCase() !== 'BANK_TRANSFER') {
        throw courseTermError('COURSE_PAYMENT_METHOD_MISMATCH', '此訂單不是匯款付款', 409);
      }
      if (String(order.payment_status).toLowerCase() === 'paid') {
        return { orderId: Number(order.id), paymentStatus: 'paid', rowVersion: Number(order.row_version), replay: true };
      }
      if (dateMs(order.pay_by_at) < Date.now()) {
        throw courseTermError('COURSE_PAYMENT_DEADLINE_EXPIRED', '匯款資料提交期限已過，席位已不保留', 409);
      }
      const [insert] = await conn.query(
        `INSERT INTO course_payment_submissions
          (owner_user_id, order_id, user_id, last5, status,
           idempotency_key, request_hash, submitted_at, row_version)
         VALUES (?, ?, ?, ?, 'REVIEWING', ?, ?, NOW(), 1)`,
        [order.owner_user_id, order.id, userId, normalizedLast5, key, hash]
      );
      const [update] = await conn.query(
        `UPDATE course_orders SET remittance_last5 = ?, payment_status = 'reviewing',
                status = 'payment_review', row_version = row_version + 1
          WHERE id = ? AND row_version = ? AND payment_status = 'pending'`,
        [normalizedLast5, order.id, expectedOrderRowVersion]
      );
      if (!update.affectedRows) throw courseTermError('COURSE_ORDER_STATE_CONFLICT', '訂單付款狀態已變更', 409);
      await conn.query(
        `UPDATE course_seat_allocations SET expires_at = NULL,
                row_version = row_version + 1
          WHERE order_id = ? AND status = 'HELD'`,
        [order.id]
      );
      if (String(order.order_purpose).toUpperCase() === 'MAKEUP_INSURANCE') {
        await conn.query(
          `UPDATE course_makeup_insurance_coverages
              SET status = 'reviewing', row_version = row_version + 1
            WHERE order_id = ? AND status = 'pending_payment'`,
          [order.id]
        );
      }
      await conn.query(
        `INSERT INTO order_lifecycle_events
          (domain, order_id, actor_user_id, action, from_payment_status,
           to_payment_status, idempotency_key, metadata)
         VALUES ('course', ?, ?, 'submit-bank-transfer', 'pending', 'reviewing', ?, ?)`,
        [order.id, userId, key, JSON.stringify({ submissionId: insert.insertId })]
      );
      await enqueueOutbox(conn, {
        ownerUserId: order.owner_user_id,
        userId,
        eventType: 'TERM_PAYMENT_SUBMITTED',
        dedupeKey: `term-payment-submitted:${insert.insertId}`,
        payload: {
          orderId: Number(order.id), submissionId: Number(insert.insertId),
          orderPurpose: order.order_purpose,
        },
      });
      return {
        orderId: Number(order.id),
        submissionId: Number(insert.insertId),
        paymentStatus: 'reviewing',
        rowVersion: expectedOrderRowVersion + 1,
      };
    });
  }

  async function listMemberEnrollments({ userId }) {
    await assertSchema();
    const [rows] = await pool.query(
      `SELECT e.*, t.code AS term_code, t.name AS term_name,
              t.starts_on, t.ends_on, p.name AS program_name,
              o.code AS order_code, o.payment_status, o.pay_by_at,
              (SELECT COUNT(*) FROM course_term_session_entitlements se
                WHERE se.enrollment_id = e.id) AS entitlement_count,
              (SELECT COUNT(*) FROM course_term_session_entitlements se
                WHERE se.enrollment_id = e.id AND se.status = 'ATTENDED') AS attended_count
         FROM course_term_enrollments e
         JOIN course_terms t ON t.id = e.term_id
         JOIN course_programs p ON p.id = t.program_id
         LEFT JOIN course_orders o ON o.id = e.order_id
        WHERE e.user_id = ? ORDER BY t.starts_on DESC, e.id DESC`,
      [userId]
    );
    return rows.map((row) => ({
      id: Number(row.id),
      code: row.enrollment_code,
      termId: Number(row.term_id),
      termCode: row.term_code,
      termName: row.term_name,
      programName: row.program_name,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      status: row.status,
      orderId: row.order_id == null ? null : Number(row.order_id),
      orderCode: row.order_code || null,
      paymentStatus: row.payment_status || null,
      payByAt: row.pay_by_at || null,
      entitlementCount: Number(row.entitlement_count || 0),
      attendedCount: Number(row.attended_count || 0),
      rowVersion: Number(row.row_version || 1),
    }));
  }

  async function getMemberSchedule({ userId }) {
    await assertSchema();
    const [rows] = await pool.query(
      `SELECT se.*, s.code AS session_code, s.title, s.location, s.city,
              s.starts_at, s.ends_at, e.enrollment_code, t.name AS term_name,
              leave_request.id AS leave_id,
              leave_request.row_version AS leave_row_version,
              leave_request.status AS leave_status,
              leave_request.cancel_close_at AS leave_cancel_close_at
         FROM course_term_session_entitlements se
         JOIN course_term_enrollments e ON e.id = se.enrollment_id
         JOIN course_terms t ON t.id = e.term_id
         JOIN course_sessions s ON s.id = se.session_id
         LEFT JOIN course_term_leave_requests leave_request
           ON leave_request.id = se.leave_request_id
        WHERE se.user_id = ? ORDER BY s.starts_at, se.id`,
      [userId]
    );
    return rows.map((row) => ({
      id: Number(row.id),
      enrollmentId: Number(row.enrollment_id),
      enrollmentCode: row.enrollment_code,
      termName: row.term_name,
      sessionId: Number(row.session_id),
      sessionCode: row.session_code,
      title: row.title,
      location: row.location || '',
      city: row.city || '',
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      status: row.status,
      entitlementKind: row.entitlement_kind,
      bookingId: row.booking_id == null ? null : Number(row.booking_id),
      leaveId: row.leave_id == null ? null : Number(row.leave_id),
      leaveRowVersion: row.leave_row_version == null ? null : Number(row.leave_row_version),
      leaveStatus: row.leave_status || null,
      leaveCancelCloseAt: row.leave_cancel_close_at || null,
      rowVersion: Number(row.row_version || 1),
    }));
  }

  async function markNotificationRead({
    notificationId,
    userId,
    idempotencyKey,
    expectedRowVersion,
  }) {
    await assertSchema({ requirePayments: true });
    return withTransaction(async (conn) => {
      const [rows] = await conn.query(
        `SELECT id, owner_user_id, row_version, read_at
           FROM course_user_notifications
          WHERE id = ? AND user_id = ? LIMIT 1 FOR UPDATE`,
        [positiveInteger(notificationId), userId]
      );
      const notification = rows[0];
      if (!notification) throw courseTermError('COURSE_NOTIFICATION_NOT_FOUND', '找不到課程通知', 404);
      const operation = 'course.notification.read';
      const mutation = await claimMutation(conn, {
        actorUserId: userId,
        operation,
        idempotencyKey,
        payload: { notificationId: Number(notification.id), expectedRowVersion },
        resourceType: 'course_user_notification',
        resourceId: notification.id,
      });
      if (mutation.replay) return mutation.replay;
      ensureRowVersion(notification.row_version, expectedRowVersion, '課程通知');
      const [update] = await conn.query(
        `UPDATE course_user_notifications
            SET read_at = COALESCE(read_at, NOW()), row_version = row_version + 1
          WHERE id = ? AND user_id = ? AND row_version = ?`,
        [notification.id, userId, expectedRowVersion]
      );
      if (!update.affectedRows) throw courseTermError('COURSE_ROW_VERSION_CONFLICT', '課程通知已更新', 412);
      const response = {
        id: Number(notification.id),
        read: true,
        rowVersion: Number(expectedRowVersion) + 1,
      };
      await completeMutation(conn, {
        actorUserId: userId,
        operation,
        mutation,
        response,
        resourceType: 'course_user_notification',
        resourceId: notification.id,
      });
      return response;
    });
  }

  async function requestLeave({
    entitlementId,
    userId,
    reason,
    idempotencyKey,
    expectedRowVersion,
  }) {
    await assertSchema();
    const key = assertIdempotencyKey(idempotencyKey);
    return withTransaction(async (conn) => {
      const [rows] = await conn.query(
        `SELECT se.*, s.starts_at, e.term_id, e.rules_snapshot_json,
                t.leave_quota, t.leave_cutoff_minutes, t.makeup_valid_days
           FROM course_term_session_entitlements se
           JOIN course_term_enrollments e ON e.id = se.enrollment_id
           JOIN course_sessions s ON s.id = se.session_id
           JOIN course_terms t ON t.id = e.term_id
          WHERE se.id = ? AND se.user_id = ? LIMIT 1 FOR UPDATE`,
        [positiveInteger(entitlementId), userId]
      );
      const entitlement = rows[0];
      if (!entitlement) throw courseTermError('COURSE_TERM_ENTITLEMENT_NOT_FOUND', '找不到逐堂權益', 404);
      const [existing] = await conn.query(
        `SELECT * FROM course_term_leave_requests
          WHERE user_id = ? AND idempotency_key = ? LIMIT 1 FOR UPDATE`,
        [userId, key]
      );
      if (existing[0]) {
        if (Number(existing[0].entitlement_id) !== Number(entitlement.id)) {
          throw courseTermError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key 已用於不同請假申請', 409);
        }
        return { leaveId: Number(existing[0].id), status: existing[0].status, replay: true };
      }
      ensureRowVersion(entitlement.row_version, expectedRowVersion, '逐堂權益');
      if (entitlement.status !== 'SCHEDULED') throw courseTermError('COURSE_TERM_LEAVE_NOT_ALLOWED', '此堂次目前不可請假', 409);
      await assertProviderRuntime(conn, entitlement.owner_user_id, { forUpdate: true });
      const rules = parseJson(entitlement.rules_snapshot_json, {});
      const closeMinutes = Number(
        rules.leaveCutoffMinutes
          ?? rules.leave_cutoff_minutes
          ?? entitlement.leave_cutoff_minutes
      );
      const validDays = positiveInteger(
        rules.makeupValidDays
          ?? rules.makeup_valid_days
          ?? entitlement.makeup_valid_days,
        null
      );
      const leaveQuota = Number(
        rules.leaveQuota
          ?? rules.leave_quota
          ?? entitlement.leave_quota
      );
      if (!Number.isInteger(closeMinutes) || closeMinutes < 0
        || validDays === null || !Number.isInteger(leaveQuota) || leaveQuota < 0) {
        throw courseTermError('COURSE_TERM_RULE_SNAPSHOT_INVALID', '固定班請假與補課規則快照不完整', 409);
      }
      const computedCloseAt = mysqlDateTime(dateMs(entitlement.starts_at) - closeMinutes * 60 * 1000);
      if (dateMs(computedCloseAt) < Date.now()) {
        throw courseTermError('COURSE_TERM_LEAVE_DEADLINE_PASSED', '固定班請假期限已過', 409);
      }
      const [leaveCountRows] = await conn.query(
        `SELECT COUNT(*) AS used_leave_count
           FROM course_term_leave_requests
          WHERE enrollment_id = ? AND status IN ('APPROVED','LOCKED')`,
        [entitlement.enrollment_id]
      );
      const usedLeaveCount = Number(leaveCountRows[0]?.used_leave_count || 0);
      if (usedLeaveCount >= leaveQuota) {
        throw courseTermError('COURSE_TERM_LEAVE_QUOTA_EXCEEDED', '本班期請假次數已達上限', 409, {
          leaveQuota,
          usedLeaveCount,
        });
      }
      const [leaveInsert] = await conn.query(
        `INSERT INTO course_term_leave_requests
          (owner_user_id, enrollment_id, entitlement_id, user_id,
           status, reason, cancel_close_at, idempotency_key,
           requested_at, approved_at, row_version)
         VALUES (?, ?, ?, ?, 'APPROVED', ?, ?, ?, NOW(), NOW(), 1)`,
        [entitlement.owner_user_id, entitlement.enrollment_id, entitlement.id, userId, text(reason, 500) || null, computedCloseAt, key]
      );
      const leaveId = Number(leaveInsert.insertId);
      const validUntil = mysqlDateTime(Date.now() + validDays * 86400000);
      const requiresInsurance = Boolean(rules.makeupInsuranceRequired);
      const [makeupInsert] = await conn.query(
        `INSERT INTO course_makeup_entitlements
          (code, owner_user_id, source_entitlement_id, leave_request_id,
           enrollment_id, student_id, user_id, status, valid_until,
           requires_insurance, row_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          randomCode('MK', 6),
          entitlement.owner_user_id,
          entitlement.id,
          leaveId,
          entitlement.enrollment_id,
          entitlement.student_id,
          userId,
          requiresInsurance ? 'PENDING_INSURANCE' : 'AVAILABLE',
          validUntil,
          requiresInsurance ? 1 : 0,
        ]
      );
      const [update] = await conn.query(
        `UPDATE course_term_session_entitlements
            SET status = 'LEAVE', leave_request_id = ?, row_version = row_version + 1
          WHERE id = ? AND status = 'SCHEDULED' AND row_version = ?`,
        [leaveId, entitlement.id, expectedRowVersion]
      );
      if (!update.affectedRows) throw courseTermError('COURSE_TERM_ENTITLEMENT_CONFLICT', '逐堂權益已變更', 409);
      if (entitlement.booking_id) {
        await conn.query(
          `UPDATE course_bookings
              SET status = 'cancelled', cancelled_at = NOW(),
                  resolution_type = 'excused_leave',
                  resolution_actor_user_id = ?, resolution_reason = ?,
                  row_version = row_version + 1
            WHERE id = ? AND origin = 'TERM_ROSTER' AND status = 'booked'`,
          [userId, text(reason, 500) || null, entitlement.booking_id]
        );
      }
      await enqueueOutbox(conn, {
        ownerUserId: entitlement.owner_user_id,
        userId,
        eventType: 'TERM_LEAVE_APPROVED',
        dedupeKey: `term-leave-approved:${leaveId}`,
        payload: { leaveId, makeupEntitlementId: Number(makeupInsert.insertId), validUntil, requiresInsurance },
      });
      return {
        leaveId,
        status: 'APPROVED',
        entitlementStatus: 'LEAVE',
        makeupEntitlementId: Number(makeupInsert.insertId),
        makeupStatus: requiresInsurance ? 'PENDING_INSURANCE' : 'AVAILABLE',
        validUntil,
        rowVersion: expectedRowVersion + 1,
      };
    });
  }

  async function cancelLeave({ leaveId, userId, idempotencyKey, expectedRowVersion }) {
    await assertSchema();
    const key = assertIdempotencyKey(idempotencyKey);
    return withTransaction(async (conn) => {
      const [rows] = await conn.query(
        `SELECT l.*, se.status AS entitlement_status,
                se.row_version AS entitlement_row_version,
                se.booking_id,
                m.id AS makeup_id, m.status AS makeup_status,
                m.row_version AS makeup_row_version
           FROM course_term_leave_requests l
           JOIN course_term_session_entitlements se ON se.id = l.entitlement_id
           LEFT JOIN course_makeup_entitlements m ON m.leave_request_id = l.id
          WHERE l.id = ? AND l.user_id = ? LIMIT 1 FOR UPDATE`,
        [positiveInteger(leaveId), userId]
      );
      const leave = rows[0];
      if (!leave) throw courseTermError('COURSE_TERM_LEAVE_NOT_FOUND', '找不到請假紀錄', 404);
      if (leave.status === 'CANCELLED' && leave.cancel_idempotency_key === key) {
        return {
          leaveId: Number(leave.id),
          status: 'CANCELLED',
          entitlementStatus: 'SCHEDULED',
          rowVersion: Number(leave.row_version || 1),
          replay: true,
        };
      }
      ensureRowVersion(leave.row_version, expectedRowVersion, '請假紀錄');
      if (!canCancelTermLeave({
        leave,
        entitlement: { status: leave.entitlement_status },
      })) {
        throw courseTermError('COURSE_TERM_LEAVE_CANCEL_LOCKED', '已超過取消期限，或補課權益已進入不可撤銷狀態', 409);
      }
      if (leave.makeup_status && !['AVAILABLE', 'PENDING_INSURANCE'].includes(leave.makeup_status)) {
        throw courseTermError('COURSE_TERM_MAKEUP_ALREADY_USED', '補課權益已使用或占位，不能自助取消原請假', 409);
      }
      await conn.query(
        `UPDATE course_term_leave_requests
            SET status = 'CANCELLED', cancelled_at = NOW(),
                cancel_idempotency_key = ?, row_version = row_version + 1
          WHERE id = ? AND row_version = ?`,
        [key, leave.id, expectedRowVersion]
      );
      await conn.query(
        `UPDATE course_term_session_entitlements
            SET status = 'SCHEDULED', leave_request_id = NULL,
                row_version = row_version + 1
          WHERE id = ? AND status = 'LEAVE'`,
        [leave.entitlement_id]
      );
      await conn.query(
        `UPDATE course_bookings
            SET status = 'booked', cancelled_at = NULL,
                resolution_type = NULL, resolution_actor_user_id = NULL,
                resolution_reason = NULL, row_version = row_version + 1
          WHERE id = ? AND origin = 'TERM_ROSTER'
            AND status = 'cancelled' AND resolution_type = 'excused_leave'`,
        [leave.booking_id]
      );
      if (leave.makeup_id) {
        await conn.query(
          `UPDATE course_makeup_entitlements SET status = 'REVOKED',
                  revoked_at = NOW(), row_version = row_version + 1
            WHERE id = ? AND status IN ('AVAILABLE','PENDING_INSURANCE')`,
          [leave.makeup_id]
        );
      }
      await enqueueOutbox(conn, {
        ownerUserId: leave.owner_user_id,
        userId,
        eventType: 'TERM_LEAVE_CANCELLED',
        dedupeKey: `term-leave-cancelled:${leave.id}`,
        payload: { leaveId: Number(leave.id), makeupEntitlementId: leave.makeup_id ? Number(leave.makeup_id) : null },
      });
      return { leaveId: Number(leave.id), status: 'CANCELLED', entitlementStatus: 'SCHEDULED', rowVersion: expectedRowVersion + 1 };
    });
  }

  async function listMakeupEntitlements({ userId }) {
    await assertSchema();
    const schema = await readSchemaState();
    const insuranceColumns = schema.paymentSchemaReady
      ? `coverage.id AS insurance_coverage_id,
              coverage.status AS insurance_status,
              coverage.pay_by_at AS insurance_pay_by_at,
              coverage.makeup_booking_id AS insurance_booking_id,
              insurance_order.id AS insurance_order_id,
              insurance_order.code AS insurance_order_code,
              insurance_order.payment_status AS insurance_payment_status,
              insurance_order.row_version AS insurance_order_row_version,`
      : `NULL AS insurance_coverage_id,
              NULL AS insurance_status,
              NULL AS insurance_pay_by_at,
              NULL AS insurance_booking_id,
              NULL AS insurance_order_id,
              NULL AS insurance_order_code,
              NULL AS insurance_payment_status,
              NULL AS insurance_order_row_version,`;
    const insuranceJoins = schema.paymentSchemaReady
      ? `LEFT JOIN course_makeup_insurance_coverages coverage
           ON coverage.makeup_entitlement_id = m.id
          AND coverage.status IN ('pending_payment','reviewing','active')
         LEFT JOIN course_orders insurance_order ON insurance_order.id = coverage.order_id`
      : '';
    const targetInsuranceColumn = schema.paymentSchemaReady
      ? 'target_policy.required AS target_insurance_required'
      : '0 AS target_insurance_required';
    const targetInsuranceJoin = schema.paymentSchemaReady
      ? `LEFT JOIN course_makeup_insurance_policies target_policy
           ON target_policy.target_session_id = session.id
          AND target_policy.owner_user_id = route.owner_user_id
          AND target_policy.status = 'active'`
      : '';
    const [rows] = await pool.query(
      `SELECT m.*, source.session_id AS source_session_id,
              s.title AS source_title, s.starts_at AS source_starts_at,
              t.name AS term_name,
              ${insuranceColumns}
              makeup_booking.id AS makeup_booking_id,
              makeup_booking.booking_id AS roster_booking_id,
              makeup_booking.session_id AS target_session_id,
              makeup_booking.status AS makeup_booking_status,
              makeup_booking.row_version AS makeup_booking_row_version
         FROM course_makeup_entitlements m
         JOIN course_term_session_entitlements source ON source.id = m.source_entitlement_id
         JOIN course_sessions s ON s.id = source.session_id
         JOIN course_term_enrollments e
           ON e.id = m.enrollment_id AND e.owner_user_id = m.owner_user_id
         JOIN course_terms t ON t.id = e.term_id
         ${insuranceJoins}
         LEFT JOIN course_makeup_bookings makeup_booking ON makeup_booking.id = m.used_booking_id
        WHERE m.user_id = ? ORDER BY m.valid_until, m.id`,
      [userId]
    );
    const items = [];
    for (const row of rows) {
      const [targetRows] = await pool.query(
        `SELECT session.id, session.code, session.title, session.location,
                session.city, session.starts_at, session.ends_at,
                route.booking_open_at, route.booking_close_at,
                ${targetInsuranceColumn},
                COALESCE(route.capacity_override, session.capacity) AS capacity,
                (SELECT COUNT(*) FROM course_makeup_bookings mb
                  WHERE mb.session_id = session.id
                    AND mb.status IN ('RESERVED','BOOKED')) AS allocated
           FROM course_term_enrollments enrollment
           JOIN course_makeup_routes route
             ON route.source_term_id = enrollment.term_id
            AND route.owner_user_id = enrollment.owner_user_id
            AND route.status = 'active'
           JOIN course_sessions session
             ON session.id = route.target_session_id
            AND session.owner_user_id = enrollment.owner_user_id
           ${targetInsuranceJoin}
          WHERE enrollment.id = ?
            AND session.status IN ('open','published')
            AND session.starts_at > NOW()
            AND (route.booking_open_at IS NULL OR route.booking_open_at <= NOW())
            AND (route.booking_close_at IS NULL OR route.booking_close_at >= NOW())
          ORDER BY session.starts_at, session.id`,
        [row.enrollment_id]
      );
      items.push({
        id: Number(row.id),
        enrollmentId: Number(row.enrollment_id),
        sourceSessionId: Number(row.source_session_id),
        sourceTitle: row.source_title,
        sourceStartsAt: row.source_starts_at,
        termName: row.term_name,
        status: row.status,
        validUntil: row.valid_until,
        requiresInsurance: Boolean(Number(row.requires_insurance || 0)),
        booking: row.makeup_booking_id ? {
          id: Number(row.makeup_booking_id),
          rosterBookingId: row.roster_booking_id == null ? null : Number(row.roster_booking_id),
          sessionId: Number(row.target_session_id),
          status: row.makeup_booking_status,
          rowVersion: Number(row.makeup_booking_row_version || 1),
        } : null,
        insurance: row.insurance_coverage_id ? {
          coverageId: Number(row.insurance_coverage_id),
          status: row.insurance_status,
          payByAt: row.insurance_pay_by_at,
          bookingId: row.insurance_booking_id == null ? null : Number(row.insurance_booking_id),
          orderId: row.insurance_order_id == null ? null : Number(row.insurance_order_id),
          orderCode: row.insurance_order_code || null,
          paymentStatus: row.insurance_payment_status || null,
          rowVersion: Number(row.insurance_order_row_version || 1),
        } : null,
        rowVersion: Number(row.row_version || 1),
        targetSessions: targetRows
          .filter((target) => target.capacity == null || Number(target.allocated || 0) < Number(target.capacity))
          .map((target) => ({
            id: Number(target.id),
            code: target.code,
            title: target.title,
            location: target.location || '',
            city: target.city || '',
            startsAt: target.starts_at,
            endsAt: target.ends_at,
            bookingOpenAt: target.booking_open_at,
            bookingCloseAt: target.booking_close_at,
            requiresInsurance: Boolean(Number(target.target_insurance_required || 0)),
            capacity: target.capacity == null ? null : Number(target.capacity),
            availableSeats: target.capacity == null
              ? null
              : Math.max(0, Number(target.capacity) - Number(target.allocated || 0)),
          })),
      });
    }
    return items;
  }

  function normalizeMakeupRouteInput(body = {}, current = {}) {
    const inputValue = (camelKey, snakeKey, currentKey) => {
      if (Object.prototype.hasOwnProperty.call(body, camelKey)) return body[camelKey];
      if (Object.prototype.hasOwnProperty.call(body, snakeKey)) return body[snakeKey];
      return current[currentKey];
    };
    const sourceTermId = positiveInteger(
      inputValue('sourceTermId', 'source_term_id', 'source_term_id')
    );
    const targetSessionId = positiveInteger(
      inputValue('targetSessionId', 'target_session_id', 'target_session_id')
    );
    if (!sourceTermId || !targetSessionId) {
      throw courseTermError('COURSE_MAKEUP_ROUTE_TARGET_REQUIRED', '補課路由需要來源班期與目標場次', 400);
    }
    const status = text(inputValue('status', 'status', 'status') ?? 'active', 24).toLowerCase();
    if (!['active', 'inactive'].includes(status)) {
      throw courseTermError('COURSE_MAKEUP_ROUTE_STATUS_INVALID', '補課路由狀態不正確', 400);
    }
    const capacityValue = inputValue('capacityOverride', 'capacity_override', 'capacity_override') ?? null;
    const capacityOverride = capacityValue === null || capacityValue === ''
      ? null
      : positiveInteger(capacityValue);
    if (capacityValue !== null && capacityValue !== '' && !capacityOverride) {
      throw courseTermError('COURSE_MAKEUP_ROUTE_CAPACITY_INVALID', '補課名額覆寫必須是正整數或留空', 400);
    }
    const bookingOpenAt = text(
      inputValue('bookingOpenAt', 'booking_open_at', 'booking_open_at'),
      32
    ) || null;
    const bookingCloseAt = text(
      inputValue('bookingCloseAt', 'booking_close_at', 'booking_close_at'),
      32
    ) || null;
    if (bookingOpenAt && bookingCloseAt && dateMs(bookingCloseAt) < dateMs(bookingOpenAt)) {
      throw courseTermError('COURSE_MAKEUP_ROUTE_WINDOW_INVALID', '補課預約截止不可早於開放時間', 400);
    }
    return {
      sourceTermId,
      targetSessionId,
      status,
      capacityOverride,
      bookingOpenAt,
      bookingCloseAt,
    };
  }

  async function validateMakeupRouteScope(conn, {
    ownerUserId,
    sourceTermId,
    targetSessionId,
  }) {
    const [rows] = await conn.query(
      `SELECT source.id AS source_term_id, source.owner_user_id AS source_owner_user_id,
              target.id AS target_session_id, target.owner_user_id AS target_owner_user_id,
              target.term_id AS target_term_id, target.session_kind AS target_session_kind
         FROM course_terms source
         JOIN course_sessions target ON target.id = ?
        WHERE source.id = ? LIMIT 1 FOR UPDATE`,
      [targetSessionId, sourceTermId]
    );
    const resource = rows[0];
    if (!resource) {
      throw courseTermError('COURSE_MAKEUP_ROUTE_RESOURCE_NOT_FOUND', '找不到來源班期或目標場次', 404);
    }
    if (String(resource.source_owner_user_id || '') !== String(ownerUserId || '')
      || String(resource.target_owner_user_id || '') !== String(ownerUserId || '')) {
      throw courseTermError('COURSE_MAKEUP_ROUTE_TENANT_CONFLICT', '來源班期與目標場次必須屬於同一課程租戶', 409);
    }
    return resource;
  }

  async function listMakeupRoutes({ ownerUserId, sourceTermId = null, status = null } = {}) {
    await assertSchema();
    if (!ownerUserId) throw courseTermError('COURSE_TENANT_REQUIRED', '補課路由查詢需要課程租戶', 400);
    await assertProviderRuntime(pool, ownerUserId);
    const normalizedStatus = text(status, 24).toLowerCase();
    if (normalizedStatus && !['active', 'inactive'].includes(normalizedStatus)) {
      throw courseTermError('COURSE_MAKEUP_ROUTE_STATUS_INVALID', '補課路由狀態不正確', 400);
    }
    const normalizedSourceTermId = positiveInteger(sourceTermId);
    const [rows] = await pool.query(
      `SELECT route.*, source.code AS source_term_code, source.name AS source_term_name,
              target.code AS target_session_code, target.title AS target_session_title,
              target.term_id AS target_term_id, target.starts_at, target.ends_at,
              target.location, target.city, target.capacity AS target_session_capacity,
              target.status AS target_session_status,
              target_term.code AS target_term_code, target_term.name AS target_term_name
         FROM course_makeup_routes route
         JOIN course_terms source
           ON source.id = route.source_term_id
          AND source.owner_user_id = route.owner_user_id
         JOIN course_sessions target
           ON target.id = route.target_session_id
          AND target.owner_user_id = route.owner_user_id
         LEFT JOIN course_terms target_term ON target_term.id = target.term_id
        WHERE route.owner_user_id = ?
          ${normalizedSourceTermId ? 'AND route.source_term_id = ?' : ''}
          ${normalizedStatus ? 'AND route.status = ?' : ''}
        ORDER BY source.starts_on DESC, target.starts_at, route.id`,
      [ownerUserId, ...(normalizedSourceTermId ? [normalizedSourceTermId] : []),
        ...(normalizedStatus ? [normalizedStatus] : [])]
    );
    return rows.map((row) => ({
      ...row,
      id: Number(row.id),
      sourceTermId: Number(row.source_term_id),
      targetSessionId: Number(row.target_session_id),
      targetTermId: row.target_term_id == null ? null : Number(row.target_term_id),
      capacityOverride: row.capacity_override == null ? null : Number(row.capacity_override),
      bookingOpenAt: row.booking_open_at,
      bookingCloseAt: row.booking_close_at,
      rowVersion: Number(row.row_version || 1),
    }));
  }

  async function createMakeupRoute({ ownerUserId, actorUserId, body, idempotencyKey }) {
    await assertSchema();
    const input = normalizeMakeupRouteInput(body);
    return withTransaction(async (conn) => {
      await assertProviderRuntime(conn, ownerUserId, { forUpdate: true });
      await validateMakeupRouteScope(conn, { ownerUserId, ...input });
      const operation = 'term.makeup-route.create';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { ownerUserId, ...input },
        resourceType: 'course_makeup_route',
      });
      if (mutation.replay) return { ...mutation.replay, replay: true };
      const [existing] = await conn.query(
        `SELECT id FROM course_makeup_routes
          WHERE source_term_id = ? AND target_session_id = ? LIMIT 1 FOR UPDATE`,
        [input.sourceTermId, input.targetSessionId]
      );
      if (existing[0]) {
        throw courseTermError('COURSE_MAKEUP_ROUTE_CONFLICT', '此來源班期與目標場次已有補課路由', 409);
      }
      const [insert] = await conn.query(
        `INSERT INTO course_makeup_routes
          (owner_user_id, source_term_id, target_session_id, status,
           capacity_override, booking_open_at, booking_close_at, row_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [ownerUserId, input.sourceTermId, input.targetSessionId, input.status,
          input.capacityOverride, input.bookingOpenAt, input.bookingCloseAt]
      );
      const response = {
        id: Number(insert.insertId),
        ownerUserId,
        ...input,
        rowVersion: 1,
      };
      await completeMutation(conn, {
        actorUserId,
        operation,
        mutation,
        response,
        resourceType: 'course_makeup_route',
        resourceId: insert.insertId,
      });
      return response;
    });
  }

  async function updateMakeupRoute({
    routeId,
    ownerUserId,
    actorUserId,
    body,
    idempotencyKey,
    expectedRowVersion,
  }) {
    await assertSchema();
    if (!positiveInteger(expectedRowVersion)) {
      throw courseTermError('COURSE_ROW_VERSION_REQUIRED', '更新補課路由需要 If-Match', 428);
    }
    return withTransaction(async (conn) => {
      await assertProviderRuntime(conn, ownerUserId, { forUpdate: true });
      const [rows] = await conn.query(
        `SELECT * FROM course_makeup_routes
          WHERE id = ? AND owner_user_id = ? LIMIT 1 FOR UPDATE`,
        [positiveInteger(routeId), ownerUserId]
      );
      const current = rows[0];
      if (!current) throw courseTermError('COURSE_MAKEUP_ROUTE_NOT_FOUND', '找不到補課路由', 404);
      const input = normalizeMakeupRouteInput(body, current);
      const operation = 'term.makeup-route.update';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { routeId: Number(current.id), ownerUserId, expectedRowVersion, ...input },
        resourceType: 'course_makeup_route',
        resourceId: current.id,
      });
      if (mutation.replay) return { ...mutation.replay, replay: true };
      ensureRowVersion(current.row_version, expectedRowVersion, '補課路由');
      await validateMakeupRouteScope(conn, { ownerUserId, ...input });
      const [conflicts] = await conn.query(
        `SELECT id FROM course_makeup_routes
          WHERE source_term_id = ? AND target_session_id = ? AND id <> ?
          LIMIT 1 FOR UPDATE`,
        [input.sourceTermId, input.targetSessionId, current.id]
      );
      if (conflicts[0]) {
        throw courseTermError('COURSE_MAKEUP_ROUTE_CONFLICT', '此來源班期與目標場次已有補課路由', 409);
      }
      const [update] = await conn.query(
        `UPDATE course_makeup_routes
            SET source_term_id = ?, target_session_id = ?, status = ?,
                capacity_override = ?, booking_open_at = ?, booking_close_at = ?,
                row_version = row_version + 1
          WHERE id = ? AND owner_user_id = ? AND row_version = ?`,
        [input.sourceTermId, input.targetSessionId, input.status,
          input.capacityOverride, input.bookingOpenAt, input.bookingCloseAt,
          current.id, ownerUserId, expectedRowVersion]
      );
      if (!update.affectedRows) {
        throw courseTermError('COURSE_ROW_VERSION_CONFLICT', '補課路由已更新，請重新載入', 412);
      }
      const response = {
        id: Number(current.id),
        ownerUserId,
        ...input,
        rowVersion: Number(expectedRowVersion) + 1,
      };
      await completeMutation(conn, {
        actorUserId,
        operation,
        mutation,
        response,
        resourceType: 'course_makeup_route',
        resourceId: current.id,
      });
      return response;
    });
  }

  async function joinWaitlist({ termId, userId, idempotencyKey, expectedTermRowVersion }) {
    await assertSchema();
    const key = assertIdempotencyKey(idempotencyKey);
    return withTransaction(async (conn) => {
      const term = await loadTerm(conn, termId, { forUpdate: true, publishedOnly: true });
      if (!term) throw courseTermError('COURSE_TERM_NOT_FOUND', '找不到固定班期', 404);
      ensureRowVersion(term.row_version, expectedTermRowVersion, '班期');
      await assertProviderRuntime(conn, term.owner_user_id, { forUpdate: true });
      const student = await ensureStudent(conn, { ownerUserId: term.owner_user_id, userId, forUpdate: true });
      const allocated = await countTermAllocations(conn, term.id, { forUpdate: true });
      if (!termCapacity({ capacity: term.capacity, activeAllocations: allocated }).full) {
        throw courseTermError('COURSE_TERM_SEAT_AVAILABLE', '目前仍有名額，請直接報名', 409);
      }
      const [existing] = await conn.query(
        `SELECT * FROM course_term_waitlist_entries
          WHERE term_id = ? AND student_id = ? AND status IN ('WAITING','OFFERED')
          LIMIT 1 FOR UPDATE`,
        [term.id, student.id]
      );
      if (existing[0]) return { id: Number(existing[0].id), status: existing[0].status, replay: true };
      const [insert] = await conn.query(
        `INSERT INTO course_term_waitlist_entries
          (owner_user_id, term_id, student_id, user_id, status, priority,
           joined_at, idempotency_key, row_version)
         VALUES (?, ?, ?, ?, 'WAITING', 100, NOW(), ?, 1)`,
        [term.owner_user_id, term.id, student.id, userId, key]
      );
      await enqueueOutbox(conn, {
        ownerUserId: term.owner_user_id,
        userId,
        eventType: 'TERM_WAITLIST_JOINED',
        dedupeKey: `term-waitlist-joined:${insert.insertId}`,
        payload: { waitlistEntryId: Number(insert.insertId), termId: Number(term.id) },
      });
      return { id: Number(insert.insertId), status: 'WAITING', rowVersion: 1 };
    });
  }

  async function listRenewalOptions({ userId }) {
    await assertSchema();
    const [rows] = await pool.query(
      `SELECT r.id, r.source_term_id, r.target_term_id,
              r.renewal_open_at, r.renewal_close_at, r.status, r.row_version,
              source.name AS source_term_name, target.name AS target_term_name,
              target.row_version AS target_row_version,
              e.id AS source_enrollment_id, e.status AS source_enrollment_status
         FROM course_term_renewal_rules r
         JOIN course_terms source ON source.id = r.source_term_id
         JOIN course_terms target ON target.id = r.target_term_id
         JOIN course_term_enrollments e
           ON e.term_id = r.source_term_id AND e.user_id = ?
        WHERE r.status = 'active' AND r.renewal_open_at <= NOW()
          AND r.renewal_close_at >= NOW()
          AND e.status = 'COMPLETED'
          AND target.status = 'published'
          AND EXISTS (
            SELECT 1 FROM course_settings provider_feature
             WHERE provider_feature.scope_key = CONCAT('provider:', r.owner_user_id)
               AND provider_feature.fixed_term_enabled = 1
          )
          AND EXISTS (
            SELECT 1 FROM course_settings platform_feature
             WHERE platform_feature.scope_key = 'platform'
               AND platform_feature.fixed_term_enabled = 1
          )
          AND NOT EXISTS (
            SELECT 1 FROM course_term_enrollments target_enrollment
             WHERE target_enrollment.term_id = r.target_term_id
               AND target_enrollment.user_id = ?
               AND target_enrollment.status NOT IN ('CANCELLED','REJECTED')
          )
          AND (
            target.level_id IS NULL OR EXISTS (
              SELECT 1 FROM course_student_level_records level_record
               WHERE level_record.owner_user_id = r.owner_user_id
                 AND level_record.student_id = e.student_id
                 AND level_record.level_id = target.level_id
                 AND level_record.is_current = 1
                 AND level_record.assessment_status = 'PASSED'
                 AND (level_record.expires_at IS NULL OR level_record.expires_at >= NOW())
            )
          )
        ORDER BY r.renewal_close_at, r.id`,
      [userId, userId]
    );
    return rows.map((row) => ({
      id: Number(row.id),
      sourceTermId: Number(row.source_term_id),
      sourceTermName: row.source_term_name,
      targetTermId: Number(row.target_term_id),
      targetTermName: row.target_term_name,
      sourceEnrollmentId: Number(row.source_enrollment_id),
      opensAt: row.renewal_open_at,
      closesAt: row.renewal_close_at,
      rowVersion: Number(row.row_version || 1),
      targetRowVersion: Number(row.target_row_version || 1),
    }));
  }

  async function bookMakeup({
    makeupEntitlementId,
    targetSessionId,
    userId,
    idempotencyKey,
    expectedRowVersion,
  }) {
    const schema = await assertSchema();
    const key = assertIdempotencyKey(idempotencyKey);
    return withTransaction(async (conn) => {
      const [rows] = await conn.query(
        `SELECT m.*, e.term_id AS source_term_id
           FROM course_makeup_entitlements m
           JOIN course_term_enrollments e
             ON e.id = m.enrollment_id AND e.owner_user_id = m.owner_user_id
          WHERE m.id = ? AND m.user_id = ? LIMIT 1 FOR UPDATE`,
        [positiveInteger(makeupEntitlementId), userId]
      );
      const makeup = rows[0];
      if (!makeup) throw courseTermError('COURSE_MAKEUP_NOT_FOUND', '找不到補課權益', 404);
      const [replayRows] = await conn.query(
        `SELECT id, makeup_entitlement_id, session_id, status, row_version
           FROM course_makeup_bookings
          WHERE user_id = ? AND idempotency_key = ? LIMIT 1 FOR UPDATE`,
        [userId, key]
      );
      if (replayRows[0]) {
        const replay = replayRows[0];
        if (Number(replay.makeup_entitlement_id) !== Number(makeup.id)
          || Number(replay.session_id) !== Number(targetSessionId)) {
          throw courseTermError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key 已用於不同補課預約', 409);
        }
        return {
          bookingId: Number(replay.id),
          makeupEntitlementId: Number(replay.makeup_entitlement_id),
          sessionId: Number(replay.session_id),
          status: replay.status,
          rowVersion: Number(replay.row_version || 1),
          replay: true,
        };
      }
      ensureRowVersion(makeup.row_version, expectedRowVersion, '補課權益');
      if (!['AVAILABLE', 'PENDING_INSURANCE'].includes(String(makeup.status))
        || dateMs(makeup.valid_until) < Date.now()) {
        throw courseTermError('COURSE_MAKEUP_NOT_AVAILABLE', '補課權益目前不可預約', 409);
      }
      const insuranceSelect = schema.paymentSchemaReady
        ? 'policy.required AS target_insurance_required'
        : '0 AS target_insurance_required';
      const insuranceJoin = schema.paymentSchemaReady
        ? `LEFT JOIN course_makeup_insurance_policies policy
             ON policy.target_session_id = s.id
            AND policy.owner_user_id = r.owner_user_id
            AND policy.status = 'active'`
        : '';
      const [routeRows] = await conn.query(
        `SELECT r.*, s.term_id AS target_term_id, s.starts_at,
                s.capacity AS session_capacity, s.status AS session_status,
                student.display_name, student.email, e.student_id,
                ${insuranceSelect}
           FROM course_makeup_routes r
           JOIN course_sessions s
             ON s.id = r.target_session_id AND s.owner_user_id = r.owner_user_id
           JOIN course_term_enrollments e
             ON e.id = ? AND e.owner_user_id = r.owner_user_id
           JOIN course_students student ON student.id = e.student_id
           ${insuranceJoin}
          WHERE r.source_term_id = ? AND r.target_session_id = ?
            AND r.owner_user_id = ? AND r.status = 'active' LIMIT 1 FOR UPDATE`,
        [makeup.enrollment_id, makeup.source_term_id, positiveInteger(targetSessionId), makeup.owner_user_id]
      );
      const route = routeRows[0];
      if (!route) throw courseTermError('COURSE_MAKEUP_ROUTE_NOT_ALLOWED', '此補課權益不可預約目標場次', 409);
      if (Number(route.target_insurance_required) === 1) {
        throw courseTermError('COURSE_MAKEUP_INSURANCE_REQUIRED', '目標補課場次需先完成開放水域保險付款', 409);
      }
      await assertProviderRuntime(conn, makeup.owner_user_id, { forUpdate: true });
      if (!['open', 'published'].includes(String(route.session_status || '').toLowerCase())) {
        throw courseTermError('COURSE_MAKEUP_SESSION_NOT_OPEN', '補課場次目前未開放', 409);
      }
      if (dateMs(route.starts_at) <= Date.now()) {
        throw courseTermError('COURSE_MAKEUP_SESSION_STARTED', '補課場次已開始', 409);
      }
      if (route.booking_open_at && dateMs(route.booking_open_at) > Date.now()) {
        throw courseTermError('COURSE_MAKEUP_BOOKING_NOT_OPEN', '補課場次尚未開放預約', 409);
      }
      if (route.booking_close_at && dateMs(route.booking_close_at) < Date.now()) {
        throw courseTermError('COURSE_MAKEUP_BOOKING_CLOSED', '補課場次預約已截止', 409);
      }
      const [heldRows] = await conn.query(
        `SELECT id FROM course_makeup_bookings
          WHERE session_id = ? AND status IN ('RESERVED','BOOKED') FOR UPDATE`,
        [targetSessionId]
      );
      const capacity = route.capacity_override == null ? route.session_capacity : route.capacity_override;
      if (capacity !== null && heldRows.length >= Number(capacity)) {
        throw courseTermError('COURSE_MAKEUP_CAPACITY_FULL', '補課名額已滿', 409);
      }
      const [projectionInsert] = await conn.query(
        `INSERT INTO course_bookings
          (session_id, ticket_id, user_id, student_id, attendee_name,
           attendee_email, verify_code, status, origin, booked_at, row_version)
         VALUES (?, NULL, ?, ?, ?, ?, ?, 'booked', 'MAKEUP', NOW(), 1)`,
        [targetSessionId, userId, route.student_id, text(route.display_name, 255),
          text(route.email, 255).toLowerCase(), randomCode('CBK', 10)]
      );
      const [bookingInsert] = await conn.query(
        `INSERT INTO course_makeup_bookings
          (code, owner_user_id, makeup_entitlement_id, session_id, user_id,
           booking_id, status, idempotency_key, row_version)
         VALUES (?, ?, ?, ?, ?, ?, 'BOOKED', ?, 1)`,
        [randomCode('MKB', 6), makeup.owner_user_id, makeup.id, targetSessionId,
          userId, projectionInsert.insertId, key]
      );
      await conn.query(
        `UPDATE course_makeup_entitlements SET status = 'BOOKED',
                used_booking_id = ?, row_version = row_version + 1
          WHERE id = ? AND status IN ('AVAILABLE','PENDING_INSURANCE') AND row_version = ?`,
        [bookingInsert.insertId, makeup.id, expectedRowVersion]
      );
      await enqueueOutbox(conn, {
        ownerUserId: makeup.owner_user_id,
        userId,
        eventType: 'MAKEUP_BOOKED',
        dedupeKey: `makeup-booked:${bookingInsert.insertId}`,
        payload: { bookingId: Number(bookingInsert.insertId), makeupEntitlementId: Number(makeup.id), sessionId: Number(targetSessionId) },
      });
      return {
        bookingId: Number(bookingInsert.insertId),
        rosterBookingId: Number(projectionInsert.insertId),
        makeupEntitlementId: Number(makeup.id),
        sessionId: Number(targetSessionId),
        status: 'BOOKED',
        rowVersion: expectedRowVersion + 1,
      };
    });
  }

  async function transitionMakeupBooking({
    makeupBookingId,
    action,
    actorUserId,
    userId = null,
    ownerUserId = null,
    reason = null,
    idempotencyKey,
    expectedRowVersion,
  }) {
    await assertSchema();
    const schema = await readSchemaState();
    const insuranceSelect = schema.paymentSchemaReady
      ? 'coverage.status AS insurance_status'
      : 'NULL AS insurance_status';
    const insuranceJoin = schema.paymentSchemaReady
      ? `LEFT JOIN course_makeup_insurance_coverages coverage
             ON coverage.makeup_booking_id = mb.id`
      : '';
    const normalizedAction = text(action, 24).toLowerCase();
    if (!['cancel', 'attend', 'no_show'].includes(normalizedAction)) {
      throw courseTermError('COURSE_MAKEUP_ACTION_INVALID', '補課預約操作不正確', 400);
    }
    return withTransaction(async (conn) => {
      const [rows] = await conn.query(
        `SELECT mb.*, m.status AS entitlement_status,
                m.row_version AS entitlement_row_version,
                s.starts_at, s.status AS session_status,
                ${insuranceSelect}
           FROM course_makeup_bookings mb
           JOIN course_makeup_entitlements m ON m.id = mb.makeup_entitlement_id
           JOIN course_sessions s ON s.id = mb.session_id
           ${insuranceJoin}
          WHERE mb.id = ?
            ${userId ? 'AND mb.user_id = ?' : 'AND mb.owner_user_id <=> ?'}
          LIMIT 1 FOR UPDATE`,
        [positiveInteger(makeupBookingId), userId || ownerUserId]
      );
      const booking = rows[0];
      if (!booking) throw courseTermError('COURSE_MAKEUP_BOOKING_NOT_FOUND', '找不到補課預約', 404);
      await assertProviderRuntime(conn, booking.owner_user_id, { forUpdate: true });
      if (userId && normalizedAction !== 'cancel') {
        throw courseTermError('FORBIDDEN', '學員只能取消自己的補課預約', 403);
      }
      const operation = `term.makeup.${normalizedAction}`;
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { makeupBookingId: Number(booking.id), normalizedAction, expectedRowVersion, reason: text(reason, 500) || null },
        resourceType: 'course_makeup_booking',
        resourceId: booking.id,
      });
      if (mutation.replay) return mutation.replay;
      ensureRowVersion(booking.row_version, expectedRowVersion, '補課預約');
      if (booking.status !== 'BOOKED') {
        throw courseTermError('COURSE_MAKEUP_BOOKING_STATE_CONFLICT', '補課預約已完成判定', 409);
      }
      if (normalizedAction === 'cancel') {
        if (dateMs(booking.starts_at) <= Date.now()) {
          throw courseTermError('COURSE_MAKEUP_CANCEL_CLOSED', '補課場次已開始，不可自助取消', 409);
        }
        if (String(booking.insurance_status || '').toLowerCase() === 'active') {
          throw courseTermError('COURSE_MAKEUP_INSURANCE_ACTIVE', '已生效的補課保險需由課務人員處理', 409);
        }
      }
      const nextStatus = normalizedAction === 'cancel'
        ? 'CANCELLED'
        : (normalizedAction === 'attend' ? 'ATTENDED' : 'NO_SHOW');
      const [update] = await conn.query(
        `UPDATE course_makeup_bookings
            SET status = ?,
                cancelled_at = CASE WHEN ? = 'CANCELLED' THEN NOW() ELSE cancelled_at END,
                attended_at = CASE WHEN ? = 'ATTENDED' THEN NOW() ELSE attended_at END,
                row_version = row_version + 1
          WHERE id = ? AND status = 'BOOKED' AND row_version = ?`,
        [nextStatus, nextStatus, nextStatus, booking.id, expectedRowVersion]
      );
      if (!update.affectedRows) throw courseTermError('COURSE_MAKEUP_BOOKING_STATE_CONFLICT', '補課預約已變更', 409);
      if (normalizedAction === 'cancel') {
        await conn.query(
          `UPDATE course_makeup_entitlements
              SET status = 'AVAILABLE', used_booking_id = NULL,
                  row_version = row_version + 1
            WHERE id = ? AND status = 'BOOKED' AND used_booking_id = ?`,
          [booking.makeup_entitlement_id, booking.id]
        );
        await conn.query(
          `UPDATE course_bookings
              SET status = 'cancelled', cancelled_at = NOW(),
                  resolution_type = 'member_cancel',
                  resolution_actor_user_id = ?, resolution_reason = ?,
                  row_version = row_version + 1
            WHERE id = ? AND origin = 'MAKEUP' AND status = 'booked'`,
          [actorUserId, text(reason, 500) || null, booking.booking_id]
        );
      } else {
        await conn.query(
          `UPDATE course_makeup_entitlements SET status = 'USED',
                  row_version = row_version + 1
            WHERE id = ? AND status = 'BOOKED' AND used_booking_id = ?`,
          [booking.makeup_entitlement_id, booking.id]
        );
        await conn.query(
          `UPDATE course_bookings
              SET status = ?,
                  attended_at = CASE WHEN ? = 'attended' THEN NOW() ELSE attended_at END,
                  resolution_type = ?, resolution_actor_user_id = ?,
                  resolution_reason = ?, row_version = row_version + 1
            WHERE id = ? AND origin = 'MAKEUP' AND status = 'booked'`,
          [normalizedAction === 'attend' ? 'attended' : 'no_show',
            normalizedAction === 'attend' ? 'attended' : 'no_show',
            normalizedAction === 'attend' ? 'attended' : 'no_show',
            actorUserId, text(reason, 500) || null, booking.booking_id]
        );
      }
      const response = {
        bookingId: Number(booking.id),
        rosterBookingId: booking.booking_id ? Number(booking.booking_id) : null,
        makeupEntitlementId: Number(booking.makeup_entitlement_id),
        status: nextStatus,
        entitlementStatus: normalizedAction === 'cancel' ? 'AVAILABLE' : 'USED',
        rowVersion: Number(expectedRowVersion) + 1,
      };
      await completeMutation(conn, {
        actorUserId,
        operation,
        mutation,
        response,
        resourceType: 'course_makeup_booking',
        resourceId: booking.id,
      });
      await enqueueOutbox(conn, {
        ownerUserId: booking.owner_user_id,
        userId: booking.user_id,
        eventType: normalizedAction === 'cancel'
          ? 'MAKEUP_CANCELLED'
          : (normalizedAction === 'attend' ? 'MAKEUP_ATTENDED' : 'MAKEUP_NO_SHOW'),
        dedupeKey: `makeup-${normalizedAction}:${booking.id}:${mutation.key}`,
        payload: {
          bookingId: Number(booking.id),
          makeupEntitlementId: Number(booking.makeup_entitlement_id),
          sessionId: Number(booking.session_id),
          reason: text(reason, 500) || null,
        },
      });
      return response;
    });
  }

  async function createMakeupInsuranceCheckout({
    makeupEntitlementId,
    targetSessionId,
    userId,
    idempotencyKey,
    expectedRowVersion,
  }) {
    await assertSchema({ requirePayments: true });
    const key = assertIdempotencyKey(idempotencyKey);
    const payload = {
      makeupEntitlementId: Number(makeupEntitlementId),
      targetSessionId: Number(targetSessionId),
      userId,
    };
    const hash = requestHash(payload);
    return withTransaction(async (conn) => {
      const [replayRows] = await conn.query(
        `SELECT coverage.*, o.code AS order_code, o.payment_status,
                b.code AS booking_code
           FROM course_makeup_insurance_coverages coverage
           JOIN course_orders o ON o.id = coverage.order_id
           JOIN course_makeup_bookings b ON b.id = coverage.makeup_booking_id
          WHERE coverage.user_id = ? AND coverage.idempotency_key = ?
          LIMIT 1 FOR UPDATE`,
        [userId, key]
      );
      if (replayRows[0]) {
        if (replayRows[0].request_hash !== hash) {
          throw courseTermError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key 已用於不同補課保險訂單', 409);
        }
        return insuranceCheckoutPayload(replayRows[0], true);
      }
      const [rows] = await conn.query(
        `SELECT m.*, e.term_id AS source_term_id, e.student_id,
                route.id AS route_id, route.capacity_override,
                route.booking_open_at, route.booking_close_at,
                session.term_id AS target_term_id, session.starts_at,
                session.capacity AS session_capacity, session.status AS session_status,
                policy.id AS policy_id, policy.fee_product_id,
                policy.required AS target_insurance_required,
                policy.fee_amount, policy.currency, policy.payment_hold_minutes,
                policy.cancel_close_at, policy.row_version AS policy_row_version
           FROM course_makeup_entitlements m
           JOIN course_term_enrollments e
             ON e.id = m.enrollment_id AND e.owner_user_id = m.owner_user_id
           JOIN course_makeup_routes route
             ON route.source_term_id = e.term_id AND route.target_session_id = ?
            AND route.owner_user_id = m.owner_user_id
            AND route.status = 'active'
           JOIN course_sessions session
             ON session.id = route.target_session_id
            AND session.owner_user_id = m.owner_user_id
           JOIN course_makeup_insurance_policies policy
             ON policy.target_session_id = session.id AND policy.owner_user_id = m.owner_user_id
            AND policy.status = 'active'
          WHERE m.id = ? AND m.user_id = ? LIMIT 1 FOR UPDATE`,
        [positiveInteger(targetSessionId), positiveInteger(makeupEntitlementId), userId]
      );
      const makeup = rows[0];
      if (!makeup) {
        throw courseTermError('COURSE_MAKEUP_INSURANCE_NOT_AVAILABLE', '找不到可投保的補課場次或保險規則', 404);
      }
      ensureRowVersion(makeup.row_version, expectedRowVersion, '補課權益');
      if (Number(makeup.target_insurance_required) !== 1
        || !['PENDING_INSURANCE', 'AVAILABLE'].includes(String(makeup.status))) {
        throw courseTermError('COURSE_MAKEUP_INSURANCE_NOT_AVAILABLE', '此補課權益目前不需或不可購買補課保險', 409);
      }
      if (dateMs(makeup.valid_until) < Date.now() || dateMs(makeup.starts_at) <= Date.now()) {
        throw courseTermError('COURSE_MAKEUP_INSURANCE_EXPIRED', '補課權益或目標場次已過期', 409);
      }
      if (makeup.booking_open_at && dateMs(makeup.booking_open_at) > Date.now()) {
        throw courseTermError('COURSE_MAKEUP_BOOKING_NOT_OPEN', '補課場次尚未開放', 409);
      }
      if (makeup.booking_close_at && dateMs(makeup.booking_close_at) < Date.now()) {
        throw courseTermError('COURSE_MAKEUP_BOOKING_CLOSED', '補課場次已截止', 409);
      }
      if (makeup.cancel_close_at && dateMs(makeup.cancel_close_at) < Date.now()) {
        throw courseTermError('COURSE_MAKEUP_INSURANCE_CLOSED', '補課保險購買期限已過', 409);
      }
      if (!['open', 'published'].includes(String(makeup.session_status).toLowerCase())) {
        throw courseTermError('COURSE_MAKEUP_SESSION_NOT_OPEN', '補課場次目前未開放', 409);
      }
      await assertProviderRuntime(conn, makeup.owner_user_id, { requirePayments: true, forUpdate: true });
      const [activeBookings] = await conn.query(
        `SELECT id FROM course_makeup_bookings
          WHERE session_id = ? AND status IN ('RESERVED','BOOKED') FOR UPDATE`,
        [targetSessionId]
      );
      const capacity = makeup.capacity_override == null
        ? makeup.session_capacity
        : makeup.capacity_override;
      if (capacity !== null && activeBookings.length >= Number(capacity)) {
        throw courseTermError('COURSE_MAKEUP_CAPACITY_FULL', '補課名額已滿', 409);
      }
      const [userRows] = await conn.query(
        'SELECT username, email, phone FROM users WHERE id = ? LIMIT 1 FOR UPDATE',
        [userId]
      );
      const buyer = userRows[0];
      if (!buyer) throw courseTermError('AUTH_INVALID_TOKEN', '登入帳號不存在', 401);
      const payByAt = mysqlDateTime(Date.now()
        + positiveInteger(makeup.payment_hold_minutes, 1440) * 60 * 1000);
      const orderCode = randomCode('COI', 6);
      const [orderInsert] = await conn.query(
        `INSERT INTO course_orders
          (code, owner_user_id, user_id, student_id, buyer_name, buyer_email,
           buyer_phone, product_id, term_id, quantity, unit_price, total_amount,
           currency, status, payment_status, fulfillment_status, order_purpose,
           payment_method, pay_by_at, terms_accepted_at, row_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'pending', 'pending',
                 'pending', 'MAKEUP_INSURANCE', 'BANK_TRANSFER', ?, NOW(), 1)`,
        [
          orderCode,
          makeup.owner_user_id,
          userId,
          makeup.student_id,
          text(buyer.username || buyer.email, 255),
          text(buyer.email, 255),
          text(buyer.phone, 20) || null,
          makeup.fee_product_id || null,
          makeup.target_term_id || makeup.source_term_id,
          Number(makeup.fee_amount),
          Number(makeup.fee_amount),
          text(makeup.currency, 3) || 'TWD',
          payByAt,
        ]
      );
      const orderId = Number(orderInsert.insertId);
      const [seatInsert] = await conn.query(
        `INSERT INTO course_seat_allocations
          (owner_user_id, term_id, session_id, student_id, order_id, user_id,
           allocation_type, status, expires_at, row_version)
         VALUES (?, ?, ?, NULL, ?, ?, 'MAKEUP_INSURANCE', 'HELD', ?, 1)`,
        [makeup.owner_user_id, makeup.target_term_id || makeup.source_term_id,
          targetSessionId, orderId, userId, payByAt]
      );
      const [bookingInsert] = await conn.query(
        `INSERT INTO course_makeup_bookings
          (code, owner_user_id, makeup_entitlement_id, session_id, user_id,
           seat_allocation_id, status, idempotency_key, row_version)
         VALUES (?, ?, ?, ?, ?, ?, 'RESERVED', ?, 1)`,
        [randomCode('MKB', 6), makeup.owner_user_id, makeup.id,
          targetSessionId, userId, seatInsert.insertId, key]
      );
      const feeSnapshot = {
        policyId: Number(makeup.policy_id),
        policyRowVersion: Number(makeup.policy_row_version || 1),
        targetSessionId: Number(targetSessionId),
        amount: Number(makeup.fee_amount),
        currency: text(makeup.currency, 3) || 'TWD',
        paymentMethod: 'BANK_TRANSFER',
      };
      const [coverageInsert] = await conn.query(
        `INSERT INTO course_makeup_insurance_coverages
          (code, owner_user_id, user_id, policy_id, makeup_entitlement_id,
           makeup_booking_id, seat_allocation_id, order_id, status,
           idempotency_key, request_hash, fee_snapshot_json, pay_by_at, row_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?, ?, ?, 1)`,
        [randomCode('MIC', 6), makeup.owner_user_id, userId, makeup.policy_id,
          makeup.id, bookingInsert.insertId, seatInsert.insertId, orderId,
          key, hash, JSON.stringify(feeSnapshot), payByAt]
      );
      await conn.query(
        `UPDATE course_orders SET insurance_coverage_id = ? WHERE id = ?`,
        [coverageInsert.insertId, orderId]
      );
      await conn.query(
        `UPDATE course_makeup_entitlements SET status = 'RESERVED',
                used_booking_id = ?, row_version = row_version + 1
          WHERE id = ? AND status IN ('AVAILABLE','PENDING_INSURANCE')
            AND row_version = ?`,
        [bookingInsert.insertId, makeup.id, expectedRowVersion]
      );
      await conn.query(
        `INSERT INTO order_lifecycle_events
          (domain, order_id, actor_user_id, action,
           to_payment_status, to_fulfillment_status, idempotency_key, metadata)
         VALUES ('course', ?, ?, 'makeup-insurance-checkout', 'pending', 'pending', ?, ?)`,
        [orderId, userId, key, JSON.stringify({
          coverageId: Number(coverageInsert.insertId),
          makeupEntitlementId: Number(makeup.id),
          targetSessionId: Number(targetSessionId),
        })]
      );
      await enqueueOutbox(conn, {
        ownerUserId: makeup.owner_user_id,
        userId,
        eventType: 'MAKEUP_INSURANCE_ORDER_CREATED',
        dedupeKey: `makeup-insurance-order-created:${coverageInsert.insertId}`,
        payload: {
          coverageId: Number(coverageInsert.insertId), orderId, orderCode,
          bookingId: Number(bookingInsert.insertId), payByAt,
        },
      });
      return {
        coverageId: Number(coverageInsert.insertId),
        orderId,
        orderCode,
        bookingId: Number(bookingInsert.insertId),
        status: 'pending_payment',
        paymentMethod: 'BANK_TRANSFER',
        amount: Number(makeup.fee_amount),
        currency: text(makeup.currency, 3) || 'TWD',
        payByAt,
        makeupStatus: 'RESERVED',
        rowVersion: 1,
      };
    });
  }

  function insuranceCheckoutPayload(row = {}, replay = false) {
    const fee = parseJson(row.fee_snapshot_json, {});
    return {
      coverageId: Number(row.id),
      orderId: Number(row.order_id),
      orderCode: row.order_code,
      bookingId: Number(row.makeup_booking_id),
      bookingCode: row.booking_code,
      status: row.status,
      paymentStatus: row.payment_status,
      paymentMethod: 'BANK_TRANSFER',
      amount: Number(fee.amount || 0),
      currency: fee.currency || 'TWD',
      payByAt: row.pay_by_at,
      rowVersion: Number(row.row_version || 1),
      replay,
    };
  }

  async function activateMakeupInsurance(conn, {
    orderId,
    actorUserId,
    idempotencyKey,
  }) {
    const [rows] = await conn.query(
      `SELECT coverage.*, booking.status AS booking_status,
              booking.session_id, booking.booking_id,
              makeup.status AS makeup_status, makeup.user_id, makeup.student_id,
              student.display_name, student.email,
              allocation.status AS allocation_status
         FROM course_makeup_insurance_coverages coverage
         JOIN course_makeup_bookings booking ON booking.id = coverage.makeup_booking_id
         JOIN course_makeup_entitlements makeup ON makeup.id = coverage.makeup_entitlement_id
         JOIN course_students student ON student.id = makeup.student_id
         JOIN course_seat_allocations allocation ON allocation.id = coverage.seat_allocation_id
        WHERE coverage.order_id = ? LIMIT 1 FOR UPDATE`,
      [orderId]
    );
    const coverage = rows[0];
    if (!coverage) throw courseTermError('COURSE_MAKEUP_INSURANCE_NOT_FOUND', '找不到補課保險訂單', 404);
    if (coverage.status === 'active') return coverage;
    if (!['pending_payment', 'reviewing'].includes(String(coverage.status))) {
      throw courseTermError('COURSE_MAKEUP_INSURANCE_STATE_CONFLICT', '補課保險狀態已變更', 409);
    }
    let rosterBookingId = Number(coverage.booking_id || 0);
    if (!rosterBookingId) {
      const [existingRows] = await conn.query(
        `SELECT id, origin FROM course_bookings
          WHERE session_id = ? AND student_id = ? LIMIT 1 FOR UPDATE`,
        [coverage.session_id, coverage.student_id]
      );
      if (existingRows[0] && String(existingRows[0].origin).toUpperCase() !== 'MAKEUP') {
        throw courseTermError('COURSE_MAKEUP_ROSTER_PROJECTION_CONFLICT', '目標場次已有其他預約投影', 409);
      }
      rosterBookingId = Number(existingRows[0]?.id || 0);
      if (!rosterBookingId) {
        const [bookingInsert] = await conn.query(
          `INSERT INTO course_bookings
            (session_id, ticket_id, user_id, student_id, attendee_name,
             attendee_email, verify_code, status, origin, booked_at, row_version)
           VALUES (?, NULL, ?, ?, ?, ?, ?, 'booked', 'MAKEUP', NOW(), 1)`,
          [coverage.session_id, coverage.user_id, coverage.student_id,
            text(coverage.display_name, 255), text(coverage.email, 255).toLowerCase(),
            randomCode('CBK', 10)]
        );
        rosterBookingId = Number(bookingInsert.insertId);
      }
      await conn.query(
        `UPDATE course_makeup_bookings SET booking_id = ?, row_version = row_version + 1
          WHERE id = ? AND booking_id IS NULL`,
        [rosterBookingId, coverage.makeup_booking_id]
      );
    }
    await conn.query(
      `UPDATE course_makeup_insurance_coverages
          SET status = 'active', effective_at = NOW(), row_version = row_version + 1
        WHERE id = ? AND status IN ('pending_payment','reviewing')`,
      [coverage.id]
    );
    await conn.query(
      `UPDATE course_makeup_bookings SET status = 'BOOKED', booked_at = NOW(),
              row_version = row_version + 1
        WHERE id = ? AND status = 'RESERVED'`,
      [coverage.makeup_booking_id]
    );
    await conn.query(
      `UPDATE course_makeup_entitlements SET status = 'BOOKED',
              used_booking_id = ?, row_version = row_version + 1
        WHERE id = ? AND status = 'RESERVED'`,
      [coverage.makeup_booking_id, coverage.makeup_entitlement_id]
    );
    await conn.query(
      `UPDATE course_seat_allocations SET status = 'ACTIVE', expires_at = NULL,
              row_version = row_version + 1
        WHERE id = ? AND status = 'HELD'`,
      [coverage.seat_allocation_id]
    );
    await conn.query(
      `UPDATE course_orders SET payment_status = 'paid', fulfillment_status = 'fulfilled',
              status = 'issued', row_version = row_version + 1
        WHERE id = ?`,
      [orderId]
    );
    await conn.query(
      `INSERT INTO order_lifecycle_events
        (domain, order_id, actor_user_id, action,
         to_payment_status, to_fulfillment_status, idempotency_key, metadata)
       VALUES ('course', ?, ?, 'makeup-insurance-fulfill', 'paid', 'fulfilled', ?, ?)`,
      [orderId, actorUserId, idempotencyKey, JSON.stringify({ coverageId: Number(coverage.id) })]
    );
    await enqueueOutbox(conn, {
      ownerUserId: coverage.owner_user_id,
      userId: coverage.user_id,
      eventType: 'MAKEUP_INSURANCE_ACTIVATED',
      dedupeKey: `makeup-insurance-activated:${coverage.id}`,
      payload: {
        coverageId: Number(coverage.id), orderId: Number(orderId),
        makeupEntitlementId: Number(coverage.makeup_entitlement_id),
        bookingId: Number(coverage.makeup_booking_id),
      },
    });
    return { ...coverage, status: 'active' };
  }

  async function markTermAttendance({
    entitlementId,
    action,
    actorUserId,
    ownerUserId,
    reason,
    idempotencyKey,
    expectedRowVersion,
    allowOutsideWindow = false,
  }) {
    await assertSchema();
    const schema = await readSchemaState();
    const key = assertIdempotencyKey(idempotencyKey);
    const status = String(action).toUpperCase() === 'ATTEND' ? 'ATTENDED' : 'ABSENT';
    return withTransaction(async (conn) => {
      const [rows] = await conn.query(
        `SELECT se.* FROM course_term_session_entitlements se
          WHERE se.id = ? AND se.owner_user_id <=> ? LIMIT 1 FOR UPDATE`,
        [positiveInteger(entitlementId), ownerUserId]
      );
      const entitlement = rows[0];
      if (!entitlement) throw courseTermError('COURSE_TERM_ENTITLEMENT_NOT_FOUND', '找不到逐堂權益', 404);
      const operation = `term.attendance.${status.toLowerCase()}`;
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey: key,
        payload: {
          entitlementId: Number(entitlement.id),
          status,
          expectedRowVersion,
          reason: text(reason, 500) || null,
          allowOutsideWindow: Boolean(allowOutsideWindow),
        },
        resourceType: 'course_term_session_entitlement',
        resourceId: entitlement.id,
      });
      if (mutation.replay) return mutation.replay;
      ensureRowVersion(entitlement.row_version, expectedRowVersion, '逐堂權益');
      if (!['SCHEDULED', 'LEAVE'].includes(entitlement.status)) {
        throw courseTermError('COURSE_TERM_ATTENDANCE_CONFLICT', '此逐堂權益已完成判定', 409);
      }
      if (entitlement.status === 'LEAVE' && status === 'ABSENT') {
        throw courseTermError('COURSE_TERM_LEAVE_LOCKED', '已核准請假不能改為一般缺席', 409);
      }

      let makeup = null;
      if (entitlement.status === 'LEAVE' && status === 'ATTENDED') {
        const [makeupRows] = await conn.query(
          `SELECT * FROM course_makeup_entitlements
            WHERE source_entitlement_id = ? AND owner_user_id = ?
            LIMIT 1 FOR UPDATE`,
          [entitlement.id, entitlement.owner_user_id]
        );
        makeup = makeupRows[0] || null;
        if (!makeup) {
          throw courseTermError(
            'COURSE_TERM_COMPENSATION_REQUIRED',
            '請假補課權益不完整，需由課務進行補償處理',
            409,
            { entitlementId: Number(entitlement.id), reason: 'MAKEUP_ENTITLEMENT_MISSING' }
          );
        }
        const [makeupBookingRows] = await conn.query(
          `SELECT id, status FROM course_makeup_bookings
            WHERE makeup_entitlement_id = ? ORDER BY id FOR UPDATE`,
          [makeup.id]
        );
        const insuranceCoverageRows = schema.paymentSchemaReady
          ? (await conn.query(
            `SELECT id, status FROM course_makeup_insurance_coverages
              WHERE makeup_entitlement_id = ? ORDER BY id FOR UPDATE`,
            [makeup.id]
          ))[0]
          : [];
        const blockingBooking = makeupBookingRows.find((booking) => (
          BLOCKING_MAKEUP_BOOKING_STATUSES.has(String(booking.status || '').toUpperCase())
        ));
        const blockingCoverage = insuranceCoverageRows.find((coverage) => (
          ['pending_payment', 'reviewing', 'active'].includes(
            String(coverage.status || '').toLowerCase()
          )
        ));
        if (
          ['RESERVED', 'BOOKED', 'USED'].includes(String(makeup.status || '').toUpperCase())
          || blockingBooking
          || blockingCoverage
        ) {
          throw courseTermError(
            'COURSE_TERM_COMPENSATION_REQUIRED',
            '補課權益已使用或占位，需先完成補償才能改記原堂出席',
            409,
            {
              entitlementId: Number(entitlement.id),
              makeupEntitlementId: Number(makeup.id),
              makeupStatus: makeup.status,
              makeupBookingId: blockingBooking ? Number(blockingBooking.id) : null,
              makeupBookingStatus: blockingBooking?.status || null,
              insuranceCoverageId: blockingCoverage ? Number(blockingCoverage.id) : null,
              insuranceCoverageStatus: blockingCoverage?.status || null,
            }
          );
        }
        if (!['AVAILABLE', 'PENDING_INSURANCE'].includes(String(makeup.status || '').toUpperCase())) {
          throw courseTermError(
            'COURSE_TERM_COMPENSATION_REQUIRED',
            '補課權益狀態無法直接撤銷，需由課務進行補償處理',
            409,
            {
              entitlementId: Number(entitlement.id),
              makeupEntitlementId: Number(makeup.id),
              makeupStatus: makeup.status,
            }
          );
        }
      }

      const [sessionRows] = await conn.query(
        `SELECT * FROM course_sessions
          WHERE id = ? AND owner_user_id = ? AND session_kind = 'TERM'
          LIMIT 1 FOR UPDATE`,
        [entitlement.session_id, entitlement.owner_user_id]
      );
      const session = sessionRows[0];
      if (!session) throw courseTermError('COURSE_SESSION_NOT_FOUND', '找不到固定班場次', 404);
      const settings = await assertProviderRuntime(conn, entitlement.owner_user_id, { forUpdate: true });
      const policy = resolveCoursePolicy({
        session,
        providerSettings: settings.provider,
        platformSettings: settings.platform,
      });
      const now = Date.now();
      const attendanceOpenAt = Math.max(Number(policy.startsAt), Number(policy.redeemOpenAt));
      const insideAttendanceWindow = now >= attendanceOpenAt && now <= Number(policy.redeemCloseAt);
      if (!insideAttendanceWindow && !allowOutsideWindow) {
        throw courseTermError(
          now < attendanceOpenAt
            ? 'COURSE_TERM_ATTENDANCE_TOO_EARLY'
            : 'COURSE_TERM_ATTENDANCE_WINDOW_CLOSED',
          now < attendanceOpenAt
            ? '固定班場次尚未開始，教練不能提前標記出席或缺席'
            : '已超過固定班出席操作時間窗',
          409,
          { attendanceOpenAt, attendanceCloseAt: Number(policy.redeemCloseAt) }
        );
      }
      if (!insideAttendanceWindow && allowOutsideWindow && !text(reason, 500)) {
        throw courseTermError(
          'COURSE_TERM_ATTENDANCE_OVERRIDE_REASON_REQUIRED',
          '課務或管理員在現場時間窗外改記出席必須填寫原因',
          400,
          { attendanceOpenAt, attendanceCloseAt: Number(policy.redeemCloseAt) }
        );
      }

      if (makeup) {
        const [revoked] = await conn.query(
          `UPDATE course_makeup_entitlements
              SET status = 'REVOKED', revoked_at = NOW(), row_version = row_version + 1
            WHERE id = ? AND row_version = ?
              AND status IN ('AVAILABLE','PENDING_INSURANCE')`,
          [makeup.id, makeup.row_version]
        );
        if (!revoked.affectedRows) {
          throw courseTermError(
            'COURSE_TERM_COMPENSATION_REQUIRED',
            '補課權益已變更，需重新載入後由課務進行補償處理',
            409,
            { entitlementId: Number(entitlement.id), makeupEntitlementId: Number(makeup.id) }
          );
        }
      }

      const [entitlementUpdate] = await conn.query(
        `UPDATE course_term_session_entitlements
            SET status = ?, resolved_by_user_id = ?, resolution_reason = ?,
                resolved_at = NOW(),
                attended_at = CASE WHEN ? = 'ATTENDED' THEN NOW() ELSE attended_at END,
                attendance_idempotency_key = ?, row_version = row_version + 1
          WHERE id = ? AND row_version = ?`,
        [status, actorUserId, text(reason, 500) || null, status, key, entitlement.id, expectedRowVersion]
      );
      if (!entitlementUpdate.affectedRows) {
        throw courseTermError('COURSE_ROW_VERSION_CONFLICT', '逐堂權益已更新，請重新載入', 412);
      }
      if (entitlement.booking_id) {
        await conn.query(
          `UPDATE course_bookings
              SET status = ?,
                  attended_at = CASE WHEN ? = 'attended' THEN NOW() ELSE attended_at END,
                  resolution_type = ?, resolution_actor_user_id = ?,
                  resolution_reason = ?, row_version = row_version + 1
            WHERE id = ? AND origin = 'TERM_ROSTER'
              AND status IN ('booked','cancelled')`,
          [status === 'ATTENDED' ? 'attended' : 'no_show',
            status === 'ATTENDED' ? 'attended' : 'no_show',
            status === 'ATTENDED' ? 'attended' : 'no_show',
            actorUserId, text(reason, 500) || null, entitlement.booking_id]
        );
      }
      const response = { entitlementId: Number(entitlement.id), status, rowVersion: expectedRowVersion + 1 };
      await completeMutation(conn, {
        actorUserId,
        operation,
        mutation,
        response,
        resourceType: 'course_term_session_entitlement',
        resourceId: entitlement.id,
      });
      return response;
    });
  }

  async function cancelOrderResources(conn, {
    order,
    actorUserId = null,
    reason = 'order_cancelled',
    expired = false,
  }) {
    const purpose = String(order?.order_purpose || '').toUpperCase();
    if (!['TERM_ENROLLMENT', 'MAKEUP_INSURANCE'].includes(purpose)) return null;
    await releaseReservedPaymentInstruments(conn, {
      orderId: order.id,
      actorUserId,
      reason,
    });
    await conn.query(
      `UPDATE course_payment_submissions
          SET status = ?, reviewed_by = COALESCE(?, reviewed_by), reviewed_at = NOW(),
              reason = ?, row_version = row_version + 1
        WHERE order_id = ? AND status IN ('SUBMITTED','REVIEWING')`,
      [expired ? 'CANCELLED' : 'REJECTED', actorUserId, text(reason, 500), order.id]
    );
    if (purpose === 'TERM_ENROLLMENT') {
      await conn.query(
        `UPDATE course_seat_allocations SET status = ?, released_at = NOW(),
                release_reason = ?, row_version = row_version + 1
          WHERE order_id = ? AND status = 'HELD'`,
        [expired ? 'EXPIRED' : 'RELEASED', text(reason, 500), order.id]
      );
      await conn.query(
        `UPDATE course_term_enrollments SET status = 'CANCELLED',
                cancelled_at = NOW(), cancel_reason = ?, row_version = row_version + 1
          WHERE order_id = ? AND status = 'PENDING_PAYMENT'`,
        [text(reason, 500), order.id]
      );
      await enqueueOutbox(conn, {
        ownerUserId: order.owner_user_id,
        userId: order.user_id,
        eventType: expired ? 'TERM_ORDER_EXPIRED' : 'TERM_ORDER_CANCELLED',
        dedupeKey: `${expired ? 'term-order-expired' : 'term-order-cancelled'}:${order.id}`,
        payload: { orderId: Number(order.id), enrollmentId: order.enrollment_id ? Number(order.enrollment_id) : null, reason },
      });
      return { purpose, status: 'cancelled' };
    }
    const [coverageRows] = await conn.query(
      `SELECT * FROM course_makeup_insurance_coverages
        WHERE order_id = ? LIMIT 1 FOR UPDATE`,
      [order.id]
    );
    const coverage = coverageRows[0];
    if (coverage && ['pending_payment', 'reviewing'].includes(String(coverage.status))) {
      await conn.query(
        `UPDATE course_makeup_insurance_coverages
            SET status = ?, cancelled_at = NOW(), row_version = row_version + 1
          WHERE id = ? AND status IN ('pending_payment','reviewing')`,
        [expired ? 'expired' : 'cancelled', coverage.id]
      );
      await conn.query(
        `UPDATE course_makeup_bookings SET status = 'CANCELLED', cancelled_at = NOW(),
                row_version = row_version + 1
          WHERE id = ? AND status = 'RESERVED'`,
        [coverage.makeup_booking_id]
      );
      await conn.query(
        `UPDATE course_seat_allocations SET status = ?, released_at = NOW(),
                release_reason = ?, row_version = row_version + 1
          WHERE id = ? AND status = 'HELD'`,
        [expired ? 'EXPIRED' : 'RELEASED', text(reason, 500), coverage.seat_allocation_id]
      );
      await conn.query(
        `UPDATE course_makeup_entitlements SET status = 'AVAILABLE', used_booking_id = NULL,
                row_version = row_version + 1
          WHERE id = ? AND status = 'RESERVED'`,
        [coverage.makeup_entitlement_id]
      );
      await enqueueOutbox(conn, {
        ownerUserId: coverage.owner_user_id,
        userId: coverage.user_id,
        eventType: expired ? 'MAKEUP_INSURANCE_EXPIRED' : 'MAKEUP_INSURANCE_CANCELLED',
        dedupeKey: `${expired ? 'makeup-insurance-expired' : 'makeup-insurance-cancelled'}:${coverage.id}`,
        payload: {
          coverageId: Number(coverage.id), orderId: Number(order.id),
          makeupEntitlementId: Number(coverage.makeup_entitlement_id), reason,
        },
      });
    }
    return { purpose, status: expired ? 'expired' : 'cancelled' };
  }

  async function expireDueHolds({ limit = 50, requireEnabled = true } = {}) {
    if (requireEnabled && (!enabled || !advancedPaymentsEnabled)) return [];
    await assertSchema({ requirePayments: true, requireEnabled });
    return withTransaction(async (conn) => {
      const [rows] = await conn.query(
        `SELECT o.id, a.id AS allocation_id, a.order_id, a.enrollment_id,
                a.owner_user_id, a.user_id,
                o.order_purpose, o.insurance_coverage_id
           FROM course_seat_allocations a
           JOIN course_orders o ON o.id = a.order_id
          WHERE a.status = 'HELD' AND a.expires_at IS NOT NULL
            AND a.expires_at <= NOW() AND o.payment_status = 'pending'
          ORDER BY a.expires_at, a.id LIMIT ? FOR UPDATE`,
        [Math.max(1, Math.min(200, positiveInteger(limit, 50)))]
      );
      const processed = [];
      for (const row of rows) {
        await cancelOrderResources(conn, {
          order: row,
          reason: 'payment_deadline_expired',
          expired: true,
        });
        await conn.query(
          `UPDATE course_orders SET payment_status = 'cancelled',
                  fulfillment_status = 'cancelled', status = 'cancelled',
                  cancelled_at = NOW(), cancel_reason = 'payment_deadline_expired',
                  row_version = row_version + 1
            WHERE id = ? AND payment_status = 'pending'`,
          [row.order_id]
        );
        processed.push(Number(row.order_id));
      }
      return processed;
    });
  }

  return {
    COURSE_PAYMENT_SCHEMA_VERSION: paymentSchemaVersion,
    COURSE_TERM_SCHEMA_VERSION: termSchemaVersion,
    activatePaidEnrollment,
    advancedPaymentsEnabled,
    assertProviderFeature,
    assertProviderRuntime,
    assertSchema,
    bookMakeup,
    cancelOrderResources,
    cancelLeave,
    checkout,
    createMakeupRoute,
    createMakeupInsuranceCheckout,
    createQuote,
    enabled,
    enqueueOutbox,
    expireDueHolds,
    fulfillOrder,
    getMemberSchedule,
    getTermEligibility,
    getTermDetails,
    listMakeupEntitlements,
    listMakeupRoutes,
    listPaymentOptions,
    listMemberEnrollments,
    listTerms,
    listRenewalOptions,
    markNotificationRead,
    markTermAttendance,
    mutationKeyFromRequest,
    readSchemaState,
    requestLeave,
    joinWaitlist,
    rowVersionFromRequest,
    submitBankTransfer,
    transitionMakeupBooking,
    updateMakeupRoute,
    withTransaction,
  };
}

module.exports = {
  COURSE_PAYMENT_SCHEMA_VERSION,
  COURSE_TERM_SCHEMA_VERSION,
  createCourseTermDomain,
  environmentFlag,
  mutationKeyFromRequest,
  ownerScopeSql,
  parseJson,
  randomCode,
  rowVersionFromRequest,
  toPublicTerm,
};
