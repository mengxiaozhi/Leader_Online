'use strict';

const { createHash } = require('node:crypto');
const { reservationOrderIsCancelled } = require('./reservation-google-wallet');

const STAGES = ['pre_dropoff', 'pre_pickup', 'post_dropoff', 'post_pickup'];
const LABELS = { pre_dropoff: '賽前交車', pre_pickup: '賽前取車', post_dropoff: '賽後交車', post_pickup: '賽後取車' };
const TIMEZONE = 'Asia/Taipei';
const DAY_MS = 86400000;
const COLUMNS = ['handover_schedule_version', 'handover_stage_versions', ...STAGES.flatMap(stage => [`${stage}_starts_at`, `${stage}_ends_at`])];
const json = (value, fallback = {}) => { try { return typeof value === 'string' ? JSON.parse(value) : value || fallback; } catch { return fallback; } };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sqlDate = date => new Date(new Date(date).getTime() + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
const isoDate = value => value instanceof Date ? sqlDate(value).replace(' ', 'T') + '+08:00' : value ? String(value).replace(' ', 'T').slice(0, 19) + '+08:00' : null;
const fault = (code, message, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

function normalizeTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\+08:00)?$/.test(value)) {
    throw fault('VALIDATION_ERROR', '請輸入完整的台灣日期與時間');
  }
  const local = value.replace(/\+08:00$/, '');
  const canonical = (local.length === 16 ? `${local}:00` : local) + '+08:00';
  const date = new Date(canonical);
  if (!Number.isFinite(date.getTime()) || isoDate(date) !== canonical || Number(local.slice(0, 4)) < 1000) {
    throw fault('VALIDATION_ERROR', '日期或時間不正確');
  }
  return canonical;
}

function normalizeStages(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !STAGES.includes(key))) {
    throw fault('VALIDATION_ERROR', '請提供四階段交取車時段');
  }
  return Object.fromEntries(STAGES.map(stage => {
    if (!Object.hasOwn(input, stage)) throw fault('VALIDATION_ERROR', '請提供四階段交取車時段，未公布請填 null');
    const value = input[stage];
    if (value === null) return [stage, null];
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['startsAt', 'endsAt'].includes(key))) {
      throw fault('VALIDATION_ERROR', `${LABELS[stage]}請完整填寫開始與結束時間`);
    }
    const startsAt = normalizeTime(value.startsAt);
    const endsAt = normalizeTime(value.endsAt);
    if (new Date(endsAt) <= new Date(startsAt)) throw fault('VALIDATION_ERROR', `${LABELS[stage]}結束時間必須晚於開始時間`);
    return [stage, { startsAt, endsAt }];
  }));
}

function scheduleFromRow(row = {}, available = true) {
  return {
    available, version: Number(row.handover_schedule_version || 1), timezone: TIMEZONE,
    stages: Object.fromEntries(STAGES.map(stage => [stage,
      row[`${stage}_starts_at`] && row[`${stage}_ends_at`]
        ? { startsAt: isoDate(row[`${stage}_starts_at`]), endsAt: isoDate(row[`${stage}_ends_at`]) } : null,
    ])),
  };
}

// No request-time DDL. A missing migration disables only this feature.
async function schemaReady(db) {
  try {
    await db.query(`SELECT ${COLUMNS.join(', ')} FROM event_stores LIMIT 0`);
    await db.query('SELECT id FROM handover_notification_outbox LIMIT 0');
    await db.query('SELECT reservation_id FROM handover_notification_memberships LIMIT 0');
    return true;
  } catch (error) {
    if (['ER_BAD_FIELD_ERROR', 'ER_NO_SUCH_TABLE'].includes(error.code)) return false;
    throw error;
  }
}

async function attachHandoverSchedules(db, rows, storeId = row => row.store_id) {
  if (!rows.length) return rows;
  const ready = await schemaReady(db);
  const ids = [...new Set(rows.map(row => Number(storeId(row))).filter(id => Number.isSafeInteger(id) && id > 0))];
  let stores = [];
  if (ready && ids.length) [stores] = await db.query(`SELECT id, ${COLUMNS.join(', ')} FROM event_stores WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  const map = new Map(stores.map(row => [Number(row.id), row]));
  return rows.map(row => ({ ...row, handoverSchedule: scheduleFromRow(map.get(Number(storeId(row))), ready) }));
}

function stagePending(reservation, stage) {
  if (reservationOrderIsCancelled(reservation) || ['done', 'cancelled'].includes(reservation.status)) return false;
  const current = STAGES.indexOf(reservation.status === 'pickup' ? 'pre_pickup' : reservation.status);
  return current <= STAGES.indexOf(stage) && !json(reservation[`${stage}_checklist`]).completed;
}

function activeReservation(row) {
  return !reservationOrderIsCancelled(row) && !['done', 'cancelled'].includes(row.status)
    && !['refunded', 'cancelled'].includes(row.payment_status) && row.fulfillment_status !== 'cancelled';
}

async function storeRecipients(db, storeId, { lock = false } = {}) {
  const [rows] = await db.query(
    `SELECT r.*, o.details AS order_details, o.payment_status, o.fulfillment_status
       FROM reservations r LEFT JOIN orders o ON o.id = r.order_id
      WHERE r.store_id = ? ORDER BY r.id${lock ? ' FOR UPDATE' : ''}`, [storeId]);
  return rows.filter(activeReservation);
}

function groupsFor(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = String(row.user_id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

async function enqueue(db, { storeId, userId, kind, stage = null, revision = 0, key, payload, dueAt }) {
  await db.query(
    `INSERT INTO handover_notification_outbox
      (store_id, user_id, kind, stage, schedule_revision, dedupe_key, payload_json, due_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id`,
    [storeId, userId, kind, stage, revision, digest(key), JSON.stringify(payload), sqlDate(dueAt)]);
}

async function rememberMembers(db, rows, storeId) {
  if (!rows.length) return;
  await db.query(
    `INSERT INTO handover_notification_memberships (reservation_id, user_id, store_id) VALUES ?
     ON DUPLICATE KEY UPDATE reservation_id = reservation_id`,
    [rows.map(row => [row.id, row.user_id, storeId])]);
}

async function enqueueReminders(db, store, rows, now, stages = STAGES) {
  const schedule = scheduleFromRow(store);
  const versions = json(store.handover_stage_versions);
  for (const [userId, reservations] of groupsFor(rows)) {
    for (const stage of stages) {
      const window = schedule.stages[stage];
      if (!window || !reservations.some(row => stagePending(row, stage))) continue;
      const dueAt = new Date(new Date(window.startsAt).getTime() - DAY_MS);
      // A newly acquired/published window inside 24h is covered by its immediate notice.
      if (dueAt <= now) continue;
      await enqueue(db, {
        storeId: store.id, userId, kind: 'reminder', stage, revision: versions[stage] || 0,
        key: ['reminder', store.id, userId, stage, versions[stage] || 0],
        payload: { window }, dueAt,
      });
    }
  }
}

// Called within the reservation transaction and by a reconciliation sweep. The
// sweep also covers old records and account merges without relying on a browser.
async function syncHandoverRecipients(db, { storeIds, now = new Date(), ready = null } = {}) {
  if (ready !== true && !(await schemaReady(db))) return;
  const ids = [...new Set((storeIds || []).map(Number).filter(id => id > 0))].sort((a, b) => a - b);
  for (const storeId of ids) {
    const [[store]] = await db.query('SELECT * FROM event_stores WHERE id = ? FOR UPDATE', [storeId]);
    if (!store) continue;
    const rows = await storeRecipients(db, storeId, { lock: true });
    const [seen] = await db.query('SELECT reservation_id, user_id FROM handover_notification_memberships WHERE store_id = ?', [storeId]);
    const known = new Set(seen.map(row => `${row.reservation_id}:${row.user_id}`));
    const added = rows.filter(row => !known.has(`${row.id}:${row.user_id}`));
    const schedule = scheduleFromRow(store);
    // Remove former holders so a later transfer back is a new acquisition.
    await db.query(
      `DELETE m FROM handover_notification_memberships m LEFT JOIN reservations r
         ON r.id = m.reservation_id AND r.user_id = m.user_id AND r.store_id = m.store_id
       WHERE m.store_id = ? AND r.id IS NULL`, [storeId]);
    for (const [userId, members] of groupsFor(added)) {
      if (STAGES.some(stage => schedule.stages[stage] && new Date(schedule.stages[stage].endsAt) > now && members.some(row => stagePending(row, stage)))) {
        await enqueue(db, {
          storeId, userId, kind: 'acquired', revision: schedule.version,
          // Include the latest transfer ID for transfers back to a previous holder.
          key: ['acquired', storeId, userId, schedule.version, members.map(row => [row.id, row.reserved_at]),
            await latestTransferId(db, members.map(row => row.id))],
          payload: { reservationIds: members.map(row => String(row.id)) }, dueAt: now,
        });
      }
    }
    await rememberMembers(db, added, storeId);
    // Only new members need new reminder tasks; existing due jobs are retained.
    await enqueueReminders(db, store, added, now);
  }
}

async function latestTransferId(db, ids) {
  if (!ids.length) return 0;
  const [[row]] = await db.query(`SELECT MAX(id) AS id FROM reservation_transfers WHERE reservation_id IN (${ids.map(() => '?').join(',')}) AND status = 'accepted'`, ids);
  return Number(row?.id || 0);
}

async function updateHandoverSchedule(db, { store, stages, expectedVersion, now = new Date() }) {
  const current = scheduleFromRow(store);
  if (expectedVersion !== current.version) throw fault('HANDOVER_VERSION_CONFLICT', '交取車時間已被更新，請重新載入後再編輯', 409);
  const normalized = normalizeStages(stages);
  const changed = STAGES.filter(stage => JSON.stringify(current.stages[stage]) !== JSON.stringify(normalized[stage]));
  if (!changed.length) return { handoverSchedule: current, changed: false };
  const versions = json(store.handover_stage_versions);
  const values = [];
  for (const stage of STAGES) {
    if (changed.includes(stage)) versions[stage] = Number(versions[stage] || 0) + 1;
    values.push(normalized[stage] ? sqlDate(normalized[stage].startsAt) : null, normalized[stage] ? sqlDate(normalized[stage].endsAt) : null);
  }
  await db.query(`UPDATE event_stores SET ${STAGES.flatMap(stage => [`${stage}_starts_at = ?`, `${stage}_ends_at = ?`]).join(', ')},
    handover_schedule_version = handover_schedule_version + 1, handover_stage_versions = ? WHERE id = ?`, [...values, JSON.stringify(versions), store.id]);
  const next = { ...store, handover_schedule_version: current.version + 1, handover_stage_versions: versions };
  STAGES.forEach(stage => { next[`${stage}_starts_at`] = normalized[stage]?.startsAt || null; next[`${stage}_ends_at`] = normalized[stage]?.endsAt || null; });
  await db.query(`UPDATE handover_notification_outbox SET status = 'SKIPPED', last_error = '時程已更新', locked_at = NULL
    WHERE store_id = ? AND status IN ('PENDING','FAILED','DEAD')
      AND (kind IN ('schedule','acquired') OR (kind = 'reminder' AND stage IN (${changed.map(() => '?').join(',')})))`, [store.id, ...changed]);
  const rows = await storeRecipients(db, store.id, { lock: true });
  for (const [userId, members] of groupsFor(rows)) {
    const relevant = changed.filter(stage => members.some(row => stagePending(row, stage)));
    if (!relevant.length) continue;
    await enqueue(db, {
      storeId: store.id, userId, kind: 'schedule', revision: next.handover_schedule_version,
      key: ['schedule', store.id, userId, next.handover_schedule_version],
      payload: { changed: relevant, before: current.stages, after: normalized }, dueAt: now,
    });
  }
  await rememberMembers(db, rows, store.id);
  await enqueueReminders(db, next, rows, now, changed);
  return { handoverSchedule: scheduleFromRow(next), changed: true };
}

function notificationIsRelevant(job, store, rows, now) {
  const schedule = scheduleFromRow(store);
  const payload = json(job.payload_json);
  if (!rows.length) return false;
  if (job.kind === 'reminder') {
    const window = schedule.stages[job.stage];
    return !!window && Number(json(store.handover_stage_versions)[job.stage] || 0) === Number(job.schedule_revision)
      && new Date(window.startsAt) > now && rows.some(row => stagePending(row, job.stage));
  }
  if (job.kind === 'schedule') {
    return schedule.version === Number(job.schedule_revision)
      && (payload.changed || []).some(stage => rows.some(row => stagePending(row, stage)));
  }
  return rows.some(row => (payload.reservationIds || []).includes(String(row.id)))
    && STAGES.some(stage => schedule.stages[stage] && new Date(schedule.stages[stage].endsAt) > now && rows.some(row => stagePending(row, stage)));
}

function windowText(window) {
  return window ? `${window.startsAt.slice(0, 16).replace('T', ' ')} ～ ${window.endsAt.slice(0, 16).replace('T', ' ')}` : '時間待公布';
}

function handoverEmail(job, store, rows) {
  const schedule = scheduleFromRow(store);
  const payload = json(job.payload_json);
  const heading = job.kind === 'reminder' ? `${LABELS[job.stage]}時間提醒` : job.kind === 'schedule' ? '交取車時間公布／變更通知' : '您的交取車時間';
  const lines = [
    `服務檔期：${store.event_title || '預約'}`, `交車點：${store.name || ''}`,
    `預約編號：${rows.map(row => `#${row.id}`).join('、')}`, '以下皆為台灣時間（Asia/Taipei）', '',
    ...STAGES.map(stage => `${LABELS[stage]}：${windowText(schedule.stages[stage])}\n地點：${['pre_dropoff', 'post_pickup'].includes(stage) ? [store.name, store.address].filter(Boolean).join('／') || '地點待公布' : store.event_location || '地點待公布'}`),
  ];
  if (job.kind === 'schedule') {
    lines.push('', '此次變更：', ...(payload.changed || []).map(stage =>
      `${LABELS[stage]}：${windowText(payload.before?.[stage])} → ${schedule.stages[stage] ? windowText(schedule.stages[stage]) : '時間待重新公布'}`));
  }
  return { subject: `${heading}：${store.event_title || 'Leader Online'}`, text: lines.join('\n') };
}

async function notificationSummary(db, storeId) {
  const [counts] = await db.query('SELECT status, COUNT(*) AS count FROM handover_notification_outbox WHERE store_id = ? GROUP BY status', [storeId]);
  const [failures] = await db.query("SELECT id, kind, stage, attempts, last_error AS lastError FROM handover_notification_outbox WHERE store_id = ? AND status IN ('FAILED','DEAD') ORDER BY id DESC LIMIT 20", [storeId]);
  const count = status => Number(counts.find(row => row.status === status)?.count || 0);
  return { pending: count('PENDING') + count('PROCESSING'), sent: count('SENT'), failed: count('FAILED') + count('DEAD'), skipped: count('SKIPPED'), failures };
}

module.exports = { STAGES, LABELS, COLUMNS, TIMEZONE, DAY_MS, json, digest, sqlDate, isoDate, fault, normalizeStages,
  scheduleFromRow, schemaReady, attachHandoverSchedules, stagePending, activeReservation, storeRecipients,
  syncHandoverRecipients, updateHandoverSchedule, notificationIsRelevant, windowText, handoverEmail, notificationSummary };
