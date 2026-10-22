'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const mysql = require('mysql2/promise');
const { inventory, buildTriggers, assertSchema, q } = require('../src/services/audit/schema');

const socketPath = process.env.HANDOVER_TEST_MYSQL_SOCKET;
test('062 reruns safely and rebuilt audit triggers capture location edits without storing addresses', { skip: !socketPath }, async t => {
  assert.ok(path.isAbsolute(socketPath), 'Use an explicit disposable local socket');
  const database = `handover_locations_${randomUUID().replaceAll('-', '')}`;
  const db = await mysql.createConnection({ socketPath, user: 'root', multipleStatements: true });
  t.after(async () => { await db.query(`DROP DATABASE IF EXISTS ${q(database)}`); await db.end(); });
  await db.query(`CREATE DATABASE ${q(database)} CHARACTER SET utf8mb4; USE ${q(database)}`);
  const root = path.resolve(__dirname, '../..');
  await db.query(fs.readFileSync(path.join(root, 'Database/migrations/058_admin_audit.sql'), 'utf8'));
  await db.query('CREATE TABLE event_stores (id INT PRIMARY KEY, owner_user_id CHAR(36), event_id INT, name VARCHAR(255), address VARCHAR(255)) ENGINE=InnoDB');
  await db.query("INSERT INTO event_stores VALUES (8,'provider',9,'台北門市','門市地址')");
  const rebuild = async () => {
    const tables = await inventory(db);
    for (const [table, columns] of tables) for (const trigger of buildTriggers(table, columns, tables)) {
      await db.query(`DROP TRIGGER IF EXISTS ${q(trigger.name)}`);
      await db.query(trigger.sql);
    }
  };
  await rebuild();
  await assertSchema(db);
  const migration = fs.readFileSync(path.join(root, 'Database/migrations/062_handover_locations.sql'), 'utf8');
  await db.query(migration);
  await db.query(migration);
  const [[legacy]] = await db.query('SELECT pre_pickup_location, post_dropoff_location FROM event_stores WHERE id=8');
  assert.deepEqual(legacy, { pre_pickup_location: null, post_dropoff_location: null });
  await assert.rejects(assertSchema(db), /Audit trigger missing or stale: event_stores/);
  await rebuild();
  await assertSchema(db);
  const [request] = await db.query("INSERT INTO admin_audit_requests(request_id,module,action,method,route) VALUES(?,'events','update','PATCH','/admin/events/stores/8/schedule')", [randomUUID()]);
  await db.query('SET @leader_audit_request=?', [request.insertId]);
  await db.query('UPDATE event_stores SET pre_pickup_location=?, post_dropoff_location=? WHERE id=8', ['PRIVATE PICKUP ADDRESS', 'PRIVATE DROPOFF ADDRESS']);
  const [changes] = await db.query("SELECT before_json,after_json,changed_fields FROM admin_audit_changes WHERE resource_table='event_stores'");
  assert.equal(changes.length, 1);
  const recorded = JSON.stringify(changes);
  assert.match(recorded, /pre_pickup_location/);
  assert.match(recorded, /post_dropoff_location/);
  assert.ok(!recorded.includes('PRIVATE PICKUP ADDRESS'));
  assert.ok(!recorded.includes('PRIVATE DROPOFF ADDRESS'));
  await db.query(migration);
  const [[saved]] = await db.query('SELECT pre_pickup_location, post_dropoff_location FROM event_stores WHERE id=8');
  assert.equal(saved.pre_pickup_location, 'PRIVATE PICKUP ADDRESS');
  assert.equal(saved.post_dropoff_location, 'PRIVATE DROPOFF ADDRESS');
  await assertSchema(db);
});
