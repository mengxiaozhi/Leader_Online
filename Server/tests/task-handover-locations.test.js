'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const buildRoutes = require('../src/routes/reservations');

for (const role of ['DRIVER', 'DELIVERY_POINT']) test(`${role} tasks include current published per-store locations`, async () => {
  const stores = [
    { id: 8, address: '台北門市地址', pre_pickup_location: '台北門市現場取車區', post_dropoff_location: '台北門市現場交車區' },
    { id: 9, address: '台中門市地址', pre_pickup_location: '台中門市現場取車區', post_dropoff_location: null },
  ];
  const context = new Proxy({
    pool: { query: async (sql, params) => {
      if (sql.endsWith('LIMIT 0')) return [[]];
      assert.ok(sql.includes('FROM event_stores WHERE id IN'));
      assert.deepEqual(params, [8, 9]);
      return [stores];
    } },
    normalizeRole: value => value,
    listReservationTasksForAssignee: async (userId, taskRole, options) => {
      assert.equal(userId, 'staff'); assert.equal(taskRole, role); assert.equal(options.includeCompleted, true);
      return stores.map(store => ({ id: store.id + 100, store_id: store.id, task_id: store.id + 200, event_address: '比賽會場' }));
    },
    ok: (res, data) => res.json({ ok: true, data }),
    fail: (res, code, message, status) => res.status(status).json({ ok: false, code, message }),
  }, { get: (target, key) => target[key] ?? ((_req, _res, next) => next()) });
  const router = buildRoutes(context);
  const handler = router.stack.find(layer => layer.route?.path === '/tasks/me').route.stack.at(-1).handle;
  const res = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await handler({ user: { id: 'staff', role } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data[0].handoverSchedule.locations.pre_pickup, '台北門市現場取車區');
  assert.equal(res.body.data[1].handoverSchedule.locations.pre_pickup, '台中門市現場取車區');
  assert.equal(res.body.data[1].handoverSchedule.locations.post_dropoff, null);
  assert.equal(res.body.data[0].store_address, '台北門市地址');
});
