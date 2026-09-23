'use strict';
const { q, scopeRow, SAFE } = require('./schema');
const { resolveCourseCapabilities } = require('../course-v2-policy');
const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value || {}; } catch (_) { return {}; } };
function capabilityFor(table) {
  if (/staff|coach_profile/.test(table)) return 'manageStaff';
  if (/setting|polic|notification/.test(table)) return 'manageSettings';
  if (table === 'course_sessions' || /booking|attendance|usage_event/.test(table)) return 'manageAttendance';
  if (/ticket|order|payment|enrollment|entitlement|leave|makeup/.test(table)) return 'manageTicketExceptions';
  return 'manageCatalog';
}
function same(a, b) { return a != null && b != null && String(a) === String(b); }
async function canReadChange(ctx, user, change) {
  if (String(user.role).toUpperCase() === 'ADMIN') return true;
  const columns = ctx.audit.tables.get(change.resource_table);
  const keys = columns?.filter(c => c.COLUMN_KEY === 'PRI');
  if (!keys?.length || change.operation === 'DELETE') return false;
  const ids = String(change.resource_id).split(':');
  if (ids.length !== keys.length) return false;
  const [rows] = await ctx.audit.raw.query(`SELECT ${scopeRow(change.resource_table, columns, 'r', ctx.audit.tables)} AS scope
    FROM ${q(change.resource_table)} r WHERE ${keys.map(c => `r.${q(c.COLUMN_NAME)}=?`).join(' AND ')} LIMIT 1`, ids);
  if (!rows.length) return false;
  const live = parse(rows[0].scope);
  const old = parse(change.before_scope);
  const now = parse(change.after_scope);
  const snapshots = change.operation === 'INSERT' ? [now] : [old, now];
  const role = String(user.role).toUpperCase();
  const course = change.resource_table.startsWith('course_');
  // Access must exist both at the time of the operation and now. Ownership
  // transfers intentionally hide that transition from non-admin readers.
  if (course) {
    if (!live.resolved_owner_id || !snapshots.every(s => same(s.resolved_owner_id, live.resolved_owner_id))) return false;
    if (['SERVICE_PROVIDER', 'STORE'].includes(role)) return same(user.id, live.resolved_owner_id);
    const [members] = await ctx.audit.raw.query("SELECT * FROM course_staff_memberships WHERE user_id=? AND owner_user_id=? AND status='active' LIMIT 1", [user.id, live.resolved_owner_id]);
    const coachMatches = scope => ['resolved_coach_id', 'resolved_coach_profile_user_id'].some(key => same(scope[key], user.id));
    const assignedCoach = coachMatches(live) && snapshots.every(coachMatches);
    return Boolean(resolveCourseCapabilities({ platformRole: role, membership: members[0], assignedCoach })[capabilityFor(change.resource_table)]);
  }
  if (change.resource_table === 'users' && same(change.resource_id, user.id)) return true;
  if (role === 'DELIVERY_POINT' && ['delivery_points', 'delivery_point_provider_bindings'].includes(change.resource_table)) {
    return same(live.resolved_delivery_point_owner_id, user.id) && snapshots.every(s => same(s.resolved_delivery_point_owner_id, user.id));
  }
  if (role === 'EDITOR') return ['products', 'events', 'event_service_prices', 'event_stores', 'store_templates'].includes(change.resource_table);
  if (['SERVICE_PROVIDER', 'STORE', 'COACH'].includes(role)) {
    if (same(live.resolved_owner_id, user.id) && snapshots.every(s => same(s.resolved_owner_id, user.id))) return true;
    if (change.resource_table === 'orders' && ['order_event_owner_id', 'order_product_owner_id', 'order_store_owner_id'].some(key => same(live[key], user.id) && snapshots.every(s => same(s[key], user.id)))) return true;
    if (change.resource_table === 'users' && same(live.provider_id, user.id) && snapshots.every(s => same(s.provider_id, user.id))) return true;
  }
  if (['DRIVER', 'DELIVERY_POINT'].includes(role)) {
    const reservationId = change.resource_table === 'reservations' ? change.resource_id : live.reservation_id;
    if (!reservationId) return false;
    if (role === 'DRIVER') {
      const matches = scope => ['resolved_driver_id', 'resolved_task_driver_id'].some(key => same(scope[key], user.id));
      return matches(live) && snapshots.every(matches);
    }
    return same(live.resolved_delivery_point_owner_id, user.id) && snapshots.every(s => same(s.resolved_delivery_point_owner_id, user.id));
  }
  return false;
}
function publicChange(row) {
  // Defense in depth even if an old trigger captured more columns.
  const sanitize = value => Object.fromEntries(Object.entries(parse(value)).filter(([key]) => SAFE.has(key)));
  const before = row.before_json == null ? null : sanitize(row.before_json);
  const after = row.after_json == null ? null : sanitize(row.after_json);
  const fields = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
  return { id: String(row.id), resource: row.resource_table, resourceId: row.resource_id,
    operation: row.operation, errorCode: row.error_code || null, before, after,
    redactedFields: (Array.isArray(parse(row.changed_fields)) ? parse(row.changed_fields) : []).filter(field => field && !SAFE.has(field)),
    differences: fields.filter(field => JSON.stringify(before?.[field]) !== JSON.stringify(after?.[field]))
      .map(field => ({ field, before: before?.[field] ?? null, after: after?.[field] ?? null })) };
}
async function visibleRequest(ctx, user, request, { detail = false, resourceId = null } = {}) {
  const admin = String(user.role).toUpperCase() === 'ADMIN';
  const [changes] = await ctx.audit.raw.query(`SELECT c.*,s.before_scope,s.after_scope FROM admin_audit_changes c
    LEFT JOIN admin_audit_scopes s ON s.change_id=c.id WHERE c.request_id=? ORDER BY c.id`, [request.id]);
  const visible = [];
  for (const change of changes) {
    if (resourceId && String(change.resource_id) !== resourceId) continue;
    if (admin || await canReadChange(ctx, user, change)) visible.push(change);
  }
  const personalAuth = request.module === 'auth' && same(request.actor_id, user.id);
  if ((!admin && !personalAuth && !visible.length) || (resourceId && !visible.length)) return null;
  const visibleFailures = visible.filter(change => change.operation === 'FAILED').length;
  const scopedStatus = visibleFailures ? (visibleFailures === visible.length ? 'failed' : 'partial') : 'success';
  const result = {
    id: String(request.id), requestId: request.request_id,
    actorId: request.actor_id, actorName: request.actor_name, actorRole: request.actor_role,
    module: request.module, action: request.action,
    status: admin || personalAuth ? request.status : scopedStatus,
    resultScope: admin || personalAuth ? 'request' : 'visible',
    errorCode: admin || personalAuth ? request.error_code : null,
    createdAt: request.created_at, completedAt: admin || personalAuth ? request.completed_at : null,
    visibleChangeCount: visible.length,
  };
  if (detail) {
    result.changes = visible.map(publicChange);
    // Request-wide effect results and batch errors can disclose other tenants.
    if (admin || personalAuth) {
      const [jobs] = await ctx.audit.raw.query("SELECT id,kind,CASE WHEN status='processing' AND started_at < DATE_SUB(NOW(3),INTERVAL 5 MINUTE) THEN 'unknown' ELSE status END AS status,error_code FROM admin_audit_jobs WHERE request_id=? ORDER BY id", [request.id]);
      result.jobs = jobs.map(j => ({ id: String(j.id), kind: j.kind, status: j.status, errorCode: j.error_code }));
    }
    if (admin) result.sourceIp = request.source_ip;
  }
  return result;
}
module.exports = { parse, capabilityFor, canReadChange, publicChange, visibleRequest };
