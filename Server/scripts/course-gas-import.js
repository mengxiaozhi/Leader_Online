#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const {
  CONTRACT_VERSION,
  buildDryRunReport,
  buildStagingRows,
  hashValue,
  normalizeCode,
  parseSnapshotText,
  publicContract,
  validateSnapshot,
} = require('./course-gas-import-lib');
const { materializeSnapshot } = require('./course-gas-import-materialize');

const REQUIRED_FINAL_DATASETS = Object.freeze([
  'students',
  'ticketProducts',
  'shopProducts',
  'scenarios',
  'sessions',
  'tickets',
  'orders',
  'rsvps',
  'attendanceInvites',
  'redeemLogs',
  'staff',
  'coachProfiles',
  'settings',
]);
const REQUIRED_NONEMPTY_FINAL_DATASETS = Object.freeze([
  'students',
  'ticketProducts',
  'shopProducts',
  'scenarios',
  'sessions',
  'tickets',
]);
const MATERIALIZED_TARGET_TABLES = Object.freeze({
  students: 'course_students',
  ticketProducts: 'course_ticket_products',
  shopProducts: 'course_products',
  scenarios: 'course_redeem_scenarios',
  sessions: 'course_sessions',
  tickets: 'course_tickets',
  orders: 'course_orders',
  orderItems: 'course_order_items',
  rsvps: 'course_bookings',
  attendanceInvites: 'course_attendance_invites',
  redeemLogs: 'course_usage_events',
  staff: 'course_staff_memberships',
  coachProfiles: 'course_coach_profiles',
  settings: 'course_settings',
});

function usage() {
  return [
    'Course GAS import rehearsal / one-time cutover staging',
    '',
    'Dry-run (default):',
    '  node scripts/course-gas-import.js --input snapshot.json',
    '  node scripts/course-gas-import.js --input tickets.csv --dataset tickets --format csv',
    '',
    'Stage a rehearsal in MySQL:',
    '  node scripts/course-gas-import.js --input snapshot.json --apply-staging',
    '',
    'Final cutover evidence (all are required for --mode cutover):',
    '  --installer Installer.gs',
    '  --installer-hash <sha256>',
    '  --source-contract gas-course-contract.json',
    '  --backup-manifest course-cutover-backups.json',
    '  snapshot.metadata.sheetId, sheetRevision, finalReadOnlyRevision,',
    '  gasWritesFrozenAt, gasSnapshotHash and mysqlBackupId',
    '',
    'Freeze, materialize, activate and release are separate operations:',
    '  ... --mode cutover --apply-staging --freeze-writes <snapshot-sha256>',
    '  ... --mode cutover --apply-staging --materialize <snapshot-sha256>',
    '  ... --mode cutover --apply-staging --activate <snapshot-sha256>',
    '  ... --mode cutover --apply-staging --release-maintenance <snapshot-sha256>',
    '      --smoke-evidence course-cutover-smoke.json',
    '',
    'Other:',
    '  --contract       print the rehearsal field contract',
    '  --help           print this help',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    mode: 'rehearsal',
    format: null,
    dataset: null,
    input: null,
    installer: null,
    installerHash: null,
    sourceContract: null,
    backupManifest: null,
    applyStaging: false,
    freezeHash: null,
    materializeHash: null,
    activateHash: null,
    releaseHash: null,
    smokeEvidence: null,
    contract: false,
    help: false,
  };
  const valueOptions = new Map([
    ['--mode', 'mode'],
    ['--format', 'format'],
    ['--dataset', 'dataset'],
    ['--input', 'input'],
    ['--installer', 'installer'],
    ['--installer-hash', 'installerHash'],
    ['--source-contract', 'sourceContract'],
    ['--backup-manifest', 'backupManifest'],
    ['--freeze-writes', 'freezeHash'],
    ['--materialize', 'materializeHash'],
    ['--activate', 'activateHash'],
    ['--release-maintenance', 'releaseHash'],
    ['--smoke-evidence', 'smokeEvidence'],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--apply-staging') {
      args.applyStaging = true;
      continue;
    }
    if (token === '--contract') {
      args.contract = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    const property = valueOptions.get(token);
    if (!property) {
      const error = new Error(`Unknown argument "${token}".`);
      error.code = 'UNKNOWN_ARGUMENT';
      throw error;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      const error = new Error(`${token} requires a value.`);
      error.code = 'ARGUMENT_VALUE_REQUIRED';
      throw error;
    }
    args[property] = value;
    index += 1;
  }

  args.mode = String(args.mode).toLowerCase();
  if (!['rehearsal', 'cutover'].includes(args.mode)) {
    const error = new Error('--mode must be rehearsal or cutover.');
    error.code = 'INVALID_MODE';
    throw error;
  }
  const actions = [
    args.freezeHash,
    args.materializeHash,
    args.activateHash,
    args.releaseHash,
  ].filter(Boolean);
  if (actions.length > 1) {
    const error = new Error('Only one cutover transition may run per invocation.');
    error.code = 'MULTIPLE_CUTOVER_ACTIONS';
    throw error;
  }
  if (actions.length && !args.applyStaging) {
    const error = new Error('Cutover transitions require --apply-staging.');
    error.code = 'APPLY_STAGING_REQUIRED';
    throw error;
  }
  if (actions.length && args.mode !== 'cutover') {
    const error = new Error('Cutover transitions require --mode cutover.');
    error.code = 'CUTOVER_MODE_REQUIRED';
    throw error;
  }
  if (args.releaseHash && !args.smokeEvidence) {
    const error = new Error('--release-maintenance requires --smoke-evidence.');
    error.code = 'SMOKE_EVIDENCE_REQUIRED';
    throw error;
  }
  if (args.smokeEvidence && !args.releaseHash) {
    const error = new Error('--smoke-evidence is only valid with --release-maintenance.');
    error.code = 'SMOKE_EVIDENCE_WITHOUT_RELEASE';
    throw error;
  }
  return args;
}

function readUtf8(filePath, label) {
  if (!filePath) {
    const error = new Error(`${label} path is required.`);
    error.code = 'FILE_REQUIRED';
    throw error;
  }
  return fs.readFileSync(path.resolve(filePath), 'utf8');
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function validateFinalEvidence(snapshot, args) {
  const missingDatasets = REQUIRED_FINAL_DATASETS.filter(
    (name) => !Object.prototype.hasOwnProperty.call(snapshot.datasets, name)
  );
  const issues = [];
  if (missingDatasets.length > 0) {
    issues.push({
      code: 'INCOMPLETE_FINAL_SNAPSHOT',
      message: `Missing final datasets: ${missingDatasets.join(', ')}.`,
    });
  }
  const emptyRequiredDatasets = REQUIRED_NONEMPTY_FINAL_DATASETS.filter(
    (name) => Array.isArray(snapshot.datasets[name]) && snapshot.datasets[name].length === 0
  );
  if (emptyRequiredDatasets.length > 0) {
    issues.push({
      code: 'EMPTY_FINAL_DATASET',
      message: `Final snapshot cannot have empty core datasets: ${emptyRequiredDatasets.join(', ')}.`,
    });
  }

  let installerText = null;
  let installerHash = null;
  let sourceContract = null;
  let backupManifest = null;
  let backupManifestText = null;
  if (!args.installer) {
    issues.push({
      code: 'INSTALLER_EVIDENCE_REQUIRED',
      message: '--installer must point to the reviewed GAS Installer.gs source.',
    });
  } else {
    installerText = readUtf8(args.installer, 'Installer.gs');
    installerHash = sha256Text(installerText);
  }
  if (!args.installerHash) {
    issues.push({
      code: 'INSTALLER_HASH_REQUIRED',
      message: '--installer-hash is required for a final cutover.',
    });
  } else if (installerHash && args.installerHash.toLowerCase() !== installerHash) {
    issues.push({
      code: 'INSTALLER_HASH_MISMATCH',
      message: 'Installer.gs does not match --installer-hash.',
    });
  }
  if (!args.sourceContract) {
    issues.push({
      code: 'SOURCE_CONTRACT_REQUIRED',
      message: '--source-contract is required; the built-in contract is rehearsal-only.',
    });
  } else {
    try {
      sourceContract = JSON.parse(readUtf8(args.sourceContract, 'source contract'));
    } catch (error) {
      issues.push({
        code: 'INVALID_SOURCE_CONTRACT',
        message: `Source contract cannot be parsed: ${error.message}`,
      });
    }
  }
  if (sourceContract) {
    if (sourceContract.contractVersion !== CONTRACT_VERSION) {
      issues.push({
        code: 'SOURCE_CONTRACT_VERSION_MISMATCH',
        message: `Source contract must declare ${CONTRACT_VERSION}.`,
      });
    }
    if (!sourceContract.installerHash || sourceContract.installerHash !== installerHash) {
      issues.push({
        code: 'SOURCE_CONTRACT_INSTALLER_MISMATCH',
        message: 'Source contract installerHash must match the reviewed Installer.gs.',
      });
    }
    if (!sourceContract.datasets || typeof sourceContract.datasets !== 'object') {
      issues.push({
        code: 'SOURCE_CONTRACT_DATASETS_REQUIRED',
        message: 'Source contract must contain the reviewed datasets/field mapping.',
      });
    } else if (
      hashValue(sourceContract.datasets) !== hashValue(publicContract().datasets)
    ) {
      issues.push({
        code: 'SOURCE_CONTRACT_FIELDS_MISMATCH',
        message: 'Reviewed source contract datasets do not exactly match the importer contract.',
      });
    }
  }

  if (!args.backupManifest) {
    issues.push({
      code: 'BACKUP_MANIFEST_REQUIRED',
      message: '--backup-manifest is required for a final cutover.',
    });
  } else {
    try {
      backupManifestText = readUtf8(args.backupManifest, 'backup manifest');
      backupManifest = JSON.parse(backupManifestText);
    } catch (error) {
      issues.push({
        code: 'INVALID_BACKUP_MANIFEST',
        message: `Backup manifest cannot be parsed: ${error.message}`,
      });
    }
  }

  const metadata = snapshot.metadata && typeof snapshot.metadata === 'object'
    ? snapshot.metadata
    : {};
  if (
    !metadata.sheetId
    || !metadata.sheetRevision
    || !metadata.finalReadOnlyRevision
    || !metadata.gasWritesFrozenAt
    || !metadata.gasSnapshotHash
    || !metadata.mysqlBackupId
  ) {
    issues.push({
      code: 'SHEET_EVIDENCE_REQUIRED',
      message: 'Final snapshot metadata must bind the Sheet revision, GAS freeze, GAS snapshot and MySQL backup.',
    });
  }
  if (
    metadata.sheetRevision
    && metadata.finalReadOnlyRevision
    && metadata.sheetRevision !== metadata.finalReadOnlyRevision
  ) {
    issues.push({
      code: 'FINAL_READ_ONLY_REVISION_MISMATCH',
      message: 'sheetRevision must equal finalReadOnlyRevision after GAS writes are frozen.',
    });
  }
  if (
    metadata.gasSnapshotHash
    && !/^[a-f0-9]{64}$/i.test(String(metadata.gasSnapshotHash))
  ) {
    issues.push({
      code: 'INVALID_GAS_SNAPSHOT_HASH',
      message: 'snapshot.metadata.gasSnapshotHash must be a SHA-256 hash.',
    });
  }
  const frozenAt = Date.parse(metadata.gasWritesFrozenAt || '');
  const generatedAt = Date.parse(snapshot.generatedAt || '');
  if (!Number.isFinite(frozenAt) || !Number.isFinite(generatedAt) || frozenAt > generatedAt) {
    issues.push({
      code: 'INVALID_GAS_FREEZE_EVIDENCE',
      message: 'generatedAt must be a valid time at or after gasWritesFrozenAt.',
    });
  }
  if (metadata.installerHash && installerHash && metadata.installerHash !== installerHash) {
    issues.push({
      code: 'SNAPSHOT_INSTALLER_MISMATCH',
      message: 'snapshot.metadata.installerHash does not match Installer.gs.',
    });
  }
  if (backupManifest) {
    const requiredBackupFields = [
      'mysqlBackupId',
      'mysqlBackupCreatedAt',
      'gasBackupId',
      'gasSnapshotHash',
      'sourceMappingBackupId',
      'createdAt',
      'finalSnapshotHash',
    ];
    const missingBackupFields = requiredBackupFields.filter(
      (field) => !backupManifest[field]
    );
    if (missingBackupFields.length) {
      issues.push({
        code: 'INCOMPLETE_BACKUP_MANIFEST',
        message: `Backup manifest is missing: ${missingBackupFields.join(', ')}.`,
      });
    }
    if (
      backupManifest.finalSnapshotHash
      && backupManifest.finalSnapshotHash !== hashValue(snapshot)
    ) {
      issues.push({
        code: 'BACKUP_SNAPSHOT_HASH_MISMATCH',
        message: 'Backup manifest finalSnapshotHash does not match this final snapshot.',
      });
    }
    if (
      backupManifest.gasSnapshotHash
      && backupManifest.gasSnapshotHash !== metadata.gasSnapshotHash
    ) {
      issues.push({
        code: 'BACKUP_GAS_HASH_MISMATCH',
        message: 'Backup manifest gasSnapshotHash does not match snapshot metadata.',
      });
    }
    if (
      backupManifest.mysqlBackupId
      && backupManifest.mysqlBackupId !== metadata.mysqlBackupId
    ) {
      issues.push({
        code: 'BACKUP_MYSQL_ID_MISMATCH',
        message: 'Backup manifest mysqlBackupId does not match snapshot metadata.',
      });
    }
    for (const field of ['mysqlBackupCreatedAt', 'createdAt']) {
      if (backupManifest[field] && !Number.isFinite(Date.parse(backupManifest[field]))) {
        issues.push({
          code: 'INVALID_BACKUP_TIMESTAMP',
          message: `Backup manifest ${field} must be a valid timestamp.`,
        });
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    evidence: {
      installerHash,
      sourceContractHash: sourceContract ? hashValue(sourceContract) : null,
      backupManifestHash: backupManifestText ? sha256Text(backupManifestText) : null,
      mysqlBackupId: metadata.mysqlBackupId || null,
      gasSnapshotHash: metadata.gasSnapshotHash || null,
      gasWritesFrozenAt: metadata.gasWritesFrozenAt || null,
      sheetId: metadata.sheetId || null,
      sheetRevision: metadata.sheetRevision || null,
      finalReadOnlyRevision: metadata.finalReadOnlyRevision || null,
    },
  };
}

function validateSmokeEvidence(snapshotHash, filePath) {
  const issues = [];
  let text = null;
  let smoke = null;
  try {
    text = readUtf8(filePath, 'smoke evidence');
    smoke = JSON.parse(text);
  } catch (error) {
    issues.push({
      code: 'INVALID_SMOKE_EVIDENCE',
      message: `Smoke evidence cannot be parsed: ${error.message}`,
    });
  }
  if (smoke) {
    if (smoke.snapshotHash !== snapshotHash) {
      issues.push({
        code: 'SMOKE_SNAPSHOT_HASH_MISMATCH',
        message: 'Smoke evidence snapshotHash does not match this final snapshot.',
      });
    }
    if (!Number.isFinite(Date.parse(smoke.checkedAt || ''))) {
      issues.push({
        code: 'SMOKE_TIMESTAMP_REQUIRED',
        message: 'Smoke evidence requires a valid checkedAt timestamp.',
      });
    }
    if (smoke.result !== 'passed') {
      issues.push({
        code: 'SMOKE_NOT_PASSED',
        message: 'Smoke evidence result must be "passed".',
      });
    }
    const checks = smoke.checks && typeof smoke.checks === 'object'
      ? Object.values(smoke.checks)
      : [];
    if (!checks.length || checks.some((value) => value !== true)) {
      issues.push({
        code: 'SMOKE_CHECKS_INCOMPLETE',
        message: 'Smoke evidence checks must be non-empty and every check must be true.',
      });
    }
  }
  return {
    ok: issues.length === 0,
    issues,
    evidence: smoke ? {
      hash: text ? sha256Text(text) : null,
      checkedAt: smoke.checkedAt || null,
      result: smoke.result || null,
      checks: smoke.checks || null,
    } : null,
  };
}

function databaseConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'leader_online',
    charset: 'utf8mb4_unicode_ci',
    dateStrings: true,
  };
}

async function assertSchema(connection) {
  const [versions] = await connection.query(
    `SELECT version
       FROM course_schema_versions
      WHERE version = '049_course_count_card_normalization'
      LIMIT 1`
  );
  if (!versions.length) {
    const error = new Error('Migration 049_course_count_card_normalization is not installed.');
    error.code = 'COURSE_V2_SCHEMA_REQUIRED';
    throw error;
  }
  const [states] = await connection.query(
    `SELECT id, schema_version, state, maintenance_mode, active_import_run_id,
            legacy_write_frozen_at, enabled_at, smoke_evidence_hash,
            smoke_checked_at, maintenance_released_at, row_version
       FROM course_v2_cutover_state
      WHERE id = 1
      LIMIT 1
      FOR UPDATE`
  );
  if (!states.length) {
    const error = new Error('course_v2_cutover_state singleton is missing.');
    error.code = 'COURSE_V2_CUTOVER_STATE_REQUIRED';
    throw error;
  }
  return states[0];
}

async function upsertRun(connection, {
  snapshot,
  snapshotHash,
  validation,
  evidence,
  mode,
}) {
  const summary = {
    source: snapshot.source,
    generatedAt: snapshot.generatedAt,
    datasets: Object.fromEntries(
      Object.entries(validation.datasets).map(([name, rows]) => [name, rows.length])
    ),
    reconciliation: validation.reconciliation,
    evidence,
  };
  const runKey = crypto.randomUUID();
  await connection.query(
    `INSERT INTO course_import_runs
       (run_key, source_system, mode, status, source_contract_version,
        snapshot_hash, summary_json)
     VALUES (?, 'gas', ?, 'validating', ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       summary_json = VALUES(summary_json)`,
    [runKey, mode, snapshot.contractVersion, snapshotHash, JSON.stringify(summary)]
  );
  const [rows] = await connection.query(
    `SELECT id, run_key, status
       FROM course_import_runs
      WHERE snapshot_hash = ? AND mode = ?
      LIMIT 1
      FOR UPDATE`,
    [snapshotHash, mode]
  );
  return rows[0];
}

async function stageSnapshot(connection, runId, snapshot, validation) {
  for (const [datasetName, rows] of Object.entries(validation.datasets)) {
    await connection.query(
      `INSERT INTO course_import_snapshots
         (run_id, dataset_name, row_count, content_hash, source_metadata_json)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         row_count = VALUES(row_count),
         content_hash = VALUES(content_hash),
         source_metadata_json = VALUES(source_metadata_json)`,
      [
        runId,
        datasetName,
        rows.length,
        hashValue(rows),
        JSON.stringify(snapshot.metadata || null),
      ]
    );
  }

  for (const row of buildStagingRows(validation)) {
    await connection.query(
      `INSERT INTO course_import_staging_rows
         (run_id, dataset_name, source_id, source_code, row_hash,
          payload_json, validation_status, validation_errors_json)
       VALUES (?, ?, ?, ?, ?, ?, 'valid', NULL)
       ON DUPLICATE KEY UPDATE
         source_code = VALUES(source_code),
         row_hash = VALUES(row_hash),
         payload_json = VALUES(payload_json),
         validation_status = VALUES(validation_status),
         validation_errors_json = VALUES(validation_errors_json)`,
      [
        runId,
        row.datasetName,
        row.sourceId,
        row.sourceCode,
        row.rowHash,
        JSON.stringify(row.payload),
      ]
    );
  }
}

function sameCourseDate(left, right) {
  return String(left || '').trim().replace('T', ' ').replace(/Z$/, '')
    === String(right || '').trim().replace('T', ' ').replace(/Z$/, '');
}

async function collectLiveReconciliation(connection, validation, runId) {
  const conflicts = [];
  const metrics = [];
  let matchedTicketCount = 0;
  let matchedSessionCount = 0;
  const studentEmails = new Map(
    (validation.datasets.students || []).map((student) => [
      String(student.sourceId || '').trim().toLowerCase(),
      String(student.email || '').trim().toLowerCase(),
    ])
  );

  for (const ticket of validation.datasets.tickets || []) {
    const [rows] = await connection.query(
      `SELECT id, code, owner_email, remaining_uses_cache, status
         FROM course_tickets
        WHERE code = ?
        LIMIT 2`,
      [ticket.code]
    );
    if (!rows.length) continue;
    const live = rows[0];
    const sourceOwnerEmail = String(
      ticket.ownerEmail
      || studentEmails.get(String(ticket.studentSourceId || '').trim().toLowerCase())
      || ''
    ).trim().toLowerCase();
    const mismatch = (
      String(live.owner_email || '').trim().toLowerCase()
        !== sourceOwnerEmail
      || Number(live.remaining_uses_cache) !== Number(ticket.remainingUses)
      || String(live.status || '').toLowerCase() !== String(ticket.status || '').toLowerCase()
    );
    if (mismatch) {
      conflicts.push({
        datasetName: 'tickets',
        sourceId: ticket.sourceId,
        conflictType: 'TICKET_CODE_MISMATCH',
        message: `Ticket ${ticket.code} has a different holder, balance or status in MySQL.`,
        sourceValue: {
          code: ticket.code,
          ownerEmail: sourceOwnerEmail || null,
          remainingUses: ticket.remainingUses,
          status: ticket.status,
        },
        targetValue: live,
      });
    } else {
      matchedTicketCount += 1;
    }
  }

  for (const session of validation.datasets.sessions || []) {
    const [rows] = await connection.query(
      `SELECT id, code, starts_at, ends_at, status
         FROM course_sessions
        WHERE code = ?
        LIMIT 2`,
      [session.code]
    );
    if (!rows.length) continue;
    const live = rows[0];
    const mismatch = (
      !sameCourseDate(live.starts_at, session.startsAt)
      || !sameCourseDate(live.ends_at, session.endsAt)
      || String(live.status || '').toLowerCase() !== String(session.status || '').toLowerCase()
    );
    if (mismatch) {
      conflicts.push({
        datasetName: 'sessions',
        sourceId: session.sourceId,
        conflictType: 'SESSION_CODE_MISMATCH',
        message: `Session ${session.code} has a different time or status in MySQL.`,
        sourceValue: {
          code: session.code,
          startsAt: session.startsAt,
          endsAt: session.endsAt,
          status: session.status,
        },
        targetValue: live,
      });
    } else {
      matchedSessionCount += 1;
    }
  }

  const [[legacyUnheld]] = await connection.query(
    `SELECT COUNT(*) AS total
       FROM course_bookings b
       LEFT JOIN course_ticket_holds h
         ON h.booking_id = b.id
        AND h.status = 'active'
      WHERE b.status = 'booked'
        AND b.ticket_id IS NOT NULL
        AND h.id IS NULL`
  );
  const [[duplicateStudentRsvps]] = await connection.query(
    `SELECT COUNT(*) AS total
       FROM (
         SELECT CONCAT('live:', session_id, ':', student_id) AS conflict_key
           FROM course_bookings
          WHERE student_id IS NOT NULL
          GROUP BY session_id, student_id
         HAVING COUNT(*) > 1
         UNION
         SELECT CONCAT('quarantine-marker:', student_identity_conflict_key) AS conflict_key
           FROM course_bookings
          WHERE student_identity_conflict_key IS NOT NULL
          GROUP BY student_identity_conflict_key
         UNION ALL
         SELECT CONCAT('quarantine:', c.id) AS conflict_key
           FROM course_import_conflicts c
           JOIN course_import_runs r ON r.id = c.run_id
          WHERE r.run_key = '00000000-0000-0000-0049-000000000001'
            AND c.dataset_name = 'bookings'
            AND c.conflict_type = 'DUPLICATE_SESSION_STUDENT'
            AND c.severity = 'blocking'
            AND c.status = 'open'
       ) duplicate_rsvps`
  );
  const [[negativeAvailable]] = await connection.query(
    `SELECT COUNT(*) AS total
       FROM (
         SELECT t.id
           FROM course_tickets t
           LEFT JOIN course_ticket_holds h
             ON h.ticket_id = t.id
            AND h.status = 'active'
          GROUP BY t.id, t.remaining_uses_cache
         HAVING t.remaining_uses_cache - COALESCE(SUM(h.quantity), 0) < 0
       ) invalid_available`
  );
  const [[ledgerMismatch]] = await connection.query(
    `SELECT COUNT(*) AS total
       FROM (
         SELECT t.id
           FROM course_tickets t
           LEFT JOIN course_usage_events e ON e.ticket_id = t.id
          GROUP BY t.id, t.remaining_uses_cache
         HAVING t.remaining_uses_cache <> COALESCE(SUM(e.delta_uses), 0)
       ) invalid_ledger`
  );
  let stagedSourceRows = 0;
  let mappedSourceRows = 0;
  for (const [datasetName, tableName] of Object.entries(MATERIALIZED_TARGET_TABLES)) {
    const [[coverage]] = await connection.query(
      `SELECT COUNT(*) AS staged_count,
              COALESCE(SUM(
                CASE
                  WHEN m.id IS NOT NULL
                   AND m.target_table = ?
                   AND m.source_hash = s.row_hash
                   AND target.id IS NOT NULL
                  THEN 1 ELSE 0
                END
              ), 0) AS mapped_count
         FROM course_import_staging_rows s
         LEFT JOIN course_import_source_mappings m
           ON m.source_system = 'gas'
          AND m.entity_type = s.dataset_name
          AND m.source_id = s.source_id
         LEFT JOIN \`${tableName}\` target
           ON target.id = m.target_id
        WHERE s.run_id = ?
          AND s.dataset_name = ?`,
      [tableName, runId, datasetName]
    );
    stagedSourceRows += Number(coverage.staged_count);
    mappedSourceRows += Number(coverage.mapped_count);
  }

  metrics.push(metric(
    'matched_gas_ticket_codes',
    (validation.datasets.tickets || []).length,
    matchedTicketCount,
    matchedTicketCount === (validation.datasets.tickets || []).length,
    { pending: true }
  ));
  metrics.push(metric(
    'matched_gas_session_codes',
    (validation.datasets.sessions || []).length,
    matchedSessionCount,
    matchedSessionCount === (validation.datasets.sessions || []).length,
    { pending: true }
  ));
  metrics.push(metric(
    'mapped_final_source_rows',
    stagedSourceRows,
    mappedSourceRows,
    mappedSourceRows === stagedSourceRows,
    { pending: true }
  ));
  metrics.push(metric(
    'legacy_unheld_booking_count',
    0,
    Number(legacyUnheld.total),
    Number(legacyUnheld.total) === 0
  ));
  metrics.push(metric(
    'duplicate_session_student_rsvp_count',
    0,
    Number(duplicateStudentRsvps.total),
    Number(duplicateStudentRsvps.total) === 0
  ));
  metrics.push(metric(
    'negative_available_ticket_count',
    0,
    Number(negativeAvailable.total),
    Number(negativeAvailable.total) === 0
  ));
  metrics.push(metric(
    'ledger_cache_mismatch_count',
    0,
    Number(ledgerMismatch.total),
    Number(ledgerMismatch.total) === 0
  ));
  metrics.push(metric(
    'source_over_reserved_ticket_count',
    0,
    Number(validation.reconciliation.overReservedTicketCount),
    Number(validation.reconciliation.overReservedTicketCount) === 0
  ));
  metrics.push(metric(
    'source_ledger_balance_mismatch_count',
    0,
    Number(validation.reconciliation.ledgerBalanceMismatchCount),
    Number(validation.reconciliation.ledgerBalanceMismatchCount) === 0
  ));
  metrics.push(metric(
    'source_negative_running_balance_count',
    0,
    Number(validation.reconciliation.negativeRunningBalanceCount),
    Number(validation.reconciliation.negativeRunningBalanceCount) === 0
  ));

  return { conflicts, metrics };
}

function metric(key, source, target, passed, { pending = false } = {}) {
  return {
    key,
    source,
    target,
    difference: Number(target) - Number(source),
    status: passed ? 'passed' : (pending ? 'pending_import' : 'blocking'),
  };
}

async function persistReconciliation(connection, runId, { conflicts, metrics }) {
  await connection.query(
    `UPDATE course_import_conflicts
        SET status = 'resolved',
            resolution_json = JSON_OBJECT('reason', 'superseded_by_latest_reconciliation'),
            resolved_at = NOW()
      WHERE run_id = ?
        AND status = 'open'`,
    [runId]
  );
  for (const conflict of conflicts) {
    await connection.query(
      `INSERT INTO course_import_conflicts
         (run_id, dataset_name, source_id, conflict_type, severity,
          source_value_json, target_value_json, message, status)
       VALUES (?, ?, ?, ?, 'blocking', ?, ?, ?, 'open')
       ON DUPLICATE KEY UPDATE
         source_value_json = VALUES(source_value_json),
         target_value_json = VALUES(target_value_json),
         message = VALUES(message),
         status = 'open',
         resolution_json = NULL,
         resolved_by_user_id = NULL,
         resolved_at = NULL`,
      [
        runId,
        conflict.datasetName,
        conflict.sourceId || null,
        conflict.conflictType,
        JSON.stringify(conflict.sourceValue || null),
        JSON.stringify(conflict.targetValue || null),
        conflict.message,
      ]
    );
  }
  for (const result of metrics) {
    await connection.query(
      `INSERT INTO course_import_reconciliation_results
         (run_id, metric_key, source_value, target_value, difference_value,
          status, details_json)
       VALUES (?, ?, ?, ?, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE
         source_value = VALUES(source_value),
         target_value = VALUES(target_value),
         difference_value = VALUES(difference_value),
         status = VALUES(status),
         details_json = VALUES(details_json)`,
      [
        runId,
        result.key,
        result.source,
        result.target,
        result.difference,
        result.status,
      ]
    );
  }
}

async function blockingCount(connection, runId) {
  const [[conflicts]] = await connection.query(
    `SELECT COUNT(*) AS total
       FROM course_import_conflicts
      WHERE run_id = ?
        AND severity = 'blocking'
        AND status = 'open'`,
    [runId]
  );
  const [[metrics]] = await connection.query(
    `SELECT COUNT(*) AS total
       FROM course_import_reconciliation_results
      WHERE run_id = ?
        AND status = 'blocking'`,
    [runId]
  );
  return Number(conflicts.total) + Number(metrics.total);
}

async function readinessCount(connection, runId) {
  const [[conflicts]] = await connection.query(
    `SELECT COUNT(*) AS total
       FROM course_import_conflicts
      WHERE run_id = ?
        AND severity = 'blocking'
        AND status = 'open'`,
    [runId]
  );
  const [[metrics]] = await connection.query(
    `SELECT COUNT(*) AS total
       FROM course_import_reconciliation_results
      WHERE run_id = ?
        AND status <> 'passed'`,
    [runId]
  );
  return Number(conflicts.total) + Number(metrics.total);
}

async function applyCutoverTransition(connection, {
  state,
  runId,
  snapshotHash,
  providedHash,
  blockers,
  smokeEvidence = null,
}) {
  if (providedHash !== snapshotHash) {
    const error = new Error('Cutover confirmation hash does not match this snapshot.');
    error.code = 'CUTOVER_HASH_MISMATCH';
    throw error;
  }
  if (blockers > 0) {
    const error = new Error(`Cutover is blocked by ${blockers} unresolved conflicts/metrics.`);
    error.code = 'CUTOVER_BLOCKED';
    throw error;
  }
  if (state === 'frozen') {
    const [result] = await connection.query(
      `UPDATE course_v2_cutover_state
          SET state = 'frozen',
              maintenance_mode = 1,
              active_import_run_id = ?,
              legacy_write_frozen_at = COALESCE(legacy_write_frozen_at, NOW()),
              notes = 'Writes frozen by verified GAS cutover snapshot.',
              row_version = row_version + 1
        WHERE id = 1
          AND state IN ('legacy', 'frozen')
          AND (active_import_run_id IS NULL OR active_import_run_id = ?)`,
      [runId, runId]
    );
    if (result.affectedRows !== 1) {
      const error = new Error('An active cutover cannot be frozen again.');
      error.code = 'CUTOVER_ALREADY_ACTIVE';
      throw error;
    }
    return;
  }

  if (state === 'ready') {
    const [result] = await connection.query(
      `UPDATE course_v2_cutover_state
          SET state = 'ready',
              maintenance_mode = 1,
              active_import_run_id = ?,
              notes = 'Final GAS snapshot materialized and fully reconciled; awaiting activation.',
              row_version = row_version + 1
        WHERE id = 1
          AND state IN ('frozen', 'ready')
          AND maintenance_mode = 1
          AND active_import_run_id = ?
          AND legacy_write_frozen_at IS NOT NULL`,
      [runId, runId]
    );
    if (result.affectedRows !== 1) {
      const error = new Error('The same frozen import run is required before materialization.');
      error.code = 'CUTOVER_FREEZE_REQUIRED';
      throw error;
    }
    return;
  }

  if (state === 'active') {
    const [result] = await connection.query(
      `UPDATE course_v2_cutover_state
          SET state = 'active',
              maintenance_mode = 1,
              active_import_run_id = ?,
              enabled_at = COALESCE(enabled_at, NOW()),
              notes = 'Normalized runtime activated in maintenance mode; smoke evidence is required before release.',
              row_version = row_version + 1
        WHERE id = 1
          AND state = 'ready'
          AND maintenance_mode = 1
          AND active_import_run_id = ?
          AND legacy_write_frozen_at IS NOT NULL`,
      [runId, runId]
    );
    if (result.affectedRows !== 1) {
      const error = new Error('A materialized and reconciled ready run is required before activation.');
      error.code = 'CUTOVER_MATERIALIZATION_REQUIRED';
      throw error;
    }
    return;
  }

  if (state === 'released') {
    if (!smokeEvidence?.hash || !smokeEvidence?.checkedAt) {
      const error = new Error('Verified smoke evidence is required before maintenance release.');
      error.code = 'SMOKE_EVIDENCE_REQUIRED';
      throw error;
    }
    const [result] = await connection.query(
      `UPDATE course_v2_cutover_state
          SET maintenance_mode = 0,
              smoke_evidence_hash = ?,
              smoke_checked_at = ?,
              maintenance_released_at = NOW(),
              notes = 'Normalized runtime released after bound smoke evidence and final reconciliation.',
              row_version = row_version + 1
        WHERE id = 1
          AND state = 'active'
          AND maintenance_mode = 1
          AND active_import_run_id = ?`,
      [
        smokeEvidence.hash,
        mysqlTaipeiDateTime(smokeEvidence.checkedAt),
        runId,
      ]
    );
    if (result.affectedRows !== 1) {
      const error = new Error('The activated import run is not awaiting maintenance release.');
      error.code = 'CUTOVER_ACTIVATION_REQUIRED';
      throw error;
    }
    return;
  }

  const error = new Error(`Unsupported cutover state transition "${state}".`);
  error.code = 'INVALID_CUTOVER_TRANSITION';
  throw error;
}

function mysqlTaipeiDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function assertMaterializeState(cutoverState, runId) {
  if (
    !['frozen', 'ready'].includes(String(cutoverState.state))
    || Number(cutoverState.maintenance_mode) !== 1
    || String(cutoverState.active_import_run_id) !== String(runId)
    || !cutoverState.legacy_write_frozen_at
  ) {
    const error = new Error('Materialization requires this exact import run to be frozen.');
    error.code = 'CUTOVER_FREEZE_REQUIRED';
    throw error;
  }
}

function assertSmokeAfterActivation(cutoverState, smokeEvidence) {
  const enabledAt = Date.parse(
    `${String(cutoverState.enabled_at || '').replace(' ', 'T')}+08:00`
  );
  const checkedAt = Date.parse(smokeEvidence?.checkedAt || '');
  if (!Number.isFinite(enabledAt) || !Number.isFinite(checkedAt) || checkedAt < enabledAt) {
    const error = new Error('Smoke evidence must be recorded after the normalized runtime was activated.');
    error.code = 'SMOKE_BEFORE_ACTIVATION';
    throw error;
  }
}

async function stageAndReconcile({
  snapshot,
  validation,
  dryReport,
  args,
  evidence,
  smokeEvidence,
}) {
  const connection = await mysql.createConnection(databaseConfig());
  try {
    await connection.beginTransaction();
    const cutoverState = await assertSchema(connection);
    const run = await upsertRun(connection, {
      snapshot,
      snapshotHash: dryReport.snapshotHash,
      validation,
      evidence,
      mode: args.mode,
    });
    await stageSnapshot(connection, run.id, snapshot, validation);
    let reconciliation = await collectLiveReconciliation(connection, validation, run.id);
    await persistReconciliation(connection, run.id, reconciliation);
    let blockers = await blockingCount(connection, run.id);
    let readiness = await readinessCount(connection, run.id);
    let materialized = null;
    let status = blockers > 0
      ? 'blocked'
      : (readiness > 0 ? 'staged' : 'reconciled');
    let cutoverAction = null;

    if (args.freezeHash) {
      await applyCutoverTransition(connection, {
        state: 'frozen',
        runId: run.id,
        snapshotHash: dryReport.snapshotHash,
        providedHash: args.freezeHash,
        blockers,
      });
      status = 'frozen';
      cutoverAction = 'frozen';
    }
    if (args.materializeHash) {
      if (args.materializeHash !== dryReport.snapshotHash) {
        const error = new Error('Cutover confirmation hash does not match this snapshot.');
        error.code = 'CUTOVER_HASH_MISMATCH';
        throw error;
      }
      if (blockers > 0) {
        const error = new Error(`Materialization is blocked by ${blockers} safety conflicts.`);
        error.code = 'CUTOVER_BLOCKED';
        throw error;
      }
      assertMaterializeState(cutoverState, run.id);
      materialized = await materializeSnapshot(connection, {
        snapshot,
        validation,
        runId: run.id,
        snapshotHash: dryReport.snapshotHash,
      });
      reconciliation = await collectLiveReconciliation(connection, validation, run.id);
      await persistReconciliation(connection, run.id, reconciliation);
      blockers = await blockingCount(connection, run.id);
      readiness = await readinessCount(connection, run.id);
      await applyCutoverTransition(connection, {
        state: 'ready',
        runId: run.id,
        snapshotHash: dryReport.snapshotHash,
        providedHash: args.materializeHash,
        blockers: readiness,
      });
      status = 'materialized';
      cutoverAction = 'ready';
    } else if (args.activateHash) {
      await applyCutoverTransition(connection, {
        state: 'active',
        runId: run.id,
        snapshotHash: dryReport.snapshotHash,
        providedHash: args.activateHash,
        blockers: readiness,
      });
      status = 'activated';
      cutoverAction = 'active_maintenance';
    } else if (args.releaseHash) {
      assertSmokeAfterActivation(cutoverState, smokeEvidence);
      await applyCutoverTransition(connection, {
        state: 'released',
        runId: run.id,
        snapshotHash: dryReport.snapshotHash,
        providedHash: args.releaseHash,
        blockers: readiness,
        smokeEvidence,
      });
      status = 'completed';
      cutoverAction = 'released';
    }
    await connection.query(
      `UPDATE course_import_runs
          SET status = ?, finished_at = NOW(), error_json = ?
        WHERE id = ?`,
      [
        status,
        blockers > 0 || readiness > 0
          ? JSON.stringify({ blockers, readiness })
          : null,
        run.id,
      ]
    );
    await connection.commit();
    return {
      ...dryReport,
      staged: true,
      runId: run.id,
      runKey: run.run_key,
      blockers,
      readiness,
      materialized,
      reconciliation: {
        ...dryReport.reconciliation,
        live: reconciliation.metrics,
      },
      conflicts: reconciliation.conflicts,
      cutoverAction,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (args.contract) {
    process.stdout.write(`${JSON.stringify(publicContract(), null, 2)}\n`);
    return 0;
  }
  if (!args.input) {
    const error = new Error('--input is required.');
    error.code = 'INPUT_REQUIRED';
    throw error;
  }

  const inputText = readUtf8(args.input, 'snapshot');
  const format = args.format || (
    path.extname(args.input).toLowerCase() === '.csv' ? 'csv' : 'json'
  );
  const snapshot = parseSnapshotText(inputText, {
    format,
    dataset: args.dataset,
  });
  const validation = validateSnapshot(snapshot);
  const report = buildDryRunReport(snapshot, validation);
  const evidence = validateFinalEvidence(snapshot, args);
  const smoke = args.releaseHash
    ? validateSmokeEvidence(report.snapshotHash, args.smokeEvidence)
    : { ok: true, issues: [], evidence: null };
  report.sourceEvidence = evidence;
  if (args.releaseHash) report.smokeEvidence = smoke;

  if (!validation.ok) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 2;
  }
  if (args.mode === 'cutover' && !evidence.ok) {
    report.ok = false;
    report.blockingErrors = [
      ...report.blockingErrors,
      ...evidence.issues.map((issue) => ({ severity: 'blocking', ...issue })),
    ];
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 2;
  }
  if (!smoke.ok) {
    report.ok = false;
    report.blockingErrors = [
      ...report.blockingErrors,
      ...smoke.issues.map((issue) => ({ severity: 'blocking', ...issue })),
    ];
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 2;
  }
  if (!args.applyStaging) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  const staged = await stageAndReconcile({
    snapshot,
    validation,
    dryReport: report,
    args,
    evidence: evidence.evidence,
    smokeEvidence: smoke.evidence,
  });
  process.stdout.write(`${JSON.stringify(staged, null, 2)}\n`);
  return staged.blockers > 0 ? 3 : 0;
}

if (require.main === module) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`${JSON.stringify({
        ok: false,
        code: error.code || 'COURSE_GAS_IMPORT_FAILED',
        message: error.message,
      }, null, 2)}\n`);
      process.exitCode = 1;
    }
  );
}

module.exports = {
  REQUIRED_FINAL_DATASETS,
  REQUIRED_NONEMPTY_FINAL_DATASETS,
  MATERIALIZED_TARGET_TABLES,
  applyCutoverTransition,
  collectLiveReconciliation,
  main,
  mysqlTaipeiDateTime,
  parseArgs,
  validateFinalEvidence,
  validateSmokeEvidence,
};
