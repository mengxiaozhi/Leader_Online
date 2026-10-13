const test = require('node:test');
const assert = require('node:assert/strict');
const { checklistHasMinimumPhotos, resolveChecklistPhotoLimit } = require('../src/utils/checklist-photo-policy');

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
