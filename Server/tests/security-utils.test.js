const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const storage = require('../storage');
const { parseImagePayload } = require('../src/utils/image-upload');
const {
  normalizeLocalRedirect,
  resolveJwtSecret,
} = require('../src/security/runtime-security');

test('production rejects a missing or weak JWT secret', () => {
  assert.throws(
    () => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'change_me' }),
    /JWT_SECRET/
  );
  assert.equal(
    resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(32) }),
    'a'.repeat(32)
  );
});

test('redirects remain on the local application origin', () => {
  assert.equal(normalizeLocalRedirect('/store?tab=orders'), '/store?tab=orders');
  assert.equal(normalizeLocalRedirect('//evil.example/path'), '/store');
  assert.equal(normalizeLocalRedirect('/\\evil.example/path'), '/store');
  assert.equal(normalizeLocalRedirect('https://evil.example'), '/store');
});

test('image payload MIME must match its file signature', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const parsed = parseImagePayload({ mime: 'image/png', base64: png.toString('base64') });
  assert.equal(parsed.mime, 'image/png');
  assert.deepEqual(parsed.buffer, png);
  assert.throws(
    () => parseImagePayload({ mime: 'image/jpeg', base64: png.toString('base64') }),
    (error) => error?.code === 'UNSUPPORTED_IMAGE' && error?.status === 415
  );
});

test('stored paths cannot escape the configured storage root', () => {
  assert.equal(storage.toSafeRelativePath('event_covers/1/cover.png'), 'event_covers/1/cover.png');
  assert.equal(storage.toSafeRelativePath('../package.json'), '');
  assert.equal(storage.toSafeRelativePath(path.resolve(storage.STORAGE_ROOT, '../package.json')), '');
});
