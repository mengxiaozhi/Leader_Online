'use strict';
const { normalizeConsignorName } = require('./consignor-name');

const ORDERS_SQL = `SELECT o.id, o.user_id, o.details, o.row_version, u.username AS buyer_name
  FROM orders o LEFT JOIN users u ON u.id = o.user_id ORDER BY o.id`;
const RESERVATIONS_SQL = `SELECT r.id, r.order_id, r.consignor_name, buyer.username AS buyer_name
  FROM reservations r
  LEFT JOIN reservation_transfers original_transfer ON original_transfer.id = (
    SELECT MIN(t.id) FROM reservation_transfers t
    WHERE t.reservation_id = r.id AND t.status = 'accepted')
  LEFT JOIN users buyer ON buyer.id = COALESCE(original_transfer.from_user_id, r.user_id)
  ORDER BY r.id`;

function parseDetails(value) {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function missingName(value) {
  return value == null || (typeof value === 'string' && !normalizeConsignorName(value));
}
function buyerName(order, details) {
  return normalizeConsignorName(details.contactSnapshot?.username)
    || normalizeConsignorName(details.contact_snapshot?.username)
    || normalizeConsignorName(order?.buyer_name);
}
function isShipment(details) {
  return details.kind === 'event-reservation'
    || (Array.isArray(details.selections) && details.selections.length > 0);
}
function validName(name) { return name.length > 0 && name.length <= 50; }
function conflict() {
  return Object.assign(new Error('資料已更新，為避免覆蓋其他修改，補入或還原已取消'), { code: 'BACKFILL_CONFLICT' });
}

// Take a one-time copy. There is no runtime linkage to future member/profile edits.
function planBuyerConsignorBackfill(orders = [], reservations = []) {
  const plan = { version: 1, orders: [], reservations: [], skipped: [] };
  const byId = new Map(orders.map(row => [String(row.id), { row, details: parseDetails(row.details) }]));
  for (const { row, details } of byId.values()) {
    if (!isShipment(details) || !missingName(details.consignorName)) continue;
    const name = buyerName(row, details);
    if (!validName(name)) {
      plan.skipped.push({ kind: 'order', id: String(row.id), reason: name ? 'NAME_TOO_LONG' : 'BUYER_NAME_MISSING' });
      continue;
    }
    const version = Number(row.row_version);
    if (!Number.isSafeInteger(version) || version < 1) throw conflict();
    plan.orders.push({ id: String(row.id), name, rowVersion: version,
      before: { hadName: Object.hasOwn(details, 'consignorName'), name: details.consignorName ?? null } });
    // Reservation rows in this plan inherit the order's resolved consignor first.
    byId.set(String(row.id), { row, details: { ...details, consignorName: name } });
  }
  for (const row of reservations) {
    if (!missingName(row.consignor_name)) continue;
    const linked = byId.get(String(row.order_id));
    const name = linked
      ? normalizeConsignorName(linked.details.consignorName) || buyerName(linked.row, linked.details)
      : normalizeConsignorName(row.buyer_name);
    if (!validName(name)) {
      plan.skipped.push({ kind: 'reservation', id: String(row.id), reason: name ? 'NAME_TOO_LONG' : 'BUYER_NAME_MISSING' });
      continue;
    }
    plan.reservations.push({ id: String(row.id), name, before: row.consignor_name ?? null });
  }
  return plan;
}

function summarize(plan) {
  return { orders: plan.orders.length, reservations: plan.reservations.length, skipped: plan.skipped };
}

async function backfillBuyerConsignorNames(connection, { apply = false, writeBackup } = {}) {
  if (apply && typeof writeBackup !== 'function') throw new Error('套用前必須提供備份位置');
  if (apply) await connection.beginTransaction();
  try {
    const lock = apply ? ' FOR UPDATE' : '';
    const [orders] = await connection.query(ORDERS_SQL + lock);
    const [reservations] = await connection.query(RESERVATIONS_SQL + lock);
    const plan = planBuyerConsignorBackfill(orders, reservations);
    if (!apply) return { mode: 'dry-run', ...summarize(plan) };
    await writeBackup(plan);
    for (const row of plan.orders) {
      const nextVersion = row.rowVersion + 1;
      const [result] = await connection.query(`UPDATE orders SET
        details = JSON_SET(details, '$.consignorName', ?, '$.rowVersion', ?),
        row_version = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND row_version = ?`,
      [row.name, nextVersion, nextVersion, row.id, row.rowVersion]);
      if (Number(result.affectedRows) !== 1) throw conflict();
    }
    for (const row of plan.reservations) {
      const [result] = await connection.query(`UPDATE reservations SET consignor_name = ?
        WHERE id = ? AND consignor_name <=> ?`, [row.name, row.id, row.before]);
      if (Number(result.affectedRows) !== 1) throw conflict();
    }
    await connection.commit();
    return { mode: 'applied', ...summarize(plan) };
  } catch (error) {
    if (apply) await connection.rollback();
    throw error;
  }
}

async function rollbackBuyerConsignorNames(connection, plan) {
  if (plan?.version !== 1 || !Array.isArray(plan.orders) || !Array.isArray(plan.reservations)) {
    throw new Error('補入備份格式不正確');
  }
  await connection.beginTransaction();
  try {
    for (const row of plan.orders) {
      const expected = row.rowVersion + 1, nextVersion = expected + 1;
      const restore = row.before.hadName
        ? "JSON_SET(details, '$.consignorName', ?, '$.rowVersion', ?)"
        : "JSON_SET(JSON_REMOVE(details, '$.consignorName'), '$.rowVersion', ?)";
      const params = row.before.hadName ? [row.before.name, nextVersion] : [nextVersion];
      const [result] = await connection.query(`UPDATE orders SET details = ${restore},
        row_version = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND row_version = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(details, '$.consignorName')) = ?`,
      [...params, nextVersion, row.id, expected, row.name]);
      if (Number(result.affectedRows) !== 1) throw conflict();
    }
    for (const row of plan.reservations) {
      const [result] = await connection.query(`UPDATE reservations SET consignor_name = ?
        WHERE id = ? AND consignor_name = ?`, [row.before, row.id, row.name]);
      if (Number(result.affectedRows) !== 1) throw conflict();
    }
    await connection.commit();
    return { mode: 'rolled-back', ...summarize(plan) };
  } catch (error) { await connection.rollback(); throw error; }
}

module.exports = { planBuyerConsignorBackfill, backfillBuyerConsignorNames, rollbackBuyerConsignorNames };
