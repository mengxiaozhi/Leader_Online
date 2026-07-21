const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REGISTRATION_INTENT_TTL_MS,
  issueRegistrationIntent,
  readRegistrationIntent,
  bindRegistrationIntentToState,
  readBoundRegistrationIntent,
} = require('../src/security/registration-intent');

const SECRET = 'registration-intent-test-secret';
const NOW = Date.UTC(2026, 6, 21, 12, 0, 0);

test('registration intent encrypts and normalizes the declared name', () => {
  const intent = issueRegistrationIntent({
    registrationName: '  Alice   Chen  ',
    secret: SECRET,
    now: NOW,
  });

  assert.match(intent, /^ri1\./);
  assert.equal(intent.includes('Alice'), false);
  assert.deepEqual(readRegistrationIntent(intent, { secret: SECRET, now: NOW + 1000 }).registrationName, 'Alice Chen');
});

test('bound registration context must match the OAuth state', () => {
  const intent = issueRegistrationIntent({ registrationName: '陳大文', secret: SECRET, now: NOW });
  const context = bindRegistrationIntentToState(intent, {
    state: 'oauth-state-a',
    secret: SECRET,
    now: NOW + 1000,
  });

  assert.deepEqual(
    readBoundRegistrationIntent(context, { state: 'oauth-state-a', secret: SECRET, now: NOW + 2000 }).registrationName,
    '陳大文'
  );
  assert.throws(
    () => readBoundRegistrationIntent(context, { state: 'oauth-state-b', secret: SECRET, now: NOW + 2000 }),
    /OAuth state/
  );
});

test('registration intents reject tampering, the wrong secret, and expiry', () => {
  const intent = issueRegistrationIntent({ registrationName: '林美玲', secret: SECRET, now: NOW });
  const tampered = `${intent.slice(0, -1)}${intent.endsWith('A') ? 'B' : 'A'}`;

  assert.throws(() => readRegistrationIntent(tampered, { secret: SECRET, now: NOW + 1000 }), /invalid/i);
  assert.throws(() => readRegistrationIntent(intent, { secret: 'wrong-secret', now: NOW + 1000 }), /invalid/i);
  assert.throws(
    () => readRegistrationIntent(intent, { secret: SECRET, now: NOW + REGISTRATION_INTENT_TTL_MS }),
    /expired/i
  );
});
