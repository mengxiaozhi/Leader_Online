'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { STAGES, normalizeStages, scheduleFromRow, isoDate, sqlDate, stagePending, activeReservation,
  updateHandoverSchedule, syncHandoverRecipients, notificationIsRelevant, handoverEmail, attachHandoverSchedules } = require('../src/services/handover-schedule');
const { deliverJob, processHandoverNotifications } = require('../src/services/handover-notification-worker');
const buildRoutes = require('../src/routes/handover-schedule');
const empty = () => Object.fromEntries(STAGES.map(stage => [stage, null]));
const window = { startsAt: '2026-10-01T20:00:00+08:00', endsAt: '2026-10-02T09:00:00+08:00' };
const now = new Date('2026-09-28T12:00:00+08:00');
const reservation = { id: 41, store_id: 8, user_id: 'member', status: 'pre_dropoff' };
const initialStore = () => ({ id: 8, event_id: 9, name: '台北店', address: '台北地址', event_title: '測試檔期', event_location: '活動場地', owner_user_id: 'provider', event_owner_user_id: 'provider', handover_schedule_version: 1 });

function fixture({ store = initialStore(), rows = [reservation], failSend = false } = {}) {
  const state = { store: structuredClone(store), rows: structuredClone(rows), jobs: [], members: [], calls: [], sent: [], commits: 0, rollbacks: 0 };
  const query = async (sql, p = []) => {
    state.calls.push({ sql, p });
    if (sql.includes('LIMIT 0')) return [[]];
    if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: 1 }]];
    if (sql.startsWith('SELECT RELEASE_LOCK')) return [[{ released: 1 }]];
    if (sql.startsWith('SELECT id FROM event_stores')) return [[]];
    if (sql.includes('FROM event_stores')) {
      return [[state.store]];
    }
    if (sql.includes('FROM reservations r')) return [state.rows];
    if (sql.startsWith('SELECT email FROM users')) return [[{ email: 'member@example.test' }]];
    if (sql.includes('MAX(id)')) return [[{ id: 7 }]];
    if (sql.startsWith('SELECT reservation_id, user_id')) return [state.members];
    if (sql.startsWith('DELETE m FROM')) {
      state.members = state.members.filter(m => state.rows.some(r => String(r.id) === String(m.reservation_id) && r.user_id === m.user_id));
      return [{ affectedRows: 0 }];
    }
    if (sql.startsWith('INSERT INTO handover_notification_memberships')) {
      for (const [reservation_id, user_id, store_id] of p[0]) if (!state.members.some(m => m.reservation_id === reservation_id && m.user_id === user_id)) state.members.push({ reservation_id, user_id, store_id });
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('INSERT INTO handover_notification_outbox')) {
      const [store_id, user_id, kind, stage, schedule_revision, dedupe_key, payload_json, due_at] = p;
      if (!state.jobs.some(job => job.dedupe_key === dedupe_key)) state.jobs.push({ id: state.jobs.length + 1, store_id, user_id, kind, stage, schedule_revision, dedupe_key, payload_json, due_at, status: 'PENDING', attempts: 0 });
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('UPDATE event_stores SET')) {
      STAGES.forEach((stage, index) => { state.store[`${stage}_starts_at`] = p[index * 2]; state.store[`${stage}_ends_at`] = p[index * 2 + 1]; });
      state.store.handover_schedule_version++;
      state.store.handover_stage_versions = p[8];
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('SELECT status, COUNT')) {
      return [[...new Set(state.jobs.map(job => job.status))].map(status => ({ status, count: state.jobs.filter(job => job.status === status).length }))];
    }
    if (sql.startsWith('SELECT id, kind')) return [[]];
    if (sql.includes('UPDATE handover_notification_outbox')) {
      if (sql.includes('寄送工作逾時')) {
        for (const j of state.jobs) if (j.status === 'PROCESSING' && j.locked_at < p[0]) j.status = j.attempts >= 10 ? 'DEAD' : 'FAILED';
      } else if (sql.includes("SET status = 'PENDING', attempts = 0")) {
        for (const j of state.jobs) if (['FAILED','DEAD'].includes(j.status) && Number(j.store_id) === Number(p[1])) { j.status = 'PENDING'; j.attempts = 0; }
      } else if (sql.includes("last_error = '時程已更新'")) {
        for (const job of state.jobs) if (['PENDING','FAILED','DEAD'].includes(job.status) && (['schedule','acquired'].includes(job.kind) || (job.kind === 'reminder' && p.slice(1).includes(job.stage)))) job.status = 'SKIPPED';
      } else if (sql.includes("status = 'SENT'")) { state.jobs.find(j => j.id === p[1]).status = 'SENT'; }
      else if (sql.includes("status = 'SKIPPED'")) { state.jobs.find(j => j.id === p[0]).status = 'SKIPPED'; }
      else if (sql.includes('SET status = ?')) { state.jobs.find(j => j.id === p[3]).status = p[0]; }
      else if (sql.includes("status = 'PROCESSING', attempts")) {
        const j = state.jobs.find(j => j.id === p[1]); j.status = 'PROCESSING'; j.attempts++;
      }
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('SELECT * FROM handover_notification_outbox')) return [state.jobs.filter(j => ['PENDING','FAILED'].includes(j.status) && j.due_at <= p[0] && j.attempts < 10).map(j => ({ ...j }))];
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const conn = { query, async beginTransaction() {}, async commit() { state.commits++; }, async rollback() { state.rollbacks++; }, release() {} };
  const pool = { query, getConnection: async () => conn };
  const transporter = { async sendMail(mail) { if (failSend) throw new Error('SMTP test failure'); state.sent.push(mail); } };
  return { state, pool, conn, transporter };
}

test('partial publication and cross-midnight dates round trip as Taipei time', () => {
  const stages = normalizeStages({ ...empty(), pre_dropoff: window });
  assert.deepEqual(stages.pre_dropoff, window);
  assert.equal(stages.post_pickup, null);
  assert.equal(isoDate(new Date('2026-10-01T12:00:00Z')), window.startsAt);
  assert.equal(sqlDate(window.startsAt), '2026-10-01 20:00:00');
  assert.equal(scheduleFromRow({ pre_start: '2026-01-01' }).stages.pre_dropoff, null);
});
for (const bad of ['2026-02-30T09:00', '2026-01-01', '2026-01-01T25:00', '2026-01-01T12:00Z', '2026-01-01T12:00+09:00', '', null]) {
  test(`rejects invalid calendar/time ${bad}`, () => {
    assert.throws(() => normalizeStages({ ...empty(), pre_dropoff: { startsAt: bad, endsAt: window.endsAt } }), { code: 'VALIDATION_ERROR' });
  });
}
test('requires complete pairs, all four keys and increasing times', () => {
  for (const stages of [{}, { ...empty(), unknown: null }, { ...empty(), pre_dropoff: { startsAt: window.startsAt } }, { ...empty(), pre_dropoff: { startsAt: window.endsAt, endsAt: window.startsAt } }]) assert.throws(() => normalizeStages(stages), { code: 'VALIDATION_ERROR' });
});

test('publish groups multiple reservations and queues a single 24h reminder per holder', async () => {
  const f = fixture({ rows: [reservation, { ...reservation, id: 42 }] });
  const result = await updateHandoverSchedule(f.conn, { store: f.state.store, stages: { ...empty(), pre_dropoff: window }, expectedVersion: 1, now });
  assert.equal(result.handoverSchedule.version, 2);
  assert.deepEqual(f.state.jobs.map(job => job.kind), ['schedule', 'reminder']);
  assert.equal(f.state.jobs[1].due_at, '2026-09-30 20:00:00');
  assert.equal(f.state.sent.length, 0, 'saving never sends SMTP before commit');
  assert.equal(f.state.members.length, 2);
});

test('no-op save sends nothing and stale versions cannot write', async () => {
  const f = fixture();
  const result = await updateHandoverSchedule(f.conn, { store: f.state.store, stages: empty(), expectedVersion: 1, now });
  assert.equal(result.changed, false);
  await assert.rejects(updateHandoverSchedule(f.conn, { store: f.state.store, stages: empty(), expectedVersion: 9, now }), { statusCode: 409 });
  assert.equal(f.state.calls.length, 0);
});

test('changing one stage preserves other reminders; clearing invalidates only affected stages', async () => {
  const f = fixture();
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages: { ...empty(), pre_dropoff: window, post_pickup: window }, expectedVersion: 1, now });
  const unchangedReminder = f.state.jobs.find(job => job.stage === 'post_pickup');
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages: { ...empty(), post_pickup: window }, expectedVersion: 2, now });
  assert.equal(unchangedReminder.status, 'PENDING');
  assert.equal(f.state.jobs.filter(job => job.stage === 'post_pickup').length, 1);
  assert.equal(f.state.jobs.find(job => job.stage === 'pre_dropoff').status, 'SKIPPED');
  const cleared = f.state.jobs.at(-1);
  assert.match(handoverEmail(cleared, f.state.store, f.state.rows).text, /時間待重新公布/);
});

for (const offset of [0, 1, 23 * 3600000, 24 * 3600000]) {
  test(`publication ${offset}ms before start does not duplicate immediate notice and reminder`, async () => {
    const f = fixture();
    await updateHandoverSchedule(f.conn, { store: f.state.store, stages: { ...empty(), pre_dropoff: window }, expectedVersion: 1, now: new Date(new Date(window.startsAt).getTime() - offset) });
    assert.deepEqual(f.state.jobs.map(job => job.kind), ['schedule']);
  });
}

test('new reservations and transfers are reconciled once, with the current holder', async () => {
  const f = fixture({ rows: [reservation, { ...reservation, id: 42 }] });
  f.state.store.pre_dropoff_starts_at = window.startsAt; f.state.store.pre_dropoff_ends_at = window.endsAt;
  await syncHandoverRecipients(f.conn, { storeIds: [8], now });
  await syncHandoverRecipients(f.conn, { storeIds: [8], now });
  assert.deepEqual(f.state.jobs.map(job => job.kind), ['acquired', 'reminder']);
  const oldJob = f.state.jobs[0];
  f.state.rows.forEach(row => { row.user_id = 'recipient'; });
  await syncHandoverRecipients(f.conn, { storeIds: [8], now });
  assert.equal(f.state.jobs.filter(job => job.kind === 'acquired').length, 2);
  assert.equal(notificationIsRelevant(oldJob, f.state.store, [], now), false);
  assert.ok(f.state.members.every(row => row.user_id === 'recipient'));
});

test('unpublished times do not prevent a reservation and publish later reaches existing holders', async () => {
  const f = fixture();
  await syncHandoverRecipients(f.conn, { storeIds: [8], now });
  assert.equal(f.state.jobs.length, 0);
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages: { ...empty(), pre_dropoff: window }, expectedVersion: 1, now });
  assert.equal(f.state.jobs[0].kind, 'schedule');
});

for (const row of [{ ...reservation, status: 'cancelled' }, { ...reservation, status: 'done' }, { ...reservation, order_details: '{"status":"已退款"}' }, { ...reservation, payment_status: 'refunded' }]) {
  test(`inactive reservation ${JSON.stringify(row)} gets no notifications`, async () => {
    const f = fixture({ rows: [row] });
    assert.equal(activeReservation(row), false);
    await updateHandoverSchedule(f.conn, { store: f.state.store, stages: { ...empty(), pre_dropoff: window }, expectedVersion: 1, now });
    assert.equal(f.state.jobs.length, 0);
  });
}
test('completed stages and expired reminders are skipped even on retry', () => {
  assert.equal(stagePending({ ...reservation, pre_dropoff_checklist: '{"completed":true}' }, 'pre_dropoff'), false);
  assert.equal(stagePending({ ...reservation, status: 'post_dropoff' }, 'pre_pickup'), false);
  const store = { ...initialStore(), pre_dropoff_starts_at: window.startsAt, pre_dropoff_ends_at: window.endsAt };
  assert.equal(notificationIsRelevant({ kind: 'reminder', stage: 'pre_dropoff', schedule_revision: 0 }, store, [reservation], new Date(window.startsAt)), false);
});

test('worker delivers after rechecking holder and next tick cannot send a SENT job again', async () => {
  const f = fixture();
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages: { ...empty(), pre_dropoff: window }, expectedVersion: 1, now });
  const options = { pool: f.pool, transporter: f.transporter, isMailerReady: () => true, publicWebUrl: 'https://example.test', now };
  await processHandoverNotifications(options);
  await processHandoverNotifications(options);
  assert.equal(f.state.sent.length, 1);
  assert.match(f.state.sent[0].text, /賽前交車/);
  assert.match(f.state.sent[0].text, /台北地址/);
  assert.match(f.state.sent[0].text, /活動場地/);
});
test('SMTP failure preserves the saved schedule and records retryable failure', async () => {
  const f = fixture({ failSend: true });
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages: { ...empty(), pre_dropoff: window }, expectedVersion: 1, now });
  await deliverJob({ pool: f.pool, job: f.state.jobs[0], transporter: f.transporter, isMailerReady: () => true, publicWebUrl: 'https://example.test', now });
  assert.equal(f.state.jobs[0].status, 'FAILED');
  assert.equal(f.state.store.handover_schedule_version, 2);
  assert.equal(f.state.rollbacks, 1);
});
test('missing SMTP is a failure, never a fake successful delivery', async () => {
  const f = fixture();
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages: { ...empty(), pre_dropoff: window }, expectedVersion: 1, now });
  await deliverJob({ pool: f.pool, job: f.state.jobs[0], isMailerReady: () => false, now });
  assert.equal(f.state.jobs[0].status, 'FAILED');
});
test('current holder is checked again before actual SMTP delivery', async () => {
  const f = fixture();
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages: { ...empty(), pre_dropoff: window }, expectedVersion: 1, now });
  f.state.rows[0].user_id = 'new-holder';
  await deliverJob({ pool: f.pool, job: f.state.jobs[0], transporter: f.transporter, isMailerReady: () => true, now });
  assert.equal(f.state.sent.length, 0);
  assert.equal(f.state.jobs[0].status, 'SKIPPED');
});
test('missing schema is explicit and does not use old date fields', async () => {
  const pool = { async query() { throw Object.assign(new Error('missing column'), { code: 'ER_BAD_FIELD_ERROR' }); } };
  const [row] = await attachHandoverSchedules(pool, [{ store_id: 8, pre_start: '2026-01-01' }]);
  assert.equal(row.handoverSchedule.available, false);
  assert.equal(row.handoverSchedule.stages.pre_dropoff, null);
});

async function request(f, { role = 'STORE', userId = 'provider', version = '1', body = { stages: empty() }, method = 'patch', path = '/admin/events/stores/:storeId/schedule' } = {}) {
  const pass = (req, res, next) => next();
  const router = buildRoutes({ pool: f.pool, ok: (res, data) => res.json({ ok: true, data }), fail: (res, code, message, status) => res.status(status).json({ code, message }), eventManagerOnly: pass, isADMIN: r => r === 'ADMIN', isSTORE: r => r === 'STORE', invalidateEventStoresCache() {} });
  const route = router.stack.find(layer => layer.route?.methods[method] && layer.route.path === path);
  const handler = route.route.stack.at(-1).handle;
  const res = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await handler({ params: { storeId: '8' }, user: { id: userId, role }, body, get: () => version }, res);
  return res;
}
for (const options of [{ userId: 'another-provider' }, { role: 'EDITOR' }, { role: 'DELIVERY_POINT' }, { role: 'USER' }]) {
  test(`schedule API denies non-owner ${JSON.stringify(options)}`, async () => { assert.equal((await request(fixture(), options)).statusCode, 403); });
}
test('exclusive event restriction applies and ADMIN can manage', async () => {
  const f = fixture({ store: { ...initialStore(), is_exclusive: 1, event_owner_user_id: 'other' } });
  assert.equal((await request(f)).statusCode, 403);
  assert.equal((await request(f, { role: 'ADMIN' })).statusCode, 200);
});
test('schedule API requires If-Match and reports conflict without committing', async () => {
  const f = fixture();
  assert.equal((await request(f, { version: '' })).statusCode, 428);
  assert.equal((await request(f, { version: '"9"' })).statusCode, 409);
  assert.equal(f.state.commits, 0);
});
test('schedule API commits four-stage changes with queued notifications', async () => {
  const f = fixture();
  const res = await request(f, { body: { stages: { ...empty(), pre_dropoff: window } } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.handoverSchedule.version, 2);
  assert.equal(f.state.commits, 1);
  assert.equal(f.state.sent.length, 0);
});

test('restart recovers a stale processing lease and sends it once', async () => {
  const f = fixture();
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages: { ...empty(), pre_dropoff: window }, expectedVersion: 1, now });
  Object.assign(f.state.jobs[0], { status: 'PROCESSING', attempts: 1, locked_at: sqlDate(new Date(now.getTime() - 16 * 60000)) });
  await processHandoverNotifications({ pool: f.pool, transporter: f.transporter, isMailerReady: () => true, now });
  assert.equal(f.state.jobs[0].status, 'SENT');
  assert.equal(f.state.sent.length, 1);
});
test('ten failures stop automatic retry; owner can requeue but a different provider cannot', async () => {
  const f = fixture({ failSend: true });
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages: { ...empty(), pre_dropoff: window }, expectedVersion: 1, now });
  f.state.jobs[0].attempts = 9;
  await deliverJob({ pool: f.pool, job: f.state.jobs[0], transporter: f.transporter, isMailerReady: () => true, publicWebUrl: 'https://example.test', now });
  assert.equal(f.state.jobs[0].status, 'DEAD');
  const options = { method: 'post', path: '/admin/events/stores/:storeId/schedule/notifications/retry' };
  assert.equal((await request(f, { ...options, userId: 'other' })).statusCode, 403);
  assert.equal(f.state.jobs[0].status, 'DEAD');
  assert.equal((await request(f, options)).statusCode, 200);
  assert.equal(f.state.jobs[0].status, 'PENDING');
  assert.equal(f.state.jobs[0].attempts, 0);
});
