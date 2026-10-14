const test = require('node:test');
const assert = require('node:assert/strict');
const { checklistHasMinimumPhotos, resolveChecklistPhotoLimit, checklistPhotoMinimumForOrder, reservationChecklistPhotoMinimum } = require('../src/utils/checklist-photo-policy');

test('orders before the fixed Taipei cutoff use one photo, with exact-boundary and UTC equivalence', () => {
  for (const date of ['2026-10-13 17:42:30', '2026-10-13T17:42:30+08:00', '2026-10-13T09:42:30Z', new Date('2026-10-13T09:42:30Z'), null, undefined, '']) {
    assert.equal(checklistPhotoMinimumForOrder(date), 1);
  }
  for (const date of ['2026-10-13 17:42:31', '2026-10-13T17:42:31', '2026-10-13T17:42:31+08:00', '2026-10-13T09:42:31Z', new Date('2026-10-13T09:42:31Z'), '2026-10-14 00:00:00']) {
    assert.equal(checklistPhotoMinimumForOrder(date), 2);
  }
});

test('reservation policy loads the parent order creation date, not the reservation date', async () => {
  const calls = [];
  const queryable = { async query(sql, params) {
    calls.push({ sql, params });
    return [[{ created_at: '2026-10-12 00:00:00' }]];
  } };
  assert.equal(await reservationChecklistPhotoMinimum(queryable, { order_id: 77, reserved_at: '2026-10-20 12:00:00' }), 1);
  assert.deepEqual(calls, [{ sql: 'SELECT created_at FROM orders WHERE id = ? LIMIT 1', params: [77] }]);
  assert.equal(await reservationChecklistPhotoMinimum(queryable, { order_id: 77, order_created_at: '2026-10-14 00:00:00' }), 2);
  assert.equal(calls.length, 1);
  assert.equal(await reservationChecklistPhotoMinimum(queryable, {}), 1);
});

test('minimum photo count uses authoritative counts and supports metadata-only summaries', () => {
  for (const count of [0, 1, 2, 3, 6]) {
    assert.equal(checklistHasMinimumPhotos({ photoCount: count }), count >= 2);
    assert.equal(checklistHasMinimumPhotos({ photos: Array(count).fill({ id: 1 }) }), count >= 2);
  }
  assert.equal(checklistHasMinimumPhotos({ photoCount: 1, photos: [{}, {}] }), false);
  assert.equal(checklistHasMinimumPhotos({ photoCount: '2' }), true);
  assert.equal(checklistHasMinimumPhotos({ photoCount: NaN }), false);
  assert.equal(checklistHasMinimumPhotos(null), false);
});

test('photo limit never prevents reaching the minimum and invalid settings use the existing default', () => {
  assert.equal(resolveChecklistPhotoLimit(1), 2);
  assert.equal(resolveChecklistPhotoLimit('2'), 2);
  assert.equal(resolveChecklistPhotoLimit('8'), 8);
  for (const value of [undefined, '', 0, -1, 'bad', 2.5, Infinity]) {
    assert.equal(resolveChecklistPhotoLimit(value), 6);
  }
});

test('public checklist definitions advertise the additive two-photo policy without changing definitions', () => {
  const buildOrderRoutes = require('../src/routes/orders');
  const middleware = (_req, _res, next) => next();
  const definitions = { definitions: { pre_dropoff: { title: '交車檢核', items: ['貨況確認'] } } };
  const context = new Proxy({
    pool: { getConnection: async () => { throw new Error('The public photo policy must not access the database'); } },
    getReservationChecklistDefinitions: () => definitions,
    CHECKLIST_PHOTO_LIMIT: 6,
    MAX_CHECKLIST_IMAGE_BYTES: 8388608,
    CHECKLIST_ALLOWED_MIME: new Set(['image/jpeg', 'image/jpg', 'image/png']),
    ok: (_res, data) => data,
    fail: (_res, code, message) => { throw new Error(`${code}: ${message}`); },
  }, { get: (target, key) => target[key] ?? middleware });
  const router = buildOrderRoutes(context);
  const handler = router.stack.find(layer => layer.route?.path === '/app/reservation_checklists').route.stack.at(-1).handle;
  const result = handler({}, {});
  assert.deepEqual(result.definitions, definitions.definitions);
  assert.deepEqual(result.photoPolicy, {
    minCount: 2, maxCount: 6, maxBytes: 8388608, allowedMimeTypes: ['image/jpeg', 'image/png'],
  });
});
