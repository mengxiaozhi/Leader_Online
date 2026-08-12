'use strict';

const { createCourseTermAdminDomain } = require('../services/course-term-admin-domain');
const { courseTermError, positiveInteger, text } = require('../services/course-term-policy');
const { normalizeCoursePlatformRole, refreshCourseRequestUser } = require('../services/course-role');
const { resolveCourseCapabilities } = require('../services/course-v2-policy');

function registerCourseTermAdminRoutes({ router, ctx, termDomain, domain = null } = {}) {
  const { pool, ok, fail, authRequired } = ctx;
  const adminTerms = domain || createCourseTermAdminDomain({ pool, termDomain });

  function sendError(res, fallbackCode, error) {
    const status = Number(error?.statusCode || error?.status || 500);
    if (error?.details && typeof res?.status === 'function') {
      return res.status(status).json({
        ok: false,
        code: error?.code || fallbackCode,
        message: error?.message || '固定班管理失敗',
        details: error.details,
      });
    }
    return fail(res, error?.code || fallbackCode, error?.message || '固定班管理失敗', status);
  }

  function mutationKey(req) {
    return termDomain.mutationKeyFromRequest(req);
  }

  function rowVersion(req) {
    return termDomain.rowVersionFromRequest(req);
  }

  function withAuth(handler) {
    return [authRequired, async (req, res) => {
      try {
        await termDomain.assertSchema();
        return await handler(req, res);
      } catch (error) {
        return sendError(res, 'COURSE_TERM_ADMIN_FAIL', error);
      }
    }];
  }

  async function membership(userId, ownerUserId) {
    if (!userId || !ownerUserId) return null;
    const [rows] = await pool.query(
      `SELECT * FROM course_staff_memberships
        WHERE owner_user_id = ? AND user_id = ? AND status = 'active' LIMIT 1`,
      [ownerUserId, userId]
    );
    return rows[0] || null;
  }

  async function authorize(req, ownerUserId, capability = 'manageCatalog') {
    await refreshCourseRequestUser(pool, req);
    const platformRole = normalizeCoursePlatformRole(req.user?.role);
    if (platformRole === 'ADMIN') return ownerUserId;
    if (platformRole === 'SERVICE_PROVIDER' && String(req.user.id) === String(ownerUserId)) return ownerUserId;
    const capabilities = resolveCourseCapabilities({
      platformRole,
      membership: await membership(req.user.id, ownerUserId),
    });
    if (!capabilities[capability]) throw courseTermError('FORBIDDEN', '沒有此課程租戶的操作權限', 403);
    return ownerUserId;
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
      if (!requested) throw courseTermError('COURSE_TENANT_REQUIRED', '固定班管理需要指定課程租戶', 400);
      return authorize(req, requested, capability);
    }
    if (role === 'SERVICE_PROVIDER') {
      if (requested && String(requested) !== String(req.user.id)) throw courseTermError('FORBIDDEN', '不可操作其他課程租戶', 403);
      return authorize(req, req.user.id, capability);
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
    return authorize(req, rows[0].owner_user_id, capability);
  }

  async function resourceOwner(req, table, id, capability = 'manageCatalog') {
    const allowedTables = new Set([
      'course_programs',
      'course_level_schemes',
      'course_levels',
      'course_terms',
      'course_term_pricing_rules',
      'course_term_renewal_rules',
      'course_students',
      'course_term_enrollments',
    ]);
    if (!allowedTables.has(table)) throw new TypeError('invalid managed course table');
    const [rows] = await pool.query(
      `SELECT owner_user_id FROM ${table} WHERE id = ? LIMIT 1`,
      [positiveInteger(id)]
    );
    if (!rows[0]) throw courseTermError('COURSE_RESOURCE_NOT_FOUND', '找不到課程資源', 404);
    await authorize(req, rows[0].owner_user_id, capability);
    return rows[0].owner_user_id;
  }

  function sendMutation(res, result, message) {
    if (result?.rowVersion) res.setHeader('ETag', `W/"${result.rowVersion}"`);
    return ok(res, result, message);
  }

  router.get('/admin/courses/catalog/fixed-terms', ...withAuth(async (req, res) => {
    const ownerUserId = await actorOwner(req);
    return ok(res, await adminTerms.listCatalog({ ownerUserId }), '固定班商品目錄');
  }));

  router.post('/admin/courses/programs', ...withAuth(async (req, res) => {
    const ownerUserId = await actorOwner(req);
    const result = await adminTerms.createProgram({
      ownerUserId,
      actorUserId: req.user.id,
      body: req.body,
      idempotencyKey: mutationKey(req),
    });
    return sendMutation(res, result, '課程計畫已建立');
  }));

  router.patch('/admin/courses/programs/:id', ...withAuth(async (req, res) => {
    const ownerUserId = await resourceOwner(req, 'course_programs', req.params.id);
    const result = await adminTerms.updateProgram({
      programId: req.params.id,
      ownerUserId,
      actorUserId: req.user.id,
      body: req.body,
      idempotencyKey: mutationKey(req),
      expectedRowVersion: rowVersion(req),
    });
    return sendMutation(res, result, '課程計畫已更新');
  }));

  router.post('/admin/courses/level-schemes', ...withAuth(async (req, res) => {
    const ownerUserId = await actorOwner(req);
    const result = await adminTerms.createLevelScheme({ ownerUserId, actorUserId: req.user.id, body: req.body, idempotencyKey: mutationKey(req) });
    return sendMutation(res, result, '程度方案已建立');
  }));

  router.patch('/admin/courses/level-schemes/:id', ...withAuth(async (req, res) => {
    const ownerUserId = await resourceOwner(req, 'course_level_schemes', req.params.id);
    const result = await adminTerms.updateLevelScheme({
      schemeId: req.params.id,
      ownerUserId,
      actorUserId: req.user.id,
      body: req.body,
      idempotencyKey: mutationKey(req),
      expectedRowVersion: rowVersion(req),
    });
    return sendMutation(res, result, '程度方案已更新');
  }));

  router.post('/admin/courses/levels', ...withAuth(async (req, res) => {
    const ownerUserId = await actorOwner(req);
    const result = await adminTerms.createLevel({ ownerUserId, actorUserId: req.user.id, body: req.body, idempotencyKey: mutationKey(req) });
    return sendMutation(res, result, '程度已建立');
  }));

  router.patch('/admin/courses/levels/:id', ...withAuth(async (req, res) => {
    const ownerUserId = await resourceOwner(req, 'course_levels', req.params.id);
    const result = await adminTerms.updateLevel({
      levelId: req.params.id,
      ownerUserId,
      actorUserId: req.user.id,
      body: req.body,
      idempotencyKey: mutationKey(req),
      expectedRowVersion: rowVersion(req),
    });
    return sendMutation(res, result, '程度已更新');
  }));

  router.post('/admin/courses/terms', ...withAuth(async (req, res) => {
    const ownerUserId = await actorOwner(req);
    const result = await adminTerms.createTerm({ ownerUserId, actorUserId: req.user.id, body: req.body, idempotencyKey: mutationKey(req) });
    return sendMutation(res, result, '固定班期已建立');
  }));

  router.patch('/admin/courses/terms/:id', ...withAuth(async (req, res) => {
    const ownerUserId = await resourceOwner(req, 'course_terms', req.params.id);
    const result = await adminTerms.updateTerm({
      termId: req.params.id,
      ownerUserId,
      actorUserId: req.user.id,
      body: req.body,
      idempotencyKey: mutationKey(req),
      expectedRowVersion: rowVersion(req),
    });
    return sendMutation(res, result, '固定班期已更新');
  }));

  router.post('/admin/courses/terms/:id/sessions', ...withAuth(async (req, res) => {
    const ownerUserId = await resourceOwner(req, 'course_terms', req.params.id);
    const result = await adminTerms.createTermSession({
      termId: req.params.id,
      ownerUserId,
      actorUserId: req.user.id,
      body: req.body,
      idempotencyKey: mutationKey(req),
      expectedTermRowVersion: rowVersion(req),
    });
    return sendMutation(res, result, '固定班場次已建立');
  }));

  router.post('/admin/courses/terms/:id/pricing-rules', ...withAuth(async (req, res) => {
    const ownerUserId = await resourceOwner(req, 'course_terms', req.params.id);
    const result = await adminTerms.upsertPricingRule({
      termId: req.params.id,
      ownerUserId,
      actorUserId: req.user.id,
      body: req.body,
      idempotencyKey: mutationKey(req),
    });
    return sendMutation(res, result, '固定班定價已建立');
  }));

  router.patch('/admin/courses/pricing-rules/:id', ...withAuth(async (req, res) => {
    const ownerUserId = await resourceOwner(req, 'course_term_pricing_rules', req.params.id);
    const [rows] = await pool.query('SELECT term_id FROM course_term_pricing_rules WHERE id = ? LIMIT 1', [positiveInteger(req.params.id)]);
    const result = await adminTerms.upsertPricingRule({
      termId: rows[0].term_id,
      pricingRuleId: req.params.id,
      ownerUserId,
      actorUserId: req.user.id,
      body: req.body,
      idempotencyKey: mutationKey(req),
      expectedRowVersion: rowVersion(req),
    });
    return sendMutation(res, result, '固定班定價已更新');
  }));

  router.get('/admin/courses/terms/:id/readiness', ...withAuth(async (req, res) => {
    const ownerUserId = await resourceOwner(req, 'course_terms', req.params.id);
    const result = await adminTerms.termReadiness({ termId: req.params.id, ownerUserId });
    res.setHeader('ETag', `W/"${result.rowVersion}"`);
    return ok(res, result, '固定班發布檢查');
  }));

  router.post('/admin/courses/terms/:id/publish', ...withAuth(async (req, res) => {
    const ownerUserId = await resourceOwner(req, 'course_terms', req.params.id);
    const result = await adminTerms.publishTerm({
      termId: req.params.id,
      ownerUserId,
      actorUserId: req.user.id,
      idempotencyKey: mutationKey(req),
      expectedRowVersion: rowVersion(req),
    });
    return sendMutation(res, result, '固定班期已發布');
  }));

  router.post('/admin/courses/renewal-rules', ...withAuth(async (req, res) => {
    const ownerUserId = await actorOwner(req);
    const result = await adminTerms.upsertRenewalRule({ ownerUserId, actorUserId: req.user.id, body: req.body, idempotencyKey: mutationKey(req) });
    return sendMutation(res, result, '續報規則已建立');
  }));

  router.put('/admin/courses/students/:id/level', ...withAuth(async (req, res) => {
    const ownerUserId = await resourceOwner(req, 'course_students', req.params.id);
    const result = await adminTerms.upsertStudentLevel({
      studentId: req.params.id,
      ownerUserId,
      actorUserId: req.user.id,
      body: req.body,
      idempotencyKey: mutationKey(req),
      expectedStudentRowVersion: rowVersion(req),
    });
    return sendMutation(res, result, '學員程度已更新');
  }));

  router.post('/admin/courses/enrollments/:id/complete', ...withAuth(async (req, res) => {
    const ownerUserId = await resourceOwner(req, 'course_term_enrollments', req.params.id);
    const result = await adminTerms.completeEnrollment({
      enrollmentId: req.params.id,
      ownerUserId,
      actorUserId: req.user.id,
      reason: req.body?.reason,
      idempotencyKey: mutationKey(req),
      expectedRowVersion: rowVersion(req),
    });
    return sendMutation(res, result, '固定班報名已標記結業');
  }));

  router.patch('/admin/courses/renewal-rules/:id', ...withAuth(async (req, res) => {
    const ownerUserId = await resourceOwner(req, 'course_term_renewal_rules', req.params.id);
    const result = await adminTerms.upsertRenewalRule({
      ruleId: req.params.id,
      ownerUserId,
      actorUserId: req.user.id,
      body: req.body,
      idempotencyKey: mutationKey(req),
      expectedRowVersion: rowVersion(req),
    });
    return sendMutation(res, result, '續報規則已更新');
  }));

  router.get('/courses/renewals/:id/eligibility', ...withAuth(async (req, res) => {
    return ok(res, await adminTerms.renewalEligibility({ ruleId: req.params.id, userId: req.user.id }), '續報資格');
  }));

  router.post('/courses/renewals/:id/quote', ...withAuth(async (req, res) => {
    const result = await adminTerms.createRenewalQuote({
      ruleId: req.params.id,
      userId: req.user.id,
      idempotencyKey: mutationKey(req),
      expectedRuleRowVersion: rowVersion(req),
    });
    return sendMutation(res, result, '續報報價已鎖定');
  }));

  router.get('/courses/me/waitlist-offers', ...withAuth(async (req, res) => {
    return ok(res, { items: await adminTerms.listMemberSeatOffers({ userId: req.user.id }) }, '候補名額');
  }));

  for (const action of ['accept', 'decline']) {
    router.post(`/courses/waitlist-offers/:id/${action}`, ...withAuth(async (req, res) => {
      const result = await adminTerms.transitionSeatOffer({
        offerId: req.params.id,
        userId: req.user.id,
        action,
        idempotencyKey: mutationKey(req),
        expectedRowVersion: rowVersion(req),
      });
      return sendMutation(res, result, action === 'accept' ? '已接受候補名額，請於期限內結帳' : '已放棄候補名額');
    }));
  }

  router.get('/admin/courses/terms/:id/waitlist', ...withAuth(async (req, res) => {
    const ownerUserId = await resourceOwner(req, 'course_terms', req.params.id);
    const [rows] = await pool.query(
      `SELECT w.*, s.display_name AS student_name, s.email AS student_email,
              o.id AS offer_id, o.offer_code, o.status AS offer_status,
              o.expires_at AS offer_expires_at
         FROM course_term_waitlist_entries w
         JOIN course_students s ON s.id = w.student_id
         LEFT JOIN course_term_seat_offers o
           ON o.waitlist_entry_id = w.id AND o.status = 'OFFERED'
        WHERE w.term_id = ? AND w.owner_user_id = ?
        ORDER BY w.priority, w.joined_at, w.id`,
      [positiveInteger(req.params.id), ownerUserId]
    );
    return ok(res, { items: rows }, '固定班候補名單');
  }));

  router.post('/admin/courses/terms/:id/waitlist/offers', ...withAuth(async (req, res) => {
    const ownerUserId = await resourceOwner(req, 'course_terms', req.params.id);
    const result = await adminTerms.createSeatOffer({
      termId: req.params.id,
      ownerUserId,
      actorUserId: req.user.id,
      idempotencyKey: mutationKey(req),
      expectedTermRowVersion: rowVersion(req),
      offerMinutes: req.body?.offerMinutes ?? req.body?.offer_minutes,
    });
    return sendMutation(res, result, '已限時釋出候補名額');
  }));

  return adminTerms;
}

module.exports = {
  registerCourseTermAdminRoutes,
};
