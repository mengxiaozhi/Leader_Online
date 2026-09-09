'use strict';

const { cents } = require('./managed-order-pricing');
const fail = message => Object.assign(new Error(message), { code: 'COURSE_PRICE_REVIEW_UNAVAILABLE', statusCode: 409 });
const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value || {}; } catch { return {}; } };

async function preparePriceReview(conn, order, { getProviderSettings, dateMs, mysqlDateTime, now = Date.now() }) {
  const purpose = String(order.order_purpose || 'COUNT_PASS');
  if (purpose === 'COUNT_PASS') return null;
  if (!['TERM_ENROLLMENT', 'MAKEUP_INSURANCE'].includes(purpose)) throw fail('此訂單類型無法修改金額');
  const [seats] = await conn.query('SELECT * FROM course_seat_allocations WHERE order_id = ? FOR UPDATE', [order.id]);
  if (!seats.length || seats.some(seat => seat.status !== 'HELD' || (seat.expires_at && dateMs(seat.expires_at) <= now))) throw fail('原名額保留已失效，請先由課務處理');
  let minutes;
  if (purpose === 'TERM_ENROLLMENT') {
    const [rows] = await conn.query(
      `SELECT e.*, t.status AS term_status FROM course_term_enrollments e
        JOIN course_terms t ON t.id = e.term_id
       WHERE e.order_id = ? AND e.owner_user_id = ? LIMIT 1 FOR UPDATE`, [order.id, order.owner_user_id]
    );
    if (!rows[0] || rows[0].status !== 'PENDING_PAYMENT' || ['cancelled', 'completed', 'archived'].includes(rows[0].term_status)) throw fail('固定班報名已失效');
    const sessionIds = parse(rows[0].quote_snapshot_json).sessionIds || [];
    if (!sessionIds.length) throw fail('固定班缺少原始課程權益');
    const [sessions] = await conn.query(`SELECT id, status, ends_at FROM course_sessions WHERE id IN (${sessionIds.map(() => '?').join(',')}) FOR UPDATE`, sessionIds);
    if (sessions.length !== sessionIds.length || sessions.some(session => ['cancelled', 'completed'].includes(session.status) || dateMs(session.ends_at) <= now)) throw fail('原課程場次已失效');
    const settings = await getProviderSettings(conn, order.owner_user_id, { forUpdate: true });
    minutes = Math.max(1, Number(settings.bank_transfer_hold_hours || 24)) * 60;
  } else {
    const [rows] = await conn.query(
      `SELECT c.*, p.payment_hold_minutes, s.starts_at, s.status AS session_status,
              b.status AS booking_status, e.valid_until, e.status AS entitlement_status
         FROM course_makeup_insurance_coverages c
         JOIN course_makeup_insurance_policies p ON p.id = c.policy_id
         JOIN course_makeup_bookings b ON b.id = c.makeup_booking_id
         JOIN course_sessions s ON s.id = b.session_id
         JOIN course_makeup_entitlements e ON e.id = c.makeup_entitlement_id
        WHERE c.order_id = ? AND c.owner_user_id = ? LIMIT 1 FOR UPDATE`, [order.id, order.owner_user_id]
    );
    const row = rows[0];
    if (!row || !['pending_payment', 'reviewing'].includes(row.status) || row.booking_status !== 'RESERVED'
      || row.entitlement_status !== 'RESERVED' || dateMs(row.valid_until) <= now || dateMs(row.starts_at) <= now
      || !['open', 'published'].includes(row.session_status)) throw fail('補課保險、預約或權益已失效');
    minutes = Math.max(1, Number(row.payment_hold_minutes || 1440));
  }
  const [discounts] = await conn.query(
    `SELECT d.id, d.amount, d.payment_instrument_id, i.policy_snapshot_json,
            i.status AS instrument_status, h.status AS hold_status, h.expires_at AS hold_expires_at,
            t.status AS ticket_status, t.frozen_at, t.expires_at AS ticket_expires_at, t.activation_deadline,
            COALESCE((SELECT SUM(e.delta_uses) FROM course_usage_events e WHERE e.ticket_id = t.id), 0) AS ledger_balance,
            COALESCE((SELECT SUM(held.quantity) FROM course_ticket_holds held WHERE held.ticket_id = t.id AND held.status = 'active'), 0) AS reserved_uses
       FROM course_order_discounts d
       LEFT JOIN course_order_payment_instruments i ON i.id = d.payment_instrument_id
       LEFT JOIN course_ticket_holds h ON h.id = i.hold_id
       LEFT JOIN course_tickets t ON t.id = i.course_ticket_id
      WHERE d.order_id = ? AND d.status = 'reserved' FOR UPDATE`, [order.id]
  );
  if (discounts.some(item => item.instrument_status !== 'RESERVED' || item.hold_status !== 'active'
    || !['pending', 'active'].includes(item.ticket_status) || item.frozen_at
    || (item.hold_expires_at && dateMs(item.hold_expires_at) <= now)
    || (item.ticket_expires_at && dateMs(item.ticket_expires_at) <= now)
    || (item.ticket_status === 'pending' && item.activation_deadline && dateMs(item.activation_deadline) <= now)
    || Number(item.ledger_balance) < Number(item.reserved_uses))) throw fail('體驗折抵券或保留狀態已失效');
  const discountLimit = discounts.reduce((sum, item) => sum + cents(parse(item.policy_snapshot_json).faceValue ?? item.amount), 0) / 100;
  return { payByAt: mysqlDateTime(now + minutes * 60000), discountLimit, discounts, beforePayByAt: order.pay_by_at || null };
}

async function resetPriceReview(conn, order, pricing, context, actorUserId) {
  if (!context) return;
  await conn.query(
    `UPDATE course_payment_submissions SET status = 'REJECTED', reviewed_by = ?, reviewed_at = NOW(),
            reason = '訂單金額已修改，請依新金額重新確認', row_version = row_version + 1
      WHERE order_id = ? AND status IN ('SUBMITTED','REVIEWING')`, [actorUserId, order.id]
  );
  await conn.query('UPDATE course_orders SET pay_by_at = ? WHERE id = ?', [context.payByAt, order.id]);
  await conn.query("UPDATE course_seat_allocations SET expires_at = ?, row_version = row_version + 1 WHERE order_id = ? AND status = 'HELD'", [context.payByAt, order.id]);
  if (order.order_purpose === 'MAKEUP_INSURANCE') await conn.query(
    `UPDATE course_makeup_insurance_coverages SET status = 'pending_payment', pay_by_at = ?, row_version = row_version + 1
      WHERE order_id = ? AND status IN ('pending_payment','reviewing')`, [context.payByAt, order.id]
  );
  let remaining = cents(pricing.otherDiscount);
  for (const discount of context.discounts) {
    const applied = Math.min(remaining, cents(parse(discount.policy_snapshot_json).faceValue ?? discount.amount));
    remaining -= applied;
    await conn.query('UPDATE course_order_discounts SET amount = ?, row_version = row_version + 1 WHERE id = ?', [applied / 100, discount.id]);
    await conn.query('UPDATE course_order_payment_instruments SET amount_applied = ?, row_version = row_version + 1 WHERE id = ?', [applied / 100, discount.payment_instrument_id]);
  }
}

module.exports = { preparePriceReview, resetPriceReview };
