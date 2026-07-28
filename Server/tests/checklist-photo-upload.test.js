const test = require('node:test');
const assert = require('node:assert/strict');

const {
  checklistPhotoPolicy,
  isChecklistPhotoLimitReached,
  parseChecklistPhotoRequest,
} = require('../src/utils/checklist-photo-upload');

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

function jpegBuffer(size = 16) {
  const buffer = Buffer.alloc(size);
  buffer.set([0xff, 0xd8, 0xff], 0);
  return buffer;
}

function parseDataUri(value) {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(String(value || ''));
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], 'base64') };
}

test('multipart parser accepts a magic-byte-valid JPEG exactly at the 8 MiB boundary', () => {
  const result = parseChecklistPhotoRequest({
    file: {
      buffer: jpegBuffer(MAX_BYTES),
      mimetype: 'image/jpeg',
      originalname: 'inspection.jpg',
    },
  }, {
    allowedMimeTypes: ALLOWED,
    maxBytes: MAX_BYTES,
    parseDataUri,
  });

  assert.equal(result.error, undefined);
  assert.equal(result.buffer.length, MAX_BYTES);
  assert.equal(result.mime, 'image/jpeg');
  assert.equal(result.name, 'inspection.jpg');
});

test('multipart parser rejects oversized, spoofed, and unsupported images', () => {
  const oversized = parseChecklistPhotoRequest({
    file: { buffer: jpegBuffer(MAX_BYTES + 1), mimetype: 'image/jpeg' },
  }, { allowedMimeTypes: ALLOWED, maxBytes: MAX_BYTES, parseDataUri });
  const spoofed = parseChecklistPhotoRequest({
    file: { buffer: jpegBuffer(), mimetype: 'image/png' },
  }, { allowedMimeTypes: ALLOWED, maxBytes: MAX_BYTES, parseDataUri });
  const gif = Buffer.from('GIF89a000000', 'ascii');
  const unsupported = parseChecklistPhotoRequest({
    file: { buffer: gif, mimetype: 'image/gif' },
  }, { allowedMimeTypes: ALLOWED, maxBytes: MAX_BYTES, parseDataUri });

  assert.deepEqual(oversized.error, ['FILE_TOO_LARGE', '照片尺寸過大，請壓縮後再上傳', 413]);
  assert.equal(spoofed.error[0], 'UNSUPPORTED_TYPE');
  assert.equal(spoofed.error[2], 415);
  assert.equal(unsupported.error[0], 'UNSUPPORTED_TYPE');
});

test('legacy JSON Data URL upload remains supported with the same magic-byte checks', () => {
  const jpeg = jpegBuffer();
  const result = parseChecklistPhotoRequest({
    body: {
      data: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
      name: 'legacy.jpg',
    },
  }, {
    allowedMimeTypes: ALLOWED,
    maxBytes: MAX_BYTES,
    parseDataUri,
  });

  assert.equal(result.error, undefined);
  assert.equal(result.mime, 'image/jpeg');
  assert.equal(result.name, 'legacy.jpg');
});

test('photo policy is canonical and the seventh photo is rejected at a six-photo limit', () => {
  const policy = checklistPhotoPolicy({
    allowedMimeTypes: ALLOWED,
    maxBytes: MAX_BYTES,
    maxCount: 6,
  });

  assert.deepEqual(policy, {
    maxCount: 6,
    maxBytes: MAX_BYTES,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
  });
  assert.equal(isChecklistPhotoLimitReached(5, 6), false);
  assert.equal(isChecklistPhotoLimitReached(6, 6), true);
});
