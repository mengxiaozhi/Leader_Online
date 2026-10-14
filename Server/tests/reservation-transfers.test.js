const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const buildReservationRoutes = require('../src/routes/reservations');
const wallet = require('../src/services/reservation-google-wallet');

const source = fs.readFileSync(require.resolve('../src/context'), 'utf8');
const stages = ['pre_dropoff', 'pre_pickup', 'post_dropoff', 'post_pickup'];
const statuses = ['', 'pending', 'service_booking', ...stages, 'done', 'cancelled'];
const normalizePositiveInt = value => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const safeParseJSON = (value, fallback = {}) => {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value) || fallback; } catch (_) { return fallback; }
};

// Evaluate the actual context helpers without starting its DB, timers or mail transport.
function contextHelpers(dependencies = {}) {
  const ctx = vm.createContext({
    normalizePositiveInt, safeParseJSON,
    CHECKLIST_STAGE_KEYS: stages,
    checklistColumnByStage: stage => `${stage}_checklist`,
    normalizeChecklist: value => safeParseJSON(value),
    ...dependencies,
  });
  const policyStart = source.includes('const RESERVATION_TRANSFERABLE_STATUSES')
    ? source.indexOf('const RESERVATION_TRANSFERABLE_STATUSES')
    : source.indexOf('function normalizeReservationOrderPaymentStatus(');
  for (const [start, end] of [
    [policyStart, source.indexOf('async function backfillTicketProductIds(')],
    [source.indexOf('async function ensureChecklistReservationAccess('), source.indexOf('function mergeChecklistWithPhotos(')],
    [source.indexOf('async function autoAcceptReservationTransfersForEmail('), source.indexOf('function normalizeDateInput(')],
  ]) {
    assert.ok(start >= 0 && end > start, 'context helper boundaries must exist');
    vm.runInContext(source.slice(start, end), ctx);
  }
  return ctx;
}

function reservation(status) {
  const row = {
    id: 161, user_id: 'sender', order_id: 77, store_id: null, status,
    event: '轉讓測試檔期', store: '測試交車點', ticket_type: '來回',
    consignor_name: '獨立託運者', reserved_at: '2026-10-01 10:00:00',
    verify_code: '100000', checklist_photo_count: 8,
  };
  stages.forEach((stage, index) => {
    row[`verify_code_${stage}`] = String(100001 + index);
    row[`${stage}_checklist`] = {
      items: [{ label: '貨況確認', checked: true }], completed: true,
      completedAt: '2026-10-01T02:00:00.000Z', photos: [{ id: index + 1 }],
    };
  });
  return row;
}

function fixture(status = 'pre_dropoff', payment = '已付款') {
  const state = {
    reservation: reservation(status), payment, transfers: [],
    photos: stages.map((stage, index) => ({
      id: index + 1, reservation_id: 161, stage, mime: 'image/jpeg',
      size: 3, data: Buffer.from('jpg'), storage_path: null,
    })),
  };
  const queries = [];
  let commits = 0;
  let rollbacks = 0;
  let nextCode = 200000;
  let transaction = null;
  const candidate = () => ({
    ...structuredClone(state.reservation),
    order_details: JSON.stringify({ status: state.payment }),
  });
  const query = async (sql, params = []) => {
    queries.push({ sql, params });
    const text = sql.replace(/\s+/g, ' ').trim();
    if (text.endsWith('LIMIT 0')) return [[]]; // Optional handover schema probes.
    // Wallet configuration is intentionally absent; no live Google calls are made.
    if (text.includes('AS event_title')) return [[]];
    if (text.startsWith('SELECT * FROM reservations WHERE user_id')) {
      return [[...(state.reservation.user_id === params[0] ? [structuredClone(state.reservation)] : [])]];
    }
    if (text.startsWith('SELECT id, details, created_at FROM orders')) {
      return [[{ id: 77, details: JSON.stringify({ status: state.payment }), created_at: '2026-10-01 10:00:00' }]];
    }
    if (text.startsWith('SELECT r.*') && text.includes('FROM reservations r')) return [[candidate()]];
    if (text.startsWith('SELECT id FROM users')) {
      return [[...(params[0] === 'recipient@example.test' ? [{ id: 'recipient' }] : [])]];
    }
    if (text.startsWith('SELECT rt.*')) {
      return [state.transfers.filter(t => t.status === 'pending'
        && (t.to_user_id === params[0] || t.to_user_email === params[1])).map(t => ({
        ...t, reservation_user_id: state.reservation.user_id, order_id: 77,
        reservation_status: state.reservation.status, order_details: candidate().order_details,
        ...Object.fromEntries(stages.map(stage => [`${stage}_checklist`, state.reservation[`${stage}_checklist`]])),
      }))];
    }
    if (text.startsWith('SELECT') && text.includes('FROM reservation_transfers')) {
      let list = state.transfers.filter(t => t.status === 'pending');
      if (text.includes('WHERE code = ?')) list = list.filter(t => t.code === params[0]);
      else if (text.includes('WHERE id = ?')) list = list.filter(t => t.id === Number(params[0]));
      else if (text.includes('WHERE reservation_id = ?')) list = list.filter(t => t.reservation_id === params[0]);
      else if (text.includes('to_user_id IS NULL')) list = list.filter(t => !t.to_user_id && t.to_user_email === params[0]);
      return [structuredClone(list)];
    }
    if (text.startsWith('INSERT INTO reservation_transfers')) {
      const transfer = {
        id: state.transfers.length + 1, reservation_id: params[0],
        from_user_id: params[1], status: 'pending',
        to_user_id: params.length === 4 ? params[2] : null,
        to_user_email: params.length === 4 ? params[3] : null,
        code: params.length === 3 ? params[2] : null,
      };
      state.transfers.push(transfer);
      return [{ insertId: transfer.id, affectedRows: 1 }];
    }
    if (text.startsWith('UPDATE reservation_transfers')) {
      if (text.includes("status = 'expired'")) return [{ affectedRows: 0 }];
      if (text.includes('status = "accepted"')) {
        const transfer = state.transfers.find(t => t.id === params[1]);
        transfer.status = 'accepted';
        transfer.to_user_id ||= params[0];
      } else if (text.includes('status = "canceled"')) {
        state.transfers.filter(t => t.status === 'pending' && t.id !== params[1])
          .forEach(t => { t.status = 'canceled'; });
      }
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith('UPDATE reservations SET user_id')) {
      if (state.reservation.user_id !== params[2]) return [{ affectedRows: 0 }];
      state.reservation.user_id = params[0];
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith('UPDATE reservations SET verify_code')) {
      const fields = [...text.matchAll(/(verify_code\w*) = \?/g)].map(match => match[1]);
      fields.forEach((field, index) => { state.reservation[field] = params[index]; });
      return [{ affectedRows: 1 }];
    }
    if (text.includes('FROM reservation_checklist_photos')) {
      return [state.photos.filter(photo => photo.reservation_id === params[0]
        && photo.stage === params[1] && String(photo.id) === String(params[2]))];
    }
    throw new Error(`Unexpected query: ${text}`);
  };
  const conn = {
    query,
    async beginTransaction() { transaction = structuredClone(state); },
    async commit() { commits++; transaction = null; },
    async rollback() {
      rollbacks++;
      if (transaction) Object.assign(state, transaction);
      transaction = null;
    },
    release() {},
  };
  const middleware = (_req, _res, next) => next();
  const context = contextHelpers({
    console, pool: { query, getConnection: async () => conn },
    normalizeEmail: value => String(value || '').trim().toLowerCase(),
    normalizeUserId: value => String(value || '').trim(),
    ensureReservationTransfersTable: async () => {},
    fetchReservationById: async () => structuredClone(state.reservation),
    isADMIN: role => role === 'ADMIN', isSTORE: () => false,
    isDELIVERY_POINT: () => false, isReservationAssignedDriver: async () => false,
    generateReservationStageCode: async () => String(nextCode++),
    syncHandoverRecipients: async () => {}, syncReservationTasksForIds: async () => {},
    rotateReservationVerificationCodes: wallet.rotateReservationVerificationCodes,
    inactivateReservationGoogleWalletForHolder: wallet.inactivateReservationGoogleWalletForHolder,
    queueReservationGoogleWalletSync: wallet.queueReservationGoogleWalletSync,
    isGoogleWalletConfigurationError: wallet.isGoogleWalletConfigurationError,
  });
  const photoMap = new Map([['161', Object.fromEntries(stages.map(stage => [stage,
    state.photos.filter(photo => photo.stage === stage)]))]]);
  const router = buildReservationRoutes(new Proxy({
    ...context,
    ok: (res, data, message) => res.json({ ok: true, data, message }),
    fail: (res, code, message, status) => res.status(status).json({ ok: false, code, message }),
    MAX_CHECKLIST_IMAGE_BYTES: 1024, CHECKLIST_PHOTO_LIMIT: 6,
    authRequired: middleware, isMailerReady: () => false,
    randomCode: () => 'TRANSFER01', getLineSubjectByUserId: async () => null,
    listChecklistPhotosBulk: async () => photoMap,
    hydrateReservationChecklists: async () => Object.fromEntries(stages.map(stage => [stage,
      structuredClone(state.reservation[`${stage}_checklist`])])),
    ensureChecklistHasPhotos: () => true, isChecklistStage: stage => stages.includes(stage),
    isChecklistPhotoStorageEnabled: () => false,
  }, { get: (target, key) => target[key] ?? middleware }));
  const sender = { id: 'sender', email: 'sender@example.test', role: 'USER' };
  const recipient = { id: 'recipient', email: 'recipient@example.test', role: 'USER' };
  const request = async (path, { body = {}, user = sender, params = {} } = {}) => {
    const handler = router.stack.find(layer => layer.route?.path === path).route.stack.at(-1).handle;
    const res = {
      statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; },
      setHeader(key, value) { this.headers[key] = value; },
      end(value) { this.bytes = value; return this; },
    };
    await handler({ body, user, params }, res);
    return res;
  };
  return { state, queries, context, request, sender, recipient,
    get commits() { return commits; }, get rollbacks() { return rollbacks; } };
}

const policy = contextHelpers().reservationTransferBlockReason;
for (const status of statuses) {
  test(`paid reservation ${status || '(empty)'} can transfer with completed checklists and photos`, () => {
    assert.equal(policy(reservation(status), { status: '已付款' }), null);
  });
}
for (const payment of ['已付款', '已完成', '待指派', ' 已付款 ']) {
  test(`existing paid compatibility is preserved: ${payment}`, () => {
    assert.equal(policy(reservation('cancelled'), { status: payment }), null);
  });
}
for (const payment of ['', '未付款', '待匯款', '待審核', '已取消', '已退款']) {
  test(`payment gate still rejects ${payment || '(missing status)'}`, () => {
    assert.equal(policy(reservation('done'), { status: payment }).code, 'RESERVATION_ORDER_NOT_PAID');
  });
}
test('valid reservation and originating order remain required', () => {
  assert.equal(policy({ order_id: 77 }, { status: '已付款' }).code, 'RESERVATION_NOT_FOUND');
  assert.equal(policy({ id: 161 }, { status: '已付款' }).code, 'RESERVATION_ORDER_REQUIRED');
});

for (const status of statuses) {
  for (const mode of ['email', 'qr']) {
    test(`${mode} transfer completes for ${status || '(empty)'} without altering fulfilment evidence`, async () => {
      const f = fixture(status);
      const before = structuredClone(f.state.reservation);
      const photos = structuredClone(f.state.photos);
      const started = await f.request('/reservations/transfers/initiate', {
        body: { reservationId: 161, mode, email: f.recipient.email },
      });
      assert.equal(started.statusCode, 200, JSON.stringify(started.body));
      assert.equal(started.body.ok, true);
      const accepted = await f.request(mode === 'email'
        ? '/reservations/transfers/:id/accept' : '/reservations/transfers/claim_code', {
        user: f.recipient, params: { id: '1' }, body: { code: started.body.data?.code },
      });
      assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.body));
      assert.equal(accepted.body.ok, true);
      assert.equal(f.state.reservation.user_id, 'recipient');
      assert.equal(f.state.reservation.status, before.status);
      assert.equal(f.state.reservation.consignor_name, before.consignor_name);
      assert.equal(f.state.reservation.order_id, before.order_id);
      stages.forEach(stage => {
        assert.deepEqual(f.state.reservation[`${stage}_checklist`], before[`${stage}_checklist`]);
        assert.notEqual(f.state.reservation[`verify_code_${stage}`], before[`verify_code_${stage}`]);
      });
      assert.notEqual(f.state.reservation.verify_code, before.verify_code);
      assert.deepEqual(structuredClone(f.state.photos), photos);
      assert.equal(f.state.transfers[0].status, 'accepted');
      assert.equal(f.commits, 2);
      assert.ok(f.queries.some(q => q.sql.includes('FOR UPDATE')));
      assert.ok(f.queries.filter(q => q.sql.trim().startsWith('UPDATE reservations'))
        .every(q => !/status\s*=|checklist\s*=|consignor_name\s*=/.test(q.sql)));
    });
  }
}

test('wallet listing and incoming email transfers use the relaxed policy', async () => {
  const f = fixture('cancelled');
  const listing = await f.request('/reservations/me');
  assert.equal(listing.body.data[0].transferable, true);
  assert.equal(listing.body.data[0].transfer_block_code, null);
  await f.request('/reservations/transfers/initiate', {
    body: { reservationId: 161, mode: 'email', email: f.recipient.email },
  });
  const incoming = await f.request('/reservations/transfers/incoming', { user: f.recipient });
  assert.equal(incoming.body.data.length, 1);
  assert.equal(incoming.body.data[0].reservation_status, 'cancelled');
});

test('status advancement after initiation no longer prevents accepting the transfer', async () => {
  const f = fixture('pre_dropoff');
  await f.request('/reservations/transfers/initiate', {
    body: { reservationId: 161, mode: 'email', email: f.recipient.email },
  });
  f.state.reservation.status = 'post_pickup';
  const accepted = await f.request('/reservations/transfers/:id/accept', {
    user: f.recipient, params: { id: '1' },
  });
  assert.equal(accepted.body.ok, true);
  assert.equal(f.state.reservation.status, 'post_pickup');
});

for (const change of ['payment', 'holder']) {
  test(`acceptance rechecks ${change} after initiation`, async () => {
    const f = fixture('pre_pickup');
    await f.request('/reservations/transfers/initiate', {
      body: { reservationId: 161, mode: 'email', email: f.recipient.email },
    });
    if (change === 'payment') f.state.payment = '已退款';
    else f.state.reservation.user_id = 'another-member';
    const codes = stages.map(stage => f.state.reservation[`verify_code_${stage}`]);
    const accepted = await f.request('/reservations/transfers/:id/accept', {
      user: f.recipient, params: { id: '1' },
    });
    assert.equal(accepted.body.code, change === 'payment' ? 'RESERVATION_ORDER_NOT_PAID' : 'TRANSFER_INVALID');
    assert.equal(f.state.transfers[0].status, 'pending');
    assert.deepEqual(stages.map(stage => f.state.reservation[`verify_code_${stage}`]), codes);
    assert.equal(f.commits, 1);
    assert.equal(f.rollbacks, 1);
  });
}

test('only the holder can initiate, self-transfer and duplicate pending transfers remain blocked', async () => {
  const f = fixture('done');
  const payload = { reservationId: 161, mode: 'email', email: f.recipient.email };
  assert.equal((await f.request('/reservations/transfers/initiate', {
    user: f.recipient, body: payload,
  })).body.code, 'FORBIDDEN');
  assert.equal((await f.request('/reservations/transfers/initiate', {
    body: { ...payload, email: f.sender.email },
  })).body.code, 'VALIDATION_ERROR');
  assert.equal((await f.request('/reservations/transfers/initiate', { body: payload })).body.ok, true);
  assert.equal((await f.request('/reservations/transfers/initiate', {
    body: { reservationId: 161, mode: 'qr' },
  })).body.code, 'TRANSFER_EXISTS');
  assert.equal((await f.request('/reservations/transfers/:id/accept', {
    user: { id: 'stranger', email: 'stranger@example.test' }, params: { id: '1' },
  })).body.code, 'FORBIDDEN');
});

test('the new holder can view existing private photos and the former holder loses owner access', async () => {
  const f = fixture('post_pickup');
  const started = await f.request('/reservations/transfers/initiate', {
    body: { reservationId: 161, mode: 'qr' },
  });
  await f.request('/reservations/transfers/claim_code', {
    user: f.recipient, body: { code: started.body.data.code },
  });
  const params = { id: '161', stage: 'pre_dropoff', photoId: '1' };
  const current = await f.request('/reservations/:id/checklists/:stage/photos/:photoId/raw', {
    user: f.recipient, params,
  });
  assert.equal(current.statusCode, 200);
  assert.deepEqual(current.bytes, Buffer.from('jpg'));
  const former = await f.request('/reservations/:id/checklists/:stage/photos/:photoId/raw', {
    user: f.sender, params,
  });
  assert.equal(former.statusCode, 403);
  assert.equal(former.body.code, 'FORBIDDEN');
});

for (const payment of ['已付款', '已退款']) {
  test(`registration auto-accept uses the same transfer policy for ${payment}`, async () => {
    const f = fixture('cancelled', payment);
    f.state.transfers.push({
      id: 1, reservation_id: 161, from_user_id: 'sender', to_user_id: null,
      to_user_email: f.recipient.email, code: null, status: 'pending',
    });
    await f.context.autoAcceptReservationTransfersForEmail(f.recipient.id, f.recipient.email);
    assert.equal(f.state.reservation.status, 'cancelled');
    assert.equal(f.state.reservation.user_id, payment === '已付款' ? 'recipient' : 'sender');
    assert.equal(f.state.transfers[0].status, payment === '已付款' ? 'accepted' : 'pending');
    assert.equal(f.commits, payment === '已付款' ? 1 : 0);
  });
}
