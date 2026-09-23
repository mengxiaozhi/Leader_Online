const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');
const { finished } = require('node:stream/promises');
const buildCatalogRoutes = require('../src/routes/catalog');

class Response extends Writable {
  constructor() { super(); this.statusCode = 200; this.headers = {}; this.chunks = []; }
  _write(chunk, encoding, next) { this.chunks.push(chunk); next(); }
  status(code) { this.statusCode = code; return this; }
  setHeader(key, value) { this.headers[key.toLowerCase()] = value; }
  json(value) { this.body = value; this.end(JSON.stringify(value)); return this; }
  redirect(code, url) { this.status(code); this.setHeader('Location', url); this.end(); }
}

function harness({ storageEnabled = true } = {}) {
  const events = new Map();
  const files = new Map();
  const writes = [];
  const deletes = [];
  const guard = (req, res, next) => {
    if (!req.user) return res.status(401).end();
    if (!['ADMIN', 'EDITOR', 'SERVICE_PROVIDER'].includes(req.user.role)) return res.status(403).end();
    return next();
  };
  const ctx = {
    eventManagerOnly: guard, productManagerOnly: guard, adminOrEditorOnly: guard, deliveryPointOnly: guard,
    isADMIN: role => role === 'ADMIN', isEDITOR: role => role === 'EDITOR',
    isEventCoverStorageEnabled: () => storageEnabled,
    normalizeUserId: value => String(value || ''),
    parsePositiveInt: (value, fallback) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback,
    getEventById: async id => events.get(Number(id)),
    ensureEventExclusiveColumn: async () => true, ensureEventListingStatusColumn: async () => true,
    ensureProductManagementSchema: async () => true,
    normalizeListingStatus: (value, fallback) => value || fallback,
    normalizeDateTimeInput: value => value,
    LISTING_STATUS_PUBLISHED: 'published',
    invalidateEventCaches: () => {},
    generateEventCode: async () => 'EV42',
    buildEventCoverStoragePath: id => `events/${id}/cover-${files.size}.png`,
    ok: (res, data) => res.json({ ok: true, data }),
    fail: (res, code, message, status) => res.status(status).json({ ok: false, code, message }),
    storage: {
      toSafeRelativePath: path => path?.startsWith('events/') && !path.includes('..') ? path : null,
      normalizeRelativePath: path => path, mimeToExtension: () => 'png',
      fileExists: async path => files.has(path),
      getFileStat: async path => ({ size: files.get(path).length }),
      createReadStream: path => Readable.from([files.get(path)]),
      writeBuffer: async (path, data) => { files.set(path, data); writes.push(path); },
      deleteFile: async path => { files.delete(path); deletes.push(path); },
    },
    pool: { query: async (sql, params) => {
      const id = Number(params.at(-1));
      if (sql.startsWith('INSERT INTO events')) {
        const keys = ['code', 'title', 'starts_at', 'ends_at', 'deadline', 'location', 'description', 'cover', 'rules', 'owner_user_id', 'is_exclusive', 'listing_status'];
        events.set(42, { id: 42, ...Object.fromEntries(keys.map((key, i) => [key, params[i]])) });
        return [{ insertId: 42 }];
      }
      if (sql.startsWith('SELECT')) {
        const event = events.get(Number(params[0]));
        if (!event || (sql.includes("listing_status = 'published'") && event.listing_status !== 'published')) return [[]];
        return [[{ ...event }]];
      }
      if (sql.startsWith('UPDATE events')) {
        const event = events.get(id);
        if (!event) return [{ affectedRows: 0 }];
        if (sql.includes('cover_type = ?, cover_path = ?')) {
          Object.assign(event, { cover: null, cover_type: params[0], cover_path: params[1], cover_data: null });
        } else if (sql.includes('cover_type = NULL')) {
          Object.assign(event, { cover: null, cover_type: null, cover_path: null, cover_data: null });
        } else if (sql.includes('listing_status = ?')) {
          event.listing_status = params[0];
        } else assert.fail(`unexpected update: ${sql}`);
        return [{ affectedRows: 1 }];
      }
      assert.fail(`unexpected SQL: ${sql}`);
    } },
  };
  const router = buildCatalogRoutes(ctx);
  async function request(method, path, { id = 42, user = { role: 'ADMIN', id: 'admin' }, body = {} } = {}) {
    const route = router.stack.find(item => item.route?.path === path && item.route.methods[method])?.route;
    assert.ok(route, `${method} ${path}`);
    const req = { params: { id: String(id) }, user, body };
    const res = new Response();
    for (let i = 0; i < route.stack.length; i++) {
      let next = false;
      await route.stack[i].handle(req, res, () => { next = true; });
      if (!next) break;
    }
    await finished(res);
    res.bytes = Buffer.concat(res.chunks);
    return res;
  }
  return { events, files, writes, deletes, request };
}
const adminPath = '/admin/events/:id/cover';
const publicPath = '/events/:id/cover';

test('unpublished product covers require authentication and current ownership', async () => {
  const h = harness();
  h.events.set(42, { id: 42, owner_user_id: 'provider', listing_status: 'draft', cover_data: Buffer.from('product-image'), cover_type: 'image/png' });
  const path = '/admin/products/:id/cover';
  for (const user of [{ role: 'ADMIN', id: 'a' }, { role: 'EDITOR', id: 'e' }, { role: 'SERVICE_PROVIDER', id: 'provider' }]) {
    const response = await h.request('get', path, { user });
    assert.equal(response.statusCode, 200);
    assert.equal(response.bytes.toString(), 'product-image');
    assert.equal(response.headers['cache-control'], 'private, no-store');
  }
  for (const [user, status] of [[null, 401], [{ role: 'USER', id: 'provider' }, 403], [{ role: 'SERVICE_PROVIDER', id: 'other' }, 403]]) {
    assert.equal((await h.request('get', path, { user })).statusCode, status);
  }
  assert.equal((await h.request('get', '/products/:id/cover')).statusCode, 404);
  assert.equal((await h.request('get', path, { id: 999 })).statusCode, 404);
});

test('draft covers require management role and owner scope before reading storage', async () => {
  const h = harness();
  h.events.set(42, { id: 42, owner_user_id: 'provider', listing_status: 'draft', cover_data: Buffer.from('image'), cover_type: 'image/png' });
  for (const user of [{ role: 'ADMIN', id: 'a' }, { role: 'EDITOR', id: 'e' }, { role: 'SERVICE_PROVIDER', id: 'provider' }]) {
    const res = await h.request('get', adminPath, { user });
    assert.equal(res.statusCode, 200);
    assert.equal(res.bytes.toString(), 'image');
    assert.equal(res.headers['cache-control'], 'private, no-store');
  }
  for (const [user, status] of [[null, 401], [{ role: 'USER', id: 'provider' }, 403], [{ role: 'SERVICE_PROVIDER', id: 'other' }, 403]]) {
    assert.equal((await h.request('get', adminPath, { user })).statusCode, status);
  }
  assert.equal((await h.request('get', publicPath)).statusCode, 404);
  assert.equal((await h.request('get', adminPath, { id: 'invalid' })).statusCode, 404);
  assert.equal((await h.request('get', adminPath, { id: 999 })).statusCode, 404);
});

test('shared cover reader supports files, legacy blobs, URLs, and missing images with route-specific caching', async () => {
  for (const storageEnabled of [true, false]) {
    const h = harness({ storageEnabled });
    const event = { id: 42, listing_status: 'published', cover_type: 'image/png', cover_path: 'events/42/a.png', cover_data: Buffer.from('legacy'), cover: 'https://images.example/a.png' };
    h.events.set(42, event);
    h.files.set(event.cover_path, Buffer.from('file'));
    for (const path of [adminPath, publicPath]) {
      const res = await h.request('get', path);
      assert.equal(res.bytes.toString(), storageEnabled ? 'file' : 'legacy');
      assert.equal(res.headers['content-type'], 'image/png');
      assert.equal(res.headers['cache-control'], path === adminPath ? 'private, no-store' : 'public, max-age=86400');
    }
    h.files.clear();
    assert.equal((await h.request('get', adminPath)).bytes.toString(), 'legacy');
    event.cover_path = '../../private';
    assert.equal((await h.request('get', adminPath)).bytes.toString(), 'legacy');
    event.cover_data = null;
    const redirect = await h.request('get', adminPath);
    assert.equal(redirect.statusCode, 302);
    assert.equal(redirect.headers.location, event.cover);
    assert.equal(redirect.headers['cache-control'], 'private, no-store');
    assert.equal((await h.request('get', publicPath)).headers['cache-control'], undefined);
    event.cover = null;
    assert.equal((await h.request('get', adminPath)).statusCode, 404);
    assert.equal((await h.request('get', publicPath)).headers['cache-control'], undefined);
  }
});

test('create draft, upload, publish/draft/publish preserves bytes; replacement and explicit deletion update them', async () => {
  const h = harness();
  const created = await h.request('post', '/admin/events', { body: { title: 'Draft Event', starts_at: '2026-12-01 09:00:00', ends_at: '2026-12-01 18:00:00', listing_status: 'draft' } });
  assert.equal(created.body.ok, true, JSON.stringify(created.body));
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5z8AAAAASUVORK5CYII=';
  const uploaded = await h.request('post', '/admin/events/:id/cover_json', { body: { dataUrl: `data:image/png;base64,${png}` } });
  assert.equal(uploaded.body.ok, true, JSON.stringify(uploaded.body));
  const originalPath = h.events.get(42).cover_path;
  for (const status of ['published', 'draft', 'published']) {
    const changed = await h.request('patch', '/admin/events/:id', { body: { listing_status: status } });
    assert.equal(changed.body.ok, true);
    assert.equal(h.events.get(42).cover_path, originalPath);
    assert.deepEqual((await h.request('get', adminPath)).bytes, Buffer.from(png, 'base64'));
    assert.equal((await h.request('get', publicPath)).statusCode, status === 'published' ? 200 : 404);
  }
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.deletes, []);
  await h.request('post', '/admin/events/:id/cover_json', { body: { dataUrl: `data:image/png;base64,${png}` } });
  assert.notEqual(h.events.get(42).cover_path, originalPath);
  assert.deepEqual(h.deletes, [originalPath]);
  await h.request('delete', adminPath);
  assert.equal((await h.request('get', adminPath)).statusCode, 404);
  assert.equal(h.events.get(42).cover_path, null);
});
