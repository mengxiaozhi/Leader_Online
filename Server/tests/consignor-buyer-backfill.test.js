const test = require('node:test');
const assert = require('node:assert/strict');
const { planBuyerConsignorBackfill, backfillBuyerConsignorNames, rollbackBuyerConsignorNames } = require('../src/services/consignor-buyer-backfill');
const { parseArguments } = require('../scripts/backfill-consignor-buyer-names');

function fixture() {
  const shipment = { kind: 'event-reservation', status: '已付款', total: 1500, selections: [{ type: '來回', qty: 1 }] };
  return {
    orders: [
      { id: 1, buyer_name: '會員改名後', row_version: 3, details: { ...shipment, contactSnapshot: { username: ' 下單時   購買者 ' } } },
      { id: 2, buyer_name: '購買者二', row_version: 2, details: JSON.stringify({ ...shipment, consignorName: null }) },
      { id: 3, buyer_name: '購買者三', row_version: 1, details: { ...shipment, consignorName: '不同的實際託運者' } },
      { id: 4, buyer_name: '購票會員', row_version: 1, details: { productId: 8, quantity: 1 } },
    ],
    reservations: [
      { id: 11, order_id: 1, buyer_name: '轉讓後持有人', consignor_name: null, status: 'pre_pickup', verify_code_pre_pickup: '123456', pre_dropoff_checklist: { completed: true, photoCount: 2 } },
      { id: 12, order_id: 2, buyer_name: '其他持有人', consignor_name: '  ' },
      { id: 13, order_id: 3, buyer_name: '購買者三', consignor_name: null },
      { id: 14, order_id: 1, buyer_name: '會員', consignor_name: '已指定的託運者' },
      { id: 15, order_id: null, buyer_name: '最初購買者', consignor_name: null },
    ],
  };
}

function database({ failAtReservation = false } = {}) {
  const state = fixture();
  const events = [], backup = [];
  let before;
  return {
    state, events, backup,
    async beginTransaction() { events.push('begin'); before = structuredClone(state); },
    async commit() { events.push('commit'); },
    async rollback() { events.push('rollback'); Object.assign(state, before); },
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim();
      if (q.startsWith('SELECT o.id')) return [state.orders];
      if (q.startsWith('SELECT r.id')) {
        assert.match(q, /t.status = 'accepted'/);
        assert.match(q, /MIN\(t.id\)/);
        return [state.reservations];
      }
      assert.ok(events.includes('backup'), 'a durable backup must precede mutations');
      if (q.startsWith('UPDATE orders')) {
        const rollback = q.includes('AND JSON_UNQUOTE');
        const id = params[rollback ? params.length - 3 : 3];
        const row = state.orders.find(row => String(row.id) === String(id));
        const expectedVersion = params[rollback ? params.length - 2 : 4];
        const details = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
        if (row.row_version !== expectedVersion || (rollback && details.consignorName !== params.at(-1))) return [{ affectedRows: 0 }];
        const remove = q.includes('JSON_REMOVE');
        if (remove) delete details.consignorName;
        else details.consignorName = params[0];
        row.row_version = params[rollback ? params.length - 4 : 2];
        details.rowVersion = row.row_version;
        row.details = details;
      } else if (q.startsWith('UPDATE reservations')) {
        if (failAtReservation) return [{ affectedRows: 0 }];
        const row = state.reservations.find(row => String(row.id) === String(params[1]));
        if (row.consignor_name !== params[2]) return [{ affectedRows: 0 }];
        row.consignor_name = params[0];
      } else throw new Error('Unexpected mutation');
      events.push('write');
      return [{ affectedRows: 1 }];
    },
    async writeBackup(plan) { events.push('backup'); backup.push(structuredClone(plan)); },
  };
}

test('historical blank names inherit the order buyer snapshot, while explicit consignors and ticket orders remain unchanged', () => {
  const original = fixture();
  const snapshot = structuredClone(original);
  const plan = planBuyerConsignorBackfill(original.orders, original.reservations);
  assert.deepEqual(plan.orders.map(row => [row.id, row.name]), [['1', '下單時 購買者'], ['2', '購買者二']]);
  assert.deepEqual(plan.reservations.map(row => [row.id, row.name]), [
    ['11', '下單時 購買者'], ['12', '購買者二'], ['13', '不同的實際託運者'], ['15', '最初購買者'],
  ]);
  assert.deepEqual(original, snapshot, 'planning must not mutate existing records');
});

test('unavailable and oversized buyer names are reported without guessing or truncation', () => {
  const orders = [
    { id: 1, row_version: 1, buyer_name: '現在會員', details: { kind: 'event-reservation', contactSnapshot: { username: '名'.repeat(51) } } },
    { id: 2, row_version: 1, buyer_name: '', details: { kind: 'event-reservation' } },
  ];
  const plan = planBuyerConsignorBackfill(orders, [{ id: 11, order_id: 1, consignor_name: null }, { id: 12, order_id: 2, consignor_name: null }]);
  assert.equal(plan.orders.length, 0);
  assert.equal(plan.reservations.length, 0);
  assert.deepEqual(plan.skipped.map(row => row.reason), ['NAME_TOO_LONG', 'BUYER_NAME_MISSING', 'NAME_TOO_LONG', 'BUYER_NAME_MISSING']);
});

test('malformed legacy details do not abort valid shipment backfills', () => {
  const orders = [null, 'null', 'true', '7', '[]', '{invalid'].map((details, index) => ({
    id: index + 100, row_version: 1, buyer_name: '購買者', details,
  }));
  orders.push(fixture().orders[0]);
  const plan = planBuyerConsignorBackfill(orders);
  assert.deepEqual(plan.orders.map(row => [row.id, row.name]), [['1', '下單時 購買者']]);
});

test('default preview is read-only and contains counts instead of customer names', async () => {
  const db = database();
  const report = await backfillBuyerConsignorNames(db);
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.orders, 2);
  assert.equal(report.reservations, 4);
  assert.deepEqual(db.events, []);
  assert.ok(!JSON.stringify(report).includes('購買者'));
});

test('backfill is atomic, preserves fulfillment evidence, and does not follow subsequent buyer renames', async () => {
  const db = database();
  const evidence = structuredClone(db.state.reservations[0]);
  const report = await backfillBuyerConsignorNames(db, { apply: true, writeBackup: plan => db.writeBackup(plan) });
  assert.equal(report.mode, 'applied');
  assert.equal(db.state.orders[0].row_version, 4);
  assert.equal(db.state.orders[2].row_version, 1);
  assert.equal(db.state.reservations[3].consignor_name, '已指定的託運者');
  assert.deepEqual({ ...db.state.reservations[0], consignor_name: null }, evidence);
  db.state.orders[0].buyer_name = '再次改名';
  const replay = await backfillBuyerConsignorNames(db);
  assert.equal(replay.orders, 0);
  assert.equal(replay.reservations, 0);
  assert.equal(db.state.reservations[0].consignor_name, '下單時 購買者');
  assert.equal(db.events.at(-1), 'commit');
});

test('write conflicts and backup failures roll back the whole transaction', async () => {
  for (const failBackup of [false, true]) {
    const db = database({ failAtReservation: !failBackup });
    const original = structuredClone(db.state);
    await assert.rejects(backfillBuyerConsignorNames(db, { apply: true, writeBackup: async plan => {
      if (failBackup) throw new Error('backup failed');
      await db.writeBackup(plan);
    } }));
    assert.deepEqual(db.state, original);
    assert.equal(db.events.at(-1), 'rollback');
  }
});

test('rollback restores only inherited names and keeps versions monotonic', async () => {
  const db = database();
  await backfillBuyerConsignorNames(db, { apply: true, writeBackup: plan => db.writeBackup(plan) });
  const report = await rollbackBuyerConsignorNames(db, db.backup[0]);
  assert.equal(report.mode, 'rolled-back');
  assert.equal(db.state.orders[0].details.consignorName, undefined);
  assert.equal(db.state.orders[1].details.consignorName, null);
  assert.equal(db.state.orders[0].row_version, 5);
  assert.equal(db.state.orders[2].details.consignorName, '不同的實際託運者');
  assert.equal(db.state.reservations[0].consignor_name, null);
  assert.equal(db.state.reservations[1].consignor_name, '  ');
});

test('rollback refuses to overwrite later order or reservation changes', async () => {
  for (const target of ['order', 'reservation']) {
    const db = database();
    await backfillBuyerConsignorNames(db, { apply: true, writeBackup: plan => db.writeBackup(plan) });
    if (target === 'order') db.state.orders[0].row_version++;
    else db.state.reservations[0].consignor_name = '後來修改的託運者';
    const changed = structuredClone(db.state);
    await assert.rejects(rollbackBuyerConsignorNames(db, db.backup[0]), { code: 'BACKFILL_CONFLICT' });
    assert.deepEqual(db.state, changed);
  }
});

test('CLI requires an explicit apply backup and rejects ambiguous or incomplete flags before connecting', () => {
  assert.deepEqual(parseArguments([]), { apply: false, backupPath: '', rollbackPath: '' });
  assert.deepEqual(parseArguments(['--apply', '--backup', '/safe/file.json']), { apply: true, backupPath: '/safe/file.json', rollbackPath: '' });
  for (const args of [['--apply'], ['--rollback'], ['--backup', '--apply'], ['--apply', '--apply'], ['--unknown'], ['--backup', 'path'], ['--apply', '--backup', 'path', '--rollback', 'path']]) {
    assert.throws(() => parseArguments(args));
  }
});
