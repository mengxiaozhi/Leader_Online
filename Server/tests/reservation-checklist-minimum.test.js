const test = require('node:test');
const assert = require('node:assert/strict');
const buildReservationRoutes = require('../src/routes/reservations');

const stages = ['pre_dropoff', 'pre_pickup', 'post_dropoff', 'post_pickup'];
const nextStages = ['pre_pickup', 'post_dropoff', 'post_pickup', 'done'];
const items = [{ label: '貨況確認', checked: true }];
const completedAt = '2026-10-01T00:00:00.000Z';

// Execute real route handlers with transaction/query doubles; no live DB or external calls.
function fixture(stage, count, { completed = true, lockedCount = count, allChecked = true } = {}) {
  const counts = Object.fromEntries(stages.map(key => [key, key === stage ? count : 6]));
  const row = { id: 161, user_id: 'member', order_id: 77, status: stage };
  for (const key of stages) {
    row[`verify_code_${key}`] = key === stage ? '123456' : '654321';
    row[`${key}_checklist`] = { items, completed: key === stage ? completed : true, completedAt };
  }
  const queries = [];
  let commits = 0;
  let rollbacks = 0;
  let notifications = 0;
  const query = async (sql, params = [], locked = false) => {
    queries.push({ sql, params, locked });
    if (sql.includes('AS event_title')) return [[]]; // Wallet lookup: no issued pass in this fixture.
    if (sql.includes('SELECT COUNT(*) AS cnt')) {
      assert.deepEqual(params, [161, stage], 'photo count must be scoped to this reservation and stage');
      return [[{ cnt: locked ? Math.min(counts[stage], lockedCount) : counts[stage] }]];
    }
    if (sql.includes('SELECT details FROM orders')) return [[{ details: {} }]];
    if (sql.includes('FROM users')) return [[{ username: '測試會員', email: '' }]];
    if (sql.startsWith('SELECT id, storage_path') || sql.startsWith('SELECT id FROM reservation_checklist_photos')) {
      return [[{ id: 1 }]];
    }
    if (sql.startsWith('DELETE FROM reservation_checklist_photos')) {
      counts[stage]--;
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('INSERT INTO reservation_checklist_photos')) {
      counts[stage]++;
      return [{ insertId: counts[stage], affectedRows: 1 }];
    }
    const checklistUpdate = sql.match(/^UPDATE reservations SET (\w+_checklist) =/);
    if (checklistUpdate) {
      row[checklistUpdate[1]] = JSON.parse(params[0]);
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('UPDATE reservations SET status')) {
      row.status = params[0];
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('SELECT * FROM reservations') || sql.includes('FROM reservations r')) return [[row]];
    throw new Error(`Unexpected query: ${sql}`);
  };
  const connection = {
    query: (sql, params) => query(sql, params, true),
    async beginTransaction() {}, async commit() { commits++; },
    async rollback() { rollbacks++; }, release() {},
  };
  const middleware = (_req, _res, next) => next();
  const normalizeChecklist = raw => typeof raw === 'string' ? JSON.parse(raw) : raw;
  const context = new Proxy({
    pool: { query, getConnection: async () => connection },
    ok: (res, data) => res.json({ ok: true, data }),
    fail: (res, code, message, status) => res.status(status).json({ ok: false, code, message }),
    MAX_CHECKLIST_IMAGE_BYTES: 1024,
    CHECKLIST_PHOTO_LIMIT: 6,
    CHECKLIST_ALLOWED_MIME: new Set(['image/jpeg']),
    CHECKLIST_STAGE_KEYS: stages,
    isChecklistStage: value => stages.includes(value),
    isSTORE: () => false, isDRIVER: () => false, isDELIVERY_POINT: () => false,
    isChecklistPhotoStorageEnabled: () => true,
    parseBooleanParam: (value, fallback) => value == null ? fallback : value === true,
    checklistColumnByStage: key => `${key}_checklist`,
    normalizeChecklist,
    ensureChecklistHasPhotos: checklist => checklist.photoCount > 0,
    ensureChecklistReservationAccess: async () => ({ ok: true, isOwner: true, reservation: row }),
    fetchReservationById: async () => row,
    fetchReservationContext: async () => ({ reservation: row }),
    hydrateReservationChecklists: async () => Object.fromEntries(stages.map(key => [key, {
      ...normalizeChecklist(row[`${key}_checklist`]), photoCount: counts[key],
      photos: Array.from({ length: counts[key] }, (_, index) => ({ id: index + 1 })),
    }])),
    generateReservationStageCode: async () => '777777',
    syncReservationTasksForIds: async () => {},
    notifyReservationStageChange: async () => {},
    sendReservationStatusEmail: async () => { notifications++; },
    composeChecklistCompletionContent: () => ({}),
    zhReservationStatus: key => key,
    buildChecklistStoragePath: () => 'checklists/161/test.jpg',
    storage: {
      mimeToExtension: () => 'jpg', writeBuffer: async () => {},
      normalizeRelativePath: value => value, hashBuffer: () => 'checksum',
      deleteFile: async () => {},
    },
  }, { get: (target, key) => target[key] ?? middleware });
  const router = buildReservationRoutes(context);
  return {
    row, counts, queries,
    get commits() { return commits; }, get rollbacks() { return rollbacks; },
    get notifications() { return notifications; },
    async request(path, body = {}, options = {}) {
      const handler = router.stack.find(layer => layer.route?.path === path).route.stack.at(-1).handle;
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
      const photo = { buffer: Buffer.from([0xff, 0xd8, 0xff, ...Array(13).fill(0)]), mimetype: 'image/jpeg', originalname: 'bike.jpg' };
      await handler({ params: { id: '161', stage: options.stage || stage, photoId: '1' },
        body: { items: [{ ...items[0], checked: allChecked }], ...body },
        user: { id: 'member', role: 'ADMIN' }, file: options.upload ? photo : undefined }, res);
      return res;
    },
  };
}

for (const stage of stages) {
  for (const count of [0, 1, 2, 3]) {
    test(`${stage}: complete endpoint requires two photos even when other stages have six (${count})`, async () => {
      const f = fixture(stage, count, { completed: count < 2 });
      const result = await f.request('/reservations/:id/checklists/:stage', { completed: true });
      assert.equal(result.statusCode, count < 2 ? 400 : 200, JSON.stringify(result.body));
      assert.equal(f.commits, count < 2 ? 0 : 1);
      if (count < 2) {
        assert.equal(result.body.code, 'PHOTO_REQUIRED');
        assert.match(result.body.message, /2 張.*左側.*右側/);
      } else {
        assert.equal(result.body.data.checklist.completed, true);
        assert.equal(f.notifications, 1, 'newly completed checklists keep their completion notification');
      }
    });
    test(`${stage}: scan preview and confirmation obey the same minimum (${count})`, async () => {
      const f = fixture(stage, count);
      const preview = await f.request('/admin/reservations/progress_scan', { code: '123456' });
      assert.equal(preview.statusCode, 200, JSON.stringify(preview.body));
      assert.equal(preview.body.data.checklistReady, count >= 2);
      assert.equal(preview.body.data.stageChecklist[stage].found, count > 0);
      assert.equal(f.commits, 0);
      const result = await f.request('/admin/reservations/progress_scan', { code: '123456', confirm: true });
      assert.equal(result.statusCode, count < 2 ? 422 : 200, JSON.stringify(result.body));
      if (count < 2) assert.equal(result.body.code, 'CHECKLIST_NOT_READY');
      else assert.equal(result.body.data.to, nextStages[stages.indexOf(stage)]);
    });
  }
  test(`${stage}: a photo deleted after preview blocks scan inside the locked transaction`, async () => {
    const f = fixture(stage, 2, { lockedCount: 1 });
    const result = await f.request('/admin/reservations/progress_scan', { code: '123456', confirm: true });
    assert.equal(result.statusCode, 422, JSON.stringify(result.body));
    assert.equal(result.body.code, 'CHECKLIST_NOT_READY');
    assert.equal(f.rollbacks, 1);
    assert.equal(f.commits, 0);
    assert.equal(f.row.status, stage);
    assert.ok(f.queries.some(query => query.locked && query.sql.includes('SELECT COUNT(*)')));
  });
  test(`${stage}: deletion below minimum resets only this stage and allows recompletion`, async () => {
    const f = fixture(stage, 2);
    const historical = JSON.stringify(f.row[`${stages.find(key => key !== stage)}_checklist`]);
    const result = await f.request('/reservations/:id/checklists/:stage/photos/:photoId');
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    assert.equal(result.body.data.checklist.photoCount, 1);
    assert.equal(result.body.data.checklist.completed, false);
    assert.equal(result.body.data.checklist.completedAt, null);
    assert.equal(JSON.stringify(f.row[`${stages.find(key => key !== stage)}_checklist`]), historical);
    f.counts[stage] = 2;
    const completed = await f.request('/reservations/:id/checklists/:stage', { completed: true });
    assert.equal(completed.statusCode, 200, JSON.stringify(completed.body));
    assert.equal(completed.body.data.checklist.completed, true);
    assert.ok(completed.body.data.checklist.completedAt);
  });
  test(`${stage}: legacy completed one-photo checklist recovers by uploading without rewriting history`, async () => {
    const f = fixture(stage, 1, { lockedCount: 6 });
    const result = await f.request('/reservations/:id/checklists/:stage/photos', {}, { upload: true });
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    assert.equal(result.body.data.checklist.photoCount, 2);
    assert.equal(result.body.data.checklist.completed, true);
    assert.equal(result.body.data.checklist.completedAt, completedAt);
    const preview = await f.request('/admin/reservations/progress_scan', { code: '123456' });
    assert.equal(preview.body.data.checklistReady, true);
  });
}

test('two photos do not waive unchecked items or incomplete checklists', async () => {
  const f = fixture('pre_dropoff', 2, { completed: false, allChecked: false });
  const completed = await f.request('/reservations/:id/checklists/:stage', { completed: true });
  assert.equal(completed.body.code, 'CHECKLIST_INCOMPLETE');
  const scanned = await f.request('/admin/reservations/progress_scan', { code: '123456', confirm: true });
  assert.equal(scanned.body.code, 'CHECKLIST_NOT_READY');
});

test('deleting an extra photo keeps completion when two remain', async () => {
  const f = fixture('post_pickup', 3);
  const result = await f.request('/reservations/:id/checklists/:stage/photos/:photoId');
  assert.equal(result.body.data.checklist.photoCount, 2);
  assert.equal(result.body.data.checklist.completed, true);
  assert.equal(result.body.data.checklist.completedAt, completedAt);
});

test('other-stage checklist mutations stay forbidden and manual status adjustment remains available', async () => {
  const f = fixture('pre_dropoff', 0);
  const update = await f.request('/reservations/:id/checklists/:stage', { completed: true }, { stage: 'post_dropoff' });
  assert.equal(update.body.code, 'CHECKLIST_STAGE_MISMATCH');
  const manual = await f.request('/admin/reservations/:id/status', { status: 'done' });
  assert.equal(manual.statusCode, 200, JSON.stringify(manual.body));
  assert.equal(f.row.status, 'done');
  assert.equal(f.queries.some(query => query.sql.includes('SELECT COUNT(*)')), false);
});

test('legacy unnamed shipments keep their completed photos and advance through every handover stage', async () => {
  for (const [index, stage] of stages.entries()) {
    const f = fixture(stage, 2);
    f.row.consignor_name = null;
    const historicalChecklist = JSON.stringify(f.row[`${stage}_checklist`]);
    const preview = await f.request('/admin/reservations/progress_scan', { code: '123456' });
    assert.equal(preview.statusCode, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.data.checklistReady, true);
    assert.equal(preview.body.data.reservation.consignor_name, null);
    const advanced = await f.request('/admin/reservations/progress_scan', { code: '123456', confirm: true });
    assert.equal(advanced.statusCode, 200, JSON.stringify(advanced.body));
    assert.equal(advanced.body.data.to, nextStages[index]);
    assert.equal(f.row.consignor_name, null);
    assert.equal(f.counts[stage], 2);
    assert.equal(JSON.stringify(f.row[`${stage}_checklist`]), historicalChecklist);
    assert.equal(f.commits, 1);
  }
});
