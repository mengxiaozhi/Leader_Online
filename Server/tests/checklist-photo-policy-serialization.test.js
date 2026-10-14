const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { checklistPhotoMinimumForOrder, reservationChecklistPhotoMinimum } = require('../src/utils/checklist-photo-policy');

const stages = ['pre_dropoff', 'pre_pickup', 'post_dropoff', 'post_pickup'];
const source = fs.readFileSync(require.resolve('../src/context'), 'utf8');
const orderDates = new Map([[77, '2026-10-13 17:42:30'], [78, '2026-10-13 17:42:31']]);
const reservation = orderId => ({
  id: orderId, order_id: orderId, status: 'pre_dropoff', reserved_at: '2026-10-20 12:00:00',
  ...Object.fromEntries(stages.map(stage => [`${stage}_checklist`, { items: [], completed: true, completedAt: '2026-10-13T10:00:00Z' }])),
});

function contextFixture() {
  const queries = [];
  const pool = { async query(sql, params) {
    queries.push({ sql, params });
    if (sql.startsWith('SELECT id, created_at FROM orders')) return [params.map(id => ({ id, created_at: orderDates.get(id) }))];
    if (sql.startsWith('SELECT created_at FROM orders')) return [[{ created_at: orderDates.get(params[0]) }]];
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const photos = Object.fromEntries(stages.map(stage => [stage, [{ id: 1 }]]));
  const context = vm.createContext({
    CHECKLIST_STAGE_KEYS: stages, pool, checklistPhotoMinimumForOrder, reservationChecklistPhotoMinimum,
    checklistColumnByStage: stage => `${stage}_checklist`, normalizeChecklist: value => value,
    listChecklistPhotos: async () => photos,
    listChecklistPhotosBulk: async ids => new Map(ids.map(id => [id, Object.fromEntries(stages.map(stage => [stage, 1]))])),
  });
  // Exercise the actual serialization helpers without starting context.js's DB or workers.
  vm.runInContext(source.slice(source.indexOf('function mergeChecklistWithPhotos('), source.indexOf('const CART_ITEM_LIMIT')), context);
  return { context, queries };
}

test('hydrated stage responses carry the parent order minimum on every stage', async () => {
  const { context } = contextFixture();
  for (const orderId of [77, 78]) {
    const checklists = await context.hydrateReservationChecklists(reservation(orderId));
    for (const stage of stages) {
      assert.equal(checklists[stage].minPhotoCount, orderId === 77 ? 1 : 2);
      assert.equal(checklists[stage].photoCount, 1);
      assert.equal(checklists[stage].completed, true);
    }
  }
});

test('admin summaries batch order dates and keep count-only and detailed contracts consistent', async () => {
  const { context, queries } = contextFixture();
  const rows = await context.buildAdminReservationSummaries([reservation(77), reservation(78)]);
  assert.equal(queries.length, 1, 'order creation dates are fetched once for the entire page');
  for (const row of rows) for (const stage of stages) {
    const minimum = row.order_id === 77 || row.id === 77 ? 1 : 2;
    assert.equal(row.checklists[stage].minPhotoCount, minimum);
    assert.equal(row.stage_checklist[stage].minPhotoCount, minimum);
    assert.equal(row.stage_checklist[stage].completed, true);
    assert.equal(row.checklists[stage].photoCount, 1);
  }
});
