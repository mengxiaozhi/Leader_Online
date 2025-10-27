const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { randomUUID, createHash } = require('crypto');

const DEFAULT_STORAGE_ROOT = path.resolve(__dirname, '../storage');
const STORAGE_ROOT = process.env.STORAGE_ROOT
  ? path.resolve(process.env.STORAGE_ROOT)
  : DEFAULT_STORAGE_ROOT;

async function ensureStorageRoot() {
  await fsp.mkdir(STORAGE_ROOT, { recursive: true });
}

function normalizeRelativePath(relativePath) {
  if (!relativePath) return '';
  return String(relativePath).replace(/\\/g, '/').replace(/^\/+/, '');
}

function resolveStoragePath(relativePath) {
  const sanitized = normalizeRelativePath(relativePath);
  const absolute = path.resolve(STORAGE_ROOT, sanitized);
  const distance = path.relative(STORAGE_ROOT, absolute);
  if (distance.startsWith('..') || path.isAbsolute(distance)) {
    throw new Error(`Storage path traversal detected: ${relativePath}`);
  }
  return absolute;
}

async function ensureParentDir(relativePath) {
  const absolute = resolveStoragePath(relativePath);
  const parent = path.dirname(absolute);
  await fsp.mkdir(parent, { recursive: true });
  return absolute;
}

function mimeToExtension(mime) {
  if (!mime) return 'bin';
  const normalized = mime.toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/heic' || normalized === 'image/heif') return 'heic';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/avif') return 'avif';
  return normalized.split('/').pop() || 'bin';
}

function generateStorageKey(prefix = '') {
  const base = randomUUID().replace(/-/g, '');
  return prefix ? `${prefix}-${base}` : base;
}

async function writeBuffer(relativePath, buffer, { mode } = {}) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('buffer must be a Buffer');
  const absolute = await ensureParentDir(relativePath);
  await fsp.writeFile(absolute, buffer, mode ? { mode } : undefined);
  return absolute;
}

async function deleteFile(relativePath) {
  if (!relativePath) return false;
  try {
    const absolute = resolveStoragePath(relativePath);
    await fsp.unlink(absolute);
    return true;
  } catch (err) {
    if (err?.code === 'ENOENT') return false;
    throw err;
  }
}

async function fileExists(relativePath) {
  if (!relativePath) return false;
  try {
    const absolute = resolveStoragePath(relativePath);
    await fsp.access(absolute);
    return true;
  } catch (err) {
    if (err?.code === 'ENOENT') return false;
    throw err;
  }
}

function createReadStream(relativePath) {
  const absolute = resolveStoragePath(relativePath);
  return fs.createReadStream(absolute);
}

async function getFileStat(relativePath) {
  try {
    const absolute = resolveStoragePath(relativePath);
    return await fsp.stat(absolute);
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

function hashBuffer(buffer, algorithm = 'sha256') {
  return createHash(algorithm).update(buffer).digest('hex');
}

module.exports = {
  STORAGE_ROOT,
  ensureStorageRoot,
  normalizeRelativePath,
  resolveStoragePath,
  writeBuffer,
  deleteFile,
  fileExists,
  createReadStream,
  getFileStat,
  mimeToExtension,
  generateStorageKey,
  hashBuffer,
};
