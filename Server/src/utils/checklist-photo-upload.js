const multer = require('multer');
const { detectImageMime, normalizeMime } = require('./image-upload');

function normalizedAllowedMimeTypes(allowedMimeTypes) {
  const values = allowedMimeTypes instanceof Set
    ? Array.from(allowedMimeTypes)
    : (Array.isArray(allowedMimeTypes) ? allowedMimeTypes : []);
  return new Set(values.map(normalizeMime).filter(Boolean));
}

function createChecklistPhotoUploadMiddleware({
  maxBytes,
  fail,
} = {}) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      files: 1,
      fileSize: Number(maxBytes),
    },
  }).single('photo');
  return (req, res, next) => {
    if (!req.is('multipart/form-data')) return next();
    return upload(req, res, (error) => {
      if (!error) return next();
      if (error?.code === 'LIMIT_FILE_SIZE') {
        return fail(res, 'FILE_TOO_LARGE', '照片尺寸過大，請壓縮後再上傳', 413);
      }
      return fail(res, 'INVALID_IMAGE', '照片上傳格式不正確', 400);
    });
  };
}

function parseChecklistPhotoRequest(req, {
  allowedMimeTypes,
  maxBytes,
  parseDataUri,
} = {}) {
  const allowed = normalizedAllowedMimeTypes(allowedMimeTypes);
  const maximum = Number(maxBytes);
  if (req?.file) {
    const buffer = req.file.buffer;
    const declaredMime = normalizeMime(req.file.mimetype);
    const detectedMime = detectImageMime(buffer);
    if (!Buffer.isBuffer(buffer) || !buffer.length) {
      return { error: ['INVALID_IMAGE', '照片格式不正確，請重新拍攝上傳', 400] };
    }
    if (buffer.length > maximum) {
      return { error: ['FILE_TOO_LARGE', '照片尺寸過大，請壓縮後再上傳', 413] };
    }
    if (!declaredMime || !allowed.has(declaredMime)) {
      return { error: ['UNSUPPORTED_TYPE', '僅支援 JPG、PNG、WEBP、HEIC 圖片', 415] };
    }
    if (!detectedMime || detectedMime !== declaredMime) {
      return { error: ['UNSUPPORTED_TYPE', '圖片內容與檔案格式不一致', 415] };
    }
    return {
      buffer,
      mime: detectedMime,
      name: String(req.file.originalname || '').slice(0, 255) || null,
    };
  }

  if (typeof parseDataUri !== 'function') {
    return { error: ['INVALID_IMAGE', '照片格式不正確，請重新拍攝上傳', 400] };
  }
  const { data, name } = req?.body || {};
  const parsed = parseDataUri(data);
  if (!parsed) {
    return { error: ['INVALID_IMAGE', '照片格式不正確，請重新拍攝上傳', 400] };
  }
  const normalizedMime = normalizeMime(parsed.mime);
  if (!allowed.has(normalizedMime)) {
    return { error: ['UNSUPPORTED_TYPE', '僅支援 JPG、PNG、WEBP、HEIC 圖片', 415] };
  }
  if (detectImageMime(parsed.buffer) !== normalizedMime) {
    return { error: ['UNSUPPORTED_TYPE', '圖片內容與檔案格式不一致', 415] };
  }
  if (parsed.buffer.length > maximum) {
    return { error: ['FILE_TOO_LARGE', '照片尺寸過大，請壓縮後再上傳', 413] };
  }
  return {
    buffer: parsed.buffer,
    mime: normalizedMime,
    name: typeof name === 'string' ? name.slice(0, 255) : null,
  };
}

function checklistPhotoPolicy({
  allowedMimeTypes,
  maxBytes,
  maxCount,
} = {}) {
  return {
    maxCount: Number(maxCount),
    maxBytes: Number(maxBytes),
    allowedMimeTypes: Array.from(normalizedAllowedMimeTypes(allowedMimeTypes)),
  };
}

function isChecklistPhotoLimitReached(currentCount, maxCount) {
  const current = Number(currentCount);
  const maximum = Number(maxCount);
  return Number.isFinite(current)
    && Number.isFinite(maximum)
    && maximum > 0
    && current >= maximum;
}

module.exports = {
  checklistPhotoPolicy,
  createChecklistPhotoUploadMiddleware,
  isChecklistPhotoLimitReached,
  normalizedAllowedMimeTypes,
  parseChecklistPhotoRequest,
};
