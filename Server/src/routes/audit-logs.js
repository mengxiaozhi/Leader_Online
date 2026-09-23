'use strict';
const express = require('express');
const { visibleRequest } = require('../services/audit/access');
const { refreshCourseRequestUser } = require('../services/course-role');
function buildAuditRoutes(ctx) {
  const router = express.Router();
  async function authorize(req, res, next) {
    try {
      await refreshCourseRequestUser(ctx.audit.raw, req);
      const role = String(req.user.role).toUpperCase();
      if (!['ADMIN', 'EDITOR', 'SERVICE_PROVIDER', 'STORE', 'COACH', 'DRIVER', 'DELIVERY_POINT'].includes(role)) {
        const [members] = await ctx.audit.raw.query("SELECT 1 FROM course_staff_memberships WHERE user_id=? AND status='active' LIMIT 1", [req.user.id]);
        if (!members.length) return ctx.fail(res, 'FORBIDDEN', '需要後台權限', 403);
      }
      return next();
    } catch (error) { return ctx.fail(res, error.code || 'AUDIT_QUERY_FAILED', '無法驗證日誌查閱權限', error.statusCode || 503); }
  }
  router.get('/admin/audit-logs', ctx.authRequired, authorize, async (req, res) => {
    try {
      const limit = req.query.limit == null ? 50 : Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) return ctx.fail(res, 'VALIDATION_ERROR', '每頁筆數須為 1–100', 400);
      const cursor = String(req.query.cursor || '');
      if (cursor && !/^\d{1,20}$/.test(cursor)) return ctx.fail(res, 'VALIDATION_ERROR', '分頁游標無效', 400);
      const where = []; const params = [];
      for (const [key, column] of [['actorId', 'actor_id'], ['module', 'module'], ['action', 'action'], ['status', 'status']]) {
        if (req.query[key]) {
          if (String(req.query[key]).length > 255) return ctx.fail(res, 'VALIDATION_ERROR', '篩選條件過長', 400);
          if (key !== 'status' || String(req.user.role).toUpperCase() === 'ADMIN') { where.push(`${column}=?`); params.push(String(req.query[key])); }
        }
      }
      for (const [key, op] of [['from', '>='], ['to', '<']]) {
        if (req.query[key]) {
          const date = String(req.query[key]);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) return ctx.fail(res, 'VALIDATION_ERROR', '日期格式無效', 400);
          where.push(`created_at ${op} ${key === 'to' ? 'DATE_ADD(?, INTERVAL 1 DAY)' : '?'}`); params.push(date);
        }
      }
      // Non-admin status filtering happens only after per-item authorization.
      const items = []; let last = cursor; let exhausted = false;
      // Scan bounded windows; cursor advances over hidden rows without returning their count.
      let scanned = 0;
      while (items.length < limit && scanned < 1000) {
        const clauses = [...where]; const values = [...params];
        if (last) { clauses.push('id < ?'); values.push(last); }
        const [rows] = await ctx.audit.raw.query(`SELECT * FROM admin_audit_requests ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''} ORDER BY id DESC LIMIT 100`, values);
        if (!rows.length) { exhausted = true; break; }
        for (const row of rows) {
          last = String(row.id); scanned++;
          const item = await visibleRequest(ctx, req.user, row, { resourceId: req.query.resourceId ? String(req.query.resourceId) : null });
          if (item && (!req.query.status || item.status === String(req.query.status))) items.push(item);
          if (items.length === limit) break;
        }
        if (rows.length < 100 && items.length < limit) { exhausted = true; break; }
      }
      return ctx.ok(res, { items, nextCursor: exhausted ? null : last, limit });
    } catch (error) { console.error('AUDIT_QUERY_FAILED', error.code); return ctx.fail(res, 'AUDIT_QUERY_FAILED', '操作日誌暫時無法讀取', 503); }
  });
  router.get('/admin/audit-logs/:id', ctx.authRequired, authorize, async (req, res) => {
    try {
      if (!/^\d{1,20}$/.test(req.params.id)) return ctx.fail(res, 'NOT_FOUND', '找不到操作日誌', 404);
      const [rows] = await ctx.audit.raw.query('SELECT * FROM admin_audit_requests WHERE id=? LIMIT 1', [req.params.id]);
      const item = rows[0] && await visibleRequest(ctx, req.user, rows[0], { detail: true });
      if (!item) return ctx.fail(res, 'NOT_FOUND', '找不到操作日誌', 404);
      return ctx.ok(res, item);
    } catch (error) { return ctx.fail(res, 'AUDIT_QUERY_FAILED', '操作日誌暫時無法讀取', 503); }
  });
  return router;
}
module.exports = buildAuditRoutes;
