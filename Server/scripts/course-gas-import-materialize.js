'use strict';

const crypto = require('node:crypto');
const {
  buildStagingRows,
  hashValue,
  normalizeCode,
} = require('./course-gas-import-lib');

function nullable(value) {
  return value == null || value === '' ? null : value;
}

function json(value) {
  return value == null ? null : JSON.stringify(value);
}

function jsonDatabaseValue(value) {
  if (value == null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function mysqlDateTime(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    return text.replace('T', ' ').slice(0, 19);
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function mysqlDate(value) {
  const dateTime = mysqlDateTime(value);
  return dateTime ? dateTime.slice(0, 10) : null;
}

function deterministicBookingCode(sourceId) {
  const digest = crypto.createHash('sha256').update(String(sourceId)).digest('hex').toUpperCase();
  return `CBK-GAS-${digest.slice(0, 24)}`;
}

function deterministicIdempotency(sourceId) {
  return `gas:${crypto.createHash('sha256').update(String(sourceId)).digest('hex')}`;
}

function materializeError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

async function mapping(connection, entityType, sourceId) {
  const [rows] = await connection.query(
    `SELECT target_table, target_id, source_hash
       FROM course_import_source_mappings
      WHERE source_system = 'gas' AND entity_type = ? AND source_id = ?
      LIMIT 1
      FOR UPDATE`,
    [entityType, String(sourceId)]
  );
  return rows[0] || null;
}

async function saveMapping(connection, {
  entityType,
  sourceId,
  targetTable,
  targetId,
  sourceHash,
  runId,
}) {
  const [targetMappings] = await connection.query(
    `SELECT entity_type, source_id
       FROM course_import_source_mappings
      WHERE source_system = 'gas'
        AND target_table = ?
        AND target_id = ?
        AND NOT (entity_type = ? AND source_id = ?)
      LIMIT 1
      FOR UPDATE`,
    [targetTable, targetId, entityType, String(sourceId)]
  );
  if (targetMappings.length) {
    throw materializeError(
      'GAS_MAPPING_TARGET_CONFLICT',
      `${targetTable}:${targetId} is already mapped from ${targetMappings[0].entity_type}:${targetMappings[0].source_id}.`
    );
  }
  await connection.query(
    `INSERT INTO course_import_source_mappings
       (source_system, entity_type, source_id, target_table, target_id,
        source_hash, first_run_id, last_run_id)
     VALUES ('gas', ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       target_table = VALUES(target_table),
       target_id = VALUES(target_id),
       source_hash = VALUES(source_hash),
       last_run_id = VALUES(last_run_id)`,
    [
      entityType,
      String(sourceId),
      targetTable,
      targetId,
      sourceHash,
      runId,
      runId,
    ]
  );
}

async function mappedOrCode(connection, {
  entityType,
  sourceId,
  table,
  codeColumn = 'code',
  code,
}) {
  const existingMapping = await mapping(connection, entityType, sourceId);
  if (existingMapping) {
    if (existingMapping.target_table !== table) {
      throw materializeError(
        'GAS_MAPPING_TABLE_CONFLICT',
        `${entityType}:${sourceId} is already mapped to ${existingMapping.target_table}.`
      );
    }
    const [mappedRows] = await connection.query(
      `SELECT * FROM \`${table}\` WHERE id = ? LIMIT 1 FOR UPDATE`,
      [existingMapping.target_id]
    );
    if (!mappedRows.length) {
      throw materializeError(
        'GAS_MAPPING_TARGET_MISSING',
        `${entityType}:${sourceId} points to a missing ${table} row.`
      );
    }
    if (
      code
      && normalizeCode(mappedRows[0][codeColumn]) !== normalizeCode(code)
    ) {
      throw materializeError(
        'GAS_MAPPING_IDENTITY_CONFLICT',
        `${entityType}:${sourceId} changed ${codeColumn} from ${mappedRows[0][codeColumn]} to ${code}.`
      );
    }
    return { row: mappedRows[0], mapped: true };
  }
  if (!code) return { row: null, mapped: false };
  const [codeRows] = await connection.query(
    `SELECT * FROM \`${table}\` WHERE \`${codeColumn}\` = ? LIMIT 2 FOR UPDATE`,
    [code]
  );
  return { row: codeRows[0] || null, mapped: false };
}

async function existingUser(connection, userId) {
  if (!userId) return null;
  const [rows] = await connection.query(
    'SELECT id, username, email FROM users WHERE id = ? LIMIT 1',
    [userId]
  );
  if (!rows.length) {
    throw materializeError('GAS_OWNER_USER_MISSING', `Leader user ${userId} does not exist.`);
  }
  return rows[0];
}

async function userByEmail(connection, email) {
  if (!email) return null;
  const [rows] = await connection.query(
    'SELECT id, username, email FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1',
    [email]
  );
  return rows[0] || null;
}

function compatibility(condition, entityType, code, details) {
  if (!condition) {
    throw materializeError(
      'GAS_CODE_CONFLICT',
      `${entityType} code ${code} already exists with different immutable identity fields.`,
      details
    );
  }
}

function createLookup() {
  const bySource = new Map();
  const byCode = new Map();
  const byOwnerCode = new Map();
  return {
    set(sourceId, code, value, ownerUserId = null) {
      bySource.set(String(sourceId), value);
      if (code && ownerUserId) {
        byOwnerCode.set(`${ownerUserId}:${normalizeCode(code)}`, value);
      } else if (code) {
        byCode.set(normalizeCode(code), value);
      }
    },
    source(sourceId) {
      return sourceId == null ? null : bySource.get(String(sourceId)) || null;
    },
    code(code, ownerUserId = null) {
      if (code == null) return null;
      if (ownerUserId) {
        return byOwnerCode.get(`${ownerUserId}:${normalizeCode(code)}`) || null;
      }
      return byCode.get(normalizeCode(code)) || null;
    },
  };
}

async function materializeStudents(context) {
  const { connection, datasets, runId, lookups, counters } = context;
  for (const row of datasets.students || []) {
    const owner = await existingUser(connection, row.ownerUserId);
    const tenantKey = owner?.id || '00000000-0000-0000-0000-000000000000';
    const existingMapping = await mapping(connection, 'students', row.sourceId);
    let existing = null;
    if (existingMapping) {
      const [rows] = await connection.query(
        'SELECT * FROM course_students WHERE id = ? LIMIT 1 FOR UPDATE',
        [existingMapping.target_id]
      );
      existing = rows[0] || null;
    } else {
      const [rows] = await connection.query(
        `SELECT * FROM course_students
          WHERE tenant_key = ? AND email_normalized = ?
          LIMIT 1 FOR UPDATE`,
        [tenantKey, String(row.email).toLowerCase()]
      );
      existing = rows[0] || null;
    }
    if (existing && existingMapping) {
      compatibility(
        String(existing.email_normalized).toLowerCase() === String(row.email).toLowerCase(),
        'student',
        row.sourceId,
        { existingEmail: existing.email_normalized, sourceEmail: row.email }
      );
    }
    let id;
    if (existing) {
      id = Number(existing.id);
      await connection.query(
        `UPDATE course_students
            SET owner_user_id = ?, tenant_key = ?, email = ?,
                email_normalized = ?, display_name = ?, phone = ?, status = ?,
                source_system = 'gas', source_id = ?, metadata_json = ?,
                row_version = row_version + 1
          WHERE id = ?`,
        [
          owner?.id || null,
          tenantKey,
          row.email,
          String(row.email).toLowerCase(),
          row.displayName,
          nullable(row.phone),
          row.status || 'pending_claim',
          String(row.sourceId),
          json(row.metadata),
          id,
        ]
      );
    } else {
      const [result] = await connection.query(
        `INSERT INTO course_students
          (owner_user_id, tenant_key, user_id, email, email_normalized,
           display_name, phone, status, source_system, source_id, metadata_json)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'gas', ?, ?)`,
        [
          owner?.id || null,
          tenantKey,
          row.email,
          String(row.email).toLowerCase(),
          row.displayName,
          nullable(row.phone),
          row.status || 'pending_claim',
          String(row.sourceId),
          json(row.metadata),
        ]
      );
      id = Number(result.insertId);
      counters.inserted += 1;
    }
    const [studentRows] = await connection.query(
      'SELECT id, owner_user_id, tenant_key, user_id, email, display_name FROM course_students WHERE id = ?',
      [id]
    );
    const student = studentRows[0];
    await saveMapping(connection, {
      entityType: 'students',
      sourceId: row.sourceId,
      targetTable: 'course_students',
      targetId: id,
      sourceHash: hashValue(row),
      runId,
    });
    lookups.students.set(row.sourceId, null, student);
  }
}

async function materializeTicketProducts(context) {
  const { connection, datasets, runId, lookups, counters } = context;
  for (const row of datasets.ticketProducts || []) {
    const owner = await existingUser(connection, row.ownerUserId);
    const found = await mappedOrCode(connection, {
      entityType: 'ticketProducts',
      sourceId: row.sourceId,
      table: 'course_ticket_products',
      code: row.code,
    });
    if (found.row && !found.mapped) {
      compatibility(
        String(found.row.name) === String(row.name)
          && Number(found.row.class_count) === Number(row.classCount),
        'ticketProduct',
        row.code,
        { existing: found.row, source: row }
      );
    }
    let id;
    if (found.row) {
      id = Number(found.row.id);
      await connection.query(
        `UPDATE course_ticket_products
            SET owner_user_id = ?, name = ?, description = ?, class_count = ?,
                valid_days = ?, activation_days = ?, transferable = ?,
                max_transfers = ?, terms_text = ?, redemption_policy_json = ?,
                status = ?, row_version = row_version + 1
          WHERE id = ?`,
        [
          owner?.id || null,
          row.name,
          nullable(row.description),
          row.classCount,
          row.validDays ?? 120,
          row.activationDays ?? 120,
          row.transferable ? 1 : 0,
          row.maxTransfers ?? 1,
          nullable(row.termsText),
          json(row.redemptionPolicy),
          row.status || 'draft',
          id,
        ]
      );
    } else {
      const [result] = await connection.query(
        `INSERT INTO course_ticket_products
          (owner_user_id, code, name, description, class_count, valid_days,
           activation_days, transferable, max_transfers, terms_text,
           redemption_policy_json, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          owner?.id || null,
          row.code,
          row.name,
          nullable(row.description),
          row.classCount,
          row.validDays ?? 120,
          row.activationDays ?? 120,
          row.transferable ? 1 : 0,
          row.maxTransfers ?? 1,
          nullable(row.termsText),
          json(row.redemptionPolicy),
          row.status || 'draft',
        ]
      );
      id = Number(result.insertId);
      counters.inserted += 1;
    }
    const [rows] = await connection.query(
      'SELECT * FROM course_ticket_products WHERE id = ?',
      [id]
    );
    await saveMapping(connection, {
      entityType: 'ticketProducts',
      sourceId: row.sourceId,
      targetTable: 'course_ticket_products',
      targetId: id,
      sourceHash: hashValue(row),
      runId,
    });
    lookups.ticketProducts.set(row.sourceId, row.code, rows[0]);
  }
}

async function materializeShopProducts(context) {
  const { connection, datasets, runId, lookups, counters } = context;
  for (const row of datasets.shopProducts || []) {
    const owner = await existingUser(connection, row.ownerUserId);
    const ticketProduct = lookups.ticketProducts.code(row.ticketProductCode);
    if (!ticketProduct) {
      throw materializeError('GAS_REFERENCE_MISSING', `Missing TicketProduct ${row.ticketProductCode}.`);
    }
    const found = await mappedOrCode(connection, {
      entityType: 'shopProducts',
      sourceId: row.sourceId,
      table: 'course_products',
      code: row.code,
    });
    if (found.row && !found.mapped) {
      compatibility(
        String(found.row.name) === String(row.name)
          && Number(found.row.price) === Number(row.price),
        'shopProduct',
        row.code,
        { existing: found.row, source: row }
      );
    }
    let id;
    const values = [
      owner?.id || null,
      ticketProduct.id,
      row.name,
      nullable(row.category),
      nullable(row.summary),
      nullable(row.description),
      Number(row.price),
      row.classCount ?? ticketProduct.class_count,
      row.validDays ?? ticketProduct.valid_days,
      row.activationDays ?? ticketProduct.activation_days,
      row.transferable == null ? Number(ticketProduct.transferable) : (row.transferable ? 1 : 0),
      row.returningStudentOnly ? 1 : 0,
      row.requireAddonForNew ? 1 : 0,
      nullable(row.externalPurchaseUrl),
      row.status || 'draft',
      row.sortOrder ?? 0,
    ];
    if (found.row) {
      id = Number(found.row.id);
      await connection.query(
        `UPDATE course_products
            SET owner_user_id = ?, ticket_product_id = ?, name = ?, category = ?,
                summary = ?, description = ?, price = ?, class_count = ?,
                valid_days = ?, activation_days = ?, transferable = ?,
                returning_student_only = ?, require_addon_for_new = ?,
                external_purchase_url = ?,
                status = ?, sort_order = ?, row_version = row_version + 1
          WHERE id = ?`,
        [...values, id]
      );
    } else {
      const [result] = await connection.query(
        `INSERT INTO course_products
          (owner_user_id, ticket_product_id, code, name, category, summary,
           description, price, class_count, valid_days, activation_days,
           transferable, returning_student_only, require_addon_for_new,
           external_purchase_url,
           status, sort_order, row_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          owner?.id || null,
          ticketProduct.id,
          row.code,
          row.name,
          nullable(row.category),
          nullable(row.summary),
          nullable(row.description),
          Number(row.price),
          row.classCount ?? ticketProduct.class_count,
          row.validDays ?? ticketProduct.valid_days,
          row.activationDays ?? ticketProduct.activation_days,
          row.transferable == null ? Number(ticketProduct.transferable) : (row.transferable ? 1 : 0),
          row.returningStudentOnly ? 1 : 0,
          row.requireAddonForNew ? 1 : 0,
          nullable(row.externalPurchaseUrl),
          row.status || 'draft',
          row.sortOrder ?? 0,
        ]
      );
      id = Number(result.insertId);
      counters.inserted += 1;
    }
    await connection.query(
      'DELETE FROM course_shop_product_components WHERE shop_product_id = ?',
      [id]
    );
    const ticketComponents = row.ticketComponents?.length
      ? row.ticketComponents
      : [{
          ticketProductCode: row.ticketProductCode,
          componentRole: 'primary',
          quantity: 1,
          sortOrder: 0,
        }];
    for (const component of ticketComponents) {
      const componentTicketProduct = lookups.ticketProducts.code(
        component.ticketProductCode
      );
      if (!componentTicketProduct) {
        throw materializeError(
          'GAS_REFERENCE_MISSING',
          `Missing TicketProduct ${component.ticketProductCode}.`
        );
      }
      await connection.query(
        `INSERT INTO course_shop_product_components
          (shop_product_id, ticket_product_id, component_role, quantity, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [
          id,
          componentTicketProduct.id,
          component.componentRole || 'primary',
          component.quantity ?? 1,
          component.sortOrder ?? 0,
        ]
      );
    }
    await saveMapping(connection, {
      entityType: 'shopProducts',
      sourceId: row.sourceId,
      targetTable: 'course_products',
      targetId: id,
      sourceHash: hashValue(row),
      runId,
    });
    const [rows] = await connection.query('SELECT * FROM course_products WHERE id = ?', [id]);
    lookups.shopProducts.set(row.sourceId, row.code, rows[0]);
  }

  for (const row of datasets.shopProducts || []) {
    const product = lookups.shopProducts.source(row.sourceId);
    await connection.query(
      'DELETE FROM course_product_returning_requirements WHERE product_id = ?',
      [product.id]
    );
    for (const code of row.qualifyingTicketProductCodes || []) {
      const ticketProduct = lookups.ticketProducts.code(code);
      await connection.query(
        `INSERT INTO course_product_returning_requirements
          (product_id, qualifying_ticket_product_id, lookback_days)
         VALUES (?, ?, NULL)`,
        [product.id, ticketProduct.id]
      );
    }
    await connection.query(
      'DELETE FROM course_product_required_addons WHERE product_id = ?',
      [product.id]
    );
    for (const [sortOrder, code] of (row.requiredAddonCodes || []).entries()) {
      const addon = lookups.shopProducts.code(code);
      await connection.query(
        `INSERT INTO course_product_required_addons
          (product_id, addon_product_id, quantity, sort_order)
         VALUES (?, ?, 1, ?)`,
        [product.id, addon.id, sortOrder]
      );
    }
  }
}

async function materializeScenarios(context) {
  const { connection, datasets, runId, lookups, counters } = context;
  for (const row of datasets.scenarios || []) {
    const owner = await existingUser(connection, row.ownerUserId);
    const found = await mappedOrCode(connection, {
      entityType: 'scenarios',
      sourceId: row.sourceId,
      table: 'course_redeem_scenarios',
      code: row.code,
    });
    if (found.row && !found.mapped) {
      compatibility(String(found.row.name) === String(row.name), 'scenario', row.code, {
        existing: found.row,
        source: row,
      });
    }
    let id;
    if (found.row) {
      id = Number(found.row.id);
      await connection.query(
        `UPDATE course_redeem_scenarios
            SET owner_user_id = ?, name = ?, description = ?, status = ?,
                redeem_open_minutes_before = ?, redeem_close_minutes_after = ?,
                row_version = row_version + 1
          WHERE id = ?`,
        [
          owner?.id || null,
          row.name,
          nullable(row.description),
          row.status || 'active',
          nullable(row.redeemOpenMinutesBefore),
          nullable(row.redeemCloseMinutesAfter),
          id,
        ]
      );
    } else {
      const [result] = await connection.query(
        `INSERT INTO course_redeem_scenarios
          (owner_user_id, code, name, description, status,
           redeem_open_minutes_before, redeem_close_minutes_after)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          owner?.id || null,
          row.code,
          row.name,
          nullable(row.description),
          row.status || 'active',
          nullable(row.redeemOpenMinutesBefore),
          nullable(row.redeemCloseMinutesAfter),
        ]
      );
      id = Number(result.insertId);
      counters.inserted += 1;
    }
    await connection.query(
      'DELETE FROM course_scenario_allowed_products WHERE scenario_id = ?',
      [id]
    );
    for (const [priority, code] of row.allowedProductCodes.entries()) {
      const ticketProduct = lookups.ticketProducts.code(code);
      await connection.query(
        `INSERT INTO course_scenario_allowed_products
          (scenario_id, ticket_product_id, priority)
         VALUES (?, ?, ?)`,
        [id, ticketProduct.id, priority + 1]
      );
    }
    await saveMapping(connection, {
      entityType: 'scenarios',
      sourceId: row.sourceId,
      targetTable: 'course_redeem_scenarios',
      targetId: id,
      sourceHash: hashValue(row),
      runId,
    });
    const [rows] = await connection.query(
      'SELECT * FROM course_redeem_scenarios WHERE id = ?',
      [id]
    );
    lookups.scenarios.set(row.sourceId, row.code, rows[0]);
  }
}

async function materializeStaffAndCoaches(context) {
  const { connection, datasets, runId, lookups, counters } = context;
  for (const row of datasets.staff || []) {
    const owner = await existingUser(connection, row.ownerUserId);
    const user = await userByEmail(connection, row.email);
    if (!user) {
      throw materializeError(
        'GAS_STAFF_ACCOUNT_REQUIRED',
        `Staff ${row.email} must have a Leader account; PIN/password is never imported.`
      );
    }
    const [existing] = await connection.query(
      `SELECT * FROM course_staff_memberships
        WHERE owner_user_id = ? AND user_id = ? LIMIT 1 FOR UPDATE`,
      [owner.id, user.id]
    );
    let id;
    if (existing.length) {
      id = Number(existing[0].id);
      await connection.query(
        `UPDATE course_staff_memberships
            SET role = ?, capabilities_json = ?, status = ?,
                row_version = row_version + 1
          WHERE id = ?`,
        [row.role, json(row.capabilities), row.status || 'active', id]
      );
    } else {
      const [result] = await connection.query(
        `INSERT INTO course_staff_memberships
          (owner_user_id, user_id, role, capabilities_json, status)
         VALUES (?, ?, ?, ?, ?)`,
        [owner.id, user.id, row.role, json(row.capabilities), row.status || 'active']
      );
      id = Number(result.insertId);
      counters.inserted += 1;
    }
    await saveMapping(connection, {
      entityType: 'staff',
      sourceId: row.sourceId,
      targetTable: 'course_staff_memberships',
      targetId: id,
      sourceHash: hashValue(row),
      runId,
    });
    lookups.staff.set(row.sourceId, null, { id, user_id: user.id, email: user.email });
  }

  for (const row of datasets.coachProfiles || []) {
    const owner = await existingUser(connection, row.ownerUserId);
    const user = await userByEmail(connection, row.email);
    const existingMapping = await mapping(connection, 'coachProfiles', row.sourceId);
    let found;
    if (existingMapping) {
      if (existingMapping.target_table !== 'course_coach_profiles') {
        throw materializeError(
          'GAS_MAPPING_TABLE_CONFLICT',
          `coachProfiles:${row.sourceId} is mapped to ${existingMapping.target_table}.`
        );
      }
      const [rows] = await connection.query(
        'SELECT * FROM course_coach_profiles WHERE id = ? LIMIT 1 FOR UPDATE',
        [existingMapping.target_id]
      );
      if (!rows.length) {
        throw materializeError(
          'GAS_MAPPING_TARGET_MISSING',
          `coachProfiles:${row.sourceId} points to a missing coach profile.`
        );
      }
      found = { row: rows[0], mapped: true };
    } else {
      const [rows] = await connection.query(
        `SELECT * FROM course_coach_profiles
          WHERE owner_user_id = ? AND code = ?
          LIMIT 2 FOR UPDATE`,
        [owner.id, row.code]
      );
      found = { row: rows[0] || null, mapped: false };
    }
    if (found.row) {
      compatibility(
        String(found.row.owner_user_id) === String(owner.id)
          && normalizeCode(found.row.code) === normalizeCode(row.code)
          && (found.mapped || String(found.row.display_name) === String(row.displayName)),
        'coachProfile',
        row.code,
        { existing: found.row, source: row }
      );
    }
    let id;
    if (found.row) {
      id = Number(found.row.id);
      await connection.query(
        `UPDATE course_coach_profiles
            SET owner_user_id = ?, code = ?, user_id = ?, display_name = ?,
                email = ?, phone = ?, bio = ?, status = ?,
                row_version = row_version + 1
          WHERE id = ?`,
        [
          owner.id,
          row.code,
          user?.id || null,
          row.displayName,
          nullable(row.email),
          nullable(row.phone),
          nullable(row.bio),
          row.status || 'active',
          id,
        ]
      );
    } else {
      const [result] = await connection.query(
        `INSERT INTO course_coach_profiles
          (owner_user_id, code, user_id, display_name, email, phone, bio, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          owner.id,
          row.code,
          user?.id || null,
          row.displayName,
          nullable(row.email),
          nullable(row.phone),
          nullable(row.bio),
          row.status || 'active',
        ]
      );
      id = Number(result.insertId);
      counters.inserted += 1;
    }
    await saveMapping(connection, {
      entityType: 'coachProfiles',
      sourceId: row.sourceId,
      targetTable: 'course_coach_profiles',
      targetId: id,
      sourceHash: hashValue(row),
      runId,
    });
    const [rows] = await connection.query(
      'SELECT * FROM course_coach_profiles WHERE id = ?',
      [id]
    );
    lookups.coachProfiles.set(row.sourceId, row.code, rows[0], owner.id);
  }
}

async function materializeSettings(context) {
  const { connection, datasets, runId, lookups, counters } = context;
  for (const row of datasets.settings || []) {
    const owner = await existingUser(connection, row.ownerUserId);
    if (row.scopeKey !== 'platform' && !owner) {
      throw materializeError(
        'GAS_SETTINGS_OWNER_REQUIRED',
        `Settings ${row.scopeKey} requires ownerUserId.`
      );
    }
    const expectedScopeKey = owner ? `provider:${owner.id}` : 'platform';
    if (row.scopeKey !== expectedScopeKey) {
      throw materializeError(
        'GAS_SETTINGS_SCOPE_CONFLICT',
        `Settings ${row.sourceId} must use scopeKey ${expectedScopeKey}.`
      );
    }
    const [existing] = await connection.query(
      'SELECT * FROM course_settings WHERE scope_key = ? LIMIT 1 FOR UPDATE',
      [row.scopeKey]
    );
    const values = [
      row.scopeKey === 'platform' ? 'platform' : 'provider',
      owner?.id || null,
      row.timezone || 'Asia/Taipei',
      row.bookingOpenMinutesBefore ?? 43200,
      row.bookingCloseMinutesBefore ?? 0,
      row.cancelCloseMinutesBefore ?? 0,
      row.redeemOpenMinutesBefore ?? 120,
      row.redeemCloseMinutesAfter ?? 1440,
      row.attendanceInviteExpiresMinutes ?? 1440,
      row.autoNoShow ? 1 : 0,
    ];
    let id;
    if (existing.length) {
      id = Number(existing[0].id);
      await connection.query(
        `UPDATE course_settings
            SET scope = ?, owner_user_id = ?, timezone = ?,
                booking_open_minutes_before = ?, booking_close_minutes_before = ?,
                cancel_close_minutes_before = ?, redeem_open_minutes_before = ?,
                redeem_close_minutes_after = ?, attendance_invite_expires_minutes = ?,
                auto_no_show = ?, row_version = row_version + 1
          WHERE id = ?`,
        [...values, id]
      );
    } else {
      const [result] = await connection.query(
        `INSERT INTO course_settings
          (scope_key, scope, owner_user_id, timezone,
           booking_open_minutes_before, booking_close_minutes_before,
           cancel_close_minutes_before, redeem_open_minutes_before,
           redeem_close_minutes_after, attendance_invite_expires_minutes,
           auto_no_show)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.scopeKey, ...values]
      );
      id = Number(result.insertId);
      counters.inserted += 1;
    }
    await saveMapping(connection, {
      entityType: 'settings',
      sourceId: row.sourceId,
      targetTable: 'course_settings',
      targetId: id,
      sourceHash: hashValue(row),
      runId,
    });
    lookups.settings.set(row.sourceId, row.scopeKey, { id, scope_key: row.scopeKey });
  }
}

async function materializeOrders(context) {
  const { connection, datasets, runId, lookups, counters } = context;
  for (const row of datasets.orders || []) {
    const student = lookups.students.source(row.studentSourceId);
    const primaryItem = row.items.find((item) => item.itemType === 'primary') || row.items[0];
    const primaryProduct = lookups.shopProducts.code(primaryItem?.shopProductCode);
    const found = await mappedOrCode(connection, {
      entityType: 'orders',
      sourceId: row.sourceId,
      table: 'course_orders',
      code: row.code,
    });
    if (found.row && !found.mapped) {
      compatibility(
        Number(found.row.total_amount) === Number(row.totalAmount)
          && String(found.row.status) === String(row.status),
        'order',
        row.code,
        { existing: found.row, source: row }
      );
    }
    const quantity = Number(primaryItem?.quantity || 1);
    let id;
    if (found.row) {
      id = Number(found.row.id);
      await connection.query(
        `UPDATE course_orders
            SET user_id = ?, student_id = ?, buyer_name = ?, buyer_email = ?,
                buyer_phone = ?, product_id = ?, quantity = ?, unit_price = ?,
                total_amount = ?, status = ?, terms_accepted_at = ?, note = ?,
                row_version = row_version + 1
          WHERE id = ?`,
        [
          student.user_id || null,
          student.id,
          row.buyerName,
          row.buyerEmail,
          nullable(row.buyerPhone),
          primaryProduct?.id || null,
          quantity || 1,
          Number(primaryItem?.unitPrice || 0),
          Number(row.totalAmount),
          row.status,
          mysqlDateTime(row.termsAcceptedAt),
          nullable(row.note),
          id,
        ]
      );
    } else {
      const [result] = await connection.query(
        `INSERT INTO course_orders
          (code, user_id, student_id, buyer_name, buyer_email, buyer_phone,
           product_id, quantity, unit_price, total_amount, status,
           terms_accepted_at, note, created_at, updated_at, row_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          row.code,
          student.user_id || null,
          student.id,
          row.buyerName,
          row.buyerEmail,
          nullable(row.buyerPhone),
          primaryProduct?.id || null,
          quantity || 1,
          Number(primaryItem?.unitPrice || 0),
          Number(row.totalAmount),
          row.status,
          mysqlDateTime(row.termsAcceptedAt),
          nullable(row.note),
          mysqlDateTime(row.createdAt),
          mysqlDateTime(row.updatedAt || row.createdAt),
        ]
      );
      id = Number(result.insertId);
      counters.inserted += 1;
    }
    await saveMapping(connection, {
      entityType: 'orders',
      sourceId: row.sourceId,
      targetTable: 'course_orders',
      targetId: id,
      sourceHash: hashValue(row),
      runId,
    });
    lookups.orders.set(row.sourceId, row.code, { id, user_id: student.user_id, student_id: student.id });

    for (const item of row.items) {
      const shopProduct = lookups.shopProducts.code(item.shopProductCode);
      const shopSource = (datasets.shopProducts || []).find(
        (product) => normalizeCode(product.code) === normalizeCode(item.shopProductCode)
      );
      const ticketProduct = lookups.ticketProducts.code(item.ticketProductCode)
        || (shopProduct ? lookups.ticketProducts.code(shopSource?.ticketProductCode) : null);
      if (!ticketProduct) {
        throw materializeError(
          'GAS_REFERENCE_MISSING',
          `Order item ${item.sourceId} cannot resolve its TicketProduct.`
        );
      }
      const issuedTicketCount = (datasets.tickets || []).filter(
        (ticket) => String(ticket.orderItemSourceId) === String(item.sourceId)
      ).length;
      const issuanceStatus = item.issuanceStatus
        || (issuedTicketCount >= Number(item.quantity) ? 'issued' : 'pending');
      const existingItemMapping = await mapping(connection, 'orderItems', item.sourceId);
      let existingItem = null;
      if (existingItemMapping) {
        if (existingItemMapping.target_table !== 'course_order_items') {
          throw materializeError(
            'GAS_MAPPING_TABLE_CONFLICT',
            `orderItems:${item.sourceId} is mapped to ${existingItemMapping.target_table}.`
          );
        }
        const [rows] = await connection.query(
          'SELECT * FROM course_order_items WHERE id = ? LIMIT 1 FOR UPDATE',
          [existingItemMapping.target_id]
        );
        if (!rows.length) {
          throw materializeError(
            'GAS_MAPPING_TARGET_MISSING',
            `orderItems:${item.sourceId} points to a missing order item.`
          );
        }
        existingItem = rows[0];
      } else {
        const [rows] = await connection.query(
          `SELECT *
             FROM course_order_items
            WHERE order_id = ?
              AND item_type = ?
              AND shop_product_id <=> ?
              AND ticket_product_id <=> ?
            LIMIT 2
            FOR UPDATE`,
          [
            id,
            item.itemType,
            shopProduct?.id || null,
            ticketProduct.id,
          ]
        );
        if (rows.length > 1) {
          throw materializeError(
            'GAS_ORDER_ITEM_MATCH_CONFLICT',
            `Order item ${item.sourceId} matches multiple existing lines.`
          );
        }
        existingItem = rows[0] || null;
        if (existingItem) {
          compatibility(
            Number(existingItem.quantity) === Number(item.quantity)
              && Number(existingItem.line_total) === Number(item.lineTotal),
            'orderItem',
            item.sourceId,
            { existing: existingItem, source: item }
          );
        }
      }
      let itemId = existingItem ? Number(existingItem.id) : null;
      if (itemId) {
        await connection.query(
          `UPDATE course_order_items
              SET order_id = ?, shop_product_id = ?, ticket_product_id = ?,
                  item_type = ?, item_code_snapshot = ?, item_name_snapshot = ?,
                  quantity = ?, unit_price = ?, line_total = ?,
                  issuance_status = ?, metadata_json = ?, row_version = row_version + 1
            WHERE id = ?`,
          [
            id,
            shopProduct?.id || null,
            ticketProduct?.id || null,
            item.itemType,
            item.itemCode,
            item.itemName,
            Number(item.quantity),
            Number(item.unitPrice),
            Number(item.lineTotal),
            issuanceStatus,
            json(item.metadata),
            itemId,
          ]
        );
      } else {
        const [result] = await connection.query(
          `INSERT INTO course_order_items
            (order_id, shop_product_id, ticket_product_id, item_type,
             item_code_snapshot, item_name_snapshot, quantity, unit_price,
             line_total, issuance_status, metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            shopProduct?.id || null,
            ticketProduct?.id || null,
            item.itemType,
            item.itemCode,
            item.itemName,
            Number(item.quantity),
            Number(item.unitPrice),
            Number(item.lineTotal),
            issuanceStatus,
            json(item.metadata),
          ]
        );
        itemId = Number(result.insertId);
      }
      await saveMapping(connection, {
        entityType: 'orderItems',
        sourceId: item.sourceId,
        targetTable: 'course_order_items',
        targetId: itemId,
        sourceHash: hashValue(item),
        runId,
      });
      lookups.orderItems.set(item.sourceId, null, { id: itemId, order_id: id });
    }
  }
}

async function materializeTickets(context) {
  const { connection, datasets, runId, lookups, counters } = context;
  for (const row of datasets.tickets || []) {
    const student = lookups.students.source(row.studentSourceId);
    const ticketProduct = lookups.ticketProducts.code(row.ticketProductCode);
    const shopProduct = lookups.shopProducts.code(row.shopProductCode);
    const order = lookups.orders.source(row.orderSourceId);
    const orderItem = lookups.orderItems.source(row.orderItemSourceId);
    if (!student || !ticketProduct) {
      throw materializeError(
        'GAS_REFERENCE_MISSING',
        `Ticket ${row.code} cannot resolve its Student or TicketProduct.`
      );
    }
    if (row.shopProductCode && !shopProduct) {
      throw materializeError('GAS_REFERENCE_MISSING', `Ticket ${row.code} cannot resolve ShopProduct.`);
    }
    if (row.orderSourceId && !order) {
      throw materializeError('GAS_REFERENCE_MISSING', `Ticket ${row.code} cannot resolve Order.`);
    }
    if (row.orderItemSourceId && !orderItem) {
      throw materializeError('GAS_REFERENCE_MISSING', `Ticket ${row.code} cannot resolve OrderItem.`);
    }
    if (order && orderItem && Number(order.id) !== Number(orderItem.order_id)) {
      throw materializeError(
        'GAS_TICKET_ORDER_ITEM_CONFLICT',
        `Ticket ${row.code} references an OrderItem from another Order.`
      );
    }
    const found = await mappedOrCode(connection, {
      entityType: 'tickets',
      sourceId: row.sourceId,
      table: 'course_tickets',
      code: row.code,
    });
    if (found.row && !found.mapped) {
      compatibility(
        String(found.row.owner_email).toLowerCase()
          === String(row.ownerEmail || student.email).toLowerCase()
          && Number(found.row.total_uses) === Number(row.totalUses)
          && Number(found.row.remaining_uses_cache) === Number(row.remainingUses)
          && String(found.row.status) === String(row.status),
        'ticket',
        row.code,
        { existing: found.row, source: row }
      );
    }
    const provider = await existingUser(connection, ticketProduct.owner_user_id);
    let id;
    let inserted = false;
    const ticketValues = [
      student.user_id || null,
      student.id,
      row.ownerName || student.display_name,
      row.ownerEmail || student.email,
      shopProduct?.id || null,
      ticketProduct.id,
      order?.id || null,
      orderItem?.id || null,
      ticketProduct.code,
      ticketProduct.name,
      Number(row.totalUses),
      ticketProduct.valid_days,
      ticketProduct.activation_days,
      Number(ticketProduct.transferable),
      ticketProduct.max_transfers,
      nullable(ticketProduct.terms_text),
      jsonDatabaseValue(ticketProduct.redemption_policy_json),
      ticketProduct.owner_user_id || null,
      provider?.username || (ticketProduct.owner_user_id ? null : 'LEADER'),
      Number(row.totalUses),
      Number(row.remainingUses),
      Number(row.remainingUses),
      row.status,
      mysqlDateTime(row.issuedAt),
      mysqlDate(row.activationDeadline),
      mysqlDateTime(row.activatedAt),
      mysqlDate(row.expiresAt),
      mysqlDateTime(row.pausedAt),
      nullable(row.pauseReason),
      row.transferable == null ? Number(ticketProduct.transferable) : (row.transferable ? 1 : 0),
    ];
    if (found.row) {
      id = Number(found.row.id);
      await connection.query(
        `UPDATE course_tickets
            SET user_id = ?, student_id = ?, owner_name = ?, owner_email = ?,
                product_id = ?, ticket_product_id = ?, order_id = ?,
                order_item_id = ?, product_code_snapshot = ?,
                product_name_snapshot = ?, product_class_count_snapshot = ?,
                product_valid_days_snapshot = ?, product_activation_days_snapshot = ?,
                product_transferable_snapshot = ?, product_max_transfers_snapshot = ?,
                product_terms_snapshot = ?, product_redemption_policy_snapshot = ?,
                provider_user_id_snapshot = ?, provider_name_snapshot = ?,
                total_uses = ?, remaining_uses = ?, remaining_uses_cache = ?,
                status = ?, issued_at = ?, activation_deadline = ?, activated_at = ?,
                expires_at = ?, paused_at = ?, pause_reason = ?, transferable = ?,
                row_version = row_version + 1
          WHERE id = ?`,
        [...ticketValues, id]
      );
    } else {
      const [result] = await connection.query(
        `INSERT INTO course_tickets
          (code, user_id, student_id, owner_name, owner_email, product_id,
           ticket_product_id, order_id, order_item_id, product_code_snapshot,
           product_name_snapshot, product_class_count_snapshot,
           product_valid_days_snapshot, product_activation_days_snapshot,
           product_transferable_snapshot, product_max_transfers_snapshot,
           product_terms_snapshot, product_redemption_policy_snapshot,
           provider_user_id_snapshot, provider_name_snapshot, total_uses,
           remaining_uses, remaining_uses_cache, status, issued_at,
           activation_deadline, activated_at, expires_at, paused_at,
           pause_reason, transferable, row_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [row.code, ...ticketValues]
      );
      id = Number(result.insertId);
      inserted = true;
      counters.inserted += 1;
    }
    await saveMapping(connection, {
      entityType: 'tickets',
      sourceId: row.sourceId,
      targetTable: 'course_tickets',
      targetId: id,
      sourceHash: hashValue(row),
      runId,
    });
    const ticket = {
      id,
      inserted,
      student_id: student.id,
      user_id: student.user_id,
      owner_email: row.ownerEmail || student.email,
      total_uses: row.totalUses,
      remaining_uses: row.remainingUses,
      ticket_product_id: ticketProduct.id,
    };
    lookups.tickets.set(row.sourceId, row.code, ticket);
  }
}

function resolvedSessionSettings(datasets, row) {
  const platform = (datasets.settings || []).find(
    (settings) => settings.scopeKey === 'platform'
  ) || {};
  const providerScope = row.ownerUserId ? `provider:${row.ownerUserId}` : null;
  const provider = providerScope
    ? (datasets.settings || []).find((settings) => settings.scopeKey === providerScope) || {}
    : {};
  const resolve = (field, fallback) => (
    row[field] ?? provider[field] ?? platform[field] ?? fallback
  );
  return {
    timezone: 'Asia/Taipei',
    bookingOpenMinutesBefore: resolve('bookingOpenMinutesBefore', 43200),
    bookingCloseMinutesBefore: resolve('bookingCloseMinutesBefore', 0),
    cancelCloseMinutesBefore: resolve('cancelCloseMinutesBefore', 0),
    redeemOpenMinutesBefore: resolve('redeemOpenMinutesBefore', 120),
    redeemCloseMinutesAfter: resolve('redeemCloseMinutesAfter', 1440),
    attendanceInviteExpiresMinutes:
      provider.attendanceInviteExpiresMinutes
      ?? platform.attendanceInviteExpiresMinutes
      ?? 1440,
    autoNoShow: Boolean(provider.autoNoShow ?? platform.autoNoShow ?? false),
    source: {
      providerScope,
      snapshot: 'gas_cutover',
    },
  };
}

async function materializeSessions(context) {
  const { connection, datasets, runId, lookups, counters } = context;
  for (const row of datasets.sessions || []) {
    const owner = await existingUser(connection, row.ownerUserId);
    const scenario = lookups.scenarios.code(row.scenarioCode);
    const product = lookups.shopProducts.code(row.productCode);
    const coach = lookups.coachProfiles.code(row.coachCode, owner?.id);
    if (!scenario) {
      throw materializeError(
        'GAS_REFERENCE_MISSING',
        `Session ${row.code} cannot resolve Scenario ${row.scenarioCode}.`
      );
    }
    const found = await mappedOrCode(connection, {
      entityType: 'sessions',
      sourceId: row.sourceId,
      table: 'course_sessions',
      code: row.code,
    });
    if (found.row && !found.mapped) {
      compatibility(
        mysqlDateTime(found.row.starts_at) === mysqlDateTime(row.startsAt)
          && mysqlDateTime(found.row.ends_at) === mysqlDateTime(row.endsAt)
          && String(found.row.status) === String(row.status),
        'session',
        row.code,
        { existing: found.row, source: row }
      );
    }
    const values = [
      owner?.id || null,
      product?.id || null,
      scenario.id,
      row.title,
      coach?.user_id || null,
      coach?.id || null,
      row.coachName || coach?.display_name || null,
      nullable(row.location),
      mysqlDateTime(row.startsAt),
      mysqlDateTime(row.endsAt),
      mysqlDateTime(row.bookingOpenAt),
      mysqlDateTime(row.bookingCloseAt),
      nullable(row.bookingOpenMinutesBefore),
      nullable(row.bookingCloseMinutesBefore),
      nullable(row.cancelCloseMinutesBefore),
      mysqlDateTime(row.redeemOpenAt),
      mysqlDateTime(row.redeemCloseAt),
      nullable(row.redeemOpenMinutesBefore),
      nullable(row.redeemCloseMinutesAfter),
      json(resolvedSessionSettings(datasets, row)),
      row.capacity ?? 20,
      nullable(row.notes),
      row.status,
    ];
    let id;
    if (found.row) {
      id = Number(found.row.id);
      await connection.query(
        `UPDATE course_sessions
            SET owner_user_id = ?, product_id = ?, scenario_id = ?, title = ?,
                coach_user_id = ?, coach_profile_id = ?, coach_name = ?,
                location = ?, starts_at = ?, ends_at = ?, booking_open_at = ?,
                booking_close_at = ?, booking_open_minutes_before = ?,
                booking_close_minutes_before = ?, cancel_close_minutes_before = ?,
                redeem_open_at = ?, redeem_close_at = ?,
                redeem_open_minutes_before = ?, redeem_close_minutes_after = ?,
                settings_snapshot_json = ?, capacity = ?, notes = ?, status = ?,
                row_version = row_version + 1
          WHERE id = ?`,
        [...values, id]
      );
    } else {
      const [result] = await connection.query(
        `INSERT INTO course_sessions
          (owner_user_id, code, product_id, scenario_id, title, coach_user_id,
           coach_profile_id, coach_name, location, starts_at, ends_at,
           booking_open_at, booking_close_at, booking_open_minutes_before,
           booking_close_minutes_before, cancel_close_minutes_before,
           redeem_open_at, redeem_close_at, redeem_open_minutes_before,
           redeem_close_minutes_after, settings_snapshot_json, capacity, notes,
           status, row_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [owner?.id || null, row.code, ...values.slice(1)]
      );
      id = Number(result.insertId);
      counters.inserted += 1;
    }
    await saveMapping(connection, {
      entityType: 'sessions',
      sourceId: row.sourceId,
      targetTable: 'course_sessions',
      targetId: id,
      sourceHash: hashValue(row),
      runId,
    });
    lookups.sessions.set(row.sourceId, row.code, {
      id,
      owner_user_id: owner?.id || null,
      starts_at: mysqlDateTime(row.startsAt),
      ends_at: mysqlDateTime(row.endsAt),
    });
  }
}

async function materializeBookings(context) {
  const { connection, datasets, runId, lookups, counters } = context;
  for (const row of datasets.rsvps || []) {
    const session = lookups.sessions.code(row.sessionCode);
    const student = lookups.students.source(row.studentSourceId);
    const ticket = lookups.tickets.code(row.ticketCode);
    const existingMapping = await mapping(connection, 'rsvps', row.sourceId);
    const [identityRows] = await connection.query(
      `SELECT * FROM course_bookings
        WHERE session_id = ? AND student_id = ?
        LIMIT 2 FOR UPDATE`,
      [session.id, student.id]
    );
    if (identityRows.length > 1) {
      throw materializeError(
        'GAS_DUPLICATE_SESSION_STUDENT_RSVP',
        `Session ${row.sessionCode} already has duplicate bookings for Student ${row.studentSourceId}.`
      );
    }
    let existing = null;
    if (existingMapping) {
      const [rows] = await connection.query(
        'SELECT * FROM course_bookings WHERE id = ? LIMIT 1 FOR UPDATE',
        [existingMapping.target_id]
      );
      if (!rows.length) {
        throw materializeError(
          'GAS_MAPPING_TARGET_MISSING',
          `rsvps:${row.sourceId} points to a missing course_bookings row.`
        );
      }
      existing = rows[0];
      if (
        Number(existing.session_id) !== Number(session.id)
        || Number(existing.student_id) !== Number(student.id)
      ) {
        throw materializeError(
          'GAS_RSVP_MAPPING_IDENTITY_CONFLICT',
          `RSVP ${row.sourceId} cannot move to another Session or Student.`
        );
      }
      if (
        identityRows.length
        && Number(identityRows[0].id) !== Number(existing.id)
      ) {
        throw materializeError(
          'GAS_DUPLICATE_SESSION_STUDENT_RSVP',
          `Session ${row.sessionCode} already has another booking for Student ${row.studentSourceId}.`
        );
      }
    } else {
      existing = identityRows[0] || null;
    }
    if (existing && !existingMapping) {
      compatibility(
        Number(existing.ticket_id || 0) === Number(ticket?.id || 0)
          && String(existing.status) === String(row.status),
        'rsvp',
        row.sourceId,
        { existing, source: row }
      );
    }
    const values = [
      session.id,
      ticket?.id || null,
      student.user_id || null,
      student.id,
      row.attendeeName || student.display_name,
      row.attendeeEmail || student.email,
      row.status,
      mysqlDateTime(row.bookedAt),
      mysqlDateTime(row.cancelledAt),
      mysqlDateTime(row.attendedAt),
      nullable(row.resolutionReason),
    ];
    let id;
    if (existing) {
      id = Number(existing.id);
      await connection.query(
        `UPDATE course_bookings
            SET session_id = ?, ticket_id = ?, user_id = ?, student_id = ?,
                attendee_name = ?, attendee_email = ?, status = ?, booked_at = ?,
                cancelled_at = ?, attended_at = ?, resolution_reason = ?,
                row_version = row_version + 1
          WHERE id = ?`,
        [...values, id]
      );
    } else {
      const [result] = await connection.query(
        `INSERT INTO course_bookings
          (session_id, ticket_id, user_id, student_id, attendee_name,
           attendee_email, verify_code, status, booked_at, cancelled_at,
           attended_at, resolution_reason, row_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          ...values.slice(0, 6),
          deterministicBookingCode(row.sourceId),
          ...values.slice(6),
        ]
      );
      id = Number(result.insertId);
      counters.inserted += 1;
    }
    await saveMapping(connection, {
      entityType: 'rsvps',
      sourceId: row.sourceId,
      targetTable: 'course_bookings',
      targetId: id,
      sourceHash: hashValue(row),
      runId,
    });
    lookups.rsvps.set(row.sourceId, null, {
      id,
      session_id: session.id,
      ticket_id: ticket?.id || null,
      student_id: student.id,
      user_id: student.user_id,
      status: row.status,
    });
  }
}

async function insertUsageEvent(context, row, reversesEventId = null) {
  const { connection, runId, lookups, counters } = context;
  const ticket = lookups.tickets.code(row.ticketCode);
  const session = lookups.sessions.code(row.sessionCode);
  const booking = lookups.rsvps.source(row.rsvpSourceId);
  const student = row.studentSourceId
    ? lookups.students.source(row.studentSourceId)
    : (ticket ? { id: ticket.student_id, user_id: ticket.user_id } : null);
  const actor = await userByEmail(connection, row.staffEmail);
  const existing = await mapping(connection, 'redeemLogs', row.sourceId);
  if (existing) {
    lookups.redeemLogs.set(row.sourceId, null, { id: Number(existing.target_id) });
    return;
  }
  if (ticket && !ticket.inserted) {
    const [matches] = await connection.query(
      `SELECT id
         FROM course_usage_events
        WHERE ticket_id = ?
          AND event_type = ?
          AND delta_uses = ?
          AND session_id <=> ?
          AND booking_id <=> ?
          AND reverses_event_id <=> ?
          AND occurred_at = ?
        LIMIT 2
        FOR UPDATE`,
      [
        ticket.id,
        row.eventType,
        Number(row.deltaUses),
        session?.id || null,
        booking?.id || null,
        reversesEventId,
        mysqlDateTime(row.occurredAt),
      ]
    );
    if (matches.length !== 1) {
      throw materializeError(
        'GAS_USAGE_MATCH_CONFLICT',
        `Usage ${row.sourceId} must match exactly one existing immutable event for ticket ${row.ticketCode}.`,
        { matchCount: matches.length }
      );
    }
    const id = Number(matches[0].id);
    await saveMapping(connection, {
      entityType: 'redeemLogs',
      sourceId: row.sourceId,
      targetTable: 'course_usage_events',
      targetId: id,
      sourceHash: hashValue(row),
      runId,
    });
    lookups.redeemLogs.set(row.sourceId, null, { id });
    return;
  }
  let balanceAfter = 0;
  if (ticket) {
    const [[balance]] = await connection.query(
      `SELECT COALESCE(SUM(delta_uses), 0) AS current_balance
         FROM course_usage_events
        WHERE ticket_id = ?`,
      [ticket.id]
    );
    balanceAfter = Number(balance.current_balance) + Number(row.deltaUses);
    if (balanceAfter < 0) {
      throw materializeError(
        'GAS_USAGE_NEGATIVE_RUNNING_BALANCE',
        `Usage ${row.sourceId} would make ticket ${row.ticketCode} negative.`
      );
    }
  }
  const [result] = await connection.query(
    `INSERT INTO course_usage_events
      (ticket_id, student_id, user_id, session_id, booking_id, event_type,
       delta_uses, balance_after, source_type, source_id, reverses_event_id,
       idempotency_key, is_anomaly, occurred_at, actor_user_id, note, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'gas', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ticket?.id || null,
      student?.id || null,
      student?.user_id || null,
      session?.id || null,
      booking?.id || null,
      row.eventType,
      Number(row.deltaUses),
      balanceAfter,
      String(row.sourceId),
      reversesEventId,
      deterministicIdempotency(row.sourceId),
      row.eventType === 'NO_SHOW' && !ticket ? 1 : 0,
      mysqlDateTime(row.occurredAt),
      actor?.id || null,
      nullable(row.note),
      json(row.metadata),
    ]
  );
  const id = Number(result.insertId);
  counters.inserted += 1;
  await saveMapping(connection, {
    entityType: 'redeemLogs',
    sourceId: row.sourceId,
    targetTable: 'course_usage_events',
    targetId: id,
    sourceHash: hashValue(row),
    runId,
  });
  lookups.redeemLogs.set(row.sourceId, null, { id });
}

async function materializeUsage(context) {
  const { connection, datasets, runId, lookups, counters } = context;
  const ticketsWithSourceIssuance = new Set(
    (datasets.redeemLogs || [])
      .filter((row) => row.eventType === 'ISSUANCE' && row.ticketCode)
      .map((row) => normalizeCode(row.ticketCode))
  );
  for (const row of datasets.tickets || []) {
    const ticket = lookups.tickets.source(row.sourceId);
    if (ticketsWithSourceIssuance.has(normalizeCode(row.code))) continue;
    const sourceId = `ticket:${row.sourceId}`;
    const existingMapping = await mapping(connection, 'syntheticIssuance', row.sourceId);
    let eventId = existingMapping ? Number(existingMapping.target_id) : null;
    if (!eventId && !ticket.inserted) {
      const [matches] = await connection.query(
        `SELECT id
           FROM course_usage_events
          WHERE ticket_id = ?
            AND event_type = 'ISSUANCE'
            AND delta_uses = ?
            AND occurred_at = ?
          LIMIT 2
          FOR UPDATE`,
        [ticket.id, Number(row.totalUses), mysqlDateTime(row.issuedAt)]
      );
      if (matches.length !== 1) {
        throw materializeError(
          'GAS_ISSUANCE_MATCH_CONFLICT',
          `Ticket ${row.code} must match exactly one existing issuance event.`,
          { matchCount: matches.length }
        );
      }
      eventId = Number(matches[0].id);
    }
    if (!eventId) {
      const [result] = await connection.query(
        `INSERT INTO course_usage_events
          (ticket_id, student_id, user_id, event_type, delta_uses, balance_after,
           source_type, source_id, idempotency_key, occurred_at, note)
         VALUES (?, ?, ?, 'ISSUANCE', ?, ?, 'gas_ticket', ?, ?, ?, ?)`,
        [
          ticket.id,
          ticket.student_id,
          ticket.user_id || null,
          Number(row.totalUses),
          Number(row.totalUses),
          sourceId,
          deterministicIdempotency(sourceId),
          mysqlDateTime(row.issuedAt),
          'GAS ticket issuance materialization.',
        ]
      );
      eventId = Number(result.insertId);
      counters.inserted += 1;
    }
    await saveMapping(connection, {
      entityType: 'syntheticIssuance',
      sourceId: row.sourceId,
      targetTable: 'course_usage_events',
      targetId: eventId,
      sourceHash: hashValue({ ticketSourceId: row.sourceId, totalUses: row.totalUses }),
      runId,
    });
  }

  const pending = [...(datasets.redeemLogs || [])].sort((left, right) => (
    mysqlDateTime(left.occurredAt).localeCompare(mysqlDateTime(right.occurredAt))
    || String(left.sourceId).localeCompare(String(right.sourceId))
  ));
  while (pending.length) {
    let progressed = false;
    for (let index = 0; index < pending.length;) {
      const row = pending[index];
      const reversed = row.reversesSourceId
        ? lookups.redeemLogs.source(row.reversesSourceId)
        : null;
      if (row.reversesSourceId && !reversed) {
        index += 1;
        continue;
      }
      await insertUsageEvent(context, row, reversed?.id || null);
      pending.splice(index, 1);
      progressed = true;
    }
    if (!progressed) {
      throw materializeError(
        'GAS_REVERSAL_SOURCE_MISSING',
        `Usage reversal dependencies are cyclic or missing: ${pending.map((row) => row.sourceId).join(', ')}.`
      );
    }
  }

  for (const row of datasets.tickets || []) {
    const ticket = lookups.tickets.source(row.sourceId);
    const [[ledger]] = await connection.query(
      `SELECT COALESCE(SUM(delta_uses), 0) AS balance
         FROM course_usage_events
        WHERE ticket_id = ?`,
      [ticket.id]
    );
    await connection.query(
      `UPDATE course_tickets
          SET remaining_uses = ?,
              remaining_uses_cache = ?,
              row_version = row_version + 1
        WHERE id = ?`,
      [Number(ledger.balance), Number(ledger.balance), ticket.id]
    );
  }
}

async function materializeHolds(context) {
  const { connection, datasets, lookups, counters } = context;
  for (const row of datasets.rsvps || []) {
    if (row.status !== 'booked' || !row.ticketCode) continue;
    const booking = lookups.rsvps.source(row.sourceId);
    const ticket = lookups.tickets.code(row.ticketCode);
    const [holds] = await connection.query(
      `SELECT id FROM course_ticket_holds
        WHERE booking_id = ? AND status = 'active'
        LIMIT 1 FOR UPDATE`,
      [booking.id]
    );
    if (holds.length) continue;
    const [[balance]] = await connection.query(
      `SELECT t.remaining_uses_cache -
              COALESCE(SUM(CASE WHEN h.status = 'active' THEN h.quantity ELSE 0 END), 0)
              AS available_uses
         FROM course_tickets t
         LEFT JOIN course_ticket_holds h ON h.ticket_id = t.id
        WHERE t.id = ?
        GROUP BY t.id, t.remaining_uses_cache`,
      [ticket.id]
    );
    if (Number(balance.available_uses) < 1) {
      throw materializeError(
        'GAS_HOLD_BALANCE_CONFLICT',
        `Booked RSVP ${row.sourceId} cannot reserve ticket ${row.ticketCode}.`
      );
    }
    await connection.query(
      `INSERT INTO course_ticket_holds
        (ticket_id, booking_id, quantity, status, row_version)
       VALUES (?, ?, 1, 'active', 1)`,
      [ticket.id, booking.id]
    );
    counters.inserted += 1;
  }
}

async function materializeInvites(context) {
  const { connection, datasets, runId, lookups, counters } = context;
  for (const row of datasets.attendanceInvites || []) {
    const session = lookups.sessions.code(row.sessionCode);
    const student = lookups.students.source(row.studentSourceId);
    const ticket = lookups.tickets.code(row.ticketCode);
    const booking = lookups.rsvps.source(row.rsvpSourceId);
    const redeemed = lookups.redeemLogs.source(row.redeemedUsageSourceId);
    const existingMapping = await mapping(connection, 'attendanceInvites', row.sourceId);
    let existing = null;
    if (existingMapping) {
      const [rows] = await connection.query(
        'SELECT * FROM course_attendance_invites WHERE id = ? LIMIT 1 FOR UPDATE',
        [existingMapping.target_id]
      );
      existing = rows[0] || null;
    }
    let holdId = null;
    if (row.status === 'pending' && ticket) {
      if (booking) {
        const [holds] = await connection.query(
          `SELECT id FROM course_ticket_holds
            WHERE booking_id = ? AND status = 'active' LIMIT 1 FOR UPDATE`,
          [booking.id]
        );
        holdId = holds[0]?.id || null;
      }
      if (!holdId && existing?.hold_id) holdId = existing.hold_id;
    }
    const values = [
      session.owner_user_id || null,
      session.id,
      booking?.id || null,
      student.id,
      student.user_id || null,
      ticket?.id || null,
      holdId,
      row.tokenHash || crypto.createHash('sha256').update(`closed:${row.sourceId}`).digest('hex'),
      row.status,
      mysqlDateTime(row.expiresAt),
      mysqlDateTime(row.autoRedeemAt),
      mysqlDateTime(row.confirmedAt),
      redeemed?.id || null,
      nullable(row.note),
    ];
    let id;
    if (existing) {
      id = Number(existing.id);
      await connection.query(
        `UPDATE course_attendance_invites
            SET owner_user_id = ?, session_id = ?, booking_id = ?,
                student_id = ?, user_id = ?, ticket_id = ?, hold_id = ?,
                token_hash = ?, status = ?, expires_at = ?, auto_redeem_at = ?,
                confirmed_at = ?, redeemed_usage_event_id = ?, note = ?,
                row_version = row_version + 1
          WHERE id = ?`,
        [...values, id]
      );
    } else {
      const [result] = await connection.query(
        `INSERT INTO course_attendance_invites
          (owner_user_id, session_id, booking_id, student_id, user_id,
           ticket_id, hold_id, token_hash, status, expires_at, auto_redeem_at,
           confirmed_at, redeemed_usage_event_id, note, row_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        values
      );
      id = Number(result.insertId);
      counters.inserted += 1;
    }
    if (row.status === 'pending' && ticket && !holdId) {
      const [[balance]] = await connection.query(
        `SELECT t.remaining_uses_cache -
                COALESCE(SUM(CASE WHEN h.status = 'active' THEN h.quantity ELSE 0 END), 0)
                AS available_uses
           FROM course_tickets t
           LEFT JOIN course_ticket_holds h ON h.ticket_id = t.id
          WHERE t.id = ?
          GROUP BY t.id, t.remaining_uses_cache`,
        [ticket.id]
      );
      if (Number(balance.available_uses) < 1) {
        throw materializeError(
          'GAS_INVITE_HOLD_BALANCE_CONFLICT',
          `Pending invite ${row.sourceId} cannot reserve ticket ${row.ticketCode}.`
        );
      }
      const [hold] = await connection.query(
        `INSERT INTO course_ticket_holds
          (ticket_id, invite_id, quantity, status, expires_at, row_version)
         VALUES (?, ?, 1, 'active', ?, 1)`,
        [ticket.id, id, mysqlDateTime(row.expiresAt)]
      );
      holdId = Number(hold.insertId);
      await connection.query(
        'UPDATE course_attendance_invites SET hold_id = ? WHERE id = ?',
        [holdId, id]
      );
    } else if (row.status !== 'pending' && existing?.hold_id) {
      await connection.query(
        `UPDATE course_ticket_holds
            SET status = 'released',
                released_at = COALESCE(released_at, NOW()),
                release_reason = COALESCE(release_reason, 'gas_invite_not_pending'),
                row_version = row_version + 1
          WHERE id = ? AND status = 'active'`,
        [existing.hold_id]
      );
    } else if (holdId) {
      await connection.query(
        'UPDATE course_ticket_holds SET invite_id = ?, row_version = row_version + 1 WHERE id = ?',
        [id, holdId]
      );
    }
    await saveMapping(connection, {
      entityType: 'attendanceInvites',
      sourceId: row.sourceId,
      targetTable: 'course_attendance_invites',
      targetId: id,
      sourceHash: hashValue(row),
      runId,
    });
    lookups.attendanceInvites.set(row.sourceId, null, { id });
  }
}

async function assertMaterializedBalances(context) {
  const { connection, datasets, lookups } = context;
  for (const row of datasets.tickets || []) {
    const ticket = lookups.tickets.source(row.sourceId);
    const [[result]] = await connection.query(
      `SELECT t.remaining_uses_cache AS cached,
              COALESCE(SUM(e.delta_uses), 0) AS ledger,
              COALESCE(SUM(CASE WHEN e.id IS NOT NULL AND e.balance_after IS NULL THEN 1 ELSE 0 END), 0)
                AS null_balances,
              COALESCE((
                SELECT SUM(h.quantity) FROM course_ticket_holds h
                 WHERE h.ticket_id = t.id AND h.status = 'active'
              ), 0) AS held
         FROM course_tickets t
         LEFT JOIN course_usage_events e ON e.ticket_id = t.id
        WHERE t.id = ?
        GROUP BY t.id, t.remaining_uses_cache`,
      [ticket.id]
    );
    if (
      Number(result.cached) !== Number(row.remainingUses)
      || Number(result.ledger) !== Number(row.remainingUses)
      || Number(result.null_balances) !== 0
      || Number(result.cached) - Number(result.held) < 0
    ) {
      throw materializeError(
        'GAS_MATERIALIZED_BALANCE_MISMATCH',
        `Ticket ${row.code} failed ledger/hold reconciliation.`,
        { sourceRemaining: row.remainingUses, ...result }
      );
    }
  }
}

async function materializeSnapshot(connection, {
  snapshot,
  validation,
  runId,
  snapshotHash,
}) {
  const context = {
    connection,
    datasets: validation.datasets,
    runId,
    snapshotHash,
    counters: { inserted: 0 },
    lookups: {
      students: createLookup(),
      ticketProducts: createLookup(),
      shopProducts: createLookup(),
      scenarios: createLookup(),
      staff: createLookup(),
      coachProfiles: createLookup(),
      settings: createLookup(),
      orders: createLookup(),
      orderItems: createLookup(),
      tickets: createLookup(),
      sessions: createLookup(),
      rsvps: createLookup(),
      redeemLogs: createLookup(),
      attendanceInvites: createLookup(),
    },
  };

  await materializeStudents(context);
  await materializeTicketProducts(context);
  await materializeShopProducts(context);
  await materializeScenarios(context);
  await materializeStaffAndCoaches(context);
  await materializeSettings(context);
  await materializeOrders(context);
  await materializeTickets(context);
  await materializeSessions(context);
  await materializeBookings(context);
  await materializeUsage(context);
  await materializeHolds(context);
  await materializeInvites(context);
  await assertMaterializedBalances(context);

  return {
    insertedRows: context.counters.inserted,
    mappedSourceRows: buildStagingRows(validation).length,
  };
}

module.exports = {
  materializeSnapshot,
  mysqlDate,
  mysqlDateTime,
};
