const test = require('node:test');
const assert = require('node:assert/strict');
const buildReservationRoutes = require('../src/routes/reservations');
const { buildCsv } = require('../src/utils/csv');

const exportPath = '/admin/events/:id/reservations/export';

function harness({ rows = [], event = { id: 42, title: '鐵人託運', owner_user_id: 'provider' }, deliveryPointId = 7, queryError } = {}) {
  const queries = [];
  const eventReads = [];
  const middleware = (_req, _res, next) => next();
  const guard = (req, res, next) => {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED' });
    if (!['ADMIN', 'SERVICE_PROVIDER', 'DELIVERY_POINT'].includes(req.user.role)) return res.status(403).json({ code: 'FORBIDDEN' });
    return next();
  };
  const context = new Proxy({
    reservationManagerOnly: guard,
    getEventById: async (id, options) => { eventReads.push({ id, options }); return event; },
    normalizeRole: role => role,
    isADMIN: role => role === 'ADMIN',
    isSTORE: role => role === 'SERVICE_PROVIDER',
    isDELIVERY_POINT: role => role === 'DELIVERY_POINT',
    getDeliveryPointIdByUserId: async () => deliveryPointId,
    zhReservationStatus: status => ({ pre_dropoff: '賽前交車', cancelled: '已取消' })[status] || status,
    fail: (res, code, message, status) => res.status(status).json({ ok: false, code, message }),
    pool: { query: async (sql, params) => {
      queries.push({ sql, params });
      if (queryError) throw queryError;
      return [rows];
    } },
    MAX_CHECKLIST_IMAGE_BYTES: 1024,
  }, { get: (target, key) => target[key] ?? middleware });
  const route = buildReservationRoutes(context).stack.find(layer => layer.route?.path === exportPath).route;
  return {
    queries, eventReads,
    async request({ id = '42', user = { id: 'admin', role: 'ADMIN' } } = {}) {
      const res = {
        statusCode: 200, headers: {},
        status(code) { this.statusCode = code; return this; },
        setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
        json(value) { this.body = value; return this; },
        send(value) { this.body = value; return this; },
      };
      for (const layer of route.stack) {
        let next = false;
        await layer.handle({ params: { id }, user }, res, () => { next = true; });
        if (!next) break;
      }
      return res;
    },
  };
}

test('CSV preserves Unicode, quotes, multiline cells, nulls and leading-zero phone numbers', () => {
  const csv = buildCsv([['姓名', '電話', '備註'], ['王,"小明"\n測試', '0912345678', null]]);
  assert.equal(csv, '\uFEFF"姓名","電話","備註"\r\n"王,""小明""\n測試","\'0912345678",""\r\n');
  assert.deepEqual([...Buffer.from(csv).subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test('CSV neutralizes spreadsheet formulas including whitespace prefixes', () => {
  for (const value of ['=1+1', '+886912345678', '-1+2', '@SUM(1)', '  =1+1', '\t=1+1', '\r=1+1', '\n=1+1']) {
    assert.equal(buildCsv([[value]]), `\uFEFF"'${value}"\r\n`);
  }
});

test('exports all reservations beyond page limits, with cancellation labels and only roster columns', async () => {
  const rows = Array.from({ length: 251 }, (_, i) => ({
    id: i + 1, order_code: 'ORDER-01', event: '鐵人託運', store: '台北交車點', ticket_type: '來回',
    username: '王小明', phone: '0912345678', email: 'qa@example.test', status: i === 250 ? 'cancelled' : 'pre_dropoff',
    reserved_at: '2026-09-22 09:00:00', verify_code: 'SECRET-CODE',
  }));
  const h = harness({ rows });
  const res = await h.request();
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'text/csv; charset=utf-8');
  assert.equal(res.headers['cache-control'], 'private, no-store');
  assert.equal(res.headers['content-disposition'], 'attachment; filename="event_42_reservations.csv"');
  assert.equal(res.body.split('\r\n').length, 253);
  assert.ok(res.body.includes('"251","ORDER-01"'));
  assert.ok(res.body.includes('"已取消"'));
  assert.ok(!res.body.includes('SECRET-CODE'));
  assert.deepEqual(h.eventReads, [{ id: 42, options: { useCache: false } }]);
  assert.deepEqual(h.queries[0].params, [42, '鐵人託運', 42, '鐵人託運']);
  assert.match(h.queries[0].sql, /r\.event_id = \? OR \(r\.event_id IS NULL/);
  assert.match(h.queries[0].sql, /SELECT MAX\(e\.id\)/);
  assert.doesNotMatch(h.queries[0].sql, /LIMIT|OFFSET|r\.\*/);
});

test('an empty roster still downloads the column headers', async () => {
  const res = await harness().request();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.split('\r\n').length, 2);
  assert.ok(res.body.startsWith('\uFEFF"預約編號"'));
});

test('provider export requires current event ownership', async () => {
  const h = harness();
  const denied = await h.request({ user: { id: 'other-provider', role: 'SERVICE_PROVIDER' } });
  assert.equal(denied.statusCode, 403);
  assert.equal(h.queries.length, 0);
  const allowed = await h.request({ user: { id: 'provider', role: 'SERVICE_PROVIDER' } });
  assert.equal(allowed.statusCode, 200);
  assert.equal(h.queries.length, 1);
});

test('delivery points can only export their assigned reservations', async () => {
  const h = harness();
  const user = { id: 'point-user', role: 'DELIVERY_POINT' };
  assert.equal((await h.request({ user })).statusCode, 200);
  assert.match(h.queries[0].sql, /AND r\.delivery_point_id = \?/);
  assert.equal(h.queries[0].params.at(-1), 7);
  const unbound = harness({ deliveryPointId: null });
  assert.equal((await unbound.request({ user })).statusCode, 403);
  assert.equal(unbound.queries.length, 0);
});

test('unauthenticated users, members, editors and drivers cannot download the roster', async () => {
  const h = harness();
  for (const user of [null, { role: 'USER' }, { role: 'EDITOR' }, { role: 'DRIVER' }]) {
    assert.equal((await h.request({ user })).statusCode, user ? 403 : 401);
  }
  assert.equal(h.eventReads.length, 0);
  assert.equal(h.queries.length, 0);
});

test('invalid IDs, missing events and database failures return errors instead of CSV', async () => {
  const h = harness();
  for (const id of ['bad', '-1', '0', '1.5', '9007199254740992']) {
    assert.equal((await h.request({ id })).statusCode, 400);
  }
  assert.equal(h.eventReads.length, 0);
  assert.equal((await harness({ event: null }).request()).statusCode, 404);
  const failure = await harness({ queryError: new Error('Database unavailable') }).request();
  assert.equal(failure.statusCode, 500);
  assert.equal(failure.body.code, 'EVENT_RESERVATIONS_EXPORT_FAIL');
  assert.equal(failure.headers['content-type'], undefined);
});
