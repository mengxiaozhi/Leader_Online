const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DEFAULT_POLICY = Object.freeze({
  timezone: 'Asia/Taipei',
  bookingOpenMinutesBefore: 30 * 24 * 60,
  bookingCloseMinutesBefore: 0,
  cancelCloseMinutesBefore: 0,
  redeemOpenMinutesBefore: 120,
  redeemCloseMinutesAfter: 24 * 60,
  attendanceInviteExpiryMinutes: 24 * 60,
  autoNoShow: false,
});

function finiteNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nonNegativeNumber(value, fallback = null) {
  const parsed = finiteNumber(value, fallback);
  return parsed !== null && parsed >= 0 ? parsed : fallback;
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function rowValue(row, camel, snake = camel.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)) {
  if (!row || typeof row !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(row, camel)) return row[camel];
  return row[snake];
}

function taipeiDateTimeMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const input = String(value ?? '').trim();
  if (!input) return NaN;
  if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)?$/.test(input)) {
    const normalized = input.replace(' ', 'T');
    const withTime = normalized.length === 10 ? `${normalized}T00:00:00` : normalized;
    return Date.parse(`${withTime}+08:00`);
  }
  return Date.parse(input);
}

function addMinutes(timestamp, minutes) {
  return timestamp + minutes * 60 * 1000;
}

function firstDefined(rows, camel, fallback = undefined) {
  for (const row of rows) {
    const value = rowValue(row, camel);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

function resolveBaseWindow({
  session = {},
  providerSettings = {},
  platformSettings = {},
  absoluteField,
  relativeField,
  anchorMs,
  direction,
  defaultValue,
}) {
  const absolute = rowValue(session, absoluteField);
  const absoluteMs = taipeiDateTimeMs(absolute);
  if (Number.isFinite(absoluteMs)) return absoluteMs;
  const relative = nonNegativeNumber(firstDefined(
    [session, providerSettings, platformSettings],
    relativeField,
    defaultValue
  ), defaultValue);
  return addMinutes(anchorMs, direction * relative);
}

function resolveCoursePolicy({
  session = {},
  providerSettings = {},
  platformSettings = {},
  scenario = {},
  allowedProduct = {},
  ticketProduct = {},
  now = Date.now(),
} = {}) {
  const startsAt = taipeiDateTimeMs(rowValue(session, 'startsAt'));
  const endsAt = taipeiDateTimeMs(rowValue(session, 'endsAt'));
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
    const error = new Error('課程場次起訖時間不正確');
    error.code = 'COURSE_SESSION_TIME_INVALID';
    error.statusCode = 409;
    throw error;
  }

  const bookingOpenAt = resolveBaseWindow({
    session,
    providerSettings,
    platformSettings,
    absoluteField: 'bookingOpenAt',
    relativeField: 'bookingOpenMinutesBefore',
    anchorMs: startsAt,
    direction: -1,
    defaultValue: DEFAULT_POLICY.bookingOpenMinutesBefore,
  });
  const bookingCloseAt = resolveBaseWindow({
    session,
    providerSettings,
    platformSettings,
    absoluteField: 'bookingCloseAt',
    relativeField: 'bookingCloseMinutesBefore',
    anchorMs: startsAt,
    direction: -1,
    defaultValue: DEFAULT_POLICY.bookingCloseMinutesBefore,
  });
  const cancelCloseAt = resolveBaseWindow({
    session,
    providerSettings,
    platformSettings,
    absoluteField: 'cancelCloseAt',
    relativeField: 'cancelCloseMinutesBefore',
    anchorMs: startsAt,
    direction: -1,
    defaultValue: DEFAULT_POLICY.cancelCloseMinutesBefore,
  });

  const baseRedeemOpenAt = resolveBaseWindow({
    session,
    providerSettings,
    platformSettings,
    absoluteField: 'redeemOpenAt',
    relativeField: 'redeemOpenMinutesBefore',
    anchorMs: startsAt,
    direction: -1,
    defaultValue: DEFAULT_POLICY.redeemOpenMinutesBefore,
  });
  const baseRedeemCloseAt = resolveBaseWindow({
    session,
    providerSettings,
    platformSettings,
    absoluteField: 'redeemCloseAt',
    relativeField: 'redeemCloseMinutesAfter',
    anchorMs: endsAt,
    direction: 1,
    defaultValue: DEFAULT_POLICY.redeemCloseMinutesAfter,
  });

  // Scenario and ticket product policies can only narrow the operational
  // window. A sale or ticket change must never silently broaden a session.
  const narrowingOpens = [scenario, allowedProduct, ticketProduct]
    .map((row) => nonNegativeNumber(rowValue(row, 'redeemOpenMinutesBefore')))
    .filter((value) => value !== null)
    .map((minutes) => addMinutes(startsAt, -minutes));
  const narrowingCloses = [scenario, allowedProduct, ticketProduct]
    .map((row) => nonNegativeNumber(rowValue(row, 'redeemCloseMinutesAfter')))
    .filter((value) => value !== null)
    .map((minutes) => addMinutes(endsAt, minutes));
  const redeemOpenAt = Math.max(baseRedeemOpenAt, ...narrowingOpens);
  const redeemCloseAt = Math.min(baseRedeemCloseAt, ...narrowingCloses);
  const inviteExpiryMinutes = nonNegativeNumber(firstDefined(
    [providerSettings, platformSettings],
    'attendanceInviteExpiresMinutes',
    DEFAULT_POLICY.attendanceInviteExpiryMinutes
  ), DEFAULT_POLICY.attendanceInviteExpiryMinutes);
  const autoNoShow = booleanValue(firstDefined(
    [providerSettings, platformSettings],
    'autoNoShow',
    DEFAULT_POLICY.autoNoShow
  ), DEFAULT_POLICY.autoNoShow);
  const effectiveNow = taipeiDateTimeMs(now);

  return {
    timezone: 'Asia/Taipei',
    startsAt,
    endsAt,
    bookingOpenAt,
    bookingCloseAt,
    cancelCloseAt,
    redeemOpenAt,
    redeemCloseAt,
    inviteExpiryMinutes,
    autoNoShow,
    canBook: effectiveNow >= bookingOpenAt && effectiveNow <= bookingCloseAt,
    canCancel: effectiveNow <= cancelCloseAt,
    canRedeemOnsite: effectiveNow >= redeemOpenAt && effectiveNow <= redeemCloseAt,
    pendingReview: effectiveNow > redeemCloseAt,
  };
}

function derivePendingReview(booking, policy, now = Date.now()) {
  return String(booking?.status || '').toLowerCase() === 'booked'
    && taipeiDateTimeMs(now) > Number(policy?.redeemCloseAt);
}

function normalizeTicketCandidate(ticket = {}) {
  const remainingUses = finiteNumber(
    rowValue(ticket, 'remainingUsesCache'),
    finiteNumber(rowValue(ticket, 'remainingUses'), 0)
  );
  const activeHolds = finiteNumber(rowValue(ticket, 'activeHolds'), 0);
  return {
    ...ticket,
    remainingUses,
    activeHolds,
    availableUses: remainingUses - activeHolds,
    scenarioPriority: finiteNumber(rowValue(ticket, 'scenarioPriority'), Number.MAX_SAFE_INTEGER),
    expiresAtMs: taipeiDateTimeMs(rowValue(ticket, 'expiresAt')),
    issuedAtMs: taipeiDateTimeMs(rowValue(ticket, 'issuedAt')),
    idNumber: finiteNumber(ticket.id, Number.MAX_SAFE_INTEGER),
  };
}

function compareEligibleTickets(left, right) {
  const a = normalizeTicketCandidate(left);
  const b = normalizeTicketCandidate(right);
  if (a.scenarioPriority !== b.scenarioPriority) return a.scenarioPriority - b.scenarioPriority;
  const aExpiry = Number.isFinite(a.expiresAtMs) ? a.expiresAtMs : Number.MAX_SAFE_INTEGER;
  const bExpiry = Number.isFinite(b.expiresAtMs) ? b.expiresAtMs : Number.MAX_SAFE_INTEGER;
  if (aExpiry !== bExpiry) return aExpiry - bExpiry;
  const aIssued = Number.isFinite(a.issuedAtMs) ? a.issuedAtMs : Number.MAX_SAFE_INTEGER;
  const bIssued = Number.isFinite(b.issuedAtMs) ? b.issuedAtMs : Number.MAX_SAFE_INTEGER;
  if (aIssued !== bIssued) return aIssued - bIssued;
  return a.idNumber - b.idNumber;
}

function selectEligibleTicket(tickets = []) {
  return tickets
    .map(normalizeTicketCandidate)
    .filter((ticket) => (
      ['pending', 'active'].includes(String(ticket.status || '').toLowerCase())
      && ticket.availableUses > 0
    ))
    .sort(compareEligibleTickets)[0] || null;
}

function resolveCourseCapabilities({ platformRole = '', membership = null, assignedCoach = false } = {}) {
  const normalizedRole = String(platformRole || '').trim().toUpperCase();
  if (normalizedRole === 'ADMIN') {
    return {
      global: true,
      manageCatalog: true,
      manageSettings: true,
      manageStaff: true,
      manageAttendance: true,
      viewReports: true,
    };
  }
  const membershipRole = String(membership?.role || '').toLowerCase();
  const status = String(membership?.status || '').toLowerCase();
  let configured = {};
  try {
    configured = typeof membership?.capabilities_json === 'string'
      ? JSON.parse(membership.capabilities_json)
      : (membership?.capabilities_json || membership?.capabilities || {});
  } catch (_) {}
  const provider = normalizedRole === 'SERVICE_PROVIDER';
  const active = provider || status === 'active';
  if (membershipRole === 'coach') {
    return {
      global: false,
      manageCatalog: false,
      manageSettings: false,
      manageStaff: false,
      manageAttendance: active && assignedCoach,
      viewReports: false,
    };
  }
  return {
    global: false,
    manageCatalog: active && (provider || membershipRole === 'ops' || Boolean(configured.manageCatalog)),
    manageSettings: active && (provider || membershipRole === 'ops' || Boolean(configured.manageSettings)),
    manageStaff: active && provider,
    manageAttendance: active && (
      provider
      || membershipRole === 'ops'
      || Boolean(configured.manageAttendance)
    ),
    viewReports: active && (provider || membershipRole === 'ops' || Boolean(configured.viewReports)),
  };
}

module.exports = {
  DEFAULT_POLICY,
  booleanValue,
  compareEligibleTickets,
  derivePendingReview,
  normalizeTicketCandidate,
  resolveCourseCapabilities,
  resolveCoursePolicy,
  selectEligibleTicket,
  taipeiDateTimeMs,
};
