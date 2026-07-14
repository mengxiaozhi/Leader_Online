const express = require('express');
const { randomBytes } = require('crypto');

const COURSE_PRODUCT_STATUSES = new Set(['draft', 'published', 'archived']);
const COURSE_SESSION_STATUSES = new Set(['draft', 'open', 'closed', 'completed', 'cancelled']);
const COURSE_ORDER_STATUSES = new Set(['pending', 'payment_review', 'paid', 'issued', 'cancelled', 'refunded']);
const COURSE_TICKET_STATUSES = new Set(['pending', 'active', 'paused', 'exhausted', 'expired', 'void']);

function text(value, max = 255) {
  return String(value ?? '').trim().slice(0, max);
}

function positiveInt(value, fallback = null, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function nonNegativeInt(value, fallback = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, max) : fallback;
}

function money(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : fallback;
}

function booleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(value).trim().toLowerCase());
}

function mysqlDateTime(value, nullable = true) {
  if (value === undefined || value === null || value === '') return nullable ? null : '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return nullable ? null : '';
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function dateOnly(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function randomCode(prefix, bytes = 5) {
  return `${prefix}${randomBytes(bytes).toString('hex').toUpperCase()}`;
}

function normalizeStatus(value, allowed, fallback) {
  const normalized = text(value, 32).toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function toProduct(row = {}) {
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    category: row.category || '',
    summary: row.summary || '',
    description: row.description || '',
    coverUrl: row.cover_url || '',
    price: Number(row.price || 0),
    classCount: Number(row.class_count || 0),
    validDays: Number(row.valid_days || 0),
    activationDays: Number(row.activation_days || 0),
    transferable: Boolean(Number(row.transferable || 0)),
    externalPurchaseUrl: row.external_purchase_url || '',
    status: row.status || 'draft',
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSession(row = {}) {
  return {
    id: Number(row.id),
    code: row.code,
    productId: row.product_id == null ? null : Number(row.product_id),
    productName: row.product_name || '',
    title: row.title,
    coachUserId: row.coach_user_id || null,
    coachName: row.coach_name || '',
    location: row.location || '',
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    bookingOpenAt: row.booking_open_at,
    bookingCloseAt: row.booking_close_at,
    capacity: Number(row.capacity || 0),
    bookedCount: Number(row.booked_count || 0),
    notes: row.notes || '',
    status: row.status || 'draft',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTicket(row = {}) {
  const remaining = Number(row.remaining_uses || 0);
  const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
  let status = row.status || 'pending';
  if (status === 'active' && remaining <= 0) status = 'exhausted';
  if (status === 'active' && expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) status = 'expired';
  return {
    id: Number(row.id),
    code: row.code,
    userId: row.user_id || null,
    ownerName: row.owner_name || row.username || '',
    ownerEmail: row.owner_email || row.email || '',
    productId: Number(row.product_id),
    productName: row.product_name || '',
    orderId: row.order_id == null ? null : Number(row.order_id),
    totalUses: Number(row.total_uses || 0),
    remainingUses: remaining,
    status,
    issuedAt: row.issued_at,
    activationDeadline: row.activation_deadline,
    activatedAt: row.activated_at,
    expiresAt: row.expires_at,
    pausedAt: row.paused_at,
    pauseReason: row.pause_reason || '',
    transferable: Boolean(Number(row.transferable || 0)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureCourseTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_products (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      code VARCHAR(40) NOT NULL,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(80) DEFAULT NULL,
      summary VARCHAR(500) DEFAULT NULL,
      description MEDIUMTEXT DEFAULT NULL,
      cover_url VARCHAR(1000) DEFAULT NULL,
      price DECIMAL(10,2) NOT NULL DEFAULT 0,
      class_count INT UNSIGNED NOT NULL DEFAULT 1,
      valid_days INT UNSIGNED NOT NULL DEFAULT 120,
      activation_days INT UNSIGNED NOT NULL DEFAULT 120,
      transferable TINYINT(1) NOT NULL DEFAULT 0,
      external_purchase_url VARCHAR(1000) DEFAULT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_course_products_code (code),
      KEY idx_course_products_status_sort (status, sort_order, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_sessions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      code VARCHAR(40) NOT NULL,
      product_id INT UNSIGNED DEFAULT NULL,
      title VARCHAR(255) NOT NULL,
      coach_user_id CHAR(36) DEFAULT NULL,
      coach_name VARCHAR(255) DEFAULT NULL,
      location VARCHAR(255) DEFAULT NULL,
      starts_at DATETIME NOT NULL,
      ends_at DATETIME NOT NULL,
      booking_open_at DATETIME DEFAULT NULL,
      booking_close_at DATETIME DEFAULT NULL,
      capacity INT UNSIGNED NOT NULL DEFAULT 20,
      notes TEXT DEFAULT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_course_sessions_code (code),
      KEY idx_course_sessions_time_status (starts_at, status),
      KEY idx_course_sessions_product (product_id),
      KEY idx_course_sessions_coach (coach_user_id),
      CONSTRAINT fk_course_sessions_product FOREIGN KEY (product_id) REFERENCES course_products(id) ON DELETE SET NULL,
      CONSTRAINT fk_course_sessions_coach FOREIGN KEY (coach_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_orders (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      code VARCHAR(40) NOT NULL,
      user_id CHAR(36) NOT NULL,
      buyer_name VARCHAR(255) NOT NULL,
      buyer_email VARCHAR(255) NOT NULL,
      product_id INT UNSIGNED NOT NULL,
      quantity INT UNSIGNED NOT NULL DEFAULT 1,
      unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
      total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      remittance_last5 CHAR(5) DEFAULT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'pending',
      terms_accepted_at DATETIME NOT NULL,
      note TEXT DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_course_orders_code (code),
      KEY idx_course_orders_user_created (user_id, created_at),
      KEY idx_course_orders_status_created (status, created_at),
      KEY idx_course_orders_product (product_id),
      CONSTRAINT fk_course_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT fk_course_orders_product FOREIGN KEY (product_id) REFERENCES course_products(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_tickets (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      code VARCHAR(40) NOT NULL,
      user_id CHAR(36) NOT NULL,
      owner_name VARCHAR(255) DEFAULT NULL,
      owner_email VARCHAR(255) NOT NULL,
      product_id INT UNSIGNED NOT NULL,
      order_id BIGINT UNSIGNED DEFAULT NULL,
      total_uses INT UNSIGNED NOT NULL DEFAULT 1,
      remaining_uses INT UNSIGNED NOT NULL DEFAULT 1,
      status VARCHAR(24) NOT NULL DEFAULT 'pending',
      issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      activation_deadline DATE DEFAULT NULL,
      activated_at DATETIME DEFAULT NULL,
      expires_at DATE DEFAULT NULL,
      paused_at DATETIME DEFAULT NULL,
      pause_reason VARCHAR(500) DEFAULT NULL,
      transferable TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_course_tickets_code (code),
      KEY idx_course_tickets_user_status (user_id, status),
      KEY idx_course_tickets_product (product_id),
      KEY idx_course_tickets_order (order_id),
      CONSTRAINT fk_course_tickets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT fk_course_tickets_product FOREIGN KEY (product_id) REFERENCES course_products(id) ON DELETE RESTRICT,
      CONSTRAINT fk_course_tickets_order FOREIGN KEY (order_id) REFERENCES course_orders(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_bookings (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      session_id BIGINT UNSIGNED NOT NULL,
      ticket_id BIGINT UNSIGNED NOT NULL,
      user_id CHAR(36) NOT NULL,
      attendee_name VARCHAR(255) NOT NULL,
      attendee_email VARCHAR(255) NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'booked',
      booked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      cancelled_at DATETIME DEFAULT NULL,
      attended_at DATETIME DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_course_booking_session_user (session_id, user_id),
      KEY idx_course_bookings_user_created (user_id, created_at),
      KEY idx_course_bookings_session_status (session_id, status),
      KEY idx_course_bookings_ticket (ticket_id),
      CONSTRAINT fk_course_bookings_session FOREIGN KEY (session_id) REFERENCES course_sessions(id) ON DELETE CASCADE,
      CONSTRAINT fk_course_bookings_ticket FOREIGN KEY (ticket_id) REFERENCES course_tickets(id) ON DELETE RESTRICT,
      CONSTRAINT fk_course_bookings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_attendance_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      session_id BIGINT UNSIGNED NOT NULL,
      booking_id BIGINT UNSIGNED DEFAULT NULL,
      ticket_id BIGINT UNSIGNED NOT NULL,
      user_id CHAR(36) NOT NULL,
      action VARCHAR(24) NOT NULL DEFAULT 'redeem',
      quantity INT UNSIGNED NOT NULL DEFAULT 1,
      staff_user_id CHAR(36) NOT NULL,
      note VARCHAR(500) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_course_attendance_session (session_id, created_at),
      KEY idx_course_attendance_ticket (ticket_id, created_at),
      CONSTRAINT fk_course_attendance_session FOREIGN KEY (session_id) REFERENCES course_sessions(id) ON DELETE RESTRICT,
      CONSTRAINT fk_course_attendance_booking FOREIGN KEY (booking_id) REFERENCES course_bookings(id) ON DELETE SET NULL,
      CONSTRAINT fk_course_attendance_ticket FOREIGN KEY (ticket_id) REFERENCES course_tickets(id) ON DELETE RESTRICT,
      CONSTRAINT fk_course_attendance_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT fk_course_attendance_staff FOREIGN KEY (staff_user_id) REFERENCES users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_ticket_transfers (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      ticket_id BIGINT UNSIGNED NOT NULL,
      from_user_id CHAR(36) NOT NULL,
      to_user_id CHAR(36) NOT NULL,
      from_email VARCHAR(255) NOT NULL,
      to_email VARCHAR(255) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_course_ticket_transfers_ticket (ticket_id, created_at),
      KEY idx_course_ticket_transfers_users (from_user_id, to_user_id),
      CONSTRAINT fk_course_ticket_transfers_ticket FOREIGN KEY (ticket_id) REFERENCES course_tickets(id) ON DELETE RESTRICT,
      CONSTRAINT fk_course_ticket_transfers_from FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT fk_course_ticket_transfers_to FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function buildCourseRoutes(ctx) {
  const router = express.Router();
  const { ok, fail, pool, authRequired, staffRequired } = ctx;

  const courseManagerRequired = (req, res, next) => staffRequired(req, res, () => {
    const role = String(req.user?.role || '').trim().toUpperCase();
    if (!['ADMIN', 'EDITOR', 'SERVICE_PROVIDER', 'STORE', 'COACH'].includes(role)) {
      return fail(res, 'FORBIDDEN', '需要課程管理權限', 403);
    }
    return next();
  });

  let schemaReady = null;
  const ensureSchema = () => {
    if (!schemaReady) {
      schemaReady = ensureCourseTables(pool).catch((error) => {
        schemaReady = null;
        throw error;
      });
    }
    return schemaReady;
  };

  async function findProduct(id, { publishedOnly = false, conn = pool } = {}) {
    const productId = positiveInt(id);
    if (!productId) return null;
    const where = publishedOnly ? " AND status = 'published'" : '';
    const [rows] = await conn.query(`SELECT * FROM course_products WHERE id = ?${where} LIMIT 1`, [productId]);
    return rows[0] || null;
  }

  async function uniqueCode(table, prefix, conn = pool) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = randomCode(prefix);
      const [rows] = await conn.query(`SELECT id FROM ${table} WHERE code = ? LIMIT 1`, [code]);
      if (!rows.length) return code;
    }
    throw new Error('代碼產生失敗，請再試一次');
  }

  function handleError(res, code, error) {
    console.error(`[courses] ${code}:`, error?.message || error);
    if (error?.code === 'ER_DUP_ENTRY') return fail(res, 'COURSE_DUPLICATE', '資料重複，請重新整理後再試', 409);
    return fail(res, code, error?.message || '課程模塊處理失敗', error?.statusCode || 500);
  }

  async function rollbackFail(conn, res, code, message, status) {
    try { await conn.rollback(); } catch (_) {}
    return fail(res, code, message, status);
  }

  router.get('/courses/products', async (req, res) => {
    try {
      await ensureSchema();
      const [rows] = await pool.query(
        "SELECT * FROM course_products WHERE status = 'published' ORDER BY sort_order ASC, id DESC"
      );
      return ok(res, rows.map(toProduct));
    } catch (error) {
      return handleError(res, 'COURSE_PRODUCTS_LIST_FAIL', error);
    }
  });

  router.get('/courses/sessions', async (req, res) => {
    try {
      await ensureSchema();
      const productId = positiveInt(req.query.productId ?? req.query.product_id);
      const params = [];
      const where = ["s.status = 'open'", 's.ends_at >= NOW()'];
      if (productId) {
        where.push('(s.product_id = ? OR s.product_id IS NULL)');
        params.push(productId);
      }
      const [rows] = await pool.query(
        `SELECT s.*, p.name AS product_name,
                COALESCE(s.coach_name, u.username, '') AS coach_name,
                SUM(CASE WHEN b.status IN ('booked', 'attended') THEN 1 ELSE 0 END) AS booked_count
           FROM course_sessions s
           LEFT JOIN course_products p ON p.id = s.product_id
           LEFT JOIN users u ON u.id = s.coach_user_id
           LEFT JOIN course_bookings b ON b.session_id = s.id
          WHERE ${where.join(' AND ')}
          GROUP BY s.id
          ORDER BY s.starts_at ASC, s.id ASC`,
        params
      );
      return ok(res, rows.map(toSession));
    } catch (error) {
      return handleError(res, 'COURSE_SESSIONS_LIST_FAIL', error);
    }
  });

  router.post('/courses/orders', authRequired, async (req, res) => {
    try {
      await ensureSchema();
      const product = await findProduct(req.body?.productId ?? req.body?.product_id, { publishedOnly: true });
      if (!product) return fail(res, 'COURSE_PRODUCT_NOT_FOUND', '找不到可購買的課程商品', 404);
      const quantity = positiveInt(req.body?.quantity, 1, 10);
      const buyerName = text(req.body?.buyerName ?? req.body?.buyer_name ?? req.user?.username, 255);
      const buyerEmail = text(req.body?.buyerEmail ?? req.body?.buyer_email ?? req.user?.email, 255).toLowerCase();
      const remittanceLast5 = text(req.body?.remittanceLast5 ?? req.body?.remittance_last5, 5);
      if (!buyerName || !buyerEmail || !buyerEmail.includes('@')) return fail(res, 'VALIDATION_ERROR', '請填寫購買人姓名與正確 Email', 400);
      if (remittanceLast5 && !/^\d{5}$/.test(remittanceLast5)) return fail(res, 'VALIDATION_ERROR', '匯款帳號後五碼需為 5 位數字', 400);
      if (!booleanFlag(req.body?.termsAccepted ?? req.body?.terms_accepted, false)) return fail(res, 'COURSE_TERMS_REQUIRED', '請先閱讀並同意課程使用須知', 400);
      const code = await uniqueCode('course_orders', 'CO');
      const unitPrice = money(product.price);
      const total = unitPrice * quantity;
      const [result] = await pool.query(
        `INSERT INTO course_orders
           (code, user_id, buyer_name, buyer_email, product_id, quantity, unit_price, total_amount, remittance_last5, status, terms_accepted_at, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), ?)`,
        [code, req.user.id, buyerName, buyerEmail, product.id, quantity, unitPrice, total, remittanceLast5 || null, text(req.body?.note, 1000) || null]
      );
      return ok(res, { id: Number(result.insertId), code, status: 'pending', totalAmount: total }, '課程訂單已建立');
    } catch (error) {
      return handleError(res, 'COURSE_ORDER_CREATE_FAIL', error);
    }
  });

  router.get('/courses/me', authRequired, async (req, res) => {
    try {
      await ensureSchema();
      const [ticketRows] = await pool.query(
        `SELECT t.*, p.name AS product_name
           FROM course_tickets t
           JOIN course_products p ON p.id = t.product_id
          WHERE t.user_id = ?
          ORDER BY t.created_at DESC, t.id DESC`,
        [req.user.id]
      );
      const [bookingRows] = await pool.query(
        `SELECT b.*, s.code AS session_code, s.title AS session_title, s.location, s.starts_at, s.ends_at,
                COALESCE(s.coach_name, u.username, '') AS coach_name, t.code AS ticket_code
           FROM course_bookings b
           JOIN course_sessions s ON s.id = b.session_id
           JOIN course_tickets t ON t.id = b.ticket_id
           LEFT JOIN users u ON u.id = s.coach_user_id
          WHERE b.user_id = ?
          ORDER BY s.starts_at DESC, b.id DESC`,
        [req.user.id]
      );
      const [orderRows] = await pool.query(
        `SELECT o.*, p.name AS product_name
           FROM course_orders o
           JOIN course_products p ON p.id = o.product_id
          WHERE o.user_id = ?
          ORDER BY o.created_at DESC, o.id DESC
          LIMIT 100`,
        [req.user.id]
      );
      return ok(res, {
        tickets: ticketRows.map(toTicket),
        bookings: bookingRows.map((row) => ({
          id: Number(row.id),
          sessionId: Number(row.session_id),
          sessionCode: row.session_code,
          sessionTitle: row.session_title,
          ticketId: Number(row.ticket_id),
          ticketCode: row.ticket_code,
          attendeeName: row.attendee_name,
          attendeeEmail: row.attendee_email,
          location: row.location || '',
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          coachName: row.coach_name || '',
          status: row.status,
          bookedAt: row.booked_at,
        })),
        orders: orderRows.map((row) => ({
          id: Number(row.id),
          code: row.code,
          productId: Number(row.product_id),
          productName: row.product_name,
          quantity: Number(row.quantity),
          totalAmount: Number(row.total_amount),
          remittanceLast5: row.remittance_last5 || '',
          status: row.status,
          createdAt: row.created_at,
        })),
      });
    } catch (error) {
      return handleError(res, 'COURSE_ME_FAIL', error);
    }
  });

  router.post('/courses/sessions/:id/book', authRequired, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      await conn.beginTransaction();
      const sessionId = positiveInt(req.params.id);
      const ticketId = positiveInt(req.body?.ticketId ?? req.body?.ticket_id);
      if (!sessionId || !ticketId) return rollbackFail(conn, res, 'VALIDATION_ERROR', '請選擇場次與票券', 400);
      const [sessionRows] = await conn.query(
        `SELECT s.*,
                (SELECT COUNT(*) FROM course_bookings b WHERE b.session_id = s.id AND b.status IN ('booked', 'attended')) AS booked_count
           FROM course_sessions s WHERE s.id = ? LIMIT 1 FOR UPDATE`,
        [sessionId]
      );
      const session = sessionRows[0];
      if (!session || session.status !== 'open') return rollbackFail(conn, res, 'COURSE_SESSION_NOT_OPEN', '此場次目前未開放預約', 409);
      const now = Date.now();
      if (session.booking_open_at && new Date(session.booking_open_at).getTime() > now) return rollbackFail(conn, res, 'COURSE_BOOKING_NOT_STARTED', '此場次尚未開放預約', 409);
      if (session.booking_close_at && new Date(session.booking_close_at).getTime() < now) return rollbackFail(conn, res, 'COURSE_BOOKING_CLOSED', '此場次已截止預約', 409);
      if (new Date(session.ends_at).getTime() < now) return rollbackFail(conn, res, 'COURSE_SESSION_ENDED', '此場次已結束', 409);
      if (Number(session.capacity) > 0 && Number(session.booked_count) >= Number(session.capacity)) return rollbackFail(conn, res, 'COURSE_SESSION_FULL', '此場次名額已滿', 409);
      const [ticketRows] = await conn.query(
        `SELECT t.*, p.valid_days
           FROM course_tickets t JOIN course_products p ON p.id = t.product_id
          WHERE t.id = ? AND t.user_id = ? LIMIT 1 FOR UPDATE`,
        [ticketId, req.user.id]
      );
      const ticket = ticketRows[0];
      if (!ticket) return rollbackFail(conn, res, 'COURSE_TICKET_NOT_FOUND', '找不到可用票券', 404);
      if (!['pending', 'active'].includes(ticket.status) || Number(ticket.remaining_uses) <= 0) return rollbackFail(conn, res, 'COURSE_TICKET_UNAVAILABLE', '此票券目前不可預約', 409);
      if (ticket.expires_at && new Date(ticket.expires_at).getTime() < now) return rollbackFail(conn, res, 'COURSE_TICKET_EXPIRED', '此票券已過期', 409);
      if (session.product_id && Number(session.product_id) !== Number(ticket.product_id)) return rollbackFail(conn, res, 'COURSE_TICKET_NOT_APPLICABLE', '此票券不適用該場次', 409);
      const attendeeName = text(req.body?.attendeeName ?? req.body?.attendee_name ?? req.user?.username, 255);
      const attendeeEmail = text(req.body?.attendeeEmail ?? req.body?.attendee_email ?? req.user?.email, 255).toLowerCase();
      if (!attendeeName || !attendeeEmail) return rollbackFail(conn, res, 'VALIDATION_ERROR', '請填寫出席者姓名與 Email', 400);
      const [existing] = await conn.query('SELECT id, status FROM course_bookings WHERE session_id = ? AND user_id = ? LIMIT 1 FOR UPDATE', [sessionId, req.user.id]);
      let bookingId;
      if (existing.length) {
        if (existing[0].status !== 'cancelled') return rollbackFail(conn, res, 'COURSE_ALREADY_BOOKED', '你已預約此場次', 409);
        await conn.query(
          `UPDATE course_bookings SET ticket_id = ?, attendee_name = ?, attendee_email = ?, status = 'booked', booked_at = NOW(), cancelled_at = NULL, attended_at = NULL WHERE id = ?`,
          [ticketId, attendeeName, attendeeEmail, existing[0].id]
        );
        bookingId = Number(existing[0].id);
      } else {
        const [result] = await conn.query(
          `INSERT INTO course_bookings (session_id, ticket_id, user_id, attendee_name, attendee_email, status)
           VALUES (?, ?, ?, ?, ?, 'booked')`,
          [sessionId, ticketId, req.user.id, attendeeName, attendeeEmail]
        );
        bookingId = Number(result.insertId);
      }
      await conn.commit();
      return ok(res, { id: bookingId }, '預約成功；到場核銷時才會扣除堂數');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'COURSE_BOOKING_CREATE_FAIL', error);
    } finally {
      conn.release();
    }
  });

  router.delete('/courses/bookings/:id', authRequired, async (req, res) => {
    try {
      await ensureSchema();
      const bookingId = positiveInt(req.params.id);
      const [result] = await pool.query(
        `UPDATE course_bookings b
            JOIN course_sessions s ON s.id = b.session_id
            SET b.status = 'cancelled', b.cancelled_at = NOW()
          WHERE b.id = ? AND b.user_id = ? AND b.status = 'booked' AND s.starts_at > NOW()`,
        [bookingId, req.user.id]
      );
      if (!result.affectedRows) return fail(res, 'COURSE_BOOKING_CANCEL_FAIL', '找不到可取消的預約，或場次已開始', 409);
      return ok(res, null, '預約已取消');
    } catch (error) {
      return handleError(res, 'COURSE_BOOKING_CANCEL_FAIL', error);
    }
  });

  router.post('/courses/tickets/:id/pause', authRequired, async (req, res) => {
    try {
      await ensureSchema();
      const reason = text(req.body?.reason, 500);
      if (!reason) return fail(res, 'VALIDATION_ERROR', '請填寫暫停原因', 400);
      const [result] = await pool.query(
        `UPDATE course_tickets SET status = 'paused', paused_at = NOW(), pause_reason = ?
          WHERE id = ? AND user_id = ? AND status = 'active' AND remaining_uses > 0`,
        [reason, positiveInt(req.params.id), req.user.id]
      );
      if (!result.affectedRows) return fail(res, 'COURSE_TICKET_PAUSE_FAIL', '此票券目前無法暫停', 409);
      return ok(res, null, '票券已暫停');
    } catch (error) {
      return handleError(res, 'COURSE_TICKET_PAUSE_FAIL', error);
    }
  });

  router.post('/courses/tickets/:id/resume', authRequired, async (req, res) => {
    try {
      await ensureSchema();
      const [result] = await pool.query(
        `UPDATE course_tickets SET status = 'active', paused_at = NULL, pause_reason = NULL
          WHERE id = ? AND user_id = ? AND status = 'paused' AND remaining_uses > 0`,
        [positiveInt(req.params.id), req.user.id]
      );
      if (!result.affectedRows) return fail(res, 'COURSE_TICKET_RESUME_FAIL', '此票券目前無法恢復', 409);
      return ok(res, null, '票券已恢復使用');
    } catch (error) {
      return handleError(res, 'COURSE_TICKET_RESUME_FAIL', error);
    }
  });

  router.post('/courses/tickets/:id/transfer', authRequired, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      const targetEmail = text(req.body?.email, 255).toLowerCase();
      if (!targetEmail || !targetEmail.includes('@')) return fail(res, 'VALIDATION_ERROR', '請輸入受讓人的正確 Email', 400);
      await conn.beginTransaction();
      const [ticketRows] = await conn.query('SELECT * FROM course_tickets WHERE id = ? AND user_id = ? LIMIT 1 FOR UPDATE', [positiveInt(req.params.id), req.user.id]);
      const ticket = ticketRows[0];
      if (!ticket || !Number(ticket.transferable) || !['pending', 'active', 'paused'].includes(ticket.status)) return rollbackFail(conn, res, 'COURSE_TICKET_TRANSFER_FAIL', '此票券目前不可轉讓', 409);
      const [targetRows] = await conn.query('SELECT id, username, email FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [targetEmail]);
      const target = targetRows[0];
      if (!target) return rollbackFail(conn, res, 'COURSE_TRANSFER_USER_NOT_FOUND', '受讓人需先註冊平台帳號', 404);
      if (String(target.id) === String(req.user.id)) return rollbackFail(conn, res, 'COURSE_TRANSFER_SAME_USER', '不能轉讓給自己', 400);
      const [activeBookings] = await conn.query(
        "SELECT id FROM course_bookings WHERE ticket_id = ? AND status = 'booked' LIMIT 1",
        [ticket.id]
      );
      if (activeBookings.length) return rollbackFail(conn, res, 'COURSE_TRANSFER_HAS_BOOKING', '此票券仍有未出席預約，請先取消預約再轉讓', 409);
      await conn.query(
        'UPDATE course_tickets SET user_id = ?, owner_name = ?, owner_email = ? WHERE id = ?',
        [target.id, target.username || '', target.email, ticket.id]
      );
      await conn.query(
        `INSERT INTO course_ticket_transfers (ticket_id, from_user_id, to_user_id, from_email, to_email)
         VALUES (?, ?, ?, ?, ?)`,
        [ticket.id, req.user.id, target.id, ticket.owner_email || req.user.email || '', target.email]
      );
      await conn.commit();
      return ok(res, null, '票券已轉讓');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'COURSE_TICKET_TRANSFER_FAIL', error);
    } finally {
      conn.release();
    }
  });

  router.get('/admin/courses/overview', courseManagerRequired, async (req, res) => {
    try {
      await ensureSchema();
      const [[products], [sessions], [orders], [tickets], [bookings]] = await Promise.all([
        pool.query("SELECT COUNT(*) AS total FROM course_products WHERE status <> 'archived'"),
        pool.query("SELECT COUNT(*) AS total FROM course_sessions WHERE status = 'open' AND ends_at >= NOW()"),
        pool.query("SELECT COUNT(*) AS total FROM course_orders WHERE status IN ('pending', 'payment_review', 'paid')"),
        pool.query("SELECT COUNT(*) AS total FROM course_tickets WHERE status IN ('pending', 'active', 'paused')"),
        pool.query("SELECT COUNT(*) AS total FROM course_bookings WHERE status = 'booked'"),
      ]);
      return ok(res, {
        products: Number(products[0]?.total || 0),
        openSessions: Number(sessions[0]?.total || 0),
        pendingOrders: Number(orders[0]?.total || 0),
        activeTickets: Number(tickets[0]?.total || 0),
        upcomingBookings: Number(bookings[0]?.total || 0),
      });
    } catch (error) {
      return handleError(res, 'ADMIN_COURSE_OVERVIEW_FAIL', error);
    }
  });

  router.get('/admin/courses/products', courseManagerRequired, async (req, res) => {
    try {
      await ensureSchema();
      const [rows] = await pool.query('SELECT * FROM course_products ORDER BY sort_order ASC, id DESC');
      return ok(res, rows.map(toProduct));
    } catch (error) {
      return handleError(res, 'ADMIN_COURSE_PRODUCTS_LIST_FAIL', error);
    }
  });

  router.post('/admin/courses/products', courseManagerRequired, async (req, res) => {
    try {
      await ensureSchema();
      const name = text(req.body?.name, 255);
      if (!name) return fail(res, 'VALIDATION_ERROR', '請填寫課程商品名稱', 400);
      const code = text(req.body?.code, 40).toUpperCase() || await uniqueCode('course_products', 'CP');
      const status = normalizeStatus(req.body?.status, COURSE_PRODUCT_STATUSES, 'draft');
      const [result] = await pool.query(
        `INSERT INTO course_products
          (code, name, category, summary, description, cover_url, price, class_count, valid_days, activation_days, transferable, external_purchase_url, status, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          code, name, text(req.body?.category, 80) || null, text(req.body?.summary, 500) || null,
          text(req.body?.description, 20000) || null, text(req.body?.coverUrl ?? req.body?.cover_url, 1000) || null,
          money(req.body?.price), positiveInt(req.body?.classCount ?? req.body?.class_count, 1, 999),
          positiveInt(req.body?.validDays ?? req.body?.valid_days, 120, 3650), positiveInt(req.body?.activationDays ?? req.body?.activation_days, 120, 3650),
          booleanFlag(req.body?.transferable, false) ? 1 : 0, text(req.body?.externalPurchaseUrl ?? req.body?.external_purchase_url, 1000) || null,
          status, Number.parseInt(req.body?.sortOrder ?? req.body?.sort_order, 10) || 0,
        ]
      );
      return ok(res, { id: Number(result.insertId), code }, '課程商品已新增');
    } catch (error) {
      return handleError(res, 'ADMIN_COURSE_PRODUCT_CREATE_FAIL', error);
    }
  });

  router.patch('/admin/courses/products/:id', courseManagerRequired, async (req, res) => {
    try {
      await ensureSchema();
      const product = await findProduct(req.params.id);
      if (!product) return fail(res, 'COURSE_PRODUCT_NOT_FOUND', '找不到課程商品', 404);
      const name = text(req.body?.name ?? product.name, 255);
      const status = normalizeStatus(req.body?.status ?? product.status, COURSE_PRODUCT_STATUSES, product.status || 'draft');
      await pool.query(
        `UPDATE course_products SET name = ?, category = ?, summary = ?, description = ?, cover_url = ?, price = ?, class_count = ?,
          valid_days = ?, activation_days = ?, transferable = ?, external_purchase_url = ?, status = ?, sort_order = ? WHERE id = ?`,
        [
          name, text(req.body?.category ?? product.category, 80) || null, text(req.body?.summary ?? product.summary, 500) || null,
          text(req.body?.description ?? product.description, 20000) || null, text(req.body?.coverUrl ?? req.body?.cover_url ?? product.cover_url, 1000) || null,
          money(req.body?.price, Number(product.price)), positiveInt(req.body?.classCount ?? req.body?.class_count, Number(product.class_count), 999),
          positiveInt(req.body?.validDays ?? req.body?.valid_days, Number(product.valid_days), 3650),
          positiveInt(req.body?.activationDays ?? req.body?.activation_days, Number(product.activation_days), 3650),
          booleanFlag(req.body?.transferable, Boolean(Number(product.transferable))) ? 1 : 0,
          text(req.body?.externalPurchaseUrl ?? req.body?.external_purchase_url ?? product.external_purchase_url, 1000) || null,
          status, Number.parseInt(req.body?.sortOrder ?? req.body?.sort_order ?? product.sort_order, 10) || 0, product.id,
        ]
      );
      return ok(res, null, '課程商品已更新');
    } catch (error) {
      return handleError(res, 'ADMIN_COURSE_PRODUCT_UPDATE_FAIL', error);
    }
  });

  router.delete('/admin/courses/products/:id', courseManagerRequired, async (req, res) => {
    try {
      await ensureSchema();
      const [result] = await pool.query("UPDATE course_products SET status = 'archived' WHERE id = ?", [positiveInt(req.params.id)]);
      if (!result.affectedRows) return fail(res, 'COURSE_PRODUCT_NOT_FOUND', '找不到課程商品', 404);
      return ok(res, null, '課程商品已封存');
    } catch (error) {
      return handleError(res, 'ADMIN_COURSE_PRODUCT_ARCHIVE_FAIL', error);
    }
  });

  router.get('/admin/courses/sessions', courseManagerRequired, async (req, res) => {
    try {
      await ensureSchema();
      const [rows] = await pool.query(
        `SELECT s.*, p.name AS product_name, COALESCE(s.coach_name, u.username, '') AS coach_name,
                SUM(CASE WHEN b.status IN ('booked', 'attended') THEN 1 ELSE 0 END) AS booked_count
           FROM course_sessions s
           LEFT JOIN course_products p ON p.id = s.product_id
           LEFT JOIN users u ON u.id = s.coach_user_id
           LEFT JOIN course_bookings b ON b.session_id = s.id
          GROUP BY s.id
          ORDER BY s.starts_at DESC, s.id DESC`
      );
      return ok(res, rows.map(toSession));
    } catch (error) {
      return handleError(res, 'ADMIN_COURSE_SESSIONS_LIST_FAIL', error);
    }
  });

  router.post('/admin/courses/sessions', courseManagerRequired, async (req, res) => {
    try {
      await ensureSchema();
      const title = text(req.body?.title, 255);
      const startsAt = mysqlDateTime(req.body?.startsAt ?? req.body?.starts_at);
      const endsAt = mysqlDateTime(req.body?.endsAt ?? req.body?.ends_at);
      if (!title || !startsAt || !endsAt || new Date(endsAt).getTime() <= new Date(startsAt).getTime()) return fail(res, 'VALIDATION_ERROR', '請填寫正確的場次名稱與起訖時間', 400);
      const code = text(req.body?.code, 40).toUpperCase() || await uniqueCode('course_sessions', 'CS');
      const [result] = await pool.query(
        `INSERT INTO course_sessions
          (code, product_id, title, coach_user_id, coach_name, location, starts_at, ends_at, booking_open_at, booking_close_at, capacity, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          code, positiveInt(req.body?.productId ?? req.body?.product_id), title, text(req.body?.coachUserId ?? req.body?.coach_user_id, 36) || null,
          text(req.body?.coachName ?? req.body?.coach_name, 255) || null, text(req.body?.location, 255) || null,
          startsAt, endsAt, mysqlDateTime(req.body?.bookingOpenAt ?? req.body?.booking_open_at),
          mysqlDateTime(req.body?.bookingCloseAt ?? req.body?.booking_close_at), positiveInt(req.body?.capacity, 20, 9999),
          text(req.body?.notes, 5000) || null, normalizeStatus(req.body?.status, COURSE_SESSION_STATUSES, 'draft'),
        ]
      );
      return ok(res, { id: Number(result.insertId), code }, '課程場次已新增');
    } catch (error) {
      return handleError(res, 'ADMIN_COURSE_SESSION_CREATE_FAIL', error);
    }
  });

  router.patch('/admin/courses/sessions/:id', courseManagerRequired, async (req, res) => {
    try {
      await ensureSchema();
      const id = positiveInt(req.params.id);
      const [rows] = await pool.query('SELECT * FROM course_sessions WHERE id = ? LIMIT 1', [id]);
      const current = rows[0];
      if (!current) return fail(res, 'COURSE_SESSION_NOT_FOUND', '找不到課程場次', 404);
      const startsAt = mysqlDateTime(req.body?.startsAt ?? req.body?.starts_at ?? current.starts_at);
      const endsAt = mysqlDateTime(req.body?.endsAt ?? req.body?.ends_at ?? current.ends_at);
      if (!startsAt || !endsAt || new Date(endsAt).getTime() <= new Date(startsAt).getTime()) return fail(res, 'VALIDATION_ERROR', '場次結束時間需晚於開始時間', 400);
      const hasProductId = Object.prototype.hasOwnProperty.call(req.body || {}, 'productId')
        || Object.prototype.hasOwnProperty.call(req.body || {}, 'product_id');
      const nextProductId = hasProductId
        ? positiveInt(req.body?.productId ?? req.body?.product_id, null)
        : current.product_id;
      await pool.query(
        `UPDATE course_sessions SET product_id = ?, title = ?, coach_user_id = ?, coach_name = ?, location = ?, starts_at = ?, ends_at = ?,
          booking_open_at = ?, booking_close_at = ?, capacity = ?, notes = ?, status = ? WHERE id = ?`,
        [
          nextProductId, text(req.body?.title ?? current.title, 255),
          text(req.body?.coachUserId ?? req.body?.coach_user_id ?? current.coach_user_id, 36) || null,
          text(req.body?.coachName ?? req.body?.coach_name ?? current.coach_name, 255) || null,
          text(req.body?.location ?? current.location, 255) || null, startsAt, endsAt,
          mysqlDateTime(req.body?.bookingOpenAt ?? req.body?.booking_open_at ?? current.booking_open_at),
          mysqlDateTime(req.body?.bookingCloseAt ?? req.body?.booking_close_at ?? current.booking_close_at),
          positiveInt(req.body?.capacity, Number(current.capacity), 9999), text(req.body?.notes ?? current.notes, 5000) || null,
          normalizeStatus(req.body?.status ?? current.status, COURSE_SESSION_STATUSES, current.status), id,
        ]
      );
      return ok(res, null, '課程場次已更新');
    } catch (error) {
      return handleError(res, 'ADMIN_COURSE_SESSION_UPDATE_FAIL', error);
    }
  });

  router.delete('/admin/courses/sessions/:id', courseManagerRequired, async (req, res) => {
    try {
      await ensureSchema();
      const [result] = await pool.query("UPDATE course_sessions SET status = 'cancelled' WHERE id = ?", [positiveInt(req.params.id)]);
      if (!result.affectedRows) return fail(res, 'COURSE_SESSION_NOT_FOUND', '找不到課程場次', 404);
      return ok(res, null, '場次已取消');
    } catch (error) {
      return handleError(res, 'ADMIN_COURSE_SESSION_CANCEL_FAIL', error);
    }
  });

  router.get('/admin/courses/orders', courseManagerRequired, async (req, res) => {
    try {
      await ensureSchema();
      const [rows] = await pool.query(
        `SELECT o.*, p.name AS product_name, u.username
           FROM course_orders o JOIN course_products p ON p.id = o.product_id JOIN users u ON u.id = o.user_id
          ORDER BY o.created_at DESC, o.id DESC LIMIT 500`
      );
      return ok(res, rows.map((row) => ({
        id: Number(row.id), code: row.code, userId: row.user_id, username: row.username,
        buyerName: row.buyer_name, buyerEmail: row.buyer_email, productId: Number(row.product_id), productName: row.product_name,
        quantity: Number(row.quantity), unitPrice: Number(row.unit_price), totalAmount: Number(row.total_amount),
        remittanceLast5: row.remittance_last5 || '', status: row.status, note: row.note || '', createdAt: row.created_at, updatedAt: row.updated_at,
      })));
    } catch (error) {
      return handleError(res, 'ADMIN_COURSE_ORDERS_LIST_FAIL', error);
    }
  });

  router.patch('/admin/courses/orders/:id', courseManagerRequired, async (req, res) => {
    try {
      await ensureSchema();
      const status = normalizeStatus(req.body?.status, COURSE_ORDER_STATUSES, '');
      if (!status) return fail(res, 'VALIDATION_ERROR', '訂單狀態不正確', 400);
      if (status === 'issued') {
        const [orderRows] = await pool.query('SELECT status FROM course_orders WHERE id = ? LIMIT 1', [positiveInt(req.params.id)]);
        if (!orderRows.length) return fail(res, 'COURSE_ORDER_NOT_FOUND', '找不到課程訂單', 404);
        if (orderRows[0].status !== 'issued') return fail(res, 'COURSE_ORDER_ISSUE_REQUIRED', '請使用發券按鈕完成訂單發券', 409);
      }
      const [result] = await pool.query('UPDATE course_orders SET status = ?, note = ? WHERE id = ?', [status, text(req.body?.note, 1000) || null, positiveInt(req.params.id)]);
      if (!result.affectedRows) return fail(res, 'COURSE_ORDER_NOT_FOUND', '找不到課程訂單', 404);
      return ok(res, null, '課程訂單已更新');
    } catch (error) {
      return handleError(res, 'ADMIN_COURSE_ORDER_UPDATE_FAIL', error);
    }
  });

  async function issueTicket(conn, { userId, ownerName, ownerEmail, product, orderId = null }) {
    const code = await uniqueCode('course_tickets', 'TK', conn);
    const issuedAt = new Date();
    const activationDeadline = new Date(issuedAt.getTime() + Number(product.activation_days || 120) * 86400000);
    const [result] = await conn.query(
      `INSERT INTO course_tickets
        (code, user_id, owner_name, owner_email, product_id, order_id, total_uses, remaining_uses, status, issued_at, activation_deadline, transferable)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), ?, ?)`,
      [code, userId, ownerName || '', ownerEmail, product.id, orderId, Number(product.class_count || 1), Number(product.class_count || 1), dateOnly(activationDeadline), Number(product.transferable || 0)]
    );
    return { id: Number(result.insertId), code };
  }

  router.post('/admin/courses/orders/:id/issue', courseManagerRequired, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      await conn.beginTransaction();
      const [orderRows] = await conn.query('SELECT * FROM course_orders WHERE id = ? LIMIT 1 FOR UPDATE', [positiveInt(req.params.id)]);
      const order = orderRows[0];
      if (!order) return rollbackFail(conn, res, 'COURSE_ORDER_NOT_FOUND', '找不到課程訂單', 404);
      const [existingRows] = await conn.query('SELECT id, code FROM course_tickets WHERE order_id = ? ORDER BY id', [order.id]);
      if (existingRows.length) return rollbackFail(conn, res, 'COURSE_ORDER_ALREADY_ISSUED', '此訂單已完成發券', 409);
      const product = await findProduct(order.product_id, { conn });
      const tickets = [];
      for (let i = 0; i < Number(order.quantity); i += 1) {
        tickets.push(await issueTicket(conn, { userId: order.user_id, ownerName: order.buyer_name, ownerEmail: order.buyer_email, product, orderId: order.id }));
      }
      await conn.query("UPDATE course_orders SET status = 'issued' WHERE id = ?", [order.id]);
      await conn.commit();
      return ok(res, { tickets }, '發券完成');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'ADMIN_COURSE_ORDER_ISSUE_FAIL', error);
    } finally {
      conn.release();
    }
  });

  router.get('/admin/courses/tickets', courseManagerRequired, async (req, res) => {
    try {
      await ensureSchema();
      const [rows] = await pool.query(
        `SELECT t.*, p.name AS product_name, u.username, u.email
           FROM course_tickets t JOIN course_products p ON p.id = t.product_id JOIN users u ON u.id = t.user_id
          ORDER BY t.created_at DESC, t.id DESC LIMIT 500`
      );
      return ok(res, rows.map(toTicket));
    } catch (error) {
      return handleError(res, 'ADMIN_COURSE_TICKETS_LIST_FAIL', error);
    }
  });

  router.post('/admin/courses/tickets', courseManagerRequired, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      const ownerEmail = text(req.body?.ownerEmail ?? req.body?.owner_email, 255).toLowerCase();
      const product = await findProduct(req.body?.productId ?? req.body?.product_id, { conn });
      if (!ownerEmail || !product) return fail(res, 'VALIDATION_ERROR', '請選擇商品並填寫持有人 Email', 400);
      const [userRows] = await conn.query('SELECT id, username, email FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [ownerEmail]);
      const user = userRows[0];
      if (!user) return fail(res, 'COURSE_TICKET_USER_NOT_FOUND', '持有人需先註冊平台帳號', 404);
      await conn.beginTransaction();
      const ticket = await issueTicket(conn, { userId: user.id, ownerName: user.username, ownerEmail: user.email, product });
      await conn.commit();
      return ok(res, ticket, '票券已發行');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'ADMIN_COURSE_TICKET_ISSUE_FAIL', error);
    } finally {
      conn.release();
    }
  });

  router.patch('/admin/courses/tickets/:id', courseManagerRequired, async (req, res) => {
    try {
      await ensureSchema();
      const id = positiveInt(req.params.id);
      const [rows] = await pool.query('SELECT * FROM course_tickets WHERE id = ? LIMIT 1', [id]);
      const current = rows[0];
      if (!current) return fail(res, 'COURSE_TICKET_NOT_FOUND', '找不到課程票券', 404);
      const remainingUses = nonNegativeInt(req.body?.remainingUses ?? req.body?.remaining_uses, Number(current.remaining_uses), 9999);
      let status = normalizeStatus(req.body?.status ?? current.status, COURSE_TICKET_STATUSES, current.status);
      if (remainingUses === 0 && !['void', 'expired'].includes(status)) status = 'exhausted';
      const hasExpiresAt = Object.prototype.hasOwnProperty.call(req.body || {}, 'expiresAt')
        || Object.prototype.hasOwnProperty.call(req.body || {}, 'expires_at');
      const expiresAt = hasExpiresAt
        ? dateOnly(req.body?.expiresAt ?? req.body?.expires_at)
        : dateOnly(current.expires_at);
      await pool.query(
        'UPDATE course_tickets SET remaining_uses = ?, status = ?, expires_at = ?, pause_reason = ? WHERE id = ?',
        [remainingUses, status, expiresAt, text(req.body?.pauseReason ?? req.body?.pause_reason ?? current.pause_reason, 500) || null, id]
      );
      return ok(res, null, '課程票券已更新');
    } catch (error) {
      return handleError(res, 'ADMIN_COURSE_TICKET_UPDATE_FAIL', error);
    }
  });

  router.get('/admin/courses/bookings', courseManagerRequired, async (req, res) => {
    try {
      await ensureSchema();
      const [rows] = await pool.query(
        `SELECT b.*, s.code AS session_code, s.title AS session_title, s.starts_at, s.ends_at, s.location,
                t.code AS ticket_code, t.remaining_uses, p.name AS product_name
           FROM course_bookings b
           JOIN course_sessions s ON s.id = b.session_id
           JOIN course_tickets t ON t.id = b.ticket_id
           JOIN course_products p ON p.id = t.product_id
          ORDER BY s.starts_at DESC, b.id DESC LIMIT 1000`
      );
      return ok(res, rows.map((row) => ({
        id: Number(row.id), sessionId: Number(row.session_id), sessionCode: row.session_code, sessionTitle: row.session_title,
        startsAt: row.starts_at, endsAt: row.ends_at, location: row.location || '', ticketId: Number(row.ticket_id),
        ticketCode: row.ticket_code, remainingUses: Number(row.remaining_uses), productName: row.product_name,
        userId: row.user_id, attendeeName: row.attendee_name, attendeeEmail: row.attendee_email,
        status: row.status, bookedAt: row.booked_at, attendedAt: row.attended_at,
      })));
    } catch (error) {
      return handleError(res, 'ADMIN_COURSE_BOOKINGS_LIST_FAIL', error);
    }
  });

  router.post('/admin/courses/bookings/:id/attend', courseManagerRequired, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      await conn.beginTransaction();
      const [rows] = await conn.query(
        `SELECT b.*, s.id AS session_id, t.remaining_uses, t.status AS ticket_status, t.activated_at, t.expires_at,
                p.valid_days
           FROM course_bookings b
           JOIN course_sessions s ON s.id = b.session_id
           JOIN course_tickets t ON t.id = b.ticket_id
           JOIN course_products p ON p.id = t.product_id
          WHERE b.id = ? LIMIT 1 FOR UPDATE`,
        [positiveInt(req.params.id)]
      );
      const booking = rows[0];
      if (!booking || booking.status !== 'booked') return rollbackFail(conn, res, 'COURSE_BOOKING_NOT_REDEEMABLE', '此預約目前不能核銷', 409);
      if (!['pending', 'active'].includes(booking.ticket_status) || Number(booking.remaining_uses) <= 0) return rollbackFail(conn, res, 'COURSE_TICKET_UNAVAILABLE', '票券目前不可核銷', 409);
      const activatedAt = booking.activated_at || mysqlDateTime(new Date());
      const expiresAt = booking.expires_at || dateOnly(new Date(Date.now() + Number(booking.valid_days || 120) * 86400000));
      const remaining = Number(booking.remaining_uses) - 1;
      const nextStatus = remaining <= 0 ? 'exhausted' : 'active';
      await conn.query(
        'UPDATE course_tickets SET remaining_uses = ?, status = ?, activated_at = ?, expires_at = ? WHERE id = ?',
        [remaining, nextStatus, activatedAt, expiresAt, booking.ticket_id]
      );
      await conn.query("UPDATE course_bookings SET status = 'attended', attended_at = NOW() WHERE id = ?", [booking.id]);
      await conn.query(
        `INSERT INTO course_attendance_logs (session_id, booking_id, ticket_id, user_id, action, quantity, staff_user_id, note)
         VALUES (?, ?, ?, ?, 'redeem', 1, ?, ?)`,
        [booking.session_id, booking.id, booking.ticket_id, booking.user_id, req.user.id, text(req.body?.note, 500) || null]
      );
      await conn.commit();
      return ok(res, { remainingUses: remaining, ticketStatus: nextStatus }, '出席已核銷並扣除 1 堂');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'ADMIN_COURSE_ATTEND_FAIL', error);
    } finally {
      conn.release();
    }
  });

  return router;
}

buildCourseRoutes.ensureCourseTables = ensureCourseTables;
buildCourseRoutes.helpers = { text, positiveInt, nonNegativeInt, money, booleanFlag, mysqlDateTime, dateOnly, normalizeStatus, toProduct, toSession, toTicket };

module.exports = buildCourseRoutes;
