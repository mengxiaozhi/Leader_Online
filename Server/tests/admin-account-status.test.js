'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { attachAdminAccountStatuses, isAdminAccountStatusRequest, withAdminAccountStatuses } = require('../src/services/admin-account-status');

function fixture(users = []) {
  const queries = [];
  const pool = { async query(sql, ids) {
    assert.match(sql, /^SELECT id, username, email FROM users WHERE id IN \(/);
    queries.push({ sql, ids });
    return [users.filter(user => ids.includes(user.id))];
  } };
  return { pool, queries };
}
const deleted = { id: 'old-member', username: 'Deleted User', email: 'deleted+old-member+1792153663677@example.invalid' };
const active = { id: 'new-member', username: '會員', email: 'same@example.test' };

test('all managed service reads resolve the old immutable ID independently of a re-registered email', async () => {
  const { pool, queries } = fixture([deleted, active]);
  for (const path of ['/admin/orders', '/admin/tickets', '/admin/reservations', '/admin/courses/orders', '/admin/courses/tickets', '/admin/courses/bookings', '/admin/courses/students']) {
    const input = { items: [
      { id: 220, userId: deleted.id, buyerEmail: active.email, contactSnapshot: { email: active.email } },
      { id: 221, userId: active.id, buyerEmail: active.email },
    ], meta: { total: 2 }, summary: { total: 2 } };
    const before = structuredClone(input);
    const output = await attachAdminAccountStatuses(pool, input, { path });
    assert.deepEqual(output.items[0].accountRelations, [{ relation: 'account', status: 'deleted' }], path);
    assert.equal(output.items[0].accountDeleted, true);
    assert.equal(output.items[1].accountDeleted, false);
    assert.deepEqual(output.items[1].accountRelations, []);
    assert.deepEqual(input, before, 'cached or persistent input must remain untouched');
    assert.deepEqual(output.meta, before.meta);
    assert.equal(queries.at(-1).ids.length, 2);
    assert.deepEqual(output.items[0].contactSnapshot, before.items[0].contactSnapshot);
  }
});

test('catalogs, delivery point bindings, drivers and coaches identify the specific deleted relation', async () => {
  const { pool } = fixture([deleted, active]);
  const input = [
    { owner_user_id: deleted.id },
    { ownerUserId: deleted.id },
    { user_id: active.id, driver_id: deleted.id },
    { provider_user_id: deleted.id, provider: { id: deleted.id }, delivery_point: { owner_user_id: 'gone-owner' } },
    { providerUserId: active.id, coachUserId: deleted.id },
  ];
  const output = await attachAdminAccountStatuses(pool, input);
  assert.deepEqual(output[0].accountRelations, [{ relation: 'owner', status: 'deleted' }]);
  assert.deepEqual(output[1].accountRelations, output[0].accountRelations);
  assert.deepEqual(output[2].accountRelations, [{ relation: 'driver', status: 'deleted' }]);
  assert.deepEqual(output[3].accountRelations, [
    { relation: 'provider', status: 'deleted' }, { relation: 'deliveryPoint', status: 'missing' },
  ]);
  assert.deepEqual(output[4].accountRelations, [{ relation: 'coach', status: 'deleted' }]);
});

test('unlinked guest records and historical snapshots do not create false deletion markers', async () => {
  const { pool, queries } = fixture([active]);
  const output = await attachAdminAccountStatuses(pool, {
    items: [{ userId: null, buyerEmail: deleted.email }, { userId: active.id,
      details: { user_id: deleted.id }, contactSnapshot: { userId: deleted.id }, metadata: { userId: deleted.id },
    }],
  });
  assert.equal(output.items[0].accountRelations, undefined);
  assert.deepEqual(output.items[1].accountRelations, []);
  assert.deepEqual(queries[0].ids, [active.id]);
});

test('missing IDs are explicitly missing and do not masquerade as deleted accounts', async () => {
  const { pool } = fixture();
  const output = await attachAdminAccountStatuses(pool, [{ user_id: 'removed' }, { user_id: '' }, { ownerUserId: null }]);
  assert.deepEqual(output[0].accountRelations, [{ relation: 'account', status: 'missing' }]);
  assert.equal(output[0].accountDeleted, false);
  assert.equal(output[1].accountRelations, undefined);
  assert.equal(output[2].accountRelations, undefined);
});

test('root account IDs are used only for account directories, never resource IDs', async () => {
  const { pool, queries } = fixture([deleted]);
  const user = { id: deleted.id, username: deleted.username, email: deleted.email };
  const output = await attachAdminAccountStatuses(pool, { items: [user] }, { path: '/admin/users' });
  assert.equal(output.items[0].accountDeleted, true);
  const drivers = await attachAdminAccountStatuses(pool, [user], { path: '/provider/drivers' });
  assert.deepEqual(drivers[0].accountRelations, [{ relation: 'driver', status: 'deleted' }]);
  await attachAdminAccountStatuses(pool, [{ id: 'resource-id' }], { path: '/admin/events' });
  assert.equal(queries.length, 2);
});

test('account lookups are deduplicated and bounded to batches rather than one per row', async () => {
  const users = Array.from({ length: 205 }, (_, i) => ({ id: `user-${i}`, email: `member-${i}@example.test` }));
  const { pool, queries } = fixture(users);
  const rows = users.flatMap(user => [{ user_id: user.id }, { driverId: user.id }]);
  const output = await attachAdminAccountStatuses(pool, rows);
  assert.equal(output.length, 410);
  assert.deepEqual(queries.map(query => query.ids.length), [200, 5]);
});

test('enrichment runs only on authorized staff GET responses and leaves mutations and public reads unchanged', async () => {
  const { pool, queries } = fixture([deleted]);
  const calls = [];
  const ctx = withAdminAccountStatuses({ pool, ok: (_res, data) => calls.push(data), fail: () => assert.fail('unexpected failure') });
  const data = [{ user_id: deleted.id }];
  for (const req of [
    { method: 'GET', path: '/tickets/me', user: { id: 'member' } },
    { method: 'POST', path: '/admin/orders', user: { id: 'admin' } },
    { method: 'GET', path: '/admin/orders' },
    { method: 'GET', path: '/admin/tombstones', user: { id: 'admin' } },
    { method: 'GET', path: '/tasks/me', user: { id: 'member', role: 'USER' } },
  ]) {
    assert.equal(isAdminAccountStatusRequest(req), false);
    await ctx.ok({ req }, data);
    assert.equal(calls.at(-1), data);
  }
  assert.equal(queries.length, 0);
  await ctx.ok({ req: { method: 'GET', path: '/admin/tickets', user: { id: 'provider' } } }, data);
  assert.equal(queries.length, 1);
  assert.deepEqual(calls.at(-1)[0].accountRelations, [{ relation: 'account', status: 'deleted' }]);
  assert.equal(isAdminAccountStatusRequest({ method: 'GET', path: '/tasks/me', user: { id: 'driver', role: 'DRIVER' } }), true);
});

test('lookup failure is explicit rather than returning a clean-looking service list', async () => {
  const failures = [];
  const ctx = withAdminAccountStatuses({
    pool: { query: async () => { throw Object.assign(new Error('private DB error'), { code: 'DB_UNAVAILABLE' }); } },
    ok: () => assert.fail('must not send an unverified list'),
    fail: (_res, ...args) => failures.push(args),
  });
  await ctx.ok({ req: { method: 'GET', path: '/admin/products', user: { id: 'admin' } } }, [{ ownerUserId: deleted.id }]);
  assert.equal(failures[0][0], 'ACCOUNT_STATUS_LOOKUP_FAIL');
  assert.equal(failures[0][2], 500);
  assert.doesNotMatch(failures[0][1], /private DB error/);
});
