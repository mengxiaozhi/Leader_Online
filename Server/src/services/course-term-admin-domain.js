'use strict';

const {
  assertIdempotencyKey,
  courseTermError,
  dateMs,
  ensureRowVersion,
  mysqlDateTime,
  positiveInteger,
  requestHash,
  text,
} = require('./course-term-policy');
const { randomCode } = require('./course-term-domain');

const PRICING_MODES = new Set([
  'FULL_TERM',
  'PRO_RATA_SESSIONS',
  'UNIT_X_REMAINING',
  'PRO_RATA_CALENDAR',
]);

function slug(value) {
  return text(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function numberOrNull(value, { integer = false, minimum = 0 } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = integer ? Number.parseInt(value, 10) : Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : null;
}

function optionalPositiveId(value, fieldName = '關聯資料') {
  if (value === undefined || value === null || value === '') return null;
  const parsed = positiveInteger(value, null);
  if (!parsed) throw courseTermError('COURSE_REFERENCE_INVALID', `${fieldName} ID 不正確`, 400);
  return parsed;
}

function bodyField(body, camelName, snakeName) {
  if (Object.prototype.hasOwnProperty.call(body || {}, camelName)) {
    return { present: true, value: body[camelName] };
  }
  if (Object.prototype.hasOwnProperty.call(body || {}, snakeName)) {
    return { present: true, value: body[snakeName] };
  }
  return { present: false, value: undefined };
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function jsonValue(value, fallback = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function dateOnly(value) {
  if (value === undefined || value === null || value === '') return null;
  const timestamp = dateMs(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function createCourseTermAdminDomain({ pool, termDomain } = {}) {
  if (!pool || !termDomain) throw new TypeError('course term admin domain requires pool and term domain');

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
      return { key, hash, commandId: Number(insert.insertId), replay: null };
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
      return {
        key,
        hash,
        commandId: Number(current.id),
        replay: jsonValue(current.response_json, null),
      };
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
      [
        JSON.stringify(response),
        resourceType,
        resourceId,
        actorUserId,
        operation,
        mutation.key,
      ]
    );
  }

  async function assertRuntime(conn, ownerUserId, { forUpdate = true, requirePayments = false } = {}) {
    await termDomain.assertSchema({ requirePayments });
    await termDomain.assertProviderRuntime(conn, ownerUserId, { forUpdate, requirePayments });
  }

  async function enqueue(conn, { ownerUserId, userId = null, eventType, dedupeKey, payload }) {
    await termDomain.enqueueOutbox(conn, {
      ownerUserId,
      userId,
      eventType,
      dedupeKey,
      payload,
    });
  }

  async function assertOwnedTermReferences(conn, {
    ownerUserId,
    programId,
    levelId = null,
  }) {
    const [programs] = await conn.query(
      `SELECT id FROM course_programs
        WHERE id = ? AND owner_user_id = ? LIMIT 1 FOR UPDATE`,
      [programId, ownerUserId]
    );
    if (!programs[0]) throw courseTermError('COURSE_PROGRAM_NOT_FOUND', '找不到此租戶的課程計畫', 404);
    if (!levelId) return;
    const [levels] = await conn.query(
      `SELECT id FROM course_levels
        WHERE id = ? AND owner_user_id = ? LIMIT 1 FOR UPDATE`,
      [levelId, ownerUserId]
    );
    if (!levels[0]) throw courseTermError('COURSE_LEVEL_NOT_FOUND', '找不到此租戶的程度', 404);
  }

  async function assertPricingSessionBounds(conn, {
    ownerUserId,
    termId,
    validFromSessionId = null,
    validThroughSessionId = null,
  }) {
    const requestedIds = [...new Set([validFromSessionId, validThroughSessionId].filter(Boolean))];
    if (!requestedIds.length) return;
    const placeholders = requestedIds.map(() => '?').join(', ');
    const [sessions] = await conn.query(
      `SELECT id, starts_at FROM course_sessions
        WHERE id IN (${placeholders}) AND owner_user_id = ? AND term_id = ?
          AND session_kind = 'TERM'
        FOR UPDATE`,
      [...requestedIds, ownerUserId, termId]
    );
    if (sessions.length !== requestedIds.length) {
      throw courseTermError(
        'COURSE_TERM_PRICING_SESSION_INVALID',
        '定價適用場次必須屬於同一租戶與班期',
        400
      );
    }
    if (validFromSessionId && validThroughSessionId) {
      const byId = new Map(sessions.map((session) => [Number(session.id), session]));
      if (dateMs(byId.get(Number(validThroughSessionId))?.starts_at)
        < dateMs(byId.get(Number(validFromSessionId))?.starts_at)) {
        throw courseTermError('COURSE_TERM_PRICING_SESSION_RANGE_INVALID', '定價結束場次不可早於起始場次', 400);
      }
    }
  }

  async function assertInsurancePolicyReferences(conn, {
    ownerUserId,
    targetSessionId,
    feeProductId = null,
  }) {
    const [sessions] = await conn.query(
      `SELECT id FROM course_sessions
        WHERE id = ? AND owner_user_id = ? LIMIT 1 FOR UPDATE`,
      [targetSessionId, ownerUserId]
    );
    if (!sessions[0]) throw courseTermError('COURSE_SESSION_NOT_FOUND', '找不到此租戶的補課場次', 404);
    if (!feeProductId) return;
    const [products] = await conn.query(
      `SELECT id FROM course_products
        WHERE id = ? AND owner_user_id = ? LIMIT 1 FOR UPDATE`,
      [feeProductId, ownerUserId]
    );
    if (!products[0]) throw courseTermError('COURSE_PRODUCT_NOT_FOUND', '找不到此租戶的保險費商品', 404);
  }

  async function listCatalog({ ownerUserId }) {
    await termDomain.assertSchema();
    await termDomain.assertProviderRuntime(pool, ownerUserId);
    const [programs, schemes, levels, terms, sessions, pricing, renewalRules] = await Promise.all([
      pool.query(
        `SELECT * FROM course_programs WHERE owner_user_id = ? ORDER BY name, id`,
        [ownerUserId]
      ),
      pool.query(
        `SELECT * FROM course_level_schemes WHERE owner_user_id = ? ORDER BY name, id`,
        [ownerUserId]
      ),
      pool.query(
        `SELECT l.*, s.name AS scheme_name
           FROM course_levels l
           JOIN course_level_schemes s
             ON s.id = l.scheme_id AND s.owner_user_id = l.owner_user_id
          WHERE l.owner_user_id = ? ORDER BY s.name, l.sort_order, l.id`,
        [ownerUserId]
      ),
      pool.query(
        `SELECT t.*, p.name AS program_name, l.name AS level_name,
                (SELECT COUNT(*) FROM course_sessions cs
                  WHERE cs.term_id = t.id AND cs.session_kind = 'TERM'
                    AND cs.status NOT IN ('cancelled','canceled')) AS session_count,
                (SELECT COUNT(*) FROM course_term_pricing_rules pr
                  WHERE pr.term_id = t.id AND pr.status = 'active') AS active_pricing_count
           FROM course_terms t
           JOIN course_programs p
             ON p.id = t.program_id AND p.owner_user_id = t.owner_user_id
           LEFT JOIN course_levels l
             ON l.id = t.level_id AND l.owner_user_id = t.owner_user_id
          WHERE t.owner_user_id = ? ORDER BY t.starts_on DESC, t.id DESC`,
        [ownerUserId]
      ),
      pool.query(
        `SELECT s.id, s.code, s.program_id, s.term_id, s.session_kind,
                s.term_session_sequence, s.title, s.coach_user_id, s.coach_name,
                s.location, s.venue_name, s.city, s.starts_at, s.ends_at,
                s.capacity, s.notes, s.status, s.row_version
           FROM course_sessions s
           JOIN course_terms t ON t.id = s.term_id
          WHERE s.owner_user_id = ? AND t.owner_user_id = ?
            AND s.session_kind = 'TERM'
          ORDER BY s.term_id, s.term_session_sequence, s.starts_at, s.id`,
        [ownerUserId, ownerUserId]
      ),
      pool.query(
        `SELECT * FROM course_term_pricing_rules
          WHERE owner_user_id = ? ORDER BY term_id, priority, id`,
        [ownerUserId]
      ),
      pool.query(
        `SELECT r.*, source.name AS source_term_name, target.name AS target_term_name
           FROM course_term_renewal_rules r
           JOIN course_terms source
             ON source.id = r.source_term_id AND source.owner_user_id = r.owner_user_id
           JOIN course_terms target
             ON target.id = r.target_term_id AND target.owner_user_id = r.owner_user_id
          WHERE r.owner_user_id = ? ORDER BY r.renewal_open_at DESC, r.id DESC`,
        [ownerUserId]
      ),
    ]);
    return {
      programs: programs[0],
      levelSchemes: schemes[0],
      levels: levels[0],
      terms: terms[0],
      sessions: sessions[0],
      pricingRules: pricing[0],
      renewalRules: renewalRules[0],
    };
  }

  async function createProgram({ ownerUserId, actorUserId, body, idempotencyKey }) {
    await termDomain.assertSchema();
    const name = text(body?.name, 255);
    const code = text(body?.code, 64).toUpperCase() || randomCode('CPR', 5);
    const programSlug = slug(body?.slug || name || code);
    if (!name || !programSlug) throw courseTermError('COURSE_PROGRAM_INVALID', '請填寫課程計畫名稱與 slug', 400);
    return withTransaction(async (conn) => {
      await assertRuntime(conn, ownerUserId);
      const operation = 'term.program.create';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { ownerUserId, body },
        resourceType: 'course_program',
      });
      if (mutation.replay) return mutation.replay;
      const [insert] = await conn.query(
        `INSERT INTO course_programs
          (owner_user_id, code, slug, name, summary, description, status, row_version)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', 1)`,
        [ownerUserId, code, programSlug, name, text(body?.summary, 500) || null, text(body?.description, 65535) || null]
      );
      const response = { id: Number(insert.insertId), code, slug: programSlug, status: 'draft', rowVersion: 1 };
      await completeMutation(conn, { actorUserId, operation, mutation, response, resourceType: 'course_program', resourceId: insert.insertId });
      return response;
    });
  }

  async function updateProgram({ programId, ownerUserId, actorUserId, body, idempotencyKey, expectedRowVersion }) {
    await termDomain.assertSchema();
    return withTransaction(async (conn) => {
      await assertRuntime(conn, ownerUserId);
      const [rows] = await conn.query(
        `SELECT * FROM course_programs WHERE id = ? AND owner_user_id = ? LIMIT 1 FOR UPDATE`,
        [positiveInteger(programId), ownerUserId]
      );
      const current = rows[0];
      if (!current) throw courseTermError('COURSE_PROGRAM_NOT_FOUND', '找不到課程計畫', 404);
      ensureRowVersion(current.row_version, expectedRowVersion, '課程計畫');
      const operation = 'term.program.update';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { programId: Number(current.id), expectedRowVersion, body },
        resourceType: 'course_program',
        resourceId: current.id,
      });
      if (mutation.replay) return mutation.replay;
      const next = {
        name: text(body?.name ?? current.name, 255),
        slug: slug(body?.slug ?? current.slug),
        summary: text(body?.summary ?? current.summary, 500) || null,
        description: text(body?.description ?? current.description, 65535) || null,
        status: ['draft', 'published', 'archived'].includes(text(body?.status, 24).toLowerCase())
          ? text(body.status, 24).toLowerCase()
          : current.status,
      };
      if (!next.name || !next.slug) throw courseTermError('COURSE_PROGRAM_INVALID', '課程計畫名稱與 slug 不可空白', 400);
      const [update] = await conn.query(
        `UPDATE course_programs
            SET name = ?, slug = ?, summary = ?, description = ?, status = ?,
                row_version = row_version + 1
          WHERE id = ? AND owner_user_id = ? AND row_version = ?`,
        [next.name, next.slug, next.summary, next.description, next.status, current.id, ownerUserId, expectedRowVersion]
      );
      if (!update.affectedRows) throw courseTermError('COURSE_PROGRAM_STATE_CONFLICT', '課程計畫已被更新', 409);
      const response = { id: Number(current.id), ...next, rowVersion: expectedRowVersion + 1 };
      await completeMutation(conn, { actorUserId, operation, mutation, response, resourceType: 'course_program', resourceId: current.id });
      return response;
    });
  }

  async function createLevelScheme({ ownerUserId, actorUserId, body, idempotencyKey }) {
    await termDomain.assertSchema();
    const name = text(body?.name, 255);
    const code = text(body?.code, 64).toUpperCase() || randomCode('CLS', 5);
    if (!name) throw courseTermError('COURSE_LEVEL_SCHEME_INVALID', '請填寫程度方案名稱', 400);
    return withTransaction(async (conn) => {
      await assertRuntime(conn, ownerUserId);
      const operation = 'term.level-scheme.create';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { ownerUserId, body },
        resourceType: 'course_level_scheme',
      });
      if (mutation.replay) return mutation.replay;
      const [insert] = await conn.query(
        `INSERT INTO course_level_schemes
          (owner_user_id, code, name, description, status, row_version)
         VALUES (?, ?, ?, ?, 'active', 1)`,
        [ownerUserId, code, name, text(body?.description, 65535) || null]
      );
      const response = { id: Number(insert.insertId), code, name, status: 'active', rowVersion: 1 };
      await completeMutation(conn, { actorUserId, operation, mutation, response, resourceType: 'course_level_scheme', resourceId: insert.insertId });
      return response;
    });
  }

  async function updateLevelScheme({ schemeId, ownerUserId, actorUserId, body, idempotencyKey, expectedRowVersion }) {
    await termDomain.assertSchema();
    return withTransaction(async (conn) => {
      await assertRuntime(conn, ownerUserId);
      const [rows] = await conn.query(
        `SELECT * FROM course_level_schemes WHERE id = ? AND owner_user_id = ? LIMIT 1 FOR UPDATE`,
        [positiveInteger(schemeId), ownerUserId]
      );
      const current = rows[0];
      if (!current) throw courseTermError('COURSE_LEVEL_SCHEME_NOT_FOUND', '找不到程度方案', 404);
      ensureRowVersion(current.row_version, expectedRowVersion, '程度方案');
      const operation = 'term.level-scheme.update';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { schemeId: Number(current.id), expectedRowVersion, body },
        resourceType: 'course_level_scheme',
        resourceId: current.id,
      });
      if (mutation.replay) return mutation.replay;
      const status = ['active', 'inactive', 'archived'].includes(text(body?.status, 24).toLowerCase())
        ? text(body.status, 24).toLowerCase()
        : current.status;
      const [update] = await conn.query(
        `UPDATE course_level_schemes
            SET name = ?, description = ?, status = ?, row_version = row_version + 1
          WHERE id = ? AND owner_user_id = ? AND row_version = ?`,
        [
          text(body?.name ?? current.name, 255),
          text(body?.description ?? current.description, 65535) || null,
          status,
          current.id,
          ownerUserId,
          expectedRowVersion,
        ]
      );
      if (!update.affectedRows) throw courseTermError('COURSE_LEVEL_SCHEME_STATE_CONFLICT', '程度方案已被更新', 409);
      const response = { id: Number(current.id), status, rowVersion: expectedRowVersion + 1 };
      await completeMutation(conn, { actorUserId, operation, mutation, response, resourceType: 'course_level_scheme', resourceId: current.id });
      return response;
    });
  }

  async function createLevel({ ownerUserId, actorUserId, body, idempotencyKey }) {
    await termDomain.assertSchema();
    const schemeId = positiveInteger(body?.schemeId ?? body?.scheme_id);
    const name = text(body?.name, 255);
    const code = text(body?.code, 64).toUpperCase() || randomCode('CLV', 5);
    if (!schemeId || !name) throw courseTermError('COURSE_LEVEL_INVALID', '請選擇程度方案並填寫程度名稱', 400);
    return withTransaction(async (conn) => {
      await assertRuntime(conn, ownerUserId);
      const [schemes] = await conn.query(
        `SELECT id FROM course_level_schemes WHERE id = ? AND owner_user_id = ? LIMIT 1 FOR UPDATE`,
        [schemeId, ownerUserId]
      );
      if (!schemes[0]) throw courseTermError('COURSE_LEVEL_SCHEME_NOT_FOUND', '找不到程度方案', 404);
      const operation = 'term.level.create';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { ownerUserId, body },
        resourceType: 'course_level',
      });
      if (mutation.replay) return mutation.replay;
      const [insert] = await conn.query(
        `INSERT INTO course_levels
          (owner_user_id, scheme_id, code, name, description, sort_order, status, row_version)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 1)`,
        [ownerUserId, schemeId, code, name, text(body?.description, 65535) || null, Number.parseInt(body?.sortOrder ?? body?.sort_order, 10) || 0]
      );
      const response = { id: Number(insert.insertId), schemeId, code, name, status: 'active', rowVersion: 1 };
      await completeMutation(conn, { actorUserId, operation, mutation, response, resourceType: 'course_level', resourceId: insert.insertId });
      return response;
    });
  }

  async function updateLevel({ levelId, ownerUserId, actorUserId, body, idempotencyKey, expectedRowVersion }) {
    await termDomain.assertSchema();
    return withTransaction(async (conn) => {
      await assertRuntime(conn, ownerUserId);
      const [rows] = await conn.query(
        `SELECT * FROM course_levels WHERE id = ? AND owner_user_id = ? LIMIT 1 FOR UPDATE`,
        [positiveInteger(levelId), ownerUserId]
      );
      const current = rows[0];
      if (!current) throw courseTermError('COURSE_LEVEL_NOT_FOUND', '找不到程度', 404);
      ensureRowVersion(current.row_version, expectedRowVersion, '程度');
      const operation = 'term.level.update';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { levelId: Number(current.id), expectedRowVersion, body },
        resourceType: 'course_level',
        resourceId: current.id,
      });
      if (mutation.replay) return mutation.replay;
      const status = ['active', 'inactive', 'archived'].includes(text(body?.status, 24).toLowerCase())
        ? text(body.status, 24).toLowerCase()
        : current.status;
      const [update] = await conn.query(
        `UPDATE course_levels
            SET name = ?, description = ?, sort_order = ?, status = ?,
                row_version = row_version + 1
          WHERE id = ? AND owner_user_id = ? AND row_version = ?`,
        [
          text(body?.name ?? current.name, 255),
          text(body?.description ?? current.description, 65535) || null,
          Number.parseInt(body?.sortOrder ?? body?.sort_order ?? current.sort_order, 10) || 0,
          status,
          current.id,
          ownerUserId,
          expectedRowVersion,
        ]
      );
      if (!update.affectedRows) throw courseTermError('COURSE_LEVEL_STATE_CONFLICT', '程度已被更新', 409);
      const response = { id: Number(current.id), status, rowVersion: expectedRowVersion + 1 };
      await completeMutation(conn, { actorUserId, operation, mutation, response, resourceType: 'course_level', resourceId: current.id });
      return response;
    });
  }

  async function createTerm({ ownerUserId, actorUserId, body, idempotencyKey }) {
    await termDomain.assertSchema();
    const programId = positiveInteger(body?.programId ?? body?.program_id);
    const levelId = positiveInteger(body?.levelId ?? body?.level_id, null);
    const name = text(body?.name, 255);
    const code = text(body?.code, 64).toUpperCase() || randomCode('CTM', 5);
    const startsOn = dateOnly(body?.startsOn ?? body?.starts_on);
    const endsOn = dateOnly(body?.endsOn ?? body?.ends_on);
    const timezone = text(body?.timezone || 'Asia/Taipei', 64);
    if (timezone !== 'Asia/Taipei') {
      throw courseTermError('COURSE_TIMEZONE_UNSUPPORTED', '目前固定班僅支援 Asia/Taipei', 400);
    }
    if (!programId || !name || !startsOn || !endsOn || endsOn < startsOn) {
      throw courseTermError('COURSE_TERM_INVALID', '請填寫正確的計畫、班期名稱與日期', 400);
    }
    return withTransaction(async (conn) => {
      await assertRuntime(conn, ownerUserId);
      await assertOwnedTermReferences(conn, { ownerUserId, programId, levelId });
      const operation = 'term.create';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { ownerUserId, body },
        resourceType: 'course_term',
      });
      if (mutation.replay) return mutation.replay;
      const rules = jsonValue(body?.rules ?? body?.rulesSnapshot ?? body?.rules_snapshot_json, {});
      const [insert] = await conn.query(
        `INSERT INTO course_terms
          (owner_user_id, program_id, level_id, code, name, description, status,
           enrollment_open_at, enrollment_close_at, starts_on, ends_on, capacity,
           timezone, leave_quota, leave_cutoff_minutes, makeup_valid_days,
           rules_snapshot_json, row_version)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          ownerUserId,
          programId,
          levelId,
          code,
          name,
          text(body?.description, 65535) || null,
          mysqlDateTime(body?.enrollmentOpenAt ?? body?.enrollment_open_at),
          mysqlDateTime(body?.enrollmentCloseAt ?? body?.enrollment_close_at),
          startsOn,
          endsOn,
          numberOrNull(body?.capacity, { integer: true, minimum: 1 }),
          timezone,
          numberOrNull(body?.leaveQuota ?? body?.leave_quota, { integer: true }) || 0,
          numberOrNull(body?.leaveCutoffMinutes ?? body?.leave_cutoff_minutes, { integer: true }) || 0,
          numberOrNull(body?.makeupValidDays ?? body?.makeup_valid_days, { integer: true, minimum: 1 }) || 30,
          JSON.stringify(rules),
        ]
      );
      const response = { id: Number(insert.insertId), code, name, status: 'draft', rowVersion: 1 };
      await completeMutation(conn, { actorUserId, operation, mutation, response, resourceType: 'course_term', resourceId: insert.insertId });
      return response;
    });
  }

  async function updateTerm({ termId, ownerUserId, actorUserId, body, idempotencyKey, expectedRowVersion }) {
    await termDomain.assertSchema();
    return withTransaction(async (conn) => {
      await assertRuntime(conn, ownerUserId);
      const [rows] = await conn.query(
        `SELECT * FROM course_terms WHERE id = ? AND owner_user_id = ? LIMIT 1 FOR UPDATE`,
        [positiveInteger(termId), ownerUserId]
      );
      const current = rows[0];
      if (!current) throw courseTermError('COURSE_TERM_NOT_FOUND', '找不到固定班期', 404);
      ensureRowVersion(current.row_version, expectedRowVersion, '班期');
      const nextProgramId = positiveInteger(body?.programId ?? body?.program_id ?? current.program_id);
      const clearsLevel = body?.levelId === null || body?.level_id === null;
      const nextLevelId = clearsLevel
        ? null
        : positiveInteger(body?.levelId ?? body?.level_id ?? current.level_id, null);
      if (current.status === 'published' && Number(nextProgramId) !== Number(current.program_id)) {
        throw courseTermError('COURSE_TERM_PROGRAM_LOCKED', '已發布班期不可更換課程計畫', 409);
      }
      await assertOwnedTermReferences(conn, {
        ownerUserId,
        programId: nextProgramId,
        levelId: nextLevelId,
      });
      const operation = 'term.update';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { termId: Number(current.id), expectedRowVersion, body },
        resourceType: 'course_term',
        resourceId: current.id,
      });
      if (mutation.replay) return mutation.replay;
      const nextStarts = dateOnly(body?.startsOn ?? body?.starts_on ?? current.starts_on);
      const nextEnds = dateOnly(body?.endsOn ?? body?.ends_on ?? current.ends_on);
      const nextRules = body?.rules === undefined && body?.rulesSnapshot === undefined && body?.rules_snapshot_json === undefined
        ? jsonValue(current.rules_snapshot_json, {})
        : jsonValue(body?.rules ?? body?.rulesSnapshot ?? body?.rules_snapshot_json, {});
      if (!nextStarts || !nextEnds || nextEnds < nextStarts) throw courseTermError('COURSE_TERM_DATES_INVALID', '班期日期不正確', 400);
      const nextTimezone = text(body?.timezone ?? current.timezone, 64);
      if (nextTimezone !== 'Asia/Taipei') {
        throw courseTermError('COURSE_TIMEZONE_UNSUPPORTED', '目前固定班僅支援 Asia/Taipei', 400);
      }
      const [update] = await conn.query(
        `UPDATE course_terms
            SET program_id = ?, name = ?, description = ?, level_id = ?, enrollment_open_at = ?,
                enrollment_close_at = ?, starts_on = ?, ends_on = ?, capacity = ?,
                timezone = ?, leave_quota = ?, leave_cutoff_minutes = ?,
                makeup_valid_days = ?, rules_snapshot_json = ?,
                row_version = row_version + 1
          WHERE id = ? AND owner_user_id = ? AND row_version = ?`,
        [
          nextProgramId,
          text(body?.name ?? current.name, 255),
          text(body?.description ?? current.description, 65535) || null,
          nextLevelId,
          mysqlDateTime(body?.enrollmentOpenAt ?? body?.enrollment_open_at ?? current.enrollment_open_at),
          mysqlDateTime(body?.enrollmentCloseAt ?? body?.enrollment_close_at ?? current.enrollment_close_at),
          nextStarts,
          nextEnds,
          Object.prototype.hasOwnProperty.call(body || {}, 'capacity')
            ? numberOrNull(body.capacity, { integer: true, minimum: 1 })
            : current.capacity,
          nextTimezone,
          numberOrNull(body?.leaveQuota ?? body?.leave_quota ?? current.leave_quota, { integer: true }) || 0,
          numberOrNull(body?.leaveCutoffMinutes ?? body?.leave_cutoff_minutes ?? current.leave_cutoff_minutes, { integer: true }) || 0,
          numberOrNull(body?.makeupValidDays ?? body?.makeup_valid_days ?? current.makeup_valid_days, { integer: true, minimum: 1 }) || 30,
          JSON.stringify(nextRules),
          current.id,
          ownerUserId,
          expectedRowVersion,
        ]
      );
      if (!update.affectedRows) throw courseTermError('COURSE_TERM_STATE_CONFLICT', '班期已被更新', 409);
      const response = { id: Number(current.id), status: current.status, rowVersion: expectedRowVersion + 1 };
      await completeMutation(conn, { actorUserId, operation, mutation, response, resourceType: 'course_term', resourceId: current.id });
      return response;
    });
  }

  async function createTermSession({ termId, ownerUserId, actorUserId, body, idempotencyKey, expectedTermRowVersion }) {
    await termDomain.assertSchema();
    const startsAt = mysqlDateTime(body?.startsAt ?? body?.starts_at);
    const endsAt = mysqlDateTime(body?.endsAt ?? body?.ends_at);
    if (!startsAt || !endsAt || dateMs(endsAt) <= dateMs(startsAt)) {
      throw courseTermError('COURSE_TERM_SESSION_INVALID', '請填寫正確的場次時間', 400);
    }
    return withTransaction(async (conn) => {
      await assertRuntime(conn, ownerUserId);
      const [terms] = await conn.query(
        `SELECT * FROM course_terms WHERE id = ? AND owner_user_id = ? LIMIT 1 FOR UPDATE`,
        [positiveInteger(termId), ownerUserId]
      );
      const term = terms[0];
      if (!term) throw courseTermError('COURSE_TERM_NOT_FOUND', '找不到固定班期', 404);
      ensureRowVersion(term.row_version, expectedTermRowVersion, '班期');
      await assertOwnedTermReferences(conn, {
        ownerUserId,
        programId: term.program_id,
        levelId: term.level_id,
      });
      if (term.status !== 'draft') throw courseTermError('COURSE_TERM_SESSION_LOCKED', '場次結構只能在班期發布前變更', 409);
      const operation = 'term.session.create';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { termId: Number(term.id), expectedTermRowVersion, body },
        resourceType: 'course_session',
      });
      if (mutation.replay) return mutation.replay;
      const [sequenceRows] = await conn.query(
        `SELECT COALESCE(MAX(term_session_sequence), 0) + 1 AS sequence
           FROM course_sessions WHERE term_id = ? FOR UPDATE`,
        [term.id]
      );
      const code = text(body?.code, 40).toUpperCase() || randomCode('CTS', 5);
      const [insert] = await conn.query(
        `INSERT INTO course_sessions
          (owner_user_id, code, product_id, program_id, term_id, session_kind,
           term_session_sequence, entitlement_required, title, coach_user_id,
           coach_name, location, venue_name, city, starts_at, ends_at,
           capacity, notes, status, row_version)
         VALUES (?, ?, NULL, ?, ?, 'TERM', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          ownerUserId,
          code,
          term.program_id,
          term.id,
          positiveInteger(body?.sequence ?? body?.termSessionSequence ?? body?.term_session_sequence, Number(sequenceRows[0]?.sequence || 1)),
          text(body?.title || term.name, 255),
          text(body?.coachUserId ?? body?.coach_user_id, 36) || null,
          text(body?.coachName ?? body?.coach_name, 255) || null,
          text(body?.location, 255) || null,
          text(body?.venueName ?? body?.venue_name, 255) || null,
          text(body?.city, 120) || null,
          startsAt,
          endsAt,
          numberOrNull(body?.capacity, { integer: true, minimum: 1 }),
          text(body?.notes, 5000) || null,
          ['draft', 'open'].includes(text(body?.status, 24).toLowerCase()) ? text(body.status, 24).toLowerCase() : 'draft',
        ]
      );
      await conn.query(
        `UPDATE course_terms SET row_version = row_version + 1
          WHERE id = ? AND row_version = ?`,
        [term.id, expectedTermRowVersion]
      );
      const response = { id: Number(insert.insertId), code, termId: Number(term.id), rowVersion: 1, termRowVersion: expectedTermRowVersion + 1 };
      await completeMutation(conn, { actorUserId, operation, mutation, response, resourceType: 'course_session', resourceId: insert.insertId });
      return response;
    });
  }

  async function upsertPricingRule({ termId, pricingRuleId = null, ownerUserId, actorUserId, body, idempotencyKey, expectedRowVersion }) {
    await termDomain.assertSchema();
    const pricingMode = text(body?.pricingMode ?? body?.pricing_mode, 32).toUpperCase();
    if (!PRICING_MODES.has(pricingMode)) throw courseTermError('COURSE_TERM_PRICING_MODE_INVALID', '不支援此定價模式', 400);
    const unitPrice = numberOrNull(body?.unitPrice ?? body?.unit_price);
    const fullPrice = numberOrNull(body?.fullPrice ?? body?.full_price);
    if (unitPrice === null && fullPrice === null) throw courseTermError('COURSE_TERM_PRICING_AMOUNT_REQUIRED', '請填寫單價或全期價', 400);
    return withTransaction(async (conn) => {
      await assertRuntime(conn, ownerUserId);
      const [terms] = await conn.query(
        `SELECT * FROM course_terms WHERE id = ? AND owner_user_id = ? LIMIT 1 FOR UPDATE`,
        [positiveInteger(termId), ownerUserId]
      );
      const term = terms[0];
      if (!term) throw courseTermError('COURSE_TERM_NOT_FOUND', '找不到固定班期', 404);
      const operation = pricingRuleId ? 'term.pricing.update' : 'term.pricing.create';
      let current = null;
      if (pricingRuleId) {
        const [pricingRows] = await conn.query(
          `SELECT * FROM course_term_pricing_rules
            WHERE id = ? AND term_id = ? AND owner_user_id = ? LIMIT 1 FOR UPDATE`,
          [positiveInteger(pricingRuleId), term.id, ownerUserId]
        );
        current = pricingRows[0];
        if (!current) throw courseTermError('COURSE_TERM_PRICING_NOT_FOUND', '找不到定價規則', 404);
        ensureRowVersion(current.row_version, expectedRowVersion, '定價規則');
      }
      const fromField = bodyField(body, 'validFromSessionId', 'valid_from_session_id');
      const throughField = bodyField(body, 'validThroughSessionId', 'valid_through_session_id');
      const validFromSessionId = fromField.present
        ? optionalPositiveId(fromField.value, '定價起始場次')
        : optionalPositiveId(current?.valid_from_session_id, '定價起始場次');
      const validThroughSessionId = throughField.present
        ? optionalPositiveId(throughField.value, '定價結束場次')
        : optionalPositiveId(current?.valid_through_session_id, '定價結束場次');
      await assertPricingSessionBounds(conn, {
        ownerUserId,
        termId: term.id,
        validFromSessionId,
        validThroughSessionId,
      });
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { termId: Number(term.id), pricingRuleId: current?.id || null, expectedRowVersion, body },
        resourceType: 'course_term_pricing_rule',
        resourceId: current?.id || null,
      });
      if (mutation.replay) return mutation.replay;
      let ruleId;
      let rowVersion;
      if (current) {
        const [update] = await conn.query(
          `UPDATE course_term_pricing_rules
              SET pricing_mode = ?, unit_price = ?, full_price = ?, currency = ?,
                  valid_from_session_id = ?, valid_through_session_id = ?,
                  configuration_json = ?, priority = ?, status = ?,
                  row_version = row_version + 1
            WHERE id = ? AND owner_user_id = ? AND row_version = ?`,
          [
            pricingMode,
            unitPrice,
            fullPrice,
            text(body?.currency || current.currency || 'TWD', 3).toUpperCase(),
            validFromSessionId,
            validThroughSessionId,
            JSON.stringify(jsonValue(body?.configuration ?? body?.configuration_json, {})),
            positiveInteger(body?.priority, Number(current.priority || 100)),
            ['active', 'inactive', 'archived'].includes(text(body?.status, 24).toLowerCase()) ? text(body.status, 24).toLowerCase() : current.status,
            current.id,
            ownerUserId,
            expectedRowVersion,
          ]
        );
        if (!update.affectedRows) throw courseTermError('COURSE_TERM_PRICING_STATE_CONFLICT', '定價規則已被更新', 409);
        ruleId = Number(current.id);
        rowVersion = expectedRowVersion + 1;
      } else {
        const [insert] = await conn.query(
          `INSERT INTO course_term_pricing_rules
            (owner_user_id, term_id, pricing_mode, unit_price, full_price,
             currency, valid_from_session_id, valid_through_session_id,
             configuration_json, priority, status, row_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            ownerUserId,
            term.id,
            pricingMode,
            unitPrice,
            fullPrice,
            text(body?.currency || 'TWD', 3).toUpperCase(),
            validFromSessionId,
            validThroughSessionId,
            JSON.stringify(jsonValue(body?.configuration ?? body?.configuration_json, {})),
            positiveInteger(body?.priority, 100),
            ['active', 'inactive', 'archived'].includes(text(body?.status, 24).toLowerCase()) ? text(body.status, 24).toLowerCase() : 'active',
          ]
        );
        ruleId = Number(insert.insertId);
        rowVersion = 1;
      }
      const response = { id: ruleId, termId: Number(term.id), pricingMode, rowVersion };
      await completeMutation(conn, { actorUserId, operation, mutation, response, resourceType: 'course_term_pricing_rule', resourceId: ruleId });
      return response;
    });
  }

  async function termReadiness({ termId, ownerUserId, forUpdate = false, queryable = pool }) {
    await termDomain.assertSchema();
    const suffix = forUpdate ? ' FOR UPDATE' : '';
    const [rows] = await queryable.query(
      `SELECT t.*, p.status AS program_status,
              (SELECT COUNT(*) FROM course_sessions s
                WHERE s.term_id = t.id AND s.session_kind = 'TERM'
                  AND s.status NOT IN ('cancelled','canceled')) AS session_count,
              (SELECT COUNT(*) FROM course_term_pricing_rules pr
                WHERE pr.term_id = t.id AND pr.status = 'active') AS pricing_count
         FROM course_terms t
         JOIN course_programs p
           ON p.id = t.program_id AND p.owner_user_id = t.owner_user_id
        WHERE t.id = ? AND t.owner_user_id = ? LIMIT 1${suffix}`,
      [positiveInteger(termId), ownerUserId]
    );
    const term = rows[0];
    if (!term) throw courseTermError('COURSE_TERM_NOT_FOUND', '找不到固定班期', 404);
    const issues = [];
    if (!term.name || !term.starts_on || !term.ends_on) issues.push({ code: 'TERM_DETAILS_MISSING', message: '班期名稱與日期未完整' });
    if (Number(term.session_count || 0) < 1) issues.push({ code: 'TERM_SESSIONS_MISSING', message: '尚未建立固定班場次' });
    if (Number(term.pricing_count || 0) < 1) issues.push({ code: 'TERM_PRICING_MISSING', message: '尚未建立有效定價' });
    if (term.enrollment_close_at && term.enrollment_open_at && dateMs(term.enrollment_close_at) < dateMs(term.enrollment_open_at)) {
      issues.push({ code: 'TERM_ENROLLMENT_WINDOW_INVALID', message: '報名結束時間早於開放時間' });
    }
    return {
      termId: Number(term.id),
      status: term.status,
      ready: issues.length === 0,
      issues,
      rowVersion: Number(term.row_version || 1),
    };
  }

  async function publishTerm({ termId, ownerUserId, actorUserId, idempotencyKey, expectedRowVersion }) {
    await termDomain.assertSchema();
    return withTransaction(async (conn) => {
      await assertRuntime(conn, ownerUserId);
      const readiness = await termReadiness({ termId, ownerUserId, forUpdate: true, queryable: conn });
      ensureRowVersion(readiness.rowVersion, expectedRowVersion, '班期');
      if (!readiness.ready) throw courseTermError('COURSE_TERM_NOT_READY', '班期依賴未完整，無法發布', 409, readiness);
      const operation = 'term.publish';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { termId: Number(termId), expectedRowVersion },
        resourceType: 'course_term',
        resourceId: termId,
      });
      if (mutation.replay) return mutation.replay;
      const [update] = await conn.query(
        `UPDATE course_terms SET status = 'published', row_version = row_version + 1
          WHERE id = ? AND owner_user_id = ? AND row_version = ? AND status IN ('draft','published')`,
        [positiveInteger(termId), ownerUserId, expectedRowVersion]
      );
      if (!update.affectedRows) throw courseTermError('COURSE_TERM_STATE_CONFLICT', '班期狀態已變更', 409);
      await conn.query(
        `UPDATE course_programs SET status = 'published', row_version = row_version + 1
          WHERE id = (SELECT program_id FROM course_terms WHERE id = ?) AND status = 'draft'`,
        [positiveInteger(termId)]
      );
      await conn.query(
        `UPDATE course_sessions SET status = 'open', row_version = row_version + 1
          WHERE term_id = ? AND session_kind = 'TERM' AND status = 'draft'`,
        [positiveInteger(termId)]
      );
      const response = { ...readiness, status: 'published', rowVersion: expectedRowVersion + 1 };
      await completeMutation(conn, { actorUserId, operation, mutation, response, resourceType: 'course_term', resourceId: termId });
      await enqueue(conn, {
        ownerUserId,
        eventType: 'TERM_PUBLISHED',
        dedupeKey: `term-published:${termId}:${expectedRowVersion + 1}`,
        payload: { termId: Number(termId) },
      });
      return response;
    });
  }

  async function upsertRenewalRule({ ruleId = null, ownerUserId, actorUserId, body, idempotencyKey, expectedRowVersion }) {
    await termDomain.assertSchema();
    const sourceTermId = positiveInteger(body?.sourceTermId ?? body?.source_term_id);
    const targetTermId = positiveInteger(body?.targetTermId ?? body?.target_term_id);
    const opensAt = mysqlDateTime(body?.renewalOpenAt ?? body?.renewal_open_at);
    const closesAt = mysqlDateTime(body?.renewalCloseAt ?? body?.renewal_close_at);
    if (!sourceTermId || !targetTermId || sourceTermId === targetTermId || !opensAt || !closesAt || dateMs(closesAt) < dateMs(opensAt)) {
      throw courseTermError('COURSE_RENEWAL_RULE_INVALID', '續報來源、目標或期間不正確', 400);
    }
    return withTransaction(async (conn) => {
      await assertRuntime(conn, ownerUserId);
      const [terms] = await conn.query(
        `SELECT term.id, term.level_id, term.status,
                level.owner_user_id AS level_owner_user_id
           FROM course_terms term
           LEFT JOIN course_levels level ON level.id = term.level_id
          WHERE term.id IN (?, ?) AND term.owner_user_id = ? FOR UPDATE`,
        [sourceTermId, targetTermId, ownerUserId]
      );
      if (terms.length !== 2) throw courseTermError('COURSE_RENEWAL_TERM_NOT_FOUND', '找不到同租戶的續報班期', 404);
      if (terms.some((term) => term.level_id
        && String(term.level_owner_user_id || '') !== String(ownerUserId))) {
        throw courseTermError('COURSE_RENEWAL_LEVEL_NOT_FOUND', '續報班期的程度必須屬於同一租戶', 404);
      }
      const operation = ruleId ? 'term.renewal.update' : 'term.renewal.create';
      let current = null;
      if (ruleId) {
        const [rows] = await conn.query(
          `SELECT * FROM course_term_renewal_rules
            WHERE id = ? AND owner_user_id = ? LIMIT 1 FOR UPDATE`,
          [positiveInteger(ruleId), ownerUserId]
        );
        current = rows[0];
        if (!current) throw courseTermError('COURSE_RENEWAL_RULE_NOT_FOUND', '找不到續報規則', 404);
        ensureRowVersion(current.row_version, expectedRowVersion, '續報規則');
      }
      const eligibility = {
        requireCompleted: booleanValue(body?.requireCompleted ?? body?.require_completed, true),
        requireTargetLevel: booleanValue(body?.requireTargetLevel ?? body?.require_target_level, true),
        ...(jsonValue(body?.eligibility ?? body?.eligibility_json, {})),
      };
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { ruleId: current?.id || null, expectedRowVersion, body },
        resourceType: 'course_term_renewal_rule',
        resourceId: current?.id || null,
      });
      if (mutation.replay) return mutation.replay;
      let id;
      let rowVersion;
      if (current) {
        const [update] = await conn.query(
          `UPDATE course_term_renewal_rules
              SET source_term_id = ?, target_term_id = ?, renewal_open_at = ?,
                  renewal_close_at = ?, reserved_capacity = ?, eligibility_json = ?,
                  status = ?, row_version = row_version + 1
            WHERE id = ? AND owner_user_id = ? AND row_version = ?`,
          [
            sourceTermId,
            targetTermId,
            opensAt,
            closesAt,
            numberOrNull(body?.reservedCapacity ?? body?.reserved_capacity, { integer: true }) || 0,
            JSON.stringify(eligibility),
            ['active', 'inactive', 'archived'].includes(text(body?.status, 24).toLowerCase()) ? text(body.status, 24).toLowerCase() : current.status,
            current.id,
            ownerUserId,
            expectedRowVersion,
          ]
        );
        if (!update.affectedRows) throw courseTermError('COURSE_RENEWAL_RULE_STATE_CONFLICT', '續報規則已被更新', 409);
        id = Number(current.id);
        rowVersion = expectedRowVersion + 1;
      } else {
        const [insert] = await conn.query(
          `INSERT INTO course_term_renewal_rules
            (owner_user_id, source_term_id, target_term_id, renewal_open_at,
             renewal_close_at, reserved_capacity, eligibility_json, status, row_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1)`,
          [
            ownerUserId,
            sourceTermId,
            targetTermId,
            opensAt,
            closesAt,
            numberOrNull(body?.reservedCapacity ?? body?.reserved_capacity, { integer: true }) || 0,
            JSON.stringify(eligibility),
          ]
        );
        id = Number(insert.insertId);
        rowVersion = 1;
      }
      const response = { id, sourceTermId, targetTermId, eligibility, rowVersion };
      await completeMutation(conn, { actorUserId, operation, mutation, response, resourceType: 'course_term_renewal_rule', resourceId: id });
      return response;
    });
  }

  async function renewalEligibility({ ruleId, userId, forUpdate = false, queryable = pool }) {
    await termDomain.assertSchema();
    const suffix = forUpdate ? ' FOR UPDATE' : '';
    const [rows] = await queryable.query(
      `SELECT r.*, source.name AS source_term_name, target.name AS target_term_name,
              target.status AS target_status, target.level_id AS target_level_id,
              target.row_version AS target_row_version,
              e.id AS source_enrollment_id, e.status AS source_enrollment_status,
              e.student_id
         FROM course_term_renewal_rules r
         JOIN course_terms source
           ON source.id = r.source_term_id AND source.owner_user_id = r.owner_user_id
         JOIN course_terms target
           ON target.id = r.target_term_id AND target.owner_user_id = r.owner_user_id
         LEFT JOIN course_levels source_level
           ON source_level.id = source.level_id
          AND source_level.owner_user_id = r.owner_user_id
         LEFT JOIN course_levels target_level
           ON target_level.id = target.level_id
          AND target_level.owner_user_id = r.owner_user_id
         LEFT JOIN course_term_enrollments e
           ON e.term_id = r.source_term_id AND e.user_id = ?
          AND e.owner_user_id = r.owner_user_id
        WHERE r.id = ? AND r.status = 'active'
          AND (source.level_id IS NULL OR source_level.id IS NOT NULL)
          AND (target.level_id IS NULL OR target_level.id IS NOT NULL)
        ORDER BY e.id DESC LIMIT 1${suffix}`,
      [userId, positiveInteger(ruleId)]
    );
    const rule = rows[0];
    if (!rule) throw courseTermError('COURSE_RENEWAL_RULE_NOT_FOUND', '找不到續報規則', 404);
    await termDomain.assertProviderRuntime(queryable, rule.owner_user_id, { forUpdate: false });
    const criteria = jsonValue(rule.eligibility_json, {});
    const reasons = [];
    if (dateMs(rule.renewal_open_at) > Date.now() || dateMs(rule.renewal_close_at) < Date.now()) reasons.push('RENEWAL_WINDOW_CLOSED');
    if (!rule.source_enrollment_id) reasons.push('SOURCE_ENROLLMENT_REQUIRED');
    const requireCompleted = criteria.requireCompleted !== false;
    if (requireCompleted && String(rule.source_enrollment_status || '').toUpperCase() !== 'COMPLETED') reasons.push('SOURCE_TERM_NOT_COMPLETED');
    if (!requireCompleted && !['CONFIRMED', 'COMPLETED'].includes(String(rule.source_enrollment_status || '').toUpperCase())) reasons.push('SOURCE_ENROLLMENT_INELIGIBLE');
    if (rule.target_status !== 'published') reasons.push('TARGET_TERM_NOT_PUBLISHED');
    if (criteria.requireTargetLevel !== false && rule.target_level_id && rule.student_id) {
      const [levelRows] = await queryable.query(
        `SELECT 1 FROM course_student_level_records
          WHERE owner_user_id = ? AND student_id = ? AND level_id = ?
            AND is_current = 1 AND assessment_status = 'PASSED'
            AND (expires_at IS NULL OR expires_at >= NOW()) LIMIT 1`,
        [rule.owner_user_id, rule.student_id, rule.target_level_id]
      );
      if (!levelRows[0]) reasons.push('TARGET_LEVEL_REQUIRED');
    }
    const [existing] = await queryable.query(
      `SELECT id FROM course_term_enrollments
        WHERE term_id = ? AND user_id = ? AND status NOT IN ('CANCELLED','REJECTED') LIMIT 1${suffix}`,
      [rule.target_term_id, userId]
    );
    if (existing[0]) reasons.push('TARGET_ALREADY_ENROLLED');
    return {
      ruleId: Number(rule.id),
      ownerUserId: rule.owner_user_id,
      sourceTermId: Number(rule.source_term_id),
      sourceTermName: rule.source_term_name,
      targetTermId: Number(rule.target_term_id),
      targetTermName: rule.target_term_name,
      sourceEnrollmentId: rule.source_enrollment_id ? Number(rule.source_enrollment_id) : null,
      eligible: reasons.length === 0,
      reasons,
      opensAt: rule.renewal_open_at,
      closesAt: rule.renewal_close_at,
      targetRowVersion: Number(rule.target_row_version || 1),
    };
  }

  async function createRenewalQuote({ ruleId, userId, idempotencyKey, expectedRuleRowVersion }) {
    await termDomain.assertSchema();
    const eligibility = await withTransaction(async (conn) => {
      const [ruleRows] = await conn.query(
        `SELECT row_version FROM course_term_renewal_rules WHERE id = ? LIMIT 1 FOR UPDATE`,
        [positiveInteger(ruleId)]
      );
      if (!ruleRows[0]) throw courseTermError('COURSE_RENEWAL_RULE_NOT_FOUND', '找不到續報規則', 404);
      ensureRowVersion(ruleRows[0].row_version, expectedRuleRowVersion, '續報規則');
      const resolved = await renewalEligibility({ ruleId, userId, forUpdate: true, queryable: conn });
      if (!resolved.eligible) throw courseTermError('COURSE_RENEWAL_NOT_ELIGIBLE', '不符合此班期續報資格', 409, resolved);
      return resolved;
    });
    // createQuote owns its own transaction. Run it only after the eligibility
    // transaction commits so the target-term row lock cannot self-deadlock.
    const key = assertIdempotencyKey(idempotencyKey);
    const quote = await termDomain.createQuote({
      termId: eligibility.targetTermId,
      userId,
      idempotencyKey: `${key}:quote`.slice(0, 128),
      expectedTermRowVersion: eligibility.targetRowVersion,
    });
    return { ...quote, renewal: eligibility };
  }

  async function offerNextWaitlisted(conn, { termId, ownerUserId, actorUserId = null, offerMinutes = 60 }) {
    await assertRuntime(conn, ownerUserId);
    const [termRows] = await conn.query(
      `SELECT id, capacity, row_version FROM course_terms
        WHERE id = ? AND owner_user_id = ? LIMIT 1 FOR UPDATE`,
      [positiveInteger(termId), ownerUserId]
    );
    const term = termRows[0];
    if (!term) throw courseTermError('COURSE_TERM_NOT_FOUND', '找不到固定班期', 404);
    if (term.capacity === null) return null;
    const [allocationRows] = await conn.query(
      `SELECT id FROM course_seat_allocations
        WHERE term_id = ? AND status IN ('HELD','ACTIVE')
          AND allocation_type <> 'MAKEUP_INSURANCE'
          AND (expires_at IS NULL OR expires_at > NOW()) FOR UPDATE`,
      [term.id]
    );
    if (allocationRows.length >= Number(term.capacity)) return null;
    const [entries] = await conn.query(
      `SELECT * FROM course_term_waitlist_entries
        WHERE term_id = ? AND owner_user_id = ? AND status = 'WAITING'
        ORDER BY priority, joined_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [term.id, ownerUserId]
    );
    const entry = entries[0];
    if (!entry) return null;
    const expiresAt = mysqlDateTime(Date.now() + Math.max(15, Math.min(10080, positiveInteger(offerMinutes, 60))) * 60000);
    const [allocation] = await conn.query(
      `INSERT INTO course_seat_allocations
        (owner_user_id, term_id, student_id, waitlist_entry_id, user_id,
         allocation_type, status, expires_at, row_version)
       VALUES (?, ?, ?, ?, ?, 'WAITLIST_OFFER', 'HELD', ?, 1)`,
      [ownerUserId, term.id, entry.student_id, entry.id, entry.user_id, expiresAt]
    );
    const offerCode = randomCode('WLO', 6);
    const [offer] = await conn.query(
      `INSERT INTO course_term_seat_offers
        (offer_code, owner_user_id, waitlist_entry_id, term_id, student_id,
         user_id, seat_allocation_id, status, expires_at, row_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'OFFERED', ?, 1)`,
      [offerCode, ownerUserId, entry.id, term.id, entry.student_id, entry.user_id, allocation.insertId, expiresAt]
    );
    const [update] = await conn.query(
      `UPDATE course_term_waitlist_entries
          SET status = 'OFFERED', row_version = row_version + 1
        WHERE id = ? AND status = 'WAITING' AND row_version = ?`,
      [entry.id, entry.row_version]
    );
    if (!update.affectedRows) throw courseTermError('COURSE_WAITLIST_STATE_CONFLICT', '候補順位已變更', 409);
    await enqueue(conn, {
      ownerUserId,
      userId: entry.user_id,
      eventType: 'TERM_WAITLIST_OFFERED',
      dedupeKey: `term-waitlist-offered:${offer.insertId}`,
      payload: {
        offerId: Number(offer.insertId),
        offerCode,
        termId: Number(term.id),
        expiresAt,
        actorUserId,
      },
    });
    return {
      offerId: Number(offer.insertId),
      offerCode,
      termId: Number(term.id),
      waitlistEntryId: Number(entry.id),
      userId: entry.user_id,
      status: 'OFFERED',
      expiresAt,
      rowVersion: 1,
    };
  }

  async function createSeatOffer({ termId, ownerUserId, actorUserId, idempotencyKey, expectedTermRowVersion, offerMinutes }) {
    await termDomain.assertSchema();
    return withTransaction(async (conn) => {
      await assertRuntime(conn, ownerUserId);
      const [terms] = await conn.query(
        `SELECT row_version FROM course_terms WHERE id = ? AND owner_user_id = ? LIMIT 1 FOR UPDATE`,
        [positiveInteger(termId), ownerUserId]
      );
      if (!terms[0]) throw courseTermError('COURSE_TERM_NOT_FOUND', '找不到固定班期', 404);
      ensureRowVersion(terms[0].row_version, expectedTermRowVersion, '班期');
      const operation = 'term.waitlist.offer';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { termId: Number(termId), expectedTermRowVersion, offerMinutes },
        resourceType: 'course_term_seat_offer',
      });
      if (mutation.replay) return mutation.replay;
      const response = await offerNextWaitlisted(conn, { termId, ownerUserId, actorUserId, offerMinutes });
      if (!response) throw courseTermError('COURSE_WAITLIST_NO_OFFER_AVAILABLE', '目前無可釋出名額或等待中候補', 409);
      await completeMutation(conn, { actorUserId, operation, mutation, response, resourceType: 'course_term_seat_offer', resourceId: response.offerId });
      return response;
    });
  }

  async function transitionSeatOffer({ offerId, userId, action, idempotencyKey, expectedRowVersion }) {
    await termDomain.assertSchema();
    const normalizedAction = text(action, 16).toLowerCase();
    if (!['accept', 'decline'].includes(normalizedAction)) throw courseTermError('COURSE_WAITLIST_ACTION_INVALID', '候補操作不正確', 400);
    return withTransaction(async (conn) => {
      const [rows] = await conn.query(
        `SELECT o.*, a.status AS allocation_status, a.row_version AS allocation_row_version
           FROM course_term_seat_offers o
           JOIN course_seat_allocations a ON a.id = o.seat_allocation_id
          WHERE o.id = ? AND o.user_id = ? LIMIT 1 FOR UPDATE`,
        [positiveInteger(offerId), userId]
      );
      const offer = rows[0];
      if (!offer) throw courseTermError('COURSE_WAITLIST_OFFER_NOT_FOUND', '找不到候補名額', 404);
      ensureRowVersion(offer.row_version, expectedRowVersion, '候補名額');
      await assertRuntime(conn, offer.owner_user_id);
      const operation = `term.waitlist.${normalizedAction}`;
      const mutation = await claimMutation(conn, {
        actorUserId: userId,
        operation,
        idempotencyKey,
        payload: { offerId: Number(offer.id), expectedRowVersion },
        resourceType: 'course_term_seat_offer',
        resourceId: offer.id,
      });
      if (mutation.replay) return mutation.replay;
      if (offer.status !== 'OFFERED' || offer.allocation_status !== 'HELD') {
        throw courseTermError('COURSE_WAITLIST_OFFER_STATE_CONFLICT', '候補名額已不可操作', 409);
      }
      if (dateMs(offer.expires_at) <= Date.now()) {
        throw courseTermError('COURSE_WAITLIST_OFFER_EXPIRED', '候補名額已過期', 409);
      }
      const accepted = normalizedAction === 'accept';
      const nextOfferStatus = accepted ? 'ACCEPTED' : 'CANCELLED';
      const nextEntryStatus = accepted ? 'ACCEPTED' : 'CANCELLED';
      const [offerUpdate] = await conn.query(
        `UPDATE course_term_seat_offers
            SET status = ?, accepted_at = CASE WHEN ? THEN NOW() ELSE accepted_at END,
                row_version = row_version + 1
          WHERE id = ? AND status = 'OFFERED' AND row_version = ?`,
        [nextOfferStatus, accepted ? 1 : 0, offer.id, expectedRowVersion]
      );
      if (!offerUpdate.affectedRows) throw courseTermError('COURSE_WAITLIST_OFFER_STATE_CONFLICT', '候補名額已被處理', 409);
      await conn.query(
        `UPDATE course_term_waitlist_entries
            SET status = ?, row_version = row_version + 1
          WHERE id = ? AND status = 'OFFERED'`,
        [nextEntryStatus, offer.waitlist_entry_id]
      );
      if (accepted) {
        const checkoutExpiresAt = mysqlDateTime(
          Math.max(Date.now() + 15 * 60000, dateMs(offer.expires_at))
        );
        await conn.query(
          `UPDATE course_term_seat_offers
              SET expires_at = ?, row_version = row_version + 1
            WHERE id = ? AND status = 'ACCEPTED'`,
          [checkoutExpiresAt, offer.id]
        );
        await conn.query(
          `UPDATE course_seat_allocations
              SET expires_at = ?,
                  row_version = row_version + 1
            WHERE id = ? AND status = 'HELD'`,
          [checkoutExpiresAt, offer.seat_allocation_id]
        );
      } else {
        await conn.query(
          `UPDATE course_seat_allocations
              SET status = 'RELEASED', released_at = NOW(), release_reason = 'waitlist_declined',
                  row_version = row_version + 1
            WHERE id = ? AND status = 'HELD'`,
          [offer.seat_allocation_id]
        );
      }
      let nextOffer = null;
      if (!accepted) {
        nextOffer = await offerNextWaitlisted(conn, {
          termId: offer.term_id,
          ownerUserId: offer.owner_user_id,
          actorUserId: userId,
        });
      }
      await enqueue(conn, {
        ownerUserId: offer.owner_user_id,
        userId,
        eventType: accepted ? 'TERM_WAITLIST_ACCEPTED' : 'TERM_WAITLIST_DECLINED',
        dedupeKey: `term-waitlist-${normalizedAction}:${offer.id}`,
        payload: { offerId: Number(offer.id), termId: Number(offer.term_id) },
      });
      const response = {
        offerId: Number(offer.id),
        termId: Number(offer.term_id),
        status: nextOfferStatus,
        checkoutByAt: accepted
          ? mysqlDateTime(Math.max(Date.now() + 15 * 60000, dateMs(offer.expires_at)))
          : null,
        nextOfferId: nextOffer?.offerId || null,
        rowVersion: expectedRowVersion + 1,
      };
      await completeMutation(conn, { actorUserId: userId, operation, mutation, response, resourceType: 'course_term_seat_offer', resourceId: offer.id });
      return response;
    });
  }

  async function listMemberSeatOffers({ userId }) {
    await termDomain.assertSchema();
    const [rows] = await pool.query(
      `SELECT o.*, t.name AS term_name, t.row_version AS term_row_version,
              a.status AS allocation_status
         FROM course_term_seat_offers o
         JOIN course_terms t ON t.id = o.term_id
         JOIN course_seat_allocations a ON a.id = o.seat_allocation_id
        WHERE o.user_id = ? ORDER BY o.created_at DESC, o.id DESC`,
      [userId]
    );
    return rows.map((row) => ({
      id: Number(row.id),
      offerCode: row.offer_code,
      termId: Number(row.term_id),
      termName: row.term_name,
      status: row.status,
      allocationStatus: row.allocation_status,
      expiresAt: row.expires_at,
      termRowVersion: Number(row.term_row_version || 1),
      rowVersion: Number(row.row_version || 1),
    }));
  }

  async function expireDueSeatOffers({ limit = 50, requireEnabled = true } = {}) {
    await termDomain.assertSchema({ requireEnabled });
    return withTransaction(async (conn) => {
      const [rows] = await conn.query(
        `SELECT o.* FROM course_term_seat_offers o
          JOIN course_seat_allocations a ON a.id = o.seat_allocation_id
          WHERE o.status IN ('OFFERED','ACCEPTED') AND o.expires_at <= NOW()
            AND a.status = 'HELD' AND a.allocation_type = 'WAITLIST_OFFER'
            AND a.order_id IS NULL
          ORDER BY o.expires_at, o.id LIMIT ? FOR UPDATE SKIP LOCKED`,
        [Math.max(1, Math.min(200, positiveInteger(limit, 50)))]
      );
      const results = [];
      for (const offer of rows) {
        await conn.query(
          `UPDATE course_term_seat_offers SET status = 'EXPIRED', row_version = row_version + 1
            WHERE id = ? AND status IN ('OFFERED','ACCEPTED')`,
          [offer.id]
        );
        await conn.query(
          `UPDATE course_term_waitlist_entries SET status = 'EXPIRED', row_version = row_version + 1
            WHERE id = ? AND status IN ('OFFERED','ACCEPTED')`,
          [offer.waitlist_entry_id]
        );
        await conn.query(
          `UPDATE course_seat_allocations
              SET status = 'EXPIRED', released_at = NOW(), release_reason = 'waitlist_offer_expired',
                  row_version = row_version + 1
            WHERE id = ? AND status = 'HELD'`,
          [offer.seat_allocation_id]
        );
        await enqueue(conn, {
          ownerUserId: offer.owner_user_id,
          userId: offer.user_id,
          eventType: 'TERM_WAITLIST_OFFER_EXPIRED',
          dedupeKey: `term-waitlist-expired:${offer.id}`,
          payload: { offerId: Number(offer.id), termId: Number(offer.term_id) },
        });
        results.push({ offerId: Number(offer.id), termId: Number(offer.term_id), ownerUserId: offer.owner_user_id });
      }
      return results;
    });
  }

  async function fillAvailableWaitlistOffers({ limit = 50, offerMinutes = 60 } = {}) {
    await termDomain.assertSchema();
    return withTransaction(async (conn) => {
      const [terms] = await conn.query(
        `SELECT DISTINCT t.id, t.owner_user_id
           FROM course_terms t
           JOIN course_term_waitlist_entries w ON w.term_id = t.id AND w.status = 'WAITING'
           JOIN course_settings provider_settings
             ON provider_settings.scope_key = CONCAT('provider:', t.owner_user_id)
            AND provider_settings.fixed_term_enabled = 1
           JOIN course_settings platform_settings
             ON platform_settings.scope_key = 'platform'
            AND platform_settings.fixed_term_enabled = 1
          WHERE t.status = 'published' AND t.capacity IS NOT NULL
          ORDER BY t.id LIMIT ? FOR UPDATE`,
        [Math.max(1, Math.min(200, positiveInteger(limit, 50)))]
      );
      const offers = [];
      for (const term of terms) {
        const offer = await offerNextWaitlisted(conn, {
          termId: term.id,
          ownerUserId: term.owner_user_id,
          offerMinutes,
        });
        if (offer) offers.push(offer);
      }
      return offers;
    });
  }

  async function upsertStudentLevel({
    studentId,
    ownerUserId,
    actorUserId,
    body,
    idempotencyKey,
    expectedStudentRowVersion,
  }) {
    await termDomain.assertSchema();
    const schemeId = positiveInteger(body?.schemeId ?? body?.scheme_id);
    const levelId = positiveInteger(body?.levelId ?? body?.level_id, null);
    const assessmentStatus = text(
      body?.assessmentStatus ?? body?.assessment_status ?? 'NOT_STARTED',
      24
    ).toUpperCase();
    if (!schemeId || !['NOT_STARTED', 'PENDING', 'PASSED', 'FAILED', 'EXPIRED'].includes(assessmentStatus)) {
      throw courseTermError('COURSE_STUDENT_LEVEL_INVALID', '請指定正確的程度方案與評估狀態', 400);
    }
    if (assessmentStatus === 'PASSED' && !levelId) {
      throw courseTermError('COURSE_STUDENT_LEVEL_REQUIRED', '通過評估必須指定程度', 400);
    }
    return withTransaction(async (conn) => {
      await assertRuntime(conn, ownerUserId);
      const [studentRows] = await conn.query(
        `SELECT * FROM course_students
          WHERE id = ? AND owner_user_id = ? LIMIT 1 FOR UPDATE`,
        [positiveInteger(studentId), ownerUserId]
      );
      const student = studentRows[0];
      if (!student) throw courseTermError('COURSE_STUDENT_NOT_FOUND', '找不到此課程租戶的學員', 404);
      const [schemeRows] = await conn.query(
        `SELECT id FROM course_level_schemes
          WHERE id = ? AND owner_user_id = ? AND status = 'active' LIMIT 1 FOR UPDATE`,
        [schemeId, ownerUserId]
      );
      if (!schemeRows[0]) throw courseTermError('COURSE_LEVEL_SCHEME_NOT_FOUND', '找不到程度方案', 404);
      if (levelId) {
        const [levelRows] = await conn.query(
          `SELECT id FROM course_levels
            WHERE id = ? AND scheme_id = ? AND owner_user_id = ? AND status = 'active'
            LIMIT 1 FOR UPDATE`,
          [levelId, schemeId, ownerUserId]
        );
        if (!levelRows[0]) throw courseTermError('COURSE_LEVEL_NOT_FOUND', '程度不屬於指定方案', 404);
      }
      const operation = 'term.student-level.upsert';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { studentId: Number(student.id), schemeId, levelId, assessmentStatus, expectedStudentRowVersion, body },
        resourceType: 'course_student_level_record',
      });
      if (mutation.replay) return mutation.replay;
      ensureRowVersion(student.row_version, expectedStudentRowVersion, '學員');
      await conn.query(
        `UPDATE course_student_level_records
            SET is_current = 0, row_version = row_version + 1
          WHERE owner_user_id = ? AND student_id = ? AND scheme_id = ? AND is_current = 1`,
        [ownerUserId, student.id, schemeId]
      );
      const assessedAt = assessmentStatus === 'NOT_STARTED'
        ? null
        : (mysqlDateTime(body?.assessedAt ?? body?.assessed_at) || mysqlDateTime(Date.now()));
      const [insert] = await conn.query(
        `INSERT INTO course_student_level_records
          (owner_user_id, student_id, scheme_id, level_id, assessment_status,
           is_current, assessed_by_user_id, assessed_at, expires_at,
           evidence_json, note, row_version)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 1)`,
        [ownerUserId, student.id, schemeId, levelId, assessmentStatus,
          actorUserId, assessedAt,
          mysqlDateTime(body?.expiresAt ?? body?.expires_at),
          JSON.stringify(jsonValue(body?.evidence ?? body?.evidence_json, {})),
          text(body?.note, 500) || null]
      );
      const [studentUpdate] = await conn.query(
        `UPDATE course_students SET row_version = row_version + 1
          WHERE id = ? AND owner_user_id = ? AND row_version = ?`,
        [student.id, ownerUserId, expectedStudentRowVersion]
      );
      if (!studentUpdate.affectedRows) throw courseTermError('COURSE_ROW_VERSION_CONFLICT', '學員資料已更新', 412);
      const response = {
        id: Number(insert.insertId),
        studentId: Number(student.id),
        schemeId,
        levelId,
        assessmentStatus,
        rowVersion: 1,
        studentRowVersion: Number(expectedStudentRowVersion) + 1,
      };
      await completeMutation(conn, {
        actorUserId,
        operation,
        mutation,
        response,
        resourceType: 'course_student_level_record',
        resourceId: insert.insertId,
      });
      return response;
    });
  }

  async function completeEnrollment({
    enrollmentId,
    ownerUserId,
    actorUserId,
    reason,
    idempotencyKey,
    expectedRowVersion,
  }) {
    await termDomain.assertSchema();
    return withTransaction(async (conn) => {
      await assertRuntime(conn, ownerUserId);
      const [rows] = await conn.query(
        `SELECT e.*,
                (SELECT COUNT(*) FROM course_term_session_entitlements se
                  WHERE se.enrollment_id = e.id
                    AND se.status IN ('SCHEDULED','LEAVE_PENDING')) AS unresolved_count,
                (SELECT COUNT(*) FROM course_sessions s
                  WHERE s.term_id = e.term_id AND s.status <> 'cancelled'
                    AND s.ends_at > NOW()) AS future_session_count
           FROM course_term_enrollments e
          WHERE e.id = ? AND e.owner_user_id = ? LIMIT 1 FOR UPDATE`,
        [positiveInteger(enrollmentId), ownerUserId]
      );
      const enrollment = rows[0];
      if (!enrollment) throw courseTermError('COURSE_TERM_ENROLLMENT_NOT_FOUND', '找不到固定班報名', 404);
      const operation = 'term.enrollment.complete';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { enrollmentId: Number(enrollment.id), expectedRowVersion, reason: text(reason, 500) || null },
        resourceType: 'course_term_enrollment',
        resourceId: enrollment.id,
      });
      if (mutation.replay) return mutation.replay;
      ensureRowVersion(enrollment.row_version, expectedRowVersion, '固定班報名');
      if (enrollment.status === 'COMPLETED') {
        const response = {
          enrollmentId: Number(enrollment.id),
          status: 'COMPLETED',
          rowVersion: Number(enrollment.row_version),
          replay: true,
        };
        await completeMutation(conn, {
          actorUserId,
          operation,
          mutation,
          response,
          resourceType: 'course_term_enrollment',
          resourceId: enrollment.id,
        });
        return response;
      }
      if (enrollment.status !== 'CONFIRMED') {
        throw courseTermError('COURSE_TERM_COMPLETION_STATE_CONFLICT', '只有已確認報名可標記結業', 409);
      }
      if (Number(enrollment.unresolved_count || 0) > 0 || Number(enrollment.future_session_count || 0) > 0) {
        throw courseTermError('COURSE_TERM_COMPLETION_NOT_READY', '班期尚有未判定或未結束堂次', 409, {
          unresolvedCount: Number(enrollment.unresolved_count || 0),
          futureSessionCount: Number(enrollment.future_session_count || 0),
        });
      }
      const [update] = await conn.query(
        `UPDATE course_term_enrollments
            SET status = 'COMPLETED', completed_at = NOW(), row_version = row_version + 1
          WHERE id = ? AND owner_user_id = ? AND status = 'CONFIRMED' AND row_version = ?`,
        [enrollment.id, ownerUserId, expectedRowVersion]
      );
      if (!update.affectedRows) throw courseTermError('COURSE_TERM_ENROLLMENT_STATE_CONFLICT', '固定班報名已更新', 409);
      await conn.query(
        `UPDATE course_seat_allocations SET status = 'CONFIRMED',
                row_version = row_version + 1
          WHERE enrollment_id = ? AND status = 'ACTIVE'`,
        [enrollment.id]
      );
      await enqueue(conn, {
        ownerUserId,
        userId: enrollment.user_id,
        eventType: 'TERM_ENROLLMENT_COMPLETED',
        dedupeKey: `term-enrollment-completed:${enrollment.id}`,
        payload: { enrollmentId: Number(enrollment.id), termId: Number(enrollment.term_id), reason: text(reason, 500) || null },
      });
      const response = {
        enrollmentId: Number(enrollment.id),
        status: 'COMPLETED',
        rowVersion: Number(expectedRowVersion) + 1,
      };
      await completeMutation(conn, {
        actorUserId,
        operation,
        mutation,
        response,
        resourceType: 'course_term_enrollment',
        resourceId: enrollment.id,
      });
      return response;
    });
  }

  async function createMakeupInsurancePolicy({
    ownerUserId,
    actorUserId,
    body,
    idempotencyKey,
  }) {
    await termDomain.assertSchema({ requirePayments: true });
    const targetSessionId = optionalPositiveId(
      body?.targetSessionId ?? body?.target_session_id,
      '保險目標場次'
    );
    if (!targetSessionId) throw courseTermError('COURSE_SESSION_NOT_FOUND', '請選擇補課保險目標場次', 400);
    const feeProductId = optionalPositiveId(
      body?.feeProductId ?? body?.fee_product_id,
      '保險費商品'
    );
    const feeAmount = numberOrNull(body?.feeAmount ?? body?.fee_amount);
    if (feeAmount === null) throw courseTermError('COURSE_INSURANCE_FEE_INVALID', '保險費不可小於 0', 400);
    const paymentHoldMinutes = positiveInteger(
      body?.paymentHoldMinutes ?? body?.payment_hold_minutes,
      1440
    );
    const status = ['active', 'inactive', 'archived'].includes(text(body?.status, 24).toLowerCase())
      ? text(body.status, 24).toLowerCase()
      : 'active';
    const cancelCloseInput = body?.cancelCloseAt ?? body?.cancel_close_at;
    const cancelCloseAt = cancelCloseInput ? mysqlDateTime(cancelCloseInput) : null;
    if (cancelCloseInput && !cancelCloseAt) {
      throw courseTermError('COURSE_INSURANCE_CANCEL_CLOSE_INVALID', '保險取消截止時間不正確', 400);
    }
    return withTransaction(async (conn) => {
      await assertRuntime(conn, ownerUserId, { requirePayments: true });
      const operation = 'term.makeup-insurance-policy.create';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { ownerUserId, body },
        resourceType: 'course_makeup_insurance_policy',
      });
      if (mutation.replay) return mutation.replay;
      await assertInsurancePolicyReferences(conn, { ownerUserId, targetSessionId, feeProductId });
      const [insert] = await conn.query(
        `INSERT INTO course_makeup_insurance_policies
          (owner_user_id, target_session_id, fee_product_id, required,
           fee_amount, currency, payment_hold_minutes, cancel_close_at,
           status, row_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          ownerUserId,
          targetSessionId,
          feeProductId,
          booleanValue(body?.required, true) ? 1 : 0,
          feeAmount,
          text(body?.currency, 3).toUpperCase() || 'TWD',
          paymentHoldMinutes,
          cancelCloseAt,
          status,
        ]
      );
      const response = {
        id: Number(insert.insertId),
        targetSessionId,
        feeProductId,
        rowVersion: 1,
      };
      await enqueue(conn, {
        ownerUserId,
        userId: actorUserId,
        eventType: 'MAKEUP_INSURANCE_POLICY_CREATED',
        dedupeKey: `makeup-insurance-policy-created:${insert.insertId}:1`,
        payload: { policyId: Number(insert.insertId), targetSessionId },
      });
      await completeMutation(conn, {
        actorUserId,
        operation,
        mutation,
        response,
        resourceType: 'course_makeup_insurance_policy',
        resourceId: insert.insertId,
      });
      return response;
    });
  }

  async function updateMakeupInsurancePolicy({
    policyId,
    ownerUserId,
    actorUserId,
    body,
    idempotencyKey,
    expectedRowVersion,
  }) {
    await termDomain.assertSchema({ requirePayments: true });
    const expectedVersion = positiveInteger(expectedRowVersion, null);
    if (!expectedVersion) {
      throw courseTermError('COURSE_ROW_VERSION_REQUIRED', '更新保險規則需要 If-Match', 428);
    }
    return withTransaction(async (conn) => {
      await assertRuntime(conn, ownerUserId, { requirePayments: true });
      const operation = 'term.makeup-insurance-policy.update';
      const mutation = await claimMutation(conn, {
        actorUserId,
        operation,
        idempotencyKey,
        payload: { policyId: positiveInteger(policyId), ownerUserId, expectedRowVersion: expectedVersion, body },
        resourceType: 'course_makeup_insurance_policy',
        resourceId: positiveInteger(policyId),
      });
      if (mutation.replay) return mutation.replay;
      const [rows] = await conn.query(
        `SELECT * FROM course_makeup_insurance_policies
          WHERE id = ? AND owner_user_id = ? LIMIT 1 FOR UPDATE`,
        [positiveInteger(policyId), ownerUserId]
      );
      const current = rows[0];
      if (!current) throw courseTermError('COURSE_INSURANCE_POLICY_NOT_FOUND', '找不到補課保險規則', 404);
      ensureRowVersion(current.row_version, expectedVersion, '補課保險規則');

      const sessionField = bodyField(body, 'targetSessionId', 'target_session_id');
      const productField = bodyField(body, 'feeProductId', 'fee_product_id');
      const targetSessionId = sessionField.present
        ? optionalPositiveId(sessionField.value, '保險目標場次')
        : positiveInteger(current.target_session_id);
      if (!targetSessionId) throw courseTermError('COURSE_SESSION_NOT_FOUND', '請選擇補課保險目標場次', 400);
      const feeProductId = productField.present
        ? optionalPositiveId(productField.value, '保險費商品')
        : optionalPositiveId(current.fee_product_id, '保險費商品');
      await assertInsurancePolicyReferences(conn, { ownerUserId, targetSessionId, feeProductId });

      const feeField = bodyField(body, 'feeAmount', 'fee_amount');
      const feeAmount = numberOrNull(feeField.present ? feeField.value : current.fee_amount);
      if (feeAmount === null) throw courseTermError('COURSE_INSURANCE_FEE_INVALID', '保險費不可小於 0', 400);
      const holdField = bodyField(body, 'paymentHoldMinutes', 'payment_hold_minutes');
      const paymentHoldMinutes = positiveInteger(
        holdField.present ? holdField.value : current.payment_hold_minutes,
        null
      );
      if (!paymentHoldMinutes) {
        throw courseTermError('COURSE_INSURANCE_HOLD_INVALID', '保險付款保留時間必須大於 0', 400);
      }
      const cancelField = bodyField(body, 'cancelCloseAt', 'cancel_close_at');
      const cancelCloseAt = cancelField.present
        ? (cancelField.value ? mysqlDateTime(cancelField.value) : null)
        : current.cancel_close_at;
      if (cancelField.present && cancelField.value && !cancelCloseAt) {
        throw courseTermError('COURSE_INSURANCE_CANCEL_CLOSE_INVALID', '保險取消截止時間不正確', 400);
      }
      const requestedStatus = text(body?.status, 24).toLowerCase();
      const status = ['active', 'inactive', 'archived'].includes(requestedStatus)
        ? requestedStatus
        : current.status;
      const [update] = await conn.query(
        `UPDATE course_makeup_insurance_policies
            SET target_session_id = ?, fee_product_id = ?, required = ?,
                fee_amount = ?, currency = ?, payment_hold_minutes = ?,
                cancel_close_at = ?, status = ?, row_version = row_version + 1
          WHERE id = ? AND owner_user_id = ? AND row_version = ?`,
        [
          targetSessionId,
          feeProductId,
          body?.required === undefined ? Number(current.required) : (booleanValue(body.required) ? 1 : 0),
          feeAmount,
          text(body?.currency ?? current.currency, 3).toUpperCase() || 'TWD',
          paymentHoldMinutes,
          cancelCloseAt,
          status,
          current.id,
          ownerUserId,
          expectedVersion,
        ]
      );
      if (!update.affectedRows) {
        throw courseTermError('COURSE_ROW_VERSION_CONFLICT', '補課保險規則已更新，請重新載入', 412);
      }
      const response = {
        id: Number(current.id),
        targetSessionId,
        feeProductId,
        rowVersion: expectedVersion + 1,
      };
      await enqueue(conn, {
        ownerUserId,
        userId: actorUserId,
        eventType: 'MAKEUP_INSURANCE_POLICY_UPDATED',
        dedupeKey: `makeup-insurance-policy-updated:${current.id}:${expectedVersion + 1}`,
        payload: { policyId: Number(current.id), rowVersion: expectedVersion + 1 },
      });
      await completeMutation(conn, {
        actorUserId,
        operation,
        mutation,
        response,
        resourceType: 'course_makeup_insurance_policy',
        resourceId: current.id,
      });
      return response;
    });
  }

  return {
    completeEnrollment,
    createMakeupInsurancePolicy,
    createLevel,
    createLevelScheme,
    createProgram,
    createRenewalQuote,
    createSeatOffer,
    createTerm,
    createTermSession,
    expireDueSeatOffers,
    fillAvailableWaitlistOffers,
    listCatalog,
    listMemberSeatOffers,
    publishTerm,
    renewalEligibility,
    termReadiness,
    transitionSeatOffer,
    updateLevel,
    updateLevelScheme,
    updateMakeupInsurancePolicy,
    updateProgram,
    updateTerm,
    upsertStudentLevel,
    upsertPricingRule,
    upsertRenewalRule,
  };
}

module.exports = {
  createCourseTermAdminDomain,
};
