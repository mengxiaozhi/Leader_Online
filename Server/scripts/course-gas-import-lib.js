'use strict';

const crypto = require('node:crypto');

const CONTRACT_VERSION = 'leader-course-gas-snapshot-v1';
const TOP_LEVEL_FIELDS = new Set([
  'contractVersion',
  'source',
  'generatedAt',
  'metadata',
  'datasets',
]);

const DATASET_CONTRACTS = Object.freeze({
  students: contract({
    required: ['sourceId', 'email', 'displayName'],
    optional: ['ownerUserId', 'phone', 'status', 'createdAt', 'updatedAt', 'metadata'],
    emailFields: ['email'],
  }),
  ticketProducts: contract({
    required: ['sourceId', 'code', 'name', 'classCount'],
    optional: [
      'ownerUserId',
      'description',
      'validDays',
      'activationDays',
      'transferable',
      'maxTransfers',
      'termsText',
      'redemptionPolicy',
      'status',
      'createdAt',
      'updatedAt',
    ],
    codeField: 'code',
    integerFields: ['classCount', 'validDays', 'activationDays', 'maxTransfers'],
    booleanFields: ['transferable'],
  }),
  shopProducts: contract({
    required: ['sourceId', 'code', 'name', 'ticketProductCode', 'price'],
    optional: [
      'ownerUserId',
      'category',
      'summary',
      'description',
      'classCount',
      'validDays',
      'activationDays',
      'transferable',
      'externalPurchaseUrl',
      'returningStudentOnly',
      'requireAddonForNew',
      'qualifyingTicketProductCodes',
      'requiredAddonCodes',
      'ticketComponents',
      'status',
      'sortOrder',
      'createdAt',
      'updatedAt',
    ],
    codeField: 'code',
    numericFields: ['price'],
    integerFields: ['classCount', 'validDays', 'activationDays', 'sortOrder'],
    booleanFields: ['transferable', 'returningStudentOnly', 'requireAddonForNew'],
    listFields: ['qualifyingTicketProductCodes', 'requiredAddonCodes', 'ticketComponents'],
  }),
  scenarios: contract({
    required: ['sourceId', 'code', 'name', 'allowedProductCodes'],
    optional: [
      'ownerUserId',
      'description',
      'status',
      'redeemOpenMinutesBefore',
      'redeemCloseMinutesAfter',
      'createdAt',
      'updatedAt',
    ],
    codeField: 'code',
    integerFields: ['redeemOpenMinutesBefore', 'redeemCloseMinutesAfter'],
    listFields: ['allowedProductCodes'],
  }),
  sessions: contract({
    required: ['sourceId', 'code', 'title', 'scenarioCode', 'startsAt', 'endsAt', 'status'],
    optional: [
      'ownerUserId',
      'productCode',
      'coachCode',
      'coachName',
      'location',
      'bookingOpenAt',
      'bookingCloseAt',
      'bookingOpenMinutesBefore',
      'bookingCloseMinutesBefore',
      'cancelCloseMinutesBefore',
      'redeemOpenAt',
      'redeemCloseAt',
      'redeemOpenMinutesBefore',
      'redeemCloseMinutesAfter',
      'capacity',
      'notes',
      'status',
      'createdAt',
      'updatedAt',
    ],
    codeField: 'code',
    integerFields: [
      'bookingOpenMinutesBefore',
      'bookingCloseMinutesBefore',
      'cancelCloseMinutesBefore',
      'redeemOpenMinutesBefore',
      'redeemCloseMinutesAfter',
      'capacity',
    ],
    dateFields: [
      'startsAt',
      'endsAt',
      'bookingOpenAt',
      'bookingCloseAt',
      'redeemOpenAt',
      'redeemCloseAt',
      'createdAt',
      'updatedAt',
    ],
  }),
  tickets: contract({
    required: [
      'sourceId',
      'code',
      'studentSourceId',
      'ticketProductCode',
      'totalUses',
      'remainingUses',
      'status',
      'issuedAt',
    ],
    optional: [
      'ownerEmail',
      'ownerName',
      'orderSourceId',
      'orderItemSourceId',
      'shopProductCode',
      'activationDeadline',
      'activatedAt',
      'expiresAt',
      'pausedAt',
      'pauseReason',
      'transferable',
      'createdAt',
      'updatedAt',
      'metadata',
    ],
    codeField: 'code',
    integerFields: ['totalUses', 'remainingUses'],
    booleanFields: ['transferable'],
    emailFields: ['ownerEmail'],
    dateFields: [
      'issuedAt',
      'activationDeadline',
      'activatedAt',
      'expiresAt',
      'pausedAt',
      'createdAt',
      'updatedAt',
    ],
  }),
  orders: contract({
    required: [
      'sourceId',
      'code',
      'studentSourceId',
      'status',
      'totalAmount',
      'buyerName',
      'buyerEmail',
      'termsAcceptedAt',
      'items',
      'createdAt',
    ],
    optional: [
      'buyerPhone',
      'note',
      'updatedAt',
      'items',
    ],
    codeField: 'code',
    numericFields: ['totalAmount'],
    emailFields: ['buyerEmail'],
    dateFields: ['createdAt', 'updatedAt', 'termsAcceptedAt'],
    listFields: ['items'],
  }),
  rsvps: contract({
    required: ['sourceId', 'sessionCode', 'studentSourceId', 'status', 'bookedAt'],
    optional: [
      'ticketCode',
      'attendeeName',
      'attendeeEmail',
      'cancelledAt',
      'attendedAt',
      'resolutionReason',
      'createdAt',
      'updatedAt',
    ],
    emailFields: ['attendeeEmail'],
    dateFields: [
      'bookedAt',
      'cancelledAt',
      'attendedAt',
      'createdAt',
      'updatedAt',
    ],
  }),
  attendanceInvites: contract({
    required: ['sourceId', 'sessionCode', 'studentSourceId', 'status', 'expiresAt'],
    optional: [
      'ticketCode',
      'rsvpSourceId',
      'autoRedeemAt',
      'confirmedAt',
      'tokenHash',
      'redeemedUsageSourceId',
      'note',
      'createdAt',
      'updatedAt',
    ],
    dateFields: [
      'expiresAt',
      'autoRedeemAt',
      'confirmedAt',
      'createdAt',
      'updatedAt',
    ],
  }),
  redeemLogs: contract({
    required: ['sourceId', 'eventType', 'deltaUses', 'occurredAt'],
    optional: [
      'ticketCode',
      'sessionCode',
      'rsvpSourceId',
      'studentSourceId',
      'staffEmail',
      'reversesSourceId',
      'note',
      'metadata',
    ],
    integerFields: ['deltaUses'],
    emailFields: ['staffEmail'],
    dateFields: ['occurredAt'],
  }),
  staff: contract({
    required: ['sourceId', 'ownerUserId', 'email', 'role'],
    optional: [
      'displayName',
      'capabilities',
      'status',
      'createdAt',
      'updatedAt',
    ],
    emailFields: ['email'],
    listFields: ['capabilities'],
  }),
  coachProfiles: contract({
    required: ['sourceId', 'ownerUserId', 'code', 'displayName'],
    optional: [
      'email',
      'phone',
      'bio',
      'status',
      'createdAt',
      'updatedAt',
    ],
    codeField: 'code',
    emailFields: ['email'],
  }),
  settings: contract({
    required: ['sourceId', 'scopeKey'],
    optional: [
      'ownerUserId',
      'timezone',
      'bookingOpenMinutesBefore',
      'bookingCloseMinutesBefore',
      'cancelCloseMinutesBefore',
      'redeemOpenMinutesBefore',
      'redeemCloseMinutesAfter',
      'attendanceInviteExpiresMinutes',
      'autoNoShow',
      'createdAt',
      'updatedAt',
    ],
    integerFields: [
      'bookingOpenMinutesBefore',
      'bookingCloseMinutesBefore',
      'cancelCloseMinutesBefore',
      'redeemOpenMinutesBefore',
      'redeemCloseMinutesAfter',
      'attendanceInviteExpiresMinutes',
    ],
    booleanFields: ['autoNoShow'],
    codeField: 'scopeKey',
  }),
});

function contract({
  required,
  optional = [],
  codeField = null,
  numericFields = [],
  integerFields = [],
  booleanFields = [],
  emailFields = [],
  dateFields = [],
  listFields = [],
}) {
  return Object.freeze({
    required: Object.freeze(required),
    optional: Object.freeze(optional),
    allowed: new Set([...required, ...optional]),
    codeField,
    numericFields: new Set(numericFields),
    integerFields: new Set(integerFields),
    booleanFields: new Set(booleanFields),
    emailFields: new Set(emailFields),
    dateFields: new Set(dateFields),
    listFields: new Set(listFields),
  });
}

function normalizeCode(value) {
  return String(value == null ? '' : value).trim().toUpperCase();
}

function normalizeEmail(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function isBlank(value) {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
}

function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashValue(value) {
  return sha256(stableStringify(value));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  if (quoted) {
    const error = new Error('CSV has an unterminated quoted cell.');
    error.code = 'INVALID_CSV';
    throw error;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  if (rows.length === 0) return [];

  const headers = rows[0].map((header, index) => {
    const normalized = String(header).trim().replace(/^\uFEFF/, '');
    if (!normalized) {
      const error = new Error(`CSV header ${index + 1} is empty.`);
      error.code = 'INVALID_CSV_HEADER';
      throw error;
    }
    return normalized;
  });
  const duplicateHeader = firstDuplicate(headers.map((value) => value.toLowerCase()));
  if (duplicateHeader) {
    const error = new Error(`CSV contains duplicate header "${duplicateHeader}".`);
    error.code = 'DUPLICATE_CSV_HEADER';
    throw error;
  }

  return rows.slice(1)
    .filter((values) => values.some((value) => String(value).trim() !== ''))
    .map((values, rowIndex) => {
      if (values.length !== headers.length) {
        const error = new Error(
          `CSV row ${rowIndex + 2} has ${values.length} cells; expected ${headers.length}.`
        );
        error.code = 'INVALID_CSV_ROW';
        throw error;
      }
      return headers.reduce((result, header, columnIndex) => {
        result[header] = parseCsvCell(values[columnIndex]);
        return result;
      }, {});
    });
}

function parseCsvCell(value) {
  const trimmed = String(value).trim();
  if (trimmed === '') return null;
  if (
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
    || (trimmed.startsWith('{') && trimmed.endsWith('}'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch (_) {
      return value;
    }
  }
  return value;
}

function firstDuplicate(values) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return null;
}

function parseSnapshotText(text, { format, dataset } = {}) {
  const resolvedFormat = String(format || '').toLowerCase();
  if (resolvedFormat === 'csv') {
    if (!dataset) {
      const error = new Error('--dataset is required for a CSV snapshot.');
      error.code = 'DATASET_REQUIRED';
      throw error;
    }
    return normalizeSnapshot({
      contractVersion: CONTRACT_VERSION,
      source: 'gas',
      datasets: { [dataset]: parseCsv(text) },
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    error.code = 'INVALID_JSON';
    throw error;
  }
  if (Array.isArray(parsed)) {
    if (!dataset) {
      const error = new Error('--dataset is required when JSON contains a row array.');
      error.code = 'DATASET_REQUIRED';
      throw error;
    }
    parsed = {
      contractVersion: CONTRACT_VERSION,
      source: 'gas',
      datasets: { [dataset]: parsed },
    };
  }
  return normalizeSnapshot(parsed);
}

function normalizeSnapshot(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    const error = new Error('Snapshot must be a JSON object.');
    error.code = 'INVALID_SNAPSHOT';
    throw error;
  }
  const unknownTopLevel = Object.keys(input).filter((key) => !TOP_LEVEL_FIELDS.has(key));
  if (unknownTopLevel.length > 0) {
    const error = new Error(`Unknown snapshot fields: ${unknownTopLevel.join(', ')}`);
    error.code = 'UNKNOWN_SNAPSHOT_FIELDS';
    error.fields = unknownTopLevel;
    throw error;
  }
  if (!input.datasets || typeof input.datasets !== 'object' || Array.isArray(input.datasets)) {
    const error = new Error('Snapshot datasets must be an object keyed by dataset name.');
    error.code = 'INVALID_DATASETS';
    throw error;
  }

  const datasets = {};
  for (const [name, rows] of Object.entries(input.datasets)) {
    if (!Object.prototype.hasOwnProperty.call(DATASET_CONTRACTS, name)) {
      const error = new Error(`Unknown dataset "${name}".`);
      error.code = 'UNKNOWN_DATASET';
      error.dataset = name;
      throw error;
    }
    if (!Array.isArray(rows)) {
      const error = new Error(`Dataset "${name}" must be an array.`);
      error.code = 'INVALID_DATASET';
      error.dataset = name;
      throw error;
    }
    datasets[name] = rows.map((row) => (
      row && typeof row === 'object' && !Array.isArray(row) ? { ...row } : row
    ));
  }

  return {
    contractVersion: String(input.contractVersion || CONTRACT_VERSION),
    source: String(input.source || 'gas').toLowerCase(),
    generatedAt: input.generatedAt || null,
    metadata: input.metadata || null,
    datasets,
  };
}

function validateSnapshot(snapshot) {
  const errors = [];
  const normalizedDatasets = {};

  if (snapshot.contractVersion !== CONTRACT_VERSION) {
    errors.push(problem({
      code: 'CONTRACT_VERSION_MISMATCH',
      message: `Expected ${CONTRACT_VERSION}; received ${snapshot.contractVersion}.`,
    }));
  }
  if (snapshot.source !== 'gas') {
    errors.push(problem({
      code: 'INVALID_SOURCE',
      message: 'Snapshot source must be "gas".',
    }));
  }

  for (const [datasetName, rows] of Object.entries(snapshot.datasets)) {
    const datasetContract = DATASET_CONTRACTS[datasetName];
    const seenSourceIds = new Map();
    const seenCodes = new Map();
    normalizedDatasets[datasetName] = [];

    rows.forEach((rawRow, rowIndex) => {
      const displayRow = rowIndex + 2;
      if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) {
        errors.push(problem({
          code: 'INVALID_ROW',
          dataset: datasetName,
          row: displayRow,
          message: 'Row must be an object.',
        }));
        return;
      }

      const unknownFields = Object.keys(rawRow)
        .filter((field) => !datasetContract.allowed.has(field));
      if (unknownFields.length > 0) {
        errors.push(problem({
          code: 'UNKNOWN_FIELDS',
          dataset: datasetName,
          row: displayRow,
          message: `Unknown fields: ${unknownFields.join(', ')}.`,
          fields: unknownFields,
        }));
      }

      for (const field of datasetContract.required) {
        if (isBlank(rawRow[field])) {
          errors.push(problem({
            code: 'REQUIRED_FIELD',
            dataset: datasetName,
            row: displayRow,
            field,
            message: `${field} is required.`,
          }));
        }
      }

      const row = normalizeRow(rawRow, datasetContract, {
        dataset: datasetName,
        row: displayRow,
        errors,
      });
      validateRowSemantics(datasetName, row, displayRow, errors);
      normalizedDatasets[datasetName].push(row);

      const sourceId = String(row.sourceId == null ? '' : row.sourceId).trim();
      if (sourceId) {
        const sourceKey = sourceId.toLowerCase();
        if (seenSourceIds.has(sourceKey)) {
          errors.push(problem({
            code: 'DUPLICATE_SOURCE_ID',
            dataset: datasetName,
            row: displayRow,
            field: 'sourceId',
            message: `sourceId "${sourceId}" duplicates row ${seenSourceIds.get(sourceKey)}.`,
          }));
        } else {
          seenSourceIds.set(sourceKey, displayRow);
        }
      }

      if (datasetContract.codeField && !isBlank(row[datasetContract.codeField])) {
        const code = datasetName === 'coachProfiles'
          ? `${normalizeSourceId(row.ownerUserId)}:${normalizeCode(row[datasetContract.codeField])}`
          : normalizeCode(row[datasetContract.codeField]);
        if (seenCodes.has(code)) {
          errors.push(problem({
            code: 'DUPLICATE_CODE',
            dataset: datasetName,
            row: displayRow,
            field: datasetContract.codeField,
            message: `code "${row[datasetContract.codeField]}" duplicates row ${seenCodes.get(code)}.`,
          }));
        } else {
          seenCodes.set(code, displayRow);
        }
      }
    });
  }

  validateReferences(normalizedDatasets, errors);
  const reconciliation = buildSourceReconciliation(normalizedDatasets, errors);
  return {
    ok: errors.length === 0,
    errors,
    datasets: normalizedDatasets,
    reconciliation,
  };
}

function normalizeRow(rawRow, datasetContract, context) {
  const row = {};
  for (const field of Object.keys(rawRow)) {
    let value = rawRow[field];
    if (typeof value === 'string') value = value.trim();
    if (isBlank(value)) {
      row[field] = null;
      continue;
    }

    if (datasetContract.integerFields.has(field)) {
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed)) {
        context.errors.push(problem({
          code: 'INVALID_INTEGER',
          ...context,
          field,
          message: `${field} must be an integer.`,
        }));
      } else {
        value = parsed;
      }
    } else if (datasetContract.numericFields.has(field)) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        context.errors.push(problem({
          code: 'INVALID_NUMBER',
          ...context,
          field,
          message: `${field} must be numeric.`,
        }));
      } else {
        value = parsed;
      }
    } else if (datasetContract.booleanFields.has(field)) {
      const parsed = parseBoolean(value);
      if (parsed == null) {
        context.errors.push(problem({
          code: 'INVALID_BOOLEAN',
          ...context,
          field,
          message: `${field} must be true or false.`,
        }));
      } else {
        value = parsed;
      }
    } else if (datasetContract.listFields.has(field)) {
      if (!Array.isArray(value)) {
        context.errors.push(problem({
          code: 'INVALID_LIST',
          ...context,
          field,
          message: `${field} must be a JSON array (including inside CSV cells).`,
        }));
      }
    } else if (datasetContract.emailFields.has(field)) {
      value = normalizeEmail(value);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
        context.errors.push(problem({
          code: 'INVALID_EMAIL',
          ...context,
          field,
          message: `${field} is not a valid email address.`,
        }));
      }
    } else if (datasetContract.dateFields.has(field)) {
      if (!isCourseDateValue(value)) {
        context.errors.push(problem({
          code: 'INVALID_DATE',
          ...context,
          field,
          message: `${field} must be an ISO date/datetime or MySQL DATETIME interpreted in Asia/Taipei.`,
        }));
      }
    }
    row[field] = value;
  }
  return row;
}

function parseBoolean(value) {
  if (value === true || value === false) return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return null;
}

function validateRowSemantics(datasetName, row, rowNumber, errors) {
  const statusSets = {
    students: new Set(['pending_claim', 'active', 'inactive', 'merged']),
    ticketProducts: new Set(['draft', 'published', 'archived']),
    shopProducts: new Set(['draft', 'published', 'archived']),
    scenarios: new Set(['draft', 'active', 'inactive', 'archived']),
    sessions: new Set(['draft', 'open', 'closed', 'completed', 'cancelled']),
    tickets: new Set(['pending', 'active', 'paused', 'frozen', 'exhausted', 'expired', 'void']),
    orders: new Set(['pending', 'payment_review', 'paid', 'issued', 'cancelled', 'refunded']),
    rsvps: new Set(['booked', 'cancelled', 'attended', 'no_show']),
    attendanceInvites: new Set([
      'pending',
      'confirmed',
      'expired',
      'cancelled',
      'auto_redeemed',
      'blocked',
    ]),
    staff: new Set(['active', 'inactive']),
    coachProfiles: new Set(['active', 'inactive']),
  };
  const statuses = statusSets[datasetName];
  if (statuses && row.status != null) {
    const normalizedStatus = String(row.status).trim().toLowerCase();
    row.status = normalizedStatus;
    if (!statuses.has(normalizedStatus)) {
      errors.push(problem({
        code: 'INVALID_STATUS',
        dataset: datasetName,
        row: rowNumber,
        field: 'status',
        message: `Unsupported ${datasetName} status "${normalizedStatus}".`,
      }));
    }
  }

  if (datasetName === 'sessions' && row.startsAt && row.endsAt) {
    const starts = courseDateSortKey(row.startsAt);
    const ends = courseDateSortKey(row.endsAt);
    if (starts == null || ends == null || ends <= starts) {
      errors.push(problem({
        code: 'INVALID_SESSION_INTERVAL',
        dataset: datasetName,
        row: rowNumber,
        field: 'endsAt',
        message: 'endsAt must be later than startsAt.',
      }));
    }
  }

  if (datasetName === 'settings' && row.autoNoShow == null) {
    row.autoNoShow = false;
  }
  if (
    datasetName === 'settings'
    && row.timezone
    && String(row.timezone) !== 'Asia/Taipei'
  ) {
    errors.push(problem({
      code: 'UNSUPPORTED_COURSE_TIMEZONE',
      dataset: datasetName,
      row: rowNumber,
      field: 'timezone',
      message: 'Course import timezone must be Asia/Taipei.',
    }));
  }
  if (
    datasetName === 'settings'
    && String(row.scopeKey || '') !== 'platform'
    && isBlank(row.ownerUserId)
  ) {
    errors.push(problem({
      code: 'SETTINGS_OWNER_REQUIRED',
      dataset: datasetName,
      row: rowNumber,
      field: 'ownerUserId',
      message: 'Provider settings require ownerUserId.',
    }));
  }
  if (
    datasetName === 'settings'
    && !isBlank(row.ownerUserId)
    && String(row.scopeKey || '') !== `provider:${row.ownerUserId}`
  ) {
    errors.push(problem({
      code: 'SETTINGS_SCOPE_KEY_MISMATCH',
      dataset: datasetName,
      row: rowNumber,
      field: 'scopeKey',
      message: 'Provider scopeKey must be provider:<ownerUserId>.',
    }));
  }

  if (datasetName === 'orders' && Array.isArray(row.items)) {
    validateOrderItems(row.items, rowNumber, errors);
    if (row.items.length === 0) {
      errors.push(problem({
        code: 'ORDER_ITEMS_REQUIRED',
        dataset: datasetName,
        row: rowNumber,
        field: 'items',
        message: 'Order items cannot be empty.',
      }));
    }
  }

  if (datasetName === 'shopProducts' && Array.isArray(row.ticketComponents)) {
    validateTicketComponents(row, rowNumber, errors);
  }
  if (
    datasetName === 'shopProducts'
    && row.requireAddonForNew === true
    && (
      !Array.isArray(row.requiredAddonCodes)
      || row.requiredAddonCodes.length === 0
    )
  ) {
    errors.push(problem({
      code: 'NEW_BUYER_REQUIRED_ADDON_MISSING',
      dataset: datasetName,
      row: rowNumber,
      field: 'requiredAddonCodes',
      message: 'requireAddonForNew requires at least one required add-on ShopProduct.',
    }));
  }
  if (
    datasetName === 'shopProducts'
    && row.requireAddonForNew === true
    && (
      !Array.isArray(row.qualifyingTicketProductCodes)
      || row.qualifyingTicketProductCodes.length === 0
    )
  ) {
    errors.push(problem({
      code: 'RETURNING_QUALIFICATION_MISSING',
      dataset: datasetName,
      row: rowNumber,
      field: 'qualifyingTicketProductCodes',
      message: 'requireAddonForNew requires explicit TicketProducts that exempt returning buyers.',
    }));
  }

  if (
    datasetName === 'scenarios'
    && Array.isArray(row.allowedProductCodes)
    && row.allowedProductCodes.length === 0
  ) {
    errors.push(problem({
      code: 'SCENARIO_ALLOWED_PRODUCTS_REQUIRED',
      dataset: datasetName,
      row: rowNumber,
      field: 'allowedProductCodes',
      message: 'Scenario must allow at least one TicketProduct.',
    }));
  }

  if (datasetName === 'staff' && row.role != null) {
    const role = String(row.role).trim().toLowerCase();
    row.role = role;
    if (!new Set(['ops', 'coach']).has(role)) {
      errors.push(problem({
        code: 'INVALID_STAFF_ROLE',
        dataset: datasetName,
        row: rowNumber,
        field: 'role',
        message: 'Staff role must be ops or coach; coach profiles alone grant no permission.',
      }));
    }
  }

  if (
    datasetName === 'attendanceInvites'
    && row.status === 'pending'
    && !/^[a-f0-9]{64}$/i.test(String(row.tokenHash || ''))
  ) {
    errors.push(problem({
      code: 'ATTENDANCE_INVITE_TOKEN_HASH_REQUIRED',
      dataset: datasetName,
      row: rowNumber,
      field: 'tokenHash',
      message: 'A pending imported attendance invite requires a 64-character tokenHash.',
    }));
  }

  if (datasetName === 'redeemLogs') {
    const eventType = normalizeCode(row.eventType);
    row.eventType = eventType;
    const allowed = new Set([
      'ISSUANCE',
      'SUCCESS',
      'NO_SHOW',
      'SUCCESS_REVERSAL',
      'NO_SHOW_REVERSAL',
      'ADJUSTMENT',
      'REFUND',
      'IMPORT_RECONCILIATION',
    ]);
    if (!allowed.has(eventType)) {
      errors.push(problem({
        code: 'INVALID_USAGE_EVENT_TYPE',
        dataset: datasetName,
        row: rowNumber,
        field: 'eventType',
        message: `Unsupported usage event type "${eventType}".`,
      }));
      return;
    }
    const delta = Number(row.deltaUses);
    const hasTicket = !isBlank(row.ticketCode);
    let validDirection = true;
    if (eventType === 'ISSUANCE') validDirection = delta > 0 && hasTicket;
    if (eventType === 'SUCCESS') validDirection = delta < 0 && hasTicket;
    if (eventType === 'NO_SHOW') {
      validDirection = hasTicket ? delta < 0 : delta === 0;
    }
    if (eventType === 'SUCCESS_REVERSAL' || eventType === 'NO_SHOW_REVERSAL') {
      validDirection = delta > 0 && hasTicket;
      if (isBlank(row.reversesSourceId)) {
        errors.push(problem({
          code: 'REVERSAL_SOURCE_REQUIRED',
          dataset: datasetName,
          row: rowNumber,
          field: 'reversesSourceId',
          message: `${eventType} requires reversesSourceId.`,
        }));
      }
    }
    if (eventType === 'ADJUSTMENT') validDirection = delta !== 0 && hasTicket;
    if (eventType === 'REFUND') validDirection = delta < 0 && hasTicket;
    if (eventType === 'IMPORT_RECONCILIATION') validDirection = hasTicket;
    if (!validDirection) {
      errors.push(problem({
        code: 'INVALID_USAGE_DELTA_DIRECTION',
        dataset: datasetName,
        row: rowNumber,
        field: 'deltaUses',
        message: `${eventType} has an invalid deltaUses/ticketCode combination.`,
      }));
    }
  }
}

function validateOrderItems(items, rowNumber, errors) {
  const required = [
    'sourceId',
    'itemType',
    'itemCode',
    'itemName',
    'quantity',
    'unitPrice',
    'lineTotal',
  ];
  const allowed = new Set([
    ...required,
    'shopProductCode',
    'ticketProductCode',
    'issuanceStatus',
    'metadata',
  ]);
  const sourceIds = new Set();
  const lineIdentities = new Set();
  items.forEach((item, itemIndex) => {
    const field = `items[${itemIndex}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(problem({
        code: 'INVALID_ORDER_ITEM',
        dataset: 'orders',
        row: rowNumber,
        field,
        message: `${field} must be an object.`,
      }));
      return;
    }
    const unknown = Object.keys(item).filter((key) => !allowed.has(key));
    if (unknown.length > 0) {
      errors.push(problem({
        code: 'UNKNOWN_ORDER_ITEM_FIELDS',
        dataset: 'orders',
        row: rowNumber,
        field,
        fields: unknown,
        message: `${field} has unknown fields: ${unknown.join(', ')}.`,
      }));
    }
    for (const requiredField of required) {
      if (isBlank(item[requiredField])) {
        errors.push(problem({
          code: 'REQUIRED_ORDER_ITEM_FIELD',
          dataset: 'orders',
          row: rowNumber,
          field: `${field}.${requiredField}`,
          message: `${field}.${requiredField} is required.`,
        }));
      }
    }
    const sourceId = normalizeSourceId(item.sourceId);
    if (sourceIds.has(sourceId)) {
      errors.push(problem({
        code: 'DUPLICATE_ORDER_ITEM_SOURCE_ID',
        dataset: 'orders',
        row: rowNumber,
        field: `${field}.sourceId`,
        message: `${field}.sourceId is duplicated in this order.`,
      }));
    }
    sourceIds.add(sourceId);
    if (!item.shopProductCode && !item.ticketProductCode) {
      errors.push(problem({
        code: 'ORDER_ITEM_PRODUCT_REQUIRED',
        dataset: 'orders',
        row: rowNumber,
        field,
        message: `${field} must reference shopProductCode or ticketProductCode.`,
      }));
    }
    item.itemType = String(item.itemType || '').toLowerCase();
    if (!new Set(['primary', 'addon']).has(item.itemType)) {
      errors.push(problem({
        code: 'INVALID_ORDER_ITEM_TYPE',
        dataset: 'orders',
        row: rowNumber,
        field: `${field}.itemType`,
        message: `${field}.itemType must be primary or addon.`,
      }));
    }
    for (const numericField of ['quantity', 'unitPrice', 'lineTotal']) {
      const value = Number(item[numericField]);
      if (!Number.isFinite(value) || value < 0 || (numericField === 'quantity' && !Number.isSafeInteger(value))) {
        errors.push(problem({
          code: 'INVALID_ORDER_ITEM_NUMBER',
          dataset: 'orders',
          row: rowNumber,
          field: `${field}.${numericField}`,
          message: `${field}.${numericField} is invalid.`,
        }));
      } else {
        item[numericField] = value;
      }
    }
    if (item.issuanceStatus != null) {
      item.issuanceStatus = String(item.issuanceStatus).toLowerCase();
      if (!new Set(['pending', 'issued', 'refunded', 'void']).has(item.issuanceStatus)) {
        errors.push(problem({
          code: 'INVALID_ORDER_ITEM_ISSUANCE_STATUS',
          dataset: 'orders',
          row: rowNumber,
          field: `${field}.issuanceStatus`,
          message: `${field}.issuanceStatus is invalid.`,
        }));
      }
    }
    const lineIdentity = [
      item.itemType,
      normalizeCode(item.shopProductCode || ''),
      normalizeCode(item.ticketProductCode || ''),
    ].join(':');
    if (lineIdentities.has(lineIdentity)) {
      errors.push(problem({
        code: 'DUPLICATE_ORDER_ITEM_LINE',
        dataset: 'orders',
        row: rowNumber,
        field,
        message: `${field} duplicates the same itemType/shopProduct/ticketProduct line; aggregate quantity instead.`,
      }));
    }
    lineIdentities.add(lineIdentity);
  });
}

function validateTicketComponents(row, rowNumber, errors) {
  const seen = new Set();
  let primaryCount = 0;
  row.ticketComponents.forEach((component, index) => {
    const field = `ticketComponents[${index}]`;
    if (!component || typeof component !== 'object' || Array.isArray(component)) {
      errors.push(problem({
        code: 'INVALID_TICKET_COMPONENT',
        dataset: 'shopProducts',
        row: rowNumber,
        field,
        message: `${field} must be an object.`,
      }));
      return;
    }
    const unknown = Object.keys(component).filter(
      (key) => !new Set([
        'ticketProductCode',
        'componentRole',
        'quantity',
        'sortOrder',
      ]).has(key)
    );
    if (unknown.length) {
      errors.push(problem({
        code: 'UNKNOWN_TICKET_COMPONENT_FIELDS',
        dataset: 'shopProducts',
        row: rowNumber,
        field,
        fields: unknown,
        message: `${field} has unknown fields: ${unknown.join(', ')}.`,
      }));
    }
    component.componentRole = String(component.componentRole || 'primary').toLowerCase();
    component.quantity = Number(component.quantity ?? 1);
    component.sortOrder = Number(component.sortOrder ?? index);
    if (
      isBlank(component.ticketProductCode)
      || !new Set(['primary', 'addon']).has(component.componentRole)
      || !Number.isSafeInteger(component.quantity)
      || component.quantity < 1
      || !Number.isSafeInteger(component.sortOrder)
    ) {
      errors.push(problem({
        code: 'INVALID_TICKET_COMPONENT',
        dataset: 'shopProducts',
        row: rowNumber,
        field,
        message: `${field} requires a TicketProduct, valid role, positive quantity and integer sortOrder.`,
      }));
    }
    const key = `${normalizeCode(component.ticketProductCode)}:${component.componentRole}`;
    if (seen.has(key)) {
      errors.push(problem({
        code: 'DUPLICATE_TICKET_COMPONENT',
        dataset: 'shopProducts',
        row: rowNumber,
        field,
        message: `${field} duplicates a TicketProduct/componentRole pair.`,
      }));
    }
    seen.add(key);
    if (component.componentRole === 'primary') primaryCount += 1;
  });
  if (
    row.ticketComponents.length
    && (
      primaryCount < 1
      || !row.ticketComponents.some(
        (component) => (
          component
          && typeof component === 'object'
          && !Array.isArray(component)
          && normalizeCode(component.ticketProductCode) === normalizeCode(row.ticketProductCode)
          && component.componentRole === 'primary'
        )
      )
    )
  ) {
    errors.push(problem({
      code: 'PRIMARY_TICKET_COMPONENT_REQUIRED',
      dataset: 'shopProducts',
      row: rowNumber,
      field: 'ticketComponents',
      message: 'ticketProductCode must appear as a primary ticket component.',
    }));
  }
}

function courseDateSortKey(value) {
  const text = String(value).trim();
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    const instant = Date.parse(text);
    return Number.isNaN(instant) ? null : instant;
  }
  const match = text.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (!match) return null;
  return Number(
    `${match[1]}${match[2]}${match[3]}${match[4] || '00'}${match[5] || '00'}${match[6] || '00'}`
  );
}

function isCourseDateValue(value) {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(text);
}

function validateReferences(datasets, errors) {
  const ownerKey = (value) => normalizeSourceId(value) || 'platform';
  const ticketProducts = codeSet(datasets.ticketProducts);
  const shopProducts = codeSet(datasets.shopProducts);
  const scenarios = codeSet(datasets.scenarios);
  const sessions = codeSet(datasets.sessions);
  const tickets = codeSet(datasets.tickets);
  const studentIds = sourceIdSet(datasets.students);
  const orderIds = sourceIdSet(datasets.orders);
  const rsvpIds = sourceIdSet(datasets.rsvps);
  const redeemIds = sourceIdSet(datasets.redeemLogs);
  const redeemById = new Map(
    (datasets.redeemLogs || []).map((row) => [normalizeSourceId(row.sourceId), row])
  );
  const rsvpById = new Map(
    (datasets.rsvps || []).map((row) => [normalizeSourceId(row.sourceId), row])
  );
  const coachProfiles = new Set(
    (datasets.coachProfiles || []).map(
      (row) => `${normalizeSourceId(row.ownerUserId)}:${normalizeCode(row.code)}`
    )
  );
  const ticketProductOwner = new Map(
    (datasets.ticketProducts || []).map(
      (row) => [normalizeCode(row.code), ownerKey(row.ownerUserId)]
    )
  );
  const shopProductOwner = new Map(
    (datasets.shopProducts || []).map(
      (row) => [normalizeCode(row.code), ownerKey(row.ownerUserId)]
    )
  );
  const scenarioOwner = new Map(
    (datasets.scenarios || []).map(
      (row) => [normalizeCode(row.code), ownerKey(row.ownerUserId)]
    )
  );
  const studentOwner = new Map(
    (datasets.students || []).map(
      (row) => [normalizeSourceId(row.sourceId), ownerKey(row.ownerUserId)]
    )
  );
  const tenantMismatch = (dataset, row, field, message) => {
    errors.push(problem({
      code: 'CROSS_TENANT_REFERENCE',
      dataset,
      row,
      field,
      message,
    }));
  };
  const seenRsvpAttendance = new Set();
  for (const [index, row] of (datasets.rsvps || []).entries()) {
    const key = `${normalizeCode(row.sessionCode)}:${normalizeSourceId(row.studentSourceId)}`;
    if (seenRsvpAttendance.has(key)) {
      errors.push(problem({
        code: 'DUPLICATE_SESSION_STUDENT_RSVP',
        dataset: 'rsvps',
        row: index + 2,
        message: 'A Student may have only one RSVP row per Session.',
      }));
    }
    seenRsvpAttendance.add(key);
  }
  const seenPendingInvites = new Set();
  for (const [index, row] of (datasets.attendanceInvites || []).entries()) {
    if (row.status !== 'pending') continue;
    const key = `${normalizeCode(row.sessionCode)}:${normalizeSourceId(row.studentSourceId)}`;
    if (seenPendingInvites.has(key)) {
      errors.push(problem({
        code: 'DUPLICATE_PENDING_ATTENDANCE_INVITE',
        dataset: 'attendanceInvites',
        row: index + 2,
        message: 'A Student may have only one pending invite per Session.',
      }));
    }
    seenPendingInvites.add(key);
  }
  const orderItemIds = new Set();
  const duplicateOrderItemIds = new Set();
  const reversedSourceIds = new Set();
  for (const order of datasets.orders || []) {
    for (const item of order.items || []) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const key = normalizeSourceId(item.sourceId);
      if (orderItemIds.has(key)) duplicateOrderItemIds.add(key);
      orderItemIds.add(key);
    }
  }
  for (const sourceId of duplicateOrderItemIds) {
    errors.push(problem({
      code: 'DUPLICATE_ORDER_ITEM_SOURCE_ID',
      dataset: 'orders',
      message: `Order item sourceId "${sourceId}" is duplicated across orders.`,
    }));
  }

  (datasets.shopProducts || []).forEach((row, index) => {
    requireReference(errors, ticketProducts, row.ticketProductCode, {
      dataset: 'shopProducts',
      row: index + 2,
      field: 'ticketProductCode',
      target: 'ticketProducts.code',
    });
    if (
      ticketProductOwner.get(normalizeCode(row.ticketProductCode))
      && ticketProductOwner.get(normalizeCode(row.ticketProductCode)) !== ownerKey(row.ownerUserId)
    ) {
      tenantMismatch(
        'shopProducts',
        index + 2,
        'ticketProductCode',
        'ShopProduct and TicketProduct must belong to the same tenant.'
      );
    }
    for (const code of row.qualifyingTicketProductCodes || []) {
      requireReference(errors, ticketProducts, code, {
        dataset: 'shopProducts',
        row: index + 2,
        field: 'qualifyingTicketProductCodes',
        target: 'ticketProducts.code',
      });
      if (ticketProductOwner.get(normalizeCode(code)) !== ownerKey(row.ownerUserId)) {
        tenantMismatch(
          'shopProducts',
          index + 2,
          'qualifyingTicketProductCodes',
          'Returning-student TicketProducts must belong to the same tenant.'
        );
      }
    }
    for (const code of row.requiredAddonCodes || []) {
      requireReference(errors, shopProducts, code, {
        dataset: 'shopProducts',
        row: index + 2,
        field: 'requiredAddonCodes',
        target: 'shopProducts.code',
      });
      if (shopProductOwner.get(normalizeCode(code)) !== ownerKey(row.ownerUserId)) {
        tenantMismatch(
          'shopProducts',
          index + 2,
          'requiredAddonCodes',
          'Required add-ons must belong to the same tenant.'
        );
      }
    }
    for (const [componentIndex, component] of (row.ticketComponents || []).entries()) {
      if (!component || typeof component !== 'object' || Array.isArray(component)) continue;
      requireReference(errors, ticketProducts, component.ticketProductCode, {
        dataset: 'shopProducts',
        row: index + 2,
        field: `ticketComponents[${componentIndex}].ticketProductCode`,
        target: 'ticketProducts.code',
      });
      if (
        ticketProductOwner.get(normalizeCode(component.ticketProductCode))
        !== ownerKey(row.ownerUserId)
      ) {
        tenantMismatch(
          'shopProducts',
          index + 2,
          `ticketComponents[${componentIndex}].ticketProductCode`,
          'Ticket components must belong to the same tenant.'
        );
      }
    }
  });

  (datasets.scenarios || []).forEach((row, index) => {
    for (const code of row.allowedProductCodes || []) {
      requireReference(errors, ticketProducts, code, {
        dataset: 'scenarios',
        row: index + 2,
        field: 'allowedProductCodes',
        target: 'ticketProducts.code',
      });
      if (ticketProductOwner.get(normalizeCode(code)) !== ownerKey(row.ownerUserId)) {
        tenantMismatch(
          'scenarios',
          index + 2,
          'allowedProductCodes',
          'Scenario and allowed TicketProducts must belong to the same tenant.'
        );
      }
    }
  });

  (datasets.sessions || []).forEach((row, index) => {
    requireReference(errors, scenarios, row.scenarioCode, {
      dataset: 'sessions',
      row: index + 2,
      field: 'scenarioCode',
      target: 'scenarios.code',
    });
    if (scenarioOwner.get(normalizeCode(row.scenarioCode)) !== ownerKey(row.ownerUserId)) {
      tenantMismatch(
        'sessions',
        index + 2,
        'scenarioCode',
        'Session and Scenario must belong to the same tenant.'
      );
    }
    if (row.productCode) {
      requireReference(errors, shopProducts, row.productCode, {
        dataset: 'sessions',
        row: index + 2,
        field: 'productCode',
        target: 'shopProducts.code',
      });
      if (shopProductOwner.get(normalizeCode(row.productCode)) !== ownerKey(row.ownerUserId)) {
        tenantMismatch(
          'sessions',
          index + 2,
          'productCode',
          'Session and ShopProduct must belong to the same tenant.'
        );
      }
    }
    if (row.coachCode) {
      const coachKey = `${normalizeSourceId(row.ownerUserId)}:${normalizeCode(row.coachCode)}`;
      if (!coachProfiles.has(coachKey)) {
        errors.push(problem({
          code: 'UNKNOWN_REFERENCE',
          dataset: 'sessions',
          row: index + 2,
          field: 'coachCode',
          message: `coachCode "${row.coachCode}" does not match a coach profile in the same owner tenant.`,
        }));
      }
    }
  });

  (datasets.tickets || []).forEach((row, index) => {
    requireReference(errors, ticketProducts, row.ticketProductCode, {
      dataset: 'tickets',
      row: index + 2,
      field: 'ticketProductCode',
      target: 'ticketProducts.code',
    });
    const ticketOwner = studentOwner.get(normalizeSourceId(row.studentSourceId));
    if (
      ticketOwner
      && ticketProductOwner.get(normalizeCode(row.ticketProductCode)) !== ticketOwner
    ) {
      tenantMismatch(
        'tickets',
        index + 2,
        'ticketProductCode',
        'Ticket, Student and TicketProduct must belong to the same tenant.'
      );
    }
    requireReference(errors, studentIds, row.studentSourceId, {
      dataset: 'tickets',
      row: index + 2,
      field: 'studentSourceId',
      target: 'students.sourceId',
      normalize: normalizeSourceId,
    });
    if (row.shopProductCode) {
      requireReference(errors, shopProducts, row.shopProductCode, {
        dataset: 'tickets',
        row: index + 2,
        field: 'shopProductCode',
        target: 'shopProducts.code',
      });
      if (shopProductOwner.get(normalizeCode(row.shopProductCode)) !== ticketOwner) {
        tenantMismatch(
          'tickets',
          index + 2,
          'shopProductCode',
          'Ticket and ShopProduct must belong to the same tenant.'
        );
      }
    }
    if (row.orderSourceId) {
      requireReference(errors, orderIds, row.orderSourceId, {
        dataset: 'tickets',
        row: index + 2,
        field: 'orderSourceId',
        target: 'orders.sourceId',
        normalize: normalizeSourceId,
      });
    }
    if (row.orderItemSourceId) {
      requireReference(errors, orderItemIds, row.orderItemSourceId, {
        dataset: 'tickets',
        row: index + 2,
        field: 'orderItemSourceId',
        target: 'orders.items.sourceId',
        normalize: normalizeSourceId,
      });
    }
    if (
      Number.isSafeInteger(row.totalUses)
      && Number.isSafeInteger(row.remainingUses)
      && (row.remainingUses < 0 || row.remainingUses > row.totalUses)
    ) {
      errors.push(problem({
        code: 'INVALID_TICKET_BALANCE',
        dataset: 'tickets',
        row: index + 2,
        message: 'remainingUses must be between zero and totalUses.',
      }));
    }
  });

  (datasets.orders || []).forEach((row, index) => {
    requireReference(errors, studentIds, row.studentSourceId, {
      dataset: 'orders',
      row: index + 2,
      field: 'studentSourceId',
      target: 'students.sourceId',
      normalize: normalizeSourceId,
    });
    const orderOwner = studentOwner.get(normalizeSourceId(row.studentSourceId));
    for (const [itemIndex, item] of (row.items || []).entries()) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      if (item.shopProductCode) {
        requireReference(errors, shopProducts, item.shopProductCode, {
          dataset: 'orders',
          row: index + 2,
          field: `items[${itemIndex}].shopProductCode`,
          target: 'shopProducts.code',
        });
        if (shopProductOwner.get(normalizeCode(item.shopProductCode)) !== orderOwner) {
          tenantMismatch(
            'orders',
            index + 2,
            `items[${itemIndex}].shopProductCode`,
            'Order item and Student must belong to the same tenant.'
          );
        }
      }
      if (item.ticketProductCode) {
        requireReference(errors, ticketProducts, item.ticketProductCode, {
          dataset: 'orders',
          row: index + 2,
          field: `items[${itemIndex}].ticketProductCode`,
          target: 'ticketProducts.code',
        });
        if (ticketProductOwner.get(normalizeCode(item.ticketProductCode)) !== orderOwner) {
          tenantMismatch(
            'orders',
            index + 2,
            `items[${itemIndex}].ticketProductCode`,
            'Order item and Student must belong to the same tenant.'
          );
        }
      }
    }
    const itemTotal = (row.items || []).reduce(
      (sum, item) => sum + (Number(item?.lineTotal) || 0),
      0
    );
    if (Math.abs(itemTotal - Number(row.totalAmount)) > 0.005) {
      errors.push(problem({
        code: 'ORDER_TOTAL_MISMATCH',
        dataset: 'orders',
        row: index + 2,
        field: 'totalAmount',
        message: `Order item total ${itemTotal.toFixed(2)} does not equal totalAmount ${Number(row.totalAmount).toFixed(2)}.`,
      }));
    }
  });

  const issuedTicketCountByOrderItem = new Map();
  for (const ticket of datasets.tickets || []) {
    if (!ticket.orderItemSourceId) continue;
    const key = normalizeSourceId(ticket.orderItemSourceId);
    issuedTicketCountByOrderItem.set(
      key,
      (issuedTicketCountByOrderItem.get(key) || 0) + 1
    );
  }
  for (const [orderIndex, order] of (datasets.orders || []).entries()) {
    for (const [itemIndex, item] of (order.items || []).entries()) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const issuedCount = issuedTicketCountByOrderItem.get(
        normalizeSourceId(item.sourceId)
      ) || 0;
      if (item.issuanceStatus === 'issued' && issuedCount < Number(item.quantity)) {
        errors.push(problem({
          code: 'ORDER_ITEM_ISSUANCE_WITHOUT_TICKETS',
          dataset: 'orders',
          row: orderIndex + 2,
          field: `items[${itemIndex}].issuanceStatus`,
          message: 'An issued order item must have at least quantity matching ticket rows.',
        }));
      }
    }
  }

  (datasets.rsvps || []).forEach((row, index) => {
    requireReference(errors, sessions, row.sessionCode, {
      dataset: 'rsvps',
      row: index + 2,
      field: 'sessionCode',
      target: 'sessions.code',
    });
    requireReference(errors, studentIds, row.studentSourceId, {
      dataset: 'rsvps',
      row: index + 2,
      field: 'studentSourceId',
      target: 'students.sourceId',
      normalize: normalizeSourceId,
    });
    if (row.ticketCode) {
      requireReference(errors, tickets, row.ticketCode, {
        dataset: 'rsvps',
        row: index + 2,
        field: 'ticketCode',
        target: 'tickets.code',
      });
    }
  });

  (datasets.redeemLogs || []).forEach((row, index) => {
    if (row.ticketCode) {
      requireReference(errors, tickets, row.ticketCode, {
        dataset: 'redeemLogs',
        row: index + 2,
        field: 'ticketCode',
        target: 'tickets.code',
      });
    }
    if (row.sessionCode) {
      requireReference(errors, sessions, row.sessionCode, {
        dataset: 'redeemLogs',
        row: index + 2,
        field: 'sessionCode',
        target: 'sessions.code',
      });
    }
    if (row.rsvpSourceId) {
      requireReference(errors, rsvpIds, row.rsvpSourceId, {
        dataset: 'redeemLogs',
        row: index + 2,
        field: 'rsvpSourceId',
        target: 'rsvps.sourceId',
        normalize: normalizeSourceId,
      });
      const rsvp = rsvpById.get(normalizeSourceId(row.rsvpSourceId));
      if (
        rsvp
        && (
          (
            row.ticketCode
            && rsvp.ticketCode
            && normalizeCode(row.ticketCode) !== normalizeCode(rsvp.ticketCode)
          )
          || (row.sessionCode && normalizeCode(row.sessionCode) !== normalizeCode(rsvp.sessionCode))
          || (
            row.studentSourceId
            && normalizeSourceId(row.studentSourceId) !== normalizeSourceId(rsvp.studentSourceId)
          )
        )
      ) {
        errors.push(problem({
          code: 'USAGE_RSVP_REFERENCE_MISMATCH',
          dataset: 'redeemLogs',
          row: index + 2,
          field: 'rsvpSourceId',
          message: 'Usage ticket/session/student must match its referenced RSVP.',
        }));
      }
    }
    if (row.reversesSourceId) {
      const reversed = redeemById.get(normalizeSourceId(row.reversesSourceId));
      const reversedKey = normalizeSourceId(row.reversesSourceId);
      if (reversedSourceIds.has(reversedKey)) {
        errors.push(problem({
          code: 'DUPLICATE_USAGE_REVERSAL',
          dataset: 'redeemLogs',
          row: index + 2,
          field: 'reversesSourceId',
          message: 'A usage event may be reversed only once.',
        }));
      }
      reversedSourceIds.add(reversedKey);
      if (
        reversed
        && courseDateSortKey(reversed.occurredAt) >= courseDateSortKey(row.occurredAt)
      ) {
        errors.push(problem({
          code: 'REVERSAL_BEFORE_SOURCE',
          dataset: 'redeemLogs',
          row: index + 2,
          field: 'reversesSourceId',
          message: 'A reversal must occur after the event it reverses.',
        }));
      }
      const expectedSourceType = {
        SUCCESS_REVERSAL: 'SUCCESS',
        NO_SHOW_REVERSAL: 'NO_SHOW',
      }[row.eventType];
      if (!expectedSourceType || (reversed && reversed.eventType !== expectedSourceType)) {
        errors.push(problem({
          code: 'INVALID_USAGE_REVERSAL_PAIR',
          dataset: 'redeemLogs',
          row: index + 2,
          field: 'reversesSourceId',
          message: 'SUCCESS_REVERSAL/NO_SHOW_REVERSAL must reference the matching source event type.',
        }));
      }
    }
    if (!row.ticketCode && Number(row.deltaUses) !== 0) {
      errors.push(problem({
        code: 'NO_TICKET_NONZERO_DELTA',
        dataset: 'redeemLogs',
        row: index + 2,
        field: 'deltaUses',
        message: 'A no-ticket audit event must have deltaUses = 0.',
      }));
    }
  });

  (datasets.attendanceInvites || []).forEach((row, index) => {
    requireReference(errors, sessions, row.sessionCode, {
      dataset: 'attendanceInvites',
      row: index + 2,
      field: 'sessionCode',
      target: 'sessions.code',
    });
    requireReference(errors, studentIds, row.studentSourceId, {
      dataset: 'attendanceInvites',
      row: index + 2,
      field: 'studentSourceId',
      target: 'students.sourceId',
      normalize: normalizeSourceId,
    });
    if (row.ticketCode) {
      requireReference(errors, tickets, row.ticketCode, {
        dataset: 'attendanceInvites',
        row: index + 2,
        field: 'ticketCode',
        target: 'tickets.code',
      });
    }
    if (row.rsvpSourceId) {
      requireReference(errors, rsvpIds, row.rsvpSourceId, {
        dataset: 'attendanceInvites',
        row: index + 2,
        field: 'rsvpSourceId',
        target: 'rsvps.sourceId',
        normalize: normalizeSourceId,
      });
      const rsvp = rsvpById.get(normalizeSourceId(row.rsvpSourceId));
      if (
        rsvp
        && (
          normalizeCode(row.sessionCode) !== normalizeCode(rsvp.sessionCode)
          || normalizeSourceId(row.studentSourceId) !== normalizeSourceId(rsvp.studentSourceId)
          || (
            row.ticketCode
            && rsvp.ticketCode
            && normalizeCode(row.ticketCode) !== normalizeCode(rsvp.ticketCode)
          )
        )
      ) {
        errors.push(problem({
          code: 'INVITE_RSVP_REFERENCE_MISMATCH',
          dataset: 'attendanceInvites',
          row: index + 2,
          field: 'rsvpSourceId',
          message: 'Invite ticket/session/student must match its referenced RSVP.',
        }));
      }
    }
    if (row.redeemedUsageSourceId) {
      requireReference(errors, redeemIds, row.redeemedUsageSourceId, {
        dataset: 'attendanceInvites',
        row: index + 2,
        field: 'redeemedUsageSourceId',
        target: 'redeemLogs.sourceId',
        normalize: normalizeSourceId,
      });
      const usage = redeemById.get(normalizeSourceId(row.redeemedUsageSourceId));
      if (
        usage
        && (
          (row.ticketCode && normalizeCode(row.ticketCode) !== normalizeCode(usage.ticketCode))
          || normalizeCode(row.sessionCode) !== normalizeCode(usage.sessionCode)
          || normalizeSourceId(row.studentSourceId)
            !== normalizeSourceId(usage.studentSourceId || row.studentSourceId)
        )
      ) {
        errors.push(problem({
          code: 'INVITE_USAGE_REFERENCE_MISMATCH',
          dataset: 'attendanceInvites',
          row: index + 2,
          field: 'redeemedUsageSourceId',
          message: 'Invite ticket/session/student must match its redeemed usage event.',
        }));
      }
    }
  });
}

function codeSet(rows = []) {
  return new Set(rows.map((row) => normalizeCode(row.code)).filter(Boolean));
}

function sourceIdSet(rows = []) {
  return new Set(rows.map((row) => normalizeSourceId(row.sourceId)).filter(Boolean));
}

function normalizeSourceId(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function requireReference(errors, values, value, {
  dataset,
  row,
  field,
  target,
  normalize = normalizeCode,
}) {
  if (isBlank(value)) return;
  if (!values.has(normalize(value))) {
    errors.push(problem({
      code: 'UNKNOWN_REFERENCE',
      dataset,
      row,
      field,
      message: `${field} "${value}" does not match ${target} in this snapshot.`,
    }));
  }
}

function buildSourceReconciliation(datasets, errors) {
  const tickets = datasets.tickets || [];
  const rsvps = datasets.rsvps || [];
  const attendanceInvites = datasets.attendanceInvites || [];
  const redeemLogs = datasets.redeemLogs || [];
  const remainingByTicket = new Map(
    tickets.map((ticket) => [normalizeCode(ticket.code), Number(ticket.remainingUses) || 0])
  );
  const bookedByTicket = new Map();
  const rsvpBySource = new Map(
    rsvps.map((row) => [normalizeSourceId(row.sourceId), row])
  );

  for (const rsvp of rsvps) {
    if (String(rsvp.status || '').toLowerCase() !== 'booked' || !rsvp.ticketCode) continue;
    const key = normalizeCode(rsvp.ticketCode);
    bookedByTicket.set(key, (bookedByTicket.get(key) || 0) + 1);
  }
  for (const invite of attendanceInvites) {
    if (String(invite.status || '').toLowerCase() !== 'pending' || !invite.ticketCode) continue;
    const linkedRsvp = invite.rsvpSourceId
      ? rsvpBySource.get(normalizeSourceId(invite.rsvpSourceId))
      : null;
    if (
      linkedRsvp
      && String(linkedRsvp.status || '').toLowerCase() === 'booked'
      && normalizeCode(linkedRsvp.ticketCode) === normalizeCode(invite.ticketCode)
    ) {
      continue;
    }
    const key = normalizeCode(invite.ticketCode);
    bookedByTicket.set(key, (bookedByTicket.get(key) || 0) + 1);
  }

  let overReservedTicketCount = 0;
  for (const [ticketCode, bookedCount] of bookedByTicket) {
    const remaining = remainingByTicket.get(ticketCode);
    if (remaining != null && bookedCount > remaining) {
      overReservedTicketCount += 1;
      errors.push(problem({
        code: 'OVER_RESERVED_TICKET',
        dataset: 'rsvps',
        message: `Ticket ${ticketCode} has ${bookedCount} active RSVP/invite holds but only ${remaining} remaining uses.`,
      }));
    }
  }

  const usageByTicket = new Map();
  const issuanceByTicket = new Set();
  const issuanceCountByTicket = new Map();
  for (const event of redeemLogs) {
    if (!event.ticketCode) continue;
    const ticketCode = normalizeCode(event.ticketCode);
    usageByTicket.set(
      ticketCode,
      (usageByTicket.get(ticketCode) || 0) + (Number(event.deltaUses) || 0)
    );
    if (event.eventType === 'ISSUANCE') issuanceByTicket.add(ticketCode);
    if (event.eventType === 'ISSUANCE') {
      issuanceCountByTicket.set(
        ticketCode,
        (issuanceCountByTicket.get(ticketCode) || 0) + 1
      );
    }
  }
  let ledgerBalanceMismatchCount = 0;
  let negativeRunningBalanceCount = 0;
  for (const ticket of tickets) {
    const ticketCode = normalizeCode(ticket.code);
    const ticketEvents = redeemLogs
      .filter((event) => normalizeCode(event.ticketCode) === ticketCode)
      .sort((left, right) => (
        courseDateSortKey(left.occurredAt) - courseDateSortKey(right.occurredAt)
        || String(left.sourceId).localeCompare(String(right.sourceId))
      ));
    if ((issuanceCountByTicket.get(ticketCode) || 0) > 1) {
      errors.push(problem({
        code: 'MULTIPLE_TICKET_ISSUANCE_EVENTS',
        dataset: 'redeemLogs',
        message: `Ticket ${ticket.code} has more than one issuance event.`,
      }));
    }
    const sourceIssuance = ticketEvents.find((event) => event.eventType === 'ISSUANCE');
    if (sourceIssuance && Number(sourceIssuance.deltaUses) !== Number(ticket.totalUses)) {
      errors.push(problem({
        code: 'TICKET_ISSUANCE_TOTAL_MISMATCH',
        dataset: 'redeemLogs',
        message: `Ticket ${ticket.code} issuance delta must equal totalUses.`,
      }));
    }
    if (
      !sourceIssuance
      && ticketEvents.some(
        (event) => courseDateSortKey(event.occurredAt) < courseDateSortKey(ticket.issuedAt)
      )
    ) {
      errors.push(problem({
        code: 'USAGE_BEFORE_TICKET_ISSUANCE',
        dataset: 'redeemLogs',
        message: `Ticket ${ticket.code} has usage before issuedAt.`,
      }));
    }
    let runningBalance = sourceIssuance ? 0 : Number(ticket.totalUses);
    for (const event of ticketEvents) {
      runningBalance += Number(event.deltaUses) || 0;
      if (runningBalance < 0) {
        negativeRunningBalanceCount += 1;
        errors.push(problem({
          code: 'NEGATIVE_RUNNING_LEDGER_BALANCE',
          dataset: 'redeemLogs',
          message: `Ticket ${ticket.code} becomes negative at usage ${event.sourceId}.`,
        }));
        break;
      }
    }
    const expected = (
      (issuanceByTicket.has(ticketCode) ? 0 : Number(ticket.totalUses))
      + (usageByTicket.get(ticketCode) || 0)
    );
    if (expected !== Number(ticket.remainingUses)) {
      ledgerBalanceMismatchCount += 1;
      errors.push(problem({
        code: 'LEDGER_BALANCE_MISMATCH',
        dataset: 'tickets',
        message: `Ticket ${ticket.code} ledger resolves to ${expected}; remainingUses is ${ticket.remainingUses}.`,
      }));
    }
  }

  return {
    ticketCount: tickets.length,
    remainingUses: tickets.reduce((sum, row) => sum + (Number(row.remainingUses) || 0), 0),
    rsvpCount: rsvps.length,
    bookedRsvpCount: rsvps.filter(
      (row) => String(row.status || '').toLowerCase() === 'booked'
    ).length,
    usageEventCount: redeemLogs.length,
    usageDelta: redeemLogs.reduce((sum, row) => sum + (Number(row.deltaUses) || 0), 0),
    overReservedTicketCount,
    ledgerBalanceMismatchCount,
    negativeRunningBalanceCount,
  };
}

function problem({
  code,
  dataset = null,
  row = null,
  field = null,
  message,
  fields,
}) {
  return {
    severity: 'blocking',
    code,
    dataset,
    row,
    field,
    ...(fields ? { fields } : {}),
    message,
  };
}

function buildStagingRows(validation) {
  const rows = [];
  for (const [datasetName, datasetRows] of Object.entries(validation.datasets)) {
    const datasetContract = DATASET_CONTRACTS[datasetName];
    datasetRows.forEach((payload, index) => {
      rows.push({
        datasetName,
        sourceId: String(payload.sourceId || `row:${index + 2}`),
        sourceCode: datasetContract.codeField
          ? String(payload[datasetContract.codeField] || '') || null
          : null,
        rowHash: hashValue(payload),
        payload,
      });
    });
  }
  for (const order of validation.datasets.orders || []) {
    for (const item of order.items || []) {
      rows.push({
        datasetName: 'orderItems',
        sourceId: String(item.sourceId),
        sourceCode: String(item.itemCode || '') || null,
        rowHash: hashValue(item),
        payload: {
          ...item,
          orderSourceId: order.sourceId,
        },
      });
    }
  }
  return rows;
}

function buildDryRunReport(snapshot, validation) {
  const datasetSummary = {};
  for (const [name, rows] of Object.entries(validation.datasets)) {
    datasetSummary[name] = {
      rowCount: rows.length,
      contentHash: hashValue(rows),
    };
  }
  return {
    mode: 'dry-run',
    ok: validation.ok,
    contractVersion: snapshot.contractVersion,
    source: snapshot.source,
    snapshotHash: hashValue(snapshot),
    datasets: datasetSummary,
    reconciliation: validation.reconciliation,
    blockingErrors: validation.errors,
  };
}

function publicContract() {
  return {
    contractVersion: CONTRACT_VERSION,
    source: 'gas',
    timezone: 'Asia/Taipei',
    datasets: Object.fromEntries(
      Object.entries(DATASET_CONTRACTS).map(([name, value]) => [
        name,
        {
          required: [...value.required],
          optional: [...value.optional],
          arrayFields: [...value.listFields],
        },
      ])
    ),
  };
}

module.exports = {
  CONTRACT_VERSION,
  DATASET_CONTRACTS,
  buildDryRunReport,
  buildSourceReconciliation,
  buildStagingRows,
  canonicalize,
  hashValue,
  normalizeCode,
  normalizeEmail,
  normalizeSnapshot,
  parseCsv,
  parseSnapshotText,
  publicContract,
  stableStringify,
  validateSnapshot,
};
