const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  EMAIL_LOGIN_CODE_TTL_SECONDS,
  EMAIL_LOGIN_CODE_RESEND_SECONDS,
  EMAIL_LOGIN_CODE_MAX_ATTEMPTS,
  normalizeEmailAddress,
  generateEmailLoginCode,
  hashEmailLoginCode,
  emailLoginCodeMatches,
  defaultUsernameForEmail,
} = require('../src/security/email-login-code');
const buildAccountRoutes = require('../src/routes/account');
const {
  normalizeRegistrationName,
  isValidRegistrationName,
} = require('../src/security/registration-name');

test('email login code policy keeps the approved lifetimes and attempt limit', () => {
  assert.equal(EMAIL_LOGIN_CODE_TTL_SECONDS, 600);
  assert.equal(EMAIL_LOGIN_CODE_RESEND_SECONDS, 60);
  assert.equal(EMAIL_LOGIN_CODE_MAX_ATTEMPTS, 5);
});

test('email login codes are always six numeric digits', () => {
  for (let index = 0; index < 1000; index += 1) {
    assert.match(generateEmailLoginCode(), /^\d{6}$/);
  }
});

test('email login code hashes are normalized, keyed, and email-bound', () => {
  const secret = 'test-email-code-secret';
  const hash = hashEmailLoginCode(' Member@Example.COM ', '012345', secret);

  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash.includes('012345'), false);
  assert.equal(emailLoginCodeMatches(hash, 'member@example.com', '012345', secret), true);
  assert.equal(emailLoginCodeMatches(hash, 'other@example.com', '012345', secret), false);
  assert.equal(emailLoginCodeMatches(hash, 'member@example.com', '543210', secret), false);
  assert.equal(emailLoginCodeMatches(hash, 'member@example.com', '012345', 'other-secret'), false);
});

test('email login account defaults normalize addresses and safe usernames', () => {
  assert.equal(normalizeEmailAddress(' Member.Name+OTP@Example.COM '), 'member.name+otp@example.com');
  assert.equal(defaultUsernameForEmail(' Member.Name+OTP@Example.COM '), 'member.nameotp');
  assert.equal(defaultUsernameForEmail('中文@example.com'), 'user');
  assert.equal(defaultUsernameForEmail(`${'a'.repeat(80)}@example.com`).length, 50);
});

test('registration real names are normalized and required', () => {
  assert.equal(normalizeRegistrationName('  王   小明  '), '王 小明');
  assert.equal(isValidRegistrationName('王小明'), true);
  assert.equal(isValidRegistrationName(' A '), false);
  assert.equal(isValidRegistrationName('   '), false);
  assert.equal(isValidRegistrationName('a'.repeat(51)), false);
});

test('account router exposes both email login code endpoints', () => {
  const noop = () => {};
  const ctx = new Proxy({}, {
    get: (_target, key) => {
      if (key === 'pool' || key === 'storage') return {};
      if (key === 'RESTRICT_EMAIL_DOMAIN_TO_EDU_TW' || key === 'REQUIRE_EMAIL_VERIFICATION') return false;
      if (key === 'EMAIL_LOGIN_CODE_SECRET') return 'test-email-code-secret';
      return noop;
    },
  });
  const router = buildAccountRoutes(ctx);
  const registeredRoutes = new Set(
    router.stack
      .filter((layer) => layer.route)
      .flatMap((layer) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`))
  );

  assert.equal(registeredRoutes.has('POST /auth/email-code/request'), true);
  assert.equal(registeredRoutes.has('POST /auth/email-code/verify'), true);
  assert.equal(registeredRoutes.has('POST /email-verifications/validate'), true);
  assert.equal(registeredRoutes.has('POST /registrations/complete'), true);
  assert.equal(registeredRoutes.has('HEAD /confirm-email'), true);
  assert.equal(registeredRoutes.has('GET /confirm-email'), true);
});

test('legacy runtime retains email login security and rejects implicit registration', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'v1', 'index.js'), 'utf8');
  for (const expected of [
    "app.post('/auth/email-code/request'",
    "app.post('/auth/email-code/verify'",
    'EMAIL_LOGIN_CODE_SECRET',
    'emailCodeRequestEmailLimiter',
    'SELECT GET_LOCK(?, 5)',
    'SELECT RELEASE_LOCK(?)',
    "fail(res, 'ACCOUNT_NOT_FOUND'",
    "app.post('/email-verifications/validate'",
    "app.post('/registrations/complete'",
    "app.head('/confirm-email'",
    'emailRegistration.redirectToCompletion',
  ]) {
    assert.equal(source.includes(expected), true, `missing v1 OTP parity marker: ${expected}`);
  }
  assert.equal(source.includes("const username = (email.split('@')[0] || 'user')"), false);
});
