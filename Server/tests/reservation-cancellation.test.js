const test = require('node:test');
const assert = require('node:assert/strict');
const buildReservationRoutes = require('../src/routes/reservations');

function fixture(reservation) {
  const queries = [];
  let rollbacks = 0;
  const query = async (sql) => { queries.push(sql); return [[reservation]]; };
  const connection = {
    query, async beginTransaction() {}, async rollback() { rollbacks++; },
    async commit() { assert.fail('A cancelled reservation must never be committed'); }, release() {},
  };
  const middleware = (_req, _res, next) => next();
  const context = new Proxy({
    pool: { query, getConnection: async () => connection },
    isSTORE: () => false, isDELIVERY_POINT: () => false,
    parseBooleanParam: (value, fallback) => value == null ? fallback : value === true,
    fail: (res, code, message, status) => res.status(status).json({ ok: false, code, message }),
    MAX_CHECKLIST_IMAGE_BYTES: 1024,
  }, { get: (target, key) => target[key] ?? middleware });
  const router = buildReservationRoutes(context);
  return {
    queries,
    get rollbacks() { return rollbacks; },
    async request(path, body) {
      const handler = router.stack.find(layer => layer.route?.path === path).route.stack.at(-1).handle;
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
      await handler({ params: { id: '161' }, body, user: { id: 'admin', role: 'ADMIN' } }, res);
      return res;
    },
  };
}

for (const status of ['service_booking', 'pre_dropoff', 'pre_pickup', 'post_dropoff', 'post_pickup', 'done']) {
  test(`cancelled reservation cannot be reopened as ${status}`, async () => {
    const f = fixture({ id: 161, status: 'cancelled' });
    const result = await f.request('/admin/reservations/:id/status', { status });
    assert.equal(result.statusCode, 409, JSON.stringify(result.body));
    assert.equal(result.body.code, 'RESERVATION_ORDER_CANCELLED');
    assert.equal(f.rollbacks, 1);
    assert.ok(f.queries.every(sql => sql.startsWith('SELECT')));
  });
}

for (const reservation of [
  { id: 161, status: 'cancelled' },
  { id: 161, status: 'service_booking', order_details: '{"status":"已退款"}' },
]) {
  test(`scanner rejects inactive reservation ${JSON.stringify(reservation)}`, async () => {
    const f = fixture(reservation);
    const result = await f.request('/admin/reservations/progress_scan', { code: '123456' });
    assert.equal(result.statusCode, 409, JSON.stringify(result.body));
    assert.equal(result.body.code, 'RESERVATION_ORDER_CANCELLED');
    assert.equal(f.queries.length, 1);
  });
}
