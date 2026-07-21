const crypto = require('crypto');

const {
  normalizeRegistrationName,
  isValidRegistrationName,
} = require('./registration-name');

const REGISTRATION_INTENT_TTL_MS = 5 * 60 * 1000;
const TOKEN_VERSION = 'ri1';
const TOKEN_AAD = Buffer.from('leader-online.registration-intent.v1', 'utf8');
const MAX_TOKEN_LENGTH = 4096;

class RegistrationIntentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RegistrationIntentError';
    this.code = code;
  }
}

function normalizeSecret(secret) {
  const value = String(secret || '');
  if (!value) {
    throw new RegistrationIntentError('REGISTRATION_INTENT_SECRET_MISSING', 'Registration intent secret is not configured');
  }
  return value;
}

function deriveKey(secret) {
  return crypto
    .createHash('sha256')
    .update('leader-online.registration-intent.key.v1\0', 'utf8')
    .update(normalizeSecret(secret), 'utf8')
    .digest();
}

function encodePart(value) {
  return Buffer.from(value).toString('base64url');
}

function decodePart(value) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new RegistrationIntentError('REGISTRATION_INTENT_INVALID', 'Registration intent is invalid');
  }
  return Buffer.from(value, 'base64url');
}

function encryptPayload(payload, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  cipher.setAAD(TOKEN_AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [TOKEN_VERSION, encodePart(iv), encodePart(ciphertext), encodePart(tag)].join('.');
}

function decryptPayload(token, secret) {
  const text = String(token || '').trim();
  if (!text || text.length > MAX_TOKEN_LENGTH) {
    throw new RegistrationIntentError('REGISTRATION_INTENT_INVALID', 'Registration intent is invalid');
  }
  const parts = text.split('.');
  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) {
    throw new RegistrationIntentError('REGISTRATION_INTENT_INVALID', 'Registration intent is invalid');
  }

  try {
    const iv = decodePart(parts[1]);
    const ciphertext = decodePart(parts[2]);
    const tag = decodePart(parts[3]);
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
      throw new RegistrationIntentError('REGISTRATION_INTENT_INVALID', 'Registration intent is invalid');
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(secret), iv);
    decipher.setAAD(TOKEN_AAD);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const payload = JSON.parse(plaintext);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new RegistrationIntentError('REGISTRATION_INTENT_INVALID', 'Registration intent is invalid');
    }
    return payload;
  } catch (error) {
    if (error instanceof RegistrationIntentError) throw error;
    throw new RegistrationIntentError('REGISTRATION_INTENT_INVALID', 'Registration intent is invalid');
  }
}

function normalizeNow(now) {
  const value = Number(now);
  return Number.isFinite(value) ? Math.floor(value) : Date.now();
}

function validateLifetime(payload, now) {
  const issuedAt = Number(payload?.iat);
  const expiresAt = Number(payload?.exp);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
    throw new RegistrationIntentError('REGISTRATION_INTENT_INVALID', 'Registration intent is invalid');
  }
  if (issuedAt > now + 60 * 1000) {
    throw new RegistrationIntentError('REGISTRATION_INTENT_INVALID', 'Registration intent is invalid');
  }
  if (now >= expiresAt) {
    throw new RegistrationIntentError('REGISTRATION_INTENT_EXPIRED', 'Registration intent has expired');
  }
  return { issuedAt, expiresAt };
}

function issueRegistrationIntent({ registrationName, secret, now = Date.now(), ttlMs = REGISTRATION_INTENT_TTL_MS }) {
  const name = normalizeRegistrationName(registrationName);
  if (!isValidRegistrationName(name)) {
    throw new RegistrationIntentError('REGISTRATION_NAME_INVALID', 'Registration name is invalid');
  }
  const issuedAt = normalizeNow(now);
  const lifetime = Math.max(1, Math.min(REGISTRATION_INTENT_TTL_MS, Number(ttlMs) || REGISTRATION_INTENT_TTL_MS));
  return encryptPayload({
    purpose: 'registration-intent',
    registrationName: name,
    jti: crypto.randomBytes(16).toString('base64url'),
    iat: issuedAt,
    exp: issuedAt + lifetime,
  }, secret);
}

function readRegistrationIntent(intent, { secret, now = Date.now() }) {
  const payload = decryptPayload(intent, secret);
  const currentTime = normalizeNow(now);
  const { expiresAt } = validateLifetime(payload, currentTime);
  const registrationName = normalizeRegistrationName(payload.registrationName);
  if (payload.purpose !== 'registration-intent' || !isValidRegistrationName(registrationName) || !payload.jti) {
    throw new RegistrationIntentError('REGISTRATION_INTENT_INVALID', 'Registration intent is invalid');
  }
  return {
    registrationName,
    intentId: String(payload.jti),
    expiresAt,
  };
}

function bindRegistrationIntentToState(intent, { state, secret, now = Date.now() }) {
  const oauthState = String(state || '').trim();
  if (!oauthState) {
    throw new RegistrationIntentError('OAUTH_STATE_INVALID', 'OAuth state is invalid');
  }
  const currentTime = normalizeNow(now);
  const registration = readRegistrationIntent(intent, { secret, now: currentTime });
  return encryptPayload({
    purpose: 'oauth-registration-context',
    registrationName: registration.registrationName,
    jti: registration.intentId,
    state: oauthState,
    iat: currentTime,
    exp: Math.min(registration.expiresAt, currentTime + REGISTRATION_INTENT_TTL_MS),
  }, secret);
}

function readBoundRegistrationIntent(context, { state, secret, now = Date.now() }) {
  const oauthState = String(state || '').trim();
  const payload = decryptPayload(context, secret);
  const currentTime = normalizeNow(now);
  validateLifetime(payload, currentTime);
  const registrationName = normalizeRegistrationName(payload.registrationName);
  if (
    payload.purpose !== 'oauth-registration-context'
    || !oauthState
    || String(payload.state || '') !== oauthState
    || !isValidRegistrationName(registrationName)
    || !payload.jti
  ) {
    throw new RegistrationIntentError('REGISTRATION_INTENT_STATE_MISMATCH', 'Registration intent does not match OAuth state');
  }
  return {
    registrationName,
    intentId: String(payload.jti),
  };
}

module.exports = {
  REGISTRATION_INTENT_TTL_MS,
  RegistrationIntentError,
  issueRegistrationIntent,
  readRegistrationIntent,
  bindRegistrationIntentToState,
  readBoundRegistrationIntent,
};
