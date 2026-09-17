const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const mysql = require('mysql2/promise');
const wallet = require('../src/services/reservation-google-wallet');
const walletSync = require('../src/services/google-wallet-object-sync');

// Explicit opt-in to an isolated, disposable local database. No application DB env is used.
// REFUND_TEST_MYSQL_SOCKET=/path/to/test/mysql.sock node --test tests/admin-order-refund-mysql.test.js
const socketPath = process.env.REFUND_TEST_MYSQL_SOCKET;
const root = path.resolve(__dirname, '../..');
test.mock.method(wallet, 'inactivateReservationGoogleWalletForHolder', async ({ queryable, reservation }) => {
  await queryable.query('INSERT INTO test_wallet_jobs (reservation_id) VALUES (?)', [reservation.id]);
  return { pass: { objectId: `test.${reservation.id}` } };
});
test.mock.method(walletSync, 'processGoogleWalletObjectSyncJobs', async () => {});
const buildOrderRoutes = require('../src/routes/orders');

test('whole-order refund against a real MySQL/MariaDB schema', { skip: !socketPath }, async (t) => {
  const database = `refund_test_${randomUUID().replaceAll('-', '')}`;
  const setup = await mysql.createConnection({ socketPath, user: 'root', multipleStatements: true });
  let pool;
  t.after(async () => {
    if (pool) await pool.end();
    await setup.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await setup.end();
  });
  await setup.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await setup.query(`USE \`${database}\``);
  await setup.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'");

  // Use checked-in table definitions, including ENUM and foreign-key constraints.
  const schema = fs.readFileSync(path.join(root, 'Database/schema.mysql.sql'), 'utf8');
  const tables = ['users', 'orders', 'tickets', 'reservations', 'reservation_checklist_photos',
    'reservation_assignments', 'reservation_transfers', 'reservation_tasks', 'order_action_idempotency', 'order_lifecycle_events'];
  for (const name of tables) {
    const start = schema.indexOf(`CREATE TABLE IF NOT EXISTS \`${name}\``);
    assert.ok(start >= 0, `Missing schema for ${name}`);
    await setup.query(schema.slice(start, schema.indexOf(';', start) + 1));
  }
  await setup.query('CREATE TABLE test_wallet_jobs (reservation_id BIGINT PRIMARY KEY) ENGINE=InnoDB');
  await setup.query("INSERT INTO users (id, username, email, password_hash) VALUES ('buyer', 'Test', 'buyer@example.test', 'test'), ('admin', 'Admin', 'admin@example.test', 'test')");
  const details = JSON.stringify({ status: '已付款', reservations_granted: true, selections: [{ storeId: 7, qty: 1 }], total: 2000 });
  for (const id of [161, 162]) {
    await setup.query("INSERT INTO orders (id, user_id, code, details, payment_status, fulfillment_status, row_version) VALUES (?, 'buyer', ?, ?, 'paid', 'fulfilled', 3)", [id, `REFUND-${id}`, details]);
    await setup.query("INSERT INTO reservations (id, order_id, user_id, ticket_type, store, event, verify_code, verify_code_pre_dropoff) VALUES (?, ?, 'buyer', 'Test', 'Test', 'Test', '123456', '123456')", [id, id]);
    await setup.query("INSERT INTO reservation_tasks (reservation_id, order_id, assignee_user_id, assignee_role, task_stage) VALUES (?, ?, 'admin', 'DELIVERY_POINT', 'pre_dropoff')", [id, id]);
  }
  pool = mysql.createPool({ socketPath, user: 'root', database, connectionLimit: 2 });
  const middleware = (_req, _res, next) => next();
  let sequence = 700000;
  const router = buildOrderRoutes({
    pool, authRequired: middleware, adminOnly: middleware, serviceProviderOnly: middleware,
    isADMIN: role => role === 'ADMIN',
    normalizePositiveInt: value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null,
    safeParseJSON(value, fallback = {}) { try { return typeof value === 'string' ? JSON.parse(value) : (value ?? fallback); } catch { return fallback; } },
    generateReservationStageCode: async () => String(++sequence),
    getUserContact: async () => ({ username: 'Test', email: 'buyer@example.test' }),
    summarizeOrderDetails: () => 'Test refund',
    sendOrderNotificationEmail: async () => ({ mailed: true }),
    ok: (res, data) => res.status(200).json({ ok: true, data }),
    fail: (res, code, message, status) => res.status(status).json({ ok: false, code, message }),
  });
  const handler = router.stack.find(layer => layer.route?.path === '/admin/orders/:id/actions/:action').route.stack.at(-1).handle;
  const refund = async (id) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ params: { id: String(id), action: 'refund' }, user: { id: 'admin', role: 'ADMIN' },
      headers: { 'if-match': '3', 'idempotency-key': `refund-${id}` }, body: { reason: '客戶申請退款' } }, res);
    return res;
  };

  await t.test('old ENUM reproduces production truncation and readiness guard rolls back the request', async () => {
    const migration005 = fs.readFileSync(path.join(root, 'Database/migrations/005_reservations_six_stage_status.sql'), 'utf8');
    await setup.query(migration005);
    await assert.rejects(setup.query("UPDATE reservations SET status = 'cancelled' WHERE id = 161"), { code: 'WARN_DATA_TRUNCATED' });
    const result = await refund(161);
    assert.equal(result.statusCode, 503, JSON.stringify(result.body));
    assert.equal(result.body.code, 'ORDER_REFUND_SCHEMA_NOT_READY');
    const [[row]] = await setup.query('SELECT status, verify_code FROM reservations WHERE id = 161');
    assert.deepEqual(row, { status: 'service_booking', verify_code: '123456' });
    const [[claim]] = await setup.query('SELECT COUNT(*) AS count FROM order_action_idempotency');
    assert.equal(claim.count, 0);
  });

  await t.test('056 preserves existing statuses and can run twice', async () => {
    const migration = fs.readFileSync(path.join(root, 'Database/migrations/056_reservation_cancelled_status.sql'), 'utf8');
    const [[before]] = await setup.query("SHOW COLUMNS FROM reservations LIKE 'status'");
    await setup.query(migration);
    await setup.query(migration);
    const [[after]] = await setup.query("SHOW COLUMNS FROM reservations LIKE 'status'");
    assert.equal(after.Type, `${before.Type.slice(0, -1)},'cancelled')`);
    assert.equal(after.Default, before.Default);
    const [[row]] = await setup.query('SELECT status FROM reservations WHERE id = 161');
    assert.equal(row.status, 'service_booking');
  });

  await t.test('refund commits cancellation, task closure, audit and replay exactly once', async () => {
    const result = await refund(161);
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    const [[order]] = await setup.query('SELECT payment_status, fulfillment_status, row_version FROM orders WHERE id = 161');
    assert.deepEqual(order, { payment_status: 'refunded', fulfillment_status: 'voided', row_version: 4 });
    const [[reservation]] = await setup.query('SELECT status, verify_code FROM reservations WHERE id = 161');
    assert.equal(reservation.status, 'cancelled');
    assert.notEqual(reservation.verify_code, '123456');
    const [[task]] = await setup.query('SELECT status FROM reservation_tasks WHERE reservation_id = 161');
    assert.equal(task.status, 'CANCELLED');
    const replay = await refund(161);
    assert.equal(replay.body.replayed, true);
    const [[audit]] = await setup.query('SELECT COUNT(*) AS count, MAX(reason) AS reason FROM order_lifecycle_events');
    assert.deepEqual(audit, { count: 1, reason: '客戶申請退款' });
    const [[jobs]] = await setup.query('SELECT COUNT(*) AS count FROM test_wallet_jobs');
    assert.equal(jobs.count, 1);
  });

  await t.test('late SQL failure rolls back reservation, task, wallet, audit and idempotency together', async () => {
    await setup.query("CREATE TRIGGER test_fail_order BEFORE UPDATE ON orders FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test order write failure'");
    const result = await refund(162);
    assert.equal(result.statusCode, 500);
    const [[reservation]] = await setup.query('SELECT status, verify_code FROM reservations WHERE id = 162');
    assert.deepEqual(reservation, { status: 'service_booking', verify_code: '123456' });
    const [[task]] = await setup.query('SELECT status FROM reservation_tasks WHERE reservation_id = 162');
    assert.equal(task.status, 'OPEN');
    for (const [table, column] of [['order_lifecycle_events', 'order_id'], ['order_action_idempotency', 'resource_id'], ['test_wallet_jobs', 'reservation_id']]) {
      const [[row]] = await setup.query(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = 162`);
      assert.equal(row.count, 0, table);
    }
  });
});
