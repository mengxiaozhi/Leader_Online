const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const SAVE_URL_BASE = 'https://pay.google.com/gp/v/save/';
const SAFE_JWT_LENGTH = 1800;
const ID_PART_PATTERN = /^[A-Za-z0-9._-]+$/;
const COURSE_MYSQL_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const TAIPEI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

class GoogleWalletConfigurationError extends Error {
  constructor(message, missing = []) {
    super(message);
    this.name = 'GoogleWalletConfigurationError';
    this.code = 'GOOGLE_WALLET_NOT_CONFIGURED';
    this.missing = missing;
  }
}

function parseServiceAccount(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;

  const candidates = [raw];
  if (!raw.startsWith('{')) {
    try {
      candidates.push(Buffer.from(raw, 'base64').toString('utf8'));
    } catch (_) {}
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (_) {}
  }
  throw new GoogleWalletConfigurationError('Google Wallet Service Account JSON 格式不正確');
}

function normalizePrivateKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const normalized = raw.replace(/\\n/g, '\n').trim();
  if (normalized.includes('-----BEGIN ')) return normalized;

  try {
    const decoded = Buffer.from(normalized, 'base64').toString('utf8').trim();
    if (decoded.includes('-----BEGIN ')) {
      return decoded.replace(/\\n/g, '\n').trim();
    }
  } catch (_) {}

  return normalized;
}

function parseSigningKey(value) {
  const privateKey = normalizePrivateKey(value);
  if (!privateKey) return null;

  let signingKey;
  try {
    signingKey = crypto.createPrivateKey(privateKey);
  } catch (_) {
    throw new GoogleWalletConfigurationError(
      'GOOGLE_WALLET_PRIVATE_KEY 必須是完整的 RSA PEM 私鑰；private_key_id 不能當作私鑰使用'
    );
  }

  if (signingKey.asymmetricKeyType !== 'rsa') {
    throw new GoogleWalletConfigurationError(
      'GOOGLE_WALLET_PRIVATE_KEY 必須是 RSA 私鑰'
    );
  }

  return signingKey;
}

function normalizeHttpsUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : '';
  } catch (_) {
    return '';
  }
}

function normalizeOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.origin;
  } catch (_) {
    return '';
  }
}

function normalizeIdPart(value, fallback = '') {
  const normalized = String(value || '').trim();
  if (normalized && ID_PART_PATTERN.test(normalized)) return normalized;
  return fallback;
}

function resolveGoogleWalletConfig(env = process.env, {
  requireSigningKey = true,
} = {}) {
  const serviceAccount = requireSigningKey
    ? parseServiceAccount(env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON)
    : null;
  const issuerId = String(env.GOOGLE_WALLET_ISSUER_ID || '').trim();
  const serviceAccountEmail = String(
    serviceAccount?.client_email || env.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL || ''
  ).trim();
  const privateKeyValue =
    serviceAccount?.private_key || env.GOOGLE_WALLET_PRIVATE_KEY || '';
  const privateKeyId = String(
    serviceAccount?.private_key_id || env.GOOGLE_WALLET_PRIVATE_KEY_ID || ''
  ).trim();
  const classSuffix = normalizeIdPart(
    env.GOOGLE_WALLET_CLASS_SUFFIX || 'leader_online_members'
  );
  const explicitClassId = normalizeIdPart(env.GOOGLE_WALLET_CLASS_ID);
  const publicWebUrl = String(env.PUBLIC_WEB_URL || '').replace(/\/+$/, '');
  const logoUrl = normalizeHttpsUrl(
    env.GOOGLE_WALLET_LOGO_URL || (publicWebUrl ? `${publicWebUrl}/pwa/icon-512.png` : '')
  );

  const missing = [];
  if (!/^\d+$/.test(issuerId)) missing.push('GOOGLE_WALLET_ISSUER_ID');
  if (requireSigningKey && !serviceAccountEmail) missing.push('GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL');
  if (requireSigningKey && !String(privateKeyValue || '').trim()) {
    missing.push('GOOGLE_WALLET_PRIVATE_KEY');
  }
  if (!classSuffix && !explicitClassId) missing.push('GOOGLE_WALLET_CLASS_SUFFIX');
  if (!logoUrl) missing.push('GOOGLE_WALLET_LOGO_URL');
  if (missing.length) {
    throw new GoogleWalletConfigurationError(
      `Google Wallet 尚未完成設定：${missing.join('、')}`,
      missing
    );
  }

  const classId = explicitClassId || `${issuerId}.${classSuffix}`;
  if (!classId.startsWith(`${issuerId}.`)) {
    throw new GoogleWalletConfigurationError('GOOGLE_WALLET_CLASS_ID 必須屬於目前的 Issuer ID');
  }

  const signingKey = requireSigningKey ? parseSigningKey(privateKeyValue) : null;
  const configuredOrigins = String(env.GOOGLE_WALLET_ORIGINS || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);
  const publicOrigin = normalizeOrigin(publicWebUrl);
  const origins = Array.from(new Set([...configuredOrigins, publicOrigin].filter(Boolean)));

  return {
    issuerId,
    serviceAccountEmail,
    signingKey,
    privateKeyId,
    classId,
    includeClass: String(env.GOOGLE_WALLET_INCLUDE_CLASS || '1') !== '0',
    issuerName: String(env.GOOGLE_WALLET_ISSUER_NAME || 'Leader Online').trim().slice(0, 60),
    programName: String(env.GOOGLE_WALLET_PROGRAM_NAME || 'Leader Online 會員卡').trim().slice(0, 60),
    logoUrl,
    origins,
  };
}

function membershipLabel(user = {}) {
  const role = String(user.role || 'USER').trim().toUpperCase();
  if (role === 'ADMIN') return '管理員';
  if (Boolean(user.isVip ?? user.is_vip ?? user.vip)) return 'VIP 會員';
  const roleLabels = {
    USER: '一般會員',
    SERVICE_PROVIDER: '服務商',
    STORE: '服務商',
    DRIVER: '司機',
    DELIVERY_POINT: '交車點',
    EDITOR: '編輯',
  };
  return roleLabels[role] || '一般會員';
}

function buildObjectSuffix(userId) {
  const digest = crypto.createHash('sha256').update(String(userId)).digest('hex').slice(0, 32);
  return `member_${digest}`;
}

function normalizeCourseBookingCode(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

function buildCourseBookingObjectSuffix(bookingId, verifyCode) {
  const normalizedBookingId = String(bookingId || '').trim();
  const normalizedVerifyCode = normalizeCourseBookingCode(verifyCode);
  if (!normalizedBookingId) throw new TypeError('Google Wallet 課程票券缺少預約編號');
  if (!/^CBK-[A-F0-9]{16,32}$/.test(normalizedVerifyCode)) {
    throw new TypeError('Google Wallet 課程票券缺少有效核銷碼');
  }
  const digest = crypto
    .createHash('sha256')
    .update(`${normalizedBookingId}:${normalizedVerifyCode}`)
    .digest('hex')
    .slice(0, 32);
  return `course_booking_${digest}`;
}

function resolveCourseGoogleWalletConfig(env = process.env) {
  const courseIncludeClass = env.GOOGLE_WALLET_COURSE_INCLUDE_CLASS;
  return resolveGoogleWalletConfig({
    ...env,
    GOOGLE_WALLET_CLASS_ID: env.GOOGLE_WALLET_COURSE_CLASS_ID || '',
    GOOGLE_WALLET_CLASS_SUFFIX:
      env.GOOGLE_WALLET_COURSE_CLASS_SUFFIX || 'leader_online_course_bookings',
    GOOGLE_WALLET_INCLUDE_CLASS:
      courseIncludeClass === undefined || courseIncludeClass === null || courseIncludeClass === ''
        ? '1'
        : courseIncludeClass,
  });
}

function localizedString(value, fallback, max = 60) {
  const normalized = String(value || fallback || '').trim().slice(0, max) || fallback;
  return {
    defaultValue: {
      language: 'zh-TW',
      value: normalized,
    },
  };
}

function googleWalletDateTime(value, fieldName) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Google Wallet 課程票券缺少有效${fieldName}`);
  }
  return { date: date.toISOString() };
}

function courseBookingDateTime(value, fieldName = '課程時間') {
  if (value instanceof Date || typeof value === 'number') {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  } else {
    const normalized = String(value ?? '').trim();
    const mysqlMatch = COURSE_MYSQL_DATETIME_PATTERN.exec(normalized);
    if (mysqlMatch) {
      const [, year, month, day, hour, minute, second = '0', milliseconds = '0'] = mysqlMatch;
      const parts = {
        year: Number(year),
        month: Number(month),
        day: Number(day),
        hour: Number(hour),
        minute: Number(minute),
        second: Number(second),
        milliseconds: Number(milliseconds.padEnd(3, '0')),
      };
      const timestamp = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
        parts.milliseconds
      ) - TAIPEI_UTC_OFFSET_MS;
      const taipeiWallTime = new Date(timestamp + TAIPEI_UTC_OFFSET_MS);
      const isValid = taipeiWallTime.getUTCFullYear() === parts.year
        && taipeiWallTime.getUTCMonth() + 1 === parts.month
        && taipeiWallTime.getUTCDate() === parts.day
        && taipeiWallTime.getUTCHours() === parts.hour
        && taipeiWallTime.getUTCMinutes() === parts.minute
        && taipeiWallTime.getUTCSeconds() === parts.second;
      if (isValid) return new Date(timestamp);
    } else if (normalized) {
      const date = new Date(normalized);
      if (!Number.isNaN(date.getTime())) return date;
    }
  }
  throw new TypeError(`Google Wallet 課程票券缺少有效${fieldName}`);
}

function courseBookingTaipeiParts(value, fieldName) {
  const date = courseBookingDateTime(value, fieldName);
  const taipeiWallTime = new Date(date.getTime() + TAIPEI_UTC_OFFSET_MS);
  return {
    timestamp: date.getTime(),
    year: String(taipeiWallTime.getUTCFullYear()).padStart(4, '0'),
    month: String(taipeiWallTime.getUTCMonth() + 1).padStart(2, '0'),
    day: String(taipeiWallTime.getUTCDate()).padStart(2, '0'),
    hour: String(taipeiWallTime.getUTCHours()).padStart(2, '0'),
    minute: String(taipeiWallTime.getUTCMinutes()).padStart(2, '0'),
  };
}

function formatCourseBookingTaipeiTime(startsAt, endsAt) {
  const start = courseBookingTaipeiParts(startsAt, '開始時間');
  const end = courseBookingTaipeiParts(endsAt, '結束時間');
  if (end.timestamp <= start.timestamp) {
    throw new TypeError('Google Wallet 課程票券結束時間需晚於開始時間');
  }
  const startDate = `${start.year}/${start.month}/${start.day}`;
  const endDate = `${end.year}/${end.month}/${end.day}`;
  const startTime = `${start.hour}:${start.minute}`;
  const endTime = `${end.hour}:${end.minute}`;
  const range = startDate === endDate
    ? `${startDate} ${startTime}–${endTime}`
    : `${startDate} ${startTime}–${endDate} ${endTime}`;
  return `${range}（台灣時間）`;
}

function signGoogleWalletPayload(config, walletPayload, now) {
  const payload = {
    iss: config.serviceAccountEmail,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Number(now) / 1000),
    origins: config.origins,
    payload: walletPayload,
  };
  const signOptions = { algorithm: 'RS256' };
  if (config.privateKeyId) signOptions.keyid = config.privateKeyId;
  const token = jwt.sign(payload, config.signingKey, signOptions);
  if (token.length > SAFE_JWT_LENGTH) {
    const err = new Error('Google Wallet JWT 過長，請先建立 Pass Class 並關閉 JWT 內嵌 Class');
    err.code = 'GOOGLE_WALLET_JWT_TOO_LONG';
    throw err;
  }
  return token;
}

function isGoogleWalletJwtTooLong(error) {
  return error?.code === 'GOOGLE_WALLET_JWT_TOO_LONG';
}

function buildGoogleWalletSaveUrl({ user, env = process.env, now = Date.now() } = {}) {
  const memberId = String(user?.id || '').trim();
  if (!memberId) throw new TypeError('Google Wallet 會員卡缺少會員編號');

  const config = resolveGoogleWalletConfig(env);
  const objectId = `${config.issuerId}.${buildObjectSuffix(memberId)}`;
  const displayName = String(user?.username || user?.email || '會員').trim().slice(0, 60) || '會員';

  const loyaltyClass = {
    id: config.classId,
    issuerName: config.issuerName,
    reviewStatus: 'UNDER_REVIEW',
    programName: config.programName,
    programLogo: {
      sourceUri: { uri: config.logoUrl },
      contentDescription: {
        defaultValue: { language: 'zh-TW', value: `${config.issuerName} 標誌` },
      },
    },
    hexBackgroundColor: '#1a1a1a',
  };

  const loyaltyObject = {
    id: objectId,
    classId: config.classId,
    state: 'ACTIVE',
    accountName: displayName,
    accountId: memberId,
    barcode: {
      type: 'QR_CODE',
      value: memberId,
      alternateText: memberId,
    },
    textModulesData: [{
      id: 'membership',
      header: '會員身份',
      body: membershipLabel(user),
    }],
  };

  const token = signGoogleWalletPayload(config, {
    ...(config.includeClass ? { loyaltyClasses: [loyaltyClass] } : {}),
    loyaltyObjects: [loyaltyObject],
  }, now);
  return {
    saveUrl: `${SAVE_URL_BASE}${token}`,
    objectId,
    classId: config.classId,
  };
}

function buildCourseBookingGoogleWalletSaveUrl({
  booking,
  env = process.env,
  now = Date.now(),
} = {}) {
  const bookingId = String(booking?.id || '').trim();
  const verifyCode = normalizeCourseBookingCode(booking?.verifyCode ?? booking?.verify_code);
  const objectSuffix = buildCourseBookingObjectSuffix(bookingId, verifyCode);
  const config = resolveCourseGoogleWalletConfig(env);
  const objectId = `${config.issuerId}.${objectSuffix}`;
  const sessionTitle = String(
    booking?.sessionTitle ?? booking?.session_title ?? booking?.productName ?? booking?.product_name ?? '課程票券'
  ).trim().slice(0, 60) || '課程票券';
  const productName = String(
    booking?.productName ?? booking?.product_name ?? sessionTitle
  ).trim().slice(0, 60) || sessionTitle;
  const ticketCode = String(booking?.ticketCode ?? booking?.ticket_code ?? '').trim().slice(0, 60);
  const validFrom = booking?.validFrom ?? booking?.valid_from;
  const validUntil = booking?.validUntil ?? booking?.valid_until;
  const startsAt = booking?.startsAt ?? booking?.starts_at;
  const endsAt = booking?.endsAt ?? booking?.ends_at;
  const courseAndTicket = `${productName}${ticketCode ? ` · ${ticketCode}` : ''}`.slice(0, 60);
  const bookingTime = formatCourseBookingTaipeiTime(startsAt, endsAt);
  const bookingTimeModule = {
    id: 'booking_time',
    header: '預約時間',
    body: bookingTime,
  };

  const genericObject = {
    id: objectId,
    classId: config.classId,
    state: 'ACTIVE',
    cardTitle: localizedString(config.issuerName, 'Leader Online'),
    subheader: localizedString(courseAndTicket, '課程票券'),
    header: localizedString(sessionTitle, '課程票券'),
    logo: {
      sourceUri: { uri: config.logoUrl },
    },
    barcode: {
      type: 'QR_CODE',
      value: verifyCode,
      alternateText: verifyCode,
    },
    validTimeInterval: {
      start: googleWalletDateTime(validFrom, '有效開始時間'),
      end: googleWalletDateTime(validUntil, '有效截止時間'),
    },
    textModulesData: [bookingTimeModule],
  };

  const walletPayloadFor = (object) => ({
    ...(config.includeClass ? { genericClasses: [{ id: config.classId }] } : {}),
    genericObjects: [object],
  });
  let token;
  try {
    token = signGoogleWalletPayload(config, walletPayloadFor(genericObject), now);
  } catch (error) {
    if (!isGoogleWalletJwtTooLong(error)) throw error;
    const compactObject = {
      id: objectId,
      classId: config.classId,
      state: 'ACTIVE',
      cardTitle: localizedString(config.issuerName, 'Leader Online', 20),
      header: localizedString(sessionTitle, '課程票券', 20),
      barcode: {
        type: 'QR_CODE',
        value: verifyCode,
        alternateText: verifyCode,
      },
      validTimeInterval: genericObject.validTimeInterval,
      textModulesData: [bookingTimeModule],
    };
    token = signGoogleWalletPayload(config, walletPayloadFor(compactObject), now);
  }
  return {
    saveUrl: `${SAVE_URL_BASE}${token}`,
    objectId,
    classId: config.classId,
  };
}

module.exports = {
  GoogleWalletConfigurationError,
  buildCourseBookingGoogleWalletSaveUrl,
  buildCourseBookingObjectSuffix,
  buildGoogleWalletSaveUrl,
  buildObjectSuffix,
  courseBookingDateTime,
  formatCourseBookingTaipeiTime,
  membershipLabel,
  resolveCourseGoogleWalletConfig,
  resolveGoogleWalletConfig,
};
