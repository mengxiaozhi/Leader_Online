const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const {
  GoogleWalletConfigurationError,
  formatCourseBookingTaipeiTime,
  resolveGoogleWalletConfig,
} = require('../utils/google-wallet');
const {
  enqueueGoogleWalletObjectSync,
  processGoogleWalletObjectSyncJobs,
} = require('./google-wallet-object-sync');

const SAVE_URL_BASE = 'https://pay.google.com/gp/v/save/';
const SAFE_JWT_LENGTH = 1800;
const EMBEDDED_CLASS_JWT_LENGTH = 3000;
const RESERVATION_STAGE_KEYS = ['pre_dropoff', 'pre_pickup', 'post_dropoff', 'post_pickup'];
const RESERVATION_STAGE_SET = new Set(RESERVATION_STAGE_KEYS);
const RESERVATION_STAGE_LABELS = {
  pre_dropoff: '賽前交車',
  pre_pickup: '賽前取車',
  post_dropoff: '賽後交車',
  post_pickup: '賽後取車',
  done: '托運完成',
};
const RESERVATION_STAGE_CODE_COLUMNS = {
  pre_dropoff: 'verify_code_pre_dropoff',
  pre_pickup: 'verify_code_pre_pickup',
  post_dropoff: 'verify_code_post_dropoff',
  post_pickup: 'verify_code_post_pickup',
};
const RESERVATION_STAGE_CHECKLIST_COLUMNS = {
  pre_dropoff: 'pre_dropoff_checklist',
  pre_pickup: 'pre_pickup_checklist',
  post_dropoff: 'post_dropoff_checklist',
  post_pickup: 'post_pickup_checklist',
};

function localizedString(value, fallback = '', max = 60) {
  const normalized = String(value || fallback || '').trim().slice(0, max) || fallback;
  return {
    defaultValue: {
      language: 'zh-TW',
      value: normalized,
    },
  };
}

function compactLocalizedString(value, fallback = '', max = 30) {
  const normalized = String(value || fallback || '').trim().slice(0, max) || fallback;
  return {
    defaultValue: {
      language: 'zh',
      value: normalized,
    },
  };
}

function normalizeReservationWalletStage(value) {
  const status = String(value || '').trim().toLowerCase();
  if (!status || status === 'pending' || status === 'service_booking') return 'pre_dropoff';
  if (status === 'pickup') return 'pre_pickup';
  if (RESERVATION_STAGE_SET.has(status) || status === 'done') return status;
  return '';
}

function parseJsonObject(value) {
  if (!value) return { completed: false };
  if (typeof value === 'object' && !Buffer.isBuffer(value)) return value;
  try {
    const parsed = JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : String(value));
    return parsed && typeof parsed === 'object' ? parsed : { completed: false };
  } catch (_) {
    return { completed: false };
  }
}

function parseChecklist(value) {
  return parseJsonObject(value);
}

function reservationOrderIsCancelled(reservation = {}) {
  const details = parseJsonObject(reservation.order_details);
  const status = String(details.status || '').trim().toLowerCase();
  return status === '已取消' || status === 'cancelled' || status === 'canceled';
}

function reservationChecklistStatus({ stage, checklist, photoCount, inactive = false } = {}) {
  if (inactive) return '票證已失效';
  if (stage === 'done') return '托運完成';
  if (Number(photoCount || 0) <= 0) return '待上傳照片';
  if (!checklist?.completed) return '待完成檢核';
  return '檢核完成';
}

function reservationWalletCta({ stage, checklist, photoCount, inactive = false } = {}) {
  if (inactive || stage === 'done') return '查看托運預約';
  if (Number(photoCount || 0) <= 0) return '上傳檢核照片';
  if (!checklist?.completed) return '完成檢核表';
  return '查看托運預約';
}

function buildReservationWalletObjectSuffix(reservationId, holderUserId) {
  const normalizedReservationId = String(reservationId || '').trim();
  const normalizedHolderId = String(holderUserId || '').trim();
  if (!normalizedReservationId) throw new TypeError('Google Wallet 托運票證缺少預約編號');
  if (!normalizedHolderId) throw new TypeError('Google Wallet 托運票證缺少持有人');
  const digest = crypto
    .createHash('sha256')
    .update(`${normalizedReservationId}:${normalizedHolderId}`)
    .digest('hex')
    .slice(0, 32);
  return `r_${digest}`;
}

function resolveReservationGoogleWalletConfig(env = process.env, options = {}) {
  const includeClass = env.GOOGLE_WALLET_RESERVATION_INCLUDE_CLASS;
  return resolveGoogleWalletConfig({
    ...env,
    GOOGLE_WALLET_CLASS_ID: env.GOOGLE_WALLET_RESERVATION_CLASS_ID || '',
    GOOGLE_WALLET_CLASS_SUFFIX:
      env.GOOGLE_WALLET_RESERVATION_CLASS_SUFFIX || 'leader_online_transport_reservations',
    GOOGLE_WALLET_INCLUDE_CLASS:
      includeClass === undefined || includeClass === null || includeClass === ''
        ? '0'
        : includeClass,
  }, options);
}

function validReservationStageCode(value) {
  return /^\d{6}$/.test(String(value || '').replace(/\s+/g, ''));
}

function reservationStageCode(reservation, stage) {
  if (!reservation || !stage || stage === 'done') return '';
  const column = RESERVATION_STAGE_CODE_COLUMNS[stage];
  const code = column ? reservation[column] : '';
  if (code) return String(code).replace(/\s+/g, '');
  if (stage === 'pre_dropoff' && reservation.verify_code) {
    return String(reservation.verify_code).replace(/\s+/g, '');
  }
  return '';
}

function formatServiceWindow(reservation = {}) {
  const startsAt = reservation.event_starts_at ?? reservation.starts_at;
  const endsAt = reservation.event_ends_at ?? reservation.ends_at;
  if (!startsAt || !endsAt) return '';
  try {
    return formatCourseBookingTaipeiTime(startsAt, endsAt);
  } catch (_) {
    return '';
  }
}

function normalizeWebBase(env = process.env) {
  const raw = String(env.PUBLIC_WEB_URL || 'http://localhost:5173').trim().replace(/\/+$/, '');
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return 'http://localhost:5173';
    return url.href.replace(/\/+$/, '');
  } catch (_) {
    return 'http://localhost:5173';
  }
}

function reservationChecklistLink(reservationId, env = process.env) {
  const base = normalizeWebBase(env);
  const query = new URLSearchParams({
    tab: 'reservations',
    category: 'general',
    reservation: String(reservationId),
    action: 'checklist',
  });
  return `${base}/wallet?${query.toString()}`;
}

function signSavePayload(config, walletPayload, now = Date.now(), {
  includeKeyId = true,
  maxLength = SAFE_JWT_LENGTH,
} = {}) {
  const payload = {
    iss: config.serviceAccountEmail,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Number(now) / 1000),
    origins: config.origins,
    payload: walletPayload,
  };
  const options = { algorithm: 'RS256' };
  if (includeKeyId && config.privateKeyId) options.keyid = config.privateKeyId;
  const token = jwt.sign(payload, config.signingKey, options);
  if (token.length > maxLength) {
    const error = new Error('Google Wallet JWT 過長，請先建立托運 Pass Class 並關閉 JWT 內嵌 Class');
    error.code = 'GOOGLE_WALLET_JWT_TOO_LONG';
    error.actualLength = token.length;
    throw error;
  }
  return token;
}

function buildReservationGoogleWalletPass({
  reservation,
  holderUserId,
  photoCount = 0,
  inactive = false,
  signSaveUrl = true,
  env = process.env,
  now = Date.now(),
} = {}) {
  const reservationId = String(reservation?.id || '').trim();
  const ownerId = String(holderUserId || reservation?.user_id || '').trim();
  if (!reservationId || !ownerId) {
    throw new TypeError('Google Wallet 托運票證缺少預約或持有人資料');
  }
  const config = resolveReservationGoogleWalletConfig(env, {
    requireSigningKey: signSaveUrl,
  });
  const objectId = `${config.issuerId}.${buildReservationWalletObjectSuffix(reservationId, ownerId)}`;
  const stage = normalizeReservationWalletStage(reservation.status);
  if (!stage) throw new TypeError('Google Wallet 托運票證缺少有效階段');
  const effectiveInactive = inactive || reservationOrderIsCancelled(reservation);
  const checklistColumn = RESERVATION_STAGE_CHECKLIST_COLUMNS[stage];
  const checklist = checklistColumn ? parseChecklist(reservation[checklistColumn]) : { completed: false };
  const checklistStatus = reservationChecklistStatus({
    stage,
    checklist,
    photoCount,
    inactive: effectiveInactive,
  });
  const ctaText = reservationWalletCta({
    stage,
    checklist,
    photoCount,
    inactive: effectiveInactive,
  });
  const code = reservationStageCode(reservation, stage);
  const includeBarcode = !effectiveInactive
    && stage !== 'done'
    && checklist.completed === true
    && Number(photoCount || 0) > 0
    && validReservationStageCode(code);
  const eventTitle = String(
    reservation.event_title || reservation.event || '托運預約'
  ).trim().slice(0, 60) || '托運預約';
  const ticketType = String(reservation.ticket_type || '托運服務').trim().slice(0, 60) || '托運服務';
  const storeName = String(
    reservation.store_name || reservation.store || '交車點待確認'
  ).trim().slice(0, 120) || '交車點待確認';
  const storeAddress = String(reservation.store_address || '').trim().slice(0, 160);
  const deliveryPoint = `${storeName}${storeAddress ? ` · ${storeAddress}` : ''}`;
  const serviceWindow = formatServiceWindow(reservation);
  const deepLink = reservationChecklistLink(reservationId, env);
  const state = effectiveInactive ? 'INACTIVE' : (stage === 'done' ? 'COMPLETED' : 'ACTIVE');

  const textModulesData = [
    {
      id: 'service_window',
      header: '服務檔期',
      body: serviceWindow ? `${eventTitle}\n${serviceWindow}` : eventTitle,
    },
    {
      id: 'delivery_point',
      header: '交車點',
      body: deliveryPoint,
    },
    {
      id: 'current_stage',
      header: '目前階段',
      body: RESERVATION_STAGE_LABELS[stage] || stage,
    },
    {
      id: 'checklist_status',
      header: '檢核狀態',
      body: checklistStatus,
    },
  ];

  const genericObject = {
    id: objectId,
    classId: config.classId,
    state,
    cardTitle: localizedString(config.issuerName, 'Leader Online'),
    subheader: localizedString(ticketType, '托運服務'),
    header: localizedString(eventTitle, '托運預約'),
    logo: {
      sourceUri: { uri: config.logoUrl },
    },
    textModulesData,
    appLinkData: {
      webAppLinkInfo: {
        appTarget: {
          targetUri: {
            uri: deepLink,
            description: ctaText,
          },
        },
      },
      displayText: localizedString(ctaText, '查看托運預約', 30),
    },
    ...(includeBarcode ? {
      barcode: {
        type: 'QR_CODE',
        value: code,
        alternateText: code,
      },
    } : {}),
  };
  const genericClass = {
    id: config.classId,
    issuerName: config.issuerName,
    reviewStatus: 'UNDER_REVIEW',
    multipleDevicesAndHoldersAllowedStatus: 'ONE_USER_ALL_DEVICES',
  };
  const walletPayloadFor = (object) => ({
    ...(config.includeClass ? { genericClasses: [genericClass] } : {}),
    genericObjects: [object],
  });
  let token = '';
  let saveObject = genericObject;
  if (signSaveUrl) {
    try {
      token = signSavePayload(config, walletPayloadFor(genericObject), now);
    } catch (error) {
      if (error?.code !== 'GOOGLE_WALLET_JWT_TOO_LONG') throw error;
      const compactModules = textModulesData.map((module) => ({
        header: {
          service_window: '檔期',
          delivery_point: '交車',
          current_stage: '階段',
          checklist_status: '檢核',
        }[module.id] || module.header,
        body: module.id === 'service_window'
          ? String(serviceWindow || eventTitle).slice(0, 40)
          : (module.id === 'delivery_point'
              ? storeName.slice(0, 6)
              : String(module.body || '').slice(0, 16)),
      }));
      saveObject = {
        id: genericObject.id,
        classId: genericObject.classId,
        state: genericObject.state,
        cardTitle: compactLocalizedString(config.issuerName, 'Leader', 8),
        header: compactLocalizedString(eventTitle, '托運預約', 8),
        textModulesData: compactModules,
        appLinkData: {
          webAppLinkInfo: {
            appTarget: {
              targetUri: {
                uri: deepLink,
                description: 'Open',
              },
            },
          },
          displayText: compactLocalizedString(ctaText, '查看預約', 20),
        },
        ...(genericObject.barcode ? {
          barcode: {
            type: genericObject.barcode.type,
            value: genericObject.barcode.value,
          },
        } : {}),
      };
      token = signSavePayload(config, walletPayloadFor(saveObject), now, {
        includeKeyId: false,
        maxLength: config.includeClass ? EMBEDDED_CLASS_JWT_LENGTH : SAFE_JWT_LENGTH,
      });
    }
  }
  return {
    saveUrl: token ? `${SAVE_URL_BASE}${token}` : '',
    objectId,
    classId: config.classId,
    object: genericObject,
    saveObject,
    genericClass,
    stage,
    checklistStatus,
    photoCount: Number(photoCount || 0),
    barcodeIncluded: includeBarcode,
    inactive: effectiveInactive,
  };
}

function ownerClause(holderUserId) {
  return holderUserId == null ? { sql: '', params: [] } : {
    sql: ' AND r.user_id = ?',
    params: [String(holderUserId)],
  };
}

async function loadReservationGoogleWalletRecord(queryable, reservationId, {
  holderUserId = null,
} = {}) {
  const id = Number(reservationId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const owner = ownerClause(holderUserId);
  let rows;
  try {
    [rows] = await queryable.query(
      `SELECT r.*,
              COALESCE(e.title, r.event) AS event_title,
              DATE_FORMAT(e.starts_at, '%Y-%m-%d %H:%i:%s') AS event_starts_at,
              DATE_FORMAT(e.ends_at, '%Y-%m-%d %H:%i:%s') AS event_ends_at,
              COALESCE(s.name, r.store) AS store_name,
              s.address AS store_address,
              o.details AS order_details
         FROM reservations r
         LEFT JOIN events e ON e.id = r.event_id
         LEFT JOIN event_stores s ON s.id = r.store_id
         LEFT JOIN orders o ON o.id = r.order_id
        WHERE r.id = ?${owner.sql}
        LIMIT 1`,
      [id, ...owner.params]
    );
  } catch (error) {
    if (error?.code !== 'ER_BAD_FIELD_ERROR') throw error;
    [rows] = await queryable.query(
      `SELECT r.*, r.event AS event_title, r.store AS store_name,
              o.details AS order_details
         FROM reservations r
         LEFT JOIN orders o ON o.id = r.order_id
        WHERE r.id = ?${owner.sql}
        LIMIT 1`,
      [id, ...owner.params]
    );
  }
  return rows?.[0] || null;
}

async function countReservationStagePhotos(queryable, reservationId, stage) {
  if (!RESERVATION_STAGE_SET.has(stage)) return 0;
  const [[row]] = await queryable.query(
    `SELECT COUNT(*) AS photo_count
       FROM reservation_checklist_photos
      WHERE reservation_id = ? AND stage = ?`,
    [reservationId, stage]
  );
  return Number(row?.photo_count || 0);
}

async function rotateReservationVerificationCodes(queryable, reservation, {
  generateCode,
} = {}) {
  if (!queryable || typeof queryable.query !== 'function') {
    throw new TypeError('旋轉托運驗證碼時缺少資料庫連線');
  }
  if (typeof generateCode !== 'function') {
    throw new TypeError('旋轉托運驗證碼時缺少產生器');
  }
  const fields = [
    'verify_code',
    'verify_code_pre_dropoff',
    'verify_code_pre_pickup',
    'verify_code_post_dropoff',
    'verify_code_post_pickup',
  ];
  const seen = new Set();
  const entries = [];
  for (const field of fields) {
    if (!reservation?.[field]) continue;
    let code;
    do {
      code = String(await generateCode(queryable));
    } while (!code || seen.has(code));
    seen.add(code);
    entries.push([field, code]);
  }
  if (!entries.length) return {};
  await queryable.query(
    `UPDATE reservations
        SET ${entries.map(([field]) => `${field} = ?`).join(', ')}
      WHERE id = ?`,
    [...entries.map(([, code]) => code), reservation.id]
  );
  return Object.fromEntries(entries);
}

async function buildReservationGoogleWalletPassFromDatabase({
  queryable,
  reservationId,
  holderUserId = null,
  inactive = false,
  signSaveUrl = true,
  env = process.env,
  now = Date.now(),
} = {}) {
  const reservation = await loadReservationGoogleWalletRecord(queryable, reservationId, { holderUserId });
  if (!reservation) return null;
  const stage = normalizeReservationWalletStage(reservation.status);
  const effectiveInactive = inactive || reservationOrderIsCancelled(reservation);
  const photoCount = effectiveInactive || stage === 'done'
    ? 0
    : await countReservationStagePhotos(queryable, reservation.id, stage);
  return buildReservationGoogleWalletPass({
    reservation,
    holderUserId: holderUserId || reservation.user_id,
    photoCount,
    inactive: effectiveInactive,
    signSaveUrl,
    env,
    now,
  });
}

async function enqueueReservationGoogleWalletPass(queryable, pass, {
  reservationId,
  holderUserId,
  inactive = false,
} = {}) {
  return enqueueGoogleWalletObjectSync(queryable, {
    resourceType: 'reservation',
    resourceId: reservationId,
    holderUserId,
    objectId: pass.objectId,
    action: inactive ? 'INACTIVATE' : 'UPSERT',
    payload: pass.object,
  });
}

async function queueReservationGoogleWalletSync({
  pool,
  queryable = pool,
  reservationId,
  holderUserId = null,
  inactive = false,
  immediate = true,
  env = process.env,
  request,
  logger = console,
} = {}) {
  const pass = await buildReservationGoogleWalletPassFromDatabase({
    queryable,
    reservationId,
    holderUserId,
    inactive,
    signSaveUrl: false,
    env,
  });
  if (!pass) return { queued: false, reason: 'not_found' };
  await enqueueReservationGoogleWalletPass(queryable, pass, {
    reservationId,
    holderUserId: holderUserId || null,
    inactive: pass.inactive,
  });
  if (immediate && queryable === pool) {
    await processGoogleWalletObjectSyncJobs({
      pool,
      env,
      request,
      objectId: pass.objectId,
      limit: 1,
      logger,
    });
  }
  return { queued: true, pass };
}

async function inactivateReservationGoogleWalletForHolder({
  pool,
  queryable = pool,
  reservation,
  holderUserId,
  immediate = true,
  env = process.env,
  logger = console,
} = {}) {
  const pass = buildReservationGoogleWalletPass({
    reservation,
    holderUserId,
    photoCount: 0,
    inactive: true,
    signSaveUrl: false,
    env,
  });
  await enqueueReservationGoogleWalletPass(queryable, pass, {
    reservationId: reservation.id,
    holderUserId,
    inactive: true,
  });
  if (immediate && queryable === pool) {
    await processGoogleWalletObjectSyncJobs({
      pool,
      env,
      objectId: pass.objectId,
      limit: 1,
      logger,
    });
  }
  return { queued: true, pass };
}

async function createReservationGoogleWalletSaveResult({
  pool,
  reservationId,
  holderUserId,
  env = process.env,
  request,
} = {}) {
  const id = Number(reservationId);
  const ownerId = String(holderUserId || '').trim();
  if (!Number.isFinite(id) || id <= 0 || !ownerId) return null;

  let pass = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [candidateRows] = await pool.query(
      'SELECT order_id, user_id FROM reservations WHERE id = ? AND user_id = ? LIMIT 1',
      [id, ownerId]
    );
    const candidate = candidateRows?.[0] || null;
    if (!candidate) return null;

    const conn = await pool.getConnection();
    let transactionStarted = false;
    let retryWithCurrentOrder = false;
    try {
      await conn.beginTransaction();
      transactionStarted = true;
      if (candidate.order_id) {
        await conn.query(
          'SELECT id FROM orders WHERE id = ? LIMIT 1 FOR UPDATE',
          [candidate.order_id]
        );
      }
      const [lockedRows] = await conn.query(
        'SELECT id, user_id, order_id FROM reservations WHERE id = ? LIMIT 1 FOR UPDATE',
        [id]
      );
      const locked = lockedRows?.[0] || null;
      if (!locked || String(locked.user_id) !== ownerId) {
        await conn.rollback();
        transactionStarted = false;
        return null;
      }
      if (String(locked.order_id || '') !== String(candidate.order_id || '')) {
        await conn.rollback();
        transactionStarted = false;
        retryWithCurrentOrder = true;
      } else {
        pass = await buildReservationGoogleWalletPassFromDatabase({
          queryable: conn,
          reservationId: id,
          holderUserId: ownerId,
          env,
        });
        if (!pass) {
          await conn.rollback();
          transactionStarted = false;
          return null;
        }
        await enqueueReservationGoogleWalletPass(conn, pass, {
          reservationId: id,
          holderUserId: ownerId,
          inactive: pass.inactive,
        });
        await conn.commit();
        transactionStarted = false;
      }
    } catch (error) {
      if (transactionStarted) {
        try { await conn.rollback(); } catch (_) {}
      }
      throw error;
    } finally {
      conn.release();
    }
    if (!retryWithCurrentOrder) break;
  }

  if (!pass) {
    const error = new Error('托運預約在建立 Google Wallet 票證時已變更，請重試');
    error.code = 'RESERVATION_WALLET_CONFLICT';
    throw error;
  }
  await processGoogleWalletObjectSyncJobs({
    pool,
    env,
    request,
    objectId: pass.objectId,
    limit: 1,
  });
  return pass;
}

function isGoogleWalletConfigurationError(error) {
  return error instanceof GoogleWalletConfigurationError
    || error?.code === 'GOOGLE_WALLET_NOT_CONFIGURED';
}

module.exports = {
  RESERVATION_STAGE_KEYS,
  RESERVATION_STAGE_LABELS,
  buildReservationGoogleWalletPass,
  buildReservationGoogleWalletPassFromDatabase,
  buildReservationWalletObjectSuffix,
  countReservationStagePhotos,
  createReservationGoogleWalletSaveResult,
  enqueueReservationGoogleWalletPass,
  inactivateReservationGoogleWalletForHolder,
  isGoogleWalletConfigurationError,
  loadReservationGoogleWalletRecord,
  normalizeReservationWalletStage,
  queueReservationGoogleWalletSync,
  reservationChecklistStatus,
  reservationOrderIsCancelled,
  reservationStageCode,
  reservationWalletCta,
  resolveReservationGoogleWalletConfig,
  rotateReservationVerificationCodes,
  validReservationStageCode,
};
