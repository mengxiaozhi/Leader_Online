const crypto = require('crypto');

const INSECURE_JWT_SECRETS = new Set(['', 'change_me', 'changeme', 'secret', 'jwt_secret']);

function resolveJwtSecret(env = process.env) {
  const configured = String(env.JWT_SECRET || '').trim();
  const isProduction = String(env.NODE_ENV || '').toLowerCase() === 'production';
  const isWeak = configured.length < 32 || INSECURE_JWT_SECRETS.has(configured.toLowerCase());

  if (!isWeak) return configured;
  if (isProduction) {
    throw new Error('JWT_SECRET must be configured with at least 32 characters in production');
  }

  console.warn('JWT_SECRET is missing or weak; using an ephemeral development secret');
  return crypto.randomBytes(48).toString('base64url');
}

function normalizeLocalRedirect(value, fallback = '/store') {
  const candidate = String(value || '').trim();
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(candidate)) return fallback;
  try {
    const parsed = new URL(candidate, 'https://leader.local');
    if (parsed.origin !== 'https://leader.local') return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

function publicApiBase(req, env = process.env) {
  const configured = String(env.PUBLIC_API_BASE || '').trim().replace(/\/$/, '');
  if (configured) {
    const parsed = new URL(configured);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('PUBLIC_API_BASE must use http or https');
    return parsed.toString().replace(/\/$/, '');
  }

  if (String(env.NODE_ENV || '').toLowerCase() === 'production') {
    throw new Error('PUBLIC_API_BASE is required in production');
  }

  const proto = String(req?.protocol || 'http').toLowerCase() === 'https' ? 'https' : 'http';
  const host = String(req?.get?.('host') || '').trim();
  if (!/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host)) throw new Error('Invalid request host');
  return `${proto}://${host}`;
}

module.exports = {
  normalizeLocalRedirect,
  publicApiBase,
  resolveJwtSecret,
};
