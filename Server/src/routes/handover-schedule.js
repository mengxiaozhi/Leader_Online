'use strict';

const express = require('express');
const { schemaReady, draftSchemaReady, fault, editorStateFromRow, updateHandoverSchedule, notificationSummary, sqlDate } = require('../services/handover-schedule');

function buildHandoverScheduleRoutes(ctx) {
  const router = express.Router();
  const { pool, ok, fail, eventManagerOnly, isADMIN, isSTORE } = ctx;
  async function lockedStore(conn, req) {
    if (!(await schemaReady(conn))) throw fault('HANDOVER_SCHEMA_MISSING', '交取車時間功能尚未完成資料庫更新', 503);
    if (!(await draftSchemaReady(conn))) throw fault('HANDOVER_DRAFT_SCHEMA_MISSING', '請先執行交取車時間草稿資料庫 migration（059）', 503);
    const id = Number(req.params.storeId);
    if (!Number.isSafeInteger(id) || id <= 0) throw fault('VALIDATION_ERROR', '交車點編號不正確');
    const [[store]] = await conn.query(`SELECT s.*, e.owner_user_id AS event_owner_user_id, e.is_exclusive
      FROM event_stores s LEFT JOIN events e ON e.id = s.event_id WHERE s.id = ? FOR UPDATE`, [id]);
    if (!store) throw fault('STORE_NOT_FOUND', '找不到交車點服務', 404);
    const owner = String(store.owner_user_id || store.event_owner_user_id || '');
    if (!isADMIN(req.user.role) && (!isSTORE(req.user.role) || owner !== String(req.user.id)
      || (Number(store.is_exclusive) && String(store.event_owner_user_id) !== String(req.user.id)))) {
      throw fault('FORBIDDEN', '無權限操作此交車點服務', 403);
    }
    return store;
  }
  const handle = operation => async (req, res) => {
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const store = await lockedStore(conn, req);
      const data = await operation(conn, req, store);
      await conn.commit();
      if (data.changed) ctx.invalidateEventStoresCache(store.event_id);
      return ok(res, data);
    } catch (error) {
      if (conn) { try { await conn.rollback(); } catch {} }
      return fail(res, error.code || 'HANDOVER_SCHEDULE_FAIL', error.message, error.statusCode || 500);
    } finally { conn?.release(); }
  };
  router.get('/admin/events/stores/:storeId/schedule', eventManagerOnly, handle(async (conn, req, store) => ({
    ...editorStateFromRow(store), notifications: await notificationSummary(conn, store.id),
  })));
  router.patch('/admin/events/stores/:storeId/schedule', eventManagerOnly, handle(async (conn, req, store) => {
    const header = String(req.get('If-Match') || '');
    if (!/^(?:[1-9]\d*|"[1-9]\d*")$/.test(header)) throw fault('PRECONDITION_REQUIRED', '請重新載入時程版本後再儲存', 428);
    const expectedVersion = Number(header.replaceAll('"', ''));
    const result = await updateHandoverSchedule(conn, { store, expectedVersion, stages: req.body?.stages, mode: req.body?.mode });
    return { ...result, notifications: await notificationSummary(conn, store.id) };
  }));
  router.post('/admin/events/stores/:storeId/schedule/notifications/retry', eventManagerOnly, handle(async (conn, req, store) => {
    await conn.query("UPDATE handover_notification_outbox SET status = 'PENDING', attempts = 0, due_at = ?, locked_at = NULL WHERE store_id = ? AND status IN ('FAILED','DEAD')", [sqlDate(new Date()), store.id]);
    return { notifications: await notificationSummary(conn, store.id) };
  }));
  return router;
}
module.exports = buildHandoverScheduleRoutes;
