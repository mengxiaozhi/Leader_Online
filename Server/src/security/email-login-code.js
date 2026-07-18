const crypto = require('crypto');

const EMAIL_LOGIN_CODE_TTL_SECONDS = 10 * 60;
const EMAIL_LOGIN_CODE_RESEND_SECONDS = 60;
const EMAIL_LOGIN_CODE_MAX_ATTEMPTS = 5;
const EMAIL_LOGIN_CODE_MAX_REQUESTS_PER_WINDOW = 5;
const EMAIL_LOGIN_CODE_REQUEST_WINDOW_MINUTES = 15;

function normalizeEmailAddress(value) {
  return String(value || '').trim().toLowerCase();
}

function generateEmailLoginCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function hashEmailLoginCode(email, code, secret) {
  const normalizedEmail = normalizeEmailAddress(email);
  return crypto
    .createHmac('sha256', String(secret || ''))
    .update(`${normalizedEmail}:${String(code || '')}`)
    .digest('hex');
}

function emailLoginCodeMatches(storedHash, email, code, secret) {
  const actual = Buffer.from(String(storedHash || ''), 'hex');
  const expected = Buffer.from(hashEmailLoginCode(email, code, secret), 'hex');
  return actual.length === expected.length && actual.length > 0 && crypto.timingSafeEqual(actual, expected);
}

function defaultUsernameForEmail(email) {
  const local = normalizeEmailAddress(email).split('@')[0] || 'user';
  return local.replace(/[^a-z0-9._-]/gi, '').slice(0, 50) || 'user';
}

module.exports = {
  EMAIL_LOGIN_CODE_TTL_SECONDS,
  EMAIL_LOGIN_CODE_RESEND_SECONDS,
  EMAIL_LOGIN_CODE_MAX_ATTEMPTS,
  EMAIL_LOGIN_CODE_MAX_REQUESTS_PER_WINDOW,
  EMAIL_LOGIN_CODE_REQUEST_WINDOW_MINUTES,
  normalizeEmailAddress,
  generateEmailLoginCode,
  hashEmailLoginCode,
  emailLoginCodeMatches,
  defaultUsernameForEmail,
};
