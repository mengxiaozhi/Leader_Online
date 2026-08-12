const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DEFAULT_POLICY = Object.freeze({
  timezone: 'Asia/Taipei',
  bookingOpenMinutesBefore: 30 * 24 * 60,
  bookingCloseMinutesBefore: 0,
  cancelCloseMinutesBefore: 0,
  redeemOpenMinutesBefore: 120,
  redeemCloseMinutesAfter: 24 * 60,
  attendanceInviteExpiryMinutes: 24 * 60,
  attendanceInviteExpiryAction: 'release',
  autoNoShow: false,
});

const COURSE_SCENARIO_ITEM_TYPES = new Set([
  'class',
  'term',
  'event',
  'merchant',
  'service',
  'other',
]);
const COURSE_TICKET_USAGE_MODES = new Set(['finite', 'unlimited']);
const ATTENDANCE_INVITE_EXPIRY_ACTIONS = new Set(['release', 'auto_redeem']);

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

function enumValue(value, allowed, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function normalizeScenarioItemType(value, fallback = 'class') {
  return enumValue(value, COURSE_SCENARIO_ITEM_TYPES, fallback);
}

function normalizeTicketUsageMode(value, fallback = 'finite') {
  return enumValue(value, COURSE_TICKET_USAGE_MODES, fallback);
}

function normalizeAttendanceInviteExpiryAction(value, fallback = 'release') {
  return enumValue(value, ATTENDANCE_INVITE_EXPIRY_ACTIONS, fallback);
}

function assessScenarioReadiness({
  itemType = 'class',
  sessionBound = true,
  redeemQuantity = 1,
  allowedProductCount = 0,
  sessionCount = 0,
  venueSessionCount = null,
} = {}) {
  const normalizedItemType = normalizeScenarioItemType(itemType);
  const normalizedSessionBound = booleanValue(sessionBound, normalizedItemType === 'class');
  const quantity = Number.parseInt(redeemQuantity, 10);
  const issues = [];
  if (!Number.isInteger(quantity) || quantity < 1) {
    issues.push({ code: 'REDEEM_QUANTITY_INVALID', message: '核銷張數必須至少為 1' });
  }
  if (Number(allowedProductCount || 0) < 1) {
    issues.push({ code: 'ALLOWED_TICKET_PRODUCT_REQUIRED', message: '請至少設定一種可核銷票券' });
  }
  if (
    normalizedItemType === 'class'
    && normalizedSessionBound
    && Number(sessionCount || 0) < 1
  ) {
    issues.push({ code: 'SESSION_REQUIRED', message: '依場次核銷的班級必須至少有一個場次' });
  } else if (
    normalizedItemType === 'class'
    && normalizedSessionBound
    && Number(venueSessionCount ?? sessionCount) < Number(sessionCount || 0)
  ) {
    issues.push({ code: 'SESSION_VENUE_REQUIRED', message: '依場次核銷的班級必須設定場地' });
  }
  return {
    ready: issues.length === 0,
    itemType: normalizedItemType,
    sessionBound: normalizedSessionBound,
    redeemQuantity: Number.isInteger(quantity) && quantity > 0 ? quantity : null,
    issues,
  };
}

function attendanceInviteExpiryDisposition(invite = {}) {
  return normalizeAttendanceInviteExpiryAction(
    rowValue(invite, 'expiryAction'),
    DEFAULT_POLICY.attendanceInviteExpiryAction
  );
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

function normalizedTimeZone(value, fallback = DEFAULT_POLICY.timezone) {
  const candidate = String(value || fallback).trim() || fallback;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(0);
    return candidate;
  } catch (_) {
    return fallback;
  }
}

function zonedDateTimeMs(value, timeZone = DEFAULT_POLICY.timezone) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const input = String(value ?? '').trim();
  if (!input) return NaN;
  if (!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)?$/.test(input)) {
    return Date.parse(input);
  }
  const zone = normalizedTimeZone(timeZone);
  const normalized = input.replace(' ', 'T');
  const withTime = normalized.length === 10 ? `${normalized}T00:00:00` : normalized;
  if (zone === 'Asia/Taipei') return Date.parse(`${withTime}+08:00`);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(withTime);
  if (!match) return NaN;
  const intendedUtc = Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6] || 0),
    Number(String(match[7] || '').padEnd(3, '0') || 0)
  );
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(intendedUtc));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const representedUtc = Date.UTC(
    Number(values.year), Number(values.month) - 1, Number(values.day),
    Number(values.hour), Number(values.minute), Number(values.second)
  );
  const firstPass = intendedUtc - (representedUtc - intendedUtc);
  const secondParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(firstPass));
  const second = Object.fromEntries(secondParts.map((part) => [part.type, part.value]));
  const secondRepresented = Date.UTC(
    Number(second.year), Number(second.month) - 1, Number(second.day),
    Number(second.hour), Number(second.minute), Number(second.second)
  );
  return firstPass - (secondRepresented - intendedUtc);
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
  parseTime = taipeiDateTimeMs,
}) {
  const absolute = rowValue(session, absoluteField);
  const absoluteMs = parseTime(absolute);
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
  const timezone = normalizedTimeZone(firstDefined(
    [providerSettings, platformSettings],
    'timezone',
    DEFAULT_POLICY.timezone
  ));
  const parseTime = (value) => zonedDateTimeMs(value, timezone);
  const startsAt = parseTime(rowValue(session, 'startsAt'));
  const endsAt = parseTime(rowValue(session, 'endsAt'));
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
    parseTime,
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
    parseTime,
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
    parseTime,
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
    parseTime,
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
    parseTime,
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
  const inviteExpiryAction = normalizeAttendanceInviteExpiryAction(firstDefined(
    [providerSettings, platformSettings],
    'attendanceInviteExpiryAction',
    DEFAULT_POLICY.attendanceInviteExpiryAction
  ));
  const autoNoShow = booleanValue(firstDefined(
    [providerSettings, platformSettings],
    'autoNoShow',
    DEFAULT_POLICY.autoNoShow
  ), DEFAULT_POLICY.autoNoShow);
  const effectiveNow = parseTime(now);

  return {
    timezone,
    startsAt,
    endsAt,
    bookingOpenAt,
    bookingCloseAt,
    cancelCloseAt,
    redeemOpenAt,
    redeemCloseAt,
    inviteExpiryMinutes,
    inviteExpiryAction,
    autoNoShow,
    canBook: effectiveNow >= bookingOpenAt && effectiveNow <= bookingCloseAt,
    canCancel: effectiveNow <= cancelCloseAt,
    canRedeemOnsite: effectiveNow >= redeemOpenAt && effectiveNow <= redeemCloseAt,
    pendingReview: effectiveNow > redeemCloseAt,
  };
}

function derivePendingReview(booking, policy, now = Date.now()) {
  return String(booking?.status || '').toLowerCase() === 'booked'
    && zonedDateTimeMs(now, policy?.timezone) > Number(policy?.redeemCloseAt);
}

function normalizeTicketCandidate(ticket = {}) {
  const usageMode = normalizeTicketUsageMode(
    rowValue(ticket, 'usageModeSnapshot') ?? rowValue(ticket, 'usageMode')
  );
  const unlimited = usageMode === 'unlimited';
  const remainingUses = finiteNumber(
    rowValue(ticket, 'remainingUsesCache'),
    finiteNumber(rowValue(ticket, 'remainingUses'), 0)
  );
  const activeHolds = finiteNumber(rowValue(ticket, 'activeHolds'), 0);
  return {
    ...ticket,
    remainingUses,
    activeHolds,
    usageMode,
    unlimited,
    availableUses: unlimited ? Number.POSITIVE_INFINITY : remainingUses - activeHolds,
    requiredUses: Math.max(1, finiteNumber(rowValue(ticket, 'requiredUses'), 1)),
    scenarioPriority: finiteNumber(rowValue(ticket, 'scenarioPriority'), Number.MAX_SAFE_INTEGER),
    expiresAtMs: taipeiDateTimeMs(rowValue(ticket, 'expiresAt')),
    activationDeadlineMs: taipeiDateTimeMs(rowValue(ticket, 'activationDeadline')),
    activated: Boolean(rowValue(ticket, 'activatedAt'))
      || String(ticket.status || '').trim().toLowerCase() === 'active',
    issuedAtMs: taipeiDateTimeMs(rowValue(ticket, 'issuedAt')),
    idNumber: finiteNumber(ticket.id, Number.MAX_SAFE_INTEGER),
  };
}

function compareEligibleTickets(left, right) {
  const a = normalizeTicketCandidate(left);
  const b = normalizeTicketCandidate(right);
  if (a.scenarioPriority !== b.scenarioPriority) return a.scenarioPriority - b.scenarioPriority;
  if (a.activated !== b.activated) return a.activated ? -1 : 1;
  const aDeadline = a.activated ? a.expiresAtMs : a.activationDeadlineMs;
  const bDeadline = b.activated ? b.expiresAtMs : b.activationDeadlineMs;
  const normalizedADeadline = Number.isFinite(aDeadline) ? aDeadline : Number.MAX_SAFE_INTEGER;
  const normalizedBDeadline = Number.isFinite(bDeadline) ? bDeadline : Number.MAX_SAFE_INTEGER;
  if (normalizedADeadline !== normalizedBDeadline) return normalizedADeadline - normalizedBDeadline;
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
      && (ticket.unlimited || ticket.availableUses >= ticket.requiredUses)
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
      manageTicketExceptions: true,
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
      manageTicketExceptions: false,
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
    manageTicketExceptions: active && (
      provider
      || membershipRole === 'ops'
      || Boolean(configured.manageTicketExceptions)
    ),
    viewReports: active && (provider || membershipRole === 'ops' || Boolean(configured.viewReports)),
  };
}

module.exports = {
  ATTENDANCE_INVITE_EXPIRY_ACTIONS,
  COURSE_SCENARIO_ITEM_TYPES,
  COURSE_TICKET_USAGE_MODES,
  DEFAULT_POLICY,
  assessScenarioReadiness,
  attendanceInviteExpiryDisposition,
  booleanValue,
  compareEligibleTickets,
  derivePendingReview,
  normalizeAttendanceInviteExpiryAction,
  normalizeScenarioItemType,
  normalizeTicketCandidate,
  normalizeTicketUsageMode,
  resolveCourseCapabilities,
  resolveCoursePolicy,
  selectEligibleTicket,
  taipeiDateTimeMs,
  zonedDateTimeMs,
};
