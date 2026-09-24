'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const mysql = require('mysql2/promise');
const { STAGES, updateHandoverSchedule, syncHandoverRecipients, scheduleFromRow, editorStateFromRow } = require('../src/services/handover-schedule');
const { processHandoverNotifications } = require('../src/services/handover-notification-worker');

// Opt in only to a disposable local MySQL/MariaDB instance. Never use DB_HOST,
// DB_NAME or application credentials, and never send a real email.
const socketPath = process.env.HANDOVER_TEST_MYSQL_SOCKET;
test('handover migration, rollback, reminders and transfers on real MySQL', { skip: !socketPath }, async t => {
  const database = `handover_test_${randomUUID().replaceAll('-', '')}`;
  const setup = await mysql.createConnection({ socketPath, user: 'root', multipleStatements: true, timezone: '+08:00' });
  let pool;
  t.after(async () => { if (pool) await pool.end(); await setup.query(`DROP DATABASE IF EXISTS \`${database}\``); await setup.end(); });
  await setup.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await setup.query(`USE \`${database}\``);
  const root = path.resolve(__dirname, '../..');
  const schema = fs.readFileSync(path.join(root, 'Database/schema.mysql.sql'), 'utf8');
  for (const table of ['users', 'events', 'event_stores', 'orders', 'reservations', 'reservation_transfers']) {
    const start = schema.indexOf(`CREATE TABLE IF NOT EXISTS \`${table}\``);
    assert.ok(start >= 0, table);
    let sql = schema.slice(start, schema.indexOf(';', start) + 1);
    if (table === 'event_stores') sql = sql.split('\n').filter(line => !/handover_|(?:pre|post)_(?:dropoff|pickup)_(?:starts|ends)_at/.test(line)).join('\n');
    await setup.query(sql);
  }
  const migration = fs.readFileSync(path.join(root, 'Database/migrations/057_handover_schedule_notifications.sql'), 'utf8');
  await setup.query(migration);
  await setup.query(migration);
  const draftMigration = fs.readFileSync(path.join(root, 'Database/migrations/059_handover_schedule_drafts.sql'), 'utf8');
  await setup.query(draftMigration);
  await setup.query(draftMigration);
  await setup.query("INSERT INTO users (id, username, email, password_hash) VALUES ('provider','Provider','provider@example.test','test'),('member','Member','member@example.test','test'),('recipient','Recipient','recipient@example.test','test')");
  await setup.query("INSERT INTO events (id,title,starts_at,ends_at,owner_user_id) VALUES (9,'Test','2026-10-10 08:00:00','2026-10-11 18:00:00','provider')");
  await setup.query("INSERT INTO event_stores (id,event_id,owner_user_id,name,prices) VALUES (8,9,'provider','Test store','{}')");
  await setup.query("INSERT INTO orders (id,user_id,details,payment_status,fulfillment_status) VALUES (1,'member','{\"status\":\"已付款\"}','paid','fulfilled')");
  await setup.query("INSERT INTO reservations (id,user_id,order_id,store_id,event_id,ticket_type,store,event,status) VALUES (41,'member',1,8,9,'test','Test store','Test','pre_dropoff'),(42,'member',1,8,9,'test','Test store','Test','pre_dropoff')");
  pool = mysql.createPool({ socketPath, user: 'root', database, timezone: '+08:00', connectionLimit: 1 });
  const now = new Date('2026-09-28T12:00:00+08:00');
  const stages = Object.fromEntries(STAGES.map(stage => [stage, null]));
  stages.pre_dropoff = { startsAt: '2026-10-01T20:00:00+08:00', endsAt: '2026-10-02T09:00:00+08:00' };
  const saveDraft = async rollback => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[store]] = await conn.query('SELECT * FROM event_stores WHERE id = 8 FOR UPDATE');
      await updateHandoverSchedule(conn, { store, stages, expectedVersion: editorStateFromRow(store).editVersion, mode: 'draft', now });
      if (rollback) await conn.rollback(); else await conn.commit();
    } finally { conn.release(); }
  };
  await saveDraft(true);
  const [[draftRolledBack]] = await pool.query('SELECT * FROM event_stores WHERE id = 8');
  assert.equal(editorStateFromRow(draftRolledBack).handoverDraft, null);
  assert.equal(editorStateFromRow(draftRolledBack).editVersion, 1);
  await saveDraft(false);
  // Re-running migration and ordinary store edits preserve the draft.
  await setup.query(draftMigration);
  await pool.query('UPDATE event_stores SET capacity = 25 WHERE id = 8');
  const [[draftSaved]] = await pool.query('SELECT * FROM event_stores WHERE id = 8');
  assert.deepEqual(editorStateFromRow(draftSaved).handoverDraft.stages, stages);
  assert.equal(editorStateFromRow(draftSaved).editVersion, 2);
  assert.equal(scheduleFromRow(draftSaved).stages.pre_dropoff, null);
  const [[draftJobs]] = await pool.query('SELECT COUNT(*) AS count FROM handover_notification_outbox');
  assert.equal(Number(draftJobs.count), 0);
  const save = async rollback => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[store]] = await conn.query('SELECT * FROM event_stores WHERE id = 8 FOR UPDATE');
      await updateHandoverSchedule(conn, { store, stages, expectedVersion: editorStateFromRow(store).editVersion, now });
      if (rollback) await conn.rollback(); else await conn.commit();
    } finally { conn.release(); }
  };
  await save(true);
  const [[rolledBack]] = await pool.query('SELECT COUNT(*) AS count FROM handover_notification_outbox');
  assert.equal(Number(rolledBack.count), 0);
  const [[afterRollback]] = await pool.query('SELECT * FROM event_stores WHERE id = 8');
  assert.deepEqual(editorStateFromRow(afterRollback), editorStateFromRow(draftSaved));
  await save(false);
  const [[saved]] = await pool.query('SELECT * FROM event_stores WHERE id = 8');
  assert.equal(scheduleFromRow(saved).stages.pre_dropoff.startsAt, stages.pre_dropoff.startsAt);
  assert.equal(editorStateFromRow(saved).handoverDraft, null);
  assert.equal(editorStateFromRow(saved).editVersion, 3);
  await pool.query("UPDATE event_stores SET capacity = 25, prices = '{\"test\":{\"normal\":100}}' WHERE id = 8");
  const [[edited]] = await pool.query('SELECT * FROM event_stores WHERE id = 8');
  assert.deepEqual(scheduleFromRow(edited), scheduleFromRow(saved));
  const sent = [];
  const options = { pool, transporter: { sendMail: async mail => sent.push(mail) }, isMailerReady: () => true, publicWebUrl: 'https://example.test', now };
  await processHandoverNotifications(options);
  await processHandoverNotifications(options);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /#41、#42/);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("UPDATE reservations SET user_id = 'recipient' WHERE store_id = 8");
    await conn.query("INSERT INTO reservation_transfers (reservation_id,from_user_id,to_user_id,status) VALUES (41,'member','recipient','accepted'),(42,'member','recipient','accepted')");
    await syncHandoverRecipients(conn, { storeIds: [8], now });
    await conn.commit();
  } finally { conn.release(); }
  await processHandoverNotifications(options);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].to, 'recipient@example.test');
  await processHandoverNotifications({ ...options, now: new Date('2026-09-30T20:00:00+08:00') });
  assert.equal(sent.length, 3);
  assert.equal(sent[2].to, 'recipient@example.test');
  await pool.query("UPDATE reservations SET status = 'cancelled' WHERE store_id = 8");
  await processHandoverNotifications({ ...options, now: new Date('2026-10-01T19:00:00+08:00') });
  assert.equal(sent.length, 3);
});
