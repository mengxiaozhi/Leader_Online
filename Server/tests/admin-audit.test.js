'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { installAudit, configureSecret, operationFor, authenticatedActor, seal, unseal } = require('../src/services/audit/runtime');
const { buildTriggers, scopeRow } = require('../src/services/audit/schema');
const { canReadChange, publicChange, visibleRequest } = require('../src/services/audit/access');
const secret = 'audit-test-secret-that-is-at-least-32-characters';
configureSecret(secret);
const column = (name, key = '') => ({ TABLE_NAME: 'products', COLUMN_NAME: name, COLUMN_KEY: key, DATA_TYPE: 'varchar' });
const columns = [column('id', 'PRI'), column('owner_user_id'), column('name'), column('price'), column('password_hash'), column('phone'), column('remittance_last5'), { ...column('details'), DATA_TYPE: 'json' }];
const tables = new Map([['products', columns]]);
function fakePool() {
  const db = { rows: [], price: 10, changes: [], failAudit: false, failFinal: false, committed: 0, released: 0, failCommit: false, jobs: [] };
  async function query(sql, args = [], tx = null) {
    if (sql.includes('information_schema.COLUMNS')) return [[...columns], []];
    if (sql.includes('information_schema.TRIGGERS')) return [buildTriggers('products', columns, tables).map(t => ({ TRIGGER_NAME: t.name, ACTION_STATEMENT: t.body })), []];
    if (/^SELECT 1 FROM admin_audit_/.test(sql)) return [[], []];
    if (sql.startsWith('SELECT id,username,role FROM users')) return [[{ id: 'a', username: '管理員', role: 'ADMIN' }], []];
    if (sql.includes('INSERT INTO admin_audit_requests')) {
      if (db.failJournal) throw Object.assign(new Error('journal unavailable'), { code: 'ER_NO_SUCH_TABLE' });
      db.rows.push({ id: db.rows.length + 1, request_id: args[0], actor_id: args[1], status: 'pending' });
      return [{ insertId: db.rows.length }, []];
    }
    if (sql.includes('UPDATE admin_audit_requests')) {
      if (db.failFinal && sql.includes('actor_id=')) throw new Error('audit finalize unavailable');
      if (sql.includes('actor_id=')) Object.assign(db.rows.at(-1), { actor_id: args[0], status: args[5], error_code: args[7] });
      else Object.assign(db.rows.at(-1), { status: args[0], error_code: args[1] });
      return [{ affectedRows: 1 }, []];
    }
    if (/^UPDATE products/.test(sql)) {
      if (db.failAudit) throw new Error('AUDIT_LOG_UNAVAILABLE');
      if (tx) { tx.price = args[0]; tx.changed = true; } else db.price = args[0];
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('INSERT INTO admin_audit_jobs')) { tx.jobs.push(args); return [{ insertId: 1 }, []]; }
    if (sql.startsWith('SELECT id,kind,payload,status,request_id FROM admin_audit_jobs')) return [db.jobs.map((job, i) => ({ id: i + 1, kind: job[1], payload: job[2], status: job.status || 'pending' })).filter(job => job.kind === 'file-write'), []];
    if (sql.includes('FROM admin_audit_jobs j')) return [db.jobs.map((job, i) => ({ id: i + 1, request_id: job[0], kind: job[1], payload: job[2], status: job.status || 'pending' })).filter(job => job.status === 'pending'), []];
    if (sql.startsWith('SELECT status FROM admin_audit_jobs')) return [[{ status: db.jobs[args[0] - 1]?.status || 'pending' }], []];
    if (sql.startsWith('UPDATE admin_audit_jobs')) {
      if (db.failJobCompletion && sql.includes("status='success'")) throw new Error('completion write unavailable');
      const id = args.at(-1); const job = db.jobs[id - 1];
      if (sql.includes("status='processing'")) { if (job.status && job.status !== 'pending') return [{ affectedRows: 0 }, []]; job.status = 'processing'; }
      else { job.status = sql.includes("status='success'") ? 'success' : 'failed'; job[2] = null; }
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('SELECT price')) return [[{ price: tx?.price ?? db.price }], []];
    if (/^(SET|SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/.test(sql)) return [{ affectedRows: 0 }, []];
    throw new Error(`Unhandled fake query: ${sql}`);
  }
  const pool = { query: (sql, args) => query(sql, args), execute: (sql, args) => query(sql, args), async getConnection() {
    const tx = { price: db.price, changed: false, jobs: [] };
    return { query: (sql, args) => query(sql, args, tx), execute: (sql, args) => query(sql, args, tx),
      async beginTransaction() { tx.price = db.price; },
      async commit() { if (db.failCommit) throw new Error('connection lost'); db.price = tx.price; db.jobs.push(...tx.jobs); db.committed++; },
      async rollback() { tx.price = db.price; tx.jobs = []; },
      release() { db.released++; }, destroy() { db.released++; },
    };
  } };
  return { pool, db };
}
async function scenario(t, handler, setup = () => {}) {
  const { pool, db } = fakePool(); setup(db);
  const audit = installAudit(pool); assert.equal(await audit.check(), true);
  const app = express(); app.use(express.json()); app.use(audit.middleware({ extractToken: req => req.headers.authorization?.replace('Bearer ', '') }));
  app.post('/admin/test', handler(pool, db));
  app.post('/login', handler(pool, db));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (route = '/admin/test') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: 'POST', headers: { authorization: `Bearer ${jwt.sign({ id: 'a' }, secret)}` } });
    return { status: response.status, cookie: response.headers.get('set-cookie'), body: await response.json() };
  };
  return { request, db, audit, pool };
}
test('triggers capture allowlisted before/after snapshots and survive parent deletion', () => {
  const triggers = buildTriggers('products', columns, tables);
  assert.equal(triggers.length, 3);
  const update = triggers[1].sql;
  assert.match(update, /OLD\.`price`/); assert.match(update, /NEW\.`price`/);
  // Field names can be recorded as changed, but their values must never be serialized.
  for (const forbidden of ['password_hash', 'phone', 'remittance_last5', 'details']) assert.ok(!update.includes("'" + forbidden + "', OLD." + String.fromCharCode(96) + forbidden));
  assert.match(update, /SIGNAL SQLSTATE '45000'/);
  const migration = fs.readFileSync(path.join(__dirname, '../../Database/migrations/058_admin_audit.sql'), 'utf8');
  assert.doesNotMatch(migration, /REFERENCES\s+`?(?:users|products|orders)/i);
});
test('request commit gates response and nested domain leases share the transaction', async t => {
  const { request, db } = await scenario(t, pool => async (req, res) => {
    const conn = await pool.getConnection(); await conn.beginTransaction();
    await conn.query('UPDATE products SET price=?', [25]); await conn.commit(); conn.release();
    assert.equal(db.price, 10, 'domain commit must not escape outer audit commit');
    res.json({ ok: true });
  });
  assert.equal((await request()).status, 200); assert.equal(db.price, 25); assert.equal(db.rows[0].status, 'success'); assert.equal(db.released, 1);
});
test('caught trigger error poisons the entire request and strips auth cookies', async t => {
  const { request, db } = await scenario(t, pool => async (req, res) => {
    try { await pool.query('UPDATE products SET price=?', [99]); } catch (_) {}
    res.cookie('auth_token', 'should-not-escape'); res.json({ ok: true });
  }, db => { db.failAudit = true; });
  const response = await request(); assert.equal(response.status, 503); assert.equal(response.body.code, 'AUDIT_LOG_UNAVAILABLE');
  assert.equal(response.cookie, null); assert.equal(db.price, 10);
});
test('journal completion failure rolls back already changed rows', async t => {
  const { request, db } = await scenario(t, pool => async (req, res) => { await pool.query('UPDATE products SET price=?', [99]); res.json({ ok: true }); }, db => { db.failFinal = true; });
  assert.equal((await request()).status, 503); assert.equal(db.price, 10);
});
test('ordinary business failure rolls back while preserving failed request', async t => {
  const { request, db } = await scenario(t, pool => async (req, res) => { await pool.query('UPDATE products SET price=?', [99]); res.status(409).json({ ok: false, code: 'CONFLICT' }); });
  assert.equal((await request()).status, 409); assert.equal(db.price, 10); assert.equal(db.rows[0].status, 'failed');
});
test('login is attributed only after credential verification', async t => {
  const { request, db } = await scenario(t, () => async (req, res) => { res.status(401).json({ ok: false, code: 'AUTH_INVALID_CREDENTIALS' }); });
  await request('/login'); assert.equal(db.rows[0].actor_id, null);
});
test('verified login journal failure prevents credentials from being returned', async t => {
  const { request, db } = await scenario(t, () => async (req, res) => { authenticatedActor({ id: 'verified-user', role: 'ADMIN' }); res.cookie('auth_token', 'private-token'); res.json({ ok: true, data: { token: 'private-token' } }); }, db => { db.failFinal = true; });
  const response = await request('/login'); assert.equal(response.status, 503); assert.equal(response.cookie, null); assert.ok(!JSON.stringify(response.body).includes('private-token')); assert.equal(db.rows[0].status, 'failed');
});
test('uncertain commit is pending, never incorrectly reported as confirmed failure', async t => {
  const { request, db } = await scenario(t, () => (req, res) => res.json({ ok: true }), db => { db.failCommit = true; });
  assert.equal((await request()).status, 503); assert.equal(db.rows[0].status, 'pending'); assert.equal(db.rows[0].error_code, 'AUDIT_COMMIT_UNCONFIRMED');
});
test('all managed mutations and GET exports/auth are covered, normal reads are excluded', () => {
  const routes = fs.readdirSync(path.join(__dirname, '../src/routes')).filter(f => f.endsWith('.js'));
  let count = 0;
  for (const file of routes) {
    const source = fs.readFileSync(path.join(__dirname, '../src/routes', file), 'utf8');
    for (const match of source.matchAll(/router\.(post|put|patch|delete)\(['"`]([^'"`]+)['"`]/g)) {
      const route = match[2];
      if (/^\/(admin|provider|driver|delivery-point|coach)\b/.test(route)) {
        assert.equal(operationFor(match[1].toUpperCase(), route, true), true, `${file} ${route}`); count++;
      }
    }
  }
  assert.ok(count > 100);
  assert.equal(operationFor('GET', '/admin/users'), false);
  assert.equal(operationFor('GET', '/admin/users/a/export'), true);
  assert.equal(operationFor('GET', '/auth/magic_link'), true);
  assert.equal(operationFor('GET', '/auth/google/callback'), true);
  assert.equal(operationFor('POST', '/me/password', true), true);
});
test('external job payload is encrypted and authenticated', () => {
  const payload = { to: 'private@example.test', text: 'secret mail content' };
  const encoded = seal(payload); assert.ok(!encoded.includes(payload.to)); assert.deepEqual(unseal(encoded), payload);
  const bytes = Buffer.from(encoded, 'base64'); bytes[35] ^= 1; assert.throws(() => unseal(bytes.toString('base64')));
});
function accessContext(live, membership = null) {
  const courseCols = columns.map(c => ({ ...c, TABLE_NAME: 'course_products' }));
  return { audit: { tables: new Map([['course_products', courseCols], ['products', columns]]), raw: { async query(sql) {
    if (sql.includes('course_staff_memberships')) return [membership ? [membership] : []];
    return live ? [[{ scope: live }]] : [[]];
  } } } };
}
const change = { resource_table: 'course_products', resource_id: '1', operation: 'UPDATE', before_scope: { resolved_owner_id: 'owner-a' }, after_scope: { resolved_owner_id: 'owner-a' } };
test('provider role never grants another tenant access', async () => {
  const ctx = accessContext({ resolved_owner_id: 'owner-a' });
  assert.equal(await canReadChange(ctx, { id: 'owner-b', role: 'SERVICE_PROVIDER' }, change), false);
  assert.equal(await canReadChange(ctx, { id: 'owner-a', role: 'SERVICE_PROVIDER' }, change), true);
});
test('membership revocation, ownership transfer and deleted resource deny historical access', async () => {
  const user = { id: 'staff', role: 'USER' };
  assert.equal(await canReadChange(accessContext({ resolved_owner_id: 'owner-a' }, { role: 'ops', status: 'active' }), user, change), true);
  assert.equal(await canReadChange(accessContext({ resolved_owner_id: 'owner-a' }), user, change), false);
  assert.equal(await canReadChange(accessContext({ resolved_owner_id: 'owner-b' }, { role: 'ops', status: 'active' }), user, change), false);
  assert.equal(await canReadChange(accessContext(null), user, change), false);
  assert.equal(await canReadChange(accessContext(null), { role: 'ADMIN' }, change), true);
});
test('diff response strips sensitive fields even from stale snapshots', () => {
  const result = publicChange({ id: 1, before_json: { price: 10, password_hash: 'SECRET' }, after_json: { price: 15, email: 'SECRET' } });
  assert.deepEqual(result.differences, [{ field: 'price', before: 10, after: 15 }]); assert.ok(!JSON.stringify(result).includes('SECRET'));
});
test('mixed-tenant batches omit hidden changes, aggregate counts, status and jobs', async () => {
  const a = { ...change, id: 1, resource_id: '1' };
  const b = { ...change, id: 2, resource_id: '2', before_scope: { resolved_owner_id: 'owner-b' }, after_scope: { resolved_owner_id: 'owner-b' } };
  const ctx = accessContext({ resolved_owner_id: 'owner-a' });
  const query = ctx.audit.raw.query;
  ctx.audit.raw.query = async (sql, args) => sql.includes('FROM admin_audit_changes') ? [[a, b]] : query(sql, args);
  const result = await visibleRequest(ctx, { id: 'owner-a', role: 'SERVICE_PROVIDER' }, { id: 1, actor_id: 'admin', status: 'partial', module: 'courses', error_code: 'OTHER_TENANT_ERROR' }, { detail: true });
  assert.equal(result.changes.length, 1); assert.equal(result.visibleChangeCount, 1);
  assert.equal(result.status, 'success'); assert.equal(result.resultScope, 'visible'); assert.equal(result.errorCode, null); assert.equal(result.jobs, undefined);
  assert.equal(result.changes[0].resourceId, '1');
});
test('coach loses access when reassigned and cannot inspect catalog changes', async () => {
  const ctx = accessContext({ resolved_owner_id: 'owner-a', resolved_coach_id: 'coach-a' }, { role: 'coach', status: 'active' });
  assert.equal(await canReadChange(ctx, { id: 'coach-a', role: 'COACH' }, change), false);
});
test('outbox is durable at commit, never sends before commit, and rolls back with business failure', async t => {
  const { deferEffect } = require('../src/services/audit/runtime');
  const { request, db } = await scenario(t, () => async (req, res) => {
    assert.equal(await deferEffect('mail', { to: 'private@example.test' }), true);
    assert.equal(db.jobs.length, 0);
    res.json({ ok: true });
  });
  await request(); assert.equal(db.jobs.length, 1); assert.equal(unseal(db.jobs[0][2]).to, 'private@example.test');
  const other = await scenario(t, () => async (req, res) => {
    await deferEffect('mail', { to: 'private@example.test' }); res.status(409).json({ ok: false });
  });
  await other.request(); assert.equal(other.db.jobs.length, 0);
});
test('request context never contaminates a subsequent unrelated pool query', async t => {
  const { request, db, pool } = await scenario(t, () => (req, res) => res.json({ ok: true }));
  await request(); await pool.query('UPDATE products SET price=?', [77]); assert.equal(db.price, 77);
});
test('new schema DDL is rejected inside management requests without implicit commits', async t => {
  const { request, db } = await scenario(t, pool => async (req, res) => {
    await pool.query('UPDATE products SET price=?', [90]);
    try { await pool.query('CREATE TABLE new_sensitive_table (id INT)'); } catch (_) {}
    res.json({ ok: true });
  });
  assert.equal((await request()).status, 503); assert.equal(db.price, 10);
});
test('batch statuses distinguish all-failed requests from partial completion', () => {
  const { batchStatus } = require('../src/services/audit/runtime');
  assert.equal(batchStatus({ items: [{ ok: false }, { ok: true }] }), 'partial');
  assert.equal(batchStatus({ items: [{ ok: false }, { ok: false }] }), 'failed');
  assert.equal(batchStatus({ items: [{ ok: true, replayed: true }] }), 'success');
});
test('driver and delivery-point history requires both historical and current assignment', async () => {
  const cols = [...columns, column('driver_id'), column('delivery_point_id')];
  let live = { resolved_driver_id: 'driver-a', resolved_delivery_point_owner_id: 'point-a' };
  const ctx = { audit: { tables: new Map([['reservations', cols]]), raw: { async query() { return [[{ scope: live }]]; } } } };
  const row = { resource_table: 'reservations', resource_id: '1', operation: 'UPDATE', before_scope: { ...live }, after_scope: { ...live } };
  assert.equal(await canReadChange(ctx, { id: 'driver-a', role: 'DRIVER' }, row), true);
  assert.equal(await canReadChange(ctx, { id: 'point-a', role: 'DELIVERY_POINT' }, row), true);
  live = { resolved_driver_id: 'driver-b', resolved_delivery_point_owner_id: 'point-b' };
  assert.equal(await canReadChange(ctx, { id: 'driver-a', role: 'DRIVER' }, row), false);
  assert.equal(await canReadChange(ctx, { id: 'driver-b', role: 'DRIVER' }, row), false);
  assert.equal(await canReadChange(ctx, { id: 'point-b', role: 'DELIVERY_POINT' }, row), false);
});
test('post-commit invalidations run only after successful commit and never on rollback', async t => {
  const { afterCommit } = require('../src/services/audit/runtime');
  let invalidations = 0;
  const first = await scenario(t, pool => async (req, res) => {
    await pool.query('UPDATE products SET price=?', [55]);
    afterCommit(() => { assert.equal(first.db.price, 55); invalidations++; });
    res.json({ ok: true });
  });
  await first.request(); assert.equal(invalidations, 1);
  const failed = await scenario(t, () => (req, res) => { afterCommit(() => invalidations++); res.status(409).json({ ok: false }); });
  await failed.request(); assert.equal(invalidations, 1);
});
test('transfer codes never appear in snapshots while changed field names remain auditable', () => {
  const transfer = buildTriggers('ticket_transfers', [column('id', 'PRI'), column('code'), column('status')]);
  assert.ok(!transfer[1].sql.includes("'code', OLD.`code`"));
  assert.match(transfer[1].sql, /NOT\(OLD\.`code` <=> NEW\.`code`\)/);
  const result = publicChange({ id: 1, changed_fields: ['code', null, 'status'], before_json: { code: 'secret', status: 'pending' }, after_json: { code: 'other-secret', status: 'accepted' } });
  assert.deepEqual(result.redactedFields, ['code']); assert.ok(!JSON.stringify(result).includes('secret'));
});
test('route inventory covers anonymous management failures and authenticated shared operations', () => {
  const { routeInventory } = require('../scripts/audit-route-inventory');
  const inventory = routeInventory();
  assert.ok(inventory.length > 200);
  assert.equal(inventory.find(r => r.route === '/admin/users/:id/export')?.policy, 'always');
  assert.equal(inventory.find(r => r.route === '/reservations/:id/checklists/:stage')?.policy, 'verified-staff-only');
});
test('read API revalidates database role, hides foreign resources and validates pagination', async t => {
  const buildAuditRoutes = require('../src/routes/audit-logs');
  let role = 'SERVICE_PROVIDER';
  const queries = [];
  const ctx = {
    authRequired(req, res, next) { req.user = { id: 'provider-a', role: 'ADMIN' }; next(); },
    ok: (res, data) => res.json({ ok: true, data }),
    fail: (res, code, message, status) => res.status(status).json({ ok: false, code, message }),
    audit: { tables, raw: { async query(sql, args) {
      queries.push(sql);
      if (sql.includes('SELECT id, role FROM users')) return [[{ id: 'provider-a', role }]];
      if (sql.includes('course_staff_memberships')) return [[]];
      if (sql.includes('FROM admin_audit_requests')) return [[{ id: 99, actor_id: 'admin', module: 'products', status: 'partial', error_code: 'SECRET_FAILURE' }]];
      if (sql.includes('FROM admin_audit_changes')) return [[{ id: 1, request_id: 99, resource_table: 'products', resource_id: '1', operation: 'UPDATE', before_scope: { resolved_owner_id: 'provider-b' }, after_scope: { resolved_owner_id: 'provider-b' }, after_json: { name: 'hidden-tenant' } }]];
      if (sql.includes('FROM `products`')) return [[{ scope: { resolved_owner_id: 'provider-b' } }]];
      throw new Error('Unexpected audit read query');
    } } },
  };
  const app = express(); app.use(buildAuditRoutes(ctx));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/admin/audit-logs`;
  let response = await fetch(url + '/99'); assert.equal(response.status, 404);
  response = await fetch(url); const body = await response.json(); assert.deepEqual(body.data.items, []); assert.ok(!JSON.stringify(body).includes('SECRET_FAILURE'));
  response = await fetch(url + '?limit=101'); assert.equal(response.status, 400);
  response = await fetch(url + '?status=partial'); assert.equal(response.status, 200); assert.deepEqual((await response.json()).data.items, []);
  role = 'USER'; response = await fetch(url + '/99'); assert.equal(response.status, 403, 'stale ADMIN token must not authorize');
  assert.ok(queries.every(sql => /^SELECT/i.test(sql.trim())), 'read endpoints must not run lazy schema writes');
});
test('file uploads are staged privately, committed, then published before the successful response', async t => {
  const fsp = require('node:fs/promises'); const os = require('node:os');
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'leader-audit-files-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  let published = false;
  const storage = { STORAGE_ROOT: directory, resolveStoragePath: file => path.join(directory, file),
    async writeBuffer(file, buffer) { await fsp.writeFile(path.join(directory, file), buffer); published = true; return path.join(directory, file); },
    async deleteFile(file) { await fsp.rm(path.join(directory, file), { force: true }); },
  };
  const payload = Buffer.alloc(128 * 1024, 42);
  const { request, audit, db } = await scenario(t, () => async (req, res) => {
    await storage.writeBuffer('photo.png', payload);
    assert.equal(published, false);
    await assert.rejects(fsp.access(path.join(directory, 'photo.png')));
    res.json({ ok: true });
  });
  audit.registerEffects({ storage });
  const response = await request(); assert.equal(response.status, 200); assert.equal(published, true);
  assert.deepEqual(await fsp.readFile(path.join(directory, 'photo.png')), payload);
  assert.equal(db.jobs[0].status, 'success'); assert.equal(db.jobs[0][2], null);
  assert.deepEqual(await fsp.readdir(path.join(directory, '.audit-staging')), []);
});
test('post-commit file failure reports partial completion without pretending business rows rolled back', async t => {
  const fsp = require('node:fs/promises'); const os = require('node:os');
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'leader-audit-file-fail-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const storage = { STORAGE_ROOT: directory, resolveStoragePath: file => path.join(directory, file),
    async writeBuffer() { throw Object.assign(new Error('injected file failure'), { code: 'EACCES' }); },
  };
  const { request, audit, db } = await scenario(t, pool => async (req, res) => {
    await pool.query('UPDATE products SET price=?', [33]);
    await storage.writeBuffer('photo.png', Buffer.from('staged image'));
    res.json({ ok: true });
  });
  audit.registerEffects({ storage });
  const response = await request(); assert.equal(response.status, 503); assert.equal(response.body.committed, true);
  assert.equal(response.body.code, 'AUDIT_EXTERNAL_EFFECT_FAILED'); assert.equal(db.price, 33);
  assert.equal(db.rows[0].status, 'partial'); assert.equal(db.jobs[0].status, 'failed');
  assert.deepEqual(await fsp.readdir(path.join(directory, '.audit-staging')), []);
});
test('an unavailable request journal blocks management handlers before any side effect', async t => {
  let called = false;
  const { request, db } = await scenario(t, () => (req, res) => { called = true; res.json({ ok: true }); }, db => { db.failJournal = true; });
  const response = await request(); assert.equal(response.status, 503); assert.equal(called, false); assert.equal(db.price, 10);
});
test('parser failures before the audit middleware get a durable rejection without persisting body content', async () => {
  const { pool, db } = fakePool(); const audit = installAudit(pool);
  const req = { method: 'POST', path: '/admin/products', ip: '127.0.0.1' };
  assert.equal(await audit.recordRejected(req, { type: 'entity.parse.failed', body: 'secret password' }, { extractToken: () => null }), true);
  assert.equal(db.rows.length, 1); assert.equal(db.rows[0].actor_id, null); assert.ok(!JSON.stringify(db.rows).includes('secret password'));
});
test('mail delivery failures are persisted separately from successful business commits', async t => {
  let sent = 0;
  const transporter = { async sendMail() { sent++; throw Object.assign(new Error('SMTP unavailable'), { code: 'ECONNREFUSED' }); } };
  const { request, audit, db } = await scenario(t, () => async (req, res) => { await transporter.sendMail({ to: 'test@example.test', text: 'private content' }); assert.equal(sent, 0); res.json({ ok: true }); });
  audit.registerEffects({ transporter, storage: { STORAGE_ROOT: '/tmp', writeBuffer: async () => {}, resolveStoragePath: value => value } });
  assert.equal((await request()).status, 200); await audit.runJobs();
  assert.equal(sent, 1); assert.equal(db.jobs[0].status, 'failed'); assert.equal(db.rows[0].status, 'success'); assert.equal(db.jobs[0][2], null);
});
test('lost external-effect completion acknowledgement never causes automatic duplicate delivery', async t => {
  let sent = 0;
  const transporter = { async sendMail() { sent++; } };
  const { request, audit, db } = await scenario(t, () => async (req, res) => { await transporter.sendMail({ to: 'test@example.test' }); res.json({ ok: true }); });
  audit.registerEffects({ transporter, storage: { STORAGE_ROOT: '/tmp', writeBuffer: async () => {}, resolveStoragePath: value => value } });
  await request(); db.failJobCompletion = true;
  await assert.rejects(audit.runJobs(), /completion write unavailable/);
  assert.equal(db.jobs[0].status, 'processing');
  db.failJobCompletion = false; await audit.runJobs(); assert.equal(sent, 1);
});
