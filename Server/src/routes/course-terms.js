'use strict';

const {
  createCourseTermDomain,
} = require('../services/course-term-domain');
const {
  courseTermError,
  positiveInteger,
  text,
} = require('../services/course-term-policy');
const {
  normalizeCoursePlatformRole,
  refreshCourseRequestUser,
} = require('../services/course-role');
const {
  resolveCourseCapabilities,
} = require('../services/course-v2-policy');
const {
  registerCourseTermAdminRoutes,
} = require('./course-term-admin');
const {
  createCourseTermAdminDomain,
} = require('../services/course-term-admin-domain');

function registerCourseTermRoutes({ router, ctx, domain = null } = {}) {
  const { pool, ok, fail, authRequired } = ctx;
  const courseTerms = domain || createCourseTermDomain({ pool });
  const courseTermAdmin = createCourseTermAdminDomain({ pool, termDomain: courseTerms });

  function sendError(res, fallbackCode, error) {
    const status = Number(error?.statusCode || error?.status || 500);
    if (error?.details && typeof res?.status === 'function') {
      return res.status(status).json({
        ok: false,
        code: error?.code || fallbackCode,
        message: error?.message || '固定班處理失敗',
        details: error.details,
      });
    }
    return fail(res, error?.code || fallbackCode, error?.message || '固定班處理失敗', status);
  }

  async function loadMembership(userId, ownerUserId) {
    if (!userId || !ownerUserId) return null;
    const [rows] = await pool.query(
      `SELECT * FROM course_staff_memberships
        WHERE owner_user_id = ? AND user_id = ? AND status = 'active'
        LIMIT 1`,
      [ownerUserId, userId]
    );
    return rows[0] || null;
  }

  async function authorize(req, { ownerUserId, capability = 'manageCatalog' }) {
    await refreshCourseRequestUser(pool, req);
    const platformRole = normalizeCoursePlatformRole(req.user?.role);
    if (platformRole === 'ADMIN') {
      return { ownerUserId, capabilities: resolveCourseCapabilities({ platformRole }) };
    }
    if (platformRole === 'SERVICE_PROVIDER' && String(req.user.id) === String(ownerUserId)) {
      return { ownerUserId, capabilities: resolveCourseCapabilities({ platformRole }) };
    }
    const membership = await loadMembership(req.user.id, ownerUserId);
    const capabilities = resolveCourseCapabilities({ platformRole, membership });
    if (!capabilities[capability]) throw courseTermError('FORBIDDEN', '沒有此課程租戶的操作權限', 403);
    return { ownerUserId, membership, capabilities };
  }

  async function actorOwner(req, capability = 'manageCatalog') {
    await refreshCourseRequestUser(pool, req);
    const role = normalizeCoursePlatformRole(req.user?.role);
    const requested = text(
      req.body?.ownerUserId
        ?? req.body?.owner_user_id
        ?? req.query?.ownerUserId
        ?? req.query?.owner_user_id,
      36
    ) || null;
    if (role === 'ADMIN') {
      await authorize(req, { ownerUserId: requested, capability });
      return requested;
    }
    if (role === 'SERVICE_PROVIDER') {
      if (requested && String(requested) !== String(req.user.id)) {
        throw courseTermError('FORBIDDEN', '不可操作其他課程租戶', 403);
      }
      await authorize(req, { ownerUserId: req.user.id, capability });
      return req.user.id;
    }
    const [rows] = await pool.query(
      `SELECT owner_user_id FROM course_staff_memberships
        WHERE user_id = ? AND status = 'active'
          ${requested ? 'AND owner_user_id = ?' : ''}
        ORDER BY id LIMIT 2`,
      [req.user.id, ...(requested ? [requested] : [])]
    );
    if (rows.length !== 1) {
      throw courseTermError(
        rows.length ? 'COURSE_TENANT_REQUIRED' : 'FORBIDDEN',
        rows.length ? '請明確指定課程租戶' : '需要課程租戶員工權限',
        403
      );
    }
    await authorize(req, { ownerUserId: rows[0].owner_user_id, capability });
    return rows[0].owner_user_id;
  }

  async function assertManagedResource(req, { table, id, capability, ownerColumn = 'owner_user_id' }) {
    const [rows] = await pool.query(
      `SELECT ${ownerColumn} AS owner_user_id FROM ${table} WHERE id = ? LIMIT 1`,
      [positiveInteger(id)]
    );
    if (!rows[0]) throw courseTermError('COURSE_RESOURCE_NOT_FOUND', '找不到課程資源', 404);
    await authorize(req, { ownerUserId: rows[0].owner_user_id, capability });
    return rows[0].owner_user_id;
  }

  function withAuth(handler) {
    return [authRequired, async (req, res) => {
      try {
        await courseTerms.assertSchema();
        return await handler(req, res);
      } catch (error) {
        return sendError(res, 'COURSE_FIXED_TERM_FAIL', error);
      }
    }];
  }

  router.get('/courses/terms', async (req, res) => {
    try {
      const items = await courseTerms.listTerms();
      return ok(res, { items }, '固定班列表');
    } catch (error) {
      return sendError(res, 'COURSE_TERM_LIST_FAIL', error);
    }
  });

  router.get('/courses/terms/:id', async (req, res) => {
    try {
      return ok(res, await courseTerms.getTermDetails({ termId: req.params.id }), '固定班詳情');
    } catch (error) {
      return sendError(res, 'COURSE_TERM_DETAIL_FAIL', error);
    }
  });

  router.get('/courses/terms/:id/payment-options', ...withAuth(async (req, res) => (
    ok(res, await courseTerms.listPaymentOptions({
      termId: req.params.id,
      userId: req.user.id,
    }), '固定班可用付款工具')
  )));

  router.get('/courses/terms/:id/eligibility', ...withAuth(async (req, res) => (
    ok(res, await courseTerms.getTermEligibility({
      termId: req.params.id,
      userId: req.user.id,
      startSessionId: req.query?.startSessionId ?? req.query?.start_session_id,
    }), '固定班報名資格')
  )));

  router.post('/courses/terms/:id/quote', ...withAuth(async (req, res) => {
    const result = await courseTerms.createQuote({
      termId: req.params.id,
      userId: req.user.id,
      startSessionId: req.body?.startSessionId ?? req.body?.start_session_id,
      idempotencyKey: courseTerms.mutationKeyFromRequest(req),
      expectedTermRowVersion: courseTerms.rowVersionFromRequest(req),
    });
    res.setHeader('ETag', `W/"${result.rowVersion}"`);
    return ok(res, result, '固定班報價已鎖定');
  }));

  router.post('/courses/terms/checkout', ...withAuth(async (req, res) => {
    const result = await courseTerms.checkout({
      quoteCode: req.body?.quoteCode ?? req.body?.quote_code,
      userId: req.user.id,
      paymentMethod: req.body?.paymentMethod ?? req.body?.payment_method,
      courseTicketId: req.body?.courseTicketId ?? req.body?.course_ticket_id,
      trialTicketId: req.body?.trialTicketId ?? req.body?.trial_ticket_id,
      expectedTicketRowVersion: positiveInteger(
        req.get?.('X-Course-Ticket-If-Match')
          ?? req.headers?.['x-course-ticket-if-match']
          ?? req.body?.paymentTicketRowVersion
          ?? req.body?.payment_ticket_row_version
      ),
      termsAccepted: req.body?.termsAccepted ?? req.body?.terms_accepted,
      idempotencyKey: courseTerms.mutationKeyFromRequest(req),
      expectedQuoteRowVersion: courseTerms.rowVersionFromRequest(req),
    });
    return ok(res, result, '固定班訂單已建立');
  }));

  router.post('/courses/terms/:id/waitlist', ...withAuth(async (req, res) => {
    const result = await courseTerms.joinWaitlist({
      termId: req.params.id,
      userId: req.user.id,
      idempotencyKey: courseTerms.mutationKeyFromRequest(req),
      expectedTermRowVersion: courseTerms.rowVersionFromRequest(req),
    });
    return ok(res, result, '已加入固定班候補');
  }));

  router.post('/courses/orders/:id/payment-submissions', ...withAuth(async (req, res) => {
    const result = await courseTerms.submitBankTransfer({
      orderId: req.params.id,
      userId: req.user.id,
      last5: req.body?.last5 ?? req.body?.remittanceLast5 ?? req.body?.remittance_last5,
      idempotencyKey: courseTerms.mutationKeyFromRequest(req),
      expectedOrderRowVersion: courseTerms.rowVersionFromRequest(req),
    });
    return ok(res, result, '匯款資料已送出，席位保留至人工審核');
  }));

  router.get('/courses/me/enrollments', ...withAuth(async (req, res) => (
    ok(res, { items: await courseTerms.listMemberEnrollments({ userId: req.user.id }) }, '固定班報名')
  )));

  router.get('/courses/me/schedule', ...withAuth(async (req, res) => (
    ok(res, { items: await courseTerms.getMemberSchedule({ userId: req.user.id }) }, '固定班課表')
  )));

  router.get('/courses/me/makeup', ...withAuth(async (req, res) => (
    ok(res, { items: await courseTerms.listMakeupEntitlements({ userId: req.user.id }) }, '補課權益')
  )));

  router.get('/courses/me/makeup-credits', ...withAuth(async (req, res) => (
    ok(res, { items: await courseTerms.listMakeupEntitlements({ userId: req.user.id }) }, '補課權益')
  )));

  router.get('/courses/me/renewal-options', ...withAuth(async (req, res) => (
    ok(res, { items: await courseTerms.listRenewalOptions({ userId: req.user.id }) }, '續報資格')
  )));

  router.post('/courses/term-entitlements/:id/leave', ...withAuth(async (req, res) => {
    const result = await courseTerms.requestLeave({
      entitlementId: req.params.id,
      userId: req.user.id,
      reason: req.body?.reason,
      idempotencyKey: courseTerms.mutationKeyFromRequest(req),
      expectedRowVersion: courseTerms.rowVersionFromRequest(req),
    });
    return ok(res, result, '請假已核准並建立補課權益');
  }));

  router.post('/courses/term-leaves/:id/cancel', ...withAuth(async (req, res) => {
    const result = await courseTerms.cancelLeave({
      leaveId: req.params.id,
      userId: req.user.id,
      idempotencyKey: courseTerms.mutationKeyFromRequest(req),
      expectedRowVersion: courseTerms.rowVersionFromRequest(req),
    });
    return ok(res, result, '請假已取消，未使用補課權益已收回');
  }));

  router.post('/courses/makeup/:id/book', ...withAuth(async (req, res) => {
    const result = await courseTerms.bookMakeup({
      makeupEntitlementId: req.params.id,
      targetSessionId: req.body?.sessionId ?? req.body?.session_id,
      userId: req.user.id,
      idempotencyKey: courseTerms.mutationKeyFromRequest(req),
      expectedRowVersion: courseTerms.rowVersionFromRequest(req),
    });
    return ok(res, result, '補課場次已預約');
  }));

  router.post('/courses/makeup-bookings/:id/cancel', ...withAuth(async (req, res) => {
    const result = await courseTerms.transitionMakeupBooking({
      makeupBookingId: req.params.id,
      action: 'cancel',
      actorUserId: req.user.id,
      userId: req.user.id,
      reason: req.body?.reason,
      idempotencyKey: courseTerms.mutationKeyFromRequest(req),
      expectedRowVersion: courseTerms.rowVersionFromRequest(req),
    });
    return ok(res, result, '補課預約已取消，權益已釋放');
  }));

  router.get('/courses/me/notifications', ...withAuth(async (req, res) => {
    await courseTerms.assertSchema({ requirePayments: true });
    const limit = Math.max(1, Math.min(100, positiveInteger(req.query?.limit, 50)));
    const [rows] = await pool.query(
      `SELECT id, event_type, entity_type, entity_id, title, body,
              action_url, payload_json, read_at, row_version, created_at
         FROM course_user_notifications
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC LIMIT ?`,
      [req.user.id, limit]
    );
    const [unreadRows] = await pool.query(
      'SELECT COUNT(*) AS unread_count FROM course_user_notifications WHERE user_id = ? AND read_at IS NULL',
      [req.user.id]
    );
    return ok(res, { items: rows, unreadCount: Number(unreadRows[0]?.unread_count || 0) }, '課程通知');
  }));

  router.post('/courses/me/notifications/:id/read', ...withAuth(async (req, res) => {
    const result = await courseTerms.markNotificationRead({
      notificationId: req.params.id,
      userId: req.user.id,
      idempotencyKey: courseTerms.mutationKeyFromRequest(req),
      expectedRowVersion: courseTerms.rowVersionFromRequest(req),
    });
    res.setHeader('ETag', `W/"${result.rowVersion}"`);
    return ok(res, result, '課程通知已讀');
  }));

  router.post('/courses/makeup/:id/insurance-checkout', ...withAuth(async (req, res) => {
    const result = await courseTerms.createMakeupInsuranceCheckout({
      makeupEntitlementId: req.params.id,
      targetSessionId: req.body?.sessionId ?? req.body?.session_id,
      userId: req.user.id,
      idempotencyKey: courseTerms.mutationKeyFromRequest(req),
      expectedRowVersion: courseTerms.rowVersionFromRequest(req),
    });
    return ok(res, result, '補課保險訂單已建立，完成匯款後再送出後五碼');
  }));

  router.get('/admin/courses/terms', ...withAuth(async (req, res) => {
    const ownerUserId = await actorOwner(req, 'manageCatalog');
    return ok(res, { items: await courseTerms.listTerms({ ownerUserId, includeDraft: true }) }, '固定班管理列表');
  }));

  router.get('/admin/courses/enrollments', ...withAuth(async (req, res) => {
    const ownerUserId = await actorOwner(req, 'manageCatalog');
    const where = ownerUserId ? 'e.owner_user_id = ?' : 'e.owner_user_id IS NULL';
    const schema = await courseTerms.readSchemaState();
    const paymentReviewSelect = schema.paymentSchemaReady
      ? `o.pay_by_at,
              payment_submission.id AS payment_submission_id,
              payment_submission.status AS payment_submission_status,
              payment_submission.submitted_at AS payment_submitted_at,
              COALESCE(provider_payment_settings.bank_transfer_hold_hours,
                       platform_payment_settings.bank_transfer_hold_hours, 24) AS payment_review_sla_hours,
              TIMESTAMPADD(
                HOUR,
                COALESCE(provider_payment_settings.bank_transfer_hold_hours,
                         platform_payment_settings.bank_transfer_hold_hours, 24),
                payment_submission.submitted_at
              ) AS payment_review_sla_due_at,
              CASE
                WHEN payment_submission.status IN ('SUBMITTED','REVIEWING')
                 AND TIMESTAMPADD(
                   HOUR,
                   COALESCE(provider_payment_settings.bank_transfer_hold_hours,
                            platform_payment_settings.bank_transfer_hold_hours, 24),
                   payment_submission.submitted_at
                 ) < NOW()
                THEN 1 ELSE 0
              END AS payment_review_sla_overdue`
      : `NULL AS pay_by_at,
              NULL AS payment_submission_id,
              NULL AS payment_submission_status,
              NULL AS payment_submitted_at,
              NULL AS payment_review_sla_hours,
              NULL AS payment_review_sla_due_at,
              0 AS payment_review_sla_overdue`;
    const paymentReviewJoins = schema.paymentSchemaReady
      ? `LEFT JOIN course_payment_submissions payment_submission
           ON payment_submission.id = (
             SELECT latest_submission.id
               FROM course_payment_submissions latest_submission
              WHERE latest_submission.order_id = o.id
              ORDER BY latest_submission.submitted_at DESC, latest_submission.id DESC
              LIMIT 1
           )
         LEFT JOIN course_settings provider_payment_settings
           ON provider_payment_settings.scope_key = CONCAT('provider:', e.owner_user_id)
         LEFT JOIN course_settings platform_payment_settings
           ON platform_payment_settings.scope_key = 'platform'`
      : '';
    const [rows] = await pool.query(
      `SELECT e.*, t.code AS term_code, t.name AS term_name,
              s.display_name AS student_name, s.email AS student_email,
              o.code AS order_code, o.payment_status,
              ${paymentReviewSelect}
         FROM course_term_enrollments e
         JOIN course_terms t ON t.id = e.term_id
         JOIN course_students s ON s.id = e.student_id
         LEFT JOIN course_orders o ON o.id = e.order_id
         ${paymentReviewJoins}
        WHERE ${where} ORDER BY e.created_at DESC, e.id DESC`,
      ownerUserId ? [ownerUserId] : []
    );
    return ok(res, { items: rows }, '固定班報名管理');
  }));

  router.get('/admin/courses/students', ...withAuth(async (req, res) => {
    const ownerUserId = await actorOwner(req, 'manageCatalog');
    if (!ownerUserId) throw courseTermError('COURSE_TENANT_REQUIRED', '固定班學員查詢需要課程租戶', 400);
    const [rows] = await pool.query(
      `SELECT s.id, s.display_name, s.email, s.phone, s.status, s.row_version,
              level_record.level_id, level.name AS level_name,
              level_record.assessment_status,
              (SELECT COUNT(*) FROM course_term_enrollments e
                WHERE e.student_id = s.id AND e.status IN ('CONFIRMED','COMPLETED')) AS enrollment_count
         FROM course_students s
         LEFT JOIN course_student_level_records level_record
           ON level_record.student_id = s.id AND level_record.owner_user_id = ?
          AND level_record.is_current = 1
         LEFT JOIN course_levels level ON level.id = level_record.level_id
        WHERE s.owner_user_id = ? ORDER BY s.display_name, s.id`,
      [ownerUserId, ownerUserId]
    );
    return ok(res, { items: rows }, '固定班學員');
  }));

  router.get('/admin/courses/operations', ...withAuth(async (req, res) => {
    const ownerUserId = await actorOwner(req, 'manageAttendance');
    const [rows] = await pool.query(
      `SELECT se.*, s.title, s.starts_at, s.ends_at, s.location,
              student.display_name AS student_name,
              e.enrollment_code, t.name AS term_name
         FROM course_term_session_entitlements se
         JOIN course_sessions s ON s.id = se.session_id
         JOIN course_term_enrollments e ON e.id = se.enrollment_id
         JOIN course_terms t ON t.id = e.term_id
         JOIN course_students student ON student.id = se.student_id
        WHERE se.owner_user_id = ? AND s.starts_at BETWEEN DATE_SUB(NOW(), INTERVAL 7 DAY)
                                              AND DATE_ADD(NOW(), INTERVAL 30 DAY)
        ORDER BY s.starts_at, se.id`,
      [ownerUserId]
    );
    return ok(res, { items: rows }, '固定班課務');
  }));

  router.get('/admin/courses/makeup-bookings', ...withAuth(async (req, res) => {
    const ownerUserId = await actorOwner(req, 'manageAttendance');
    if (!ownerUserId) {
      throw courseTermError('COURSE_TENANT_REQUIRED', '補課預約查詢需要課程租戶', 400);
    }
    const status = text(req.query?.status, 24).toUpperCase();
    const allowedStatuses = new Set(['RESERVED', 'BOOKED', 'CANCELLED', 'ATTENDED', 'NO_SHOW']);
    if (status && !allowedStatuses.has(status)) {
      throw courseTermError('COURSE_MAKEUP_BOOKING_STATUS_INVALID', '補課預約狀態不正確', 400);
    }
    const limit = Math.max(1, Math.min(200, positiveInteger(req.query?.limit, 100)));
    const schema = await courseTerms.readSchemaState();
    const insuranceColumn = schema.paymentSchemaReady
      ? 'coverage.status AS insurance_status'
      : 'NULL AS insurance_status';
    const insuranceJoin = schema.paymentSchemaReady
      ? `LEFT JOIN course_makeup_insurance_coverages coverage
           ON coverage.makeup_booking_id = mb.id`
      : '';
    const [rows] = await pool.query(
      `SELECT mb.id, mb.code, mb.makeup_entitlement_id, mb.session_id,
              mb.user_id, mb.booking_id, mb.status, mb.booked_at,
              mb.cancelled_at, mb.attended_at, mb.row_version,
              m.code AS makeup_entitlement_code, m.valid_until,
              student.id AS student_id, student.display_name AS student_name,
              student.email AS student_email,
              session.code AS session_code, session.title AS session_title,
              session.starts_at, session.ends_at, session.location,
              source_term.id AS source_term_id, source_term.name AS source_term_name,
              enrollment.id AS enrollment_id, enrollment.enrollment_code,
              ${insuranceColumn}
         FROM course_makeup_bookings mb
         JOIN course_makeup_entitlements m ON m.id = mb.makeup_entitlement_id
         JOIN course_students student ON student.id = m.student_id
         JOIN course_sessions session ON session.id = mb.session_id
         JOIN course_term_enrollments enrollment ON enrollment.id = m.enrollment_id
         JOIN course_terms source_term ON source_term.id = enrollment.term_id
         ${insuranceJoin}
        WHERE mb.owner_user_id = ?
          ${status ? 'AND mb.status = ?' : ''}
        ORDER BY
          CASE WHEN mb.status = 'BOOKED' THEN 0 ELSE 1 END,
          session.starts_at, mb.id
        LIMIT ?`,
      [ownerUserId, ...(status ? [status] : []), limit]
    );
    return ok(res, {
      items: rows.map((row) => ({
        id: Number(row.id),
        code: row.code,
        makeupEntitlementId: Number(row.makeup_entitlement_id),
        makeupEntitlementCode: row.makeup_entitlement_code,
        sessionId: Number(row.session_id),
        sessionCode: row.session_code,
        sessionTitle: row.session_title,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        location: row.location || '',
        studentId: Number(row.student_id),
        studentName: row.student_name,
        studentEmail: row.student_email,
        sourceTermId: Number(row.source_term_id),
        sourceTermName: row.source_term_name,
        enrollmentId: Number(row.enrollment_id),
        enrollmentCode: row.enrollment_code,
        rosterBookingId: row.booking_id == null ? null : Number(row.booking_id),
        insuranceStatus: row.insurance_status || null,
        status: row.status,
        bookedAt: row.booked_at,
        cancelledAt: row.cancelled_at,
        attendedAt: row.attended_at,
        validUntil: row.valid_until,
        rowVersion: Number(row.row_version || 1),
      })),
    }, '固定班補課預約');
  }));

  for (const action of ['attend', 'no-show']) {
    router.post(`/admin/courses/makeup-bookings/:id/${action}`, ...withAuth(async (req, res) => {
      const ownerUserId = await assertManagedResource(req, {
        table: 'course_makeup_bookings',
        id: req.params.id,
        capability: 'manageAttendance',
      });
      const result = await courseTerms.transitionMakeupBooking({
        makeupBookingId: req.params.id,
        action: action === 'no-show' ? 'no_show' : 'attend',
        actorUserId: req.user.id,
        ownerUserId,
        reason: req.body?.reason,
        idempotencyKey: courseTerms.mutationKeyFromRequest(req),
        expectedRowVersion: courseTerms.rowVersionFromRequest(req),
      });
      return ok(res, result, action === 'attend' ? '補課已完成出席' : '補課已標記未到');
    }));
  }

  router.get('/admin/courses/makeup-routes', ...withAuth(async (req, res) => {
    const ownerUserId = await actorOwner(req, 'manageCatalog');
    if (!ownerUserId) throw courseTermError('COURSE_TENANT_REQUIRED', '補課路由需要課程租戶', 400);
    const items = await courseTerms.listMakeupRoutes({
      ownerUserId,
      sourceTermId: req.query?.sourceTermId ?? req.query?.source_term_id,
      status: req.query?.status,
    });
    return ok(res, { items }, '補課路由');
  }));

  router.post('/admin/courses/makeup-routes', ...withAuth(async (req, res) => {
    const ownerUserId = await actorOwner(req, 'manageCatalog');
    if (!ownerUserId) throw courseTermError('COURSE_TENANT_REQUIRED', '補課路由需要課程租戶', 400);
    const result = await courseTerms.createMakeupRoute({
      ownerUserId,
      actorUserId: req.user.id,
      body: req.body,
      idempotencyKey: courseTerms.mutationKeyFromRequest(req),
    });
    res.setHeader('ETag', `W/"${result.rowVersion}"`);
    return ok(res, result, '補課路由已建立');
  }));

  router.patch('/admin/courses/makeup-routes/:id', ...withAuth(async (req, res) => {
    const ownerUserId = await assertManagedResource(req, {
      table: 'course_makeup_routes',
      id: req.params.id,
      capability: 'manageCatalog',
    });
    const result = await courseTerms.updateMakeupRoute({
      routeId: req.params.id,
      ownerUserId,
      actorUserId: req.user.id,
      body: req.body,
      idempotencyKey: courseTerms.mutationKeyFromRequest(req),
      expectedRowVersion: courseTerms.rowVersionFromRequest(req),
    });
    res.setHeader('ETag', `W/"${result.rowVersion}"`);
    return ok(res, result, '補課路由已更新');
  }));

  router.get('/admin/courses/makeup-insurance-policies', ...withAuth(async (req, res) => {
    const ownerUserId = await actorOwner(req, 'manageCatalog');
    if (!ownerUserId) throw courseTermError('COURSE_TENANT_REQUIRED', '保險規則需要課程租戶', 400);
    const [rows] = await pool.query(
      `SELECT policy.*, session.code AS session_code, session.title AS session_title,
              session.starts_at, product.code AS fee_product_code,
              product.name AS fee_product_name
         FROM course_makeup_insurance_policies policy
         JOIN course_sessions session
           ON session.id = policy.target_session_id
          AND session.owner_user_id = policy.owner_user_id
         LEFT JOIN course_products product
           ON product.id = policy.fee_product_id
          AND product.owner_user_id = policy.owner_user_id
        WHERE policy.owner_user_id = ? ORDER BY session.starts_at DESC, policy.id DESC`,
      [ownerUserId]
    );
    return ok(res, { items: rows }, '補課保險規則');
  }));

  router.post('/admin/courses/makeup-insurance-policies', ...withAuth(async (req, res) => {
    const ownerUserId = await actorOwner(req, 'manageCatalog');
    if (!ownerUserId) throw courseTermError('COURSE_TENANT_REQUIRED', '保險規則需要課程租戶', 400);
    const result = await courseTermAdmin.createMakeupInsurancePolicy({
      ownerUserId,
      actorUserId: req.user.id,
      body: req.body,
      idempotencyKey: courseTerms.mutationKeyFromRequest(req),
    });
    res.setHeader('ETag', `W/"${result.rowVersion}"`);
    return ok(res, result, '補課保險規則已建立');
  }));

  router.patch('/admin/courses/makeup-insurance-policies/:id', ...withAuth(async (req, res) => {
    const ownerUserId = await assertManagedResource(req, {
      table: 'course_makeup_insurance_policies',
      id: req.params.id,
      capability: 'manageCatalog',
    });
    const result = await courseTermAdmin.updateMakeupInsurancePolicy({
      policyId: req.params.id,
      ownerUserId,
      actorUserId: req.user.id,
      body: req.body,
      idempotencyKey: courseTerms.mutationKeyFromRequest(req),
      expectedRowVersion: courseTerms.rowVersionFromRequest(req),
    });
    res.setHeader('ETag', `W/"${result.rowVersion}"`);
    return ok(res, result, '補課保險規則已更新');
  }));

  for (const action of ['attend', 'absent']) {
    router.post(`/admin/courses/term-entitlements/:id/${action}`, ...withAuth(async (req, res) => {
      const ownerUserId = await assertManagedResource(req, {
        table: 'course_term_session_entitlements',
        id: req.params.id,
        capability: 'manageAttendance',
      });
      const result = await courseTerms.markTermAttendance({
        entitlementId: req.params.id,
        action,
        actorUserId: req.user.id,
        ownerUserId,
        reason: req.body?.reason,
        idempotencyKey: courseTerms.mutationKeyFromRequest(req),
        expectedRowVersion: courseTerms.rowVersionFromRequest(req),
        allowOutsideWindow: true,
      });
      return ok(res, result, action === 'attend' ? '固定班已標記出席' : '固定班已標記缺席');
    }));
  }

  for (const action of ['attend', 'absent']) {
    router.post(`/courses/coach/term-entitlements/:id/${action}`, ...withAuth(async (req, res) => {
      await refreshCourseRequestUser(pool, req);
      const [rows] = await pool.query(
        `SELECT se.owner_user_id, se.session_id, s.coach_user_id,
                cp.user_id AS coach_profile_user_id
           FROM course_term_session_entitlements se
           JOIN course_sessions s ON s.id = se.session_id
           LEFT JOIN course_coach_profiles cp ON cp.id = s.coach_profile_id
          WHERE se.id = ? LIMIT 1`,
        [positiveInteger(req.params.id)]
      );
      const resource = rows[0];
      if (!resource) throw courseTermError('COURSE_TERM_ENTITLEMENT_NOT_FOUND', '找不到逐堂權益', 404);
      const assigned = String(resource.coach_user_id || '') === String(req.user.id)
        || String(resource.coach_profile_user_id || '') === String(req.user.id);
      if (!assigned) throw courseTermError('FORBIDDEN', '教練只能操作被指派場次', 403);
      const result = await courseTerms.markTermAttendance({
        entitlementId: req.params.id,
        action,
        actorUserId: req.user.id,
        ownerUserId: resource.owner_user_id,
        reason: req.body?.reason,
        idempotencyKey: courseTerms.mutationKeyFromRequest(req),
        expectedRowVersion: courseTerms.rowVersionFromRequest(req),
        allowOutsideWindow: false,
      });
      return ok(res, result, action === 'attend' ? '固定班已標記出席' : '固定班已標記缺席');
    }));
  }

  router.get('/courses/coach/sessions/:sessionId', ...withAuth(async (req, res) => {
    await refreshCourseRequestUser(pool, req);
    const sessionId = positiveInteger(req.params.sessionId);
    const [sessionRows] = await pool.query(
      `SELECT s.id, s.owner_user_id, s.coach_user_id, s.title, s.starts_at, s.ends_at,
              cp.user_id AS coach_profile_user_id
         FROM course_sessions s
         LEFT JOIN course_coach_profiles cp ON cp.id = s.coach_profile_id
        WHERE s.id = ? AND s.session_kind = 'TERM' LIMIT 1`,
      [sessionId]
    );
    const session = sessionRows[0];
    if (!session) throw courseTermError('COURSE_SESSION_NOT_FOUND', '找不到固定班場次', 404);
    const role = normalizeCoursePlatformRole(req.user?.role);
    const assigned = String(session.coach_user_id || '') === String(req.user.id)
      || String(session.coach_profile_user_id || '') === String(req.user.id);
    if (role !== 'ADMIN' && !assigned) {
      await authorize(req, { ownerUserId: session.owner_user_id, capability: 'manageAttendance' });
    }
    const [rows] = await pool.query(
      `SELECT se.*, student.display_name AS student_name,
              student.email AS student_email, e.enrollment_code
         FROM course_term_session_entitlements se
         JOIN course_students student ON student.id = se.student_id
         JOIN course_term_enrollments e ON e.id = se.enrollment_id
        WHERE se.session_id = ? ORDER BY student.display_name, se.id`,
      [sessionId]
    );
    return ok(res, { session, items: rows }, '教練固定班名冊');
  }));

  registerCourseTermAdminRoutes({ router, ctx, termDomain: courseTerms });
  return courseTerms;
}

module.exports = {
  registerCourseTermRoutes,
};
