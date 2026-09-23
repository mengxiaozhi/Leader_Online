'use strict';
const { q, scopeRow } = require('./schema');
function targetFor(req) {
  const route = String(req.route?.path || '');
  const course = route.includes('/courses/');
  const names = course ? {
    products: 'course_products', sessions: 'course_sessions', orders: 'course_orders', tickets: 'course_tickets',
    bookings: 'course_bookings', terms: 'course_terms', programs: 'course_programs', students: 'course_students',
    enrollments: 'course_term_enrollments', 'staff-memberships': 'course_staff_memberships',
  } : { users: 'users', drivers: 'users', products: 'products', events: 'events', stores: 'event_stores',
    reservations: 'reservations', tickets: 'tickets', orders: 'orders', 'delivery-points': 'delivery_points' };
  const parts = route.split('/');
  let target = null;
  for (let i = 0; i < parts.length; i++) {
    if (names[parts[i]]) target = { table: names[parts[i]], id: parts[i + 1]?.startsWith(':') ? req.params?.[parts[i + 1].slice(1)] : null };
  }
  return target;
}
function code(value) { return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,99}$/.test(value) ? value : null; }
async function recordOutcomes(connection, tables, requestId, req, json, failed) {
  const target = targetFor(req);
  if (!target || !tables.has(target.table)) return;
  const columns = tables.get(target.table);
  if (!columns.some(c => c.COLUMN_NAME === 'id')) return;
  let entries = Array.isArray(json?.data?.items) ? json.data.items : Array.isArray(json?.data?.results) ? json.data.results : null;
  entries = entries?.filter(item => item && (typeof item.ok === 'boolean' || typeof item.success === 'boolean'));
  if (!entries?.length) {
    if (!target.id) return;
    const [rows] = await connection.query('SELECT 1 FROM admin_audit_changes WHERE request_id=? LIMIT 1', [requestId]);
    if (rows.length) return;
    entries = [{ id: target.id, ok: !failed }];
  }
  for (const entry of entries.slice(0, 500)) {
    const id = String(entry.id ?? entry.orderId ?? entry.resourceId ?? '');
    if (!id || id.length > 255) continue;
    const [rows] = await connection.query(`SELECT ${scopeRow(target.table, columns, 'r', tables)} AS scope FROM ${q(target.table)} r WHERE id=? LIMIT 1`, [id]);
    const scope = rows[0]?.scope;
    const failedItem = entry.ok === false || entry.success === false;
    const operation = failedItem ? 'FAILED' : entry.replayed ? 'REPLAY' : /\/export(?:\/|$)/.test(req.path) ? 'EXPORT' : 'ATTEMPT';
    const [insert] = await connection.query(`INSERT INTO admin_audit_changes
      (request_id,resource_table,resource_id,operation,error_code) VALUES(?,?,?,?,?)`,
    [requestId, target.table, id, operation, code(entry.error?.code || (failed ? json?.code : null))]);
    await connection.query('INSERT INTO admin_audit_scopes(change_id,request_id,before_scope,after_scope) VALUES(?,?,?,?)',
      [insert.insertId, requestId, scope == null ? null : typeof scope === 'string' ? scope : JSON.stringify(scope), scope == null ? null : typeof scope === 'string' ? scope : JSON.stringify(scope)]);
  }
}
module.exports = { targetFor, recordOutcomes };
