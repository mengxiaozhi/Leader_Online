'use strict';
const { createHash } = require('crypto');
// Explicit scalar allowlist. Never persist arbitrary request bodies, JSON business
// blobs, credentials, contact/address/banking fields, or binary uploads.
const SAFE = new Set(('id role action status payment_status fulfillment_status name title listing_status '
  + 'price quantity amount total subtotal total_amount unit_price discount ticket_discount max_purchase_quantity '
  + 'used expiry voided_at type ticket_type provider_id capacity remaining_count total_count used_count is_active is_vip is_exclusive '
  + 'starts_at ends_at start_date end_date deadline created_at updated_at row_version '
  + 'owner_user_id provider_user_id user_id event_id store_id product_id ticket_id order_id '
  + 'reservation_id session_id booking_id term_id program_id enrollment_id student_id '
  + 'driver_id delivery_point_id coach_user_id coach_profile_id staff_user_id assigned_by '
  + 'ticket_product_id course_product_id attendance_status resolution_type payment_method '
  + 'published_at cancelled_at redeemed_at checked_in_at').split(' '));
const SCOPE = new Set(['owner_user_id', 'provider_user_id', 'event_id', 'store_id', 'product_id',
  'reservation_id', 'session_id', 'booking_id', 'term_id', 'program_id', 'ticket_id', 'order_id',
  'driver_id', 'delivery_point_id', 'coach_user_id', 'coach_profile_id', 'provider_id']);
const q = name => '`' + String(name).replace(/`/g, '``') + '`';
const literal = value => "'" + String(value).replace(/'/g, "''") + "'";
function triggerName(table, operation) {
  return `audit_${createHash('sha256').update(table).digest('hex').slice(0, 20)}_${operation.toLowerCase()}`;
}
function jsonRow(columns, prefix, whitelist) {
  const fields = columns.filter(c => whitelist.has(c.COLUMN_NAME)
    && !['blob', 'mediumblob', 'longblob', 'binary', 'varbinary', 'json'].includes(c.DATA_TYPE));
  return `JSON_OBJECT(${fields.map(c => `${literal(c.COLUMN_NAME)}, ${prefix}.${q(c.COLUMN_NAME)}`).join(', ')})`;
}
// Derive historical ownership from actual related rows, never from client claims.
function parentLinks(table) {
  return table.startsWith('course_')
    ? [['booking_id', 'course_bookings'], ['session_id', 'course_sessions'], ['term_id', 'course_terms'],
      ['program_id', 'course_programs'], ['ticket_id', 'course_tickets'], ['order_id', 'course_orders'],
      ['ticket_product_id', 'course_ticket_products'], ['product_id', 'course_products']]
    : [['reservation_id', 'reservations'], ['store_id', 'event_stores'], ['event_id', 'events'],
      ['product_id', 'products'], ['ticket_id', 'tickets'], ['order_id', 'orders']];
}
function inherited(table, columns, prefix, field, tables, seen = []) {
  if (columns.some(c => c.COLUMN_NAME === field)) return `${prefix}.${q(field)}`;
  if (seen.length > 5 || seen.includes(table)) return 'NULL';
  const candidates = [];
  for (const [key, parent] of parentLinks(table)) {
    if (!columns.some(c => c.COLUMN_NAME === key) || !tables.has(parent) || seen.includes(parent)) continue;
    const alias = `audit_parent_${seen.length}_${candidates.length}`;
    const parentColumns = tables.get(parent);
    if (!parentColumns.some(c => c.COLUMN_NAME === 'id')) continue;
    const expression = inherited(parent, parentColumns, alias, field, tables, [...seen, table]);
    if (expression !== 'NULL') candidates.push(`(SELECT ${expression} FROM ${q(parent)} ${alias} WHERE ${alias}.id=${prefix}.${q(key)} LIMIT 1)`);
  }
  return candidates.length ? `COALESCE(${candidates.join(', ')},NULL)` : 'NULL';
}
function scopeRow(table, columns, prefix, tables) {
  const base = jsonRow(columns, prefix, SCOPE);
  const owner = inherited(table, columns, prefix, 'owner_user_id', tables);
  const coach = inherited(table, columns, prefix, 'coach_user_id', tables);
  const extra = [];
  const coachProfile = inherited(table, columns, prefix, 'coach_profile_id', tables);
  if (coachProfile !== 'NULL' && tables.has('course_coach_profiles')) {
    extra.push(`'$.resolved_coach_profile_user_id', (SELECT user_id FROM course_coach_profiles WHERE id=${coachProfile} LIMIT 1)`);
  }
  const point = table === 'delivery_points' ? `${prefix}.id` : inherited(table, columns, prefix, 'delivery_point_id', tables);
  if (point !== 'NULL' && tables.has('delivery_points')) {
    extra.push(`'$.resolved_delivery_point_owner_id', (SELECT owner_user_id FROM delivery_points WHERE id=${point} LIMIT 1)`);
  }
  // A single historical task driver is unambiguous. Multiple assignees stay
  // admin-only unless a direct driver assignment proves access.
  const reservation = table === 'reservations' ? `${prefix}.id` : inherited(table, columns, prefix, 'reservation_id', tables);
  if (table !== 'reservation_tasks' && reservation !== 'NULL' && tables.has('reservation_tasks')) {
    extra.push(`'$.resolved_task_driver_id', (SELECT IF(COUNT(DISTINCT assignee_user_id)=1,MIN(assignee_user_id),NULL) FROM reservation_tasks WHERE reservation_id=${reservation} AND UPPER(assignee_role)='DRIVER' AND UPPER(COALESCE(status,'OPEN')) <> 'CANCELLED')`);
  }
  if (table === 'orders' && columns.some(c => c.COLUMN_NAME === 'details')) {
    const json = path => `JSON_UNQUOTE(JSON_EXTRACT(${prefix}.details, '$.${path}'))`;
    if (tables.get('events')?.some(c => c.COLUMN_NAME === 'owner_user_id')) {
      extra.push(`'$.order_event_owner_id', (SELECT owner_user_id FROM events WHERE id=COALESCE(${json('event.id')},${json('event_id')},${json('eventId')}) LIMIT 1)`);
    }
    if (tables.get('products')?.some(c => c.COLUMN_NAME === 'owner_user_id')) {
      extra.push(`'$.order_product_owner_id', (SELECT owner_user_id FROM products WHERE id=COALESCE(${json('productId')},${json('product_id')},${json('product.id')}) LIMIT 1)`);
    }
    if (tables.get('event_stores')?.some(c => c.COLUMN_NAME === 'owner_user_id')) {
      const paths = ['selections[*].storeId', 'selections[*].store_id', 'selections[*].storeID',
        'serviceSelections[*].storeId', 'serviceSelections[*].store_id', 'serviceSelections[*].storeID',
        'serviceSelection.storeId', 'serviceSelection.store_id', 'serviceSelection.storeID'];
      const ids = `JSON_MERGE(JSON_ARRAY(), ${paths.map(path => `COALESCE(JSON_EXTRACT(${prefix}.details, '$.${path}'),JSON_ARRAY())`).join(', ')})`;
      extra.push(`'$.order_store_owner_id', (SELECT IF(COUNT(DISTINCT owner_user_id)=1 AND COUNT(*)=JSON_LENGTH(${ids}),MIN(owner_user_id),NULL) FROM event_stores WHERE JSON_CONTAINS(${ids},CAST(id AS CHAR)) OR JSON_CONTAINS(${ids},JSON_QUOTE(CAST(id AS CHAR))))`);
    }
  }
  return `JSON_SET(${base}, '$.resolved_owner_id', ${owner}, '$.resolved_coach_id', ${coach}, '$.resolved_driver_id', ${inherited(table, columns, prefix, 'driver_id', tables)}, '$.resolved_delivery_point_id', ${inherited(table, columns, prefix, 'delivery_point_id', tables)}${extra.length ? ', ' + extra.join(', ') : ''})`;
}

function snapshot(table, columns, prefix) {
  const base = jsonRow(columns, prefix, SAFE);
  if (table !== 'orders' || !columns.some(c => c.COLUMN_NAME === 'details')) return base;
  const fields = ['total', 'subtotal', 'discount', 'quantity'];
  return `JSON_SET(${base}, ${fields.map(field => {
    const value = `JSON_EXTRACT(${prefix}.details, '$.${field}')`;
    return `'$.${field}', IF(JSON_TYPE(${value}) IN ('INTEGER','DOUBLE','DECIMAL'), ${value}, NULL)`;
  }).join(', ')})`;
}
function buildTriggers(table, columns, tables = new Map()) {
  if (columns.some(c => c.ENGINE && c.ENGINE !== 'InnoDB')) throw new Error(`Audit requires InnoDB: ${table}`);
  const keys = columns.filter(c => c.COLUMN_KEY === 'PRI');
  if (!keys.length) throw new Error(`Audit requires a primary key: ${table}`);
  return ['INSERT', 'UPDATE', 'DELETE'].map(operation => {
    const row = operation === 'DELETE' ? 'OLD' : 'NEW';
    const before = operation === 'INSERT' ? 'NULL' : snapshot(table, columns, 'OLD');
    const after = operation === 'DELETE' ? 'NULL' : snapshot(table, columns, 'NEW');
    const beforeScope = operation === 'INSERT' ? 'NULL' : scopeRow(table, columns, 'OLD', tables);
    const afterScope = operation === 'DELETE' ? 'NULL' : scopeRow(table, columns, 'NEW', tables);
    const rawResourceId = `CONCAT_WS(':', ${keys.map(c => `CAST(${row}.${q(c.COLUMN_NAME)} AS CHAR)`).join(', ')})`;
    const resourceId = keys.some(c => /token|secret|password|code|hash|request_key/i.test(c.COLUMN_NAME)) ? `SHA2(${rawResourceId},256)` : rawResourceId;
    const changedFields = `JSON_ARRAY(${columns.map(c => operation === 'UPDATE'
      ? `IF(NOT(OLD.${q(c.COLUMN_NAME)} <=> NEW.${q(c.COLUMN_NAME)}),${literal(c.COLUMN_NAME)},NULL)`
      : literal(c.COLUMN_NAME)).join(',')})`;
    const name = triggerName(table, operation);
    const changedCondition = operation === 'UPDATE' ? ' AND (' + columns.map(c => `NOT(OLD.${q(c.COLUMN_NAME)} <=> NEW.${q(c.COLUMN_NAME)})`).join(' OR ') + ')' : '';
    const body = `BEGIN
      DECLARE change_id BIGINT UNSIGNED;
      DECLARE EXIT HANDLER FOR SQLEXCEPTION
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUDIT_LOG_UNAVAILABLE';
      IF @leader_audit_request IS NOT NULL${changedCondition} THEN
        INSERT INTO admin_audit_changes
          (request_id,resource_table,resource_id,operation,before_json,after_json,changed_fields)
          VALUES (@leader_audit_request,${literal(table)},${resourceId},${literal(operation)},${before},${after},${changedFields});
        SET change_id = LAST_INSERT_ID();
        INSERT INTO admin_audit_scopes(change_id,request_id,before_scope,after_scope)
          VALUES(change_id,@leader_audit_request,${beforeScope},${afterScope});
      END IF;
    END`;
    return { name, table, operation, body, sql: `CREATE TRIGGER ${q(name)} AFTER ${operation} ON ${q(table)} FOR EACH ROW ${body}` };
  });
}
async function inventory(db) {
  const [columns] = await db.query(`SELECT c.TABLE_NAME,c.COLUMN_NAME,c.COLUMN_KEY,c.DATA_TYPE,t.ENGINE
    FROM information_schema.COLUMNS c JOIN information_schema.TABLES t
      ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME
    WHERE c.TABLE_SCHEMA=DATABASE() AND t.TABLE_TYPE='BASE TABLE'
      AND c.TABLE_NAME NOT LIKE 'admin\\_audit\\_%'
    ORDER BY c.TABLE_NAME,c.ORDINAL_POSITION`);
  const tables = new Map();
  for (const column of columns) {
    if (!tables.has(column.TABLE_NAME)) tables.set(column.TABLE_NAME, []);
    tables.get(column.TABLE_NAME).push(column);
  }
  return tables;
}
async function assertSchema(db) {
  for (const table of ['requests', 'changes', 'scopes', 'jobs']) {
    await db.query(`SELECT 1 FROM admin_audit_${table} LIMIT 0`);
  }
  const tables = await inventory(db);
  const [triggers] = await db.query(`SELECT TRIGGER_NAME,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()`);
  const found = new Map(triggers.map(t => [t.TRIGGER_NAME, t.ACTION_STATEMENT.replace(/\s+/g, ' ').trim()]));
  for (const [table, columns] of tables) {
    for (const trigger of buildTriggers(table, columns, tables)) {
      if (found.get(trigger.name) !== trigger.body.replace(/\s+/g, ' ').trim()) {
        throw new Error(`Audit trigger missing or stale: ${table}/${trigger.operation}`);
      }
    }
  }
  return tables;
}
module.exports = { scopeRow, parentLinks, SAFE, SCOPE, q, buildTriggers, triggerName, inventory, assertSchema };
