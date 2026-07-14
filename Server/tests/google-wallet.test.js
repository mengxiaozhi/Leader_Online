const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const {
  GoogleWalletConfigurationError,
  buildGoogleWalletSaveUrl,
  buildObjectSuffix,
  membershipLabel,
} = require('../src/utils/google-wallet');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const baseEnv = {
  GOOGLE_WALLET_ISSUER_ID: '1234567890123456789',
  GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL: 'wallet@example.iam.gserviceaccount.com',
  GOOGLE_WALLET_PRIVATE_KEY: privateKey,
  GOOGLE_WALLET_PRIVATE_KEY_ID: 'test-key-id',
  GOOGLE_WALLET_CLASS_SUFFIX: 'leader_members',
  GOOGLE_WALLET_LOGO_URL: 'https://example.com/pwa/icon-512.png',
  PUBLIC_WEB_URL: 'https://example.com/account',
};

test('buildGoogleWalletSaveUrl signs one stable loyalty card for the member', () => {
  const first = buildGoogleWalletSaveUrl({
    user: { id: 'member-001', username: '王小明', role: 'USER', isVip: true },
    env: baseEnv,
    now: 1_700_000_000_000,
  });
  const second = buildGoogleWalletSaveUrl({
    user: { id: 'member-001', username: '王小明', role: 'USER', isVip: true },
    env: baseEnv,
    now: 1_700_000_100_000,
  });

  assert.match(first.saveUrl, /^https:\/\/pay\.google\.com\/gp\/v\/save\//);
  assert.equal(first.objectId, second.objectId);
  assert.equal(first.objectId, `1234567890123456789.${buildObjectSuffix('member-001')}`);

  const token = first.saveUrl.split('/').at(-1);
  assert.ok(token.length <= 1800);
  const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
  assert.equal(decoded.aud, 'google');
  assert.equal(decoded.typ, 'savetowallet');
  assert.deepEqual(decoded.origins, ['https://example.com']);
  assert.equal(decoded.payload.loyaltyClasses[0].id, '1234567890123456789.leader_members');
  assert.equal(decoded.payload.loyaltyObjects[0].accountId, 'member-001');
  assert.equal(decoded.payload.loyaltyObjects[0].barcode.value, 'member-001');
  assert.equal(decoded.payload.loyaltyObjects[0].textModulesData[0].body, 'VIP 會員');
});

test('buildGoogleWalletSaveUrl can reference a Pass Class created in Wallet Console', () => {
  const result = buildGoogleWalletSaveUrl({
    user: { id: 'member-002', username: '測試會員', role: 'ADMIN' },
    env: { ...baseEnv, GOOGLE_WALLET_INCLUDE_CLASS: '0' },
    now: 1_700_000_000_000,
  });
  const token = result.saveUrl.split('/').at(-1);
  const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });

  assert.equal(decoded.payload.loyaltyClasses, undefined);
  assert.equal(decoded.payload.loyaltyObjects[0].textModulesData[0].body, '管理員');
});

test('missing issuer credentials fails without creating an unsigned link', () => {
  assert.throws(
    () => buildGoogleWalletSaveUrl({ user: { id: 'member-003' }, env: {} }),
    (error) => {
      assert.ok(error instanceof GoogleWalletConfigurationError);
      assert.equal(error.code, 'GOOGLE_WALLET_NOT_CONFIGURED');
      assert.ok(error.missing.includes('GOOGLE_WALLET_ISSUER_ID'));
      return true;
    }
  );
});

test('membership labels match the existing member card roles', () => {
  assert.equal(membershipLabel({ role: 'ADMIN', isVip: true }), '管理員');
  assert.equal(membershipLabel({ role: 'USER', isVip: true }), 'VIP 會員');
  assert.equal(membershipLabel({ role: 'DELIVERY_POINT' }), '交車點');
});
