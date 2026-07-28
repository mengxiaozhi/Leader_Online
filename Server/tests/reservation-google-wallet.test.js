const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const {
  buildReservationGoogleWalletPass,
  buildReservationWalletObjectSuffix,
  createReservationGoogleWalletSaveResult,
  normalizeReservationWalletStage,
  reservationChecklistStatus,
  resolveReservationGoogleWalletConfig,
  rotateReservationVerificationCodes,
} = require('../src/services/reservation-google-wallet');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const env = {
  GOOGLE_WALLET_ISSUER_ID: '1234567890123456789',
  GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL: 'wallet@example.iam.gserviceaccount.com',
  GOOGLE_WALLET_PRIVATE_KEY: privateKey,
  GOOGLE_WALLET_PRIVATE_KEY_ID: 'test-key',
  GOOGLE_WALLET_LOGO_URL: 'https://example.com/pwa/icon-512.png',
  GOOGLE_WALLET_RESERVATION_CLASS_SUFFIX: 'leader_transport',
  GOOGLE_WALLET_RESERVATION_INCLUDE_CLASS: '0',
  PUBLIC_WEB_URL: 'https://example.com',
};

function reservation(overrides = {}) {
  return {
    id: 901,
    user_id: 'member-001',
    ticket_type: '重型機車托運',
    event: '2026 夏季賽事',
    event_title: '2026 夏季賽事',
    event_starts_at: '2026-07-30 09:00:00',
    event_ends_at: '2026-07-31 18:00:00',
    store: '台北交車點',
    store_name: '台北交車點',
    store_address: '台北市中正區測試路 1 號',
    status: 'service_booking',
    verify_code: '123456',
    verify_code_pre_dropoff: '123456',
    verify_code_pre_pickup: '234567',
    verify_code_post_dropoff: '345678',
    verify_code_post_pickup: '456789',
    pre_dropoff_checklist: JSON.stringify({ completed: false }),
    pre_pickup_checklist: JSON.stringify({ completed: false }),
    post_dropoff_checklist: JSON.stringify({ completed: false }),
    post_pickup_checklist: JSON.stringify({ completed: false }),
    ...overrides,
  };
}

function decodedObject(pass) {
  const token = pass.saveUrl.split('/').at(-1);
  return jwt.verify(token, publicKey, { algorithms: ['RS256'] }).payload.genericObjects[0];
}

function transactionalPool(query) {
  const connection = {
    query,
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
  };
  return {
    query,
    async getConnection() {
      return connection;
    },
  };
}

test('reservation object id is stable per reservation and holder but changes after transfer', () => {
  assert.equal(
    buildReservationWalletObjectSuffix(901, 'member-001'),
    buildReservationWalletObjectSuffix(901, 'member-001')
  );
  assert.notEqual(
    buildReservationWalletObjectSuffix(901, 'member-001'),
    buildReservationWalletObjectSuffix(901, 'member-002')
  );
});

test('reservation save result scopes the lookup to the current holder and treats REST 404 as unsaved', async () => {
  const queries = [];
  let outboxPayload = null;
  let outboxObjectId = null;
  let claimed = false;
  const pool = transactionalPool(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('SELECT order_id, user_id FROM reservations')) {
        return [[{ order_id: 77, user_id: 'member-001' }]];
      }
      if (sql.includes('SELECT id FROM orders WHERE id = ?')) return [[{ id: 77 }]];
      if (sql.includes('SELECT id, user_id, order_id FROM reservations')) {
        return [[{ id: 901, user_id: 'member-001', order_id: 77 }]];
      }
      if (sql.includes('FROM reservations r')) return [[reservation()]];
      if (sql.includes('FROM reservation_checklist_photos')) return [[{ photo_count: 0 }]];
      if (sql.includes('INSERT INTO google_wallet_object_sync_jobs')) {
        outboxObjectId = params[3];
        outboxPayload = params[5];
        return [{ affectedRows: 1 }];
      }
      if (
        sql.includes('SELECT id, object_id, action, payload')
        && sql.includes("WHERE status = 'processing' AND lease_owner = ?")
      ) {
        if (claimed) return [[]];
        claimed = true;
        return [[{
          id: 1,
          object_id: outboxObjectId,
          action: 'UPSERT',
          payload: outboxPayload,
          generation: 1,
          attempts: 0,
          max_attempts: 8,
        }]];
      }
      if (sql.includes('WHERE id = ? AND status = \'processing\' AND lease_owner = ?')) {
        return [[]];
      }
      if (sql.includes('google_wallet_object_sync_jobs')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected query: ${sql}`);
  });
  const result = await createReservationGoogleWalletSaveResult({
    pool,
    reservationId: 901,
    holderUserId: 'member-001',
    env,
    request: async () => {
      throw Object.assign(new Error('not found'), { response: { status: 404 } });
    },
  });

  assert.ok(result?.saveUrl);
  assert.match(queries[0].sql, /WHERE id = \? AND user_id = \?/);
  assert.deepEqual(queries[0].params, [901, 'member-001']);
  assert.ok(
    queries.findIndex((entry) => entry.sql.includes('SELECT id FROM orders')) <
    queries.findIndex((entry) => entry.sql.includes('SELECT id, user_id, order_id FROM reservations'))
  );
});

test('reservation save result returns null instead of leaking a foreign reservation', async () => {
  const pool = transactionalPool(async (sql) => {
      if (sql.includes('SELECT order_id, user_id FROM reservations')) return [[]];
      throw new Error(`Unexpected query: ${sql}`);
  });
  const result = await createReservationGoogleWalletSaveResult({
    pool,
    reservationId: 901,
    holderUserId: 'member-foreign',
    env,
    request: async () => {
      throw new Error('REST should not run');
    },
  });

  assert.equal(result, null);
});

test('reservation save result rejects a holder changed after the owner preflight', async () => {
  const calls = [];
  const pool = transactionalPool(async (sql) => {
    calls.push(sql);
    if (sql.includes('SELECT order_id, user_id FROM reservations')) {
      return [[{ order_id: 77, user_id: 'member-001' }]];
    }
    if (sql.includes('SELECT id FROM orders WHERE id = ?')) return [[{ id: 77 }]];
    if (sql.includes('SELECT id, user_id, order_id FROM reservations')) {
      return [[{ id: 901, user_id: 'member-002', order_id: 77 }]];
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  const result = await createReservationGoogleWalletSaveResult({
    pool,
    reservationId: 901,
    holderUserId: 'member-001',
    env,
    request: async () => {
      throw new Error('REST should not run');
    },
  });

  assert.equal(result, null);
  assert.equal(calls.some((sql) => sql.includes('INSERT INTO google_wallet_object_sync_jobs')), false);
});

test('reservation save result survives a transient REST failure and leaves the outbox retryable', async () => {
  const calls = [];
  let payload = null;
  let objectId = null;
  let claimed = false;
  const pool = transactionalPool(async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT order_id, user_id FROM reservations')) {
        return [[{ order_id: 77, user_id: 'member-001' }]];
      }
      if (sql.includes('SELECT id FROM orders WHERE id = ?')) return [[{ id: 77 }]];
      if (sql.includes('SELECT id, user_id, order_id FROM reservations')) {
        return [[{ id: 901, user_id: 'member-001', order_id: 77 }]];
      }
      if (sql.includes('FROM reservations r')) return [[reservation()]];
      if (sql.includes('FROM reservation_checklist_photos')) return [[{ photo_count: 0 }]];
      if (sql.includes('INSERT INTO google_wallet_object_sync_jobs')) {
        objectId = params[3];
        payload = params[5];
        return [{ affectedRows: 1 }];
      }
      if (
        sql.includes('SELECT id, object_id, action, payload')
        && sql.includes("WHERE status = 'processing' AND lease_owner = ?")
      ) {
        if (claimed) return [[]];
        claimed = true;
        return [[{
          id: 2,
          object_id: objectId,
          action: 'UPSERT',
          payload,
          generation: 1,
          attempts: 0,
          max_attempts: 8,
        }]];
      }
      if (sql.includes('WHERE id = ? AND status = \'processing\' AND lease_owner = ?')) {
        return [[]];
      }
      if (sql.includes('google_wallet_object_sync_jobs')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected query: ${sql}`);
  });

  const result = await createReservationGoogleWalletSaveResult({
    pool,
    reservationId: 901,
    holderUserId: 'member-001',
    env,
    request: async () => {
      throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    },
  });

  assert.ok(result?.saveUrl);
  assert.ok(calls.some((call) => call.sql.includes("SET status = 'pending'")));
});

test('reservation pass without a photo requests upload and never exposes a barcode', () => {
  const pass = buildReservationGoogleWalletPass({
    reservation: reservation(),
    photoCount: 0,
    env,
    now: 1_700_000_000_000,
  });
  const object = decodedObject(pass);

  assert.equal(pass.stage, 'pre_dropoff');
  assert.equal(pass.checklistStatus, '待上傳照片');
  assert.equal(pass.barcodeIncluded, false);
  assert.equal(object.barcode, undefined);
  assert.equal(object.state, 'ACTIVE');
  assert.equal(
    object.appLinkData.displayText.defaultValue.value,
    '上傳檢核照片'
  );
  assert.match(
    object.appLinkData.webAppLinkInfo.appTarget.targetUri.uri,
    /\/wallet\?tab=reservations&category=general&reservation=901&action=checklist$/
  );
});

test('reservation pass with photos remains barcode-free until checklist completion', () => {
  const pass = buildReservationGoogleWalletPass({
    reservation: reservation(),
    photoCount: 2,
    env,
    now: 1_700_000_000_000,
  });
  const object = decodedObject(pass);

  assert.equal(pass.checklistStatus, '待完成檢核');
  assert.equal(pass.barcodeIncluded, false);
  assert.equal(object.barcode, undefined);
  assert.equal(object.appLinkData.displayText.defaultValue.value, '完成檢核表');
});

test('completed current-stage checklist with a photo exposes only the current stage code', () => {
  const pass = buildReservationGoogleWalletPass({
    reservation: reservation({
      pre_dropoff_checklist: JSON.stringify({ completed: true }),
    }),
    photoCount: 1,
    env,
    now: 1_700_000_000_000,
  });
  const object = decodedObject(pass);

  assert.equal(pass.checklistStatus, '檢核完成');
  assert.equal(pass.barcodeIncluded, true);
  assert.equal(object.barcode.value, '123456');
  assert.equal(object.appLinkData.displayText.defaultValue.value, '查看托運預約');
  assert.doesNotMatch(JSON.stringify(object), /reservation_checklist_photos|photos\/|data:image/i);
});

test('invalid stage verification code is never emitted even after checklist completion', () => {
  const pass = buildReservationGoogleWalletPass({
    reservation: reservation({
      verify_code_pre_dropoff: 'old-code',
      verify_code: null,
      pre_dropoff_checklist: JSON.stringify({ completed: true }),
    }),
    photoCount: 1,
    env,
    now: 1_700_000_000_000,
  });

  assert.equal(pass.barcodeIncluded, false);
  assert.equal(decodedObject(pass).barcode, undefined);
});

test('done and inactive reservation passes clear old barcodes with terminal states', () => {
  const done = buildReservationGoogleWalletPass({
    reservation: reservation({ status: 'done' }),
    photoCount: 1,
    env,
    now: 1_700_000_000_000,
  });
  const inactive = buildReservationGoogleWalletPass({
    reservation: reservation({
      pre_dropoff_checklist: JSON.stringify({ completed: true }),
    }),
    photoCount: 1,
    inactive: true,
    env,
    now: 1_700_000_000_000,
  });

  assert.equal(decodedObject(done).state, 'COMPLETED');
  assert.equal(decodedObject(done).barcode, undefined);
  assert.equal(done.checklistStatus, '托運完成');
  assert.equal(decodedObject(inactive).state, 'INACTIVE');
  assert.equal(decodedObject(inactive).barcode, undefined);
  assert.equal(inactive.checklistStatus, '票證已失效');
});

test('cancelled reservation order keeps the pass inactive without an explicit sync flag', () => {
  const cancelled = buildReservationGoogleWalletPass({
    reservation: reservation({
      order_details: JSON.stringify({ status: '已取消' }),
      pre_dropoff_checklist: JSON.stringify({ completed: true }),
    }),
    photoCount: 1,
    env,
    now: 1_700_000_000_000,
  });

  assert.equal(cancelled.inactive, true);
  assert.equal(cancelled.barcodeIncluded, false);
  assert.equal(decodedObject(cancelled).state, 'INACTIVE');
  assert.equal(decodedObject(cancelled).barcode, undefined);
});

test('transport class inclusion config prevents multiple Google holders', () => {
  const pass = buildReservationGoogleWalletPass({
    reservation: reservation(),
    photoCount: 0,
    env: {
      ...env,
      GOOGLE_WALLET_RESERVATION_INCLUDE_CLASS: '1',
    },
    signSaveUrl: false,
  });

  assert.equal(pass.genericClass.multipleDevicesAndHoldersAllowedStatus, 'ONE_USER_ALL_DEVICES');
  assert.equal(pass.classId, '1234567890123456789.leader_transport');
});

test('reservation compact JWT keeps all status modules and CTA with production-length credentials', () => {
  const productionEnv = {
    ...env,
    GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL:
      'leader-online-wallet-production@leader-online-production.iam.gserviceaccount.com',
    GOOGLE_WALLET_PRIVATE_KEY_ID: '1234567890abcdef1234567890abcdef12345678',
    GOOGLE_WALLET_RESERVATION_CLASS_SUFFIX: 'leader_online_transport_reservations',
    PUBLIC_WEB_URL: 'https://member.leader-online.example.com',
  };
  const pass = buildReservationGoogleWalletPass({
    reservation: reservation(),
    photoCount: 0,
    env: productionEnv,
    now: 1_700_000_000_000,
  });
  const object = decodedObject(pass);

  assert.equal(object.textModulesData.length, 4);
  assert.deepEqual(
    object.textModulesData.map((module) => module.header),
    ['檔期', '交車', '階段', '檢核']
  );
  assert.equal(
    object.appLinkData.displayText.defaultValue.value,
    '上傳檢核照片'
  );
  assert.equal(
    object.appLinkData.webAppLinkInfo.appTarget.targetUri.description,
    'Open'
  );
  assert.ok(pass.saveUrl.split('/').at(-1).length <= 1800);
});

test('reservation compact JWT remains saveable at maximum displayed field lengths', () => {
  const pass = buildReservationGoogleWalletPass({
    reservation: reservation({
      event_title: '超'.repeat(60),
      ticket_type: '托'.repeat(60),
      store_name: '站'.repeat(120),
      store_address: '址'.repeat(160),
    }),
    photoCount: 0,
    env: {
      ...env,
      GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL:
        'leader-online-wallet-production@leader-online-production.iam.gserviceaccount.com',
      GOOGLE_WALLET_PRIVATE_KEY_ID: '1234567890abcdef1234567890abcdef12345678',
      GOOGLE_WALLET_ISSUER_NAME: '發'.repeat(60),
      GOOGLE_WALLET_RESERVATION_CLASS_SUFFIX: 'leader_online_transport_reservations',
      PUBLIC_WEB_URL: 'https://member.leader-online.example.com',
    },
    now: 1_700_000_000_000,
  });

  assert.equal(decodedObject(pass).textModulesData.length, 4);
  assert.ok(pass.saveUrl.split('/').at(-1).length <= 1800);
});

test('unsigned reservation sync payload does not depend on signing credentials', () => {
  const pass = buildReservationGoogleWalletPass({
    reservation: reservation(),
    photoCount: 0,
    signSaveUrl: false,
    env: {
      GOOGLE_WALLET_ISSUER_ID: env.GOOGLE_WALLET_ISSUER_ID,
      GOOGLE_WALLET_LOGO_URL: env.GOOGLE_WALLET_LOGO_URL,
      GOOGLE_WALLET_RESERVATION_CLASS_SUFFIX: env.GOOGLE_WALLET_RESERVATION_CLASS_SUFFIX,
      GOOGLE_WALLET_RESERVATION_INCLUDE_CLASS: '0',
      GOOGLE_WALLET_SERVICE_ACCOUNT_JSON: 'temporarily-invalid-json',
      PUBLIC_WEB_URL: env.PUBLIC_WEB_URL,
    },
  });

  assert.equal(pass.saveUrl, '');
  assert.equal(pass.object.state, 'ACTIVE');
  assert.match(pass.objectId, /^1234567890123456789\.r_/);
});

test('temporary embedded reservation class mode still produces a signed save URL', () => {
  const pass = buildReservationGoogleWalletPass({
    reservation: reservation(),
    photoCount: 0,
    env: {
      ...env,
      GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL:
        'leader-online-wallet-production@leader-online-production.iam.gserviceaccount.com',
      GOOGLE_WALLET_PRIVATE_KEY_ID: '1234567890abcdef1234567890abcdef12345678',
      GOOGLE_WALLET_RESERVATION_INCLUDE_CLASS: '1',
    },
    now: 1_700_000_000_000,
  });
  const payload = jwt.verify(pass.saveUrl.split('/').at(-1), publicKey, {
    algorithms: ['RS256'],
  }).payload;

  assert.equal(payload.genericClasses.length, 1);
  assert.equal(
    payload.genericClasses[0].multipleDevicesAndHoldersAllowedStatus,
    'ONE_USER_ALL_DEVICES'
  );
});

test('transport pass defaults to its dedicated pre-created class suffix', () => {
  const config = resolveReservationGoogleWalletConfig({
    ...env,
    GOOGLE_WALLET_RESERVATION_CLASS_SUFFIX: '',
    GOOGLE_WALLET_RESERVATION_INCLUDE_CLASS: '',
  });

  assert.equal(
    config.classId,
    '1234567890123456789.leader_online_transport_reservations'
  );
  assert.equal(config.includeClass, false);
});

test('reservation stage and checklist labels normalize the legacy initial state', () => {
  assert.equal(normalizeReservationWalletStage('service_booking'), 'pre_dropoff');
  assert.equal(normalizeReservationWalletStage('pending'), 'pre_dropoff');
  assert.equal(normalizeReservationWalletStage('done'), 'done');
  assert.equal(
    reservationChecklistStatus({ stage: 'pre_pickup', checklist: { completed: false }, photoCount: 1 }),
    '待完成檢核'
  );
});

test('reservation transfer rotates every established stage code in one guarded update', async () => {
  const calls = [];
  const queryable = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
  };
  const generated = ['111111', '111111', '222222', '333333'];
  const result = await rotateReservationVerificationCodes(queryable, {
    id: 901,
    verify_code: 'old-legacy',
    verify_code_pre_dropoff: 'old-pre',
    verify_code_pre_pickup: 'old-pickup',
    verify_code_post_dropoff: null,
    verify_code_post_pickup: null,
  }, {
    generateCode: async () => generated.shift(),
  });

  assert.deepEqual(result, {
    verify_code: '111111',
    verify_code_pre_dropoff: '222222',
    verify_code_pre_pickup: '333333',
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /verify_code_pre_dropoff = \?/);
  assert.doesNotMatch(calls[0].sql, /verify_code_post_dropoff = \?/);
  assert.deepEqual(calls[0].params, ['111111', '222222', '333333', 901]);
});
