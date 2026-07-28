const { createHash, randomBytes } = require('crypto');
const {
  derivePendingReview,
  resolveCoursePolicy,
  selectEligibleTicket,
  taipeiDateTimeMs,
} = require('./course-v2-policy');

const COURSE_V2_SCHEMA_VERSION = '049_course_count_card_normalization';
const MUTATION_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const ATTENDANCE_EVENT_TYPES = new Set(['SUCCESS', 'NO_SHOW']);

function domainError(code, message, statusCode = 409, details = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

function text(value, max = 255) {
  return String(value ?? '').trim().slice(0, max);
}

function positiveInt(value, fallback = null) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function integer(value, fallback = null) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stableStringify(value, seen = new WeakSet()) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value !== 'object') return JSON.stringify(String(value));
  if (seen.has(value)) return '"[Circular]"';
  seen.add(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item, seen)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key], seen)}`).join(',')}}`;
}

function requestHash(payload) {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function scopedEventIdempotency(operation, idempotencyKey) {
  const candidate = `${operation}:${idempotencyKey}`;
  if (candidate.length <= 128) return candidate;
  return `${text(operation, 48)}:${createHash('sha256').update(candidate).digest('hex')}`;
}

function mutationSourceId(resourceId, idempotencyKey, commandId = null) {
  if (commandId) return `command:${commandId}`;
  return `${resourceId}:${createHash('sha256').update(String(idempotencyKey || '')).digest('hex')}`;
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
  const raw = header !== undefined && header !== null && header !== ''
    ? String(header).replace(/^W\//, '').replace(/^"|"$/g, '')
    : (req?.body?.rowVersion ?? req?.body?.row_version);
  return positiveInt(raw, null);
}

function requireRowVersion(value, resource = '資料') {
  const version = positiveInt(value);
  if (!version) {
    throw domainError('COURSE_ROW_VERSION_REQUIRED', `${resource}操作需要 If-Match row version`, 428);
  }
  return version;
}

function mysqlDateTime(value) {
  const timestamp = taipeiDateTimeMs(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

function taipeiDate(value = Date.now()) {
  const timestamp = taipeiDateTimeMs(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
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

function toTicketBalance(row = {}) {
  const remainingUses = Number(
    row.remainingUses ?? row.remaining_uses_cache ?? row.remaining_uses ?? 0
  );
  const heldUses = Number(row.heldUses ?? row.active_holds ?? row.held_uses ?? 0);
  return {
    ticketId: Number(row.ticket_id ?? row.id),
    remainingUses,
    heldUses,
    availableUses: Math.max(0, remainingUses - heldUses),
    rowVersion: Number(row.row_version || 1),
  };
}

function resolveAttendanceUsage(eventType, { ticketId = null, hold = null } = {}) {
  const hasTicket = Boolean(ticketId);
  if (eventType === 'SUCCESS' && (!hasTicket || !hold)) {
    throw domainError('COURSE_BOOKING_HOLD_MISSING', '預約未保留票券堂數，請重新選票', 409);
  }
  if (eventType === 'NO_SHOW' && hasTicket && !hold) {
    throw domainError('COURSE_BOOKING_HOLD_MISSING', '預約未保留票券堂數，請先處理異常', 409);
  }
  return {
    hasTicket,
    deltaUses: hasTicket && hold ? -Number(hold.quantity || 1) : 0,
    anomaly: eventType === 'NO_SHOW' && !hasTicket,
  };
}

function createCourseV2Domain({
  pool,
  enabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.COURSE_V2_ENABLED || '').toLowerCase()),
  schemaVersion = COURSE_V2_SCHEMA_VERSION,
  autoNoShow = false,
} = {}) {
  if (!pool) throw new TypeError('course v2 domain requires a database pool');

  let runtimeStateCache = null;
  let runtimeStateExpiresAt = 0;

  async function readRuntimeState({
    refresh = false,
    queryable = pool,
    lock = false,
  } = {}) {
    const cacheable = queryable === pool && !lock;
    if (
      cacheable
      && !refresh
      && runtimeStateCache
      && Date.now() < runtimeStateExpiresAt
    ) return runtimeStateCache;
    try {
      const [versionRows] = await queryable.query(
        'SELECT version, applied_at FROM course_schema_versions WHERE version = ? LIMIT 1',
        [schemaVersion]
      );
      const [cutoverRows] = await queryable.query(
        `SELECT state, schema_version, maintenance_mode,
                notes AS maintenance_message, enabled_at AS activated_at
           FROM course_v2_cutover_state WHERE id = 1 LIMIT 1${lock ? ' FOR SHARE' : ''}`
      );
      const cutover = cutoverRows[0] || {};
      const state = {
        enabled,
        schemaReady: Boolean(versionRows[0]),
        schemaVersion: cutover.schema_version || versionRows[0]?.version || null,
        cutoverState: cutover.state || 'missing',
        maintenanceMessage: cutover.maintenance_message || '',
        maintenanceMode: Boolean(Number(cutover.maintenance_mode || 0)),
        active: Boolean(
          enabled
          && versionRows[0]
          && cutover.state === 'active'
          && !Number(cutover.maintenance_mode || 0)
        ),
        activatedAt: cutover.activated_at || null,
      };
      if (cacheable) runtimeStateCache = state;
      else return state;
    } catch (error) {
      if (!['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(error?.code)) throw error;
      const state = {
        enabled,
        schemaReady: false,
        schemaVersion: null,
        cutoverState: 'missing',
        maintenanceMessage: '',
        active: false,
      };
      if (cacheable) runtimeStateCache = state;
      else return state;
    }
    if (cacheable) runtimeStateExpiresAt = Date.now() + 5000;
    return runtimeStateCache;
  }

  async function assertSchema({ requireActive = true } = {}) {
    if (!enabled) {
      throw domainError('COURSE_V2_DISABLED', '課程新版尚未啟用', 503);
    }
    const state = await readRuntimeState();
    if (!state.schemaReady || state.schemaVersion !== schemaVersion) {
      throw domainError(
        'COURSE_V2_SCHEMA_REQUIRED',
        `課程新版資料庫 migration ${schemaVersion} 尚未完成`,
        503,
        state
      );
    }
    if (requireActive && (state.cutoverState !== 'active' || state.maintenanceMode)) {
      throw domainError(
        state.maintenanceMode || state.cutoverState === 'maintenance'
          ? 'COURSE_V2_MAINTENANCE'
          : 'COURSE_V2_CUTOVER_NOT_ACTIVE',
        state.maintenanceMessage || '課程新版尚未完成切換',
        503,
        state
      );
    }
    return state;
  }

  async function assertStartupReady() {
    const state = await readRuntimeState({ refresh: true });
    if (!enabled) {
      if (state.cutoverState === 'active') {
        throw domainError(
          'COURSE_V2_RUNTIME_MISMATCH',
          '資料庫已切換為課程 V2，但此服務尚未啟用 COURSE_V2_ENABLED',
          503,
          state
        );
      }
      return state;
    }
    if (!state.schemaReady || state.schemaVersion !== schemaVersion) {
      throw domainError(
        'COURSE_V2_SCHEMA_REQUIRED',
        `COURSE_V2_ENABLED 已開啟，但缺少 ${schemaVersion}`,
        503
      );
    }
    return state;
  }

  async function assertMutationAllowed(queryable = pool) {
    // Cutover is operational state, not a feature-flag concern. Refresh for
    // every write so a long-running legacy process observes freeze/activation
    // immediately instead of continuing to mutate the old model.
    const transactional = queryable !== pool;
    const state = await readRuntimeState({
      refresh: true,
      queryable,
      lock: transactional,
    });
    if (
      state.maintenanceMode
      || ['frozen', 'maintenance'].includes(String(state.cutoverState || '').toLowerCase())
    ) {
      throw domainError(
        'COURSE_WRITES_FROZEN',
        state.maintenanceMessage || '課程資料切換中，暫停所有寫入操作',
        503,
        state
      );
    }
    if (state.cutoverState === 'active' && !enabled) {
      throw domainError(
        'COURSE_V2_RUNTIME_MISMATCH',
        '課程新版已啟用，這個服務仍是舊版 runtime，已拒絕寫入',
        503,
        state
      );
    }
    if (enabled) {
      if (
        !state.schemaReady
        || state.schemaVersion !== schemaVersion
        || state.cutoverState !== 'active'
      ) {
        throw domainError(
          'COURSE_V2_CUTOVER_NOT_ACTIVE',
          state.maintenanceMessage || '課程新版尚未完成切換，暫停寫入',
          503,
          state
        );
      }
    }
    return state;
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

  async function withMutationTransaction(work) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // A shared lock on the singleton cutover row closes the check/write
      // race: freeze waits for in-flight course transactions, and every new
      // transaction observes the committed maintenance state.
      await assertMutationAllowed(conn);
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
    const key = text(idempotencyKey, 128);
    if (!MUTATION_KEY_PATTERN.test(key)) {
      throw domainError('IDEMPOTENCY_KEY_REQUIRED', '此操作需要有效的 Idempotency-Key', 400);
    }
    const hash = requestHash(payload);
    const [insert] = await conn.query(
      `INSERT IGNORE INTO course_mutation_commands
        (actor_user_id, operation, idempotency_key, request_hash, resource_type, resource_id, status)
       VALUES (?, ?, ?, ?, ?, ?, 'processing')`,
      [actorUserId, operation, key, hash, resourceType, resourceId == null ? null : String(resourceId)]
    );
    if (Number(insert.affectedRows || 0) === 1) {
      return { key, hash, commandId: Number(insert.insertId), replay: null };
    }
    const [rows] = await conn.query(
      `SELECT id, request_hash, status, response_json
         FROM course_mutation_commands
        WHERE actor_user_id = ? AND operation = ? AND idempotency_key = ?
        LIMIT 1 FOR UPDATE`,
      [actorUserId, operation, key]
    );
    const existing = rows[0];
    if (!existing || existing.request_hash !== hash) {
      throw domainError('IDEMPOTENCY_KEY_REUSED', '此 Idempotency-Key 已用於不同內容', 409);
    }
    if (existing.status === 'completed') {
      return {
        key,
        hash,
        commandId: Number(existing.id),
        replay: parseJson(existing.response_json, null),
      };
    }
    throw domainError('IDEMPOTENCY_IN_PROGRESS', '同一操作仍在處理中，請稍後重試', 409);
  }

  async function completeMutation(conn, actorUserId, operation, mutation, response, resource = {}) {
    await conn.query(
      `UPDATE course_mutation_commands
          SET status = 'completed', response_json = ?,
              resource_type = COALESCE(?, resource_type),
              resource_id = COALESCE(?, resource_id)
        WHERE actor_user_id = ? AND operation = ? AND idempotency_key = ?`,
      [
        JSON.stringify(response),
        resource.type || null,
        resource.id == null ? null : String(resource.id),
        actorUserId,
        operation,
        mutation.key,
      ]
    );
  }

  async function loadSettings(queryable, ownerUserId = null) {
    const [rows] = await queryable.query(
      `SELECT *
         FROM course_settings
        WHERE scope_key IN ('platform', ?)
        ORDER BY CASE WHEN scope_key = ? THEN 0 ELSE 1 END`,
      [ownerUserId ? `provider:${ownerUserId}` : '', ownerUserId ? `provider:${ownerUserId}` : '']
    );
    return {
      provider: rows.find((row) => row.scope === 'provider') || {},
      platform: rows.find((row) => row.scope === 'platform') || {},
    };
  }

  function settingsForSession(session, settings) {
    const snapshot = parseJson(session?.settings_snapshot_json, null);
    if (!snapshot || typeof snapshot !== 'object') return settings;
    return {
      provider: {
        ...settings.platform,
        ...settings.provider,
        ...snapshot,
      },
      platform: settings.platform,
      snapshotApplied: true,
    };
  }

  async function loadSession(queryable, sessionId, { forUpdate = false } = {}) {
    const [rows] = await queryable.query(
      `SELECT s.*, rs.code AS scenario_code, rs.name AS scenario_name,
              rs.redeem_open_minutes_before AS scenario_redeem_open_minutes_before,
              rs.redeem_close_minutes_after AS scenario_redeem_close_minutes_after
         FROM course_sessions s
         LEFT JOIN course_redeem_scenarios rs ON rs.id = s.scenario_id
        WHERE s.id = ?
        LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [positiveInt(sessionId)]
    );
    return rows[0] || null;
  }

  async function loadTicketCandidates(queryable, {
    session,
    userId,
    studentId = null,
    ownerEmail = '',
    ticketId = null,
    forUpdate = false,
  }) {
    const normalizedOwnerEmail = text(ownerEmail, 255).toLowerCase();
    const identityWhere = userId
      ? 't.user_id = ?'
      : (studentId ? 't.student_id = ?' : 'LOWER(t.owner_email) = ?');
    const identityValue = userId || studentId || normalizedOwnerEmail;
    if (!identityValue) return [];
    const where = [
      identityWhere,
      "t.status IN ('pending','active')",
      't.frozen_at IS NULL',
      '(t.expires_at IS NULL OR t.expires_at >= ?)',
      "(t.activation_deadline IS NULL OR t.status <> 'pending' OR t.activation_deadline >= ?)",
      `(
        CASE WHEN t.product_code_snapshot IS NOT NULL
          THEN t.provider_user_id_snapshot
          ELSE tp.owner_user_id
        END
      ) <=> s.owner_user_id`,
      `(
        (s.scenario_id IS NOT NULL AND sap.ticket_product_id IS NOT NULL)
        OR
        (s.scenario_id IS NULL AND (
          t.ticket_product_id = sp.ticket_product_id
          OR (t.ticket_product_id IS NULL AND t.product_id = s.product_id)
          OR s.product_id IS NULL
        ))
      )`,
    ];
    const params = [identityValue, taipeiDate(), taipeiDate()];
    if (ticketId) {
      where.push('t.id = ?');
      params.push(positiveInt(ticketId));
    }
    const [rows] = await queryable.query(
      `SELECT t.*, COALESCE(t.remaining_uses_cache, t.remaining_uses, 0) AS remaining_uses_cache,
              tp.code AS ticket_product_code, tp.name AS ticket_product_name,
              COALESCE(t.product_redemption_policy_snapshot, tp.redemption_policy_json) AS redemption_policy_json,
              COALESCE(sap.priority, 2147483647) AS scenario_priority,
              sap.redeem_open_minutes_before AS allowed_redeem_open_minutes_before,
              sap.redeem_close_minutes_after AS allowed_redeem_close_minutes_after,
              COALESCE((
                SELECT SUM(h.quantity) FROM course_ticket_holds h
                 WHERE h.ticket_id = t.id AND h.status = 'active'
              ), 0) AS active_holds
         FROM course_tickets t
         JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
         JOIN course_sessions s ON s.id = ?
         LEFT JOIN course_products sp ON sp.id = s.product_id
         LEFT JOIN course_scenario_allowed_products sap
           ON sap.scenario_id = s.scenario_id AND sap.ticket_product_id = t.ticket_product_id
        WHERE ${where.join(' AND ')}
        ORDER BY COALESCE(sap.priority, 2147483647),
                 CASE WHEN t.expires_at IS NULL THEN 1 ELSE 0 END, t.expires_at,
                 t.issued_at, t.id${forUpdate ? ' FOR UPDATE' : ''}`,
      [session.id, ...params]
    );
    return rows.map((row) => {
      const redemptionPolicy = parseJson(row.redemption_policy_json, {});
      return {
        ...row,
        redeem_open_minutes_before: redemptionPolicy.redeemOpenMinutesBefore
          ?? redemptionPolicy.redeem_open_minutes_before,
        redeem_close_minutes_after: redemptionPolicy.redeemCloseMinutesAfter
          ?? redemptionPolicy.redeem_close_minutes_after,
      };
    });
  }

  function ticketEligibility(ticket, session, settings, now = Date.now()) {
    const scenario = {
      redeem_open_minutes_before: session.scenario_redeem_open_minutes_before,
      redeem_close_minutes_after: session.scenario_redeem_close_minutes_after,
    };
    const policy = resolveCoursePolicy({
      session,
      providerSettings: settings.provider,
      platformSettings: settings.platform,
      scenario,
      ticketProduct: ticket,
      allowedProduct: {
        redeem_open_minutes_before: ticket.allowed_redeem_open_minutes_before,
        redeem_close_minutes_after: ticket.allowed_redeem_close_minutes_after,
      },
      now,
    });
    const remainingUses = Number(ticket.remaining_uses_cache || 0);
    const heldUses = Number(ticket.active_holds || 0);
    const availableUses = remainingUses - heldUses;
    const reasons = [];
    if (String(session.status || '').toLowerCase() !== 'open') {
      reasons.push('場次目前未開放預約');
    }
    if (!['pending', 'active'].includes(String(ticket.status || '').toLowerCase())) reasons.push('票券狀態不可用');
    if (availableUses < 1) reasons.push('可用堂數不足');
    return {
      ticketId: Number(ticket.id),
      ticketCode: ticket.code,
      ticketProductId: Number(ticket.ticket_product_id),
      ticketProductName: ticket.ticket_product_name,
      scenarioPriority: Number(ticket.scenario_priority),
      remainingUses,
      heldUses,
      availableUses: Math.max(0, availableUses),
      rowVersion: Number(ticket.row_version || 1),
      holdEligible: reasons.length === 0,
      eligibleForAttendance: reasons.length === 0,
      eligibleForBooking: reasons.length === 0 && policy.canBook,
      eligible: reasons.length === 0,
      redeemableNow: reasons.length === 0 && policy.canRedeemOnsite,
      redeemable: reasons.length === 0 && policy.canRedeemOnsite,
      reasons,
      policy,
    };
  }

  async function getSessionEligibility({
    sessionId,
    userId,
    studentId = null,
    ownerEmail = '',
    ticketId = null,
    now = Date.now(),
    queryable = pool,
    forUpdate = false,
  }) {
    const session = await loadSession(queryable, sessionId, { forUpdate });
    if (!session || !['open', 'closed', 'completed'].includes(String(session.status || '').toLowerCase())) {
      throw domainError('COURSE_SESSION_NOT_FOUND', '找不到課程場次', 404);
    }
    const settings = settingsForSession(
      session,
      await loadSettings(queryable, session.owner_user_id)
    );
    const candidates = await loadTicketCandidates(queryable, {
      session,
      userId,
      studentId,
      ownerEmail,
      ticketId,
      forUpdate,
    });
    const tickets = candidates.map((candidate) => ticketEligibility(candidate, session, settings, now));
    const selected = selectEligibleTicket(tickets.map((item) => ({
      ...item,
      id: item.ticketId,
      status: item.eligible ? 'active' : 'unavailable',
      remainingUsesCache: item.remainingUses,
      activeHolds: item.heldUses,
      expiresAt: candidates.find((candidate) => Number(candidate.id) === item.ticketId)?.expires_at,
      issuedAt: candidates.find((candidate) => Number(candidate.id) === item.ticketId)?.issued_at,
    })));
    const basePolicy = resolveCoursePolicy({
      session,
      providerSettings: settings.provider,
      platformSettings: settings.platform,
      scenario: {
        redeem_open_minutes_before: session.scenario_redeem_open_minutes_before,
        redeem_close_minutes_after: session.scenario_redeem_close_minutes_after,
      },
      now,
    });
    return {
      session: {
        id: Number(session.id),
        code: session.code,
        title: session.title,
        scenarioId: session.scenario_id == null ? null : Number(session.scenario_id),
        scenarioName: session.scenario_name || '',
        status: session.status,
        rowVersion: Number(session.row_version || 1),
      },
      policy: basePolicy,
      tickets,
      selectedTicketId: selected ? Number(selected.ticketId ?? selected.id) : null,
      eligible: Boolean(
        String(session.status || '').toLowerCase() === 'open'
        && selected
        && basePolicy.canBook
      ),
      reason: String(session.status || '').toLowerCase() !== 'open'
        ? '場次目前未開放預約'
        : !basePolicy.canBook
        ? (taipeiDateTimeMs(now) < basePolicy.bookingOpenAt ? '尚未開放預約' : '預約已截止')
        : (!selected ? '沒有可用票券' : ''),
    };
  }

  async function getBookingPolicy(bookingId, { queryable = pool, now = Date.now(), forUpdate = false } = {}) {
    const [rows] = await queryable.query(
      `SELECT b.*, s.starts_at, s.ends_at, s.status AS session_status,
              s.owner_user_id, s.booking_open_at, s.booking_close_at,
              s.booking_open_minutes_before, s.booking_close_minutes_before,
              s.cancel_close_minutes_before, s.redeem_open_at, s.redeem_close_at,
              s.redeem_open_minutes_before, s.redeem_close_minutes_after,
              s.settings_snapshot_json, s.scenario_id,
              rs.redeem_open_minutes_before AS scenario_redeem_open_minutes_before,
              rs.redeem_close_minutes_after AS scenario_redeem_close_minutes_after,
              sap.redeem_open_minutes_before AS allowed_redeem_open_minutes_before,
              sap.redeem_close_minutes_after AS allowed_redeem_close_minutes_after,
              t.code AS ticket_code, t.row_version AS ticket_row_version,
              t.status AS ticket_status, t.frozen_at, t.expires_at, t.activation_deadline,
              t.remaining_uses_cache, t.remaining_uses,
              (SELECT COALESCE(SUM(h.quantity), 0)
                 FROM course_ticket_holds h
                WHERE h.ticket_id = t.id AND h.status = 'active') AS active_holds,
              t.product_redemption_policy_snapshot
         FROM course_bookings b
         JOIN course_sessions s ON s.id = b.session_id
         LEFT JOIN course_redeem_scenarios rs ON rs.id = s.scenario_id
         LEFT JOIN course_tickets t ON t.id = b.ticket_id
         LEFT JOIN course_scenario_allowed_products sap
           ON sap.scenario_id = s.scenario_id
          AND sap.ticket_product_id = t.ticket_product_id
        WHERE b.id = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [positiveInt(bookingId)]
    );
    const booking = rows[0];
    if (!booking) throw domainError('COURSE_BOOKING_NOT_FOUND', '找不到課程預約', 404);
    const settings = settingsForSession(
      booking,
      await loadSettings(queryable, booking.owner_user_id)
    );
    const policy = resolveCoursePolicy({
      session: booking,
      providerSettings: settings.provider,
      platformSettings: settings.platform,
      scenario: {
        redeem_open_minutes_before: booking.scenario_redeem_open_minutes_before,
        redeem_close_minutes_after: booking.scenario_redeem_close_minutes_after,
      },
      allowedProduct: {
        redeem_open_minutes_before: booking.allowed_redeem_open_minutes_before,
        redeem_close_minutes_after: booking.allowed_redeem_close_minutes_after,
      },
      ticketProduct: parseJson(booking.product_redemption_policy_snapshot, {}),
      now,
    });
    return {
      booking,
      policy,
      pendingReview: derivePendingReview(booking, policy, now),
    };
  }

  async function ledgerBalance(queryable, ticketId, { lockTicket = false } = {}) {
    const [ticketRows] = await queryable.query(
      `SELECT id, user_id, student_id, total_uses,
              product_class_count_snapshot, product_valid_days_snapshot,
              remaining_uses_cache, remaining_uses, row_version, status,
              activation_deadline, activated_at, expires_at, frozen_at, freeze_reason
         FROM course_tickets WHERE id = ? LIMIT 1${lockTicket ? ' FOR UPDATE' : ''}`,
      [positiveInt(ticketId)]
    );
    const ticket = ticketRows[0];
    if (!ticket) throw domainError('COURSE_TICKET_NOT_FOUND', '找不到課程票券', 404);
    const [[eventRow]] = await queryable.query(
      'SELECT COALESCE(SUM(delta_uses), 0) AS balance FROM course_usage_events WHERE ticket_id = ?',
      [ticket.id]
    );
    const [[holdRow]] = await queryable.query(
      "SELECT COALESCE(SUM(quantity), 0) AS active_holds FROM course_ticket_holds WHERE ticket_id = ? AND status = 'active'",
      [ticket.id]
    );
    const remainingUses = Number(eventRow?.balance || 0);
    const heldUses = Number(holdRow?.active_holds || 0);
    return {
      ticket,
      remainingUses,
      heldUses,
      availableUses: remainingUses - heldUses,
    };
  }

  async function syncTicketBalanceCache(conn, ticketId, balance = null, { activateOnConsume = false } = {}) {
    const current = balance || await ledgerBalance(conn, ticketId, { lockTicket: true });
    const [snapshotRows] = await conn.query(
      `SELECT status, activated_at, expires_at, product_valid_days_snapshot
         FROM course_tickets WHERE id = ? LIMIT 1 FOR UPDATE`,
      [ticketId]
    );
    const snapshot = snapshotRows[0] || current.ticket;
    const firstActivation = (
      activateOnConsume
      &&
      !snapshot.activated_at
      && ['pending', 'active'].includes(String(snapshot.status || '').toLowerCase())
      && current.remainingUses < Number(
        current.ticket.product_class_count_snapshot
        ?? current.ticket.total_uses
        ?? current.remainingUses
      )
    );
    const activatedAt = firstActivation ? mysqlDateTime(new Date()) : snapshot.activated_at;
    const validDays = Number(snapshot.product_valid_days_snapshot || 120);
    const expiresAt = firstActivation && !snapshot.expires_at
      ? taipeiDate(Date.now() + validDays * 86400000)
      : snapshot.expires_at;
    const currentStatus = String(snapshot.status || '').toLowerCase();
    let nextStatus = snapshot.status;
    if (
      current.remainingUses <= 0
      && ['pending', 'active', 'exhausted'].includes(currentStatus)
    ) {
      nextStatus = 'exhausted';
    } else if (current.remainingUses > 0 && currentStatus === 'exhausted') {
      // A compensating reversal/positive adjustment revives an exhausted
      // ticket without rewriting history. Activated tickets resume active;
      // never-activated tickets return to pending.
      nextStatus = activatedAt ? 'active' : 'pending';
    } else if (
      current.remainingUses > 0
      && currentStatus === 'pending'
      && firstActivation
    ) {
      nextStatus = 'active';
    }
    await conn.query(
      `UPDATE course_tickets
          SET remaining_uses_cache = ?, remaining_uses = ?, status = ?,
              activated_at = ?, expires_at = ?, row_version = row_version + 1
        WHERE id = ?`,
      [current.remainingUses, current.remainingUses, nextStatus, activatedAt, expiresAt, ticketId]
    );
    return {
      ticketId: Number(ticketId),
      remainingUses: current.remainingUses,
      heldUses: current.heldUses,
      availableUses: current.availableUses,
      ticketStatus: nextStatus,
      activatedAt,
      expiresAt,
      rowVersion: Number(current.ticket.row_version || 1) + 1,
    };
  }

  async function createHold(conn, { ticketId, bookingId = null, inviteId = null, expiresAt = null }) {
    const balance = await ledgerBalance(conn, ticketId, { lockTicket: true });
    const status = String(balance.ticket.status || '').toLowerCase();
    const today = taipeiDate();
    const expiryDate = balance.ticket.expires_at ? taipeiDate(balance.ticket.expires_at) : null;
    const activationDeadline = balance.ticket.activation_deadline
      ? taipeiDate(balance.ticket.activation_deadline)
      : null;
    if (!['pending', 'active'].includes(status)) {
      throw domainError('COURSE_TICKET_UNAVAILABLE', '票券狀態不可預約或核銷', 409);
    }
    if (balance.ticket.frozen_at) {
      throw domainError('COURSE_TICKET_FROZEN', '票券已凍結，無法保留堂數', 409);
    }
    if (expiryDate && expiryDate < today) {
      throw domainError('COURSE_TICKET_EXPIRED', '票券已過期', 409);
    }
    if (status === 'pending' && activationDeadline && activationDeadline < today) {
      throw domainError('COURSE_TICKET_ACTIVATION_EXPIRED', '票券已超過開卡期限', 409);
    }
    if (balance.availableUses < 1) {
      throw domainError('COURSE_TICKET_NO_AVAILABLE_USES', '票券可用堂數不足，請重新選擇', 409, balance);
    }
    const [result] = await conn.query(
      `INSERT INTO course_ticket_holds
        (ticket_id, booking_id, invite_id, quantity, status, expires_at, row_version)
       VALUES (?, ?, ?, 1, 'active', ?, 1)`,
      [ticketId, bookingId, inviteId, mysqlDateTime(expiresAt)]
    );
    const previousTicketRowVersion = Number(balance.ticket.row_version || 1);
    const [ticketUpdate] = await conn.query(
      `UPDATE course_tickets
          SET row_version = row_version + 1
        WHERE id = ? AND row_version = ?`,
      [ticketId, previousTicketRowVersion]
    );
    if (!ticketUpdate.affectedRows) {
      throw domainError('COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 409);
    }
    return {
      id: Number(result.insertId),
      ticketId: Number(ticketId),
      quantity: 1,
      status: 'active',
      availableUses: balance.availableUses - 1,
      rowVersion: 1,
      ticketRowVersion: previousTicketRowVersion + 1,
    };
  }

  async function releaseHold(conn, {
    bookingId = null,
    inviteId = null,
    actorUserId,
    reason = 'released',
  }) {
    const column = bookingId ? 'booking_id' : 'invite_id';
    const id = bookingId || inviteId;
    const [rows] = await conn.query(
      `SELECT * FROM course_ticket_holds
        WHERE ${column} = ? AND status = 'active'
        LIMIT 1 FOR UPDATE`,
      [id]
    );
    const hold = rows[0];
    if (!hold) return null;
    await conn.query(
      `UPDATE course_ticket_holds
          SET status = 'released', released_at = NOW(), released_by_user_id = ?,
              release_reason = ?, row_version = row_version + 1
        WHERE id = ? AND status = 'active'`,
      [actorUserId, text(reason, 100), hold.id]
    );
    const balance = await ledgerBalance(conn, hold.ticket_id, { lockTicket: true });
    const previousTicketRowVersion = Number(balance.ticket.row_version || 1);
    const [ticketUpdate] = await conn.query(
      `UPDATE course_tickets
          SET row_version = row_version + 1
        WHERE id = ? AND row_version = ?`,
      [hold.ticket_id, previousTicketRowVersion]
    );
    if (!ticketUpdate.affectedRows) {
      throw domainError('COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 409);
    }
    return {
      ...toTicketBalance({
        ...balance,
        id: hold.ticket_id,
        active_holds: balance.heldUses,
        row_version: previousTicketRowVersion + 1,
      }),
      holdId: Number(hold.id),
      ticketRowVersion: previousTicketRowVersion + 1,
    };
  }

  async function recordUsageEvent(conn, {
    ticketId = null,
    studentId = null,
    userId = null,
    attendeeEmail = '',
    sessionId = null,
    bookingId = null,
    inviteId = null,
    eventType,
    deltaUses,
    sourceType,
    sourceId = null,
    reversesEventId = null,
    idempotencyKey,
    anomaly = false,
    actorUserId,
    note = '',
    metadata = null,
    activateOnConsume = false,
    commandId = null,
  }) {
    let balanceAfter = 0;
    if (ticketId) {
      const balance = await ledgerBalance(conn, ticketId, { lockTicket: true });
      balanceAfter = balance.remainingUses + Number(deltaUses);
      if (balanceAfter < 0) {
        throw domainError('COURSE_TICKET_BALANCE_CONFLICT', '票券堂數不足，請重新載入', 409, balance);
      }
    }
    let eventMetadata = {
      ...(metadata && typeof metadata === 'object' ? metadata : {}),
      sourceType,
      sourceId: sourceId == null ? null : String(sourceId),
    };
    if (sessionId && (
      eventMetadata.scenarioId === undefined
      || eventMetadata.coachProfileId === undefined
      || eventMetadata.location === undefined
    )) {
      const [sessionRows] = await conn.query(
        `SELECT s.scenario_id, rs.name AS scenario_name,
                s.coach_profile_id, s.coach_name, s.location
           FROM course_sessions s
           LEFT JOIN course_redeem_scenarios rs ON rs.id = s.scenario_id
          WHERE s.id = ? LIMIT 1`,
        [sessionId]
      );
      const session = sessionRows[0] || {};
      eventMetadata = {
        scenarioId: session.scenario_id == null ? null : Number(session.scenario_id),
        scenarioName: session.scenario_name || '',
        coachProfileId: session.coach_profile_id == null
          ? null
          : Number(session.coach_profile_id),
        coachName: session.coach_name || '',
        location: session.location || '',
        ...eventMetadata,
      };
    }
    const [result] = await conn.query(
      `INSERT INTO course_usage_events
        (command_id, ticket_id, student_id, user_id, session_id, booking_id, invite_id,
         event_type, delta_uses, balance_after, source_type, source_id,
         reverses_event_id, idempotency_key, is_anomaly, actor_user_id, note, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        commandId,
        ticketId,
        studentId,
        userId,
        sessionId,
        bookingId,
        inviteId,
        eventType,
        Number(deltaUses),
        balanceAfter,
        sourceType,
        sourceId == null ? null : String(sourceId),
        reversesEventId,
        idempotencyKey,
        anomaly ? 1 : 0,
        actorUserId,
        text(note, 500) || null,
        JSON.stringify(eventMetadata),
      ]
    );
    if (ticketId) await syncTicketBalanceCache(conn, ticketId, null, { activateOnConsume });
    return {
      id: Number(result.insertId),
      eventType,
      deltaUses: Number(deltaUses),
      balanceAfter,
      anomaly: Boolean(anomaly),
    };
  }

  async function recordIssuance(conn, {
    ticketId,
    studentId = null,
    userId,
    totalUses,
    actorUserId,
    idempotencyKey,
    sourceType = 'ticket_issue',
    sourceId = null,
    commandId = null,
  }) {
    const [existing] = await conn.query(
      "SELECT id FROM course_usage_events WHERE ticket_id = ? AND event_type = 'ISSUANCE' LIMIT 1",
      [ticketId]
    );
    if (existing.length) return { id: Number(existing[0].id), replay: true };
    return recordUsageEvent(conn, {
      ticketId,
      studentId,
      userId,
      eventType: 'ISSUANCE',
      deltaUses: positiveInt(totalUses, 1),
      sourceType,
      sourceId: sourceId || ticketId,
      idempotencyKey: idempotencyKey || `issuance:${ticketId}`,
      actorUserId,
      commandId,
    });
  }

  async function consumeAttendance(conn, {
    bookingId,
    eventType,
    actorUserId,
    idempotencyKey,
    note = '',
    allowOutsideWindow = false,
    requireOutsideWindow = false,
    expectedRowVersion = null,
    inviteId = null,
    commandId = null,
  }) {
    if (!ATTENDANCE_EVENT_TYPES.has(eventType)) {
      throw domainError('COURSE_ATTENDANCE_ACTION_INVALID', '出席操作不正確', 400);
    }
    const [rows] = await conn.query(
      `SELECT b.*, s.starts_at, s.ends_at, s.status AS session_status, s.owner_user_id,
              s.location, s.coach_profile_id, s.coach_name,
              s.booking_open_at, s.booking_close_at, s.booking_open_minutes_before,
              s.booking_close_minutes_before, s.cancel_close_minutes_before,
              s.redeem_open_at, s.redeem_close_at, s.redeem_open_minutes_before,
              s.redeem_close_minutes_after, s.settings_snapshot_json, s.scenario_id,
              rs.name AS scenario_name,
              rs.redeem_open_minutes_before AS scenario_redeem_open_minutes_before,
              rs.redeem_close_minutes_after AS scenario_redeem_close_minutes_after,
              sap.redeem_open_minutes_before AS allowed_redeem_open_minutes_before,
              sap.redeem_close_minutes_after AS allowed_redeem_close_minutes_after,
              t.row_version AS ticket_row_version, t.ticket_product_id,
              t.status AS ticket_status, t.frozen_at, t.expires_at, t.activation_deadline,
              COALESCE(t.remaining_uses_cache, t.remaining_uses, 0) AS ticket_remaining_uses,
              COALESCE(t.product_redemption_policy_snapshot, tp.redemption_policy_json) AS redemption_policy_json
         FROM course_bookings b
         JOIN course_sessions s ON s.id = b.session_id
         LEFT JOIN course_redeem_scenarios rs ON rs.id = s.scenario_id
         LEFT JOIN course_tickets t ON t.id = b.ticket_id
         LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
         LEFT JOIN course_scenario_allowed_products sap
           ON sap.scenario_id = s.scenario_id
          AND sap.ticket_product_id = t.ticket_product_id
        WHERE b.id = ?
        LIMIT 1 FOR UPDATE`,
      [positiveInt(bookingId)]
    );
    const booking = rows[0];
    if (!booking) throw domainError('COURSE_BOOKING_NOT_FOUND', '找不到課程預約', 404);
    if (expectedRowVersion && Number(booking.row_version || 1) !== Number(expectedRowVersion)) {
      throw domainError('COURSE_ROW_VERSION_CONFLICT', '預約已變更，請重新載入', 409);
    }
    if (String(booking.status) !== 'booked') {
      throw domainError('COURSE_BOOKING_NOT_REDEEMABLE', '此預約目前不能核銷', 409);
    }
    const settings = settingsForSession(
      booking,
      await loadSettings(conn, booking.owner_user_id)
    );
    const redemptionPolicy = parseJson(booking.redemption_policy_json, {});
    const policy = resolveCoursePolicy({
      session: booking,
      providerSettings: settings.provider,
      platformSettings: settings.platform,
      scenario: {
        redeem_open_minutes_before: booking.scenario_redeem_open_minutes_before,
        redeem_close_minutes_after: booking.scenario_redeem_close_minutes_after,
      },
      allowedProduct: {
        redeem_open_minutes_before: booking.allowed_redeem_open_minutes_before,
        redeem_close_minutes_after: booking.allowed_redeem_close_minutes_after,
      },
      ticketProduct: redemptionPolicy,
    });
    if (!allowOutsideWindow && !policy.canRedeemOnsite) {
      throw domainError('COURSE_REDEMPTION_OUTSIDE_WINDOW', '目前不在現場核銷時間窗內', 409, policy);
    }
    if (requireOutsideWindow && Date.now() <= Number(policy.redeemCloseAt)) {
      throw domainError(
        'COURSE_MAKEUP_TOO_EARLY',
        policy.canRedeemOnsite
          ? '目前仍在現場核銷時間窗，請使用一般出席'
          : '補登核銷只能在現場核銷截止後執行',
        409,
        policy
      );
    }
    const [holdRows] = await conn.query(
      "SELECT * FROM course_ticket_holds WHERE booking_id = ? AND status = 'active' LIMIT 1 FOR UPDATE",
      [booking.id]
    );
    const hold = holdRows[0] || null;
    const attendanceUsage = resolveAttendanceUsage(eventType, {
      ticketId: booking.ticket_id,
      hold,
    });
    const { hasTicket, deltaUses } = attendanceUsage;
    const now = Date.now();
    if (eventType === 'NO_SHOW' && now < taipeiDateTimeMs(booking.starts_at)) {
      throw domainError('COURSE_NO_SHOW_TOO_EARLY', '場次開始後才能標記 NO SHOW', 409);
    }
    if (hasTicket) {
      if (booking.frozen_at) {
        throw domainError('COURSE_TICKET_FROZEN', '票券已凍結，不能核銷或扣次', 409);
      }
      if (!['pending', 'active'].includes(String(booking.ticket_status || '').toLowerCase())) {
        throw domainError('COURSE_TICKET_UNAVAILABLE', '票券狀態不可核銷或扣次', 409);
      }
      const today = taipeiDate();
      const expiresAt = booking.expires_at ? taipeiDate(booking.expires_at) : null;
      const activationDeadline = booking.activation_deadline
        ? taipeiDate(booking.activation_deadline)
        : null;
      if (expiresAt && expiresAt < today) {
        throw domainError('COURSE_TICKET_EXPIRED', '票券已過期，不能核銷或扣次', 409);
      }
      if (
        String(booking.ticket_status).toLowerCase() === 'pending'
        && activationDeadline
        && activationDeadline < today
      ) {
        throw domainError('COURSE_TICKET_ACTIVATION_EXPIRED', '票券已超過開卡期限', 409);
      }
    }
    const event = await recordUsageEvent(conn, {
      ticketId: hasTicket ? booking.ticket_id : null,
      studentId: booking.student_id || null,
      userId: booking.user_id || null,
      sessionId: booking.session_id,
      bookingId: booking.id,
      inviteId,
      eventType,
      deltaUses,
      sourceType: inviteId ? 'attendance_invite_attempt' : 'booking_attempt',
      sourceId: mutationSourceId(inviteId || booking.id, idempotencyKey, commandId),
      idempotencyKey,
      anomaly: attendanceUsage.anomaly,
      actorUserId,
      note,
      metadata: {
        outsideWindow: !policy.canRedeemOnsite,
        method: inviteId ? 'attendance_invite' : (requireOutsideWindow ? 'makeup_redeem' : 'onsite'),
        scenarioId: booking.scenario_id == null ? null : Number(booking.scenario_id),
        scenarioName: booking.scenario_name || '',
        coachProfileId: booking.coach_profile_id == null ? null : Number(booking.coach_profile_id),
        coachName: booking.coach_name || '',
        location: booking.location || '',
        source: inviteId ? 'attendance_invite_attempt' : 'booking_attempt',
      },
      activateOnConsume: true,
      commandId,
    });
    const nextStatus = eventType === 'SUCCESS' ? 'attended' : 'no_show';
    const [bookingUpdate] = await conn.query(
      `UPDATE course_bookings
          SET status = ?, attended_at = IF(? = 'attended', NOW(), attended_at),
              row_version = row_version + 1
        WHERE id = ? AND status = 'booked'`,
      [nextStatus, nextStatus, booking.id]
    );
    if (!bookingUpdate.affectedRows) {
      throw domainError('COURSE_ROW_VERSION_CONFLICT', '預約狀態已變更，請重新載入', 409);
    }
    if (hold) {
      await conn.query(
        `UPDATE course_ticket_holds
            SET status = 'consumed', consumed_at = NOW(), consumed_usage_event_id = ?,
                row_version = row_version + 1
          WHERE id = ? AND status = 'active'`,
        [event.id, hold.id]
      );
    }
    if (booking.ticket_id && actorUserId) {
      await conn.query(
        `INSERT IGNORE INTO course_attendance_logs
          (session_id, booking_id, ticket_id, user_id, action, quantity, staff_user_id, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          booking.session_id,
          booking.id,
          booking.ticket_id,
          booking.user_id,
          eventType === 'SUCCESS' ? 'redeem' : 'no_show',
          Math.abs(deltaUses),
          actorUserId,
          text(note, 500) || null,
        ]
      );
    }
    return {
      bookingId: Number(booking.id),
      status: nextStatus,
      usageEvent: event,
      policy,
      rowVersion: Number(booking.row_version || 1) + 1,
      balance: hasTicket ? await ledgerBalance(conn, booking.ticket_id) : null,
    };
  }

  async function attendanceAction({
    bookingId,
    action,
    actorUserId,
    idempotencyKey,
    expectedRowVersion,
    note = '',
  }) {
    await assertMutationAllowed();
    await assertSchema();
    expectedRowVersion = requireRowVersion(expectedRowVersion, '預約');
    const operation = `booking.${action}`;
    return withMutationTransaction(async (conn) => {
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { bookingId: Number(bookingId), action, expectedRowVersion, note: text(note, 500) },
        resourceType: 'booking',
        resourceId: bookingId,
      });
      if (mutation.replay) return mutation.replay;
      const usageIdempotencyKey = scopedEventIdempotency(operation, idempotencyKey);
      let result;
      if (action === 'attend' || action === 'makeup-redeem' || action === 'no-show') {
        result = await consumeAttendance(conn, {
          bookingId,
          eventType: action === 'no-show' ? 'NO_SHOW' : 'SUCCESS',
          actorUserId,
          idempotencyKey: usageIdempotencyKey,
          note,
          allowOutsideWindow: action === 'makeup-redeem' || action === 'no-show',
          requireOutsideWindow: action === 'makeup-redeem',
          expectedRowVersion,
          commandId: mutation.commandId,
        });
      } else if (action === 'excused-leave') {
        const [bookingRows] = await conn.query(
          'SELECT * FROM course_bookings WHERE id = ? LIMIT 1 FOR UPDATE',
          [positiveInt(bookingId)]
        );
        const booking = bookingRows[0];
        if (!booking) throw domainError('COURSE_BOOKING_NOT_FOUND', '找不到課程預約', 404);
        if (expectedRowVersion && Number(booking.row_version || 1) !== Number(expectedRowVersion)) {
          throw domainError('COURSE_ROW_VERSION_CONFLICT', '預約已變更，請重新載入', 409);
        }
        if (booking.status !== 'booked') throw domainError('COURSE_BOOKING_STATUS_LOCKED', '此預約不能請假', 409);
        await releaseHold(conn, { bookingId: booking.id, actorUserId, reason: 'excused_leave' });
        await conn.query(
          `UPDATE course_bookings
              SET status = 'cancelled', cancelled_at = NOW(), row_version = row_version + 1
            WHERE id = ? AND status = 'booked'`,
          [booking.id]
        );
        const event = await recordUsageEvent(conn, {
          ticketId: booking.ticket_id,
          studentId: booking.student_id || null,
          userId: booking.user_id,
          sessionId: booking.session_id,
          bookingId: booking.id,
          eventType: 'EXCUSED_LEAVE',
          deltaUses: 0,
          sourceType: 'booking',
          sourceId: booking.id,
          idempotencyKey: usageIdempotencyKey,
          actorUserId,
          note,
          commandId: mutation.commandId,
        });
        result = { bookingId: Number(booking.id), status: 'cancelled', usageEvent: event, rowVersion: Number(booking.row_version || 1) + 1 };
      } else if (action === 'undo') {
        result = await undoAttendance(conn, {
          bookingId,
          actorUserId,
          idempotencyKey: usageIdempotencyKey,
          expectedRowVersion,
          note,
          commandId: mutation.commandId,
        });
      } else {
        throw domainError('COURSE_ATTENDANCE_ACTION_INVALID', '未知的課程出席操作', 400);
      }
      await completeMutation(conn, actorUserId, operation, mutation, result, { type: 'booking', id: bookingId });
      return result;
    });
  }

  async function undoAttendance(conn, {
    bookingId,
    actorUserId,
    idempotencyKey,
    expectedRowVersion,
    note,
    commandId = null,
  }) {
    const [bookingRows] = await conn.query(
      `SELECT b.*, s.*, b.id AS id, b.row_version AS row_version,
              b.session_id AS session_id, b.ticket_id AS ticket_id, b.user_id AS user_id,
              rs.redeem_open_minutes_before AS scenario_redeem_open_minutes_before,
              rs.redeem_close_minutes_after AS scenario_redeem_close_minutes_after,
              sap.redeem_open_minutes_before AS allowed_redeem_open_minutes_before,
              sap.redeem_close_minutes_after AS allowed_redeem_close_minutes_after,
              t.product_redemption_policy_snapshot
         FROM course_bookings b JOIN course_sessions s ON s.id = b.session_id
         LEFT JOIN course_redeem_scenarios rs ON rs.id = s.scenario_id
         LEFT JOIN course_tickets t ON t.id = b.ticket_id
         LEFT JOIN course_scenario_allowed_products sap
           ON sap.scenario_id = s.scenario_id
          AND sap.ticket_product_id = t.ticket_product_id
        WHERE b.id = ? LIMIT 1 FOR UPDATE`,
      [positiveInt(bookingId)]
    );
    const booking = bookingRows[0];
    if (!booking) throw domainError('COURSE_BOOKING_NOT_FOUND', '找不到課程預約', 404);
    if (!['attended', 'no_show'].includes(booking.status)) {
      throw domainError('COURSE_UNDO_NOT_ALLOWED', '目前狀態不能撤銷', 409);
    }
    if (expectedRowVersion && Number(booking.row_version || 1) !== Number(expectedRowVersion)) {
      throw domainError('COURSE_ROW_VERSION_CONFLICT', '預約已變更，請重新載入', 409);
    }
    const settings = settingsForSession(
      booking,
      await loadSettings(conn, booking.owner_user_id)
    );
    const policy = resolveCoursePolicy({
      session: booking,
      providerSettings: settings.provider,
      platformSettings: settings.platform,
      scenario: {
        redeem_open_minutes_before: booking.scenario_redeem_open_minutes_before,
        redeem_close_minutes_after: booking.scenario_redeem_close_minutes_after,
      },
      allowedProduct: {
        redeem_open_minutes_before: booking.allowed_redeem_open_minutes_before,
        redeem_close_minutes_after: booking.allowed_redeem_close_minutes_after,
      },
      ticketProduct: parseJson(booking.product_redemption_policy_snapshot, {}),
    });
    if (!policy.canRedeemOnsite) {
      throw domainError('COURSE_UNDO_OUTSIDE_WINDOW', '僅能在現場核銷時間窗內撤銷', 409, policy);
    }
    const [eventRows] = await conn.query(
      `SELECT * FROM course_usage_events
        WHERE booking_id = ? AND event_type IN ('SUCCESS','NO_SHOW')
          AND NOT EXISTS (
            SELECT 1 FROM course_usage_events reversal WHERE reversal.reverses_event_id = course_usage_events.id
          )
        ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [booking.id]
    );
    const original = eventRows[0];
    if (!original) throw domainError('COURSE_USAGE_EVENT_NOT_FOUND', '找不到可撤銷的扣次事件', 409);
    const event = await recordUsageEvent(conn, {
      ticketId: original.ticket_id,
      studentId: original.student_id,
      userId: original.user_id,
      sessionId: original.session_id,
      bookingId: original.booking_id,
      inviteId: original.invite_id,
      eventType: `${original.event_type}_REVERSAL`,
      deltaUses: -Number(original.delta_uses),
      sourceType: 'usage_event_reversal',
      sourceId: original.id,
      reversesEventId: original.id,
      idempotencyKey,
      actorUserId,
      note,
      commandId,
    });
    await conn.query(
      `UPDATE course_bookings
          SET status = 'booked', attended_at = NULL, row_version = row_version + 1
        WHERE id = ?`,
      [booking.id]
    );
    const hold = original.ticket_id
      ? await createHold(conn, { ticketId: original.ticket_id, bookingId: booking.id })
      : null;
    await conn.query(
      "UPDATE course_attendance_logs SET action = CONCAT('u', id) WHERE booking_id = ? AND action IN ('redeem','no_show')",
      [booking.id]
    );
    return {
      bookingId: Number(booking.id),
      status: 'booked',
      usageEvent: event,
      hold,
      rowVersion: Number(booking.row_version || 1) + 1,
    };
  }

  async function adjustTicket({
    ticketId,
    deltaUses,
    actorUserId,
    idempotencyKey,
    expectedRowVersion,
    note = '',
    reason = 'manual',
  }) {
    await assertMutationAllowed();
    await assertSchema();
    expectedRowVersion = requireRowVersion(expectedRowVersion, '票券');
    const delta = integer(deltaUses);
    if (!delta || Math.abs(delta) > 9999) {
      throw domainError('COURSE_ADJUSTMENT_INVALID', '調整堂數不可為 0，且需在合理範圍內', 400);
    }
    return withMutationTransaction(async (conn) => {
      const operation = 'ticket.adjust';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { ticketId: Number(ticketId), delta, expectedRowVersion, reason, note: text(note, 500) },
        resourceType: 'ticket',
        resourceId: ticketId,
      });
      if (mutation.replay) return mutation.replay;
      const balance = await ledgerBalance(conn, ticketId, { lockTicket: true });
      if (expectedRowVersion && Number(balance.ticket.row_version || 1) !== Number(expectedRowVersion)) {
        throw domainError('COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 409);
      }
      if (balance.remainingUses + delta < balance.heldUses) {
        throw domainError('COURSE_TICKET_BALANCE_CONFLICT', '調整後堂數不可低於已保留堂數', 409, balance);
      }
      const event = await recordUsageEvent(conn, {
        ticketId,
        studentId: balance.ticket.student_id || null,
        userId: balance.ticket.user_id || null,
        eventType: 'ADJUSTMENT',
        deltaUses: delta,
        sourceType: 'manual_adjustment',
        sourceId: mutationSourceId(ticketId, idempotencyKey, mutation.commandId),
        idempotencyKey,
        actorUserId,
        note,
        metadata: { reason },
        commandId: mutation.commandId,
      });
      const result = {
        ticketId: Number(ticketId),
        usageEvent: event,
        balance: await ledgerBalance(conn, ticketId),
      };
      await completeMutation(conn, actorUserId, operation, mutation, result, { type: 'ticket', id: ticketId });
      return result;
    });
  }

  async function refundTicket({
    ticketId,
    actorUserId,
    idempotencyKey,
    expectedRowVersion,
    note = '',
    reason = 'refund',
  }) {
    await assertMutationAllowed();
    await assertSchema();
    expectedRowVersion = requireRowVersion(expectedRowVersion, '票券');
    return withMutationTransaction(async (conn) => {
      const operation = 'ticket.refund';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: {
          ticketId: Number(ticketId),
          expectedRowVersion,
          reason: text(reason, 100),
          note: text(note, 500),
        },
        resourceType: 'ticket',
        resourceId: ticketId,
      });
      if (mutation.replay) return mutation.replay;
      const balance = await ledgerBalance(conn, ticketId, { lockTicket: true });
      if (Number(balance.ticket.row_version || 1) !== Number(expectedRowVersion)) {
        throw domainError('COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 409);
      }
      if (balance.heldUses > 0) {
        throw domainError('COURSE_TICKET_ACTIVE_HOLD', '票券仍有保留堂數，請先處理預約或邀請', 409);
      }
      if (String(balance.ticket.status || '').toLowerCase() === 'void') {
        throw domainError('COURSE_TICKET_ALREADY_REFUNDED', '票券已退款作廢', 409);
      }
      const deltaUses = -Math.max(0, Number(balance.remainingUses || 0));
      const event = await recordUsageEvent(conn, {
        ticketId,
        studentId: balance.ticket.student_id || null,
        userId: balance.ticket.user_id || null,
        eventType: 'REFUND',
        deltaUses,
        sourceType: 'refund',
        sourceId: mutationSourceId(ticketId, idempotencyKey, mutation.commandId),
        idempotencyKey,
        actorUserId,
        note,
        metadata: { reason: text(reason, 100) || 'refund' },
        commandId: mutation.commandId,
      });
      const afterEvent = await ledgerBalance(conn, ticketId, { lockTicket: true });
      const afterEventRowVersion = Number(afterEvent.ticket.row_version || 1);
      const [updated] = await conn.query(
        `UPDATE course_tickets
            SET status = 'void', row_version = row_version + 1
          WHERE id = ? AND row_version = ?`,
        [ticketId, afterEventRowVersion]
      );
      if (!updated.affectedRows) {
        throw domainError('COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 409);
      }
      const result = {
        ticketId: Number(ticketId),
        status: 'void',
        usageEvent: event,
        refundedUses: Math.abs(deltaUses),
        balance: {
          remainingUses: afterEvent.remainingUses,
          heldUses: afterEvent.heldUses,
          availableUses: afterEvent.availableUses,
          rowVersion: afterEventRowVersion + 1,
        },
      };
      await completeMutation(conn, actorUserId, operation, mutation, result, {
        type: 'ticket',
        id: ticketId,
      });
      return result;
    });
  }

  async function cancelBooking({
    bookingId,
    actorUserId,
    userId = null,
    idempotencyKey,
    expectedRowVersion,
    reason = 'member_cancelled',
    enforceWindow = true,
  }) {
    await assertMutationAllowed();
    await assertSchema();
    expectedRowVersion = requireRowVersion(expectedRowVersion, '預約');
    return withMutationTransaction(async (conn) => {
      const operation = 'booking.cancel';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { bookingId: Number(bookingId), expectedRowVersion, reason },
        resourceType: 'booking',
        resourceId: bookingId,
      });
      if (mutation.replay) return mutation.replay;
      const [rows] = await conn.query(
        `SELECT b.*, s.starts_at, s.ends_at, s.owner_user_id, s.booking_open_at, s.booking_close_at,
                s.booking_open_minutes_before, s.booking_close_minutes_before,
                s.cancel_close_minutes_before, s.redeem_open_at, s.redeem_close_at,
                s.redeem_open_minutes_before, s.redeem_close_minutes_after,
                s.settings_snapshot_json
           FROM course_bookings b JOIN course_sessions s ON s.id = b.session_id
          WHERE b.id = ?${userId ? ' AND b.user_id = ?' : ''}
          LIMIT 1 FOR UPDATE`,
        [positiveInt(bookingId), ...(userId ? [userId] : [])]
      );
      const booking = rows[0];
      if (!booking) throw domainError('COURSE_BOOKING_NOT_FOUND', '找不到課程預約', 404);
      if (booking.status !== 'booked') throw domainError('COURSE_BOOKING_STATUS_LOCKED', '此預約不能取消', 409);
      if (expectedRowVersion && Number(booking.row_version || 1) !== Number(expectedRowVersion)) {
        throw domainError('COURSE_ROW_VERSION_CONFLICT', '預約已變更，請重新載入', 409);
      }
      const settings = settingsForSession(
        booking,
        await loadSettings(conn, booking.owner_user_id)
      );
      const policy = resolveCoursePolicy({
        session: booking,
        providerSettings: settings.provider,
        platformSettings: settings.platform,
      });
      if (enforceWindow && !policy.canCancel) {
        throw domainError('COURSE_BOOKING_CANCEL_CLOSED', '已超過取消截止時間', 409, policy);
      }
      const hold = await releaseHold(conn, { bookingId: booking.id, actorUserId, reason });
      await conn.query(
        `UPDATE course_bookings
            SET status = 'cancelled', cancelled_at = NOW(), row_version = row_version + 1
          WHERE id = ? AND status = 'booked'`,
        [booking.id]
      );
      const result = {
        bookingId: Number(booking.id),
        status: 'cancelled',
        hold,
        policy,
        rowVersion: Number(booking.row_version || 1) + 1,
      };
      await completeMutation(conn, actorUserId, operation, mutation, result, { type: 'booking', id: booking.id });
      return result;
    });
  }

  async function changeTicketState({
    ticketId,
    userId,
    actorUserId = userId,
    action,
    reason = '',
    idempotencyKey,
    expectedRowVersion,
  }) {
    await assertMutationAllowed();
    await assertSchema();
    expectedRowVersion = requireRowVersion(expectedRowVersion, '票券');
    if (!['pause', 'resume'].includes(action)) {
      throw domainError('COURSE_TICKET_STATE_ACTION_INVALID', '票券狀態操作不正確', 400);
    }
    if (action === 'pause' && !text(reason, 500)) {
      throw domainError('VALIDATION_ERROR', '請填寫暫停原因', 400);
    }
    return withMutationTransaction(async (conn) => {
      const operation = `ticket.${action}`;
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: {
          ticketId: Number(ticketId),
          expectedRowVersion,
          reason: text(reason, 500),
        },
        resourceType: 'ticket',
        resourceId: ticketId,
      });
      if (mutation.replay) return mutation.replay;
      const [ticketRows] = await conn.query(
        'SELECT * FROM course_tickets WHERE id = ? LIMIT 1 FOR UPDATE',
        [positiveInt(ticketId)]
      );
      const ticket = ticketRows[0];
      if (!ticket || (userId && String(ticket.user_id) !== String(userId))) {
        throw domainError('COURSE_TICKET_NOT_FOUND', '找不到課程票券', 404);
      }
      if (Number(ticket.row_version || 1) !== expectedRowVersion) {
        throw domainError('COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 409);
      }
      if (ticket.frozen_at) {
        throw domainError('COURSE_TICKET_FROZEN', '票券已凍結，解除凍結後才能暫停或恢復', 409);
      }
      const balance = await ledgerBalance(conn, ticket.id);
      let extensionDays = 0;
      let nextStatus;
      if (action === 'pause') {
        if (ticket.status !== 'active' || balance.remainingUses <= 0) {
          throw domainError('COURSE_TICKET_PAUSE_FAIL', '此票券目前無法暫停', 409);
        }
        if (balance.heldUses > 0) {
          throw domainError('COURSE_TICKET_ACTIVE_HOLD', '票券仍有保留堂數，請先取消預約或邀請', 409);
        }
        await conn.query(
          `INSERT INTO course_ticket_state_periods
            (ticket_id, state, started_at, reason, actor_user_id)
           VALUES (?, 'paused', NOW(), ?, ?)`,
          [ticket.id, text(reason, 500), actorUserId]
        );
        const [updated] = await conn.query(
          `UPDATE course_tickets
              SET status = 'paused', paused_at = NOW(), pause_reason = ?,
                  row_version = row_version + 1
            WHERE id = ? AND row_version = ? AND status = 'active'`,
          [text(reason, 500), ticket.id, expectedRowVersion]
        );
        if (!updated.affectedRows) {
          throw domainError('COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 409);
        }
        nextStatus = 'paused';
      } else {
        if (ticket.status !== 'paused') {
          throw domainError('COURSE_TICKET_RESUME_FAIL', '此票券目前無法恢復', 409);
        }
        const [periodRows] = await conn.query(
          `SELECT * FROM course_ticket_state_periods
            WHERE ticket_id = ? AND state = 'paused' AND ended_at IS NULL
            ORDER BY id DESC LIMIT 1 FOR UPDATE`,
          [ticket.id]
        );
        const period = periodRows[0];
        if (!period) {
          throw domainError('COURSE_TICKET_STATE_PERIOD_MISSING', '找不到票券暫停期間，需人工處理', 409);
        }
        extensionDays = Math.max(
          1,
          Math.ceil((Date.now() - taipeiDateTimeMs(period.started_at)) / 86400000)
        );
        nextStatus = balance.remainingUses > 0
          ? (ticket.activated_at ? 'active' : 'pending')
          : 'exhausted';
        const [updated] = await conn.query(
          `UPDATE course_tickets
              SET status = ?, paused_at = NULL, pause_reason = NULL,
                  expires_at = IF(expires_at IS NULL, NULL, DATE_ADD(expires_at, INTERVAL ? DAY)),
                  activation_deadline = IF(
                    activated_at IS NULL AND activation_deadline IS NOT NULL,
                    DATE_ADD(activation_deadline, INTERVAL ? DAY),
                    activation_deadline
                  ),
                  row_version = row_version + 1
            WHERE id = ? AND row_version = ? AND status = 'paused'`,
          [nextStatus, extensionDays, extensionDays, ticket.id, expectedRowVersion]
        );
        if (!updated.affectedRows) {
          throw domainError('COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 409);
        }
        await conn.query(
          `UPDATE course_ticket_state_periods
              SET ended_at = NOW(), extension_days = ?
            WHERE id = ? AND ended_at IS NULL`,
          [extensionDays, period.id]
        );
      }
      const result = {
        ticketId: Number(ticket.id),
        status: nextStatus,
        extensionDays,
        rowVersion: expectedRowVersion + 1,
      };
      await completeMutation(conn, actorUserId, operation, mutation, result, {
        type: 'ticket',
        id: ticket.id,
      });
      return result;
    });
  }

  async function changeTicketFreeze({
    ticketId,
    actorUserId,
    action,
    reason = '',
    idempotencyKey,
    expectedRowVersion,
  }) {
    await assertMutationAllowed();
    await assertSchema();
    expectedRowVersion = requireRowVersion(expectedRowVersion, '票券');
    if (!['freeze', 'unfreeze'].includes(action)) {
      throw domainError('COURSE_TICKET_FREEZE_ACTION_INVALID', '票券凍結操作不正確', 400);
    }
    if (action === 'freeze' && !text(reason, 500)) {
      throw domainError('VALIDATION_ERROR', '請填寫凍結原因', 400);
    }
    return withMutationTransaction(async (conn) => {
      const operation = `ticket.${action}`;
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: {
          ticketId: Number(ticketId),
          expectedRowVersion,
          reason: text(reason, 500),
        },
        resourceType: 'ticket',
        resourceId: ticketId,
      });
      if (mutation.replay) return mutation.replay;
      const balance = await ledgerBalance(conn, ticketId, { lockTicket: true });
      const ticket = balance.ticket;
      if (Number(ticket.row_version || 1) !== expectedRowVersion) {
        throw domainError('COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 409);
      }
      if (action === 'freeze') {
        if (ticket.frozen_at) throw domainError('COURSE_TICKET_ALREADY_FROZEN', '票券已凍結', 409);
        if (balance.heldUses > 0) {
          throw domainError('COURSE_TICKET_ACTIVE_HOLD', '票券仍有保留堂數，請先處理預約或邀請', 409);
        }
        await conn.query(
          `INSERT INTO course_ticket_state_periods
            (ticket_id, state, started_at, reason, actor_user_id, metadata_json)
           VALUES (?, 'frozen', NOW(), ?, ?, ?)`,
          [
            ticket.id,
            text(reason, 500),
            actorUserId,
            JSON.stringify({ underlyingStatus: ticket.status }),
          ]
        );
        const [updated] = await conn.query(
          `UPDATE course_tickets
              SET frozen_at = NOW(), freeze_reason = ?, row_version = row_version + 1
            WHERE id = ? AND row_version = ? AND frozen_at IS NULL`,
          [text(reason, 500), ticket.id, expectedRowVersion]
        );
        if (!updated.affectedRows) {
          throw domainError('COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 409);
        }
      } else {
        if (!ticket.frozen_at) throw domainError('COURSE_TICKET_NOT_FROZEN', '票券目前未凍結', 409);
        const [periodRows] = await conn.query(
          `SELECT id FROM course_ticket_state_periods
            WHERE ticket_id = ? AND state = 'frozen' AND ended_at IS NULL
            ORDER BY id DESC LIMIT 1 FOR UPDATE`,
          [ticket.id]
        );
        if (!periodRows[0]) {
          throw domainError('COURSE_TICKET_STATE_PERIOD_MISSING', '找不到票券凍結期間，需人工處理', 409);
        }
        const [updated] = await conn.query(
          `UPDATE course_tickets
              SET frozen_at = NULL, freeze_reason = NULL, row_version = row_version + 1
            WHERE id = ? AND row_version = ? AND frozen_at IS NOT NULL`,
          [ticket.id, expectedRowVersion]
        );
        if (!updated.affectedRows) {
          throw domainError('COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 409);
        }
        await conn.query(
          'UPDATE course_ticket_state_periods SET ended_at = NOW() WHERE id = ? AND ended_at IS NULL',
          [periodRows[0].id]
        );
      }
      const result = {
        ticketId: Number(ticket.id),
        frozen: action === 'freeze',
        rowVersion: expectedRowVersion + 1,
      };
      await completeMutation(conn, actorUserId, operation, mutation, result, {
        type: 'ticket',
        id: ticket.id,
      });
      return result;
    });
  }

  async function listTicketLedger({ ticketId, userId = null, limit = 100, queryable = pool }) {
    const params = [positiveInt(ticketId)];
    const ownerWhere = userId
      ? 'AND (t.user_id = ? OR (t.user_id IS NULL AND student.user_id = ?))'
      : '';
    if (userId) params.push(userId, userId);
    params.push(Math.min(positiveInt(limit, 100), 500));
    const [rows] = await queryable.query(
      `SELECT e.*
         FROM course_usage_events e
         LEFT JOIN course_tickets t ON t.id = e.ticket_id
         LEFT JOIN course_students student ON student.id = t.student_id
        WHERE e.ticket_id = ? ${ownerWhere}
        ORDER BY e.occurred_at DESC, e.id DESC
        LIMIT ?`,
      params
    );
    return rows.map((row) => ({
      id: Number(row.id),
      ticketId: row.ticket_id == null ? null : Number(row.ticket_id),
      eventType: row.event_type,
      deltaUses: Number(row.delta_uses),
      balanceAfter: Number(row.balance_after),
      isAnomaly: Boolean(Number(row.is_anomaly || 0)),
      note: row.note || '',
      metadata: parseJson(row.metadata_json, null),
      occurredAt: row.occurred_at,
    }));
  }

  async function enrichTicketBalances(ticketRows, userId, queryable = pool) {
    const ticketIds = ticketRows.map((ticket) => positiveInt(ticket.id)).filter(Boolean);
    if (!ticketIds.length) return ticketRows;
    const placeholders = ticketIds.map(() => '?').join(',');
    const [rows] = await queryable.query(
      `SELECT t.id AS ticket_id,
              COALESCE(t.remaining_uses_cache, t.remaining_uses, 0) AS remaining_uses_cache,
              COALESCE(SUM(CASE WHEN h.status = 'active' THEN h.quantity ELSE 0 END), 0) AS active_holds,
              t.row_version
         FROM course_tickets t
         LEFT JOIN course_students ticket_student ON ticket_student.id = t.student_id
         LEFT JOIN course_ticket_holds h ON h.ticket_id = t.id
        WHERE t.id IN (${placeholders})${userId
    ? ' AND (t.user_id = ? OR ticket_student.user_id = ?)'
    : ''}
        GROUP BY t.id, t.remaining_uses_cache, t.remaining_uses, t.row_version`,
      [...ticketIds, ...(userId ? [userId, userId] : [])]
    );
    const balances = new Map(rows.map((row) => [Number(row.ticket_id), toTicketBalance(row)]));
    return ticketRows.map((ticket) => {
      const balance = balances.get(Number(ticket.id));
      return balance ? {
        ...ticket,
        remaining_uses: balance.remainingUses,
        remaining_uses_cache: balance.remainingUses,
        active_holds: balance.heldUses,
        available_uses: balance.availableUses,
        row_version: balance.rowVersion,
      } : ticket;
    });
  }

  async function createAttendanceInvite({
    sessionId,
    studentId = null,
    userId = null,
    attendeeEmail = '',
    ticketId = null,
    actorUserId,
    idempotencyKey,
    expectedSessionRowVersion,
    expectedTicketRowVersion,
  }) {
    await assertMutationAllowed();
    await assertSchema();
    return withMutationTransaction(async (conn) => {
      const operation = 'attendance-invite.create';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: {
          sessionId: Number(sessionId),
          studentId,
          userId,
          attendeeEmail: text(attendeeEmail, 255).toLowerCase(),
          ticketId,
          expectedSessionRowVersion,
          expectedTicketRowVersion,
        },
        resourceType: 'session',
        resourceId: sessionId,
      });
      if (mutation.replay) return mutation.replay;
      const session = await loadSession(conn, sessionId, { forUpdate: true });
      if (!session) throw domainError('COURSE_SESSION_NOT_FOUND', '找不到課程場次', 404);
      const sessionVersion = requireRowVersion(expectedSessionRowVersion, '場次');
      if (Number(session.row_version || 1) !== sessionVersion) {
        throw domainError('COURSE_ROW_VERSION_CONFLICT', '場次已變更，請重新載入', 409);
      }
      let selectedTicketId = positiveInt(ticketId);
      const normalizedAttendeeEmail = text(attendeeEmail, 255).toLowerCase();
      if (!studentId && !userId && normalizedAttendeeEmail) {
        const [studentRows] = await conn.query(
          `SELECT id, user_id FROM course_students
            WHERE owner_user_id <=> ? AND email_normalized = ?
            LIMIT 1 FOR UPDATE`,
          [session.owner_user_id, normalizedAttendeeEmail]
        );
        if (studentRows[0]) {
          studentId = studentRows[0].id;
          userId = studentRows[0].user_id || null;
        } else {
          const [userRows] = await conn.query(
            'SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1',
            [normalizedAttendeeEmail]
          );
          userId = userRows[0]?.id || null;
        }
      }
      if (!studentId && !userId && !normalizedAttendeeEmail) {
        throw domainError('COURSE_ATTENDEE_REQUIRED', '補登邀請需要已識別的學員或 Email', 400);
      }
      const existingParams = [session.id];
      let existingIdentityWhere = '';
      if (userId) {
        existingIdentityWhere = 'b.user_id = ?';
        existingParams.push(userId);
      } else if (studentId) {
        existingIdentityWhere = 'b.student_id = ?';
        existingParams.push(studentId);
      } else {
        existingIdentityWhere = 'LOWER(b.attendee_email) = ?';
        existingParams.push(normalizedAttendeeEmail);
      }
      const [existingBookingRows] = await conn.query(
        `SELECT b.*, h.id AS hold_id
           FROM course_bookings b
           LEFT JOIN course_ticket_holds h
             ON h.booking_id = b.id AND h.status = 'active'
          WHERE b.session_id = ? AND ${existingIdentityWhere}
            AND b.status = 'booked'
          LIMIT 1 FOR UPDATE`,
        existingParams
      );
      const existingBooking = existingBookingRows[0] || null;
      if (existingBooking) {
        throw domainError(
          'COURSE_BOOKING_EXISTS_PENDING_REVIEW',
          '此學員已有預約，請由 ops 或管理員使用事後補登，不可建立補登邀請',
          409,
          { bookingId: Number(existingBooking.id) }
        );
      }
      if (!selectedTicketId && userId) {
        const eligibility = await getSessionEligibility({
          sessionId,
          userId,
          queryable: conn,
          forUpdate: true,
        });
        selectedTicketId = eligibility.selectedTicketId;
      }
      if (!selectedTicketId) throw domainError('COURSE_TICKET_NOT_FOUND', '找不到可保留的課程票券', 409);
      const [ticketRows] = await conn.query(
        `SELECT t.id, t.user_id, t.student_id, t.row_version, t.ticket_product_id,
                tp.owner_user_id, t.owner_email,
                sap.priority,
                sap.redeem_open_minutes_before AS allowed_redeem_open_minutes_before,
                sap.redeem_close_minutes_after AS allowed_redeem_close_minutes_after,
                COALESCE(t.product_redemption_policy_snapshot, tp.redemption_policy_json)
                  AS redemption_policy_json
           FROM course_tickets t
           JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
           LEFT JOIN course_students ticket_student ON ticket_student.id = t.student_id
           LEFT JOIN course_scenario_allowed_products sap
             ON sap.scenario_id = ? AND sap.ticket_product_id = t.ticket_product_id
          WHERE t.id = ? AND (
            CASE WHEN t.product_code_snapshot IS NOT NULL
              THEN t.provider_user_id_snapshot
              ELSE tp.owner_user_id
            END
          ) <=> ?
            AND (? IS NULL OR t.user_id = ? OR ticket_student.user_id = ?)
            AND (? IS NULL OR t.student_id = ?)
            AND (? IS NULL OR sap.ticket_product_id IS NOT NULL)
          LIMIT 1 FOR UPDATE`,
        [
          session.scenario_id,
          selectedTicketId,
          session.owner_user_id,
          userId,
          userId,
          userId,
          studentId,
          studentId,
          session.scenario_id,
        ]
      );
      const selectedTicket = ticketRows[0];
      if (!selectedTicket) {
        throw domainError('COURSE_TICKET_NOT_APPLICABLE', '票券持有人、租戶或適用情境不符', 409);
      }
      if (!studentId && !userId
        && normalizedAttendeeEmail !== String(selectedTicket.owner_email || '').trim().toLowerCase()) {
        throw domainError('COURSE_TICKET_OWNER_MISMATCH', '票券不屬於指定 Email', 403);
      }
      const ticketVersion = requireRowVersion(expectedTicketRowVersion, '票券');
      if (Number(selectedTicket.row_version || 1) !== ticketVersion) {
        throw domainError('COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 409);
      }
      const settings = await loadSettings(conn, session.owner_user_id);
      const effectiveSettings = settingsForSession(session, settings);
      const invitePolicy = resolveCoursePolicy({
        session,
        providerSettings: effectiveSettings.provider,
        platformSettings: effectiveSettings.platform,
        scenario: {
          redeem_open_minutes_before: session.scenario_redeem_open_minutes_before,
          redeem_close_minutes_after: session.scenario_redeem_close_minutes_after,
        },
        allowedProduct: {
          redeem_open_minutes_before: selectedTicket.allowed_redeem_open_minutes_before,
          redeem_close_minutes_after: selectedTicket.allowed_redeem_close_minutes_after,
        },
        ticketProduct: parseJson(selectedTicket.redemption_policy_json, {}),
      });
      if (Date.now() <= invitePolicy.redeemCloseAt) {
        throw domainError(
          'COURSE_ATTENDANCE_INVITE_TOO_EARLY',
          '補登邀請僅能在核銷截止後建立',
          409,
          invitePolicy
        );
      }
      const expiryMinutes = Number(
        effectiveSettings.provider.attendance_invite_expires_minutes
        ?? effectiveSettings.platform.attendance_invite_expires_minutes
        ?? 1440
      );
      const rawToken = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const boundedExpiryMinutes = Math.max(1, Math.min(
        Number.isFinite(expiryMinutes) ? expiryMinutes : 1440,
        10080
      ));
      const expiry = new Date(Date.now() + boundedExpiryMinutes * 60000);
      const [result] = await conn.query(
        `INSERT INTO course_attendance_invites
          (owner_user_id, session_id, booking_id, student_id, user_id, ticket_id,
           hold_id, token_hash, status, expires_at, auto_redeem_at, row_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 1)`,
        [
          session.owner_user_id,
          session.id,
          null,
          studentId,
          userId,
          selectedTicketId,
          null,
          tokenHash,
          mysqlDateTime(expiry),
          mysqlDateTime(expiry),
        ]
      );
      const inviteId = Number(result.insertId);
      const hold = await createHold(conn, {
        ticketId: selectedTicketId,
        inviteId,
        expiresAt: expiry,
      });
      await conn.query(
        'UPDATE course_attendance_invites SET hold_id = ? WHERE id = ?',
        [hold.id, inviteId]
      );
      const response = {
        id: inviteId,
        token: rawToken,
        status: 'pending',
        expiresAt: mysqlDateTime(expiry),
        autoRedeemAt: mysqlDateTime(expiry),
        hold,
        bookingId: null,
        sessionRowVersion: sessionVersion,
        ticketRowVersion: hold?.ticketRowVersion || ticketVersion,
        rowVersion: 1,
      };
      await completeMutation(
        conn,
        actorUserId,
        operation,
        mutation,
        response,
        { type: 'attendance_invite', id: inviteId }
      );
      return response;
    });
  }

  async function createWalkIn({
    sessionId,
    studentId = null,
    userId = null,
    ticketId = null,
    attendeeName = '',
    attendeeEmail = '',
    actorUserId,
    idempotencyKey,
    expectedSessionRowVersion,
    expectedTicketRowVersion,
    note = '',
  }) {
    await assertMutationAllowed();
    await assertSchema();
    const sessionVersion = requireRowVersion(expectedSessionRowVersion, '場次');
    const ticketVersion = requireRowVersion(expectedTicketRowVersion, '票券');
    return withMutationTransaction(async (conn) => {
      const operation = 'walk-in.create';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: {
          sessionId: Number(sessionId),
          studentId,
          userId,
          ticketId,
          expectedSessionRowVersion: sessionVersion,
          expectedTicketRowVersion: ticketVersion,
          attendeeName: text(attendeeName, 255),
          attendeeEmail: text(attendeeEmail, 255).toLowerCase(),
          note: text(note, 500),
        },
        resourceType: 'session',
        resourceId: sessionId,
      });
      if (mutation.replay) return mutation.replay;
      const session = await loadSession(conn, sessionId, { forUpdate: true });
      if (!session) throw domainError('COURSE_SESSION_NOT_FOUND', '找不到課程場次', 404);
      if (Number(session.row_version || 1) !== sessionVersion) {
        throw domainError('COURSE_ROW_VERSION_CONFLICT', '場次已變更，請重新載入', 409);
      }
      const settings = settingsForSession(
        session,
        await loadSettings(conn, session.owner_user_id)
      );
      const policy = resolveCoursePolicy({
        session,
        providerSettings: settings.provider,
        platformSettings: settings.platform,
        scenario: {
          redeem_open_minutes_before: session.scenario_redeem_open_minutes_before,
          redeem_close_minutes_after: session.scenario_redeem_close_minutes_after,
        },
      });
      if (!policy.canRedeemOnsite) {
        throw domainError('COURSE_WALK_IN_OUTSIDE_WINDOW', 'Walk-in 僅能在現場核銷時間窗內建立', 409, policy);
      }
      let selectedTicketId = positiveInt(ticketId);
      const normalizedAttendeeEmail = text(attendeeEmail, 255).toLowerCase();
      if (!studentId && !userId && normalizedAttendeeEmail) {
        const [studentRows] = await conn.query(
          `SELECT id, user_id, display_name, email
             FROM course_students
            WHERE owner_user_id <=> ? AND email_normalized = ?
            LIMIT 1 FOR UPDATE`,
          [session.owner_user_id, normalizedAttendeeEmail]
        );
        if (studentRows[0]) {
          studentId = studentRows[0].id;
          userId = studentRows[0].user_id || null;
        } else {
          const [userRows] = await conn.query(
            'SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1',
            [normalizedAttendeeEmail]
          );
          userId = userRows[0]?.id || null;
        }
      }
      if (!studentId && !userId && !normalizedAttendeeEmail) {
        throw domainError('COURSE_ATTENDEE_REQUIRED', 'Walk-in 需要已識別的學員或 Email', 400);
      }
      const duplicateWhere = [];
      const duplicateParams = [session.id];
      if (studentId) {
        duplicateWhere.push('b.student_id = ?');
        duplicateParams.push(studentId);
      }
      if (userId) {
        duplicateWhere.push('b.user_id = ?');
        duplicateParams.push(userId);
      }
      if (normalizedAttendeeEmail) {
        duplicateWhere.push('LOWER(b.attendee_email) = ?');
        duplicateParams.push(normalizedAttendeeEmail);
      }
      const [duplicateRows] = await conn.query(
        `SELECT b.id, b.status
           FROM course_bookings b
          WHERE b.session_id = ? AND (${duplicateWhere.join(' OR ')})
          ORDER BY b.id
          LIMIT 1 FOR UPDATE`,
        duplicateParams
      );
      if (duplicateRows[0]) {
        throw domainError(
          'COURSE_BOOKING_EXISTS',
          '此學員已有同場次 RSVP，不能重複建立 Walk-in',
          409,
          { bookingId: Number(duplicateRows[0].id), status: duplicateRows[0].status }
        );
      }
      if (!selectedTicketId && userId) {
        const eligibility = await getSessionEligibility({
          sessionId,
          userId,
          queryable: conn,
        });
        selectedTicketId = eligibility.selectedTicketId;
      }
      if (!selectedTicketId) throw domainError('COURSE_TICKET_NOT_FOUND', '找不到可用票券', 409);
      const [ticketRows] = await conn.query(
        `SELECT t.*, tp.owner_user_id,
                sap.redeem_open_minutes_before AS allowed_redeem_open_minutes_before,
                sap.redeem_close_minutes_after AS allowed_redeem_close_minutes_after,
                COALESCE(t.product_redemption_policy_snapshot, tp.redemption_policy_json)
                  AS redemption_policy_json
           FROM course_tickets t
           JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
           LEFT JOIN course_students ticket_student ON ticket_student.id = t.student_id
           JOIN course_scenario_allowed_products sap
             ON sap.scenario_id = ? AND sap.ticket_product_id = t.ticket_product_id
          WHERE t.id = ? AND (
            CASE WHEN t.product_code_snapshot IS NOT NULL
              THEN t.provider_user_id_snapshot
              ELSE tp.owner_user_id
            END
          ) <=> ?
            AND (? IS NULL OR t.user_id = ? OR ticket_student.user_id = ?)
            AND (? IS NULL OR t.student_id = ?)
          LIMIT 1 FOR UPDATE`,
        [
          session.scenario_id,
          selectedTicketId,
          session.owner_user_id,
          userId,
          userId,
          userId,
          studentId,
          studentId,
        ]
      );
      const ticket = ticketRows[0];
      if (!ticket) throw domainError('COURSE_TICKET_NOT_APPLICABLE', '票券不屬於學員或不適用此場次', 409);
      if (!studentId && !userId
        && normalizedAttendeeEmail !== String(ticket.owner_email || '').trim().toLowerCase()) {
        throw domainError('COURSE_TICKET_OWNER_MISMATCH', '票券不屬於指定 Email', 403);
      }
      if (Number(ticket.row_version || 1) !== ticketVersion) {
        throw domainError('COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 409);
      }
      const ticketPolicy = resolveCoursePolicy({
        session,
        providerSettings: settings.provider,
        platformSettings: settings.platform,
        scenario: {
          redeem_open_minutes_before: session.scenario_redeem_open_minutes_before,
          redeem_close_minutes_after: session.scenario_redeem_close_minutes_after,
        },
        allowedProduct: {
          redeem_open_minutes_before: ticket.allowed_redeem_open_minutes_before,
          redeem_close_minutes_after: ticket.allowed_redeem_close_minutes_after,
        },
        ticketProduct: parseJson(ticket.redemption_policy_json, {}),
      });
      if (!ticketPolicy.canRedeemOnsite) {
        throw domainError(
          'COURSE_WALK_IN_OUTSIDE_WINDOW',
          '此票券目前不在 Walk-in 核銷時間窗內',
          409,
          ticketPolicy
        );
      }
      const [[capacityRow]] = await conn.query(
        `SELECT s.capacity,
                (SELECT COUNT(*) FROM course_bookings b
                  WHERE b.session_id = s.id AND b.status IN ('booked','attended')) AS occupied
           FROM course_sessions s WHERE s.id = ?`,
        [session.id]
      );
      if (Number(capacityRow?.capacity || 0) > 0
        && Number(capacityRow?.occupied || 0) >= Number(capacityRow.capacity)) {
        throw domainError('COURSE_SESSION_FULL', '場次名額已滿', 409);
      }
      let student = {};
      if (studentId) {
        const [studentRows] = await conn.query(
          'SELECT id, user_id, display_name, email FROM course_students WHERE id = ? AND owner_user_id <=> ? LIMIT 1',
          [studentId, session.owner_user_id]
        );
        student = studentRows[0] || {};
        if (!student.id) throw domainError('COURSE_STUDENT_NOT_FOUND', '找不到服務商學員', 404);
      }
      const verifyCode = `CBK-${randomBytes(10).toString('hex').toUpperCase()}`;
      const [bookingResult] = await conn.query(
        `INSERT INTO course_bookings
          (session_id, ticket_id, user_id, student_id, attendee_name, attendee_email,
           verify_code, status, booked_at, row_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'booked', NOW(), 1)`,
        [
          session.id,
          ticket.id,
          userId || student.user_id || null,
          studentId || ticket.student_id || null,
          text(attendeeName || student.display_name || ticket.owner_name, 255),
          text(attendeeEmail || student.email || ticket.owner_email, 255).toLowerCase(),
          verifyCode,
        ]
      );
      const bookingId = Number(bookingResult.insertId);
      await createHold(conn, { ticketId: ticket.id, bookingId });
      const attendance = await consumeAttendance(conn, {
        bookingId,
        eventType: 'SUCCESS',
        actorUserId,
        idempotencyKey,
        note,
        commandId: mutation.commandId,
      });
      const response = { ...attendance, walkIn: true };
      await completeMutation(conn, actorUserId, operation, mutation, response, { type: 'booking', id: bookingId });
      return response;
    });
  }

  async function confirmAttendanceInvite({
    token,
    userId,
    actorUserId = userId,
    idempotencyKey,
    expectedRowVersion,
  }) {
    await assertMutationAllowed();
    await assertSchema();
    expectedRowVersion = requireRowVersion(expectedRowVersion, '補登邀請');
    const tokenHash = createHash('sha256').update(text(token, 500)).digest('hex');
    return withMutationTransaction(async (conn) => {
      const operation = 'attendance-invite.confirm';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { tokenHash, expectedRowVersion },
        resourceType: 'attendance_invite',
      });
      if (mutation.replay) return mutation.replay;
      const [inviteRows] = await conn.query(
        `SELECT * FROM course_attendance_invites
          WHERE token_hash = ? AND user_id = ?
          LIMIT 1 FOR UPDATE`,
        [tokenHash, userId]
      );
      const invite = inviteRows[0];
      if (!invite) throw domainError('COURSE_ATTENDANCE_INVITE_NOT_FOUND', '找不到補登邀請', 404);
      if (invite.status !== 'pending') throw domainError('COURSE_ATTENDANCE_INVITE_USED', '補登邀請已處理', 409);
      if (Number(invite.row_version || 1) !== expectedRowVersion) {
        throw domainError('COURSE_ROW_VERSION_CONFLICT', '補登邀請已變更，請重新載入', 409);
      }
      if (taipeiDateTimeMs(invite.expires_at) < Date.now()) {
        throw domainError('COURSE_ATTENDANCE_INVITE_EXPIRED', '補登邀請已逾期', 409);
      }
      let bookingId = invite.booking_id;
      if (!bookingId) {
        const verifyCode = `CBK-${randomBytes(10).toString('hex').toUpperCase()}`;
        const [studentRows] = await conn.query('SELECT display_name, email FROM course_students WHERE id = ? LIMIT 1', [invite.student_id]);
        const student = studentRows[0] || {};
        const [bookingInsert] = await conn.query(
          `INSERT INTO course_bookings
            (session_id, ticket_id, user_id, student_id, attendee_name, attendee_email,
             verify_code, status, row_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'booked', 1)`,
          [
            invite.session_id,
            invite.ticket_id,
            userId,
            invite.student_id,
            student.display_name || '',
            student.email || '',
            verifyCode,
          ]
        );
        bookingId = Number(bookingInsert.insertId);
        await conn.query(
          'UPDATE course_ticket_holds SET booking_id = ? WHERE id = ?',
          [bookingId, invite.hold_id]
        );
      }
      const result = await consumeAttendance(conn, {
        bookingId,
        eventType: 'SUCCESS',
        actorUserId,
        idempotencyKey,
        allowOutsideWindow: true,
        inviteId: invite.id,
        commandId: mutation.commandId,
      });
      await conn.query(
        `UPDATE course_attendance_invites
            SET status = 'confirmed', confirmed_at = NOW(),
                booking_id = ?, redeemed_usage_event_id = ?, row_version = row_version + 1
          WHERE id = ? AND status = 'pending'`,
        [bookingId, result.usageEvent.id, invite.id]
      );
      const response = { ...result, inviteId: Number(invite.id), inviteStatus: 'confirmed' };
      await completeMutation(conn, actorUserId, operation, mutation, response, { type: 'attendance_invite', id: invite.id });
      return response;
    });
  }

  async function processDueAttendanceInvites({ limit = 50, now = new Date() } = {}) {
    await assertMutationAllowed();
    await assertSchema();
    const [rows] = await pool.query(
      `SELECT id FROM course_attendance_invites
        WHERE status = 'pending' AND auto_redeem_at IS NOT NULL AND auto_redeem_at <= ?
        ORDER BY auto_redeem_at, id LIMIT ?`,
      [mysqlDateTime(now), Math.min(positiveInt(limit, 50), 200)]
    );
    const results = [];
    for (const row of rows) {
      try {
        const result = await withMutationTransaction(async (conn) => {
          const [inviteRows] = await conn.query(
            "SELECT * FROM course_attendance_invites WHERE id = ? AND status = 'pending' LIMIT 1 FOR UPDATE",
            [row.id]
          );
          const invite = inviteRows[0];
          if (!invite) return { id: Number(row.id), skipped: true };
          if (!invite.ticket_id || !invite.hold_id) {
            await conn.query(
              `UPDATE course_attendance_invites
                  SET status = 'blocked', note = 'missing ticket hold',
                      row_version = row_version + 1
                WHERE id = ?`,
              [invite.id]
            );
            return { id: Number(invite.id), status: 'blocked', anomaly: 'missing_ticket_hold' };
          }
          // The automatic path is intentionally the same SUCCESS domain flow
          // as user confirmation; there is no second balance implementation.
          const syntheticKey = `invite-auto:${invite.id}`;
          let bookingId = invite.booking_id;
          if (!bookingId) {
            const verifyCode = `CBK-${randomBytes(10).toString('hex').toUpperCase()}`;
            const [bookingInsert] = await conn.query(
              `INSERT INTO course_bookings
                (session_id, ticket_id, user_id, student_id, attendee_name, attendee_email,
                 verify_code, status, row_version)
               SELECT ?, ?, ?, ?, COALESCE(s.display_name, ''), COALESCE(s.email, ''), ?, 'booked', 1
                 FROM course_students s WHERE s.id = ?`,
              [
                invite.session_id,
                invite.ticket_id,
                invite.user_id || null,
                invite.student_id,
                verifyCode,
                invite.student_id,
              ]
            );
            if (!bookingInsert.insertId) {
              throw domainError('COURSE_ATTENDANCE_INVITE_STUDENT_MISSING', '補登邀請找不到學員資料', 409);
            }
            bookingId = Number(bookingInsert.insertId);
            await conn.query('UPDATE course_ticket_holds SET booking_id = ? WHERE id = ?', [bookingId, invite.hold_id]);
            await conn.query('UPDATE course_attendance_invites SET booking_id = ? WHERE id = ?', [bookingId, invite.id]);
          }
          const redeemed = await consumeAttendance(conn, {
            bookingId,
            eventType: 'SUCCESS',
            actorUserId: invite.owner_user_id,
            idempotencyKey: syntheticKey,
            allowOutsideWindow: true,
            inviteId: invite.id,
          });
          await conn.query(
            `UPDATE course_attendance_invites
                SET status = 'auto_redeemed', redeemed_usage_event_id = ?,
                    row_version = row_version + 1
              WHERE id = ?`,
            [redeemed.usageEvent.id, invite.id]
          );
          return { id: Number(invite.id), status: 'auto_redeemed', usageEventId: redeemed.usageEvent.id };
        });
        results.push(result);
      } catch (error) {
        results.push({ id: Number(row.id), error: error.code || error.message });
      }
    }
    return results;
  }

  async function processDueAutoNoShows({ limit = 50, now = new Date() } = {}) {
    await assertMutationAllowed();
    await assertSchema();
    const nowMs = taipeiDateTimeMs(now);
    const [rows] = await pool.query(
      `SELECT b.id
         FROM course_bookings b
         JOIN course_sessions s ON s.id = b.session_id
         LEFT JOIN course_settings provider_settings
           ON provider_settings.scope_key = CONCAT('provider:', s.owner_user_id)
         JOIN course_settings platform_settings ON platform_settings.scope_key = 'platform'
        WHERE b.status = 'booked'
          AND COALESCE(
            JSON_UNQUOTE(JSON_EXTRACT(s.settings_snapshot_json, '$.auto_no_show')),
            provider_settings.auto_no_show,
            platform_settings.auto_no_show,
            0
          ) IN (1, '1', 'true')
          AND COALESCE(
            s.redeem_close_at,
            DATE_ADD(
              s.ends_at,
              INTERVAL COALESCE(
                s.redeem_close_minutes_after,
                CAST(JSON_UNQUOTE(JSON_EXTRACT(s.settings_snapshot_json, '$.redeem_close_minutes_after')) AS UNSIGNED),
                provider_settings.redeem_close_minutes_after,
                platform_settings.redeem_close_minutes_after,
                1440
              ) MINUTE
            )
          ) < ?
        ORDER BY s.ends_at, b.id
        LIMIT ?`,
      [mysqlDateTime(now), Math.min(positiveInt(limit, 50), 200)]
    );
    const results = [];
    for (const row of rows) {
      try {
        const result = await withMutationTransaction(async (conn) => {
          const { booking, policy } = await getBookingPolicy(row.id, {
            queryable: conn,
            now,
            forUpdate: true,
          });
          if (booking.status !== 'booked') return { id: Number(row.id), skipped: true };
          const settings = settingsForSession(
            booking,
            await loadSettings(conn, booking.owner_user_id)
          );
          const autoNoShowEnabled = Boolean(Number(
            settings.provider.auto_no_show ?? settings.platform.auto_no_show ?? 0
          ));
          if (!autoNoShowEnabled || nowMs <= Number(policy.redeemCloseAt)) {
            return { id: Number(row.id), skipped: true };
          }
          return consumeAttendance(conn, {
            bookingId: booking.id,
            eventType: 'NO_SHOW',
            actorUserId: booking.owner_user_id || null,
            idempotencyKey: `auto-no-show:${booking.id}`,
            note: 'AUTO_NO_SHOW',
            allowOutsideWindow: true,
            expectedRowVersion: Number(booking.row_version || 1),
          });
        });
        results.push(result);
      } catch (error) {
        if (!['COURSE_BOOKING_NOT_REDEEMABLE', 'COURSE_ROW_VERSION_CONFLICT'].includes(error?.code)) {
          results.push({ id: Number(row.id), error: error?.code || error?.message || 'failed' });
        }
      }
    }
    return results;
  }

  async function claimStudentForVerifiedEmail(queryable, { userId, email }) {
    await assertMutationAllowed(queryable);
    const normalizedEmail = text(email, 255).toLowerCase();
    if (!userId || !normalizedEmail) return { claimed: 0 };
    const [studentRows] = await queryable.query(
      `SELECT id, tenant_key, user_id
         FROM course_students
        WHERE email_normalized = ?
        ORDER BY tenant_key, id
        FOR UPDATE`,
      [normalizedEmail]
    );
    const conflicts = studentRows.filter((row) => row.user_id && String(row.user_id) !== String(userId));
    if (conflicts.length) {
      throw domainError(
        'COURSE_STUDENT_CLAIM_CONFLICT',
        '此已驗證 Email 的課程學員權益已綁定其他帳號，需人工處理',
        409,
        { studentIds: conflicts.map((row) => Number(row.id)) }
      );
    }
    const claimableIds = studentRows
      .filter((row) => !row.user_id)
      .map((row) => Number(row.id));
    if (!claimableIds.length) {
      return {
        claimed: 0,
        ticketClaims: 0,
        bookingClaims: 0,
        orderClaims: 0,
        inviteClaims: 0,
      };
    }
    const tenantKeys = [...new Set(
      studentRows.filter((row) => !row.user_id).map((row) => String(row.tenant_key))
    )];
    const tenantPlaceholders = tenantKeys.map(() => '?').join(',');
    const [tenantConflicts] = await queryable.query(
      `SELECT id, tenant_key FROM course_students
        WHERE user_id = ? AND tenant_key IN (${tenantPlaceholders})
          AND email_normalized <> ?
        LIMIT 1`,
      [userId, ...tenantKeys, normalizedEmail]
    );
    if (tenantConflicts.length) {
      throw domainError(
        'COURSE_STUDENT_CLAIM_CONFLICT',
        '同一服務商已有不同學員資料綁定此帳號，需人工合併',
        409
      );
    }
    const placeholders = claimableIds.map(() => '?').join(',');
    const [ticketConflicts] = await queryable.query(
      `SELECT id FROM course_tickets
        WHERE student_id IN (${placeholders})
          AND user_id IS NOT NULL AND user_id <> ?
        LIMIT 1`,
      [...claimableIds, userId]
    );
    if (ticketConflicts.length) {
      throw domainError('COURSE_STUDENT_CLAIM_CONFLICT', '學員票券已綁定其他帳號，需人工處理', 409);
    }
    const [inviteConflicts] = await queryable.query(
      `SELECT id FROM course_attendance_invites
        WHERE student_id IN (${placeholders})
          AND user_id IS NOT NULL AND user_id <> ?
        LIMIT 1`,
      [...claimableIds, userId]
    );
    if (inviteConflicts.length) {
      throw domainError('COURSE_STUDENT_CLAIM_CONFLICT', '補登邀請已綁定其他帳號，需人工處理', 409);
    }
    const [bookingRows] = await queryable.query(
      `SELECT id, session_id, user_id
         FROM course_bookings
        WHERE student_id IN (${placeholders})
        ORDER BY session_id, id
        FOR UPDATE`,
      claimableIds
    );
    const bookingOwnerConflicts = bookingRows.filter(
      (row) => row.user_id && String(row.user_id) !== String(userId)
    );
    if (bookingOwnerConflicts.length) {
      throw domainError(
        'COURSE_STUDENT_CLAIM_CONFLICT',
        '學員預約已綁定其他帳號，需人工處理',
        409,
        { bookingIds: bookingOwnerConflicts.map((row) => Number(row.id)) }
      );
    }
    const claimableBookingRows = bookingRows.filter((row) => !row.user_id);
    const duplicateClaimSessionIds = claimableBookingRows.reduce((duplicates, row, index, rows) => {
      const sessionId = Number(row.session_id);
      if (
        Number.isFinite(sessionId)
        && rows.findIndex((candidate) => Number(candidate.session_id) === sessionId) !== index
        && !duplicates.includes(sessionId)
      ) {
        duplicates.push(sessionId);
      }
      return duplicates;
    }, []);
    if (duplicateClaimSessionIds.length) {
      throw domainError(
        'COURSE_STUDENT_CLAIM_CONFLICT',
        '同一帳號有多筆相同場次的待認領預約，需人工合併',
        409,
        { sessionIds: duplicateClaimSessionIds }
      );
    }
    const claimableSessionIds = [...new Set(
      claimableBookingRows.map((row) => Number(row.session_id)).filter(Number.isFinite)
    )];
    if (claimableSessionIds.length) {
      const sessionPlaceholders = claimableSessionIds.map(() => '?').join(',');
      const [ownedBookingRows] = await queryable.query(
        `SELECT id, session_id
           FROM course_bookings
          WHERE user_id = ? AND session_id IN (${sessionPlaceholders})
          ORDER BY session_id, id
          FOR UPDATE`,
        [userId, ...claimableSessionIds]
      );
      if (ownedBookingRows.length) {
        throw domainError(
          'COURSE_STUDENT_CLAIM_CONFLICT',
          '帳號已持有相同場次的預約，需人工合併',
          409,
          {
            bookingIds: ownedBookingRows.map((row) => Number(row.id)),
            sessionIds: [...new Set(ownedBookingRows.map((row) => Number(row.session_id)))],
          }
        );
      }
    }
    const [orderRows] = await queryable.query(
      `SELECT id, user_id
         FROM course_orders
        WHERE student_id IN (${placeholders})
        ORDER BY id
        FOR UPDATE`,
      claimableIds
    );
    const orderOwnerConflicts = orderRows.filter(
      (row) => row.user_id && String(row.user_id) !== String(userId)
    );
    if (orderOwnerConflicts.length) {
      throw domainError(
        'COURSE_STUDENT_CLAIM_CONFLICT',
        '學員訂單已綁定其他帳號，需人工處理',
        409,
        { orderIds: orderOwnerConflicts.map((row) => Number(row.id)) }
      );
    }
    const [result] = await queryable.query(
      `UPDATE course_students
          SET user_id = ?, claimed_at = COALESCE(claimed_at, NOW()), row_version = row_version + 1
        WHERE user_id IS NULL AND id IN (${placeholders})`,
      [userId, ...claimableIds]
    );
    const [ticketResult] = await queryable.query(
      `UPDATE course_tickets
          SET user_id = ?, owner_email = ?, row_version = row_version + 1
        WHERE student_id IN (${placeholders}) AND user_id IS NULL`,
      [userId, normalizedEmail, ...claimableIds]
    );
    const [inviteResult] = await queryable.query(
      `UPDATE course_attendance_invites
          SET user_id = ?, row_version = row_version + 1
        WHERE student_id IN (${placeholders}) AND user_id IS NULL AND status = 'pending'`,
      [userId, ...claimableIds]
    );
    const [bookingResult] = await queryable.query(
      `UPDATE course_bookings
          SET user_id = ?, row_version = row_version + 1
        WHERE student_id IN (${placeholders}) AND user_id IS NULL`,
      [userId, ...claimableIds]
    );
    const [orderResult] = await queryable.query(
      `UPDATE course_orders
          SET user_id = ?, row_version = row_version + 1
        WHERE student_id IN (${placeholders}) AND user_id IS NULL`,
      [userId, ...claimableIds]
    );
    return {
      claimed: Number(result.affectedRows || 0),
      studentIds: claimableIds,
      ticketClaims: Number(ticketResult.affectedRows || 0),
      bookingClaims: Number(bookingResult.affectedRows || 0),
      orderClaims: Number(orderResult.affectedRows || 0),
      inviteClaims: Number(inviteResult.affectedRows || 0),
    };
  }

  return {
    COURSE_V2_SCHEMA_VERSION: schemaVersion,
    adjustTicket,
    assertMutationAllowed,
    assertSchema,
    assertStartupReady,
    attendanceAction,
    cancelBooking,
    changeTicketState,
    changeTicketFreeze,
    claimMutation,
    claimStudentForVerifiedEmail,
    completeMutation,
    confirmAttendanceInvite,
    createAttendanceInvite,
    createHold,
    createWalkIn,
    enabled,
    enrichTicketBalances,
    getSessionEligibility,
    getBookingPolicy,
    ledgerBalance,
    listTicketLedger,
    loadSettings,
    mutationKeyFromRequest,
    processDueAutoNoShows,
    processDueAttendanceInvites,
    readRuntimeState,
    recordIssuance,
    recordUsageEvent,
    refundTicket,
    releaseHold,
    rowVersionFromRequest,
    syncTicketBalanceCache,
    withMutationTransaction,
    withTransaction,
  };
}

module.exports = {
  COURSE_V2_SCHEMA_VERSION,
  createCourseV2Domain,
  domainError,
  mysqlDateTime,
  mutationKeyFromRequest,
  requireRowVersion,
  resolveAttendanceUsage,
  requestHash,
  rowVersionFromRequest,
  stableStringify,
  toTicketBalance,
};
