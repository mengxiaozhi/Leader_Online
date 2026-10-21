const test = require('node:test');
const assert = require('node:assert/strict');
const buildAccountRoutes = require('../src/routes/account');
const { isAccountTombstoned } = require('../src/security/account-tombstones');
const { issueRegistrationIntent, bindRegistrationIntentToState } = require('../src/security/registration-intent');
const { hashEmailLoginCode } = require('../src/security/email-login-code');

const EMAIL = 'deleted@example.com';
const SECRET = 'deleted-registration-test-secret';
const STATE = 'test-oauth-state';

function response() {
  return {
    statusCode: 200, body: null, target: '',
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    redirect(code, target) { this.statusCode = code; this.target = target; return this; },
    clearCookie() {},
  };
}

function harness({ activeUser = false, deletedSubject = false, lookupFails = false, deletedEmail = true } = {}) {
  const state = { created: 0, linked: 0, sessions: [], commits: 0, rollbacks: 0 };
  const user = { id: 'existing-active-account', email: EMAIL, username: '現有會員', role: 'USER' };
  const pool = {
    async query(sql, params = []) {
      const query = sql.replace(/\s+/g, ' ').trim();
      if (query.includes('FROM account_tombstones')) {
        if (lookupFails === true || (lookupFails === 'email' && !query.includes('provider = ?'))) {
          throw new Error('deletion lookup unavailable');
        }
        if (query.includes('provider = ?')) return [deletedSubject ? [{ id: 1 }] : []];
        assert.equal(params[0], EMAIL);
        return [deletedEmail ? [{ id: 2 }] : []];
      }
      if (query.includes('FROM oauth_identities oi JOIN users')) return [[]];
      if (query.includes('FROM users WHERE')) return [activeUser ? [user] : []];
      if (query.startsWith('INSERT INTO users')) { state.created += 1; return [{ affectedRows: 1 }]; }
      if (query.startsWith('INSERT INTO oauth_identities')) { state.linked += 1; return [{ affectedRows: 1 }]; }
      if (query.startsWith('CREATE TABLE') || query.startsWith('ALTER TABLE')) return [[]];
      if (query.includes('FROM email_login_codes')) {
        return [[{ id: 1, code_hash: hashEmailLoginCode(EMAIL, '123456', SECRET), attempts: 0, used_at: null, is_expired: 0 }]];
      }
      if (query.startsWith('UPDATE email_login_codes') || query.startsWith('INSERT INTO email_verifications')) {
        return [{ affectedRows: 1 }];
      }
      if (query.startsWith('INSERT INTO password_resets')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${query}`);
    },
    async getConnection() { return conn; },
  };
  const conn = {
    query: pool.query,
    async beginTransaction() {},
    async commit() { state.commits += 1; },
    async rollback() { state.rollbacks += 1; },
    release() {},
  };
  const noop = () => {};
  const ctx = new Proxy({
    pool, storage: {},
    PUBLIC_WEB_URL: 'https://example.test',
    PUBLIC_API_BASE: 'https://api.example.test',
    RESTRICT_EMAIL_DOMAIN_TO_EDU_TW: false,
    REQUIRE_EMAIL_VERIFICATION: false,
    MAGIC_LINK_SECRET: SECRET,
    EMAIL_LOGIN_CODE_SECRET: SECRET,
    GOOGLE_CLIENT_ID: 'test-google', GOOGLE_CLIENT_SECRET: 'test-google-secret',
    LINE_CLIENT_ID: 'test-line', LINE_CLIENT_SECRET: 'test-line-secret',
    shortCookieOptions: () => ({}),
    publicApiBase: () => 'https://api.example.test',
    normalizeRole: (value) => String(value).toUpperCase(),
    normalizeUserId: (value) => String(value || ''),
    normalizeLocalRedirect: (value, fallback) => value || fallback,
    isADMIN: (role) => role === 'ADMIN',
    isTombstoned: (criteria, options = {}) => isAccountTombstoned(options.queryable || pool, criteria, options),
    httpsPostForm: async (url) => url.endsWith('/verify')
      ? { email: EMAIL }
      : { access_token: 'test-access-token', id_token: 'test-id-token' },
    httpsGetJson: async () => ({ email: EMAIL, sub: 'test-subject', userId: 'test-subject' }),
    signToken: ({ id }) => `session:${id}`,
    setAuthCookie: (_res, token) => state.sessions.push(token),
    ok: (res, data, message) => res.json({ ok: true, message, data }),
    fail: (res, code, message, status) => res.status(status).json({ ok: false, code, message }),
  }, { get: (target, key) => key in target ? target[key] : noop });
  const previous = process.env.REGISTRATION_COMPLETION_V2;
  process.env.REGISTRATION_COMPLETION_V2 = '0';
  let router;
  try { router = buildAccountRoutes(ctx); } finally {
    if (previous === undefined) delete process.env.REGISTRATION_COMPLETION_V2;
    else process.env.REGISTRATION_COMPLETION_V2 = previous;
  }
  return {
    state,
    handler(path, method = 'post') {
      const route = router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]);
      assert.ok(route, `missing ${method} ${path}`);
      return route.route.stack.at(-1).handle;
    },
  };
}

function oauthRequest(mode = 'register') {
  const intent = issueRegistrationIntent({ registrationName: '王小明', secret: SECRET });
  return {
    query: { code: 'test-code', state: STATE },
    cookies: {
      oauth_state: STATE, oauth_mode: mode, oauth_next: '/store',
      oauth_registration_context: bindRegistrationIntentToState(intent, { state: STATE, secret: SECRET }),
    },
  };
}

test('tombstone matching normalizes email, provider and subject and keeps transaction locks', async () => {
  const calls = [];
  const queryable = { query: async (sql, params) => { calls.push({ sql, params }); return [calls.length === 2 ? [{ id: 1 }] : []]; } };
  assert.equal(await isAccountTombstoned(queryable, {
    provider: ' GOOGLE ', subject: ' subject ', email: '  Deleted@Example.COM ',
  }, { forUpdate: true }), true);
  assert.deepEqual(calls.map((call) => call.params), [['google', 'subject'], [EMAIL]]);
  assert.ok(calls.every((call) => call.sql.endsWith('FOR UPDATE')));
});

for (const path of ['/users', '/admin/users', '/provider/drivers']) {
  test(`${path} rejects deleted email without creating an account`, async () => {
    const { state, handler } = harness();
    const res = response();
    await handler(path)({
      body: { username: '王小明', email: 'Deleted@Example.COM', password: 'password123' },
      user: { id: 'provider-id', role: 'SERVICE_PROVIDER' },
    }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'ACCOUNT_DELETED');
    assert.match(res.body.message, /帳號已刪除/);
    assert.equal(state.created, 0);
    assert.deepEqual(state.sessions, []);
  });
  test(`${path} cannot create an account when deletion records are unavailable`, async () => {
    const { state, handler } = harness({ lookupFails: true });
    const res = response();
    await handler(path)({
      body: { username: '王小明', email: EMAIL, password: 'password123' },
      user: { id: 'provider-id', role: 'SERVICE_PROVIDER' },
    }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(state.created, 0);
    assert.deepEqual(state.sessions, []);
  });
}

for (const provider of ['google', 'line']) {
  test(`${provider} cannot register a deleted email or redirect it to new registration`, async () => {
    for (const mode of ['register', 'login']) {
      const { state, handler } = harness();
      const res = response();
      await handler(`/auth/${provider}/callback`, 'get')(oauthRequest(mode), res);
      assert.equal(res.target, 'https://example.test/login?oauth_error=account_deleted');
      assert.equal(state.created, 0);
      assert.equal(state.linked, 0);
      assert.deepEqual(state.sessions, []);
    }
  });

  test(`${provider} permits an existing active account with an older same-email deletion record`, async () => {
    const { state, handler } = harness({ activeUser: true });
    const res = response();
    await handler(`/auth/${provider}/callback`, 'get')(oauthRequest('login'), res);
    assert.match(res.target, /#token=session%3Aexisting-active-account$/);
    assert.deepEqual(state.sessions, ['session:existing-active-account']);
    assert.equal(state.created, 0);
  });

  test(`${provider} still blocks a deleted provider identity even when the email has an active account`, async () => {
    const { state, handler } = harness({ activeUser: true, deletedSubject: true });
    const res = response();
    await handler(`/auth/${provider}/callback`, 'get')(oauthRequest('login'), res);
    assert.match(res.target, /oauth_error=account_deleted$/);
    assert.equal(state.linked, 0);
    assert.deepEqual(state.sessions, []);
  });

  test(`${provider} does not create an account when the deletion lookup fails`, async () => {
    for (const lookupFails of [true, 'email']) {
      const { state, handler } = harness({ lookupFails });
      const res = response();
      await handler(`/auth/${provider}/callback`, 'get')(oauthRequest(), res);
      assert.equal(res.target, `https://example.test/login?oauth_error=${provider}`);
      assert.equal(state.created, 0);
      assert.equal(state.linked, 0);
      assert.deepEqual(state.sessions, []);
    }
  });

  test(`${provider} can still register an email without a deletion record`, async () => {
    const { state, handler } = harness({ deletedEmail: false });
    const res = response();
    await handler(`/auth/${provider}/callback`, 'get')(oauthRequest(), res);
    assert.match(res.target, /^https:\/\/example\.test\/reset\?token=.+&first=1$/);
    assert.equal(state.created, 1);
    assert.equal(state.linked, 1);
  });
}

test('email OTP does not suggest registering an email whose account was deleted', async () => {
  const { state, handler } = harness();
  const res = response();
  await handler('/auth/email-code/verify')({ body: { email: EMAIL, code: '123456' } }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'ACCOUNT_DELETED');
  assert.equal(state.commits, 1);
  assert.equal(state.created, 0);
  assert.deepEqual(state.sessions, []);
});

test('email OTP still logs in the existing active account when an older same-email tombstone exists', async () => {
  const { state, handler } = harness({ activeUser: true });
  const res = response();
  await handler('/auth/email-code/verify')({ body: { email: EMAIL, code: '123456' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.id, 'existing-active-account');
  assert.deepEqual(state.sessions, ['session:existing-active-account']);
  assert.equal(state.created, 0);
});
