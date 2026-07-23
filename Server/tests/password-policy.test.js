const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const bcrypt = require('bcryptjs');
const buildAccountRoutes = require('../src/routes/account');

const {
  PASSWORD_BCRYPT_COST,
  newPasswordSchema,
  existingCredentialSchema,
  isValidNewPassword,
  passwordUpgradeRequired,
  utf8ByteLength,
} = require('../src/security/password-policy');

test('existing credentials remain compatible while new passwords require eight characters', () => {
  assert.equal(existingCredentialSchema.safeParse('123456').success, true);
  assert.equal(existingCredentialSchema.safeParse('1234567').success, true);
  assert.equal(existingCredentialSchema.safeParse('').success, false);
  assert.equal(newPasswordSchema.safeParse('1234567').success, false);
  assert.equal(newPasswordSchema.safeParse('12345678').success, true);
  assert.equal(newPasswordSchema.safeParse('1234567 ').success, true, 'password input must not be trimmed');
  assert.equal(passwordUpgradeRequired('123456'), true);
  assert.equal(passwordUpgradeRequired('12345678'), false);
});

test('new password policy enforces bcrypt 72-byte boundary using UTF-8 bytes', () => {
  assert.equal(utf8ByteLength('a'.repeat(72)), 72);
  assert.equal(isValidNewPassword('a'.repeat(72)), true);
  assert.equal(isValidNewPassword('a'.repeat(73)), false);
  assert.equal(utf8ByteLength('密'.repeat(24)), 72);
  assert.equal(isValidNewPassword('密'.repeat(24)), true);
  assert.equal(isValidNewPassword('密'.repeat(25)), false);
});

test('new hashes use cost 12 while legacy cost-10 hashes still verify', async () => {
  assert.equal(PASSWORD_BCRYPT_COST, 12);
  const legacyHash = await bcrypt.hash('123456', 10);
  assert.equal(await bcrypt.compare('123456', legacyHash), true);
  const currentHash = await bcrypt.hash('12345678', PASSWORD_BCRYPT_COST);
  assert.equal(bcrypt.getRounds(currentHash), 12);
});

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('actual login route accepts a legacy six-character cost-10 password and marks it for upgrade', async () => {
  const passwordHash = await bcrypt.hash('123456', 10);
  let loginQueries = 0;
  const noop = () => {};
  const ctx = new Proxy({
    pool: {
      async query(sql) {
        if (String(sql).includes('FROM users WHERE email = ?')) {
          loginQueries += 1;
          return [[{
            id: 'legacy-user',
            username: '舊會員',
            email: 'legacy@example.com',
            role: 'USER',
            password_hash: passwordHash,
            phone: null,
            remittance_last5: null,
            is_vip: 0,
          }]];
        }
        throw new Error(`Unexpected login SQL: ${sql}`);
      },
    },
    storage: {},
    PUBLIC_WEB_URL: 'https://www.example.com',
    PUBLIC_API_BASE: 'https://api.example.com',
    RESTRICT_EMAIL_DOMAIN_TO_EDU_TW: false,
    REQUIRE_EMAIL_VERIFICATION: false,
    isMailerReady: () => false,
    signToken: () => 'legacy-jwt',
    setAuthCookie: noop,
    ok: (res, data, message) => res.json({ ok: true, message, data }),
    fail: (res, code, message, status) => res.status(status).json({ ok: false, code, message }),
  }, {
    get(target, key) {
      if (key in target) return target[key];
      return noop;
    },
  });
  const router = buildAccountRoutes(ctx);
  const loginLayer = router.stack.find((entry) => entry.route?.path === '/login');
  assert.ok(loginLayer);
  const loginHandler = loginLayer.route.stack[0].handle;

  const success = createResponse();
  await loginHandler({ body: { email: 'legacy@example.com', password: '123456' } }, success);
  assert.equal(success.statusCode, 200);
  assert.equal(success.body.ok, true);
  assert.equal(success.body.data.passwordUpgradeRequired, true);
  assert.equal(success.body.data.token, 'legacy-jwt');

  const incorrect = createResponse();
  await loginHandler({ body: { email: 'legacy@example.com', password: '654321' } }, incorrect);
  assert.equal(incorrect.statusCode, 401);
  assert.equal(incorrect.body.code, 'AUTH_INVALID_CREDENTIALS');
  assert.equal(loginQueries, 2);
});

test('actual self-password route accepts a legacy short current password and stores a cost-12 replacement', async () => {
  const legacyHash = await bcrypt.hash('123456', 10);
  let replacementHash = '';
  let resetsInvalidated = false;
  const noop = () => {};
  const ctx = new Proxy({
    pool: {
      async query(sql, params = []) {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        if (normalized.startsWith('SELECT password_hash')) {
          return [[{
            password_hash: legacyHash,
            email: 'legacy@example.com',
            username: '舊會員',
            role: 'USER',
          }]];
        }
        if (normalized.startsWith('UPDATE users SET password_hash')) {
          replacementHash = params[0];
          return [{ affectedRows: 1 }];
        }
        if (normalized.startsWith('CREATE TABLE IF NOT EXISTS password_resets')) return [[]];
        if (normalized.startsWith('UPDATE password_resets SET used = 1')) {
          resetsInvalidated = true;
          return [{ affectedRows: 1 }];
        }
        throw new Error(`Unexpected self-password SQL: ${normalized}`);
      },
    },
    storage: {},
    PUBLIC_WEB_URL: 'https://www.example.com',
    PUBLIC_API_BASE: 'https://api.example.com',
    RESTRICT_EMAIL_DOMAIN_TO_EDU_TW: false,
    REQUIRE_EMAIL_VERIFICATION: false,
    isMailerReady: () => false,
    signToken: () => 'updated-jwt',
    setAuthCookie: noop,
    ok: (res, data, message) => res.json({ ok: true, message, data }),
    fail: (res, code, message, status) => res.status(status).json({ ok: false, code, message }),
  }, {
    get(target, key) {
      if (key in target) return target[key];
      return noop;
    },
  });
  const router = buildAccountRoutes(ctx);
  const route = router.stack.find((entry) =>
    entry.route?.path === '/me/password' && entry.route.methods.patch
  );
  assert.ok(route);
  const handler = route.route.stack.at(-1).handle;
  const response = createResponse();
  await handler({
    user: { id: 'legacy-user', role: 'USER' },
    body: { currentPassword: '123456', newPassword: 'new-pass-123' },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(await bcrypt.compare('new-pass-123', replacementHash), true);
  assert.equal(bcrypt.getRounds(replacementHash), 12);
  assert.equal(resetsInvalidated, true);
});

test('main driver password update accepts the UUID created by the driver endpoint', async () => {
  const driverId = 'd7bce74b-59aa-4c65-9a7b-1e1fa6331530';
  let replacementHash = '';
  const noop = () => {};
  const ctx = new Proxy({
    pool: {
      async query(sql, params = []) {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        if (normalized.startsWith('SELECT id, role, provider_id FROM users')) {
          assert.equal(params[0], driverId);
          return [[{ id: driverId, role: 'DRIVER', provider_id: 'provider-1' }]];
        }
        if (normalized.startsWith('UPDATE users SET password_hash = ?')) {
          replacementHash = params[0];
          assert.equal(params.at(-1), driverId);
          return [{ affectedRows: 1 }];
        }
        throw new Error(`Unexpected driver SQL: ${normalized}`);
      },
    },
    storage: {},
    PUBLIC_WEB_URL: 'https://www.example.com',
    PUBLIC_API_BASE: 'https://api.example.com',
    RESTRICT_EMAIL_DOMAIN_TO_EDU_TW: false,
    REQUIRE_EMAIL_VERIFICATION: false,
    isMailerReady: () => false,
    normalizeUserId: (value) => String(value || '').trim(),
    normalizeRole: (value) => String(value || '').trim().toUpperCase(),
    isADMIN: (value) => String(value || '').trim().toUpperCase() === 'ADMIN',
    ok: (res, data, message) => res.json({ ok: true, message, data }),
    fail: (res, code, message, status) => res.status(status).json({ ok: false, code, message }),
  }, {
    get(target, key) {
      if (key in target) return target[key];
      return noop;
    },
  });
  const router = buildAccountRoutes(ctx);
  const route = router.stack.find((entry) =>
    entry.route?.path === '/provider/drivers/:id' && entry.route.methods.patch
  );
  assert.ok(route);
  const handler = route.route.stack.at(-1).handle;
  const response = createResponse();
  await handler({
    params: { id: driverId },
    user: { id: 'provider-1', role: 'SERVICE_PROVIDER' },
    body: { password: 'driver-pass-123' },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(await bcrypt.compare('driver-pass-123', replacementHash), true);
  assert.equal(bcrypt.getRounds(replacementHash), 12);
});

test('registration V2 disables the public direct-account creation endpoint', async () => {
  const previous = process.env.REGISTRATION_COMPLETION_V2;
  process.env.REGISTRATION_COMPLETION_V2 = '1';
  try {
    const noop = () => {};
    const ctx = new Proxy({
      pool: {
        async query() {
          throw new Error('V2 direct registration must not query the database');
        },
      },
      storage: {},
      PUBLIC_WEB_URL: 'https://www.example.com',
      PUBLIC_API_BASE: 'https://api.example.com',
      RESTRICT_EMAIL_DOMAIN_TO_EDU_TW: false,
      REQUIRE_EMAIL_VERIFICATION: false,
      isMailerReady: () => false,
      ok: (res, data, message) => res.json({ ok: true, message, data }),
      fail: (res, code, message, status) => res.status(status).json({ ok: false, code, message }),
    }, {
      get(target, key) {
        if (key in target) return target[key];
        return noop;
      },
    });
    const router = buildAccountRoutes(ctx);
    const route = router.stack.find((entry) =>
      entry.route?.path === '/users' && entry.route.methods.post
    );
    assert.ok(route);
    const response = createResponse();
    await route.route.stack[0].handle({
      body: {
        username: '王小明',
        email: 'member@example.com',
        password: '12345678',
      },
    }, response);

    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, 'REGISTRATION_COMPLETION_REQUIRED');
  } finally {
    if (previous === undefined) delete process.env.REGISTRATION_COMPLETION_V2;
    else process.env.REGISTRATION_COMPLETION_V2 = previous;
  }
});

test('main and v1 creation/reset routes share the new password schema and cost', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'account.js'), 'utf8');
  const v1Source = fs.readFileSync(path.join(__dirname, '..', 'v1', 'index.js'), 'utf8');
  for (const [label, source] of [['main', mainSource], ['v1', v1Source]]) {
    for (const marker of [
      'password: newPasswordSchema',
      'const AdminPasswordSchema = z.object({ password: newPasswordSchema })',
      'bcrypt.hash(password, PASSWORD_BCRYPT_COST)',
      "post('/admin/users'",
      'REGISTRATION_COMPLETION_REQUIRED',
    ]) {
      assert.equal(source.includes(marker), true, `${label} missing password parity marker: ${marker}`);
    }
  }
  for (const marker of [
    "app.post('/provider/drivers'",
    'const ProviderDriverCreateSchema',
    'password: newPasswordSchema',
  ]) {
    assert.equal(v1Source.includes(marker), true, `v1 missing driver password marker: ${marker}`);
  }
});
