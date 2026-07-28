const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const {
  GoogleWalletConfigurationError,
  buildCourseBookingGoogleWalletSaveUrl,
  buildCourseBookingObjectSuffix,
  buildGoogleWalletSaveUrl,
  buildObjectSuffix,
  formatCourseBookingTaipeiTime,
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

test('course booking Google Wallet pass uses a stable CBK Generic Object and redemption validity window', () => {
  const booking = {
    id: 501,
    verifyCode: 'CBK-AABBCCDDEEFF0011',
    productName: '進階產品設計',
    sessionCode: 'CS-20260730-A',
    sessionTitle: '使用者訪談工作坊',
    startsAt: '2026-07-30 09:00:00',
    endsAt: '2026-07-30 11:00:00',
    validFrom: '2026-07-29T23:00:00.000Z',
    validUntil: '2026-07-31T03:00:00.000Z',
    location: '教室 A',
    ticketCode: 'CT-COURSE-001',
  };
  const env = {
    ...baseEnv,
    GOOGLE_WALLET_INCLUDE_CLASS: '0',
    GOOGLE_WALLET_COURSE_CLASS_SUFFIX: 'leader_course_bookings',
  };
  const first = buildCourseBookingGoogleWalletSaveUrl({
    booking,
    env,
    now: 1_700_000_000_000,
  });
  const second = buildCourseBookingGoogleWalletSaveUrl({
    booking,
    env,
    now: 1_700_000_100_000,
  });

  assert.equal(first.objectId, second.objectId);
  assert.equal(
    first.objectId,
    `1234567890123456789.${buildCourseBookingObjectSuffix(501, booking.verifyCode)}`
  );
  assert.notEqual(
    first.objectId,
    `1234567890123456789.${buildCourseBookingObjectSuffix(501, 'CBK-1122334455667788')}`
  );

  const token = first.saveUrl.split('/').at(-1);
  assert.ok(token.length <= 1800);
  const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
  const genericObject = decoded.payload.genericObjects[0];

  assert.equal(decoded.payload.genericClasses[0].id, '1234567890123456789.leader_course_bookings');
  assert.equal(genericObject.classId, '1234567890123456789.leader_course_bookings');
  assert.equal(genericObject.barcode.type, 'QR_CODE');
  assert.equal(genericObject.barcode.value, booking.verifyCode);
  assert.equal(genericObject.barcode.alternateText, booking.verifyCode);
  assert.equal(genericObject.header.defaultValue.value, booking.sessionTitle);
  assert.equal(
    genericObject.subheader.defaultValue.value,
    `${booking.productName} · ${booking.ticketCode}`
  );
  assert.deepEqual(genericObject.validTimeInterval, {
    start: { date: booking.validFrom },
    end: { date: booking.validUntil },
  });
  assert.deepEqual(genericObject.textModulesData, [{
    id: 'booking_time',
    header: '預約時間',
    body: '2026/07/30 09:00–11:00（台灣時間）',
  }]);
});

test('course booking pass can use a pre-created Generic Class without reusing the member class', () => {
  const result = buildCourseBookingGoogleWalletSaveUrl({
    booking: {
      id: 502,
      verifyCode: 'CBK-0011223344556677',
      sessionTitle: 'Google Wallet 測試場次',
      startsAt: '2026-08-01T01:00:00.000Z',
      endsAt: '2026-08-01T02:00:00.000Z',
      validFrom: '2026-07-31T23:00:00.000Z',
      validUntil: '2026-08-02T02:00:00.000Z',
    },
    env: {
      ...baseEnv,
      GOOGLE_WALLET_CLASS_ID: '1234567890123456789.member_class',
      GOOGLE_WALLET_COURSE_CLASS_ID: '1234567890123456789.course_class',
      GOOGLE_WALLET_COURSE_INCLUDE_CLASS: '0',
    },
    now: 1_700_000_000_000,
  });
  const token = result.saveUrl.split('/').at(-1);
  const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });

  assert.equal(decoded.payload.genericClasses, undefined);
  assert.equal(decoded.payload.genericObjects[0].classId, '1234567890123456789.course_class');
  assert.equal(result.classId, '1234567890123456789.course_class');
});

test('course booking pass falls back to a compact payload for long CJK labels', () => {
  const longLabel = '超長課程名稱測試'.repeat(12);
  const result = buildCourseBookingGoogleWalletSaveUrl({
    booking: {
      id: 503,
      verifyCode: 'CBK-ABCDEF0123456789',
      productName: longLabel,
      sessionTitle: longLabel,
      ticketCode: 'CT-' + '9'.repeat(40),
      startsAt: '2026-08-02 09:00:00',
      endsAt: '2026-08-02 10:00:00',
      validFrom: '2026-08-01T23:00:00.000Z',
      validUntil: '2026-08-03T02:00:00.000Z',
    },
    env: {
      ...baseEnv,
      GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL:
        'leader-google-wallet-production@example-project.iam.gserviceaccount.com',
      GOOGLE_WALLET_PRIVATE_KEY_ID: 'a'.repeat(40),
      GOOGLE_WALLET_LOGO_URL:
        'https://cdn.example.com/leader-online/google-wallet/course/logo-production-512.png',
      GOOGLE_WALLET_ORIGINS:
        'https://www.example.com,https://members.example.com',
      GOOGLE_WALLET_COURSE_CLASS_SUFFIX: 'leader_online_course_bookings',
    },
    now: 1_700_000_000_000,
  });
  const token = result.saveUrl.split('/').at(-1);
  const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
  const genericObject = decoded.payload.genericObjects[0];

  assert.ok(token.length <= 1800);
  assert.equal(genericObject.barcode.value, 'CBK-ABCDEF0123456789');
  assert.equal(genericObject.validTimeInterval.start.date, '2026-08-01T23:00:00.000Z');
  assert.equal(genericObject.validTimeInterval.end.date, '2026-08-03T02:00:00.000Z');
  assert.equal(genericObject.logo, undefined);
  assert.equal(genericObject.subheader, undefined);
  assert.ok([...genericObject.header.defaultValue.value].length <= 20);
  assert.deepEqual(genericObject.textModulesData, [{
    id: 'booking_time',
    header: '預約時間',
    body: '2026/08/02 09:00–10:00（台灣時間）',
  }]);
});

test('course booking pass displays both Taiwan dates when the session crosses midnight', () => {
  assert.equal(
    formatCourseBookingTaipeiTime('2026-07-30 23:00:00', '2026-07-31 01:00:00'),
    '2026/07/30 23:00–2026/07/31 01:00（台灣時間）'
  );
  assert.equal(
    formatCourseBookingTaipeiTime(
      '2026-07-30T15:00:00.000Z',
      '2026-07-30T17:00:00.000Z'
    ),
    '2026/07/30 23:00–2026/07/31 01:00（台灣時間）'
  );
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

test('invalid private key is reported as a configuration error before signing', () => {
  assert.throws(
    () => buildGoogleWalletSaveUrl({
      user: { id: 'member-invalid-key' },
      env: {
        ...baseEnv,
        GOOGLE_WALLET_PRIVATE_KEY: '0123456789abcdef0123456789abcdef01234567',
      },
    }),
    (error) => {
      assert.ok(error instanceof GoogleWalletConfigurationError);
      assert.equal(error.code, 'GOOGLE_WALLET_NOT_CONFIGURED');
      assert.match(error.message, /RSA PEM 私鑰/);
      return true;
    }
  );
});

test('base64 service account JSON supplies the RSA signing key', () => {
  const serviceAccountJson = Buffer.from(JSON.stringify({
    client_email: baseEnv.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL,
    private_key: privateKey,
    private_key_id: baseEnv.GOOGLE_WALLET_PRIVATE_KEY_ID,
  })).toString('base64');
  const result = buildGoogleWalletSaveUrl({
    user: { id: 'member-base64-json', username: 'Base64 測試會員' },
    env: {
      GOOGLE_WALLET_ISSUER_ID: baseEnv.GOOGLE_WALLET_ISSUER_ID,
      GOOGLE_WALLET_SERVICE_ACCOUNT_JSON: serviceAccountJson,
      GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL: 'stale@example.iam.gserviceaccount.com',
      GOOGLE_WALLET_PRIVATE_KEY: '0123456789abcdef0123456789abcdef01234567',
      GOOGLE_WALLET_PRIVATE_KEY_ID: 'stale-key-id',
      GOOGLE_WALLET_CLASS_SUFFIX: baseEnv.GOOGLE_WALLET_CLASS_SUFFIX,
      GOOGLE_WALLET_LOGO_URL: baseEnv.GOOGLE_WALLET_LOGO_URL,
      GOOGLE_WALLET_INCLUDE_CLASS: '0',
    },
    now: 1_700_000_000_000,
  });
  const token = result.saveUrl.split('/').at(-1);
  const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });

  assert.equal(decoded.iss, baseEnv.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL);
});

test('membership labels match the existing member card roles', () => {
  assert.equal(membershipLabel({ role: 'ADMIN', isVip: true }), '管理員');
  assert.equal(membershipLabel({ role: 'USER', isVip: true }), 'VIP 會員');
  assert.equal(membershipLabel({ role: 'DELIVERY_POINT' }), '交車點');
});
