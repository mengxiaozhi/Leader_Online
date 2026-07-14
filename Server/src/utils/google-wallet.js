const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const SAVE_URL_BASE = 'https://pay.google.com/gp/v/save/';
const SAFE_JWT_LENGTH = 1800;
const ID_PART_PATTERN = /^[A-Za-z0-9._-]+$/;

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
  return String(value || '').replace(/\\n/g, '\n').trim();
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

function resolveGoogleWalletConfig(env = process.env) {
  const serviceAccount = parseServiceAccount(env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON);
  const issuerId = String(env.GOOGLE_WALLET_ISSUER_ID || '').trim();
  const serviceAccountEmail = String(
    env.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL || serviceAccount?.client_email || ''
  ).trim();
  const privateKey = normalizePrivateKey(
    env.GOOGLE_WALLET_PRIVATE_KEY || serviceAccount?.private_key || ''
  );
  const privateKeyId = String(
    env.GOOGLE_WALLET_PRIVATE_KEY_ID || serviceAccount?.private_key_id || ''
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
  if (!serviceAccountEmail) missing.push('GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL');
  if (!privateKey) missing.push('GOOGLE_WALLET_PRIVATE_KEY');
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

  const configuredOrigins = String(env.GOOGLE_WALLET_ORIGINS || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);
  const publicOrigin = normalizeOrigin(publicWebUrl);
  const origins = Array.from(new Set([...configuredOrigins, publicOrigin].filter(Boolean)));

  return {
    issuerId,
    serviceAccountEmail,
    privateKey,
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

  const payload = {
    iss: config.serviceAccountEmail,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Number(now) / 1000),
    origins: config.origins,
    payload: {
      ...(config.includeClass ? { loyaltyClasses: [loyaltyClass] } : {}),
      loyaltyObjects: [loyaltyObject],
    },
  };
  const signOptions = { algorithm: 'RS256' };
  if (config.privateKeyId) signOptions.keyid = config.privateKeyId;
  const token = jwt.sign(payload, config.privateKey, signOptions);
  if (token.length > SAFE_JWT_LENGTH) {
    const err = new Error('Google Wallet JWT 過長，請先建立 Pass Class 並將 GOOGLE_WALLET_INCLUDE_CLASS 設為 0');
    err.code = 'GOOGLE_WALLET_JWT_TOO_LONG';
    throw err;
  }
  return {
    saveUrl: `${SAVE_URL_BASE}${token}`,
    objectId,
    classId: config.classId,
  };
}

module.exports = {
  GoogleWalletConfigurationError,
  buildGoogleWalletSaveUrl,
  buildObjectSuffix,
  membershipLabel,
  resolveGoogleWalletConfig,
};
