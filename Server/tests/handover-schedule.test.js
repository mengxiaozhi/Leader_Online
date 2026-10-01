'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { STAGES, normalizeStages, defaultReminders, normalizeReminders, scheduleFromRow, editorStateFromRow, isoDate, sqlDate, stagePending, activeReservation,
  updateHandoverSchedule, syncHandoverRecipients, notificationIsRelevant, handoverEmail, attachHandoverSchedules } = require('../src/services/handover-schedule');
const { deliverJob, processHandoverNotifications } = require('../src/services/handover-notification-worker');
const buildRoutes = require('../src/routes/handover-schedule');
const empty = () => Object.fromEntries(STAGES.map(stage => [stage, null]));
const window = { startsAt: '2026-10-01T20:00:00+08:00', endsAt: '2026-10-02T09:00:00+08:00' };
const now = new Date('2026-09-28T12:00:00+08:00');
const reservation = { id: 41, store_id: 8, user_id: 'member', status: 'pre_dropoff' };
const initialStore = () => ({ id: 8, event_id: 9, name: '台北店', address: '台北地址', event_title: '測試檔期', event_location: '活動場地', owner_user_id: 'provider', event_owner_user_id: 'provider', handover_schedule_version: 1 });

function fixture({ store = initialStore(), rows = [reservation], failSend = false } = {}) {
  const state = { store: structuredClone(store), rows: structuredClone(rows), jobs: [], members: [], calls: [], sent: [], commits: 0, rollbacks: 0, invalidations: [] };
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
    if (sql.startsWith('UPDATE event_stores SET handover_schedule_draft')) {
      state.store.handover_schedule_draft = p[0];
      state.store.handover_edit_version = p[1];
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('UPDATE event_stores SET')) {
      STAGES.forEach((stage, index) => { state.store[`${stage}_starts_at`] = p[index * 2]; state.store[`${stage}_ends_at`] = p[index * 2 + 1]; });
      state.store.handover_schedule_version += p[8];
      state.store.handover_stage_versions = p[9];
      state.store.handover_reminder_offsets = p[10];
      state.store.handover_schedule_draft = null;
      state.store.handover_edit_version = p[11];
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('SELECT status, COUNT')) {
      return [[...new Set(state.jobs.map(job => job.status))].map(status => ({ status, count: state.jobs.filter(job => job.status === status).length }))];
    }
    if (sql.startsWith('SELECT id, kind')) return [[]];
    if (sql.includes('UPDATE handover_notification_outbox')) {
      if (sql.includes("WHERE dedupe_key = ? AND status = 'SKIPPED'")) {
        for (const j of state.jobs) if (j.dedupe_key === p[1] && j.status === 'SKIPPED') Object.assign(j, { status: 'PENDING', attempts: 0, due_at: p[0] });
      } else if (sql.includes("last_error = '提醒設定已更新'")) {
        for (const j of state.jobs) if (['PENDING','FAILED','DEAD'].includes(j.status) && j.kind === 'reminder' && j.store_id === p[0] && j.stage === p[1] && p.slice(2).includes(JSON.parse(j.payload_json).offsetMinutes ?? 1440)) j.status = 'SKIPPED';
      } else if (sql.includes('寄送工作逾時')) {
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
  const router = buildRoutes({ pool: f.pool, ok: (res, data) => res.json({ ok: true, data }), fail: (res, code, message, status) => res.status(status).json({ code, message }), eventManagerOnly: pass, isADMIN: r => r === 'ADMIN', isSTORE: r => r === 'STORE', invalidateEventStoresCache(id) { f.state.invalidations.push(id); } });
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

test('drafts persist and reload privately; neither reconciliation nor worker sends unpublished times', async () => {
  const f = fixture();
  const stages = { ...empty(), pre_dropoff: window };
  const res = await request(f, { body: { mode: 'draft', stages } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.editVersion, 2);
  assert.equal(res.body.data.handoverSchedule.version, 1);
  assert.deepEqual(res.body.data.handoverSchedule.stages, empty());
  const loaded = await request(f, { method: 'get' });
  assert.deepEqual(loaded.body.data.handoverDraft.stages, stages);
  assert.equal(f.state.commits, 2);
  assert.deepEqual(f.state.invalidations, []);
  const callsAtSave = f.state.calls.length;
  const repeat = await request(f, { version: '2', body: { mode: 'draft', stages } });
  assert.equal(repeat.body.data.editVersion, 2);
  assert.equal(repeat.body.data.draftChanged, false);
  assert.ok(!f.state.calls.slice(callsAtSave).some(call => call.sql.startsWith('UPDATE')));
  await syncHandoverRecipients(f.conn, { storeIds: [8], now });
  f.state.rows[0].user_id = 'recipient';
  await syncHandoverRecipients(f.conn, { storeIds: [8], now });
  await processHandoverNotifications({ pool: f.pool, transporter: f.transporter, isMailerReady: () => true, now });
  assert.deepEqual(f.state.jobs, []);
  assert.deepEqual(f.state.sent, []);
  const [publicRow] = await attachHandoverSchedules(f.conn, [{ store_id: 8 }]);
  assert.deepEqual(publicRow.handoverSchedule.stages, empty());
  assert.equal(publicRow.handoverDraft, undefined);
});

test('draft changes and clears preserve published notices, reminders and email content', async () => {
  const f = fixture();
  const published = await updateHandoverSchedule(f.conn, { store: f.state.store, stages: { ...empty(), pre_dropoff: window }, expectedVersion: 1, now });
  const jobs = structuredClone(f.state.jobs);
  const save = stages => updateHandoverSchedule(f.conn, { store: f.state.store, stages, expectedVersion: editorStateFromRow(f.state.store).editVersion, mode: 'draft', now });
  await save({ ...empty(), post_pickup: window });
  await save(empty());
  assert.deepEqual(f.state.jobs, jobs);
  assert.deepEqual(scheduleFromRow(f.state.store), published.handoverSchedule);
  assert.equal(notificationIsRelevant(f.state.jobs[0], f.state.store, f.state.rows, now), true);
  await processHandoverNotifications({ pool: f.pool, transporter: f.transporter, isMailerReady: () => true, now });
  assert.equal(f.state.sent.length, 1, 'the pre-existing published notice remains valid');
  assert.match(f.state.sent[0].text, /賽前交車：2026-10-01 20:00/);
  await processHandoverNotifications({ pool: f.pool, transporter: f.transporter, isMailerReady: () => true, now: new Date('2026-09-30T20:00:00+08:00') });
  assert.equal(f.state.sent.length, 2, 'the published reminder still runs');
});

test('publishing after repeated drafts compares with published times and queues one change per holder', async () => {
  const f = fixture({ rows: [reservation, { ...reservation, id: 42 }] });
  const stages = { ...empty(), pre_dropoff: window };
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages, expectedVersion: 1, mode: 'draft', now });
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages: { ...stages, post_pickup: window }, expectedVersion: 2, mode: 'draft', now });
  const result = await updateHandoverSchedule(f.conn, { store: f.state.store, stages, expectedVersion: 3, mode: 'publish', now });
  assert.equal(result.editVersion, 4);
  assert.equal(result.handoverSchedule.version, 2);
  assert.equal(result.handoverDraft, null);
  assert.deepEqual(f.state.jobs.map(job => job.kind), ['schedule', 'reminder']);
  const payload = JSON.parse(f.state.jobs[0].payload_json);
  assert.deepEqual(payload.before, empty());
  assert.deepEqual(payload.changed, ['pre_dropoff']);
  const repeat = await updateHandoverSchedule(f.conn, { store: f.state.store, stages, expectedVersion: 4, now });
  assert.equal(repeat.changed, false);
  assert.equal(f.state.jobs.length, 2);
});

test('publishing a draft clear notifies only then and preserves unaffected stage reminders', async () => {
  const f = fixture();
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages: { ...empty(), pre_dropoff: window, post_pickup: window }, expectedVersion: 1, now });
  const stages = { ...empty(), post_pickup: window };
  const before = structuredClone(f.state.jobs);
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages, expectedVersion: 2, mode: 'draft', now });
  assert.deepEqual(f.state.jobs, before);
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages, expectedVersion: 3, now });
  assert.equal(f.state.jobs.find(job => job.stage === 'post_pickup').status, 'PENDING');
  assert.equal(f.state.jobs.find(job => job.stage === 'pre_dropoff').status, 'SKIPPED');
  assert.match(handoverEmail(f.state.jobs.at(-1), f.state.store, f.state.rows).text, /時間待重新公布/);
});

for (const mode of ['draft', 'publish']) {
  test(`${mode} rejects stale editor revisions and clears a reverted draft without notifications`, async () => {
    const f = fixture();
    await request(f, { body: { mode: 'draft', stages: { ...empty(), pre_dropoff: window } } });
    const conflict = await request(f, { body: { mode, stages: empty() } });
    assert.equal(conflict.statusCode, 409);
    const result = await request(f, { version: '2', body: { mode, stages: empty() } });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.data.editVersion, 3);
    assert.equal(result.body.data.handoverDraft, null);
    assert.equal(result.body.data.handoverSchedule.version, 1);
    assert.deepEqual(f.state.jobs, []);
  });
}

test('draft validates complete windows, mode and ownership, with no write or outbox side effects', async () => {
  const f = fixture();
  const cases = [
    { body: { mode: 'draft', stages: { ...empty(), pre_dropoff: { startsAt: window.startsAt } } }, status: 400 },
    { body: { mode: 'silent', stages: empty() }, status: 400 },
    { body: { mode: null, stages: empty() }, status: 400 },
    { body: { mode: 'draft', stages: empty() }, userId: 'other-provider', status: 403 },
  ];
  for (const { status, ...options } of cases) assert.equal((await request(f, options)).statusCode, status);
  assert.equal((await request(f, { method: 'get', userId: 'other-provider' })).statusCode, 403);
  assert.ok(!f.state.calls.some(call => /^(UPDATE|INSERT)/.test(call.sql)));
  assert.equal(f.state.commits, 0);
});

test('drafts use existing published version on migration and only publish invalidates public cache', async () => {
  const f = fixture({ store: { ...initialStore(), handover_schedule_version: 15 } });
  const stages = { ...empty(), pre_dropoff: window };
  const draft = await request(f, { version: '15', body: { mode: 'draft', stages } });
  assert.equal(draft.body.data.editVersion, 16);
  assert.deepEqual(f.state.invalidations, []);
  const published = await request(f, { version: '16', body: { mode: 'publish', stages } });
  assert.equal(published.body.data.editVersion, 17);
  assert.equal(published.body.data.handoverSchedule.version, 16);
  assert.deepEqual(f.state.invalidations, [9]);
});

test('missing draft migration blocks edits explicitly but keeps public schedules available', async () => {
  const f = fixture();
  const query = f.conn.query;
  f.conn.query = async (sql, values) => {
    if (sql.startsWith('SELECT handover_schedule_draft')) throw Object.assign(new Error('missing column'), { code: 'ER_BAD_FIELD_ERROR' });
    return query(sql, values);
  };
  const result = await request(f, { body: { mode: 'draft', stages: empty() } });
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.code, 'HANDOVER_DRAFT_SCHEMA_MISSING');
  const [publicRow] = await attachHandoverSchedules(f.conn, [{ store_id: 8 }]);
  assert.equal(publicRow.handoverSchedule.available, true);
});

test('new holders receive only published times while a later schedule is still a draft', async () => {
  const f = fixture();
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages: { ...empty(), pre_dropoff: window }, expectedVersion: 1, now });
  const future = { startsAt: '2026-10-05T20:00:00+08:00', endsAt: '2026-10-06T09:00:00+08:00' };
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages: { ...empty(), pre_dropoff: future }, expectedVersion: 2, mode: 'draft', now });
  f.state.rows.push({ ...reservation, id: 43, user_id: 'new-member' });
  await syncHandoverRecipients(f.conn, { storeIds: [8], now });
  const acquired = f.state.jobs.find(job => job.kind === 'acquired');
  assert.equal(acquired.user_id, 'new-member');
  const text = handoverEmail(acquired, f.state.store, f.state.rows).text;
  assert.match(text, /2026-10-01 20:00/);
  assert.doesNotMatch(text, /2026-10-05/);
  const reminder = f.state.jobs.find(job => job.kind === 'reminder' && job.user_id === 'new-member');
  assert.equal(reminder.due_at, '2026-09-30 20:00:00');
});

test('custom reminder offsets normalize order and reject invalid, duplicate or excessive entries', () => {
  assert.deepEqual(normalizeReminders({ ...defaultReminders(), pre_dropoff: [120, 4320, 1440] }).pre_dropoff, [4320, 1440, 120]);
  for (const values of [null, [0], [-1], [0.5], [43201], ['60'], [60, 60], [1, 2, 3, 4, 5, 6]]) {
    assert.throws(() => normalizeReminders({ ...defaultReminders(), pre_dropoff: values }), { code: 'VALIDATION_ERROR' });
  }
  for (const value of [{}, null, [], { ...defaultReminders(), unknown: [] }]) assert.throws(() => normalizeReminders(value), { code: 'VALIDATION_ERROR' });
  assert.deepEqual(normalizeReminders({ ...defaultReminders(), pre_dropoff: [43200, 1] }).pre_dropoff, [43200, 1]);
});

test('multiple reminders run once at each exact offset and group all reservations for the holder', async () => {
  const f = fixture({ rows: [reservation, { ...reservation, id: 42 }] });
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages: { ...empty(), pre_dropoff: window }, reminders: { ...defaultReminders(), pre_dropoff: [4320, 1440, 120] }, expectedVersion: 1, now });
  assert.deepEqual(f.state.jobs.map(j => j.due_at), ['2026-09-28 12:00:00', '2026-09-28 20:00:00', '2026-09-30 20:00:00', '2026-10-01 18:00:00']);
  const options = { pool: f.pool, transporter: f.transporter, isMailerReady: () => true };
  await processHandoverNotifications({ ...options, now });
  assert.equal(f.state.sent.length, 1);
  for (const [index, time] of ['2026-09-28T20:00:00+08:00', '2026-09-30T20:00:00+08:00', '2026-10-01T18:00:00+08:00'].entries()) {
    await processHandoverNotifications({ ...options, now: new Date(time) });
    await processHandoverNotifications({ ...options, now: new Date(time) });
    assert.equal(f.state.sent.length, index + 2);
    assert.match(f.state.sent.at(-1).text, /#41、#42/);
  }
});

test('reminder-only draft is private, reloadable, versioned and discarded without jobs', async () => {
  const f = fixture();
  const reminders = { ...defaultReminders(), pre_dropoff: [4320, 120], post_pickup: [] };
  const saved = await request(f, { body: { mode: 'draft', stages: empty(), reminders } });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.body.data.handoverReminders, defaultReminders());
  assert.deepEqual(saved.body.data.handoverDraft.reminders, reminders);
  assert.equal(saved.body.data.handoverSchedule.version, 1);
  assert.deepEqual((await request(f, { method: 'get' })).body.data.handoverDraft.reminders, reminders);
  assert.equal((await request(f, { body: { mode: 'publish', stages: empty(), reminders } })).statusCode, 409);
  await syncHandoverRecipients(f.conn, { storeIds: [8], now });
  assert.equal(f.state.jobs.length, 0);
  const reset = await request(f, { version: '2', body: { mode: 'draft', stages: empty(), reminders: defaultReminders() } });
  assert.equal(reset.body.data.handoverDraft, null);
  assert.equal(f.state.jobs.length, 0);
});

test('reminder-only publish preserves pending schedule notices, unchanged reminders and SENT identities', async () => {
  const f = fixture();
  const stages = { ...empty(), pre_dropoff: window, post_pickup: window };
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages, expectedVersion: 1, now });
  const before = structuredClone(f.state.jobs);
  const oldReminder = f.state.jobs.find(j => j.stage === 'pre_dropoff');
  oldReminder.status = 'SENT';
  const result = await updateHandoverSchedule(f.conn, { store: f.state.store, stages, reminders: { ...defaultReminders(), pre_dropoff: [1440, 120] }, expectedVersion: 2, now });
  assert.equal(result.scheduleChanged, false);
  assert.equal(result.remindersChanged, true);
  assert.equal(result.handoverSchedule.version, 2);
  assert.equal(result.editVersion, 3);
  assert.deepEqual(f.state.jobs[0], before[0]);
  assert.deepEqual(f.state.jobs[2], before[2]);
  assert.equal(oldReminder.status, 'SENT');
  assert.equal(f.state.jobs.length, 4);
  assert.equal(f.state.jobs.at(-1).due_at, '2026-10-01 18:00:00');
  const repeat = await updateHandoverSchedule(f.conn, { store: f.state.store, stages, reminders: { ...defaultReminders(), pre_dropoff: [120, 1440] }, expectedVersion: 3, now });
  assert.equal(repeat.changed, false);
  assert.equal(f.state.jobs.length, 4);
});

test('removing then restoring a future reminder revives only its skipped task', async () => {
  const f = fixture();
  const stages = { ...empty(), pre_dropoff: window };
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages, expectedVersion: 1, now });
  const original = f.state.jobs[1];
  const legacyPayload = JSON.parse(original.payload_json); delete legacyPayload.offsetMinutes;
  original.payload_json = JSON.stringify(legacyPayload);
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages, reminders: { ...defaultReminders(), pre_dropoff: [] }, expectedVersion: 2, now });
  assert.equal(original.status, 'SKIPPED');
  assert.equal(notificationIsRelevant(original, f.state.store, f.state.rows, new Date('2026-09-30T21:00:00+08:00')), false);
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages, reminders: defaultReminders(), expectedVersion: 3, now });
  assert.equal(original.status, 'PENDING');
  assert.equal(f.state.jobs.length, 2, 'keeps the migration-057 dedupe key');
  original.status = 'SENT';
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages, reminders: { ...defaultReminders(), pre_dropoff: [] }, expectedVersion: 4, now });
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages, reminders: defaultReminders(), expectedVersion: 5, now });
  assert.equal(original.status, 'SENT');
  assert.equal(f.state.jobs.length, 2);
});

test('all configured reminders shift with the changed stage and other stages remain intact', async () => {
  const f = fixture();
  const reminders = { ...defaultReminders(), pre_dropoff: [1440, 120], post_pickup: [60] };
  const stages = { ...empty(), pre_dropoff: window, post_pickup: window };
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages, reminders, expectedVersion: 1, now });
  const other = f.state.jobs.find(j => j.stage === 'post_pickup');
  const original = f.state.jobs.filter(j => j.stage === 'pre_dropoff');
  const nextWindow = { startsAt: '2026-10-03T20:00:00+08:00', endsAt: '2026-10-04T09:00:00+08:00' };
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages: { ...stages, pre_dropoff: nextWindow }, reminders, expectedVersion: 2, now });
  assert.ok(original.every(j => j.status === 'SKIPPED'));
  assert.equal(other.status, 'PENDING');
  assert.deepEqual(f.state.jobs.filter(j => j.stage === 'pre_dropoff' && j.status === 'PENDING').map(j => j.due_at), ['2026-10-02 20:00:00', '2026-10-03 18:00:00']);
});

for (const offset of [0, 1, 120 * 60000]) {
  test(`missed custom reminders (${offset}ms before start) are covered by one immediate notice`, async () => {
    const f = fixture();
    await updateHandoverSchedule(f.conn, { store: f.state.store, stages: { ...empty(), pre_dropoff: window }, reminders: { ...defaultReminders(), pre_dropoff: [4320, 1440, 120] }, expectedVersion: 1, now: new Date(new Date(window.startsAt).getTime() - offset) });
    assert.deepEqual(f.state.jobs.map(j => j.kind), ['schedule']);
  });
}

test('reminder-only edits do not send overdue reminders or suppress new-member reconciliation', async () => {
  const f = fixture({ store: { ...initialStore(), pre_dropoff_starts_at: window.startsAt, pre_dropoff_ends_at: window.endsAt } });
  const lateNow = new Date('2026-10-01T19:00:00+08:00');
  const result = await updateHandoverSchedule(f.conn, { store: f.state.store, stages: { ...empty(), pre_dropoff: window }, reminders: { ...defaultReminders(), pre_dropoff: [4320, 120, 30] }, expectedVersion: 1, now: lateNow });
  assert.equal(result.scheduleChanged, false);
  assert.deepEqual(f.state.jobs.map(j => j.kind), ['reminder']);
  assert.equal(f.state.jobs[0].due_at, '2026-10-01 19:30:00');
  await syncHandoverRecipients(f.conn, { storeIds: [8], now: lateNow });
  assert.deepEqual(f.state.jobs.map(j => j.kind), ['reminder', 'acquired']);
});

test('new reservations and transfers receive every future configured reminder only once', async () => {
  const f = fixture({ store: { ...initialStore(), pre_dropoff_starts_at: window.startsAt, pre_dropoff_ends_at: window.endsAt,
    handover_reminder_offsets: { ...defaultReminders(), pre_dropoff: [1440, 120] } } });
  await syncHandoverRecipients(f.conn, { storeIds: [8], now });
  await syncHandoverRecipients(f.conn, { storeIds: [8], now });
  assert.deepEqual(f.state.jobs.map(j => j.kind), ['acquired', 'reminder', 'reminder']);
  f.state.rows[0].user_id = 'recipient';
  await syncHandoverRecipients(f.conn, { storeIds: [8], now });
  assert.equal(f.state.jobs.filter(j => j.user_id === 'recipient').length, 3);
  await processHandoverNotifications({ pool: f.pool, transporter: f.transporter, isMailerReady: () => true, now: new Date('2026-10-01T18:00:00+08:00') });
  assert.ok(f.state.jobs.filter(j => j.user_id === 'member').every(j => j.status === 'SKIPPED'));
});

test('removed or completed custom reminders are skipped even if claimed or retried', async () => {
  const f = fixture();
  const stages = { ...empty(), pre_dropoff: window };
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages, reminders: { ...defaultReminders(), pre_dropoff: [120] }, expectedVersion: 1, now });
  const job = f.state.jobs[1];
  assert.equal(notificationIsRelevant(job, f.state.store, f.state.rows, new Date('2026-10-01T17:59:59+08:00')), false);
  assert.equal(notificationIsRelevant(job, f.state.store, f.state.rows, new Date('2026-10-01T18:00:00+08:00')), true);
  job.status = 'PROCESSING';
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages, reminders: { ...defaultReminders(), pre_dropoff: [] }, expectedVersion: 2, now });
  await deliverJob({ pool: f.pool, job, transporter: f.transporter, isMailerReady: () => true, now: new Date('2026-10-01T18:00:00+08:00') });
  assert.equal(job.status, 'SKIPPED');
  assert.equal(f.state.sent.length, 0);
  f.state.store.handover_reminder_offsets = { ...defaultReminders(), pre_dropoff: [120] };
  f.state.rows[0].pre_dropoff_checklist = '{"completed":true}';
  assert.equal(notificationIsRelevant(job, f.state.store, f.state.rows, new Date('2026-10-01T18:00:00+08:00')), false);
});

test('legacy drafts and missing reminder payloads preserve published custom settings', async () => {
  const reminders = { ...defaultReminders(), pre_dropoff: [120] };
  const stages = { ...empty(), pre_dropoff: window };
  const f = fixture({ store: { ...initialStore(), handover_schedule_draft: JSON.stringify(stages), handover_reminder_offsets: JSON.stringify(reminders) } });
  assert.deepEqual(editorStateFromRow(f.state.store).handoverDraft.reminders, reminders);
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages, expectedVersion: 1, now });
  assert.deepEqual(editorStateFromRow(f.state.store).handoverReminders, reminders);
});

test('reminder API enforces ownership, validation and migration readiness before writing', async () => {
  const f = fixture();
  assert.equal((await request(f, { userId: 'other', body: { stages: empty(), reminders: defaultReminders() } })).statusCode, 403);
  assert.equal((await request(f, { body: { stages: empty(), reminders: { ...defaultReminders(), pre_dropoff: [0] } } })).statusCode, 400);
  const query = f.conn.query;
  f.conn.query = async (sql, values) => {
    if (sql.startsWith('SELECT handover_reminder_offsets')) throw Object.assign(new Error('missing'), { code: 'ER_BAD_FIELD_ERROR' });
    return query(sql, values);
  };
  const result = await request(f, { body: { stages: empty(), reminders: defaultReminders() } });
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.code, 'HANDOVER_REMINDER_SCHEMA_MISSING');
  assert.equal(f.state.commits, 0);
});

test('old clients cannot silently discard a custom reminder draft', async () => {
  const f = fixture();
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages: empty(), reminders: { ...defaultReminders(), pre_dropoff: [120] }, mode: 'draft', expectedVersion: 1, now });
  await assert.rejects(updateHandoverSchedule(f.conn, { store: f.state.store, stages: empty(), expectedVersion: 2, now }), { code: 'HANDOVER_REMINDERS_REQUIRED', statusCode: 409 });
  assert.deepEqual(editorStateFromRow(f.state.store).handoverDraft.reminders.pre_dropoff, [120]);
  assert.equal(f.state.jobs.length, 0);
});

test('adding another reminder preserves SMTP retry backoff; removed failed reminders cannot send', async () => {
  const f = fixture({ failSend: true });
  const stages = { ...empty(), pre_dropoff: window };
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages, reminders: { ...defaultReminders(), pre_dropoff: [120] }, expectedVersion: 1, now });
  const job = f.state.jobs[1];
  await deliverJob({ pool: f.pool, job, transporter: f.transporter, isMailerReady: () => true, publicWebUrl: 'https://example.test', now: new Date('2026-10-01T18:00:00+08:00') });
  assert.equal(job.status, 'FAILED');
  const dueAt = job.due_at;
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages, reminders: { ...defaultReminders(), pre_dropoff: [120, 60] }, expectedVersion: 2, now });
  assert.equal(job.status, 'FAILED');
  assert.equal(job.due_at, dueAt);
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages, reminders: { ...defaultReminders(), pre_dropoff: [60] }, expectedVersion: 3, now });
  assert.equal(job.status, 'SKIPPED');
  await deliverJob({ pool: f.pool, job, transporter: f.transporter, isMailerReady: () => true, publicWebUrl: 'https://example.test', now: new Date('2026-10-01T18:05:00+08:00') });
  assert.equal(job.status, 'SKIPPED');
  assert.deepEqual(f.state.sent, []);
});

test('publishing a saved reminder draft retires removed jobs and keeps the published time version', async () => {
  const f = fixture();
  const stages = { ...empty(), pre_dropoff: window };
  await updateHandoverSchedule(f.conn, { store: f.state.store, stages, expectedVersion: 1, now });
  const before = structuredClone(f.state.jobs);
  const reminders = { ...defaultReminders(), pre_dropoff: [4320, 120] };
  const draft = await updateHandoverSchedule(f.conn, { store: f.state.store, stages, reminders, mode: 'draft', expectedVersion: 2, now });
  assert.deepEqual(f.state.jobs, before);
  assert.deepEqual(draft.handoverReminders, defaultReminders());
  const reloaded = editorStateFromRow(f.state.store);
  const result = await updateHandoverSchedule(f.conn, { store: f.state.store, stages: reloaded.handoverDraft.stages, reminders: reloaded.handoverDraft.reminders, expectedVersion: reloaded.editVersion, now });
  assert.equal(result.handoverDraft, null);
  assert.equal(result.handoverSchedule.version, 2);
  assert.equal(f.state.jobs[0].status, 'PENDING');
  assert.equal(f.state.jobs[1].status, 'SKIPPED');
  assert.deepEqual(f.state.jobs.slice(2).map(j => JSON.parse(j.payload_json).offsetMinutes), [4320, 120]);
});
