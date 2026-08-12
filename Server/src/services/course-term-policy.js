'use strict';

const { createHash } = require('crypto');

const TERM_PRICING_MODES = new Set([
  'FULL_TERM',
  'PRO_RATA_SESSIONS',
  'UNIT_X_REMAINING',
  'PRO_RATA_CALENDAR',
]);

const TERM_PAYMENT_METHODS = new Set([
  'BANK_TRANSFER',
  'COURSE_TICKET',
]);

function courseTermError(code, message, statusCode = 409, details = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

function text(value, max = 255) {
  return String(value ?? '').trim().slice(0, max);
}

function integer(value, fallback = null) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveInteger(value, fallback = null) {
  const parsed = integer(value, fallback);
  return parsed !== null && parsed > 0 ? parsed : fallback;
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function money(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function stableStringify(value, seen = new WeakSet()) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value !== 'object') return JSON.stringify(String(value));
  if (seen.has(value)) return '"[Circular]"';
  seen.add(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry, seen)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key], seen)}`).join(',')}}`;
}

function requestHash(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function dateMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const input = text(value, 64);
  if (!input) return NaN;
  if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(input)) {
    const normalized = input.replace(' ', 'T');
    return Date.parse(`${normalized.length === 10 ? `${normalized}T00:00:00` : normalized}+08:00`);
  }
  return Date.parse(input);
}

function mysqlDateTime(value) {
  const timestamp = dateMs(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

function normalizePricingMode(value, fallback = 'FULL_TERM') {
  const normalized = text(value, 32).toUpperCase();
  return TERM_PRICING_MODES.has(normalized) ? normalized : fallback;
}

function normalizePaymentMethod(value, fallback = 'BANK_TRANSFER') {
  const normalized = text(value, 32).toUpperCase();
  if (!TERM_PAYMENT_METHODS.has(normalized)) {
    throw courseTermError('COURSE_TERM_PAYMENT_METHOD_INVALID', '不支援此固定班付款方式', 400);
  }
  return normalized || fallback;
}

function activeTermSessions(sessions = []) {
  return sessions
    .filter((session) => !['cancelled', 'canceled'].includes(text(session.status, 24).toLowerCase()))
    .sort((left, right) => {
      const time = dateMs(left.starts_at ?? left.startsAt) - dateMs(right.starts_at ?? right.startsAt);
      if (Number.isFinite(time) && time !== 0) return time;
      return Number(left.id || 0) - Number(right.id || 0);
    });
}

function selectEnrollmentSessions(sessions = [], startSessionId = null) {
  const active = activeTermSessions(sessions);
  if (!active.length) {
    throw courseTermError('COURSE_TERM_HAS_NO_SESSIONS', '此班期尚未建立可報名堂次', 409);
  }
  if (!startSessionId) return active;
  const index = active.findIndex((session) => Number(session.id) === Number(startSessionId));
  if (index < 0) {
    throw courseTermError('COURSE_TERM_START_SESSION_INVALID', '插班起始堂次不屬於此班期', 400);
  }
  return active.slice(index);
}

function calendarRatio({ term, startSession, now = Date.now() }) {
  const startsAt = dateMs(term?.starts_on ?? term?.startsOn ?? term?.starts_at ?? term?.startsAt);
  const endsAt = dateMs(term?.ends_on ?? term?.endsOn ?? term?.ends_at ?? term?.endsAt);
  const selectedAt = dateMs(startSession?.starts_at ?? startSession?.startsAt ?? now);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) return 1;
  return Math.max(0, Math.min(1, (endsAt - Math.max(startsAt, selectedAt)) / (endsAt - startsAt)));
}

function calculateTermQuote({
  term = {},
  pricingRule = {},
  sessions = [],
  startSessionId = null,
  now = Date.now(),
} = {}) {
  const allSessions = activeTermSessions(sessions);
  const selectedSessions = selectEnrollmentSessions(allSessions, startSessionId);
  const pricingMode = normalizePricingMode(
    pricingRule.pricing_mode ?? pricingRule.pricingMode ?? term.pricing_mode ?? term.pricingMode,
    startSessionId ? 'PRO_RATA_SESSIONS' : 'FULL_TERM'
  );
  const fullPrice = money(
    pricingRule.full_price ?? pricingRule.fullPrice ?? term.full_price ?? term.fullPrice,
    0
  );
  const unitPrice = money(
    pricingRule.unit_price ?? pricingRule.unitPrice,
    allSessions.length ? fullPrice / allSessions.length : fullPrice
  );
  let subtotal = fullPrice;
  if (pricingMode === 'PRO_RATA_SESSIONS') {
    subtotal = allSessions.length ? fullPrice * selectedSessions.length / allSessions.length : 0;
  } else if (pricingMode === 'UNIT_X_REMAINING') {
    subtotal = unitPrice * selectedSessions.length;
  } else if (pricingMode === 'PRO_RATA_CALENDAR') {
    subtotal = fullPrice * calendarRatio({ term, startSession: selectedSessions[0], now });
  }
  subtotal = money(subtotal, 0);
  return {
    pricingMode,
    currency: text(pricingRule.currency ?? term.currency ?? 'TWD', 3).toUpperCase() || 'TWD',
    fullPrice,
    unitPrice,
    totalSessionCount: allSessions.length,
    selectedSessionCount: selectedSessions.length,
    sessionIds: selectedSessions.map((session) => Number(session.id)),
    startSessionId: Number(selectedSessions[0]?.id || 0) || null,
    subtotal,
    totalAmount: subtotal,
  };
}

function termCapacity({ capacity = null, activeAllocations = 0 } = {}) {
  const normalizedCapacity = capacity === null || capacity === undefined || capacity === ''
    ? null
    : Math.max(0, integer(capacity, 0));
  const allocated = Math.max(0, integer(activeAllocations, 0));
  return {
    capacity: normalizedCapacity,
    allocated,
    available: normalizedCapacity === null ? null : Math.max(0, normalizedCapacity - allocated),
    full: normalizedCapacity !== null && allocated >= normalizedCapacity,
  };
}

function bankTransferDeadline({ now = Date.now(), hours = 24 } = {}) {
  const normalizedHours = Math.max(1, Math.min(168, positiveInteger(hours, 24)));
  return mysqlDateTime(dateMs(now) + normalizedHours * 60 * 60 * 1000);
}

function canCancelTermLeave({ leave, entitlement, now = Date.now() } = {}) {
  if (!leave || !entitlement) return false;
  if (text(leave.status, 24).toUpperCase() !== 'APPROVED') return false;
  if (!['LEAVE', 'EXCUSED_LEAVE'].includes(text(entitlement.status, 32).toUpperCase())) return false;
  const closeAt = dateMs(leave.cancel_close_at ?? leave.cancelCloseAt);
  return Number.isFinite(closeAt) && dateMs(now) <= closeAt;
}

function ensureRowVersion(actual, expected, resource = '資料') {
  const expectedVersion = positiveInteger(expected, null);
  if (!expectedVersion) {
    throw courseTermError('COURSE_ROW_VERSION_REQUIRED', `${resource}操作需要 If-Match`, 428);
  }
  if (Number(actual || 1) !== expectedVersion) {
    throw courseTermError('COURSE_ROW_VERSION_CONFLICT', `${resource}已更新，請重新載入`, 412);
  }
  return expectedVersion;
}

function assertIdempotencyKey(value) {
  const key = text(value, 128);
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw courseTermError('IDEMPOTENCY_KEY_REQUIRED', '此操作需要 8 至 128 字元的 Idempotency-Key', 428);
  }
  return key;
}

module.exports = {
  TERM_PAYMENT_METHODS,
  TERM_PRICING_MODES,
  activeTermSessions,
  assertIdempotencyKey,
  bankTransferDeadline,
  booleanValue,
  calculateTermQuote,
  canCancelTermLeave,
  courseTermError,
  dateMs,
  ensureRowVersion,
  integer,
  money,
  mysqlDateTime,
  normalizePaymentMethod,
  normalizePricingMode,
  positiveInteger,
  requestHash,
  selectEnrollmentSessions,
  stableStringify,
  termCapacity,
  text,
};
