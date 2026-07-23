const assert = require('node:assert/strict');
const test = require('node:test');
const bcrypt = require('bcryptjs');
const buildAccountRoutes = require('../src/routes/account');

const {
  REGISTRATION_RESEND_SECONDS,
  REGISTRATION_MAX_SEND_ATTEMPTS,
  createEmailRegistrationService,
} = require('../src/services/email-registration');
const {
  normalizeRegistrationName,
  isValidRegistrationName,
} = require('../src/security/registration-name');

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    redirectTarget: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    redirect(code, target) {
      this.statusCode = code;
      this.redirectTarget = target;
      return this;
    },
  };
}

function createHarness({
  mailerReady = true,
  deliveredMarkerFails = false,
  userAppearsAfterPrecheck = false,
  smtpRejected = false,
  failConsumeAfterInsert = false,
} = {}) {
  let clock = Date.parse('2026-07-23T01:00:00.000Z');
  let currentMailerReady = mailerReady;
  let userLookupCount = 0;
  let schemaCalls = 0;
  let transactionSnapshot = null;
  const state = {
    record: null,
    users: [],
    emails: [],
    commits: 0,
    rollbacks: 0,
    transfers: [],
    logs: [],
  };

  const conn = {
    async beginTransaction() {
      transactionSnapshot = {
        record: state.record ? structuredClone(state.record) : null,
        users: structuredClone(state.users),
      };
    },
    async commit() {
      transactionSnapshot = null;
      state.commits += 1;
    },
    async rollback() {
      if (transactionSnapshot) {
        state.record = transactionSnapshot.record;
        state.users.splice(0, state.users.length, ...transactionSnapshot.users);
        transactionSnapshot = null;
      }
      state.rollbacks += 1;
    },
    release() {},
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('INSERT INTO email_verifications')) {
        if (!state.record) {
          state.record = {
            id: 1,
            email: params[0],
            registration_name: params[1],
            token: null,
            token_expiry: null,
            verified: 0,
            last_send_attempt_at: null,
            send_window_started_at: null,
            send_attempt_count: 0,
            delivered_at: null,
            used_at: null,
          };
        }
        return [{ affectedRows: 1 }];
      }
      if (normalized.includes('FROM email_verifications WHERE email = ?')) {
        return [[state.record].filter(Boolean)];
      }
      if (normalized.startsWith('UPDATE email_verifications') && normalized.includes('registration_name = ?')) {
        const [registrationName, token, tokenExpiry, reusable, withinWindow, attempts] = params;
        state.record.registration_name = registrationName;
        state.record.token = token;
        state.record.token_expiry = tokenExpiry;
        state.record.verified = 0;
        state.record.used_at = null;
        if (!reusable) state.record.delivered_at = null;
        state.record.last_send_attempt_at = new Date(clock);
        if (!withinWindow) state.record.send_window_started_at = new Date(clock);
        state.record.send_attempt_count = attempts;
        return [{ affectedRows: 1 }];
      }
      if (normalized.includes('FROM email_verifications WHERE token = ?') && normalized.includes('FOR UPDATE')) {
        return [[state.record && state.record.token === params[0] ? state.record : null].filter(Boolean)];
      }
      if (normalized.includes('FROM users WHERE email = ?') && normalized.includes('FOR UPDATE')) {
        return [state.users.filter((user) => user.email.toLowerCase() === String(params[0]).toLowerCase())];
      }
      if (normalized.startsWith('INSERT INTO users')) {
        state.users.push({
          id: params[0],
          username: params[1],
          email: params[2],
          password_hash: params[3],
          role: params[4] || 'USER',
        });
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith('UPDATE email_verifications') && normalized.includes('used_at = NOW()')) {
        if (failConsumeAfterInsert) return [{ affectedRows: 0 }];
        if (!state.record || state.record.token !== params[1] || state.record.used_at) {
          return [{ affectedRows: 0 }];
        }
        state.record.verified = 1;
        state.record.used_at = new Date(clock);
        state.record.token = null;
        state.record.token_expiry = null;
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unhandled connection SQL: ${normalized}`);
    },
  };

  const pool = {
    async getConnection() { return conn; },
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('CREATE TABLE') || normalized.startsWith('ALTER TABLE')) {
        schemaCalls += 1;
        return [[]];
      }
      if (normalized.includes('FROM users WHERE email = ?')) {
        userLookupCount += 1;
        const matching = state.users.filter((user) => user.email.toLowerCase() === String(params[0]).toLowerCase());
        if (userAppearsAfterPrecheck && userLookupCount === 1 && matching.length === 0) {
          state.users.push({ id: 'concurrent-user', email: String(params[0]), role: 'USER' });
          return [[]];
        }
        return [matching];
      }
      if (normalized.startsWith('UPDATE email_verifications SET delivered_at')) {
        if (deliveredMarkerFails) throw new Error('temporary database write failure');
        if (state.record?.id === params[0] && state.record?.token === params[1]) {
          state.record.delivered_at = new Date(clock);
        }
        return [{ affectedRows: 1 }];
      }
      if (normalized.includes('SELECT email, token_expiry, verified, used_at FROM email_verifications')) {
        return [[state.record && state.record.token === params[0] ? state.record : null].filter(Boolean)];
      }
      throw new Error(`Unhandled pool SQL: ${normalized}`);
    },
  };

  const ok = (res, data = null, message = 'Success') => res.json({ ok: true, message, data });
  const fail = (res, code, message, status = 500) =>
    res.status(status).json({ ok: false, code, message });
  const service = createEmailRegistrationService({
    pool,
    bcrypt,
    ok,
    fail,
    normalizeRegistrationName,
    isValidRegistrationName,
    isMailerReady: () => currentMailerReady,
    transporter: {
      async sendMail(message) {
        state.emails.push(message);
        return {
          messageId: `message-${state.emails.length}`,
          accepted: smtpRejected ? [] : [message.to],
          rejected: smtpRejected ? [message.to] : [],
          response: smtpRejected ? '550 rejected' : '250 accepted',
        };
      },
    },
    emailFromName: 'Leader Online',
    emailFromAddress: 'no-reply@example.com',
    publicApiBase: 'https://api.example.com',
    publicWebUrl: 'https://www.example.com',
    buildLeaderEmailHtml: ({ childrenHtml }) => childrenHtml,
    escapeHtml: (value) => String(value),
    signToken: ({ id }) => `jwt-${id}`,
    setAuthCookie: () => {},
    autoAcceptTransfersForEmail: async (id) => state.transfers.push(`ticket:${id}`),
    autoAcceptReservationTransfersForEmail: async (id) => state.transfers.push(`reservation:${id}`),
    featureEnabled: true,
    logger: {
      info: (...args) => state.logs.push(args),
      error: (...args) => state.logs.push(args),
    },
    now: () => clock,
  });
  const request = (body, headers = {}) => ({
    body,
    headers,
    get: (name) => headers[String(name).toLowerCase()],
  });

  return {
    service,
    state,
    request,
    schemaCalls: () => schemaCalls,
    advance(ms) { clock += ms; },
    setMailerReady(value) { currentMailerReady = Boolean(value); },
  };
}

test('verification resend reuses the live token and keeps its original expiry', async () => {
  const harness = createHarness();
  const first = createResponse();
  await harness.service.requestVerification(
    harness.request({ email: 'Member@Example.com', username: '王小明' }, { 'x-request-id': 'req-1' }),
    first
  );
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.data.mailed, true);
  const token = harness.state.record.token;
  const expiry = harness.state.record.token_expiry;
  assert.equal(harness.state.emails.length, 1);

  const cooldown = createResponse();
  await harness.service.requestVerification(
    harness.request({ email: 'member@example.com', username: '王小明' }),
    cooldown
  );
  assert.equal(cooldown.statusCode, 429);
  assert.equal(cooldown.body.code, 'REGISTRATION_EMAIL_COOLDOWN');
  assert.equal(cooldown.body.data.mailed, false);
  assert.equal(cooldown.body.data.alreadyRegistered, false);
  assert.equal(cooldown.body.data.resendAfter, cooldown.body.data.retryAfter);

  harness.advance((REGISTRATION_RESEND_SECONDS + 1) * 1000);
  const resend = createResponse();
  await harness.service.requestVerification(
    harness.request({ email: 'member@example.com', username: '王小明' }),
    resend
  );
  assert.equal(resend.statusCode, 200);
  assert.equal(harness.state.record.token, token);
  assert.equal(harness.state.record.token_expiry, expiry);
  assert.equal(resend.body.data.expiresAt, first.body.data.expiresAt);
  assert.equal(harness.state.emails.length, 2);
  assert.equal(REGISTRATION_MAX_SEND_ATTEMPTS, 5);
});

test('resending a live token preserves the original registration name', async () => {
  const harness = createHarness();
  const first = createResponse();
  await harness.service.requestVerification(
    harness.request({ email: 'member@example.com', username: '王小明' }),
    first
  );
  harness.advance((REGISTRATION_RESEND_SECONDS + 1) * 1000);

  const resend = createResponse();
  await harness.service.requestVerification(
    harness.request({ email: 'member@example.com', username: '惡意改名' }),
    resend
  );

  assert.equal(resend.statusCode, 200);
  assert.equal(harness.state.record.registration_name, '王小明');
  assert.match(harness.state.emails.at(-1).html, /王小明/);
  assert.doesNotMatch(harness.state.emails.at(-1).html, /惡意改名/);
});

test('an expired verification rotates the token and starts a new three-day lifetime', async () => {
  const harness = createHarness();
  const first = createResponse();
  await harness.service.requestVerification(
    harness.request({ email: 'member@example.com', username: '王小明' }),
    first
  );
  const originalToken = harness.state.record.token;
  const originalExpiry = harness.state.record.token_expiry;
  harness.state.record.token_expiry = 1;
  harness.advance((REGISTRATION_RESEND_SECONDS + 1) * 1000);

  const rotated = createResponse();
  await harness.service.requestVerification(
    harness.request({ email: 'member@example.com', username: '王小明' }),
    rotated
  );

  assert.equal(rotated.statusCode, 200);
  assert.notEqual(harness.state.record.token, originalToken);
  assert.ok(harness.state.record.token_expiry > originalExpiry);
});

test('registration email send window limits each address to five attempts', async () => {
  const harness = createHarness();
  for (let attempt = 0; attempt < REGISTRATION_MAX_SEND_ATTEMPTS; attempt += 1) {
    const response = createResponse();
    await harness.service.requestVerification(
      harness.request({ email: 'member@example.com', username: '王小明' }),
      response
    );
    assert.equal(response.statusCode, 200);
    harness.advance((REGISTRATION_RESEND_SECONDS + 1) * 1000);
  }
  const limited = createResponse();
  await harness.service.requestVerification(
    harness.request({ email: 'member@example.com', username: '王小明' }),
    limited
  );
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.body.code, 'REGISTRATION_EMAIL_RATE_LIMITED');
  assert.equal(limited.body.data.mailed, false);
  assert.equal(limited.body.data.alreadyRegistered, false);
  assert.equal(limited.body.data.resendAfter, limited.body.data.retryAfter);
  assert.equal(harness.state.emails.length, REGISTRATION_MAX_SEND_ATTEMPTS);
});

test('an already registered email returns the compatibility shape without sending', async () => {
  const harness = createHarness();
  harness.state.users.push({ id: 'existing-user', email: 'member@example.com', role: 'USER' });
  const response = createResponse();
  await harness.service.requestVerification(
    harness.request({ email: 'member@example.com', username: '王小明' }),
    response
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.mailed, false);
  assert.equal(response.body.data.alreadyRegistered, true);
  assert.equal(response.body.data.resendAfter, 0);
  assert.equal(harness.state.emails.length, 0);
  assert.equal(harness.state.record, null);
});

test('mailer unavailability returns 503 without reporting a false success', async () => {
  const harness = createHarness({ mailerReady: false });
  const response = createResponse();
  await harness.service.requestVerification(
    harness.request({ email: 'member@example.com', username: '王小明' }),
    response
  );
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.data.mailed, false);
  assert.match(harness.state.record.token, /^[a-f0-9]{64}$/);
});

test('explicit SMTP recipient rejection returns 503 and preserves the pending token', async () => {
  const harness = createHarness({ smtpRejected: true });
  const response = createResponse();
  await harness.service.requestVerification(
    harness.request({ email: 'member@example.com', username: '王小明' }),
    response
  );
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.code, 'REGISTRATION_EMAIL_DELIVERY_FAIL');
  assert.match(harness.state.record.token, /^[a-f0-9]{64}$/);
  assert.equal(harness.state.record.used_at, null);
});

test('SMTP 503 on resend preserves the previously delivered live token', async () => {
  const harness = createHarness();
  const first = createResponse();
  await harness.service.requestVerification(
    harness.request({ email: 'member@example.com', username: '王小明' }),
    first
  );
  const token = harness.state.record.token;
  const expiry = harness.state.record.token_expiry;
  harness.advance((REGISTRATION_RESEND_SECONDS + 1) * 1000);
  harness.setMailerReady(false);

  const failedResend = createResponse();
  await harness.service.requestVerification(
    harness.request({ email: 'member@example.com', username: '王小明' }),
    failedResend
  );
  assert.equal(failedResend.statusCode, 503);
  assert.equal(failedResend.body.data.mailed, false);
  assert.equal(harness.state.record.token, token);
  assert.equal(harness.state.record.token_expiry, expiry);
});

test('verification rechecks the user while holding the email record lock', async () => {
  const harness = createHarness({ userAppearsAfterPrecheck: true });
  const response = createResponse();
  await harness.service.requestVerification(
    harness.request({ email: 'member@example.com', username: '王小明' }),
    response
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.alreadyRegistered, true);
  assert.equal(response.body.data.mailed, false);
  assert.equal(harness.state.emails.length, 0);
  assert.equal(harness.state.record, null);
});

test('accepted SMTP delivery remains successful when the delivered marker write fails', async () => {
  const harness = createHarness({ deliveredMarkerFails: true });
  const response = createResponse();
  await harness.service.requestVerification(
    harness.request({ email: 'member@example.com', username: '王小明' }),
    response
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.mailed, true);
  assert.equal(harness.state.emails.length, 1);
  assert.equal(
    harness.state.logs.some((entry) => entry[1]?.result === 'accepted_delivery_marker_failed'),
    true
  );
});

test('validation is read-only and registration completion creates the account transactionally', async () => {
  const harness = createHarness();
  const requested = createResponse();
  await harness.service.requestVerification(
    harness.request({ email: 'member@example.com', username: '王小明' }),
    requested
  );
  const token = harness.state.record.token;

  const validated = createResponse();
  await harness.service.validateVerification(harness.request({ token }), validated);
  assert.equal(validated.body.data.valid, true);
  assert.equal(validated.body.data.email, 'me****@example.com');
  assert.equal(harness.state.users.length, 0);

  const completed = createResponse();
  await harness.service.completeRegistration(
    harness.request({ token, password: '12345678' }),
    completed
  );
  assert.equal(completed.statusCode, 200);
  assert.equal(completed.body.ok, true);
  assert.equal(completed.body.data.token.startsWith('jwt-'), true);
  assert.equal(harness.state.users.length, 1);
  assert.equal(await bcrypt.compare('12345678', harness.state.users[0].password_hash), true);
  assert.equal(bcrypt.getRounds(harness.state.users[0].password_hash), 12);
  assert.equal(harness.state.record.token, null);
  assert.equal(harness.state.record.verified, 1);
  assert.equal(harness.state.commits, 2);
  assert.deepEqual(harness.state.transfers.map((value) => value.split(':')[0]), ['ticket', 'reservation']);
});

test('repeating registration completion cannot create a second account', async () => {
  const harness = createHarness();
  const requested = createResponse();
  await harness.service.requestVerification(
    harness.request({ email: 'member@example.com', username: '王小明' }),
    requested
  );
  const token = harness.state.record.token;

  const first = createResponse();
  await harness.service.completeRegistration(
    harness.request({ token, password: '12345678' }),
    first
  );
  const repeated = createResponse();
  await harness.service.completeRegistration(
    harness.request({ token, password: '12345678' }),
    repeated
  );

  assert.equal(first.statusCode, 200);
  assert.equal(repeated.statusCode, 400);
  assert.equal(repeated.body.code, 'REGISTRATION_TOKEN_INVALID');
  assert.equal(harness.state.users.length, 1);
});

test('a failure after user insert rolls back both the account and token consumption', async () => {
  const harness = createHarness({ failConsumeAfterInsert: true });
  const requested = createResponse();
  await harness.service.requestVerification(
    harness.request({ email: 'member@example.com', username: '王小明' }),
    requested
  );
  const token = harness.state.record.token;

  const completed = createResponse();
  await harness.service.completeRegistration(
    harness.request({ token, password: '12345678' }),
    completed
  );

  assert.equal(completed.statusCode, 500);
  assert.equal(completed.body.code, 'REGISTRATION_COMPLETE_FAIL');
  assert.equal(harness.state.users.length, 0);
  assert.equal(harness.state.record.token, token);
  assert.equal(harness.state.record.verified, 0);
  assert.equal(harness.state.rollbacks, 1);
});

test('legacy confirmation route redirects without touching persistence', () => {
  const harness = createHarness();
  const response = createResponse();
  harness.service.redirectToCompletion({ query: { token: 'abc123' } }, response);
  assert.equal(response.statusCode, 302);
  assert.equal(response.redirectTarget, 'https://www.example.com/register/complete#token=abc123');
  assert.equal(harness.schemaCalls(), 0);
  assert.equal(harness.state.record, null);
});

test('account GET and HEAD confirmation routes are side-effect free redirects', async () => {
  let databaseCalls = 0;
  const noop = () => {};
  const ctx = new Proxy({
    pool: {
      async query() {
        databaseCalls += 1;
        throw new Error('confirmation redirect must not query the database');
      },
    },
    storage: {},
    PUBLIC_WEB_URL: 'https://www.example.com',
    PUBLIC_API_BASE: 'https://api.example.com',
    RESTRICT_EMAIL_DOMAIN_TO_EDU_TW: false,
    REQUIRE_EMAIL_VERIFICATION: false,
    isMailerReady: () => false,
    ok: (res, data, message) => res.json({ ok: true, data, message }),
    fail: (res, code, message, status) => res.status(status).json({ ok: false, code, message }),
  }, {
    get(target, key) {
      if (key in target) return target[key];
      return noop;
    },
  });
  const router = buildAccountRoutes(ctx);

  for (const method of ['GET', 'HEAD']) {
    const layer = router.stack.find((entry) =>
      entry.route?.path === '/confirm-email'
      && entry.route.methods[method.toLowerCase()]
    );
    assert.ok(layer, `${method} /confirm-email route should exist`);
    const response = createResponse();
    await layer.route.stack[0].handle({ query: { token: 'abc123' } }, response);
    assert.equal(response.statusCode, 302);
    assert.equal(response.redirectTarget, 'https://www.example.com/register/complete#token=abc123');
  }
  assert.equal(databaseCalls, 0);
});
