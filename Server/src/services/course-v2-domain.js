const { createHash, randomBytes } = require('crypto');
const {
  attendanceInviteExpiryDisposition,
  derivePendingReview,
  normalizeAttendanceInviteExpiryAction,
  normalizeTicketUsageMode,
  resolveCoursePolicy,
  selectEligibleTicket,
  taipeiDateTimeMs,
  zonedDateTimeMs,
} = require('./course-v2-policy');
const { resolveReturningEligibility } = require('./course-v2-sales');
const { enqueueCourseNotificationOutbox } = require('./course-notification-outbox');

const COURSE_V2_SCHEMA_VERSION = '049_course_count_card_normalization';
const COURSE_COUNT_CARD_PARITY_SCHEMA_VERSION = '051_course_count_card_operational_parity';
const MUTATION_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const ATTENDANCE_EVENT_TYPES = new Set(['SUCCESS', 'NO_SHOW']);
const FIXED_TERM_BOOKING_ORIGINS = new Set(['TERM_ROSTER', 'MAKEUP']);

function domainError(code, message, statusCode = 409, details = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

function assertCountCardSessionBoundary(session = {}) {
  const sessionKind = String(session.session_kind ?? session.sessionKind ?? '')
    .trim()
    .toUpperCase();
  const termId = session.term_id ?? session.termId ?? session.session_term_id ?? null;
  if (termId !== null || (sessionKind && sessionKind !== 'COUNT_CARD')) {
    throw domainError(
      'COURSE_COUNT_CARD_SESSION_REQUIRED',
      '固定班場次不能使用計次預約或核銷流程',
      409,
      { termId, sessionKind: sessionKind || null }
    );
  }
  return session;
}

function assertCountCardBookingBoundary(booking = {}) {
  const origin = String(booking.origin || 'MEMBER_RSVP').trim().toUpperCase();
  if (FIXED_TERM_BOOKING_ORIGINS.has(origin)) {
    throw domainError(
      'COURSE_COUNT_CARD_BOOKING_REQUIRED',
      '固定班名單與補課投影必須由固定班權益流程處理',
      409,
      { origin }
    );
  }
  assertCountCardSessionBoundary(booking);
  return booking;
}

function text(value, max = 255) {
  return String(value ?? '').trim().slice(0, max);
}

function positiveInt(value, fallback = null) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function environmentFlag(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
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

function normalizedEmail(value) {
  return text(value, 255).toLowerCase();
}

function toTicketBalance(row = {}) {
  const usageMode = normalizeTicketUsageMode(
    row.usageModeSnapshot
      ?? row.usage_mode_snapshot
      ?? row.usageMode
      ?? row.usage_mode
  );
  const unlimited = usageMode === 'unlimited';
  const remainingUses = Number(
    row.remainingUses ?? row.remaining_uses_cache ?? row.remaining_uses ?? 0
  );
  const heldUses = Number(row.heldUses ?? row.active_holds ?? row.held_uses ?? 0);
  return {
    ticketId: Number(row.ticket_id ?? row.id),
    usageMode,
    unlimited,
    remainingUses,
    heldUses,
    availableUses: unlimited ? null : Math.max(0, remainingUses - heldUses),
    rowVersion: Number(row.row_version || 1),
  };
}

function resolveAttendanceUsage(eventType, {
  ticketId = null,
  hold = null,
  usageMode = 'finite',
} = {}) {
  const hasTicket = Boolean(ticketId);
  if (eventType === 'SUCCESS' && (!hasTicket || !hold)) {
    throw domainError('COURSE_BOOKING_HOLD_MISSING', '預約未保留票券堂數，請重新選票', 409);
  }
  if (eventType === 'NO_SHOW' && hasTicket && !hold) {
    throw domainError('COURSE_BOOKING_HOLD_MISSING', '預約未保留票券堂數，請先處理異常', 409);
  }
  return {
    hasTicket,
    usageMode: normalizeTicketUsageMode(usageMode),
    quantity: hasTicket && hold ? Number(hold.quantity || 1) : 0,
    deltaUses: hasTicket && hold && normalizeTicketUsageMode(usageMode) !== 'unlimited'
      ? -Number(hold.quantity || 1)
      : 0,
    anomaly: eventType === 'NO_SHOW' && !hasTicket,
  };
}

function partialTransferBlockReason(ticket = {}, {
  quantity = 0,
  remainingUses = 0,
  heldUses = 0,
  acceptedOperations = 0,
  now = Date.now(),
} = {}) {
  if (normalizeTicketUsageMode(ticket.usage_mode_snapshot ?? ticket.usage_mode) !== 'finite') {
    return '無限次票不可由會員自助轉讓';
  }
  if (!Number(ticket.product_transferable_snapshot ?? ticket.transferable ?? 0)) {
    return '此票券目前不可轉讓';
  }
  if (!['pending', 'active'].includes(String(ticket.status || '').toLowerCase())) {
    return '此票券目前不可轉讓';
  }
  if (ticket.frozen_at) return '此票券目前已凍結，無法轉讓';
  const today = taipeiDate(now);
  const expiresAt = ticket.expires_at ? taipeiDate(ticket.expires_at) : null;
  if (expiresAt && expiresAt < today) return '此票券已過期，無法轉讓';
  const activationDeadline = ticket.activation_deadline
    ? taipeiDate(ticket.activation_deadline)
    : null;
  if (
    String(ticket.status || '').toLowerCase() === 'pending'
    && activationDeadline
    && activationDeadline < today
  ) return '此票券已超過開卡期限，無法轉讓';
  const maxOperations = Number(
    ticket.max_transfer_operations_snapshot
      ?? ticket.max_transfer_operations
      ?? ticket.product_max_transfers_snapshot
      ?? 1
  );
  if (maxOperations > 0 && Number(acceptedOperations || 0) >= maxOperations) {
    return '此票券已達轉讓操作次數上限';
  }
  const requestedQuantity = Number(quantity || 0);
  const availableUses = Number(remainingUses || 0) - Number(heldUses || 0);
  if (!Number.isSafeInteger(requestedQuantity) || requestedQuantity < 1) {
    return '轉讓堂數必須是正整數';
  }
  if (requestedQuantity > availableUses) return '可轉讓堂數不足';
  return '';
}

function createCourseV2Domain({
  pool,
  enabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.COURSE_V2_ENABLED || '').toLowerCase()),
  countCardParityEnabled = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.COURSE_COUNT_CARD_PARITY_ENABLED || '').toLowerCase()
  ),
  advancedNotificationsEnabled = environmentFlag(
    process.env.COURSE_ADVANCED_PAYMENTS_ENABLED,
    false
  ),
  schemaVersion = COURSE_V2_SCHEMA_VERSION,
  autoNoShow = false,
} = {}) {
  if (!pool) throw new TypeError('course v2 domain requires a database pool');

  let runtimeStateCache = null;
  let runtimeStateExpiresAt = 0;

  async function enqueueNotificationOutbox(conn, notifications, { ownerUserId = null } = {}) {
    if (!countCardParityEnabled) {
      return { queued: false, reason: 'count_card_parity_disabled' };
    }
    return enqueueCourseNotificationOutbox(conn, notifications, {
      runtimeEnabled: advancedNotificationsEnabled,
      ownerUserId,
      requireProviderAdvancedPayments: true,
    });
  }

  async function enqueuePartialTransferNotifications(conn, transfer, {
    eventType,
    status,
    ownerUserId = transfer?.provider_owner_user_id || null,
    productName = transfer?.resolved_product_name || '',
    childTicketCode = '',
  } = {}) {
    const transferId = Number(transfer?.id || transfer?.transfer_id || 0);
    if (!transferId || !eventType) return { queued: false, reason: 'transfer_notification_missing' };
    const commonPayload = {
      transferId,
      ticketId: Number(transfer.ticket_id || 0) || null,
      quantity: Number(transfer.quantity || 0),
      status: status || transfer.status || '',
      expiresAt: transfer.expires_at || null,
      productName,
      childTicketCode: childTicketCode || null,
    };
    const recipients = [
      { userId: transfer.from_user_id, role: 'sender' },
      { userId: transfer.to_user_id, role: 'recipient' },
    ].filter((entry) => entry.userId);
    return enqueueNotificationOutbox(
      conn,
      recipients.map(({ userId, role }) => ({
        ownerUserId,
        userId,
        eventType,
        dedupeKey: `count-partial-transfer:${transferId}:${String(status || eventType).toLowerCase()}:${role}`,
        payload: { ...commonPayload, role },
      })),
      { ownerUserId }
    );
  }

  async function partialTransferNotificationContext(conn, transfer) {
    if (!advancedNotificationsEnabled || transfer?.provider_owner_user_id !== undefined) {
      return transfer;
    }
    const ticket = await loadPartialTransferTicket(conn, transfer.ticket_id, { forUpdate: false });
    return {
      ...transfer,
      provider_owner_user_id: ticket?.provider_owner_user_id || null,
      resolved_product_name: ticket?.resolved_product_name || '',
    };
  }

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

  async function withCountCardSessionFields(queryable, session, {
    liveSettings = null,
    forUpdate = false,
  } = {}) {
    const scopedSession = { ...session };
    delete scopedSession.city;
    delete scopedSession.venue_name;
    delete scopedSession.cancel_close_at;
    const sessionId = positiveInt(session?.session_id ?? session?.id);
    if (!countCardParityEnabled || !sessionId) return scopedSession;
    const ownerUserId = session?.owner_user_id || null;
    const settings = liveSettings || await loadSettings(queryable, ownerUserId);
    const scopedSettings = ownerUserId ? settings.provider : settings.platform;
    if (!Number(scopedSettings?.count_card_parity_enabled || 0)) return scopedSession;
    await assertCountCardParity(queryable);
    const [rows] = await queryable.query(
      `SELECT venue_name, city, cancel_close_at
         FROM course_sessions
        WHERE id = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [sessionId]
    );
    return rows[0] ? { ...scopedSession, ...rows[0] } : scopedSession;
  }

  async function countCardOperationalParityActive(queryable, ownerUserId = null) {
    if (!countCardParityEnabled) return false;
    const settings = await loadSettings(queryable, ownerUserId);
    const scoped = ownerUserId ? settings.provider : settings.platform;
    if (!Number(scoped?.count_card_parity_enabled || 0)) return false;
    await assertCountCardParity(queryable);
    return true;
  }

  async function loadSession(queryable, sessionId, {
    forUpdate = false,
    operationalParity = false,
  } = {}) {
    const [rows] = await queryable.query(
      `SELECT s.*, rs.code AS scenario_code, rs.name AS scenario_name,
              ${operationalParity
    ? `rs.item_type AS scenario_item_type,
              rs.session_bound AS scenario_session_bound,
              rs.redeem_quantity AS scenario_redeem_quantity,`
    : `'class' AS scenario_item_type,
              1 AS scenario_session_bound,
              1 AS scenario_redeem_quantity,`}
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

  async function resolveRegisteredAttendee({
    queryable = pool,
    ownerUserId = null,
    studentId = null,
    userId = null,
    attendeeEmail = '',
    forUpdate = false,
  } = {}) {
    const normalizedAttendeeEmail = text(attendeeEmail, 255).toLowerCase();
    const normalizedStudentId = positiveInt(studentId);
    const normalizedUserId = text(userId, 36) || null;
    if (!normalizedStudentId && !normalizedUserId && !normalizedAttendeeEmail) {
      throw domainError(
        'COURSE_ATTENDEE_REQUIRED',
        '請指定已註冊並綁定課程學員的平台帳號',
        400
      );
    }
    const where = ['s.owner_user_id <=> ?', 's.user_id IS NOT NULL'];
    const params = [ownerUserId];
    if (normalizedStudentId) {
      where.push('s.id = ?');
      params.push(normalizedStudentId);
    }
    if (normalizedUserId) {
      where.push('s.user_id = ?');
      params.push(normalizedUserId);
    }
    if (!normalizedStudentId && !normalizedUserId && normalizedAttendeeEmail) {
      where.push('(s.email_normalized = ? OR LOWER(u.email) = ?)');
      params.push(normalizedAttendeeEmail, normalizedAttendeeEmail);
    }
    const [rows] = await queryable.query(
      `SELECT s.id, s.user_id, s.display_name, s.email, s.email_normalized,
              u.email AS user_email, u.username
         FROM course_students s
         JOIN users u ON u.id = s.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY s.id
        LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      params
    );
    const attendee = rows[0];
    if (!attendee) {
      throw domainError(
        'COURSE_REGISTERED_STUDENT_REQUIRED',
        '現場報到與補登邀請只能指定已註冊且已綁定此服務商學員資料的帳號',
        409
      );
    }
    return {
      studentId: Number(attendee.id),
      userId: attendee.user_id,
      displayName: attendee.display_name || attendee.username || '',
      email: text(attendee.email || attendee.user_email, 255).toLowerCase(),
    };
  }

  async function loadTicketCandidates(queryable, {
    session,
    userId,
    studentId = null,
    ownerEmail = '',
    ticketId = null,
    forUpdate = false,
    operationalParity = false,
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
      `SELECT t.*, ${operationalParity
    ? "COALESCE(t.usage_mode_snapshot, tp.usage_mode, 'finite')"
    : "'finite'"} AS usage_mode,
              COALESCE(t.remaining_uses_cache, t.remaining_uses, 0) AS remaining_uses_cache,
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
    const usageMode = normalizeTicketUsageMode(ticket.usage_mode);
    const unlimited = usageMode === 'unlimited';
    const redeemQuantity = Math.max(1, positiveInt(session.scenario_redeem_quantity, 1));
    const remainingUses = Number(ticket.remaining_uses_cache || 0);
    const heldUses = Number(ticket.active_holds || 0);
    const availableUses = unlimited ? null : remainingUses - heldUses;
    const reasons = [];
    if (String(session.status || '').toLowerCase() !== 'open') {
      reasons.push('場次目前未開放預約');
    }
    if (!['pending', 'active'].includes(String(ticket.status || '').toLowerCase())) reasons.push('票券狀態不可用');
    if (!unlimited && availableUses < redeemQuantity) reasons.push('可用堂數不足');
    return {
      ticketId: Number(ticket.id),
      ticketCode: ticket.code,
      ticketProductId: Number(ticket.ticket_product_id),
      ticketProductName: ticket.ticket_product_name,
      scenarioPriority: Number(ticket.scenario_priority),
      usageMode,
      unlimited,
      redeemQuantity,
      remainingUses,
      heldUses,
      availableUses: unlimited ? null : Math.max(0, availableUses),
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
    const [scopeRows] = await queryable.query(
      'SELECT owner_user_id FROM course_sessions WHERE id = ? LIMIT 1',
      [positiveInt(sessionId)]
    );
    if (!scopeRows[0]) throw domainError('COURSE_SESSION_NOT_FOUND', '找不到課程場次', 404);
    const operationalParity = await countCardOperationalParityActive(
      queryable,
      scopeRows[0].owner_user_id
    );
    const loadedSession = await loadSession(queryable, sessionId, { forUpdate, operationalParity });
    if (!loadedSession || !['open', 'closed', 'completed'].includes(String(loadedSession.status || '').toLowerCase())) {
      throw domainError('COURSE_SESSION_NOT_FOUND', '找不到課程場次', 404);
    }
    assertCountCardSessionBoundary(loadedSession);
    const liveSettings = await loadSettings(queryable, loadedSession.owner_user_id);
    const session = await withCountCardSessionFields(queryable, loadedSession, {
      liveSettings,
      forUpdate,
    });
    const settings = settingsForSession(session, liveSettings);
    const candidates = await loadTicketCandidates(queryable, {
      session,
      userId,
      studentId,
      ownerEmail,
      ticketId,
      forUpdate,
      operationalParity,
    });
    const tickets = candidates.map((candidate) => ticketEligibility(candidate, session, settings, now));
    const selected = selectEligibleTicket(tickets.map((item) => ({
      ...item,
      id: item.ticketId,
      status: item.eligible ? 'active' : 'unavailable',
      remainingUsesCache: item.remainingUses,
      activeHolds: item.heldUses,
      usageMode: item.usageMode,
      requiredUses: item.redeemQuantity,
      expiresAt: candidates.find((candidate) => Number(candidate.id) === item.ticketId)?.expires_at,
      activationDeadline: candidates.find((candidate) => Number(candidate.id) === item.ticketId)?.activation_deadline,
      activatedAt: candidates.find((candidate) => Number(candidate.id) === item.ticketId)?.activated_at,
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
        scenarioItemType: session.scenario_item_type || 'class',
        sessionBound: Boolean(Number(session.scenario_session_bound ?? 1)),
        redeemQuantity: Math.max(1, positiveInt(session.scenario_redeem_quantity, 1)),
        venueName: session.venue_name || session.location || '',
        city: session.city || '',
        cancelCloseAt: session.cancel_close_at || null,
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
        ? (zonedDateTimeMs(now, basePolicy.timezone) < basePolicy.bookingOpenAt
          ? '尚未開放預約'
          : '預約已截止')
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
              rs.item_type AS scenario_item_type,
              rs.session_bound AS scenario_session_bound,
              rs.redeem_quantity AS scenario_redeem_quantity,
              rs.redeem_open_minutes_before AS scenario_redeem_open_minutes_before,
              rs.redeem_close_minutes_after AS scenario_redeem_close_minutes_after,
              sap.redeem_open_minutes_before AS allowed_redeem_open_minutes_before,
              sap.redeem_close_minutes_after AS allowed_redeem_close_minutes_after,
              t.code AS ticket_code, t.row_version AS ticket_row_version,
              t.status AS ticket_status, t.frozen_at, t.expires_at, t.activation_deadline,
              COALESCE(t.usage_mode_snapshot, tp.usage_mode, 'finite') AS usage_mode,
              t.remaining_uses_cache, t.remaining_uses,
              (SELECT COALESCE(SUM(h.quantity), 0)
                 FROM course_ticket_holds h
                WHERE h.ticket_id = t.id AND h.status = 'active') AS active_holds,
              invite.status AS attendance_invite_status,
              invite.expiry_action AS attendance_invite_expiry_action,
              t.product_redemption_policy_snapshot
         FROM course_bookings b
         JOIN course_sessions s ON s.id = b.session_id
         LEFT JOIN course_redeem_scenarios rs ON rs.id = s.scenario_id
         LEFT JOIN course_tickets t ON t.id = b.ticket_id
         LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
         LEFT JOIN course_scenario_allowed_products sap
           ON sap.scenario_id = s.scenario_id
          AND sap.ticket_product_id = t.ticket_product_id
         LEFT JOIN course_attendance_invites invite
           ON invite.booking_id = b.id
        WHERE b.id = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [positiveInt(bookingId)]
    );
    const booking = rows[0];
    if (!booking) throw domainError('COURSE_BOOKING_NOT_FOUND', '找不到課程預約', 404);
    assertCountCardBookingBoundary(booking);
    const liveSettings = await loadSettings(queryable, booking.owner_user_id);
    const scopedBooking = await withCountCardSessionFields(queryable, booking, {
      liveSettings,
      forUpdate,
    });
    const settings = settingsForSession(scopedBooking, liveSettings);
    const policy = resolveCoursePolicy({
      session: scopedBooking,
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
      booking: scopedBooking,
      policy,
      pendingReview: derivePendingReview(scopedBooking, policy, now),
    };
  }

  async function ledgerBalance(queryable, ticketId, { lockTicket = false } = {}) {
    const [ticketRows] = await queryable.query(
      `SELECT t.id, t.user_id, t.student_id, t.total_uses,
              t.product_class_count_snapshot, t.product_valid_days_snapshot,
              t.remaining_uses_cache, t.remaining_uses, t.row_version, t.status,
              t.activation_deadline, t.activated_at, t.expires_at, t.frozen_at, t.freeze_reason,
              COALESCE(t.usage_mode_snapshot, tp.usage_mode, 'finite') AS usage_mode
         FROM course_tickets t
         LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
        WHERE t.id = ? LIMIT 1${lockTicket ? ' FOR UPDATE' : ''}`,
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
    const usageMode = normalizeTicketUsageMode(ticket.usage_mode);
    return {
      ticket,
      usageMode,
      unlimited: usageMode === 'unlimited',
      remainingUses,
      heldUses,
      availableUses: usageMode === 'unlimited' ? null : remainingUses - heldUses,
    };
  }

  async function syncTicketBalanceCache(conn, ticketId, balance = null, { activateOnConsume = false } = {}) {
    const current = balance || await ledgerBalance(conn, ticketId, { lockTicket: true });
    const [snapshotRows] = await conn.query(
      `SELECT t.status, t.activated_at, t.expires_at, t.product_valid_days_snapshot,
              COALESCE(t.usage_mode_snapshot, tp.usage_mode, 'finite') AS usage_mode
         FROM course_tickets t
         LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
        WHERE t.id = ? LIMIT 1 FOR UPDATE`,
      [ticketId]
    );
    const snapshot = snapshotRows[0] || current.ticket;
    const unlimited = current.unlimited || normalizeTicketUsageMode(snapshot.usage_mode) === 'unlimited';
    const firstActivation = (
      activateOnConsume
      &&
      !snapshot.activated_at
      && ['pending', 'active'].includes(String(snapshot.status || '').toLowerCase())
      && (unlimited || current.remainingUses < Number(
        current.ticket.product_class_count_snapshot
        ?? current.ticket.total_uses
        ?? current.remainingUses
      ))
    );
    const activatedAt = firstActivation ? mysqlDateTime(new Date()) : snapshot.activated_at;
    let expiresAt = snapshot.expires_at;
    if (firstActivation && !expiresAt) {
      const validDays = positiveInt(snapshot.product_valid_days_snapshot, null);
      if (!validDays) {
        throw domainError(
          'COURSE_TICKET_VALIDITY_SNAPSHOT_REQUIRED',
          '票券缺少效期快照，請先由課務處理後再核銷',
          409
        );
      }
      expiresAt = taipeiDate(Date.now() + validDays * 86400000);
    }
    const currentStatus = String(snapshot.status || '').toLowerCase();
    let nextStatus = snapshot.status;
    if (
      !unlimited
      && current.remainingUses <= 0
      && ['pending', 'active', 'exhausted'].includes(currentStatus)
    ) {
      nextStatus = 'exhausted';
    } else if ((unlimited || current.remainingUses > 0) && currentStatus === 'exhausted') {
      // A compensating reversal/positive adjustment revives an exhausted
      // ticket without rewriting history. Activated tickets resume active;
      // never-activated tickets return to pending.
      nextStatus = activatedAt ? 'active' : 'pending';
    } else if (
      (unlimited || current.remainingUses > 0)
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
      usageMode: unlimited ? 'unlimited' : 'finite',
      unlimited,
      remainingUses: current.remainingUses,
      heldUses: current.heldUses,
      availableUses: current.availableUses,
      ticketStatus: nextStatus,
      activatedAt,
      expiresAt,
      rowVersion: Number(current.ticket.row_version || 1) + 1,
    };
  }

  async function createHold(conn, {
    ticketId,
    bookingId = null,
    inviteId = null,
    expiresAt = null,
    quantity = null,
    purpose = 'BOOKING',
    sourceType = null,
    sourceId = null,
  }) {
    let holdQuantity = positiveInt(quantity);
    if (!holdQuantity && (bookingId || inviteId)) {
      const identityColumn = bookingId ? 'b.id' : 'i.id';
      const identityValue = bookingId || inviteId;
      const bookingJoin = bookingId
        ? 'FROM course_bookings b JOIN course_sessions s ON s.id = b.session_id'
        : `FROM course_attendance_invites i
           JOIN course_sessions s ON s.id = i.session_id`;
      const [[scenarioRow]] = await conn.query(
        `SELECT COALESCE(rs.redeem_quantity, 1) AS redeem_quantity
           ${bookingJoin}
           LEFT JOIN course_redeem_scenarios rs ON rs.id = s.scenario_id
          WHERE ${identityColumn} = ? LIMIT 1`,
        [identityValue]
      );
      holdQuantity = positiveInt(scenarioRow?.redeem_quantity, 1);
    }
    holdQuantity = holdQuantity || 1;
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
    if (!balance.unlimited && balance.availableUses < holdQuantity) {
      throw domainError('COURSE_TICKET_NO_AVAILABLE_USES', '票券可用堂數不足，請重新選擇', 409, balance);
    }
    const [result] = await conn.query(
      `INSERT INTO course_ticket_holds
        (ticket_id, booking_id, invite_id, quantity, purpose, source_type, source_id,
         status, expires_at, row_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, 1)`,
      [
        ticketId,
        bookingId,
        inviteId,
        holdQuantity,
        text(purpose, 32).toUpperCase() || 'BOOKING',
        text(sourceType, 48) || null,
        sourceId == null ? null : text(sourceId, 128),
        mysqlDateTime(expiresAt),
      ]
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
      usageMode: balance.usageMode,
      unlimited: balance.unlimited,
      quantity: holdQuantity,
      purpose: text(purpose, 32).toUpperCase() || 'BOOKING',
      status: 'active',
      availableUses: balance.unlimited ? null : balance.availableUses - holdQuantity,
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
        usage_mode: balance.usageMode,
        active_holds: balance.heldUses,
        row_version: previousTicketRowVersion + 1,
      }),
      holdId: Number(hold.id),
      ticketRowVersion: previousTicketRowVersion + 1,
    };
  }

  async function assertCountCardParity(queryable = pool, { requireEnabled = true } = {}) {
    if (!enabled || (requireEnabled && !countCardParityEnabled)) {
      throw domainError(
        'COURSE_COUNT_CARD_PARITY_DISABLED',
        '課程計次卡商品化功能尚未啟用',
        503
      );
    }
    const [rows] = await queryable.query(
      'SELECT version FROM course_schema_versions WHERE version = ? LIMIT 1',
      [COURSE_COUNT_CARD_PARITY_SCHEMA_VERSION]
    );
    if (!rows[0]) {
      throw domainError(
        'COURSE_COUNT_CARD_PARITY_SCHEMA_REQUIRED',
        `課程計次卡轉讓需要 migration ${COURSE_COUNT_CARD_PARITY_SCHEMA_VERSION}`,
        503
      );
    }
    return true;
  }

  async function assertProviderCountCardParity(queryable, ownerUserId) {
    const settings = await loadSettings(queryable, ownerUserId || null);
    const scoped = ownerUserId ? settings.provider : settings.platform;
    if (!Number(scoped?.count_card_parity_enabled || 0)) {
      throw domainError(
        'COURSE_COUNT_CARD_PARITY_PROVIDER_DISABLED',
        '此課程服務商尚未開放計次卡商品化功能',
        503
      );
    }
    return true;
  }

  async function loadPartialTransferTicket(queryable, ticketId, { forUpdate = false } = {}) {
    const [rows] = await queryable.query(
      `SELECT t.*,
              COALESCE(t.usage_mode_snapshot, tp.usage_mode, 'finite') AS usage_mode,
              COALESCE(t.provider_user_id_snapshot, tp.owner_user_id, p.owner_user_id) AS provider_owner_user_id,
              COALESCE(t.product_name_snapshot, tp.name, p.name, '課程票券') AS resolved_product_name,
              COALESCE(t.max_transfer_operations_snapshot,
                       tp.max_transfer_operations,
                       t.product_max_transfers_snapshot, 1) AS resolved_max_transfer_operations,
              (SELECT COUNT(*)
                 FROM course_ticket_transfers accepted
                WHERE accepted.ticket_id = t.id
                  AND accepted.status = 'accepted') AS accepted_transfer_operations
         FROM course_tickets t
         LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
         LEFT JOIN course_products p ON p.id = t.product_id
        WHERE t.id = ?
        LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [positiveInt(ticketId)]
    );
    const ticket = rows[0] || null;
    if (ticket) {
      ticket.max_transfer_operations_snapshot = Number(
        ticket.resolved_max_transfer_operations ?? ticket.max_transfer_operations_snapshot ?? 1
      );
    }
    return ticket;
  }

  async function resolvePartialTransferRecipient(queryable, {
    recipientUserId = null,
    recipientEmail = '',
    forUpdate = false,
  } = {}) {
    const userId = text(recipientUserId, 36) || null;
    const email = normalizedEmail(recipientEmail);
    if (!userId && !email) {
      throw domainError('COURSE_TRANSFER_RECIPIENT_REQUIRED', '請指定已註冊的受讓帳號', 400);
    }
    const [rows] = await queryable.query(
      `SELECT id, username, email
         FROM users
        WHERE ${userId && email
          ? 'id = ? AND LOWER(email) = LOWER(?)'
          : (userId ? 'id = ?' : 'LOWER(email) = LOWER(?)')}
        LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      userId && email ? [userId, email] : [userId || email]
    );
    const recipient = rows[0];
    if (!recipient) {
      throw domainError(
        'COURSE_TRANSFER_RECIPIENT_NOT_REGISTERED',
        '受讓人必須先建立平台帳號',
        409
      );
    }
    return recipient;
  }

  async function ensurePartialTransferStudent(conn, ticket, recipient) {
    const ownerUserId = ticket.provider_owner_user_id || null;
    const tenantKey = ownerUserId || '00000000-0000-0000-0000-000000000000';
    const email = normalizedEmail(recipient.email);
    const [rows] = await conn.query(
      `SELECT *
         FROM course_students
        WHERE tenant_key = ? AND (user_id = ? OR email_normalized = ?)
        ORDER BY id
        FOR UPDATE`,
      [tenantKey, recipient.id, email]
    );
    if (
      rows.length > 1
      || (rows[0]?.user_id && String(rows[0].user_id) !== String(recipient.id))
    ) {
      throw domainError(
        'COURSE_STUDENT_CLAIM_CONFLICT',
        '受讓人的課程學員資料已連結其他帳號',
        409
      );
    }
    if (rows[0]) {
      await conn.query(
        `UPDATE course_students
            SET user_id = ?, email = ?, email_normalized = ?, display_name = ?,
                status = 'claimed', claimed_at = COALESCE(claimed_at, NOW()),
                row_version = row_version + 1
          WHERE id = ?`,
        [recipient.id, email, email, text(recipient.username, 255) || email, rows[0].id]
      );
      return { ...rows[0], id: Number(rows[0].id), user_id: recipient.id };
    }
    const [insert] = await conn.query(
      `INSERT INTO course_students
        (owner_user_id, tenant_key, user_id, email, email_normalized,
         display_name, status, source_system, claimed_at, row_version)
       VALUES (?, ?, ?, ?, ?, ?, 'claimed', 'leader', NOW(), 1)`,
      [ownerUserId, tenantKey, recipient.id, email, email, text(recipient.username, 255) || email]
    );
    return { id: Number(insert.insertId), user_id: recipient.id };
  }

  async function assertPartialTransferAddonEligibility(conn, ticket, recipient, {
    forUpdate = false,
  } = {}) {
    if (!ticket.product_id) return true;
    const [productRows] = await conn.query(
      `SELECT id, owner_user_id, require_addon_for_new
         FROM course_products
        WHERE id = ? AND owner_user_id <=> ?
        LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [ticket.product_id, ticket.provider_owner_user_id || null]
    );
    const product = productRows[0];
    if (!product) {
      throw domainError(
        'COURSE_TRANSFER_PROVIDER_SCOPE_CONFLICT',
        '票券銷售方案的租戶歸屬已變更',
        409
      );
    }
    if (!Number(product.require_addon_for_new || 0)) return true;
    const returningEligible = await resolveReturningEligibility(conn, {
      productId: product.id,
      userId: recipient.id,
      forUpdate,
    });
    if (returningEligible) return true;
    const [requiredRows] = await conn.query(
      `SELECT DISTINCT COALESCE(component.ticket_product_id, addon.ticket_product_id) AS ticket_product_id
         FROM course_product_required_addons requirement
         JOIN course_products addon ON addon.id = requirement.addon_product_id
         LEFT JOIN course_shop_product_components component
           ON component.shop_product_id = addon.id
        WHERE requirement.product_id = ?
          AND addon.owner_user_id <=> ?
        ORDER BY ticket_product_id${forUpdate ? ' FOR UPDATE' : ''}`,
      [product.id, ticket.provider_owner_user_id || null]
    );
    const requiredIds = [...new Set(
      requiredRows.map((row) => positiveInt(row.ticket_product_id)).filter(Boolean)
    )];
    if (!requiredIds.length) return true;
    const [ownedRows] = await conn.query(
      `SELECT DISTINCT owned.ticket_product_id
         FROM course_tickets owned
         LEFT JOIN course_students student ON student.id = owned.student_id
        WHERE owned.ticket_product_id IN (${requiredIds.map(() => '?').join(',')})
          AND (owned.user_id = ? OR student.user_id = ?)
          AND owned.status <> 'void'${forUpdate ? ' FOR UPDATE' : ''}`,
      [...requiredIds, recipient.id, recipient.id]
    );
    const ownedIds = new Set(ownedRows.map((row) => Number(row.ticket_product_id)));
    if (requiredIds.some((id) => !ownedIds.has(id))) {
      throw domainError(
        'COURSE_TRANSFER_ADDON_REQUIRED',
        '受讓人尚未具備此銷售方案要求的必要加購權益',
        409
      );
    }
    return true;
  }

  function assertPartialTransferTicket(ticket, balance, quantity, actorUserId) {
    if (!ticket) throw domainError('COURSE_TICKET_NOT_FOUND', '找不到課程票券', 404);
    if (String(ticket.user_id || '') !== String(actorUserId || '')) {
      throw domainError('FORBIDDEN', '僅限票券持有者轉讓', 403);
    }
    const reason = partialTransferBlockReason(ticket, {
      quantity,
      remainingUses: balance.remainingUses,
      heldUses: balance.heldUses,
      acceptedOperations: ticket.accepted_transfer_operations,
    });
    if (reason) {
      throw domainError('COURSE_PARTIAL_TRANSFER_NOT_ALLOWED', reason, 409, {
        remainingUses: balance.remainingUses,
        heldUses: balance.heldUses,
        availableUses: balance.availableUses,
      });
    }
  }

  function toMemberPartialTransfer(row, userId) {
    const outgoing = String(row.from_user_id || '') === String(userId || '');
    const counterpartyUserId = outgoing ? row.to_user_id : row.from_user_id;
    const counterpartyName = outgoing ? row.to_username : row.from_username;
    const counterpartyEmail = outgoing
      ? (row.to_user_email || row.to_email)
      : (row.from_user_email || row.from_email);
    const status = String(row.status || '').toLowerCase();
    return {
      id: Number(row.id),
      rowVersion: Number(row.row_version || 1),
      transferMode: 'PARTIAL',
      direction: outgoing ? 'outgoing' : 'incoming',
      quantity: Number(row.quantity || 0),
      status,
      expiresAt: row.expires_at || null,
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
      acceptedAt: row.accepted_at || null,
      declinedAt: row.declined_at || null,
      cancelledAt: row.cancelled_at || null,
      provider: {
        userId: row.provider_owner_user_id || null,
        displayName: row.provider_name || '',
        isPlatform: !row.provider_owner_user_id,
      },
      counterparty: {
        userId: counterpartyUserId || null,
        displayName: text(counterpartyName, 255)
          || normalizedEmail(counterpartyEmail)
          || '已註冊會員',
        email: normalizedEmail(counterpartyEmail) || null,
      },
      sourceTicket: {
        id: Number(row.source_ticket_id),
        code: row.source_ticket_code || '',
        productName: row.source_product_name || '',
        rowVersion: Number(row.source_ticket_row_version || 1),
      },
      childTicket: row.child_ticket_id ? {
        id: Number(row.child_ticket_id),
        code: row.child_ticket_code || '',
        productName: row.child_product_name || row.source_product_name || '',
        rowVersion: Number(row.child_ticket_row_version || 1),
      } : null,
      capabilities: {
        accept: !outgoing && status === 'pending',
        decline: !outgoing && status === 'pending',
        cancel: outgoing && status === 'pending',
      },
    };
  }

  async function listMemberPartialTransfers({
    userId,
    limit = 100,
    queryable = pool,
  } = {}) {
    await assertCountCardParity(queryable, { requireEnabled: false });
    const boundedLimit = Math.min(Math.max(positiveInt(limit, 100), 1), 250);
    const [rows] = await queryable.query(
      `SELECT tr.id, tr.ticket_id AS source_ticket_id, tr.child_ticket_id,
              tr.from_user_id, tr.to_user_id, tr.from_email, tr.to_email,
              tr.quantity, tr.status, tr.expires_at, tr.row_version,
              tr.created_at, tr.updated_at, tr.accepted_at, tr.declined_at,
              tr.cancelled_at,
              source_ticket.code AS source_ticket_code,
              source_ticket.row_version AS source_ticket_row_version,
              COALESCE(source_ticket.product_name_snapshot, tp.name, product.name, '課程票券')
                AS source_product_name,
              child_ticket.code AS child_ticket_code,
              child_ticket.row_version AS child_ticket_row_version,
              child_ticket.product_name_snapshot AS child_product_name,
              sender.username AS from_username, sender.email AS from_user_email,
              recipient.username AS to_username, recipient.email AS to_user_email,
              COALESCE(source_ticket.provider_user_id_snapshot, tp.owner_user_id, product.owner_user_id)
                AS provider_owner_user_id,
              provider.username AS provider_name
         FROM course_ticket_transfers tr
         JOIN course_tickets source_ticket ON source_ticket.id = tr.ticket_id
         LEFT JOIN course_tickets child_ticket ON child_ticket.id = tr.child_ticket_id
         LEFT JOIN course_ticket_products tp ON tp.id = source_ticket.ticket_product_id
         LEFT JOIN course_products product ON product.id = source_ticket.product_id
         JOIN users sender ON sender.id = tr.from_user_id
         JOIN users recipient ON recipient.id = tr.to_user_id
         LEFT JOIN users provider ON provider.id = COALESCE(
           source_ticket.provider_user_id_snapshot,
           tp.owner_user_id,
           product.owner_user_id
         )
        WHERE tr.transfer_mode = 'PARTIAL'
          AND (tr.from_user_id = ? OR tr.to_user_id = ?)
        ORDER BY tr.created_at DESC, tr.id DESC
        LIMIT ?`,
      [userId, userId, boundedLimit]
    );
    const items = rows.map((row) => toMemberPartialTransfer(row, userId));
    return {
      incoming: items.filter((item) => item.direction === 'incoming'),
      outgoing: items.filter((item) => item.direction === 'outgoing'),
    };
  }

  async function previewPartialTransfer({
    ticketId,
    actorUserId,
    recipientUserId = null,
    recipientEmail = '',
    quantity,
  }) {
    await assertCountCardParity();
    const ticket = await loadPartialTransferTicket(pool, ticketId);
    if (!ticket) throw domainError('COURSE_TICKET_NOT_FOUND', '找不到課程票券', 404);
    await assertProviderCountCardParity(pool, ticket.provider_owner_user_id);
    const balance = await ledgerBalance(pool, ticket.id);
    assertPartialTransferTicket(ticket, balance, Number(quantity), actorUserId);
    const recipient = await resolvePartialTransferRecipient(pool, {
      recipientUserId,
      recipientEmail,
    });
    if (String(recipient.id) === String(actorUserId)) {
      throw domainError('COURSE_TRANSFER_SELF_NOT_ALLOWED', '不可轉讓給自己', 400);
    }
    await assertPartialTransferAddonEligibility(pool, ticket, recipient);
    return {
      ticketId: Number(ticket.id),
      ticketCode: ticket.code,
      productName: ticket.resolved_product_name,
      providerOwnerUserId: ticket.provider_owner_user_id || null,
      recipientUserId: recipient.id,
      recipientEmail: normalizedEmail(recipientEmail) || null,
      quantity: Number(quantity),
      remainingUses: balance.remainingUses,
      heldUses: balance.heldUses,
      availableUses: balance.availableUses,
      availableAfterTransfer: balance.availableUses - Number(quantity),
      maxTransferOperations: Number(ticket.max_transfer_operations_snapshot),
      acceptedTransferOperations: Number(ticket.accepted_transfer_operations || 0),
      ticketRowVersion: Number(ticket.row_version || 1),
      eligible: true,
    };
  }

  async function generateChildTicketCode(queryable) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const code = `CTK-${randomBytes(8).toString('hex').toUpperCase()}`;
      const [rows] = await queryable.query(
        'SELECT id FROM course_tickets WHERE code = ? LIMIT 1',
        [code]
      );
      if (!rows.length) return code;
    }
    throw domainError('COURSE_TICKET_CODE_CONFLICT', '受讓票券代碼產生失敗，請重試', 409);
  }

  async function releasePartialTransferHold(conn, transfer, {
    reason,
    actorUserId = null,
    consumeUsageEventId = null,
  } = {}) {
    const [holdRows] = await conn.query(
      'SELECT * FROM course_ticket_holds WHERE id = ? LIMIT 1 FOR UPDATE',
      [transfer.hold_id]
    );
    const hold = holdRows[0];
    if (!hold || String(hold.purpose) !== 'TRANSFER' || Number(hold.ticket_id) !== Number(transfer.ticket_id)) {
      throw domainError('COURSE_TRANSFER_HOLD_INVALID', '轉讓保留堂數資料不一致', 409);
    }
    if (String(hold.status) !== 'active') {
      throw domainError('COURSE_TRANSFER_HOLD_CONFLICT', '轉讓保留堂數已被處理', 409);
    }
    const consumed = Boolean(consumeUsageEventId);
    const [updated] = await conn.query(
      `UPDATE course_ticket_holds
          SET status = ?,
              released_at = ${consumed ? 'NULL' : 'NOW()'},
              released_by_user_id = ?, release_reason = ?,
              consumed_at = ${consumed ? 'NOW()' : 'NULL'},
              consumed_usage_event_id = ?, row_version = row_version + 1
        WHERE id = ? AND status = 'active'`,
      [
        consumed ? 'consumed' : 'released',
        actorUserId,
        text(reason, 64) || null,
        consumeUsageEventId,
        hold.id,
      ]
    );
    if (!updated.affectedRows) {
      throw domainError('COURSE_TRANSFER_HOLD_CONFLICT', '轉讓保留堂數已被處理', 409);
    }
    if (!consumed) {
      await conn.query(
        'UPDATE course_tickets SET row_version = row_version + 1 WHERE id = ?',
        [hold.ticket_id]
      );
    }
    return hold;
  }

  async function initiatePartialTransfer({
    ticketId,
    actorUserId,
    recipientUserId = null,
    recipientEmail = '',
    quantity,
    idempotencyKey,
    expectedRowVersion,
    expiresInHours = 168,
  }) {
    await assertCountCardParity();
    requireRowVersion(expectedRowVersion, '課程票券');
    const candidateRecipient = await resolvePartialTransferRecipient(pool, {
      recipientUserId,
      recipientEmail,
    });
    return withMutationTransaction(async (conn) => {
      await assertCountCardParity(conn);
      const userIds = [...new Set([actorUserId, candidateRecipient.id].map(String))].sort();
      const [users] = await conn.query(
        `SELECT id, username, email FROM users
          WHERE id IN (${userIds.map(() => '?').join(',')})
          ORDER BY id FOR UPDATE`,
        userIds
      );
      const sender = users.find((user) => String(user.id) === String(actorUserId));
      const recipient = users.find((user) => String(user.id) === String(candidateRecipient.id));
      if (!sender || !recipient) {
        throw domainError('COURSE_TRANSFER_RECIPIENT_NOT_REGISTERED', '受讓人必須先建立平台帳號', 409);
      }
      if (String(sender.id) === String(recipient.id)) {
        throw domainError('COURSE_TRANSFER_SELF_NOT_ALLOWED', '不可轉讓給自己', 400);
      }
      const operation = 'ticket.partial-transfer.initiate';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: {
          ticketId: Number(ticketId),
          recipientUserId: recipient.id,
          quantity: Number(quantity),
          expectedRowVersion: Number(expectedRowVersion),
        },
        resourceType: 'course_ticket',
        resourceId: ticketId,
      });
      if (mutation.replay) return { ...mutation.replay, replayed: true };
      const ticket = await loadPartialTransferTicket(conn, ticketId, { forUpdate: true });
      if (!ticket) throw domainError('COURSE_TICKET_NOT_FOUND', '找不到課程票券', 404);
      await assertProviderCountCardParity(conn, ticket.provider_owner_user_id);
      if (Number(ticket.row_version || 1) !== Number(expectedRowVersion)) {
        throw domainError('COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 412);
      }
      const balance = await ledgerBalance(conn, ticket.id, { lockTicket: true });
      assertPartialTransferTicket(ticket, balance, Number(quantity), actorUserId);
      await assertPartialTransferAddonEligibility(conn, ticket, recipient, { forUpdate: true });
      const boundedHours = Math.min(Math.max(positiveInt(expiresInHours, 168), 1), 720);
      const expiresAt = mysqlDateTime(Date.now() + boundedHours * 60 * 60 * 1000);
      const [insert] = await conn.query(
        `INSERT INTO course_ticket_transfers
          (ticket_id, transfer_mode, quantity, hold_id, child_ticket_id,
           from_user_id, to_user_id, from_email, to_email, code, status,
           expires_at, row_version)
         VALUES (?, 'PARTIAL', ?, NULL, NULL, ?, ?, ?, ?, NULL, 'pending', ?, 1)`,
        [
          ticket.id,
          Number(quantity),
          sender.id,
          recipient.id,
          normalizedEmail(sender.email),
          normalizedEmail(recipient.email),
          expiresAt,
        ]
      );
      const transferId = Number(insert.insertId);
      const hold = await createHold(conn, {
        ticketId: ticket.id,
        quantity: Number(quantity),
        purpose: 'TRANSFER',
        sourceType: 'partial_transfer',
        sourceId: transferId,
        expiresAt,
      });
      await conn.query(
        'UPDATE course_ticket_transfers SET hold_id = ? WHERE id = ? AND hold_id IS NULL',
        [hold.id, transferId]
      );
      const notification = await enqueuePartialTransferNotifications(conn, {
        id: transferId,
        ticket_id: ticket.id,
        quantity: Number(quantity),
        from_user_id: sender.id,
        to_user_id: recipient.id,
        expires_at: expiresAt,
        provider_owner_user_id: ticket.provider_owner_user_id || null,
        resolved_product_name: ticket.resolved_product_name || '',
      }, {
        eventType: 'COUNT_PARTIAL_TRANSFER_INITIATED',
        status: 'pending',
        ownerUserId: ticket.provider_owner_user_id || null,
        productName: ticket.resolved_product_name || '',
      });
      const response = {
        transferId,
        transferMode: 'PARTIAL',
        ticketId: Number(ticket.id),
        recipientUserId: recipient.id,
        recipientEmail: normalizedEmail(recipientEmail) || null,
        quantity: Number(quantity),
        status: 'pending',
        expiresAt,
        holdId: hold.id,
        transferRowVersion: 1,
        ticketRowVersion: hold.ticketRowVersion,
        availableUses: hold.availableUses,
        notificationQueued: Boolean(notification.queued),
      };
      await completeMutation(conn, actorUserId, operation, mutation, response, {
        type: 'course_ticket_transfer',
        id: transferId,
      });
      return response;
    });
  }

  async function loadPartialTransfer(queryable, transferId, { forUpdate = false } = {}) {
    const [rows] = await queryable.query(
      `SELECT tr.* FROM course_ticket_transfers tr
        WHERE tr.id = ? AND tr.transfer_mode = 'PARTIAL'
        LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [positiveInt(transferId)]
    );
    return rows[0] || null;
  }

  function isPartialTransferExpired(transfer, now = Date.now()) {
    const expiryMs = taipeiDateTimeMs(transfer?.expires_at);
    return !Number.isFinite(expiryMs) || expiryMs <= taipeiDateTimeMs(now);
  }

  async function expireLockedPartialTransfer(conn, transfer, actorUserId = null) {
    await releasePartialTransferHold(conn, transfer, {
      reason: 'transfer_expired',
      actorUserId,
    });
    const [updated] = await conn.query(
      `UPDATE course_ticket_transfers
          SET status = 'expired', row_version = row_version + 1
        WHERE id = ? AND transfer_mode = 'PARTIAL' AND status = 'pending'`,
      [transfer.id]
    );
    if (!updated.affectedRows) {
      throw domainError('COURSE_TRANSFER_CONFLICT', '轉讓狀態已變更，請重新載入', 409);
    }
    const notificationTransfer = await partialTransferNotificationContext(conn, transfer);
    const notification = await enqueuePartialTransferNotifications(conn, notificationTransfer, {
      eventType: 'COUNT_PARTIAL_TRANSFER_EXPIRED',
      status: 'expired',
    });
    return {
      transferId: Number(transfer.id),
      ticketId: Number(transfer.ticket_id),
      status: 'expired',
      transferRowVersion: Number(transfer.row_version || 1) + 1,
      expired: true,
      notificationQueued: Boolean(notification.queued),
    };
  }

  async function createPartialTransferChildTicket(conn, transfer, sourceTicket, recipient, student) {
    const code = await generateChildTicketCode(conn);
    const activated = Boolean(sourceTicket.activated_at);
    const [insert] = await conn.query(
      `INSERT INTO course_tickets
        (code, user_id, student_id, owner_name, owner_email, product_id,
         ticket_product_id, order_id, order_item_id, total_uses,
         remaining_uses, remaining_uses_cache, status, issued_at,
         activation_deadline, activated_at, expires_at, transferable,
         product_code_snapshot, product_name_snapshot,
         product_class_count_snapshot, usage_mode_snapshot, product_type_snapshot,
         usage_notice_scope_snapshot, product_valid_days_snapshot,
         product_activation_days_snapshot, product_transferable_snapshot,
         product_max_transfers_snapshot, max_transfer_operations_snapshot,
         pause_max_operations_snapshot, pause_max_days_snapshot,
         product_terms_snapshot, product_redemption_policy_snapshot,
         provider_user_id_snapshot, provider_name_snapshot,
         source_system, source_id, parent_ticket_id, transfer_root_ticket_id,
         row_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 0, 0, ?, NOW(),
               ?, ?, ?, ?, ?, ?, ?, 'finite', ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, 'transfer', ?, ?, ?, 1)`,
      [
        code,
        recipient.id,
        student.id,
        text(recipient.username, 255) || normalizedEmail(recipient.email),
        normalizedEmail(recipient.email),
        sourceTicket.product_id,
        sourceTicket.ticket_product_id,
        Number(transfer.quantity),
        activated ? 'active' : 'pending',
        sourceTicket.activation_deadline,
        sourceTicket.activated_at,
        sourceTicket.expires_at,
        Number(sourceTicket.product_transferable_snapshot ?? sourceTicket.transferable ?? 0),
        sourceTicket.product_code_snapshot,
        sourceTicket.product_name_snapshot || sourceTicket.resolved_product_name,
        sourceTicket.product_class_count_snapshot,
        sourceTicket.product_type_snapshot,
        sourceTicket.usage_notice_scope_snapshot,
        sourceTicket.product_valid_days_snapshot,
        sourceTicket.product_activation_days_snapshot,
        sourceTicket.product_transferable_snapshot,
        sourceTicket.product_max_transfers_snapshot,
        sourceTicket.max_transfer_operations_snapshot,
        sourceTicket.pause_max_operations_snapshot,
        sourceTicket.pause_max_days_snapshot,
        sourceTicket.product_terms_snapshot,
        sourceTicket.product_redemption_policy_snapshot,
        sourceTicket.provider_owner_user_id,
        sourceTicket.provider_name_snapshot,
        `partial-transfer:${transfer.id}`,
        sourceTicket.id,
        sourceTicket.transfer_root_ticket_id || sourceTicket.id,
      ]
    );
    return { id: Number(insert.insertId), code };
  }

  async function acceptPartialTransfer({
    transferId,
    actorUserId,
    idempotencyKey,
    expectedRowVersion,
  }) {
    await assertCountCardParity(pool, { requireEnabled: false });
    requireRowVersion(expectedRowVersion, '轉讓');
    const candidate = await loadPartialTransfer(pool, transferId);
    if (!candidate) {
      throw domainError('COURSE_PARTIAL_TRANSFER_NOT_APPLICABLE', '找不到部分轉讓', 404);
    }
    return withMutationTransaction(async (conn) => {
      await assertCountCardParity(conn, { requireEnabled: false });
      const userIds = [...new Set([candidate.from_user_id, candidate.to_user_id].map(String))].sort();
      const [users] = await conn.query(
        `SELECT id, username, email FROM users
          WHERE id IN (${userIds.map(() => '?').join(',')})
          ORDER BY id FOR UPDATE`,
        userIds
      );
      const recipient = users.find((user) => String(user.id) === String(actorUserId));
      if (!recipient || String(candidate.to_user_id) !== String(actorUserId)) {
        throw domainError('FORBIDDEN', '僅限被指定的帳號接受', 403);
      }
      const operation = 'ticket.partial-transfer.accept';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { transferId: Number(transferId), expectedRowVersion: Number(expectedRowVersion) },
        resourceType: 'course_ticket_transfer',
        resourceId: transferId,
      });
      if (mutation.replay) return { ...mutation.replay, replayed: true };
      const transfer = await loadPartialTransfer(conn, transferId, { forUpdate: true });
      if (!transfer || String(transfer.status) !== 'pending') {
        throw domainError('COURSE_TRANSFER_CONFLICT', '轉讓狀態已變更，請重新載入', 409);
      }
      if (Number(transfer.row_version || 1) !== Number(expectedRowVersion)) {
        throw domainError('COURSE_ROW_VERSION_CONFLICT', '轉讓已變更，請重新載入', 412);
      }
      if (String(transfer.to_user_id) !== String(actorUserId)) {
        throw domainError('FORBIDDEN', '僅限被指定的帳號接受', 403);
      }
      if (isPartialTransferExpired(transfer)) {
        const response = await expireLockedPartialTransfer(conn, transfer, actorUserId);
        await completeMutation(conn, actorUserId, operation, mutation, response, {
          type: 'course_ticket_transfer', id: transfer.id,
        });
        return response;
      }
      const ticket = await loadPartialTransferTicket(conn, transfer.ticket_id, { forUpdate: true });
      if (!ticket) throw domainError('COURSE_TICKET_NOT_FOUND', '找不到課程票券', 404);
      const balance = await ledgerBalance(conn, transfer.ticket_id, { lockTicket: true });
      const [holdRows] = await conn.query(
        'SELECT * FROM course_ticket_holds WHERE id = ? LIMIT 1 FOR UPDATE',
        [transfer.hold_id]
      );
      const hold = holdRows[0];
      if (
        !hold
        || String(hold.status) !== 'active'
        || String(hold.purpose) !== 'TRANSFER'
        || Number(hold.quantity) !== Number(transfer.quantity)
      ) {
        throw domainError('COURSE_TRANSFER_HOLD_INVALID', '轉讓保留堂數資料不一致', 409);
      }
      assertPartialTransferTicket(ticket, {
        ...balance,
        heldUses: balance.heldUses - Number(hold.quantity),
      }, Number(transfer.quantity), transfer.from_user_id);
      await assertPartialTransferAddonEligibility(conn, ticket, recipient, { forUpdate: true });
      const student = await ensurePartialTransferStudent(conn, ticket, recipient);
      const child = await createPartialTransferChildTicket(conn, transfer, ticket, recipient, student);
      const transferOut = await recordUsageEvent(conn, {
        ticketId: ticket.id,
        studentId: ticket.student_id,
        userId: ticket.user_id,
        eventType: 'TRANSFER_OUT',
        deltaUses: -Number(transfer.quantity),
        sourceType: 'partial_transfer',
        sourceId: transfer.id,
        idempotencyKey: scopedEventIdempotency('partial-transfer-out', idempotencyKey),
        actorUserId,
        note: `partial transfer to ticket ${child.id}`,
        metadata: { transferId: Number(transfer.id), childTicketId: child.id },
        usageMethod: 'transfer',
        providerUserIdSnapshot: ticket.provider_owner_user_id,
        quantitySnapshot: Number(transfer.quantity),
        commandId: mutation.commandId,
      });
      await releasePartialTransferHold(conn, transfer, {
        reason: 'transfer_accepted',
        actorUserId,
        consumeUsageEventId: transferOut.id,
      });
      const transferIn = await recordUsageEvent(conn, {
        ticketId: child.id,
        studentId: student.id,
        userId: recipient.id,
        eventType: 'TRANSFER_IN',
        deltaUses: Number(transfer.quantity),
        sourceType: 'partial_transfer',
        sourceId: transfer.id,
        idempotencyKey: scopedEventIdempotency('partial-transfer-in', idempotencyKey),
        actorUserId,
        note: `partial transfer from ticket ${ticket.id}`,
        metadata: { transferId: Number(transfer.id), parentTicketId: Number(ticket.id) },
        usageMethod: 'transfer',
        providerUserIdSnapshot: ticket.provider_owner_user_id,
        quantitySnapshot: Number(transfer.quantity),
        commandId: mutation.commandId,
      });
      const [updated] = await conn.query(
        `UPDATE course_ticket_transfers
            SET status = 'accepted', child_ticket_id = ?, accepted_at = NOW(),
                row_version = row_version + 1
          WHERE id = ? AND transfer_mode = 'PARTIAL' AND status = 'pending'
            AND row_version = ?`,
        [child.id, transfer.id, expectedRowVersion]
      );
      if (!updated.affectedRows) {
        throw domainError('COURSE_TRANSFER_CONFLICT', '轉讓狀態已變更，請重新載入', 409);
      }
      await conn.query(
        `INSERT IGNORE INTO course_ticket_transfer_logs
          (transfer_id, ticket_id, ticket_code, user_id, from_user_id, to_user_id,
           action, method, product_name, from_email, to_email)
         VALUES
          (?, ?, ?, ?, ?, ?, 'transferred_out', 'partial', ?, ?, ?),
          (?, ?, ?, ?, ?, ?, 'transferred_in', 'partial', ?, ?, ?)`,
        [
          transfer.id, ticket.id, ticket.code, transfer.from_user_id,
          transfer.from_user_id, recipient.id, ticket.resolved_product_name,
          transfer.from_email, transfer.to_email,
          transfer.id, child.id, child.code, recipient.id,
          transfer.from_user_id, recipient.id, ticket.resolved_product_name,
          transfer.from_email, transfer.to_email,
        ]
      );
      const notification = await enqueuePartialTransferNotifications(conn, {
        ...transfer,
        provider_owner_user_id: ticket.provider_owner_user_id || null,
        resolved_product_name: ticket.resolved_product_name || '',
      }, {
        eventType: 'COUNT_PARTIAL_TRANSFER_ACCEPTED',
        status: 'accepted',
        ownerUserId: ticket.provider_owner_user_id || null,
        productName: ticket.resolved_product_name || '',
        childTicketCode: child.code,
      });
      const response = {
        transferId: Number(transfer.id),
        transferMode: 'PARTIAL',
        sourceTicketId: Number(ticket.id),
        childTicketId: child.id,
        childTicketCode: child.code,
        quantity: Number(transfer.quantity),
        status: 'accepted',
        transferRowVersion: Number(expectedRowVersion) + 1,
        transferOutEventId: transferOut.id,
        transferInEventId: transferIn.id,
        notificationQueued: Boolean(notification.queued),
      };
      await completeMutation(conn, actorUserId, operation, mutation, response, {
        type: 'course_ticket', id: child.id,
      });
      return response;
    });
  }

  async function resolvePartialTransfer({
    transferId,
    actorUserId,
    action,
    idempotencyKey,
    expectedRowVersion,
    reason = '',
  }) {
    await assertCountCardParity(pool, { requireEnabled: false });
    requireRowVersion(expectedRowVersion, '轉讓');
    if (!['decline', 'cancel'].includes(action)) {
      throw domainError('COURSE_TRANSFER_ACTION_INVALID', '轉讓操作不正確', 400);
    }
    const candidate = await loadPartialTransfer(pool, transferId);
    if (!candidate) {
      throw domainError('COURSE_PARTIAL_TRANSFER_NOT_APPLICABLE', '找不到部分轉讓', 404);
    }
    return withMutationTransaction(async (conn) => {
      await assertCountCardParity(conn, { requireEnabled: false });
      const userIds = [...new Set([candidate.from_user_id, candidate.to_user_id].map(String))].sort();
      await conn.query(
        `SELECT id FROM users WHERE id IN (${userIds.map(() => '?').join(',')}) ORDER BY id FOR UPDATE`,
        userIds
      );
      const operation = `ticket.partial-transfer.${action}`;
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: {
          transferId: Number(transferId),
          expectedRowVersion: Number(expectedRowVersion),
          reason: text(reason, 500),
        },
        resourceType: 'course_ticket_transfer',
        resourceId: transferId,
      });
      if (mutation.replay) return { ...mutation.replay, replayed: true };
      const transfer = await loadPartialTransfer(conn, transferId, { forUpdate: true });
      if (!transfer || String(transfer.status) !== 'pending') {
        throw domainError('COURSE_TRANSFER_CONFLICT', '轉讓狀態已變更，請重新載入', 409);
      }
      if (Number(transfer.row_version || 1) !== Number(expectedRowVersion)) {
        throw domainError('COURSE_ROW_VERSION_CONFLICT', '轉讓已變更，請重新載入', 412);
      }
      const authorized = action === 'decline'
        ? String(transfer.to_user_id) === String(actorUserId)
        : String(transfer.from_user_id) === String(actorUserId);
      if (!authorized) {
        throw domainError(
          'FORBIDDEN',
          action === 'decline' ? '僅限被指定的帳號拒絕' : '僅限原持有者取消',
          403
        );
      }
      if (isPartialTransferExpired(transfer)) {
        const response = await expireLockedPartialTransfer(conn, transfer, actorUserId);
        await completeMutation(conn, actorUserId, operation, mutation, response, {
          type: 'course_ticket_transfer', id: transfer.id,
        });
        return response;
      }
      await releasePartialTransferHold(conn, transfer, {
        reason: action === 'decline' ? 'transfer_declined' : 'transfer_canceled',
        actorUserId,
      });
      const nextStatus = action === 'decline' ? 'declined' : 'canceled';
      const timestampColumn = action === 'decline' ? 'declined_at' : 'cancelled_at';
      const [updated] = await conn.query(
        `UPDATE course_ticket_transfers
            SET status = ?, ${timestampColumn} = NOW(), row_version = row_version + 1
          WHERE id = ? AND transfer_mode = 'PARTIAL' AND status = 'pending'
            AND row_version = ?`,
        [nextStatus, transfer.id, expectedRowVersion]
      );
      if (!updated.affectedRows) {
        throw domainError('COURSE_TRANSFER_CONFLICT', '轉讓狀態已變更，請重新載入', 409);
      }
      const notificationTransfer = await partialTransferNotificationContext(conn, transfer);
      const notification = await enqueuePartialTransferNotifications(conn, notificationTransfer, {
        eventType: action === 'decline'
          ? 'COUNT_PARTIAL_TRANSFER_DECLINED'
          : 'COUNT_PARTIAL_TRANSFER_CANCELLED',
        status: nextStatus,
      });
      const response = {
        transferId: Number(transfer.id),
        ticketId: Number(transfer.ticket_id),
        status: nextStatus,
        transferRowVersion: Number(expectedRowVersion) + 1,
        notificationQueued: Boolean(notification.queued),
      };
      await completeMutation(conn, actorUserId, operation, mutation, response, {
        type: 'course_ticket_transfer', id: transfer.id,
      });
      return response;
    });
  }

  async function processDuePartialTransfers({ limit = 100 } = {}) {
    await assertCountCardParity(pool, { requireEnabled: false });
    return withMutationTransaction(async (conn) => {
      await assertCountCardParity(conn, { requireEnabled: false });
      const [rows] = await conn.query(
        `SELECT tr.*,
                COALESCE(t.provider_user_id_snapshot, tp.owner_user_id, p.owner_user_id)
                  AS provider_owner_user_id
           FROM course_ticket_transfers tr
           JOIN course_tickets t ON t.id = tr.ticket_id
           LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
           LEFT JOIN course_products p ON p.id = t.product_id
          WHERE tr.transfer_mode = 'PARTIAL' AND tr.status = 'pending'
            AND tr.expires_at <= NOW()
          ORDER BY tr.expires_at, tr.id
          LIMIT ? FOR UPDATE SKIP LOCKED`,
        [Math.min(Math.max(positiveInt(limit, 100), 1), 500)]
      );
      const expired = [];
      for (const transfer of rows) {
        expired.push(await expireLockedPartialTransfer(conn, transfer, null));
      }
      return expired;
    });
  }

  async function processDuePausedTickets({ limit = 100, now = new Date() } = {}) {
    await assertMutationAllowed();
    await assertSchema();
    await assertCountCardParity(pool, { requireEnabled: false });
    const boundedLimit = Math.min(Math.max(positiveInt(limit, 100), 1), 500);
    const [rows] = await pool.query(
      `SELECT t.id
         FROM course_tickets t
         JOIN course_ticket_state_periods period
           ON period.ticket_id = t.id
          AND period.state = 'paused'
          AND period.ended_at IS NULL
         LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
         LEFT JOIN course_products p ON p.id = t.product_id
         LEFT JOIN course_settings provider_settings
           ON provider_settings.scope_key = CONCAT(
             'provider:',
             COALESCE(t.provider_user_id_snapshot, tp.owner_user_id, p.owner_user_id)
           )
         JOIN course_settings platform_settings ON platform_settings.scope_key = 'platform'
        WHERE t.status = 'paused'
          AND TIMESTAMPADD(
            DAY,
            GREATEST(1, COALESCE(
              t.pause_max_days_snapshot,
              tp.pause_max_days,
              provider_settings.pause_max_days,
              platform_settings.pause_max_days,
              365
            )),
            period.started_at
          ) <= ?
        ORDER BY period.started_at, t.id
        LIMIT ?`,
      [mysqlDateTime(now), boundedLimit]
    );
    const results = [];
    for (const row of rows) {
      try {
        const result = await withMutationTransaction(async (conn) => {
          const [lockedRows] = await conn.query(
            `SELECT t.*,
                    period.id AS pause_period_id,
                    period.started_at AS pause_started_at,
                    COALESCE(t.usage_mode_snapshot, tp.usage_mode, 'finite') AS usage_mode,
                    COALESCE(t.provider_user_id_snapshot, tp.owner_user_id, p.owner_user_id)
                      AS provider_owner_user_id,
                    GREATEST(1, COALESCE(
                      t.pause_max_days_snapshot,
                      tp.pause_max_days,
                      provider_settings.pause_max_days,
                      platform_settings.pause_max_days,
                      365
                    )) AS resolved_pause_max_days
               FROM course_tickets t
               JOIN course_ticket_state_periods period
                 ON period.ticket_id = t.id
                AND period.state = 'paused'
                AND period.ended_at IS NULL
               LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
               LEFT JOIN course_products p ON p.id = t.product_id
               LEFT JOIN course_settings provider_settings
                 ON provider_settings.scope_key = CONCAT(
                   'provider:',
                   COALESCE(t.provider_user_id_snapshot, tp.owner_user_id, p.owner_user_id)
                 )
               JOIN course_settings platform_settings ON platform_settings.scope_key = 'platform'
              WHERE t.id = ? AND t.status = 'paused'
              LIMIT 1 FOR UPDATE`,
            [positiveInt(row.id)]
          );
          const ticket = lockedRows[0];
          if (!ticket) return { ticketId: Number(row.id), skipped: true };
          await assertCountCardParity(conn, { requireEnabled: false });
          const pauseMaxDays = Math.max(1, positiveInt(ticket.resolved_pause_max_days, 365));
          const dueAt = taipeiDateTimeMs(ticket.pause_started_at) + pauseMaxDays * 86400000;
          if (dueAt > taipeiDateTimeMs(now)) {
            return { ticketId: Number(ticket.id), skipped: true };
          }
          const balance = await ledgerBalance(conn, ticket.id, { lockTicket: true });
          const nextStatus = balance.unlimited || balance.remainingUses > 0
            ? (ticket.activated_at ? 'active' : 'pending')
            : 'exhausted';
          const [updated] = await conn.query(
            `UPDATE course_tickets
                SET status = ?, paused_at = NULL, pause_reason = NULL,
                    expires_at = IF(
                      expires_at IS NULL,
                      NULL,
                      DATE_ADD(expires_at, INTERVAL ? DAY)
                    ),
                    activation_deadline = IF(
                      activated_at IS NULL AND activation_deadline IS NOT NULL,
                      DATE_ADD(activation_deadline, INTERVAL ? DAY),
                      activation_deadline
                    ),
                    row_version = row_version + 1
              WHERE id = ? AND row_version = ? AND status = 'paused'`,
            [nextStatus, pauseMaxDays, pauseMaxDays, ticket.id, Number(ticket.row_version || 1)]
          );
          if (!updated.affectedRows) {
            throw domainError('COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 412);
          }
          await conn.query(
            `UPDATE course_ticket_state_periods
                SET ended_at = DATE_ADD(started_at, INTERVAL ? DAY), extension_days = ?
              WHERE id = ? AND ended_at IS NULL`,
            [pauseMaxDays, pauseMaxDays, ticket.pause_period_id]
          );
          await conn.query(
            `INSERT INTO course_ticket_state_periods
              (ticket_id, state, started_at, ended_at, extension_days, reason,
               actor_user_id, metadata_json)
             VALUES (?, 'resumed', NOW(), NOW(), ?, 'AUTO_RESUME_PAUSE_LIMIT', NULL, ?)`,
            [
              ticket.id,
              pauseMaxDays,
              JSON.stringify({
                previousStatus: 'paused',
                nextStatus,
                pausePeriodId: Number(ticket.pause_period_id),
                pauseMaxDays,
              }),
            ]
          );
          return {
            ticketId: Number(ticket.id),
            status: nextStatus,
            extensionDays: pauseMaxDays,
            rowVersion: Number(ticket.row_version || 1) + 1,
            reason: 'AUTO_RESUME_PAUSE_LIMIT',
          };
        });
        results.push(result);
      } catch (error) {
        results.push({ ticketId: Number(row.id), error: error?.code || error?.message || 'failed' });
      }
    }
    return results;
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
    usageMethod = null,
    scenarioId = null,
    coachProfileId = null,
    providerUserIdSnapshot = null,
    venueNameSnapshot = null,
    citySnapshot = null,
    quantitySnapshot = null,
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
                s.coach_profile_id, s.coach_name, s.owner_user_id,
                s.location
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
        providerUserId: session.owner_user_id || null,
        ...eventMetadata,
      };
    }
    const resolvedProviderUserId = providerUserIdSnapshot
      ?? (text(eventMetadata.providerUserId, 36) || null);
    let operationalParityActive = false;
    if (countCardParityEnabled) {
      const settings = await loadSettings(conn, resolvedProviderUserId);
      const scopedSettings = resolvedProviderUserId
        ? settings.provider
        : settings.platform;
      if (Number(scopedSettings?.count_card_parity_enabled || 0)) {
        await assertCountCardParity(conn);
        operationalParityActive = true;
        if (sessionId && (
          eventMetadata.venueName === undefined
          || eventMetadata.city === undefined
        )) {
          const [dimensionRows] = await conn.query(
            'SELECT venue_name, city FROM course_sessions WHERE id = ? LIMIT 1',
            [sessionId]
          );
          const dimensions = dimensionRows[0] || {};
          if (eventMetadata.venueName === undefined) {
            eventMetadata.venueName = dimensions.venue_name
              || eventMetadata.location
              || '';
          }
          if (eventMetadata.city === undefined) {
            eventMetadata.city = dimensions.city || '';
          }
        }
      }
    }
    const resolvedUsageMethod = text(
      usageMethod ?? eventMetadata.method,
      32
    ).toLowerCase() || null;
    const resolvedScenarioId = scenarioId ?? positiveInt(eventMetadata.scenarioId);
    const resolvedCoachProfileId = coachProfileId ?? positiveInt(eventMetadata.coachProfileId);
    const resolvedVenueName = venueNameSnapshot
      ?? eventMetadata.venueName
      ?? eventMetadata.location
      ?? null;
    const resolvedCity = citySnapshot ?? eventMetadata.city ?? null;
    const resolvedQuantity = quantitySnapshot
      ?? positiveInt(eventMetadata.quantity, Math.max(1, Math.abs(Number(deltaUses)) || 1));
    const operationalFact = operationalParityActive && Boolean(
      resolvedUsageMethod
      || resolvedScenarioId
      || resolvedCoachProfileId
      || resolvedProviderUserId
      || resolvedVenueName
      || resolvedCity
      || resolvedQuantity
    );
    const baseParams = [
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
    ];
    const [result] = await conn.query(
      operationalFact
        ? `INSERT INTO course_usage_events
            (command_id, ticket_id, student_id, user_id, session_id, booking_id, invite_id,
             event_type, usage_method, scenario_id, coach_profile_id,
             provider_user_id_snapshot, venue_name_snapshot, city_snapshot,
             delta_uses, quantity_snapshot, balance_after, source_type, source_id,
             reverses_event_id, idempotency_key, is_anomaly, actor_user_id, note, metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        : `INSERT INTO course_usage_events
            (command_id, ticket_id, student_id, user_id, session_id, booking_id, invite_id,
             event_type, delta_uses, balance_after, source_type, source_id,
             reverses_event_id, idempotency_key, is_anomaly, actor_user_id, note, metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      operationalFact
        ? [
          ...baseParams.slice(0, 8),
          resolvedUsageMethod,
          resolvedScenarioId,
          resolvedCoachProfileId,
          resolvedProviderUserId || null,
          text(resolvedVenueName, 255) || null,
          text(resolvedCity, 120) || null,
          Number(deltaUses),
          positiveInt(resolvedQuantity, Math.max(1, Math.abs(Number(deltaUses)) || 1)),
          ...baseParams.slice(9),
        ]
        : baseParams
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
    note = '',
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
      note,
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
    const [scopeRows] = await conn.query(
      `SELECT s.owner_user_id, b.origin
         FROM course_bookings b
         JOIN course_sessions s ON s.id = b.session_id
        WHERE b.id = ? LIMIT 1`,
      [positiveInt(bookingId)]
    );
    if (!scopeRows[0]) throw domainError('COURSE_BOOKING_NOT_FOUND', '找不到課程預約', 404);
    assertCountCardBookingBoundary(scopeRows[0]);
    let operationalParity;
    if (String(scopeRows[0].origin || '').toUpperCase() === 'ATTENDANCE_INVITE') {
      // Existing invite resolution remains an exact 051 operation even after a
      // rollout flag is disabled: preserve redeem_quantity and usage_mode.
      await assertCountCardParity(conn, { requireEnabled: false });
      operationalParity = true;
    } else {
      operationalParity = await countCardOperationalParityActive(
        conn,
        scopeRows[0].owner_user_id
      );
    }
    const [rows] = await conn.query(
      `SELECT b.*, s.starts_at, s.ends_at, s.status AS session_status, s.owner_user_id,
              s.location, s.coach_profile_id, s.coach_name,
              s.booking_open_at, s.booking_close_at, s.booking_open_minutes_before,
              s.booking_close_minutes_before, s.cancel_close_minutes_before,
              s.redeem_open_at, s.redeem_close_at, s.redeem_open_minutes_before,
              s.redeem_close_minutes_after, s.settings_snapshot_json, s.scenario_id,
              rs.name AS scenario_name,
              ${operationalParity
    ? `rs.item_type AS scenario_item_type,
              rs.session_bound AS scenario_session_bound,
              rs.redeem_quantity AS scenario_redeem_quantity,`
    : `'class' AS scenario_item_type,
              1 AS scenario_session_bound,
              1 AS scenario_redeem_quantity,`}
              rs.redeem_open_minutes_before AS scenario_redeem_open_minutes_before,
              rs.redeem_close_minutes_after AS scenario_redeem_close_minutes_after,
              sap.redeem_open_minutes_before AS allowed_redeem_open_minutes_before,
              sap.redeem_close_minutes_after AS allowed_redeem_close_minutes_after,
              t.row_version AS ticket_row_version, t.ticket_product_id,
              ${operationalParity
    ? "COALESCE(t.usage_mode_snapshot, tp.usage_mode, 'finite')"
    : "'finite'"} AS usage_mode,
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
    assertCountCardBookingBoundary(booking);
    if (expectedRowVersion && Number(booking.row_version || 1) !== Number(expectedRowVersion)) {
      throw domainError('COURSE_ROW_VERSION_CONFLICT', '預約已變更，請重新載入', 409);
    }
    if (String(booking.status) !== 'booked') {
      throw domainError('COURSE_BOOKING_NOT_REDEEMABLE', '此預約目前不能核銷', 409);
    }
    const liveSettings = await loadSettings(conn, booking.owner_user_id);
    const scopedBooking = await withCountCardSessionFields(conn, booking, {
      liveSettings,
      forUpdate: true,
    });
    const settings = settingsForSession(scopedBooking, liveSettings);
    const redemptionPolicy = parseJson(booking.redemption_policy_json, {});
    const policy = resolveCoursePolicy({
      session: scopedBooking,
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
    let hold = holdRows[0] || null;
    // The default invite expiry policy deliberately releases its hold and
    // creates a pending-review booking. A later ops/admin decision must
    // atomically reserve the exact scenario quantity again before writing
    // SUCCESS or NO_SHOW; this prevents a released right from being spent
    // twice while still keeping the manual resolution path usable.
    if (!hold && booking.ticket_id && allowOutsideWindow
      && String(booking.origin || '').toUpperCase() === 'ATTENDANCE_INVITE') {
      const [releasedInviteRows] = await conn.query(
        `SELECT id
           FROM course_attendance_invites
          WHERE booking_id = ? AND ticket_id = ?
            AND status = 'expired' AND expiry_action = 'release'
          ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [booking.id, booking.ticket_id]
      );
      const releasedInvite = releasedInviteRows[0];
      if (releasedInvite) {
        hold = await createHold(conn, {
          ticketId: booking.ticket_id,
          bookingId: booking.id,
          inviteId: releasedInvite.id,
          quantity: Math.max(1, positiveInt(booking.scenario_redeem_quantity, 1)),
          purpose: 'ATTENDANCE_CONFIRMATION',
          sourceType: 'attendance_invite_resolution',
          sourceId: releasedInvite.id,
        });
      }
    }
    const attendanceUsage = resolveAttendanceUsage(eventType, {
      ticketId: booking.ticket_id,
      hold,
      usageMode: booking.usage_mode,
    });
    const { hasTicket, deltaUses, quantity, usageMode } = attendanceUsage;
    const now = Date.now();
    if (eventType === 'NO_SHOW' && now < Number(policy.startsAt)) {
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
        method: inviteId
          ? 'attendance_invite'
          : (String(booking.origin || '').toUpperCase() === 'WALK_IN'
            ? 'walk_in'
            : (requireOutsideWindow ? 'late_attendance' : (eventType === 'NO_SHOW'
              ? 'no_show'
              : 'booking_attendance'))),
        usageMode,
        quantity,
        scenarioId: booking.scenario_id == null ? null : Number(booking.scenario_id),
        scenarioName: booking.scenario_name || '',
        coachProfileId: booking.coach_profile_id == null ? null : Number(booking.coach_profile_id),
        coachName: booking.coach_name || '',
        location: scopedBooking.location || '',
        venueName: scopedBooking.venue_name || scopedBooking.location || '',
        city: scopedBooking.city || '',
        providerUserId: booking.owner_user_id || null,
        source: inviteId ? 'attendance_invite_attempt' : 'booking_attempt',
      },
      activateOnConsume: true,
      commandId,
    });
    const nextStatus = eventType === 'SUCCESS' ? 'attended' : 'no_show';
    const resolutionType = eventType === 'NO_SHOW'
      ? 'no_show'
      : (requireOutsideWindow ? 'late_attend' : 'attended');
    const [bookingUpdate] = await conn.query(
      `UPDATE course_bookings
          SET status = ?,
              resolution_type = ?,
              resolution_actor_user_id = ?, resolution_at = NOW(),
              attended_at = IF(? = 'attended', NOW(), attended_at),
              row_version = row_version + 1
        WHERE id = ? AND status = 'booked'`,
      [nextStatus, resolutionType, actorUserId, nextStatus, booking.id]
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
          quantity,
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
    const countCardOnlyAction = ['undo', 'excused-leave', 'no-show', 'makeup-redeem'].includes(action);
    if (countCardOnlyAction) {
      // A released attendance invite is compensating work and may outlive the
      // rollout flag. The transaction below still fail-closes every other new
      // count-card operation against runtime + provider flags.
      await assertCountCardParity(pool, { requireEnabled: false });
    }
    expectedRowVersion = requireRowVersion(expectedRowVersion, '預約');
    const operation = `booking.${action}`;
    return withMutationTransaction(async (conn) => {
      const [scopeRows] = await conn.query(
        `SELECT s.owner_user_id, b.origin,
                  EXISTS(
                    SELECT 1 FROM course_attendance_invites invite
                     WHERE invite.booking_id = b.id
                       AND invite.status = 'expired'
                       AND invite.expiry_action = 'release'
                  ) AS released_invite_compensation
             FROM course_bookings b
             JOIN course_sessions s ON s.id = b.session_id
            WHERE b.id = ? LIMIT 1 FOR UPDATE`,
        [positiveInt(bookingId)]
      );
      if (!scopeRows[0]) {
        throw domainError('COURSE_BOOKING_NOT_FOUND', '找不到課程預約', 404);
      }
      assertCountCardBookingBoundary(scopeRows[0]);
      if (countCardOnlyAction) {
        const releasedInviteCompensation = (
          String(scopeRows[0].origin || '').toUpperCase() === 'ATTENDANCE_INVITE'
          && Boolean(Number(scopeRows[0].released_invite_compensation || 0))
        );
        await assertCountCardParity(conn, {
          requireEnabled: !releasedInviteCompensation,
        });
        if (!releasedInviteCompensation) {
          await assertProviderCountCardParity(conn, scopeRows[0].owner_user_id);
        }
      }
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
              SET status = 'cancelled', resolution_type = 'excused_leave',
                  resolution_actor_user_id = ?, resolution_at = NOW(),
                  resolution_reason = ?,
                  cancelled_at = NOW(), row_version = row_version + 1
            WHERE id = ? AND status = 'booked'`,
          [actorUserId, text(note, 500) || null, booking.id]
        );
        // Excused leave is a typed booking resolution, not a balance fact.
        // Keeping it outside course_usage_events guarantees that the immutable
        // ticket ledger contains rights changes only.
        result = {
          bookingId: Number(booking.id),
          status: 'cancelled',
          resolutionType: 'excused_leave',
          usageEvent: null,
          rowVersion: Number(booking.row_version || 1) + 1,
        };
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
    if (!text(note, 500)) {
      throw domainError('COURSE_REVERSAL_REASON_REQUIRED', '管理沖正必須填寫原因', 400);
    }
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
      eventType: 'REVERSAL',
      deltaUses: -Number(original.delta_uses),
      sourceType: 'usage_event_reversal',
      sourceId: original.id,
      reversesEventId: original.id,
      idempotencyKey,
      actorUserId,
      note,
      metadata: {
        originalEventType: original.event_type,
        quantity: Math.max(
          1,
          Math.abs(Number(original.delta_uses || 0))
            || positiveInt(parseJson(original.metadata_json, {}).quantity, 1)
        ),
        method: 'admin_adjustment',
      },
      usageMethod: 'admin_adjustment',
      scenarioId: original.scenario_id,
      coachProfileId: original.coach_profile_id,
      providerUserIdSnapshot: original.provider_user_id_snapshot,
      venueNameSnapshot: original.venue_name_snapshot,
      citySnapshot: original.city_snapshot,
      quantitySnapshot: Math.max(1, Number(original.quantity_snapshot || 0)
        || Math.abs(Number(original.delta_uses || 0)) || 1),
      commandId,
    });
    await conn.query(
      `UPDATE course_bookings
          SET status = 'booked', attended_at = NULL,
              resolution_type = 'reversal', resolution_actor_user_id = ?,
              resolution_at = NOW(), resolution_reason = ?,
              row_version = row_version + 1
        WHERE id = ?`,
      [actorUserId, text(note, 500) || null, booking.id]
    );
    const hold = original.ticket_id
      ? await createHold(conn, {
        ticketId: original.ticket_id,
        bookingId: booking.id,
        quantity: Math.max(1, Math.abs(Number(original.delta_uses || 0))
          || positiveInt(parseJson(original.metadata_json, {}).quantity, 1)),
      })
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
        usageMethod: 'admin_adjustment',
        quantitySnapshot: Math.abs(delta),
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
        usageMethod: 'refund',
        quantitySnapshot: Math.max(1, Math.abs(deltaUses) || 1),
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
      assertCountCardBookingBoundary(booking);
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { bookingId: Number(bookingId), expectedRowVersion, reason },
        resourceType: 'booking',
        resourceId: bookingId,
      });
      if (mutation.replay) return mutation.replay;
      if (booking.status !== 'booked') throw domainError('COURSE_BOOKING_STATUS_LOCKED', '此預約不能取消', 409);
      if (expectedRowVersion && Number(booking.row_version || 1) !== Number(expectedRowVersion)) {
        throw domainError('COURSE_ROW_VERSION_CONFLICT', '預約已變更，請重新載入', 409);
      }
      const liveSettings = await loadSettings(conn, booking.owner_user_id);
      const scopedBooking = await withCountCardSessionFields(conn, booking, {
        liveSettings,
        forUpdate: true,
      });
      const settings = settingsForSession(scopedBooking, liveSettings);
      const policy = resolveCoursePolicy({
        session: scopedBooking,
        providerSettings: settings.provider,
        platformSettings: settings.platform,
      });
      if (enforceWindow && !policy.canCancel) {
        throw domainError('COURSE_BOOKING_CANCEL_CLOSED', '已超過取消截止時間', 409, policy);
      }
      const hold = await releaseHold(conn, { bookingId: booking.id, actorUserId, reason });
      await conn.query(
        `UPDATE course_bookings
            SET status = 'cancelled', resolution_type = 'member_cancel',
                resolution_actor_user_id = ?, resolution_at = NOW(),
                resolution_reason = ?,
                cancelled_at = NOW(), row_version = row_version + 1
          WHERE id = ? AND status = 'booked'`,
        [actorUserId, text(reason, 500) || null, booking.id]
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
    if (!['pause', 'resume'].includes(action)) {
      throw domainError('COURSE_TICKET_STATE_ACTION_INVALID', '票券狀態操作不正確', 400);
    }
    await assertCountCardParity(pool, { requireEnabled: action !== 'resume' });
    expectedRowVersion = requireRowVersion(expectedRowVersion, '票券');
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
      const featureTicket = await loadPartialTransferTicket(conn, ticket.id, { forUpdate: false });
      if (action === 'pause') {
        await assertProviderCountCardParity(conn, featureTicket?.provider_owner_user_id);
      } else {
        await assertCountCardParity(conn, { requireEnabled: false });
      }
      const balance = await ledgerBalance(conn, ticket.id);
      let extensionDays = 0;
      let nextStatus;
      if (action === 'pause') {
        if (ticket.status !== 'active' || (!balance.unlimited && balance.remainingUses <= 0)) {
          throw domainError('COURSE_TICKET_PAUSE_FAIL', '此票券目前無法暫停', 409);
        }
        if (!ticket.expires_at) {
          throw domainError('COURSE_TICKET_PAUSE_FAIL', '無到期日票券不能暫停', 409);
        }
        if (balance.heldUses > 0) {
          throw domainError('COURSE_TICKET_ACTIVE_HOLD', '票券仍有保留堂數，請先取消預約或邀請', 409);
        }
        const pauseMaxOperations = Math.max(0, integer(
          ticket.pause_max_operations_snapshot,
          1
        ));
        const [[pauseCountRow]] = await conn.query(
          `SELECT COUNT(*) AS pause_count
             FROM course_ticket_state_periods
            WHERE ticket_id = ? AND state = 'paused'`,
          [ticket.id]
        );
        const pauseCount = Number(pauseCountRow?.pause_count || 0);
        if (pauseMaxOperations > 0 && pauseCount >= pauseMaxOperations) {
          throw domainError(
            'COURSE_TICKET_PAUSE_LIMIT_REACHED',
            '此票券已用完可暫停次數',
            409,
            { pauseCount, pauseMaxOperations }
          );
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
        const elapsedDays = Math.max(
          1,
          Math.ceil((Date.now() - taipeiDateTimeMs(period.started_at)) / 86400000)
        );
        const pauseMaxDays = Math.max(1, positiveInt(
          ticket.pause_max_days_snapshot,
          365
        ));
        extensionDays = Math.min(elapsedDays, pauseMaxDays);
        nextStatus = balance.unlimited || balance.remainingUses > 0
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

  async function reactivateExpiredTicket({
    ticketId,
    actorUserId,
    extensionDays,
    reason = '',
    idempotencyKey,
    expectedRowVersion,
  }) {
    await assertMutationAllowed();
    await assertSchema();
    await assertCountCardParity();
    expectedRowVersion = requireRowVersion(expectedRowVersion, '票券');
    const days = positiveInt(extensionDays);
    if (!days || days > 3650) {
      throw domainError('VALIDATION_ERROR', '請指定 1 至 3650 日展延天數', 400);
    }
    const normalizedReason = text(reason, 500);
    if (!normalizedReason) {
      throw domainError('VALIDATION_ERROR', '復活過期票券必須填寫原因', 400);
    }
    return withMutationTransaction(async (conn) => {
      const operation = 'ticket.reactivate';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: {
          ticketId: Number(ticketId),
          expectedRowVersion,
          extensionDays: days,
          reason: normalizedReason,
        },
        resourceType: 'ticket',
        resourceId: ticketId,
      });
      if (mutation.replay) return mutation.replay;
      const balance = await ledgerBalance(conn, ticketId, { lockTicket: true });
      const ticket = balance.ticket;
      await assertCountCardParity(conn);
      const featureTicket = await loadPartialTransferTicket(conn, ticketId, { forUpdate: false });
      await assertProviderCountCardParity(conn, featureTicket?.provider_owner_user_id);
      if (Number(ticket.row_version || 1) !== expectedRowVersion) {
        throw domainError('COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 409);
      }
      if (
        ticket.frozen_at
        || !['active', 'exhausted', 'expired'].includes(String(ticket.status || '').toLowerCase())
      ) {
        throw domainError('COURSE_TICKET_REACTIVATE_FAIL', '此票券不能復活', 409);
      }
      if (!ticket.expires_at || taipeiDateTimeMs(ticket.expires_at) >= Date.now()) {
        throw domainError('COURSE_TICKET_NOT_EXPIRED', '票券尚未過期', 409);
      }
      if (balance.remainingUses <= 0 || balance.heldUses > 0) {
        throw domainError(
          balance.heldUses > 0 ? 'COURSE_TICKET_ACTIVE_HOLD' : 'COURSE_TICKET_BALANCE_EMPTY',
          balance.heldUses > 0 ? '票券有未結保留堂數，不能復活' : '票券沒有可復活餘額',
          409
        );
      }
      const [update] = await conn.query(
        `UPDATE course_tickets
            SET status = 'active', expires_at = DATE_ADD(CURRENT_DATE(), INTERVAL ? DAY),
                row_version = row_version + 1
          WHERE id = ? AND row_version = ?`,
        [days, ticket.id, expectedRowVersion]
      );
      if (!update.affectedRows) {
        throw domainError('COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 409);
      }
      await conn.query(
        `INSERT INTO course_ticket_state_periods
          (ticket_id, state, started_at, ended_at, extension_days, reason,
           actor_user_id, metadata_json)
         VALUES (?, 'reactivated', NOW(), NOW(), ?, ?, ?, ?)`,
        [
          ticket.id,
          days,
          normalizedReason,
          actorUserId,
          JSON.stringify({
            previousExpiresAt: ticket.expires_at,
            previousStatus: ticket.status,
            remainingUses: balance.remainingUses,
          }),
        ]
      );
      const result = {
        ticketId: Number(ticket.id),
        status: 'active',
        extensionDays: days,
        previousExpiresAt: ticket.expires_at,
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

  async function ensureAttendanceInviteBooking(conn, invite) {
    if (invite.booking_id) return Number(invite.booking_id);
    const attendee = await resolveRegisteredAttendee({
      queryable: conn,
      ownerUserId: invite.owner_user_id || null,
      studentId: invite.student_id,
      userId: invite.user_id,
      forUpdate: true,
    });
    const verifyCode = `CBK-${randomBytes(10).toString('hex').toUpperCase()}`;
    const [bookingInsert] = await conn.query(
      `INSERT INTO course_bookings
        (session_id, ticket_id, user_id, student_id, attendee_name, attendee_email,
         verify_code, status, origin, row_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'booked', 'ATTENDANCE_INVITE', 1)`,
      [
        invite.session_id,
        invite.ticket_id,
        attendee.userId,
        attendee.studentId,
        attendee.displayName,
        attendee.email,
        verifyCode,
      ]
    );
    const bookingId = Number(bookingInsert.insertId);
    if (!bookingId) {
      throw domainError(
        'COURSE_ATTENDANCE_INVITE_BOOKING_FAIL',
        '無法建立補登邀請的出席投影',
        409
      );
    }
    if (invite.hold_id) {
      await conn.query(
        'UPDATE course_ticket_holds SET booking_id = ? WHERE id = ?',
        [bookingId, invite.hold_id]
      );
    }
    await conn.query(
      'UPDATE course_attendance_invites SET booking_id = ? WHERE id = ? AND booking_id IS NULL',
      [bookingId, invite.id]
    );
    return bookingId;
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
    await assertCountCardParity();
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
      const session = await loadSession(conn, sessionId, {
        forUpdate: true,
        operationalParity: true,
      });
      if (!session) throw domainError('COURSE_SESSION_NOT_FOUND', '找不到課程場次', 404);
      assertCountCardSessionBoundary(session);
      if (String(session.status || '').toLowerCase() === 'cancelled') {
        throw domainError('COURSE_SESSION_CANCELLED', '場次已取消，不能建立補登邀請', 409);
      }
      await assertCountCardParity(conn);
      await assertProviderCountCardParity(conn, session.owner_user_id);
      const sessionVersion = requireRowVersion(expectedSessionRowVersion, '場次');
      if (Number(session.row_version || 1) !== sessionVersion) {
        throw domainError('COURSE_ROW_VERSION_CONFLICT', '場次已變更，請重新載入', 409);
      }
      let selectedTicketId = positiveInt(ticketId);
      const attendee = await resolveRegisteredAttendee({
        queryable: conn,
        ownerUserId: session.owner_user_id,
        studentId,
        userId,
        attendeeEmail,
        forUpdate: true,
      });
      studentId = attendee.studentId;
      userId = attendee.userId;
      const existingParams = [session.id, userId, studentId];
      const [existingBookingRows] = await conn.query(
        `SELECT b.*, h.id AS hold_id
           FROM course_bookings b
           LEFT JOIN course_ticket_holds h
             ON h.booking_id = b.id AND h.status = 'active'
          WHERE b.session_id = ? AND (b.user_id = ? OR b.student_id = ?)
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
      const expiryAction = normalizeAttendanceInviteExpiryAction(
        effectiveSettings.provider.attendance_invite_expiry_action
          ?? effectiveSettings.platform.attendance_invite_expiry_action
          ?? invitePolicy.inviteExpiryAction
      );
      const [result] = await conn.query(
        `INSERT INTO course_attendance_invites
          (owner_user_id, session_id, booking_id, student_id, user_id, ticket_id,
           hold_id, token_hash, status, expires_at, expiry_action,
           expiry_action_snapshot_at, auto_redeem_at, row_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NOW(), ?, 1)`,
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
          expiryAction,
          expiryAction === 'auto_redeem' ? mysqlDateTime(expiry) : null,
        ]
      );
      const inviteId = Number(result.insertId);
      const hold = await createHold(conn, {
        ticketId: selectedTicketId,
        inviteId,
        expiresAt: expiry,
        quantity: Math.max(1, positiveInt(session.scenario_redeem_quantity, 1)),
        purpose: 'ATTENDANCE_CONFIRMATION',
        sourceType: 'attendance_invite',
        sourceId: inviteId,
      });
      await conn.query(
        'UPDATE course_attendance_invites SET hold_id = ? WHERE id = ?',
        [hold.id, inviteId]
      );
      const notification = await enqueueNotificationOutbox(conn, {
        ownerUserId: session.owner_user_id || null,
        userId,
        eventType: 'COUNT_ATTENDANCE_INVITE_CREATED',
        dedupeKey: `count-attendance-invite-created:${inviteId}`,
        payload: {
          inviteId,
          sessionId: Number(session.id),
          sessionTitle: session.title || session.code || '',
          inviteToken: rawToken,
          rowVersion: 1,
          expiresAt: mysqlDateTime(expiry),
          expiryAction,
          redeemQuantity: Number(hold.quantity || session.scenario_redeem_quantity || 1),
        },
      }, { ownerUserId: session.owner_user_id || null });
      const response = {
        id: inviteId,
        token: rawToken,
        status: 'pending',
        expiresAt: mysqlDateTime(expiry),
        expiryAction,
        autoRedeemAt: expiryAction === 'auto_redeem' ? mysqlDateTime(expiry) : null,
        hold,
        bookingId: null,
        sessionRowVersion: sessionVersion,
        ticketRowVersion: hold?.ticketRowVersion || ticketVersion,
        rowVersion: 1,
        notificationQueued: Boolean(notification.queued),
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
    capacityOverride = false,
    capacityOverrideReason = '',
    allowCapacityOverride = false,
  }) {
    await assertMutationAllowed();
    await assertSchema();
    await assertCountCardParity();
    const sessionVersion = requireRowVersion(expectedSessionRowVersion, '場次');
    const ticketVersion = requireRowVersion(expectedTicketRowVersion, '票券');
    const requestedCapacityOverride = Boolean(capacityOverride);
    const normalizedOverrideReason = text(capacityOverrideReason, 500);
    if (requestedCapacityOverride && !allowCapacityOverride) {
      throw domainError(
        'COURSE_CAPACITY_OVERRIDE_FORBIDDEN',
        '只有 ops、服務商或管理員可以超額安排 Walk-in',
        403
      );
    }
    if (requestedCapacityOverride && !normalizedOverrideReason) {
      throw domainError(
        'COURSE_CAPACITY_OVERRIDE_REASON_REQUIRED',
        '超額安排 Walk-in 必須填寫原因',
        400
      );
    }
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
          capacityOverride: requestedCapacityOverride,
          capacityOverrideReason: normalizedOverrideReason,
        },
        resourceType: 'session',
        resourceId: sessionId,
      });
      if (mutation.replay) return mutation.replay;
      const session = await loadSession(conn, sessionId, {
        forUpdate: true,
        operationalParity: true,
      });
      if (!session) throw domainError('COURSE_SESSION_NOT_FOUND', '找不到課程場次', 404);
      assertCountCardSessionBoundary(session);
      if (String(session.status || '').toLowerCase() === 'cancelled') {
        throw domainError('COURSE_SESSION_CANCELLED', '場次已取消，不能建立 Walk-in', 409);
      }
      await assertCountCardParity(conn);
      await assertProviderCountCardParity(conn, session.owner_user_id);
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
      const attendee = await resolveRegisteredAttendee({
        queryable: conn,
        ownerUserId: session.owner_user_id,
        studentId,
        userId,
        attendeeEmail,
        forUpdate: true,
      });
      studentId = attendee.studentId;
      userId = attendee.userId;
      const normalizedAttendeeEmail = attendee.email;
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
        && Number(capacityRow?.occupied || 0) >= Number(capacityRow.capacity)
        && !requestedCapacityOverride) {
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
           verify_code, status, origin, capacity_override, capacity_override_reason,
           booked_at, row_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'booked', 'WALK_IN', ?, ?, NOW(), 1)`,
        [
          session.id,
          ticket.id,
          userId || student.user_id || null,
          studentId || ticket.student_id || null,
          text(attendeeName || attendee.displayName || student.display_name || ticket.owner_name, 255),
          attendee.email,
          verifyCode,
          requestedCapacityOverride ? 1 : 0,
          requestedCapacityOverride ? normalizedOverrideReason : null,
        ]
      );
      const bookingId = Number(bookingResult.insertId);
      await createHold(conn, {
        ticketId: ticket.id,
        bookingId,
        quantity: Math.max(1, positiveInt(session.scenario_redeem_quantity, 1)),
        purpose: 'BOOKING',
        sourceType: 'walk_in',
        sourceId: bookingId,
      });
      const attendance = await consumeAttendance(conn, {
        bookingId,
        eventType: 'SUCCESS',
        actorUserId,
        idempotencyKey,
        note,
        commandId: mutation.commandId,
      });
      const response = {
        ...attendance,
        walkIn: true,
        capacityOverride: requestedCapacityOverride,
        capacityOverrideReason: requestedCapacityOverride ? normalizedOverrideReason : null,
      };
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
    await assertCountCardParity(pool, { requireEnabled: false });
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
      await assertCountCardParity(conn, { requireEnabled: false });
      if (invite.status !== 'pending') throw domainError('COURSE_ATTENDANCE_INVITE_USED', '補登邀請已處理', 409);
      if (Number(invite.row_version || 1) !== expectedRowVersion) {
        throw domainError('COURSE_ROW_VERSION_CONFLICT', '補登邀請已變更，請重新載入', 409);
      }
      if (taipeiDateTimeMs(invite.expires_at) < Date.now()) {
        throw domainError('COURSE_ATTENDANCE_INVITE_EXPIRED', '補登邀請已逾期', 409);
      }
      const bookingId = await ensureAttendanceInviteBooking(conn, invite);
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
    await assertCountCardParity(pool, { requireEnabled: false });
    const [rows] = await pool.query(
      `SELECT i.id
         FROM course_attendance_invites i
        WHERE i.status = 'pending' AND i.expires_at <= ?
        ORDER BY i.expires_at, i.id LIMIT ?`,
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
          await assertCountCardParity(conn, { requireEnabled: false });
          const expiryAction = attendanceInviteExpiryDisposition(invite);
          if (expiryAction === 'release') {
            let pendingReviewBookingId = null;
            pendingReviewBookingId = await ensureAttendanceInviteBooking(conn, invite);
            const hold = await releaseHold(conn, {
              inviteId: invite.id,
              actorUserId: invite.owner_user_id || null,
              reason: 'attendance_invite_expired',
            });
            await conn.query(
              `UPDATE course_attendance_invites
                  SET status = 'expired', row_version = row_version + 1
                WHERE id = ? AND status = 'pending'`,
              [invite.id]
            );
            const released = {
              id: Number(invite.id),
              status: 'expired',
              expiryAction,
              holdReleased: Boolean(hold),
            };
            if (pendingReviewBookingId) {
              released.bookingId = pendingReviewBookingId;
              released.pendingReview = true;
            }
            const notification = await enqueueNotificationOutbox(conn, {
              ownerUserId: invite.owner_user_id || null,
              userId: invite.user_id || null,
              eventType: 'COUNT_ATTENDANCE_INVITE_EXPIRED',
              dedupeKey: `count-attendance-invite-expired:${invite.id}`,
              payload: {
                inviteId: Number(invite.id),
                sessionId: Number(invite.session_id),
                status: 'expired',
                expiryAction,
                bookingId: pendingReviewBookingId,
                holdReleased: Boolean(hold),
              },
            }, { ownerUserId: invite.owner_user_id || null });
            released.notificationQueued = Boolean(notification.queued);
            return released;
          }
          if (!invite.ticket_id || !invite.hold_id) {
            await conn.query(
              `UPDATE course_attendance_invites
                  SET status = 'blocked', note = 'missing ticket hold',
                      row_version = row_version + 1
                WHERE id = ?`,
              [invite.id]
            );
            const notification = await enqueueNotificationOutbox(conn, {
              ownerUserId: invite.owner_user_id || null,
              userId: invite.user_id || null,
              eventType: 'COUNT_ATTENDANCE_INVITE_EXPIRED',
              dedupeKey: `count-attendance-invite-expired:${invite.id}`,
              payload: {
                inviteId: Number(invite.id),
                sessionId: Number(invite.session_id),
                status: 'blocked',
                expiryAction,
                anomaly: 'missing_ticket_hold',
              },
            }, { ownerUserId: invite.owner_user_id || null });
            return {
              id: Number(invite.id),
              status: 'blocked',
              anomaly: 'missing_ticket_hold',
              notificationQueued: Boolean(notification.queued),
            };
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
                 verify_code, status, origin, row_version)
               SELECT ?, ?, ?, ?, COALESCE(s.display_name, ''), COALESCE(s.email, ''),
                      ?, 'booked', 'ATTENDANCE_INVITE', 1
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
          const notification = await enqueueNotificationOutbox(conn, {
            ownerUserId: invite.owner_user_id || null,
            userId: invite.user_id || null,
            eventType: 'COUNT_ATTENDANCE_INVITE_EXPIRED',
            dedupeKey: `count-attendance-invite-expired:${invite.id}`,
            payload: {
              inviteId: Number(invite.id),
              sessionId: Number(invite.session_id),
              status: 'auto_redeemed',
              expiryAction,
              bookingId,
              usageEventId: redeemed.usageEvent.id,
            },
          }, { ownerUserId: invite.owner_user_id || null });
          return {
            id: Number(invite.id),
            status: 'auto_redeemed',
            expiryAction,
            usageEventId: redeemed.usageEvent.id,
            notificationQueued: Boolean(notification.queued),
          };
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
    await assertCountCardParity();
    const nowMs = taipeiDateTimeMs(now);
    const [rows] = await pool.query(
      `SELECT b.id
         FROM course_bookings b
         JOIN course_sessions s ON s.id = b.session_id
         LEFT JOIN course_settings provider_settings
           ON provider_settings.scope_key = CONCAT('provider:', s.owner_user_id)
         JOIN course_settings platform_settings ON platform_settings.scope_key = 'platform'
        WHERE b.status = 'booked'
          AND COALESCE(b.origin, 'MEMBER_RSVP') NOT IN ('TERM_ROSTER', 'MAKEUP')
          AND CASE
            WHEN s.owner_user_id IS NULL
              THEN platform_settings.count_card_parity_enabled
            ELSE COALESCE(provider_settings.count_card_parity_enabled, 0)
          END = 1
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
          await assertCountCardParity(conn);
          await assertProviderCountCardParity(conn, booking.owner_user_id);
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
    COURSE_COUNT_CARD_PARITY_SCHEMA_VERSION,
    acceptPartialTransfer,
    adjustTicket,
    assertCountCardBookingBoundary,
    assertCountCardParity,
    assertCountCardSessionBoundary,
    assertProviderCountCardParity,
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
    enqueueNotificationOutbox,
    countCardParityEnabled,
    enabled,
    enrichTicketBalances,
    getSessionEligibility,
    getBookingPolicy,
    initiatePartialTransfer,
    ledgerBalance,
    listMemberPartialTransfers,
    listTicketLedger,
    loadSettings,
    mutationKeyFromRequest,
    processDueAutoNoShows,
    processDueAttendanceInvites,
    processDuePausedTickets,
    processDuePartialTransfers,
    previewPartialTransfer,
    readRuntimeState,
    reactivateExpiredTicket,
    recordIssuance,
    recordUsageEvent,
    resolveRegisteredAttendee,
    refundTicket,
    resolvePartialTransfer,
    releaseHold,
    rowVersionFromRequest,
    syncTicketBalanceCache,
    withMutationTransaction,
    withTransaction,
  };
}

module.exports = {
  COURSE_COUNT_CARD_PARITY_SCHEMA_VERSION,
  COURSE_V2_SCHEMA_VERSION,
  assertCountCardBookingBoundary,
  assertCountCardSessionBoundary,
  createCourseV2Domain,
  domainError,
  mysqlDateTime,
  mutationKeyFromRequest,
  requireRowVersion,
  resolveAttendanceUsage,
  requestHash,
  rowVersionFromRequest,
  stableStringify,
  partialTransferBlockReason,
  toTicketBalance,
};
