const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const MIME_ALIASES = new Map([
  ['image/jpg', 'image/jpeg'],
  ['image/heif', 'image/heic'],
]);

function normalizeMime(value) {
  const normalized = String(value || '').trim().toLowerCase().split(';', 1)[0];
  return MIME_ALIASES.get(normalized) || normalized;
}

function detectImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  const signature6 = buffer.subarray(0, 6).toString('ascii');
  if (signature6 === 'GIF87a' || signature6 === 'GIF89a') return 'image/gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brands = buffer.subarray(8, Math.min(buffer.length, 40)).toString('ascii');
    if (/avif|avis/.test(brands)) return 'image/avif';
    if (/heic|heix|hevc|hevx|mif1|msf1/.test(brands)) return 'image/heic';
  }
  return null;
}

function parseImagePayload(body = {}, { maxBytes = MAX_IMAGE_BYTES } = {}) {
  let declaredMime = '';
  let encoded = '';
  if (typeof body.dataUrl === 'string' && body.dataUrl.startsWith('data:')) {
    const match = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i.exec(body.dataUrl);
    if (!match) throw Object.assign(new Error('dataUrl 格式錯誤'), { code: 'VALIDATION_ERROR', status: 400 });
    declaredMime = normalizeMime(match[1]);
    encoded = match[2];
  } else if (body.mime && body.base64) {
    declaredMime = normalizeMime(body.mime);
    encoded = String(body.base64);
  } else {
    throw Object.assign(new Error('缺少上傳內容'), { code: 'VALIDATION_ERROR', status: 400 });
  }

  const buffer = Buffer.from(encoded.replace(/\s+/g, ''), 'base64');
  if (!buffer.length) throw Object.assign(new Error('檔案為空'), { code: 'VALIDATION_ERROR', status: 400 });
  if (buffer.length > maxBytes) throw Object.assign(new Error('檔案過大（>10MB）'), { code: 'PAYLOAD_TOO_LARGE', status: 413 });
  const detectedMime = detectImageMime(buffer);
  if (!detectedMime || detectedMime !== declaredMime) {
    throw Object.assign(new Error('僅支援內容與格式一致的 JPEG、PNG、GIF、WebP、AVIF 或 HEIC 圖片'), {
      code: 'UNSUPPORTED_IMAGE',
      status: 415,
    });
  }
  return { buffer, mime: detectedMime };
}

module.exports = {
  MAX_IMAGE_BYTES,
  detectImageMime,
  normalizeMime,
  parseImagePayload,
};
