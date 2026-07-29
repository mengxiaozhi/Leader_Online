const { createHash, randomBytes } = require('crypto');
const {
  createCourseV2Domain,
  mutationKeyFromRequest,
  rowVersionFromRequest,
  domainError,
} = require('../services/course-v2-domain');
const {
  derivePendingReview,
  resolveCourseCapabilities,
  resolveCoursePolicy,
  taipeiDateTimeMs,
} = require('../services/course-v2-policy');
const {
  shouldIncludeRequiredAddons,
  isBundleIssuableShopProductStatus,
  resolveReturningEligibility,
} = require('../services/course-v2-sales');

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

function booleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function normalizeRole(value) {
  return text(value, 32).toUpperCase();
}

function hasOwn(source, key) {
  return Boolean(source && Object.prototype.hasOwnProperty.call(source, key));
}

function normalizeResourceCode(value, { prefix = 'RESOURCE', generate = false } = {}) {
  const raw = text(value, 64);
  if (!raw && generate) return `${prefix}-${randomBytes(8).toString('hex').toUpperCase()}`;
  const normalized = raw.toUpperCase().replace(/\s+/g, '-');
  if (!normalized || !/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(normalized)) {
    throw domainError('VALIDATION_ERROR', '代碼僅能包含英數字、連字號與底線', 400);
  }
  return normalized;
}

function json(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function mysqlDateTime(value) {
  const timestamp = taipeiDateTimeMs(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

function ticketRowVersionFromRequest(req) {
  const raw = req?.get?.('X-Course-Ticket-If-Match')
    || req?.get?.('X-Ticket-If-Match')
    || req?.headers?.['x-course-ticket-if-match']
    || req?.headers?.['x-ticket-if-match']
    || req?.body?.expectedTicketRowVersion
    || req?.body?.expected_ticket_row_version
    || req?.body?.ticketRowVersion
    || req?.body?.ticket_row_version;
  return positiveInt(String(raw ?? '').replace(/^W\//, '').replace(/^"|"$/g, ''));
}

function registerCourseV2Routes({
  router,
  ctx,
  domain = null,
} = {}) {
  const {
    pool,
    ok,
    fail,
    authRequired,
    transporter,
    isMailerReady,
    EMAIL_FROM_NAME = 'Leader Online',
    EMAIL_FROM_ADDRESS = '',
    PUBLIC_WEB_URL = 'http://localhost:5173',
  } = ctx;
  const courseV2 = domain || createCourseV2Domain({ pool });

  function sendError(res, fallbackCode, error) {
    const code = error?.code || fallbackCode;
    const status = Number(error?.statusCode || error?.status || 500);
    if (error?.details && typeof res?.status === 'function' && typeof res?.json === 'function') {
      return res.status(status).json({
        ok: false,
        code,
        message: error.message || '課程新版處理失敗',
        details: error.details,
      });
    }
    return fail(res, code, error?.message || '課程新版處理失敗', status);
  }

  async function assertV2(res, { requireActive = true } = {}) {
    try {
      return await courseV2.assertSchema({ requireActive });
    } catch (error) {
      sendError(res, 'COURSE_V2_UNAVAILABLE', error);
      return null;
    }
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

  async function assignedCoachForSession(userId, sessionId) {
    if (!userId || !sessionId) return false;
    const [rows] = await pool.query(
      `SELECT s.id
         FROM course_sessions s
         LEFT JOIN course_coach_profiles cp ON cp.id = s.coach_profile_id
        WHERE s.id = ? AND (s.coach_user_id = ? OR cp.user_id = ?)
        LIMIT 1`,
      [sessionId, userId, userId]
    );
    return Boolean(rows[0]);
  }

  async function authorize(req, {
    ownerUserId,
    capability,
    sessionId = null,
  }) {
    const role = normalizeRole(req.user?.role);
    if (role === 'ADMIN') {
      return { ownerUserId, platformRole: role, capabilities: resolveCourseCapabilities({ platformRole: role }) };
    }
    if (!ownerUserId) throw domainError('FORBIDDEN', '平台課程僅限管理員操作', 403);
    if (role === 'SERVICE_PROVIDER' && String(req.user.id) === String(ownerUserId)) {
      return {
        ownerUserId,
        platformRole: role,
        capabilities: resolveCourseCapabilities({ platformRole: role }),
      };
    }
    const membership = await loadMembership(req.user.id, ownerUserId);
    const assignedCoach = sessionId
      ? await assignedCoachForSession(req.user.id, sessionId)
      : false;
    const capabilities = resolveCourseCapabilities({
      platformRole: role,
      membership,
      assignedCoach,
    });
    if (!capabilities[capability]) throw domainError('FORBIDDEN', '沒有此課程租戶的操作權限', 403);
    return { ownerUserId, platformRole: role, membership, assignedCoach, capabilities };
  }

  async function actorOwner(req, { capability = 'manageCatalog' } = {}) {
    const role = normalizeRole(req.user?.role);
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
      await authorize(req, { ownerUserId: req.user.id, capability });
      return req.user.id;
    }
    const [rows] = await pool.query(
      `SELECT owner_user_id
         FROM course_staff_memberships
        WHERE user_id = ? AND status = 'active'
          ${requested ? 'AND owner_user_id = ?' : ''}
        ORDER BY id LIMIT 2`,
      [req.user.id, ...(requested ? [requested] : [])]
    );
    if (rows.length !== 1) {
      throw domainError(
        'COURSE_TENANT_REQUIRED',
        rows.length ? '請指定要管理的課程服務商' : '沒有課程租戶權限',
        403
      );
    }
    await authorize(req, { ownerUserId: rows[0].owner_user_id, capability });
    return rows[0].owner_user_id;
  }

  async function bookingContext(bookingId) {
    const [rows] = await pool.query(
      `SELECT b.id, b.status, b.row_version, b.session_id, b.ticket_id,
              s.owner_user_id, s.starts_at, s.ends_at, s.booking_open_at,
              s.booking_close_at, s.booking_open_minutes_before,
              s.booking_close_minutes_before, s.cancel_close_minutes_before,
              s.redeem_open_at, s.redeem_close_at,
              s.redeem_open_minutes_before, s.redeem_close_minutes_after,
              s.settings_snapshot_json
         FROM course_bookings b JOIN course_sessions s ON s.id = b.session_id
        WHERE b.id = ? LIMIT 1`,
      [positiveInt(bookingId)]
    );
    return rows[0] || null;
  }

  async function sessionContext(sessionId) {
    const [rows] = await pool.query(
      'SELECT id, owner_user_id, row_version FROM course_sessions WHERE id = ? LIMIT 1',
      [positiveInt(sessionId)]
    );
    return rows[0] || null;
  }

  async function ticketContext(ticketId) {
    const [rows] = await pool.query(
      `SELECT t.id, t.row_version,
              COALESCE(t.provider_user_id_snapshot, tp.owner_user_id, p.owner_user_id) AS owner_user_id
         FROM course_tickets t
         LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
         LEFT JOIN course_products p ON p.id = t.product_id
        WHERE t.id = ? LIMIT 1`,
      [positiveInt(ticketId)]
    );
    return rows[0] || null;
  }

  function bookingCapabilities(booking, authz, policy) {
    const status = String(booking.status || '').toLowerCase();
    const manageAttendance = Boolean(authz?.capabilities?.manageAttendance);
    const privileged = normalizeRole(authz?.membership?.role) === 'OPS'
      || normalizeRole(authz?.platformRole) === 'ADMIN'
      || Boolean(authz?.capabilities?.manageCatalog);
    return {
      attend: manageAttendance && status === 'booked' && policy.canRedeemOnsite,
      undo: manageAttendance && ['attended', 'no_show'].includes(status) && policy.canRedeemOnsite,
      excusedLeave: manageAttendance && status === 'booked',
      noShow: manageAttendance
        && status === 'booked'
        && Date.now() >= policy.startsAt
        && (Date.now() <= Number(policy.redeemCloseAt) || privileged),
      makeupRedeem: manageAttendance
        && privileged
        && status === 'booked'
        && Date.now() > Number(policy.redeemCloseAt),
    };
  }

  async function withMutation(req, res, operation, work) {
    const idempotencyKey = mutationKeyFromRequest(req);
    if (!idempotencyKey) return fail(res, 'IDEMPOTENCY_KEY_REQUIRED', '此操作需要 Idempotency-Key', 400);
    try {
      const result = await work({ idempotencyKey, rowVersion: rowVersionFromRequest(req) });
      return ok(res, result);
    } catch (error) {
      return sendError(res, operation, error);
    }
  }

  router.get('/courses/v2/status', async (_req, res) => {
    try {
      const state = await courseV2.readRuntimeState();
      return ok(res, state);
    } catch (error) {
      return sendError(res, 'COURSE_V2_STATUS_FAIL', error);
    }
  });

  router.get('/courses/staff/me', authRequired, async (req, res) => {
    const platformRole = normalizeRole(req.user?.role);
    if (!courseV2.enabled) {
      const legacyRole = platformRole === 'STORE' ? 'SERVICE_PROVIDER' : platformRole;
      const legacyManager = ['ADMIN', 'SERVICE_PROVIDER'].includes(legacyRole);
      return ok(res, {
        enabled: false,
        memberships: [],
        capabilities: {
          manageCatalog: legacyManager,
          manageSettings: false,
          manageStaff: false,
          manageAttendance: legacyManager,
          viewReports: false,
        },
        assignedSessionIds: [],
      });
    }
    if (!await assertV2(res)) return undefined;
    try {
      const [membershipRows] = platformRole === 'ADMIN'
        ? [[]]
        : await pool.query(
          `SELECT m.*, owner.username AS owner_name
             FROM course_staff_memberships m
             JOIN users owner ON owner.id = m.owner_user_id
            WHERE m.user_id = ? AND m.status = 'active'
            ORDER BY m.owner_user_id, m.id`,
          [req.user.id]
        );
      const [assignedRows] = await pool.query(
        `SELECT s.id, s.owner_user_id
           FROM course_sessions s
           LEFT JOIN course_coach_profiles cp ON cp.id = s.coach_profile_id
          WHERE s.coach_user_id = ? OR cp.user_id = ?
          ORDER BY s.starts_at DESC, s.id DESC`,
        [req.user.id, req.user.id]
      );
      const assignedOwners = new Set(assignedRows.map((row) => String(row.owner_user_id || 'platform')));
      const memberships = membershipRows.map((membership) => {
        const assignedCoach = assignedOwners.has(String(membership.owner_user_id || 'platform'));
        return {
          id: Number(membership.id),
          ownerUserId: membership.owner_user_id,
          ownerName: membership.owner_name || '',
          role: membership.role,
          capabilities: resolveCourseCapabilities({
            platformRole,
            membership,
            assignedCoach,
          }),
          rowVersion: Number(membership.row_version || 1),
        };
      });
      const aggregate = platformRole === 'ADMIN'
        ? resolveCourseCapabilities({ platformRole })
        : memberships.reduce((result, membership) => {
          for (const key of ['manageCatalog', 'manageSettings', 'manageStaff', 'manageAttendance', 'viewReports']) {
            result[key] = result[key] || Boolean(membership.capabilities[key]);
          }
          return result;
        }, {
          manageCatalog: platformRole === 'SERVICE_PROVIDER',
          manageSettings: platformRole === 'SERVICE_PROVIDER',
          manageStaff: platformRole === 'SERVICE_PROVIDER',
          manageAttendance: platformRole === 'SERVICE_PROVIDER',
          viewReports: platformRole === 'SERVICE_PROVIDER',
        });
      if (platformRole === 'SERVICE_PROVIDER' && !memberships.some((item) => item.ownerUserId === req.user.id)) {
        memberships.unshift({
          id: null,
          ownerUserId: req.user.id,
          ownerName: req.user.username || '',
          role: 'provider',
          capabilities: resolveCourseCapabilities({ platformRole }),
          rowVersion: null,
        });
      }
      return ok(res, {
        enabled: true,
        memberships,
        capabilities: aggregate,
        assignedSessionIds: assignedRows.map((row) => Number(row.id)),
      });
    } catch (error) {
      return sendError(res, 'COURSE_STAFF_ME_FAIL', error);
    }
  });

  router.get('/courses/attendance-invites/preview', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    try {
      const token = text(req.query?.token, 500);
      if (!token) return fail(res, 'VALIDATION_ERROR', '缺少補登邀請 token', 400);
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const preview = await courseV2.withTransaction(async (conn) => {
        const [verifiedRows] = await conn.query(
          `SELECT u.email,
                  (
                    EXISTS(
                      SELECT 1 FROM email_verifications ev
                       WHERE LOWER(ev.email) = LOWER(u.email) AND ev.verified = 1
                    )
                    OR EXISTS(
                      SELECT 1 FROM oauth_identities oi
                       WHERE oi.user_id = u.id AND LOWER(COALESCE(oi.email, u.email)) = LOWER(u.email)
                    )
                  ) AS email_verified
             FROM users u WHERE u.id = ? LIMIT 1 FOR UPDATE`,
          [req.user.id]
        );
        if (verifiedRows[0]?.email_verified) {
          try {
            await courseV2.claimStudentForVerifiedEmail(conn, {
              userId: req.user.id,
              email: verifiedRows[0].email,
            });
          } catch (error) {
            if (error?.code !== 'COURSE_WRITES_FROZEN') throw error;
          }
        }
        const [rows] = await conn.query(
          `SELECT i.id, i.status, i.expires_at, i.auto_redeem_at, i.row_version,
                  i.session_id, s.title AS session_title, s.starts_at, s.ends_at,
                  t.code AS ticket_code, student.display_name AS student_name
             FROM course_attendance_invites i
             JOIN course_sessions s ON s.id = i.session_id
             LEFT JOIN course_tickets t ON t.id = i.ticket_id
             LEFT JOIN course_students student ON student.id = i.student_id
            WHERE i.token_hash = ? AND i.user_id = ?
            LIMIT 1`,
          [tokenHash, req.user.id]
        );
        return rows[0] || null;
      });
      if (!preview) return fail(res, 'COURSE_ATTENDANCE_INVITE_NOT_FOUND', '找不到補登邀請', 404);
      return ok(res, {
        id: Number(preview.id),
        status: preview.status,
        sessionId: Number(preview.session_id),
        sessionTitle: preview.session_title,
        startsAt: preview.starts_at,
        endsAt: preview.ends_at,
        ticketCode: preview.ticket_code || '',
        studentName: preview.student_name || '',
        expiresAt: preview.expires_at,
        autoRedeemAt: preview.auto_redeem_at,
        rowVersion: Number(preview.row_version || 1),
        confirmable: preview.status === 'pending' && taipeiDateTimeMs(preview.expires_at) >= Date.now(),
      });
    } catch (error) {
      return sendError(res, 'COURSE_ATTENDANCE_INVITE_PREVIEW_FAIL', error);
    }
  });

  router.get(
    '/courses/products/:id/preview',
    (req, res, next) => (courseV2.enabled ? authRequired(req, res, next) : next()),
    async (req, res) => {
    const quantity = positiveInt(req.query?.quantity, 1, 10);
    if (!courseV2.enabled) {
      try {
        const [rows] = await pool.query(
          `SELECT id, code, name, price, class_count, status
             FROM course_products WHERE id = ? AND status = 'published' LIMIT 1`,
          [positiveInt(req.params.id)]
        );
        if (!rows[0]) return fail(res, 'COURSE_PRODUCT_NOT_FOUND', '找不到課程銷售方案', 404);
        return ok(res, {
          courseV2Enabled: false,
          returningEligibility: 'unknown',
          items: [{
            shopProductId: Number(rows[0].id),
            code: rows[0].code,
            name: rows[0].name,
            itemType: 'main',
            quantity,
            unitPrice: Number(rows[0].price || 0),
            lineTotal: Number(rows[0].price || 0) * quantity,
          }],
          totalAmount: Number(rows[0].price || 0) * quantity,
        });
      } catch (error) {
        return sendError(res, 'COURSE_ORDER_PREVIEW_FAIL', error);
      }
    }
    if (!await assertV2(res)) return undefined;
    try {
      const [productRows] = await pool.query(
        `SELECT p.*, tp.name AS ticket_product_name, tp.code AS ticket_product_code
           FROM course_products p
           JOIN course_ticket_products tp ON tp.id = p.ticket_product_id
          WHERE p.id = ? AND p.status = 'published' LIMIT 1`,
        [positiveInt(req.params.id)]
      );
      const product = productRows[0];
      if (!product) return fail(res, 'COURSE_PRODUCT_NOT_FOUND', '找不到課程銷售方案', 404);
      const [addonRows] = await pool.query(
        `SELECT requirement.quantity, addon.id, addon.code, addon.name, addon.price,
                addon.ticket_product_id, addon.owner_user_id, addon.status,
                tp.code AS ticket_product_code,
                tp.name AS ticket_product_name
           FROM course_product_required_addons requirement
           JOIN course_products addon ON addon.id = requirement.addon_product_id
           JOIN course_ticket_products tp ON tp.id = addon.ticket_product_id
          WHERE requirement.product_id = ?
          ORDER BY addon.sort_order, addon.id`,
        [product.id]
      );
      const [componentRows] = await pool.query(
        `SELECT c.ticket_product_id, c.component_role, c.quantity, c.sort_order,
                tp.code, tp.name, tp.class_count
           FROM course_shop_product_components c
           JOIN course_ticket_products tp ON tp.id = c.ticket_product_id
          WHERE c.shop_product_id = ?
          ORDER BY c.sort_order, c.ticket_product_id`,
        [product.id]
      );
      const invalidAddon = addonRows.find((addon) => (
        !isBundleIssuableShopProductStatus(addon.status)
        || String(addon.owner_user_id || '') !== String(product.owner_user_id || '')
      ));
      if (invalidAddon) {
        return fail(res, 'COURSE_REQUIRED_ADDON_UNAVAILABLE', '必要加購品已停用或租戶已變更', 409);
      }
      const returningEligible = await resolveReturningEligibility(pool, {
        productId: product.id,
        userId: req.user.id,
      });
      const requireAddonForNew = Boolean(Number(product.require_addon_for_new || 0));
      const includeRequiredAddons = shouldIncludeRequiredAddons(
        requireAddonForNew,
        returningEligible
      );
      if (includeRequiredAddons && !addonRows.length) {
        return fail(
          res,
          'COURSE_REQUIRED_ADDON_UNAVAILABLE',
          '此銷售方案要求新生加購，但尚未設定可發行的必要加購品',
          409
        );
      }
      const items = [{
        shopProductId: Number(product.id),
        ticketProductId: Number(product.ticket_product_id),
        code: product.code,
        name: product.name,
        itemType: 'main',
        quantity,
        unitPrice: Number(product.price || 0),
        lineTotal: Number(product.price || 0) * quantity,
      }, ...(includeRequiredAddons ? addonRows : []).map((addon) => {
        const addonQuantity = Number(addon.quantity || 1) * quantity;
        return {
          shopProductId: Number(addon.id),
          ticketProductId: Number(addon.ticket_product_id),
          code: addon.code,
          name: addon.name,
          itemType: 'required_addon',
          quantity: addonQuantity,
          unitPrice: Number(addon.price || 0),
          lineTotal: Number(addon.price || 0) * addonQuantity,
        };
      })];
      return ok(res, {
        courseV2Enabled: true,
        productId: Number(product.id),
        rowVersion: Number(product.row_version || 1),
        returningStudentOnly: false,
        requireAddonForNew,
        returningEligible,
        addonRequired: includeRequiredAddons && addonRows.length > 0,
        components: componentRows.map((row) => ({
          ticketProductId: Number(row.ticket_product_id),
          code: row.code,
          name: row.name,
          classCount: Number(row.class_count),
          role: row.component_role,
          quantity: Number(row.quantity),
        })),
        items,
        totalAmount: items.reduce((sum, item) => sum + item.lineTotal, 0),
      });
    } catch (error) {
      return sendError(res, 'COURSE_ORDER_PREVIEW_FAIL', error);
    }
    }
  );

  router.get('/courses/sessions/:id/eligibility', authRequired, async (req, res) => {
    if (!courseV2.enabled) {
      return ok(res, {
        courseV2Enabled: false,
        eligible: false,
        selectedTicketId: null,
        tickets: [],
        reason: '課程新版尚未切換',
      });
    }
    if (!await assertV2(res)) return undefined;
    try {
      return ok(res, {
        courseV2Enabled: true,
        ...await courseV2.getSessionEligibility({
          sessionId: req.params.id,
          userId: req.user.id,
          ticketId: req.query?.ticketId ?? req.query?.ticket_id,
        }),
      });
    } catch (error) {
      return sendError(res, 'COURSE_SESSION_ELIGIBILITY_FAIL', error);
    }
  });

  router.get('/courses/tickets/:id/ledger', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    try {
      const [ticketRows] = await pool.query(
        `SELECT t.id
           FROM course_tickets t
           LEFT JOIN course_students student ON student.id = t.student_id
          WHERE t.id = ? AND (t.user_id = ? OR student.user_id = ?)
          LIMIT 1`,
        [positiveInt(req.params.id), req.user.id, req.user.id]
      );
      if (!ticketRows[0]) return fail(res, 'COURSE_TICKET_NOT_FOUND', '找不到課程票券', 404);
      const balance = await courseV2.ledgerBalance(pool, req.params.id);
      const items = await courseV2.listTicketLedger({
        ticketId: req.params.id,
        userId: req.user.id,
        limit: req.query?.limit,
      });
      return ok(res, {
        balance: {
          remainingUses: balance.remainingUses,
          heldUses: balance.heldUses,
          availableUses: balance.availableUses,
          rowVersion: Number(balance.ticket.row_version || 1),
        },
        items,
      });
    } catch (error) {
      return sendError(res, 'COURSE_TICKET_LEDGER_FAIL', error);
    }
  });

  router.post('/courses/attendance-invites/confirm', authRequired, (req, res) => withMutation(
    req,
    res,
    'COURSE_ATTENDANCE_INVITE_CONFIRM_FAIL',
    ({ idempotencyKey, rowVersion }) => courseV2.confirmAttendanceInvite({
      token: req.body?.token,
      userId: req.user.id,
      idempotencyKey,
      expectedRowVersion: rowVersion,
    })
  ));

  for (const action of ['attend', 'undo', 'excused-leave', 'no-show', 'makeup-redeem']) {
    router.post(`/admin/courses/bookings/:id/${action}`, authRequired, async (req, res, next) => {
      if (action === 'attend' && !courseV2.enabled) return next();
      if (!await assertV2(res)) return undefined;
      const booking = await bookingContext(req.params.id);
      if (!booking) return fail(res, 'COURSE_BOOKING_NOT_FOUND', '找不到課程預約', 404);
      let authz;
      try {
        authz = await authorize(req, {
          ownerUserId: booking.owner_user_id,
          capability: 'manageAttendance',
          sessionId: booking.session_id,
        });
        if (action === 'makeup-redeem' && authz.membership?.role === 'coach') {
          throw domainError('FORBIDDEN', '教練不能執行窗外補登核銷', 403);
        }
        if (action === 'no-show' && normalizeRole(authz.membership?.role) === 'COACH') {
          const { policy } = await courseV2.getBookingPolicy(booking.id);
          if (Date.now() > Number(policy.redeemCloseAt)) {
            throw domainError('FORBIDDEN', '教練只能在現場核銷截止前標記 NO SHOW', 403);
          }
        }
      } catch (error) {
        return sendError(res, 'COURSE_ATTENDANCE_FORBIDDEN', error);
      }
      return withMutation(
        req,
        res,
        `COURSE_${action.toUpperCase().replace(/-/g, '_')}_FAIL`,
        ({ idempotencyKey, rowVersion }) => courseV2.attendanceAction({
          bookingId: req.params.id,
          action,
          actorUserId: req.user.id,
          idempotencyKey,
          expectedRowVersion: rowVersion,
          note: req.body?.note,
        })
      );
    });
  }

  router.post('/admin/courses/sessions/:id/walk-ins', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    const session = await sessionContext(req.params.id);
    if (!session) return fail(res, 'COURSE_SESSION_NOT_FOUND', '找不到課程場次', 404);
    try {
      await authorize(req, {
        ownerUserId: session.owner_user_id,
        capability: 'manageAttendance',
        sessionId: session.id,
      });
    } catch (error) {
      return sendError(res, 'COURSE_WALK_IN_FORBIDDEN', error);
    }
    return withMutation(req, res, 'COURSE_WALK_IN_FAIL', ({ idempotencyKey, rowVersion }) => (
      courseV2.createWalkIn({
        sessionId: session.id,
        studentId: req.body?.studentId ?? req.body?.student_id,
        userId: req.body?.userId ?? req.body?.user_id,
        ticketId: req.body?.ticketId ?? req.body?.ticket_id,
        attendeeName: req.body?.attendeeName ?? req.body?.attendee_name,
        attendeeEmail: req.body?.attendeeEmail ?? req.body?.attendee_email,
        actorUserId: req.user.id,
        idempotencyKey,
        expectedSessionRowVersion: rowVersion,
        expectedTicketRowVersion: ticketRowVersionFromRequest(req),
        note: req.body?.note,
      })
    ));
  });

  router.get('/admin/courses/sessions/:id/eligibility', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    const session = await sessionContext(req.params.id);
    if (!session) return fail(res, 'COURSE_SESSION_NOT_FOUND', '找不到課程場次', 404);
    try {
      await authorize(req, {
        ownerUserId: session.owner_user_id,
        capability: 'manageAttendance',
        sessionId: session.id,
      });
      const attendeeEmail = text(
        req.query?.attendeeEmail ?? req.query?.attendee_email,
        255
      ).toLowerCase();
      let studentId = positiveInt(req.query?.studentId ?? req.query?.student_id);
      let userId = text(req.query?.userId ?? req.query?.user_id, 36) || null;
      if (!studentId && !userId && attendeeEmail) {
        const [studentRows] = await pool.query(
          `SELECT id, user_id FROM course_students
            WHERE owner_user_id <=> ? AND email_normalized = ?
            LIMIT 1`,
          [session.owner_user_id, attendeeEmail]
        );
        studentId = studentRows[0]?.id || null;
        userId = studentRows[0]?.user_id || null;
        if (!studentId && !userId) {
          const [userRows] = await pool.query(
            'SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1',
            [attendeeEmail]
          );
          userId = userRows[0]?.id || null;
        }
      }
      if (!studentId && !userId && !attendeeEmail) {
        return fail(res, 'COURSE_ATTENDEE_REQUIRED', '請輸入學員 Email', 400);
      }
      const eligibility = await courseV2.getSessionEligibility({
        sessionId: session.id,
        userId,
        studentId,
        ownerEmail: attendeeEmail,
        ticketId: req.query?.ticketId ?? req.query?.ticket_id,
      });
      return ok(res, {
        courseV2Enabled: true,
        attendee: { userId, studentId, email: attendeeEmail },
        ...eligibility,
      });
    } catch (error) {
      return sendError(res, 'ADMIN_COURSE_SESSION_ELIGIBILITY_FAIL', error);
    }
  });

  router.post('/admin/courses/sessions/:id/attendance-invites', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    const session = await sessionContext(req.params.id);
    if (!session) return fail(res, 'COURSE_SESSION_NOT_FOUND', '找不到課程場次', 404);
    try {
      await authorize(req, {
        ownerUserId: session.owner_user_id,
        capability: 'manageAttendance',
        sessionId: session.id,
      });
    } catch (error) {
      return sendError(res, 'COURSE_ATTENDANCE_INVITE_FORBIDDEN', error);
    }
    return withMutation(req, res, 'COURSE_ATTENDANCE_INVITE_CREATE_FAIL', async ({ idempotencyKey, rowVersion }) => {
      const result = await courseV2.createAttendanceInvite({
        sessionId: session.id,
        studentId: req.body?.studentId ?? req.body?.student_id,
        userId: req.body?.userId ?? req.body?.user_id,
        attendeeEmail: req.body?.attendeeEmail ?? req.body?.attendee_email,
        ticketId: req.body?.ticketId ?? req.body?.ticket_id,
        actorUserId: req.user.id,
        idempotencyKey,
        expectedSessionRowVersion: rowVersion,
        expectedTicketRowVersion: ticketRowVersionFromRequest(req),
      });
      if (!result.token) return result;
      const inviteUrl = `${String(PUBLIC_WEB_URL).replace(/\/+$/, '')}/store?tab=courses&attendanceInvite=${encodeURIComponent(result.token)}&version=${encodeURIComponent(result.rowVersion || 1)}`;
      const [recipientRows] = await pool.query(
        `SELECT COALESCE(s.email, u.email) AS email,
                COALESCE(s.display_name, u.username, '') AS display_name
           FROM course_attendance_invites i
           LEFT JOIN course_students s ON s.id = i.student_id
           LEFT JOIN users u ON u.id = i.user_id
          WHERE i.id = ? LIMIT 1`,
        [result.id]
      );
      const recipient = recipientRows[0] || {};
      let deliveryStatus = recipient.email ? 'not_configured' : 'missing_email';
      const ready = typeof isMailerReady === 'function'
        ? Boolean(isMailerReady())
        : Boolean(transporter && EMAIL_FROM_ADDRESS);
      if (recipient.email && ready && transporter) {
        try {
          await transporter.sendMail({
            from: `"${EMAIL_FROM_NAME}" <${EMAIL_FROM_ADDRESS}>`,
            to: recipient.email,
            subject: 'Leader Online 課程補登邀請',
            text: `${recipient.display_name || '您好'}，請登入確認課程出席：${inviteUrl}`,
            html: `<p>${text(recipient.display_name, 255) || '您好'}，請登入確認課程出席：</p><p><a href="${inviteUrl}">確認課程補登</a></p>`,
          });
          deliveryStatus = 'sent';
        } catch (_) {
          deliveryStatus = 'failed';
        }
      }
      return { ...result, inviteUrl, deliveryStatus };
    });
  });

  router.get('/admin/courses/attendance-invites', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    try {
      const ownerUserId = await actorOwner(req, { capability: 'manageAttendance' });
      const [rows] = await pool.query(
        `SELECT i.*, s.title AS session_title, student.display_name AS student_name,
                student.email AS student_email, t.code AS ticket_code
           FROM course_attendance_invites i
           JOIN course_sessions s ON s.id = i.session_id
           LEFT JOIN course_students student ON student.id = i.student_id
           LEFT JOIN course_tickets t ON t.id = i.ticket_id
          WHERE i.owner_user_id <=> ?
          ORDER BY i.created_at DESC, i.id DESC LIMIT ?`,
        [ownerUserId, Math.min(positiveInt(req.query?.limit, 100), 500)]
      );
      return ok(res, rows.map((row) => ({
        id: Number(row.id),
        sessionId: Number(row.session_id),
        sessionTitle: row.session_title,
        studentId: row.student_id == null ? null : Number(row.student_id),
        studentName: row.student_name || '',
        studentEmail: row.student_email || '',
        ticketId: row.ticket_id == null ? null : Number(row.ticket_id),
        ticketCode: row.ticket_code || '',
        status: row.status,
        expiresAt: row.expires_at,
        autoRedeemAt: row.auto_redeem_at,
        rowVersion: Number(row.row_version || 1),
      })));
    } catch (error) {
      return sendError(res, 'ADMIN_COURSE_ATTENDANCE_INVITES_FAIL', error);
    }
  });

  router.post('/admin/courses/tickets/:id/adjustments', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    const ticket = await ticketContext(req.params.id);
    if (!ticket) return fail(res, 'COURSE_TICKET_NOT_FOUND', '找不到課程票券', 404);
    try {
      await authorize(req, { ownerUserId: ticket.owner_user_id, capability: 'manageCatalog' });
    } catch (error) {
      return sendError(res, 'COURSE_TICKET_ADJUST_FORBIDDEN', error);
    }
    return withMutation(req, res, 'COURSE_TICKET_ADJUST_FAIL', ({ idempotencyKey, rowVersion }) => (
      courseV2.adjustTicket({
        ticketId: ticket.id,
        deltaUses: req.body?.deltaUses ?? req.body?.delta_uses,
        actorUserId: req.user.id,
        idempotencyKey,
        expectedRowVersion: rowVersion,
        note: req.body?.note,
        reason: req.body?.reason,
      })
    ));
  });

  router.post('/admin/courses/tickets/:id/refunds', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    const ticket = await ticketContext(req.params.id);
    if (!ticket) return fail(res, 'COURSE_TICKET_NOT_FOUND', '找不到課程票券', 404);
    try {
      await authorize(req, { ownerUserId: ticket.owner_user_id, capability: 'manageCatalog' });
    } catch (error) {
      return sendError(res, 'COURSE_TICKET_REFUND_FORBIDDEN', error);
    }
    return withMutation(req, res, 'COURSE_TICKET_REFUND_FAIL', ({ idempotencyKey, rowVersion }) => (
      courseV2.refundTicket({
        ticketId: ticket.id,
        actorUserId: req.user.id,
        idempotencyKey,
        expectedRowVersion: rowVersion,
        note: req.body?.note,
        reason: req.body?.reason,
      })
    ));
  });

  for (const action of ['freeze', 'unfreeze']) {
    router.post(`/admin/courses/tickets/:id/${action}`, authRequired, async (req, res) => {
      if (!await assertV2(res)) return undefined;
      const ticket = await ticketContext(req.params.id);
      if (!ticket) return fail(res, 'COURSE_TICKET_NOT_FOUND', '找不到課程票券', 404);
      try {
        await authorize(req, {
          ownerUserId: ticket.owner_user_id,
          capability: 'manageCatalog',
        });
      } catch (error) {
        return sendError(res, 'COURSE_TICKET_FREEZE_FORBIDDEN', error);
      }
      return withMutation(
        req,
        res,
        `COURSE_TICKET_${action.toUpperCase()}_FAIL`,
        ({ idempotencyKey, rowVersion }) => courseV2.changeTicketFreeze({
          ticketId: ticket.id,
          actorUserId: req.user.id,
          action,
          reason: req.body?.reason,
          idempotencyKey,
          expectedRowVersion: rowVersion,
        })
      );
    });
  }

  router.get('/admin/courses/ticket-products', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    try {
      const ownerUserId = await actorOwner(req, { capability: 'manageCatalog' });
      const globalList = normalizeRole(req.user?.role) === 'ADMIN' && !ownerUserId;
      const [rows] = await pool.query(
        `SELECT * FROM course_ticket_products
          WHERE ${globalList ? '1 = 1' : 'owner_user_id <=> ?'}
          ORDER BY created_at DESC, id DESC`,
        globalList ? [] : [ownerUserId]
      );
      return ok(res, rows.map((row) => ({
        id: Number(row.id),
        ownerUserId: row.owner_user_id,
        code: row.code,
        name: row.name,
        description: row.description || '',
        classCount: Number(row.class_count),
        validDays: Number(row.valid_days),
        activationDays: Number(row.activation_days),
        transferable: Boolean(Number(row.transferable)),
        maxTransfers: Number(row.max_transfers),
        termsText: row.terms_text || '',
        redemptionPolicy: json(row.redemption_policy_json, {}),
        status: row.status,
        rowVersion: Number(row.row_version || 1),
      })));
    } catch (error) {
      return sendError(res, 'ADMIN_COURSE_TICKET_PRODUCTS_FAIL', error);
    }
  });

  router.post('/admin/courses/ticket-products', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    let ownerUserId;
    try {
      ownerUserId = await actorOwner(req, { capability: 'manageCatalog' });
    } catch (error) {
      return sendError(res, 'ADMIN_COURSE_TICKET_PRODUCT_FORBIDDEN', error);
    }
    return withMutation(req, res, 'ADMIN_COURSE_TICKET_PRODUCT_CREATE_FAIL', ({ idempotencyKey }) => (
      courseV2.withMutationTransaction(async (conn) => {
        const operation = 'ticket-product.create';
        const mutation = await courseV2.claimMutation(conn, {
          actorUserId: req.user.id,
          operation,
          idempotencyKey,
          payload: { ownerUserId, ...req.body },
          resourceType: 'ticket_product',
        });
        if (mutation.replay) return mutation.replay;
        const code = text(req.body?.code, 64).toUpperCase();
        const name = text(req.body?.name, 255);
        if (!code || !name) throw domainError('VALIDATION_ERROR', '請填寫票券產品代碼與名稱', 400);
        const [insert] = await conn.query(
          `INSERT INTO course_ticket_products
            (owner_user_id, code, name, description, class_count, valid_days,
             activation_days, transferable, max_transfers, terms_text,
             redemption_policy_json, status, row_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            ownerUserId,
            code,
            name,
            text(req.body?.description, 2000) || null,
            positiveInt(req.body?.classCount ?? req.body?.class_count, 1, 9999),
            positiveInt(req.body?.validDays ?? req.body?.valid_days, 120, 3650),
            positiveInt(req.body?.activationDays ?? req.body?.activation_days, 120, 3650),
            booleanFlag(req.body?.transferable, false) ? 1 : 0,
            nonNegativeInt(req.body?.maxTransfers ?? req.body?.max_transfers, 1, 100),
            text(req.body?.termsText ?? req.body?.terms_text, 20000) || null,
            JSON.stringify(req.body?.redemptionPolicy ?? req.body?.redemption_policy_json ?? {}),
            text(req.body?.status, 24) || 'draft',
          ]
        );
        const response = { id: Number(insert.insertId), rowVersion: 1 };
        await courseV2.completeMutation(conn, req.user.id, operation, mutation, response, {
          type: 'ticket_product',
          id: insert.insertId,
        });
        return response;
      })
    ));
  });

  router.patch('/admin/courses/ticket-products/:id', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    const [currentRows] = await pool.query(
      'SELECT * FROM course_ticket_products WHERE id = ? LIMIT 1',
      [positiveInt(req.params.id)]
    );
    const current = currentRows[0];
    if (!current) return fail(res, 'COURSE_TICKET_PRODUCT_NOT_FOUND', '找不到票券產品', 404);
    try {
      await authorize(req, { ownerUserId: current.owner_user_id, capability: 'manageCatalog' });
    } catch (error) {
      return sendError(res, 'ADMIN_COURSE_TICKET_PRODUCT_FORBIDDEN', error);
    }
    return withMutation(req, res, 'ADMIN_COURSE_TICKET_PRODUCT_UPDATE_FAIL', ({ idempotencyKey, rowVersion }) => (
      courseV2.withMutationTransaction(async (conn) => {
        if (!rowVersion) throw domainError('COURSE_ROW_VERSION_REQUIRED', '更新需要 If-Match', 428);
        const operation = 'ticket-product.update';
        const mutation = await courseV2.claimMutation(conn, {
          actorUserId: req.user.id,
          operation,
          idempotencyKey,
          payload: { id: current.id, rowVersion, ...req.body },
          resourceType: 'ticket_product',
          resourceId: current.id,
        });
        if (mutation.replay) return mutation.replay;
        const [result] = await conn.query(
          `UPDATE course_ticket_products
              SET name = ?, description = ?, class_count = ?, valid_days = ?,
                  activation_days = ?, transferable = ?, max_transfers = ?,
                  terms_text = ?, redemption_policy_json = ?, status = ?,
                  row_version = row_version + 1
            WHERE id = ? AND row_version = ?`,
          [
            text(req.body?.name ?? current.name, 255),
            text(req.body?.description ?? current.description, 2000) || null,
            positiveInt(req.body?.classCount ?? req.body?.class_count, Number(current.class_count), 9999),
            positiveInt(req.body?.validDays ?? req.body?.valid_days, Number(current.valid_days), 3650),
            positiveInt(req.body?.activationDays ?? req.body?.activation_days, Number(current.activation_days), 3650),
            booleanFlag(req.body?.transferable, Boolean(current.transferable)) ? 1 : 0,
            nonNegativeInt(req.body?.maxTransfers ?? req.body?.max_transfers, Number(current.max_transfers), 100),
            text(req.body?.termsText ?? req.body?.terms_text ?? current.terms_text, 20000) || null,
            JSON.stringify(req.body?.redemptionPolicy ?? json(current.redemption_policy_json, {})),
            text(req.body?.status ?? current.status, 24),
            current.id,
            rowVersion,
          ]
        );
        if (!result.affectedRows) throw domainError('COURSE_ROW_VERSION_CONFLICT', '票券產品已變更，請重新載入', 409);
        const response = { id: Number(current.id), rowVersion: rowVersion + 1 };
        await courseV2.completeMutation(conn, req.user.id, operation, mutation, response, {
          type: 'ticket_product',
          id: current.id,
        });
        return response;
      })
    ));
  });

  router.get('/admin/courses/scenarios', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    try {
      const ownerUserId = await actorOwner(req, { capability: 'manageCatalog' });
      const globalList = normalizeRole(req.user?.role) === 'ADMIN' && !ownerUserId;
      const [rows] = await pool.query(
        `SELECT s.*,
                COALESCE(JSON_ARRAYAGG(
                  IF(ap.ticket_product_id IS NULL, NULL, JSON_OBJECT(
                    'ticketProductId', ap.ticket_product_id,
                    'priority', ap.priority,
                    'redeemOpenMinutesBefore', ap.redeem_open_minutes_before,
                    'redeemCloseMinutesAfter', ap.redeem_close_minutes_after
                  ))
                ), JSON_ARRAY()) AS allowed_products
           FROM course_redeem_scenarios s
           LEFT JOIN course_scenario_allowed_products ap ON ap.scenario_id = s.id
          WHERE ${globalList ? '1 = 1' : 's.owner_user_id <=> ?'}
          GROUP BY s.id ORDER BY s.created_at DESC, s.id DESC`,
        globalList ? [] : [ownerUserId]
      );
      return ok(res, rows.map((row) => ({
        id: Number(row.id),
        code: row.code,
        name: row.name,
        description: row.description || '',
        status: row.status,
        redeemOpenMinutesBefore: row.redeem_open_minutes_before == null ? null : Number(row.redeem_open_minutes_before),
        redeemCloseMinutesAfter: row.redeem_close_minutes_after == null ? null : Number(row.redeem_close_minutes_after),
        allowedProducts: (json(row.allowed_products, []) || []).filter(Boolean),
        rowVersion: Number(row.row_version || 1),
      })));
    } catch (error) {
      return sendError(res, 'ADMIN_COURSE_SCENARIOS_FAIL', error);
    }
  });

  router.post('/admin/courses/scenarios', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    let ownerUserId;
    try {
      ownerUserId = await actorOwner(req, { capability: 'manageCatalog' });
    } catch (error) {
      return sendError(res, 'ADMIN_COURSE_SCENARIO_FORBIDDEN', error);
    }
    return withMutation(req, res, 'ADMIN_COURSE_SCENARIO_CREATE_FAIL', ({ idempotencyKey }) => (
      courseV2.withMutationTransaction(async (conn) => {
        const operation = 'scenario.create';
        const mutation = await courseV2.claimMutation(conn, {
          actorUserId: req.user.id,
          operation,
          idempotencyKey,
          payload: { ownerUserId, ...req.body },
          resourceType: 'scenario',
        });
        if (mutation.replay) return mutation.replay;
        const code = text(req.body?.code, 64).toUpperCase();
        const name = text(req.body?.name, 255);
        if (!code || !name) throw domainError('VALIDATION_ERROR', '請填寫 Scenario 代碼與名稱', 400);
        const [insert] = await conn.query(
          `INSERT INTO course_redeem_scenarios
            (owner_user_id, code, name, description, status,
             redeem_open_minutes_before, redeem_close_minutes_after, row_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            ownerUserId,
            code,
            name,
            text(req.body?.description, 2000) || null,
            text(req.body?.status, 24) || 'active',
            req.body?.redeemOpenMinutesBefore ?? null,
            req.body?.redeemCloseMinutesAfter ?? null,
          ]
        );
        const scenarioId = Number(insert.insertId);
        for (const allowed of Array.isArray(req.body?.allowedProducts) ? req.body.allowedProducts : []) {
          const [allowedInsert] = await conn.query(
            `INSERT INTO course_scenario_allowed_products
              (scenario_id, ticket_product_id, priority,
               redeem_open_minutes_before, redeem_close_minutes_after)
             SELECT ?, tp.id, ?, ?, ? FROM course_ticket_products tp
              WHERE tp.id = ? AND tp.owner_user_id <=> ?`,
            [
              scenarioId,
              nonNegativeInt(allowed.priority, 100),
              allowed.redeemOpenMinutesBefore ?? null,
              allowed.redeemCloseMinutesAfter ?? null,
              positiveInt(allowed.ticketProductId),
              ownerUserId,
            ]
          );
          if (!allowedInsert.affectedRows) {
            throw domainError(
              'COURSE_TICKET_PRODUCT_NOT_FOUND',
              'Scenario 含有不存在或跨租戶的票券產品',
              409
            );
          }
        }
        const response = { id: scenarioId, rowVersion: 1 };
        await courseV2.completeMutation(conn, req.user.id, operation, mutation, response, {
          type: 'scenario',
          id: scenarioId,
        });
        return response;
      })
    ));
  });

  router.patch('/admin/courses/scenarios/:id', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    const [rows] = await pool.query('SELECT * FROM course_redeem_scenarios WHERE id = ? LIMIT 1', [positiveInt(req.params.id)]);
    const current = rows[0];
    if (!current) return fail(res, 'COURSE_SCENARIO_NOT_FOUND', '找不到 Scenario', 404);
    try {
      await authorize(req, { ownerUserId: current.owner_user_id, capability: 'manageCatalog' });
    } catch (error) {
      return sendError(res, 'ADMIN_COURSE_SCENARIO_FORBIDDEN', error);
    }
    return withMutation(req, res, 'ADMIN_COURSE_SCENARIO_UPDATE_FAIL', ({ idempotencyKey, rowVersion }) => (
      courseV2.withMutationTransaction(async (conn) => {
        if (!rowVersion) throw domainError('COURSE_ROW_VERSION_REQUIRED', '更新需要 If-Match', 428);
        const operation = 'scenario.update';
        const mutation = await courseV2.claimMutation(conn, {
          actorUserId: req.user.id,
          operation,
          idempotencyKey,
          payload: { id: current.id, rowVersion, ...req.body },
          resourceType: 'scenario',
          resourceId: current.id,
        });
        if (mutation.replay) return mutation.replay;
        const [update] = await conn.query(
          `UPDATE course_redeem_scenarios
              SET name = ?, description = ?, status = ?,
                  redeem_open_minutes_before = ?, redeem_close_minutes_after = ?,
                  row_version = row_version + 1
            WHERE id = ? AND row_version = ?`,
          [
            text(req.body?.name ?? current.name, 255),
            text(req.body?.description ?? current.description, 2000) || null,
            text(req.body?.status ?? current.status, 24),
            req.body?.redeemOpenMinutesBefore ?? current.redeem_open_minutes_before,
            req.body?.redeemCloseMinutesAfter ?? current.redeem_close_minutes_after,
            current.id,
            rowVersion,
          ]
        );
        if (!update.affectedRows) throw domainError('COURSE_ROW_VERSION_CONFLICT', 'Scenario 已變更，請重新載入', 409);
        if (Array.isArray(req.body?.allowedProducts)) {
          await conn.query('DELETE FROM course_scenario_allowed_products WHERE scenario_id = ?', [current.id]);
          for (const allowed of req.body.allowedProducts) {
            const [allowedInsert] = await conn.query(
              `INSERT INTO course_scenario_allowed_products
                (scenario_id, ticket_product_id, priority,
                 redeem_open_minutes_before, redeem_close_minutes_after)
               SELECT ?, tp.id, ?, ?, ? FROM course_ticket_products tp
                WHERE tp.id = ? AND tp.owner_user_id <=> ?`,
              [
                current.id,
                nonNegativeInt(allowed.priority, 100),
                allowed.redeemOpenMinutesBefore ?? null,
                allowed.redeemCloseMinutesAfter ?? null,
                positiveInt(allowed.ticketProductId),
                current.owner_user_id,
              ]
            );
            if (!allowedInsert.affectedRows) throw domainError('COURSE_TICKET_PRODUCT_NOT_FOUND', 'Scenario 含跨租戶票券產品', 400);
          }
        }
        const response = { id: Number(current.id), rowVersion: rowVersion + 1 };
        await courseV2.completeMutation(conn, req.user.id, operation, mutation, response, {
          type: 'scenario',
          id: current.id,
        });
        return response;
      })
    ));
  });

  router.get('/admin/courses/settings', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    try {
      const ownerUserId = await actorOwner(req, { capability: 'manageSettings' });
      const [rows] = await pool.query(
        'SELECT * FROM course_settings WHERE scope_key = ? LIMIT 1',
        [ownerUserId ? `provider:${ownerUserId}` : 'platform']
      );
      const row = rows[0] || {};
      return ok(res, {
        id: row.id == null ? null : Number(row.id),
        ownerUserId,
        timezone: row.timezone || 'Asia/Taipei',
        bookingOpenMinutesBefore: Number(row.booking_open_minutes_before ?? 43200),
        bookingCloseMinutesBefore: Number(row.booking_close_minutes_before ?? 0),
        cancelCloseMinutesBefore: Number(row.cancel_close_minutes_before ?? 0),
        redeemOpenMinutesBefore: Number(row.redeem_open_minutes_before ?? 120),
        redeemCloseMinutesAfter: Number(row.redeem_close_minutes_after ?? 1440),
        attendanceInviteExpiresMinutes: Number(row.attendance_invite_expires_minutes ?? 1440),
        autoNoShow: Boolean(Number(row.auto_no_show || 0)),
        rowVersion: Number(row.row_version || 1),
      });
    } catch (error) {
      return sendError(res, 'ADMIN_COURSE_SETTINGS_FAIL', error);
    }
  });

  router.post('/admin/courses/settings', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    let ownerUserId;
    try {
      ownerUserId = await actorOwner(req, { capability: 'manageSettings' });
    } catch (error) {
      return sendError(res, 'ADMIN_COURSE_SETTINGS_FORBIDDEN', error);
    }
    return withMutation(req, res, 'ADMIN_COURSE_SETTINGS_CREATE_FAIL', ({ idempotencyKey }) => (
      courseV2.withMutationTransaction(async (conn) => {
        const scopeKey = ownerUserId ? `provider:${ownerUserId}` : 'platform';
        const operation = 'settings.create';
        const mutation = await courseV2.claimMutation(conn, {
          actorUserId: req.user.id,
          operation,
          idempotencyKey,
          payload: { scopeKey, ...req.body },
          resourceType: 'settings',
        });
        if (mutation.replay) return mutation.replay;
        const [existing] = await conn.query(
          'SELECT id FROM course_settings WHERE scope_key = ? LIMIT 1 FOR UPDATE',
          [scopeKey]
        );
        if (existing.length) throw domainError('COURSE_SETTINGS_EXISTS', '課程設定已存在，請重新載入後更新', 409);
        const [insert] = await conn.query(
          `INSERT INTO course_settings
            (scope_key, scope, owner_user_id, timezone,
             booking_open_minutes_before, booking_close_minutes_before,
             cancel_close_minutes_before, redeem_open_minutes_before,
             redeem_close_minutes_after, attendance_invite_expires_minutes,
             auto_no_show, row_version)
           VALUES (?, ?, ?, 'Asia/Taipei', ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            scopeKey,
            ownerUserId ? 'provider' : 'platform',
            ownerUserId,
            nonNegativeInt(req.body?.bookingOpenMinutesBefore, 43200, 525600),
            nonNegativeInt(req.body?.bookingCloseMinutesBefore, 0, 525600),
            nonNegativeInt(req.body?.cancelCloseMinutesBefore, 0, 525600),
            nonNegativeInt(req.body?.redeemOpenMinutesBefore, 120, 10080),
            nonNegativeInt(req.body?.redeemCloseMinutesAfter, 1440, 10080),
            nonNegativeInt(req.body?.attendanceInviteExpiresMinutes, 1440, 10080),
            booleanFlag(req.body?.autoNoShow, false) ? 1 : 0,
          ]
        );
        const response = { id: Number(insert.insertId), rowVersion: 1 };
        await courseV2.completeMutation(conn, req.user.id, operation, mutation, response, {
          type: 'settings',
          id: insert.insertId,
        });
        return response;
      })
    ));
  });

  router.patch('/admin/courses/settings', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    let ownerUserId;
    try {
      ownerUserId = await actorOwner(req, { capability: 'manageSettings' });
    } catch (error) {
      return sendError(res, 'ADMIN_COURSE_SETTINGS_FORBIDDEN', error);
    }
    return withMutation(req, res, 'ADMIN_COURSE_SETTINGS_UPDATE_FAIL', ({ idempotencyKey, rowVersion }) => (
      courseV2.withMutationTransaction(async (conn) => {
        if (!rowVersion) throw domainError('COURSE_ROW_VERSION_REQUIRED', '更新需要 If-Match', 428);
        const scopeKey = ownerUserId ? `provider:${ownerUserId}` : 'platform';
        const [rows] = await conn.query(
          'SELECT * FROM course_settings WHERE scope_key = ? LIMIT 1 FOR UPDATE',
          [scopeKey]
        );
        const current = rows[0];
        if (!current || Number(current.row_version) !== rowVersion) {
          throw domainError('COURSE_ROW_VERSION_CONFLICT', '課程設定已變更，請重新載入', 409);
        }
        const operation = 'settings.update';
        const mutation = await courseV2.claimMutation(conn, {
          actorUserId: req.user.id,
          operation,
          idempotencyKey,
          payload: { scopeKey, rowVersion, ...req.body },
          resourceType: 'settings',
          resourceId: current.id,
        });
        if (mutation.replay) return mutation.replay;
        await conn.query(
          `UPDATE course_settings
              SET booking_open_minutes_before = ?, booking_close_minutes_before = ?,
                  cancel_close_minutes_before = ?, redeem_open_minutes_before = ?,
                  redeem_close_minutes_after = ?, attendance_invite_expires_minutes = ?,
                  auto_no_show = ?, row_version = row_version + 1
            WHERE id = ? AND row_version = ?`,
          [
            nonNegativeInt(req.body?.bookingOpenMinutesBefore, Number(current.booking_open_minutes_before), 525600),
            nonNegativeInt(req.body?.bookingCloseMinutesBefore, Number(current.booking_close_minutes_before), 525600),
            nonNegativeInt(req.body?.cancelCloseMinutesBefore, Number(current.cancel_close_minutes_before), 525600),
            nonNegativeInt(req.body?.redeemOpenMinutesBefore, Number(current.redeem_open_minutes_before), 10080),
            nonNegativeInt(req.body?.redeemCloseMinutesAfter, Number(current.redeem_close_minutes_after), 10080),
            nonNegativeInt(req.body?.attendanceInviteExpiresMinutes, Number(current.attendance_invite_expires_minutes), 10080),
            booleanFlag(req.body?.autoNoShow, Boolean(current.auto_no_show)) ? 1 : 0,
            current.id,
            rowVersion,
          ]
        );
        const response = { id: Number(current.id), rowVersion: rowVersion + 1 };
        await courseV2.completeMutation(conn, req.user.id, operation, mutation, response, {
          type: 'settings',
          id: current.id,
        });
        return response;
      })
    ));
  });

  router.patch('/admin/courses/sessions/:id/policy', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    const session = await sessionContext(req.params.id);
    if (!session) return fail(res, 'COURSE_SESSION_NOT_FOUND', '找不到課程場次', 404);
    try {
      await authorize(req, { ownerUserId: session.owner_user_id, capability: 'manageCatalog' });
    } catch (error) {
      return sendError(res, 'ADMIN_COURSE_SESSION_POLICY_FORBIDDEN', error);
    }
    return withMutation(req, res, 'ADMIN_COURSE_SESSION_POLICY_FAIL', ({ idempotencyKey, rowVersion }) => (
      courseV2.withMutationTransaction(async (conn) => {
        if (!rowVersion) throw domainError('COURSE_ROW_VERSION_REQUIRED', '更新需要 If-Match', 428);
        const operation = 'session.policy.update';
        const mutation = await courseV2.claimMutation(conn, {
          actorUserId: req.user.id,
          operation,
          idempotencyKey,
          payload: { sessionId: session.id, rowVersion, ...req.body },
          resourceType: 'session',
          resourceId: session.id,
        });
        if (mutation.replay) return mutation.replay;
        const scenarioId = positiveInt(req.body?.scenarioId ?? req.body?.scenario_id);
        if (!scenarioId) {
          throw domainError('COURSE_SCENARIO_REQUIRED', '請指定核銷情境', 400);
        }
        const [scenarioRows] = await conn.query(
          `SELECT id
             FROM course_redeem_scenarios
            WHERE id = ? AND status = 'active'
              AND (owner_user_id <=> ? OR owner_user_id IS NULL)
            LIMIT 1 FOR UPDATE`,
          [scenarioId, session.owner_user_id]
        );
        if (!scenarioRows[0]) {
          throw domainError(
            'COURSE_SCENARIO_NOT_FOUND',
            '核銷情境不存在或不屬於此課程租戶',
            404
          );
        }
        const settings = await courseV2.loadSettings(conn, session.owner_user_id);
        const snapshot = {
          booking_open_minutes_before: Number(settings.provider.booking_open_minutes_before ?? settings.platform.booking_open_minutes_before ?? 43200),
          booking_close_minutes_before: Number(settings.provider.booking_close_minutes_before ?? settings.platform.booking_close_minutes_before ?? 0),
          cancel_close_minutes_before: Number(settings.provider.cancel_close_minutes_before ?? settings.platform.cancel_close_minutes_before ?? 0),
          redeem_open_minutes_before: Number(settings.provider.redeem_open_minutes_before ?? settings.platform.redeem_open_minutes_before ?? 120),
          redeem_close_minutes_after: Number(settings.provider.redeem_close_minutes_after ?? settings.platform.redeem_close_minutes_after ?? 1440),
          attendance_invite_expires_minutes: Number(settings.provider.attendance_invite_expires_minutes ?? settings.platform.attendance_invite_expires_minutes ?? 1440),
          auto_no_show: Boolean(Number(settings.provider.auto_no_show ?? settings.platform.auto_no_show ?? 0)),
        };
        const [update] = await conn.query(
          `UPDATE course_sessions
              SET scenario_id = ?, booking_open_at = ?, booking_close_at = ?,
                  booking_open_minutes_before = ?, booking_close_minutes_before = ?,
                  cancel_close_minutes_before = ?, redeem_open_at = ?, redeem_close_at = ?,
                  redeem_open_minutes_before = ?, redeem_close_minutes_after = ?,
                  settings_snapshot_json = ?, row_version = row_version + 1
            WHERE id = ? AND row_version = ?`,
          [
            scenarioId,
            mysqlDateTime(req.body?.bookingOpenAt ?? req.body?.booking_open_at),
            mysqlDateTime(req.body?.bookingCloseAt ?? req.body?.booking_close_at),
            req.body?.bookingOpenMinutesBefore ?? null,
            req.body?.bookingCloseMinutesBefore ?? null,
            req.body?.cancelCloseMinutesBefore ?? null,
            mysqlDateTime(req.body?.redeemOpenAt ?? req.body?.redeem_open_at),
            mysqlDateTime(req.body?.redeemCloseAt ?? req.body?.redeem_close_at),
            req.body?.redeemOpenMinutesBefore ?? null,
            req.body?.redeemCloseMinutesAfter ?? null,
            JSON.stringify(snapshot),
            session.id,
            rowVersion,
          ]
        );
        if (!update.affectedRows) throw domainError('COURSE_ROW_VERSION_CONFLICT', '場次已變更，請重新載入', 409);
        const response = { id: Number(session.id), rowVersion: rowVersion + 1, settingsSnapshot: snapshot };
        await courseV2.completeMutation(conn, req.user.id, operation, mutation, response, {
          type: 'session',
          id: session.id,
        });
        return response;
      })
    ));
  });

  async function listTenantResource(req, res, {
    capability,
    sql,
    params = [],
    errorCode,
  }) {
    try {
      const ownerUserId = await actorOwner(req, { capability });
      const globalList = normalizeRole(req.user?.role) === 'ADMIN' && !ownerUserId;
      const scopedSql = globalList
        ? sql.replace(/WHERE\s+(?:\w+\.)?owner_user_id\s*=\s*\?/i, 'WHERE 1 = 1')
        : sql;
      const [rows] = await pool.query(
        scopedSql,
        globalList ? params : [ownerUserId, ...params]
      );
      return ok(res, rows);
    } catch (error) {
      return sendError(res, errorCode, error);
    }
  }

  async function resolveVerifiedPlatformUser(queryable, {
    userId = '',
    email = '',
    required = false,
  } = {}) {
    const normalizedUserId = text(userId, 36);
    const normalizedEmail = text(email, 255).toLowerCase();
    if (!normalizedUserId && !normalizedEmail) {
      if (required) {
        throw domainError('COURSE_STAFF_USER_NOT_FOUND', '請指定已驗證的平台帳號或 Email', 404);
      }
      return null;
    }
    const where = [];
    const params = [];
    if (normalizedUserId) {
      where.push('u.id = ?');
      params.push(normalizedUserId);
    }
    if (normalizedEmail) {
      where.push('LOWER(u.email) = ?');
      params.push(normalizedEmail);
    }
    const [rows] = await queryable.query(
      `SELECT u.id, u.email
         FROM users u
        WHERE ${where.join(' AND ')}
          AND (
            EXISTS (
              SELECT 1 FROM email_verifications ev
               WHERE LOWER(ev.email) = LOWER(u.email) AND ev.verified = 1
            )
            OR EXISTS (
              SELECT 1 FROM oauth_identities oi
               WHERE oi.user_id = u.id
                 AND LOWER(COALESCE(oi.email, u.email)) = LOWER(u.email)
            )
          )
        LIMIT 1`,
      params
    );
    if (!rows[0]) {
      throw domainError(
        required ? 'COURSE_STAFF_USER_NOT_FOUND' : 'COURSE_COACH_USER_NOT_VERIFIED',
        required ? '請指定已驗證的平台帳號或 Email' : '連結的教練帳號不存在或尚未驗證 Email',
        404
      );
    }
    return rows[0];
  }

  router.get('/admin/courses/staff-memberships', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    return listTenantResource(req, res, {
      capability: 'manageStaff',
      sql: `SELECT m.*, u.username, u.email FROM course_staff_memberships m
             JOIN users u ON u.id = m.user_id
            WHERE m.owner_user_id = ? ORDER BY m.created_at DESC, m.id DESC`,
      errorCode: 'ADMIN_COURSE_STAFF_MEMBERSHIPS_FAIL',
    });
  });

  router.post('/admin/courses/staff-memberships', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    let ownerUserId;
    try {
      ownerUserId = await actorOwner(req, { capability: 'manageStaff' });
    } catch (error) {
      return sendError(res, 'ADMIN_COURSE_STAFF_FORBIDDEN', error);
    }
    return withMutation(req, res, 'ADMIN_COURSE_STAFF_CREATE_FAIL', ({ idempotencyKey }) => (
      courseV2.withMutationTransaction(async (conn) => {
        const operation = 'staff-membership.create';
        const mutation = await courseV2.claimMutation(conn, {
          actorUserId: req.user.id,
          operation,
          idempotencyKey,
          payload: { ownerUserId, ...req.body },
          resourceType: 'staff_membership',
        });
        if (mutation.replay) return mutation.replay;
        const role = text(req.body?.role ?? req.body?.capability, 24).toLowerCase();
        if (!['ops', 'coach'].includes(role)) throw domainError('VALIDATION_ERROR', '員工角色僅支援 ops 或 coach', 400);
        const user = await resolveVerifiedPlatformUser(conn, {
          userId: req.body?.userId ?? req.body?.user_id,
          email: req.body?.email,
          required: true,
        });
        const userId = user.id;
        const [existingRows] = await conn.query(
          `SELECT id, row_version FROM course_staff_memberships
            WHERE owner_user_id = ? AND user_id = ?
            LIMIT 1 FOR UPDATE`,
          [ownerUserId, userId]
        );
        if (existingRows[0]) {
          throw domainError(
            'COURSE_STAFF_MEMBERSHIP_EXISTS',
            '此平台帳號已在員工名單中，請使用更新操作',
            409,
            {
              id: Number(existingRows[0].id),
              rowVersion: Number(existingRows[0].row_version || 1),
            }
          );
        }
        const [insert] = await conn.query(
          `INSERT INTO course_staff_memberships
            (owner_user_id, user_id, role, capabilities_json, status, row_version)
           VALUES (?, ?, ?, ?, 'active', 1)`,
          [
            ownerUserId,
            userId,
            role,
            JSON.stringify(req.body?.capabilities || {}),
          ]
        );
        const response = {
          id: Number(insert.insertId),
          rowVersion: 1,
          userId,
          role,
          status: 'active',
        };
        await courseV2.completeMutation(conn, req.user.id, operation, mutation, response);
        return response;
      })
    ));
  });

  router.patch('/admin/courses/staff-memberships/:id', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    let ownerUserId;
    try {
      ownerUserId = await actorOwner(req, { capability: 'manageStaff' });
    } catch (error) {
      return sendError(res, 'ADMIN_COURSE_STAFF_FORBIDDEN', error);
    }
    return withMutation(req, res, 'ADMIN_COURSE_STAFF_UPDATE_FAIL', ({ idempotencyKey, rowVersion }) => (
      courseV2.withMutationTransaction(async (conn) => {
        const membershipId = positiveInt(req.params.id);
        if (!membershipId) throw domainError('VALIDATION_ERROR', '員工 membership id 不正確', 400);
        const operation = 'staff-membership.update';
        const mutation = await courseV2.claimMutation(conn, {
          actorUserId: req.user.id,
          operation,
          idempotencyKey,
          payload: { ownerUserId, membershipId, rowVersion, ...req.body },
          resourceType: 'staff_membership',
          resourceId: membershipId,
        });
        if (mutation.replay) return mutation.replay;
        if (!rowVersion) throw domainError('COURSE_ROW_VERSION_REQUIRED', '更新員工需要 If-Match', 428);
        const [rows] = await conn.query(
          `SELECT * FROM course_staff_memberships
            WHERE id = ? AND owner_user_id = ?
            LIMIT 1 FOR UPDATE`,
          [membershipId, ownerUserId]
        );
        const membership = rows[0];
        if (!membership) throw domainError('COURSE_STAFF_MEMBERSHIP_NOT_FOUND', '找不到員工 membership', 404);
        if (Number(membership.row_version || 1) !== Number(rowVersion)) {
          throw domainError('COURSE_ROW_VERSION_CONFLICT', '員工資料已變更，請重新載入', 409);
        }
        const role = text(req.body?.role ?? req.body?.capability ?? membership.role, 24).toLowerCase();
        const status = text(req.body?.status ?? membership.status, 24).toLowerCase();
        if (!['ops', 'coach'].includes(role)) {
          throw domainError('VALIDATION_ERROR', '員工角色僅支援 ops 或 coach', 400);
        }
        if (!['active', 'inactive', 'revoked'].includes(status)) {
          throw domainError('VALIDATION_ERROR', '員工狀態不正確', 400);
        }
        const capabilities = hasOwn(req.body, 'capabilities')
          ? (req.body.capabilities || {})
          : json(membership.capabilities_json, {});
        const [updated] = await conn.query(
          `UPDATE course_staff_memberships
              SET role = ?, capabilities_json = ?, status = ?, row_version = row_version + 1
            WHERE id = ? AND owner_user_id = ? AND row_version = ?`,
          [role, JSON.stringify(capabilities), status, membershipId, ownerUserId, rowVersion]
        );
        if (!updated.affectedRows) {
          throw domainError('COURSE_ROW_VERSION_CONFLICT', '員工資料已變更，請重新載入', 409);
        }
        const response = {
          id: membershipId,
          userId: membership.user_id,
          role,
          status,
          rowVersion: Number(rowVersion) + 1,
        };
        await courseV2.completeMutation(conn, req.user.id, operation, mutation, response, {
          type: 'staff_membership',
          id: membershipId,
        });
        return response;
      })
    ));
  });

  router.get('/admin/courses/coach-profiles', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    return listTenantResource(req, res, {
      capability: 'manageCatalog',
      sql: `SELECT * FROM course_coach_profiles
            WHERE owner_user_id = ? ORDER BY created_at DESC, id DESC`,
      errorCode: 'ADMIN_COURSE_COACH_PROFILES_FAIL',
    });
  });

  router.post('/admin/courses/coach-profiles', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    let ownerUserId;
    try {
      ownerUserId = await actorOwner(req, { capability: 'manageCatalog' });
    } catch (error) {
      return sendError(res, 'ADMIN_COURSE_COACH_FORBIDDEN', error);
    }
    return withMutation(req, res, 'ADMIN_COURSE_COACH_CREATE_FAIL', ({ idempotencyKey }) => (
      courseV2.withMutationTransaction(async (conn) => {
        const operation = 'coach-profile.create';
        const mutation = await courseV2.claimMutation(conn, {
          actorUserId: req.user.id,
          operation,
          idempotencyKey,
          payload: { ownerUserId, ...req.body },
          resourceType: 'coach_profile',
        });
        if (mutation.replay) return mutation.replay;
        const displayName = text(req.body?.displayName ?? req.body?.display_name ?? req.body?.name, 255);
        if (!displayName) throw domainError('VALIDATION_ERROR', '請填寫教練名稱', 400);
        const code = normalizeResourceCode(req.body?.code, { prefix: 'COACH', generate: true });
        const linkedUser = text(req.body?.userId ?? req.body?.user_id, 36)
          ? await resolveVerifiedPlatformUser(conn, {
            userId: req.body?.userId ?? req.body?.user_id,
          })
          : null;
        const status = text(req.body?.status, 24).toLowerCase() || 'active';
        if (!['active', 'inactive'].includes(status)) {
          throw domainError('VALIDATION_ERROR', '教練狀態不正確', 400);
        }
        const [existingRows] = await conn.query(
          `SELECT id FROM course_coach_profiles
            WHERE owner_user_id = ?
              AND (code = ? OR (? IS NOT NULL AND user_id = ?))
            LIMIT 1 FOR UPDATE`,
          [ownerUserId, code, linkedUser?.id || null, linkedUser?.id || null]
        );
        if (existingRows[0]) {
          throw domainError('COURSE_COACH_PROFILE_EXISTS', '教練代碼或連結帳號已存在', 409);
        }
        const [insert] = await conn.query(
          `INSERT INTO course_coach_profiles
            (owner_user_id, code, user_id, display_name, email, phone, bio, status, row_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            ownerUserId,
            code,
            linkedUser?.id || null,
            displayName,
            text(req.body?.email, 255).toLowerCase() || null,
            text(req.body?.phone, 32) || null,
            text(req.body?.bio, 5000) || null,
            status,
          ]
        );
        const response = {
          id: Number(insert.insertId),
          code,
          userId: linkedUser?.id || null,
          displayName,
          status,
          rowVersion: 1,
        };
        await courseV2.completeMutation(conn, req.user.id, operation, mutation, response, {
          type: 'coach_profile',
          id: insert.insertId,
        });
        return response;
      })
    ));
  });

  router.patch('/admin/courses/coach-profiles/:id', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    let ownerUserId;
    try {
      ownerUserId = await actorOwner(req, { capability: 'manageCatalog' });
    } catch (error) {
      return sendError(res, 'ADMIN_COURSE_COACH_FORBIDDEN', error);
    }
    return withMutation(req, res, 'ADMIN_COURSE_COACH_UPDATE_FAIL', ({ idempotencyKey, rowVersion }) => (
      courseV2.withMutationTransaction(async (conn) => {
        const coachProfileId = positiveInt(req.params.id);
        if (!coachProfileId) throw domainError('VALIDATION_ERROR', '教練名冊 id 不正確', 400);
        const operation = 'coach-profile.update';
        const mutation = await courseV2.claimMutation(conn, {
          actorUserId: req.user.id,
          operation,
          idempotencyKey,
          payload: { ownerUserId, coachProfileId, rowVersion, ...req.body },
          resourceType: 'coach_profile',
          resourceId: coachProfileId,
        });
        if (mutation.replay) return mutation.replay;
        if (!rowVersion) throw domainError('COURSE_ROW_VERSION_REQUIRED', '更新教練名冊需要 If-Match', 428);
        const [rows] = await conn.query(
          `SELECT * FROM course_coach_profiles
            WHERE id = ? AND owner_user_id = ?
            LIMIT 1 FOR UPDATE`,
          [coachProfileId, ownerUserId]
        );
        const profile = rows[0];
        if (!profile) throw domainError('COURSE_COACH_PROFILE_NOT_FOUND', '找不到教練名冊', 404);
        if (Number(profile.row_version || 1) !== Number(rowVersion)) {
          throw domainError('COURSE_ROW_VERSION_CONFLICT', '教練名冊已變更，請重新載入', 409);
        }
        const code = hasOwn(req.body, 'code')
          ? normalizeResourceCode(req.body.code)
          : profile.code;
        const displayName = text(
          req.body?.displayName ?? req.body?.display_name ?? req.body?.name ?? profile.display_name,
          255
        );
        if (!displayName) throw domainError('VALIDATION_ERROR', '請填寫教練名稱', 400);
        const status = text(req.body?.status ?? profile.status, 24).toLowerCase();
        if (!['active', 'inactive'].includes(status)) {
          throw domainError('VALIDATION_ERROR', '教練狀態不正確', 400);
        }
        const linkedUserFieldPresent = hasOwn(req.body, 'userId') || hasOwn(req.body, 'user_id');
        const linkedUserValue = req.body?.userId ?? req.body?.user_id;
        const linkedUser = linkedUserFieldPresent && text(linkedUserValue, 36)
          ? await resolveVerifiedPlatformUser(conn, { userId: linkedUserValue })
          : null;
        const userId = linkedUserFieldPresent ? (linkedUser?.id || null) : (profile.user_id || null);
        const [conflictRows] = await conn.query(
          `SELECT id FROM course_coach_profiles
            WHERE owner_user_id = ? AND id <> ?
              AND (code = ? OR (? IS NOT NULL AND user_id = ?))
            LIMIT 1 FOR UPDATE`,
          [ownerUserId, coachProfileId, code, userId, userId]
        );
        if (conflictRows[0]) {
          throw domainError('COURSE_COACH_PROFILE_EXISTS', '教練代碼或連結帳號已存在', 409);
        }
        const email = hasOwn(req.body, 'email')
          ? (text(req.body.email, 255).toLowerCase() || null)
          : profile.email;
        const phone = hasOwn(req.body, 'phone')
          ? (text(req.body.phone, 32) || null)
          : profile.phone;
        const bio = hasOwn(req.body, 'bio')
          ? (text(req.body.bio, 5000) || null)
          : profile.bio;
        const [updated] = await conn.query(
          `UPDATE course_coach_profiles
              SET code = ?, user_id = ?, display_name = ?, email = ?, phone = ?,
                  bio = ?, status = ?, row_version = row_version + 1
            WHERE id = ? AND owner_user_id = ? AND row_version = ?`,
          [
            code,
            userId,
            displayName,
            email,
            phone,
            bio,
            status,
            coachProfileId,
            ownerUserId,
            rowVersion,
          ]
        );
        if (!updated.affectedRows) {
          throw domainError('COURSE_ROW_VERSION_CONFLICT', '教練名冊已變更，請重新載入', 409);
        }
        const response = {
          id: coachProfileId,
          code,
          userId,
          displayName,
          status,
          rowVersion: Number(rowVersion) + 1,
        };
        await courseV2.completeMutation(conn, req.user.id, operation, mutation, response, {
          type: 'coach_profile',
          id: coachProfileId,
        });
        return response;
      })
    ));
  });

  function reportOwnerScope(req, ownerUserId, expression) {
    const platformOnly = normalizeRole(req.user?.role) === 'ADMIN'
      && text(req.query?.ownerType ?? req.query?.owner_type, 24).toLowerCase() === 'platform';
    if (ownerUserId) return { sql: `${expression} = ?`, params: [ownerUserId] };
    if (platformOnly) return { sql: `${expression} IS NULL`, params: [] };
    return normalizeRole(req.user?.role) === 'ADMIN'
      ? { sql: '1 = 1', params: [] }
      : { sql: `${expression} IS NULL`, params: [] };
  }

  function reportSessionFilters(req, {
    sessionAlias = 's',
    eventAlias = null,
  } = {}) {
    const where = [];
    const params = [];
    const occurredExpression = eventAlias ? `${eventAlias}.occurred_at` : `${sessionAlias}.starts_at`;
    const from = text(req.query?.from ?? req.query?.dateFrom ?? req.query?.date_from, 10);
    const to = text(req.query?.to ?? req.query?.dateTo ?? req.query?.date_to, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      where.push(`${occurredExpression} >= ?`);
      params.push(`${from} 00:00:00`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      where.push(`${occurredExpression} < DATE_ADD(?, INTERVAL 1 DAY)`);
      params.push(to);
    }
    const scenarioId = positiveInt(req.query?.scenarioId ?? req.query?.scenario_id);
    if (scenarioId) {
      where.push(eventAlias
        ? `COALESCE(
             CAST(JSON_UNQUOTE(JSON_EXTRACT(${eventAlias}.metadata_json, '$.scenarioId')) AS UNSIGNED),
             ${sessionAlias}.scenario_id
           ) = ?`
        : `${sessionAlias}.scenario_id = ?`);
      params.push(scenarioId);
    }
    const coachProfileId = positiveInt(req.query?.coachProfileId ?? req.query?.coach_profile_id);
    if (coachProfileId) {
      where.push(eventAlias
        ? `COALESCE(
             CAST(JSON_UNQUOTE(JSON_EXTRACT(${eventAlias}.metadata_json, '$.coachProfileId')) AS UNSIGNED),
             ${sessionAlias}.coach_profile_id
           ) = ?`
        : `${sessionAlias}.coach_profile_id = ?`);
      params.push(coachProfileId);
    }
    const location = text(req.query?.location, 255);
    if (location) {
      where.push(eventAlias
        ? `COALESCE(
             NULLIF(JSON_UNQUOTE(JSON_EXTRACT(${eventAlias}.metadata_json, '$.location')), ''),
             ${sessionAlias}.location,
             ''
           ) LIKE ?`
        : `COALESCE(${sessionAlias}.location, '') LIKE ?`);
      params.push(`%${location}%`);
    }
    return { where, params };
  }

  router.get('/admin/courses/reports', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    try {
      const ownerUserId = await actorOwner(req, { capability: 'viewReports' });
      const scope = reportOwnerScope(req, ownerUserId, 's.owner_user_id');
      const filters = reportSessionFilters(req, { sessionAlias: 's', eventAlias: 'e' });
      const [[kpi]] = await pool.query(
        `SELECT
           COALESCE(SUM(e.event_type = 'SUCCESS'), 0) AS success_count,
           COALESCE(SUM(CASE WHEN e.event_type = 'SUCCESS' AND e.delta_uses < 0
             THEN -e.delta_uses ELSE 0 END), 0) AS success_consumed_uses,
           COUNT(DISTINCT CASE WHEN e.event_type = 'SUCCESS' THEN
             COALESCE(CONCAT('s:', e.student_id), CONCAT('u:', e.user_id), CONCAT('e:', e.id))
           END) AS unique_success_students,
           COALESCE(SUM(e.event_type = 'NO_SHOW'), 0) AS no_show_count,
           COALESCE(SUM(CASE WHEN e.event_type = 'NO_SHOW' AND e.delta_uses < 0
             THEN -e.delta_uses ELSE 0 END), 0) AS no_show_consumed_uses,
           COALESCE(SUM(e.is_anomaly = 1), 0) AS anomaly_count
         FROM course_usage_events e
         JOIN course_sessions s ON s.id = e.session_id
        WHERE ${scope.sql}
          AND e.event_type IN ('SUCCESS', 'NO_SHOW')
          AND NOT EXISTS (
            SELECT 1 FROM course_usage_events reversal
             WHERE reversal.reverses_event_id = e.id
          )
          ${filters.where.length ? `AND ${filters.where.join(' AND ')}` : ''}`,
        [...scope.params, ...filters.params]
      );
      const pendingFilters = reportSessionFilters(req, { sessionAlias: 's' });
      const [pendingRows] = await pool.query(
        `SELECT b.id, b.status, s.starts_at, s.ends_at, s.owner_user_id,
                s.booking_open_at, s.booking_close_at,
                s.booking_open_minutes_before, s.booking_close_minutes_before,
                s.cancel_close_minutes_before, s.redeem_open_at, s.redeem_close_at,
                s.redeem_open_minutes_before, s.redeem_close_minutes_after,
                s.settings_snapshot_json,
                rs.redeem_open_minutes_before AS scenario_redeem_open_minutes_before,
                rs.redeem_close_minutes_after AS scenario_redeem_close_minutes_after,
                sap.redeem_open_minutes_before AS allowed_redeem_open_minutes_before,
                sap.redeem_close_minutes_after AS allowed_redeem_close_minutes_after,
                COALESCE(t.product_redemption_policy_snapshot, tp.redemption_policy_json)
                  AS redemption_policy_json
           FROM course_bookings b
           JOIN course_sessions s ON s.id = b.session_id
           LEFT JOIN course_redeem_scenarios rs ON rs.id = s.scenario_id
           LEFT JOIN course_tickets t ON t.id = b.ticket_id
           LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
           LEFT JOIN course_scenario_allowed_products sap
             ON sap.scenario_id = s.scenario_id
            AND sap.ticket_product_id = t.ticket_product_id
          WHERE ${scope.sql} AND b.status = 'booked'
            ${pendingFilters.where.length ? `AND ${pendingFilters.where.join(' AND ')}` : ''}`,
        [...scope.params, ...pendingFilters.params]
      );
      const settingsByOwner = new Map();
      for (const row of pendingRows) {
        const key = row.owner_user_id || '__platform__';
        if (!settingsByOwner.has(key)) {
          settingsByOwner.set(key, await courseV2.loadSettings(pool, row.owner_user_id));
        }
      }
      const now = Date.now();
      const pendingReview = pendingRows.reduce((count, row) => {
        const settings = settingsByOwner.get(row.owner_user_id || '__platform__') || {};
        const snapshot = json(row.settings_snapshot_json, {});
        const policy = resolveCoursePolicy({
          session: row,
          providerSettings: { ...(settings.provider || {}), ...snapshot },
          platformSettings: settings.platform || {},
          scenario: {
            redeem_open_minutes_before: row.scenario_redeem_open_minutes_before,
            redeem_close_minutes_after: row.scenario_redeem_close_minutes_after,
          },
          allowedProduct: {
            redeem_open_minutes_before: row.allowed_redeem_open_minutes_before,
            redeem_close_minutes_after: row.allowed_redeem_close_minutes_after,
          },
          ticketProduct: json(row.redemption_policy_json, {}),
          now,
        });
        return count + (derivePendingReview(row, policy, now) ? 1 : 0);
      }, 0);
      const platformOnly = text(
        req.query?.ownerType ?? req.query?.owner_type,
        24
      ).toLowerCase() === 'platform';
      const globalReport = normalizeRole(req.user?.role) === 'ADMIN'
        && !ownerUserId
        && !platformOnly;
      const scopedSettings = globalReport
        ? null
        : await courseV2.loadSettings(pool, ownerUserId);
      const autoNoShow = scopedSettings
        ? Boolean(Number(
          scopedSettings.provider?.auto_no_show
          ?? scopedSettings.platform?.auto_no_show
          ?? 0
        ))
        : null;
      return ok(res, {
        successCount: Number(kpi?.success_count || 0),
        successConsumedUses: Number(kpi?.success_consumed_uses || 0),
        uniqueSuccessStudents: Number(kpi?.unique_success_students || 0),
        noShowCount: Number(kpi?.no_show_count || 0),
        noShowConsumedUses: Number(kpi?.no_show_consumed_uses || 0),
        anomalyCount: Number(kpi?.anomaly_count || 0),
        consumedUses: Number(kpi?.success_consumed_uses || 0),
        attendanceRate: (
          Number(kpi?.success_count || 0) + Number(kpi?.no_show_count || 0)
        ) > 0
          ? (
            Number(kpi.success_count || 0)
              / (Number(kpi.success_count || 0) + Number(kpi.no_show_count || 0))
          ) * 100
          : null,
        excusedLeaveCount: 0,
        pendingReview,
        autoNoShow,
      });
    } catch (error) {
      return sendError(res, 'ADMIN_COURSE_REPORT_FAIL', error);
    }
  });

  router.get('/admin/courses/reports/students', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    try {
      const ownerUserId = await actorOwner(req, { capability: 'viewReports' });
      const scope = reportOwnerScope(req, ownerUserId, 'student.owner_user_id');
      const inactiveDays = Math.min(
        positiveInt(req.query?.inactiveDays ?? req.query?.inactive_days, 90),
        3650
      );
      const activityFilters = reportSessionFilters(req, {
        sessionAlias: 'event_session',
        eventAlias: 'e',
      });
      const [rows] = await pool.query(
        `SELECT student.id, student.display_name, student.email, student.status,
                student.source_system, student.source_id,
                COALESCE(ticket.ticket_count, 0) AS ticket_count,
                COALESCE(ticket.remaining_uses, 0) AS remaining_uses,
                COALESCE(ticket.available_remaining_uses, 0) AS available_remaining_uses,
                COALESCE(ticket.paused_remaining_uses, 0) AS paused_remaining_uses,
                COALESCE(ticket.expired_remaining_uses, 0) AS expired_remaining_uses,
                COALESCE(ticket.activation_expired_remaining_uses, 0)
                  AS activation_expired_remaining_uses,
                COALESCE(ticket.frozen_remaining_uses, 0) AS frozen_remaining_uses,
                COALESCE(ticket.purchased_ticket_count, 0) AS purchased_ticket_count,
                COALESCE(ticket.transferred_ticket_count, 0) AS transferred_ticket_count,
                COALESCE(ticket.manual_ticket_count, 0) AS manual_ticket_count,
                ticket.next_expiry_at, ticket.last_issued_at,
                COALESCE(ticket.expiring_30_count, 0) AS expiring_30_count,
                COALESCE(hold.held_uses, 0) AS held_uses,
                COALESCE(event.success_count, 0) AS success_count,
                COALESCE(event.no_show_count, 0) AS no_show_count,
                COALESCE(event.recent_success_count, 0) AS recent_success_count,
                event.last_success_at
           FROM course_students student
           LEFT JOIN (
             SELECT t.student_id, COUNT(*) AS ticket_count,
                    COALESCE(SUM(CASE WHEN t.status IN ('pending', 'active', 'paused')
                      THEN COALESCE(t.remaining_uses_cache, t.remaining_uses, 0)
                      ELSE 0 END), 0) AS remaining_uses,
                    COALESCE(SUM(CASE
                      WHEN t.status IN ('pending', 'active')
                       AND t.frozen_at IS NULL
                       AND (t.expires_at IS NULL OR t.expires_at >= CURRENT_DATE())
                       AND (
                         t.status <> 'pending'
                         OR t.activation_deadline IS NULL
                         OR t.activation_deadline >= CURRENT_DATE()
                       )
                      THEN COALESCE(t.remaining_uses_cache, t.remaining_uses, 0)
                      ELSE 0
                    END), 0) AS available_remaining_uses,
                    COALESCE(SUM(CASE WHEN t.status = 'paused'
                      THEN COALESCE(t.remaining_uses_cache, t.remaining_uses, 0)
                      ELSE 0 END), 0) AS paused_remaining_uses,
                    COALESCE(SUM(CASE
                      WHEN t.status = 'active' AND t.expires_at < CURRENT_DATE()
                      THEN COALESCE(t.remaining_uses_cache, t.remaining_uses, 0)
                      ELSE 0 END), 0)
                      AS expired_remaining_uses,
                    COALESCE(SUM(CASE
                      WHEN t.status = 'pending'
                       AND t.activation_deadline < CURRENT_DATE()
                      THEN COALESCE(t.remaining_uses_cache, t.remaining_uses, 0)
                      ELSE 0 END), 0) AS activation_expired_remaining_uses,
                    COALESCE(SUM(CASE
                      WHEN t.status IN ('pending', 'active') AND t.frozen_at IS NOT NULL
                      THEN COALESCE(t.remaining_uses_cache, t.remaining_uses, 0)
                      ELSE 0 END), 0) AS frozen_remaining_uses,
                    SUM(
                      t.order_id IS NOT NULL
                      AND NOT EXISTS (
                        SELECT 1 FROM course_ticket_transfers source_transfer
                         WHERE source_transfer.ticket_id = t.id
                           AND source_transfer.status = 'accepted'
                           AND source_transfer.to_user_id = t.user_id
                      )
                    ) AS purchased_ticket_count,
                    SUM(EXISTS (
                      SELECT 1 FROM course_ticket_transfers source_transfer
                       WHERE source_transfer.ticket_id = t.id
                         AND source_transfer.status = 'accepted'
                         AND source_transfer.to_user_id = t.user_id
                    )) AS transferred_ticket_count,
                    SUM(
                      t.order_id IS NULL
                      AND NOT EXISTS (
                        SELECT 1 FROM course_ticket_transfers source_transfer
                         WHERE source_transfer.ticket_id = t.id
                           AND source_transfer.status = 'accepted'
                           AND source_transfer.to_user_id = t.user_id
                      )
                    ) AS manual_ticket_count,
                    MIN(CASE
                      WHEN t.status IN ('pending', 'active')
                       AND t.frozen_at IS NULL
                       AND t.expires_at >= CURRENT_DATE()
                       AND (
                         t.status <> 'pending'
                         OR t.activation_deadline IS NULL
                         OR t.activation_deadline >= CURRENT_DATE()
                       )
                      THEN t.expires_at END)
                      AS next_expiry_at,
                    MAX(t.issued_at) AS last_issued_at,
                    SUM(
                      t.status IN ('pending', 'active')
                      AND t.frozen_at IS NULL
                      AND t.expires_at BETWEEN CURRENT_DATE()
                        AND DATE_ADD(CURRENT_DATE(), INTERVAL 30 DAY)
                      AND (
                        t.status <> 'pending'
                        OR t.activation_deadline IS NULL
                        OR t.activation_deadline >= CURRENT_DATE()
                      )
                    ) AS expiring_30_count
               FROM course_tickets t
              WHERE t.student_id IS NOT NULL AND t.status <> 'void'
              GROUP BY t.student_id
           ) ticket ON ticket.student_id = student.id
           LEFT JOIN (
             SELECT t.student_id,
                    COALESCE(SUM(h.quantity), 0) AS held_uses
               FROM course_tickets t
               JOIN course_ticket_holds h ON h.ticket_id = t.id
              WHERE t.student_id IS NOT NULL
                AND h.status = 'active'
                AND t.status IN ('pending', 'active')
                AND t.frozen_at IS NULL
                AND (t.expires_at IS NULL OR t.expires_at >= CURRENT_DATE())
                AND (
                  t.status <> 'pending'
                  OR t.activation_deadline IS NULL
                  OR t.activation_deadline >= CURRENT_DATE()
                )
              GROUP BY t.student_id
           ) hold ON hold.student_id = student.id
           LEFT JOIN (
             SELECT e.student_id,
                    SUM(e.event_type = 'SUCCESS') AS success_count,
                    SUM(e.event_type = 'NO_SHOW') AS no_show_count,
                    SUM(e.event_type = 'SUCCESS'
                      AND e.occurred_at >= DATE_SUB(NOW(), INTERVAL ? DAY))
                      AS recent_success_count,
                    MAX(CASE WHEN e.event_type = 'SUCCESS' THEN e.occurred_at END)
                      AS last_success_at
               FROM course_usage_events e
               JOIN course_sessions event_session ON event_session.id = e.session_id
              WHERE e.student_id IS NOT NULL
                AND e.event_type IN ('SUCCESS', 'NO_SHOW')
                AND NOT EXISTS (
                  SELECT 1 FROM course_usage_events reversal
                   WHERE reversal.reverses_event_id = e.id
                )
                ${activityFilters.where.length
    ? `AND ${activityFilters.where.join(' AND ')}`
    : ''}
              GROUP BY e.student_id
           ) event ON event.student_id = student.id
          WHERE ${scope.sql}
            ${activityFilters.where.length ? 'AND event.student_id IS NOT NULL' : ''}
          ORDER BY student.display_name, student.id
          LIMIT ?`,
        [
          inactiveDays,
          ...activityFilters.params,
          ...scope.params,
          Math.min(positiveInt(req.query?.limit, 200), 1000),
        ]
      );
      return ok(res, rows.map((row) => {
        const remainingUses = Number(row.remaining_uses || 0);
        const availableRemainingUses = Number(row.available_remaining_uses || 0);
        const heldUses = Number(row.held_uses || 0);
        const recentSuccessCount = Number(row.recent_success_count || 0);
        const ticketSourceBreakdown = {
          purchased: Number(row.purchased_ticket_count || 0),
          transferredIn: Number(row.transferred_ticket_count || 0),
          manualOrImported: Number(row.manual_ticket_count || 0),
        };
        const ticketSources = [
          {
            code: 'self_purchase',
            label: '自購',
            ticketCount: ticketSourceBreakdown.manualOrImported,
          },
          {
            code: 'order_purchase',
            label: '下單購買',
            ticketCount: ticketSourceBreakdown.purchased,
          },
          {
            code: 'transfer',
            label: '轉贈',
            ticketCount: ticketSourceBreakdown.transferredIn,
          },
        ].filter((entry) => entry.ticketCount > 0);
        const labels = [];
        if (availableRemainingUses > 0 && availableRemainingUses <= 3) labels.push('推方案');
        if (Number(row.expired_remaining_uses || 0) > 0) labels.push('可復活');
        if (Number(row.paused_remaining_uses || 0) > 0) labels.push('暫停中');
        if (Number(row.frozen_remaining_uses || 0) > 0) labels.push('凍結中');
        if (Number(row.activation_expired_remaining_uses || 0) > 0) labels.push('開卡逾期');
        if (availableRemainingUses > 0 && recentSuccessCount === 0) labels.push('沉睡');
        if (recentSuccessCount > 0) labels.push('活躍');
        const lastSuccessMs = row.last_success_at
          ? taipeiDateTimeMs(row.last_success_at)
          : NaN;
        return {
          id: Number(row.id),
          studentId: Number(row.id),
          name: row.display_name,
          displayName: row.display_name,
          email: row.email,
          status: row.status,
          labels,
          source: ticketSources.map((entry) => entry.label),
          ticketSources,
          migrationSource: {
            system: row.source_system || 'leader',
            id: row.source_id || null,
          },
          ticketCount: Number(row.ticket_count || 0),
          remainingUses,
          heldUses,
          availableUses: Math.max(0, availableRemainingUses - heldUses),
          pausedRemainingUses: Number(row.paused_remaining_uses || 0),
          frozenRemainingUses: Number(row.frozen_remaining_uses || 0),
          activationExpiredRemainingUses: Number(
            row.activation_expired_remaining_uses || 0
          ),
          ticketSourceBreakdown,
          expiredRemainingUses: Number(row.expired_remaining_uses || 0),
          expiring30DaysCount: Number(row.expiring_30_count || 0),
          nextExpiryAt: row.next_expiry_at || null,
          lastIssuedAt: row.last_issued_at || null,
          successCount: Number(row.success_count || 0),
          noShowCount: Number(row.no_show_count || 0),
          recentSuccessCount,
          lastSuccessAt: row.last_success_at || null,
          daysSinceLastSuccess: Number.isFinite(lastSuccessMs)
            ? Math.max(0, Math.floor((Date.now() - lastSuccessMs) / 86400000))
            : null,
          redemptionDensity: recentSuccessCount / Math.max(1, inactiveDays),
          insightWindowDays: inactiveDays,
        };
      }));
    } catch (error) {
      return sendError(res, 'ADMIN_COURSE_STUDENT_REPORT_FAIL', error);
    }
  });

  router.get('/admin/courses/reports/anomalies', authRequired, async (req, res) => {
    if (!await assertV2(res)) return undefined;
    try {
      const ownerUserId = await actorOwner(req, { capability: 'viewReports' });
      const scope = reportOwnerScope(req, ownerUserId, 's.owner_user_id');
      const filters = reportSessionFilters(req, { sessionAlias: 's', eventAlias: 'e' });
      const [rows] = await pool.query(
        `SELECT e.* FROM course_usage_events e
          JOIN course_sessions s ON s.id = e.session_id
         WHERE ${scope.sql} AND e.is_anomaly = 1
           ${filters.where.length ? `AND ${filters.where.join(' AND ')}` : ''}
         ORDER BY e.occurred_at DESC, e.id DESC LIMIT ?`,
        [
          ...scope.params,
          ...filters.params,
          Math.min(positiveInt(req.query?.limit, 100), 500),
        ]
      );
      return ok(res, rows);
    } catch (error) {
      return sendError(res, 'ADMIN_COURSE_ANOMALY_REPORT_FAIL', error);
    }
  });

  return courseV2;
}

module.exports = {
  registerCourseV2Routes,
};
