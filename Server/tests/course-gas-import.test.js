'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  CONTRACT_VERSION,
  buildDryRunReport,
  buildStagingRows,
  parseCsv,
  parseSnapshotText,
  publicContract,
  validateSnapshot,
} = require('../scripts/course-gas-import-lib');
const {
  REQUIRED_FINAL_DATASETS,
  REQUIRED_NONEMPTY_FINAL_DATASETS,
  applyCutoverTransition,
  parseArgs,
  validateFinalEvidence,
  validateSmokeEvidence,
} = require('../scripts/course-gas-import');
const {
  mysqlDateTime,
} = require('../scripts/course-gas-import-materialize');

function snapshot(datasets, metadata = null) {
  return {
    contractVersion: CONTRACT_VERSION,
    source: 'gas',
    generatedAt: '2026-07-28T12:00:00+08:00',
    metadata,
    datasets,
  };
}

test('CSV parser round-trips CRLF, UTF-8, quoted comma and escaped quote once', () => {
  const rows = parseCsv(
    '\uFEFFsourceId,code,name,description\r\n'
    + 'tp-1,COUNT-10,"十堂, 計次卡","教練說 ""開始"""\r\n'
  );
  assert.deepEqual(rows, [{
    sourceId: 'tp-1',
    code: 'COUNT-10',
    name: '十堂, 計次卡',
    description: '教練說 "開始"',
  }]);
});

test('CSV and JSON arrays require an explicit dataset contract', () => {
  assert.throws(
    () => parseSnapshotText('sourceId,email,displayName\n1,a@example.com,A\n', {
      format: 'csv',
    }),
    (error) => error.code === 'DATASET_REQUIRED'
  );
  assert.throws(
    () => parseSnapshotText('[]', { format: 'json' }),
    (error) => error.code === 'DATASET_REQUIRED'
  );
});

test('unknown Student/Staff PIN or password fields are blocking', () => {
  const result = validateSnapshot(snapshot({
    students: [{
      sourceId: 'student-1',
      email: 'member@example.com',
      displayName: '學員',
      pin: '1234',
    }],
    staff: [{
      sourceId: 'staff-1',
      email: 'ops@example.com',
      role: 'ops',
      password: 'must-not-import',
    }],
  }));
  assert.equal(result.ok, false);
  assert.equal(
    result.errors.filter((error) => error.code === 'UNKNOWN_FIELDS').length,
    2
  );
  assert.ok(result.errors.some((error) => error.fields.includes('pin')));
  assert.ok(result.errors.some((error) => error.fields.includes('password')));
});

test('duplicate source IDs and codes block instead of guessing a winner', () => {
  const result = validateSnapshot(snapshot({
    ticketProducts: [
      { sourceId: 'tp-1', code: 'PASS', name: 'A', classCount: 1 },
      { sourceId: 'tp-1', code: 'pass', name: 'B', classCount: 2 },
    ],
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'DUPLICATE_SOURCE_ID'));
  assert.ok(result.errors.some((error) => error.code === 'DUPLICATE_CODE'));
});

test('semantic validation blocks illegal statuses, inverted sessions and delta directions', () => {
  const result = validateSnapshot(snapshot({
    students: [
      { sourceId: 'student-1', email: 'member@example.com', displayName: '學員' },
    ],
    ticketProducts: [
      { sourceId: 'tp-1', code: 'PASS', name: '票', classCount: 10 },
    ],
    scenarios: [{
      sourceId: 'scenario-1',
      code: 'YOGA',
      name: '瑜珈',
      allowedProductCodes: ['PASS'],
    }],
    sessions: [{
      sourceId: 'session-1',
      code: 'SESSION',
      title: '課程',
      scenarioCode: 'YOGA',
      startsAt: '2026-07-30 11:00:00',
      endsAt: '2026-07-30 09:00:00',
      status: 'mystery',
    }],
    tickets: [{
      sourceId: 'ticket-1',
      code: 'TICKET',
      studentSourceId: 'student-1',
      ticketProductCode: 'PASS',
      totalUses: 10,
      remainingUses: 9,
      status: 'active',
      issuedAt: '2026-07-01 09:00:00',
    }],
    redeemLogs: [{
      sourceId: 'redeem-1',
      ticketCode: 'TICKET',
      eventType: 'SUCCESS',
      deltaUses: 1,
      occurredAt: '2026-07-30 09:00:00',
    }],
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'INVALID_STATUS'));
  assert.ok(result.errors.some((error) => error.code === 'INVALID_SESSION_INTERVAL'));
  assert.ok(result.errors.some((error) => error.code === 'INVALID_USAGE_DELTA_DIRECTION'));
});

test('no-ticket NO_SHOW is accepted only as a zero-use audit event', () => {
  const accepted = validateSnapshot(snapshot({
    redeemLogs: [{
      sourceId: 'no-show-1',
      eventType: 'NO_SHOW',
      deltaUses: 0,
      occurredAt: '2026-07-30 09:00:00',
    }],
  }));
  assert.equal(accepted.ok, true);

  const rejected = validateSnapshot(snapshot({
    redeemLogs: [{
      sourceId: 'no-show-2',
      eventType: 'NO_SHOW',
      deltaUses: -1,
      occurredAt: '2026-07-30 09:00:00',
    }],
  }));
  assert.equal(rejected.ok, false);
  assert.ok(rejected.errors.some(
    (error) => error.code === 'INVALID_USAGE_DELTA_DIRECTION'
      || error.code === 'NO_TICKET_NONZERO_DELTA'
  ));
});

test('AUTO_NO_SHOW defaults to false when omitted', () => {
  const result = validateSnapshot(snapshot({
    settings: [{ sourceId: 'settings-platform', scopeKey: 'platform' }],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.datasets.settings[0].autoNoShow, false);
});

test('source reconciliation blocks over-reserved ticket holds', () => {
  const result = validateSnapshot(snapshot({
    students: [
      { sourceId: 'student-1', email: 'member@example.com', displayName: '學員' },
    ],
    ticketProducts: [
      { sourceId: 'tp-1', code: 'PASS', name: '票', classCount: 1 },
    ],
    scenarios: [{
      sourceId: 'scenario-1',
      code: 'SCENARIO',
      name: '情境',
      allowedProductCodes: ['PASS'],
    }],
    sessions: [
      {
        sourceId: 'session-1',
        code: 'S1',
        title: 'A',
        scenarioCode: 'SCENARIO',
        startsAt: '2026-07-30 09:00:00',
        endsAt: '2026-07-30 10:00:00',
        status: 'open',
      },
      {
        sourceId: 'session-2',
        code: 'S2',
        title: 'B',
        scenarioCode: 'SCENARIO',
        startsAt: '2026-07-31 09:00:00',
        endsAt: '2026-07-31 10:00:00',
        status: 'open',
      },
    ],
    tickets: [{
      sourceId: 'ticket-1',
      code: 'TICKET',
      studentSourceId: 'student-1',
      ticketProductCode: 'PASS',
      totalUses: 1,
      remainingUses: 1,
      status: 'active',
      issuedAt: '2026-07-01 09:00:00',
    }],
    rsvps: [
      {
        sourceId: 'rsvp-1',
        sessionCode: 'S1',
        studentSourceId: 'student-1',
        ticketCode: 'TICKET',
        status: 'booked',
        bookedAt: '2026-07-01 09:00:00',
      },
      {
        sourceId: 'rsvp-2',
        sessionCode: 'S2',
        studentSourceId: 'student-1',
        ticketCode: 'TICKET',
        status: 'booked',
        bookedAt: '2026-07-01 09:01:00',
      },
    ],
  }));
  assert.equal(result.reconciliation.overReservedTicketCount, 1);
  assert.ok(result.errors.some((error) => error.code === 'OVER_RESERVED_TICKET'));
});

test('same-session duplicate GAS Student RSVPs are blocking regardless of status', () => {
  const result = validateSnapshot(snapshot({
    students: [
      { sourceId: 'student-1', email: 'member@example.com', displayName: '學員' },
    ],
    ticketProducts: [
      { sourceId: 'tp-1', code: 'PASS', name: '票', classCount: 1 },
    ],
    scenarios: [{
      sourceId: 'scenario-1',
      code: 'SCENARIO',
      name: '情境',
      allowedProductCodes: ['PASS'],
    }],
    sessions: [{
      sourceId: 'session-1',
      code: 'S1',
      title: 'A',
      scenarioCode: 'SCENARIO',
      startsAt: '2026-07-30 09:00:00',
      endsAt: '2026-07-30 10:00:00',
      status: 'open',
    }],
    rsvps: [
      {
        sourceId: 'rsvp-1',
        sessionCode: 'S1',
        studentSourceId: 'student-1',
        status: 'cancelled',
        bookedAt: '2026-07-01 09:00:00',
      },
      {
        sourceId: 'rsvp-2',
        sessionCode: 'S1',
        studentSourceId: 'student-1',
        status: 'booked',
        bookedAt: '2026-07-02 09:00:00',
      },
    ],
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(
    (error) => error.code === 'DUPLICATE_SESSION_STUDENT_RSVP'
  ));
});

test('dry-run report is deterministic and does not need GAS or MySQL credentials', () => {
  const parsed = parseSnapshotText(JSON.stringify(snapshot({
    students: [{
      sourceId: 'student-1',
      email: 'member@example.com',
      displayName: '學員',
    }],
  })), { format: 'json' });
  const first = buildDryRunReport(parsed, validateSnapshot(parsed));
  const second = buildDryRunReport(parsed, validateSnapshot(parsed));
  assert.equal(first.snapshotHash, second.snapshotHash);
  assert.equal(first.ok, true);
});

test('cutover arguments require explicit mode and database staging', () => {
  assert.throws(
    () => parseArgs(['--input', 'snapshot.json', '--activate', 'abc']),
    (error) => error.code === 'APPLY_STAGING_REQUIRED'
  );
  assert.throws(
    () => parseArgs([
      '--input',
      'snapshot.json',
      '--apply-staging',
      '--activate',
      'abc',
    ]),
    (error) => error.code === 'CUTOVER_MODE_REQUIRED'
  );
  assert.throws(
    () => parseArgs([
      '--input',
      'snapshot.json',
      '--mode',
      'cutover',
      '--apply-staging',
      '--freeze-writes',
      'a',
      '--materialize',
      'a',
    ]),
    (error) => error.code === 'MULTIPLE_CUTOVER_ACTIONS'
  );
  assert.throws(
    () => parseArgs([
      '--input',
      'snapshot.json',
      '--mode',
      'cutover',
      '--apply-staging',
      '--release-maintenance',
      'a',
    ]),
    (error) => error.code === 'SMOKE_EVIDENCE_REQUIRED'
  );
});

test('final evidence rejects partial or empty snapshots and missing GAS sources', () => {
  const datasets = Object.fromEntries(REQUIRED_FINAL_DATASETS.map((name) => [name, []]));
  const result = validateFinalEvidence(snapshot(datasets), {
    installer: null,
    installerHash: null,
    sourceContract: null,
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'EMPTY_FINAL_DATASET'));
  assert.ok(result.issues.some((issue) => issue.code === 'INSTALLER_EVIDENCE_REQUIRED'));
  assert.ok(result.issues.some((issue) => issue.code === 'SOURCE_CONTRACT_REQUIRED'));
  assert.deepEqual(
    REQUIRED_NONEMPTY_FINAL_DATASETS.filter((name) => datasets[name].length === 0),
    REQUIRED_NONEMPTY_FINAL_DATASETS
  );
});

test('final evidence binds Installer hash, reviewed contract and Sheet revision', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leader-course-gas-test-'));
  const installerPath = path.join(directory, 'Installer.gs');
  const contractPath = path.join(directory, 'contract.json');
  const backupPath = path.join(directory, 'backups.json');
  const installer = 'function installLeaderCourseSchema() { return "v1"; }\n';
  const installerHash = crypto.createHash('sha256').update(installer).digest('hex');
  fs.writeFileSync(installerPath, installer);
  fs.writeFileSync(contractPath, JSON.stringify({
    contractVersion: CONTRACT_VERSION,
    installerHash,
    datasets: publicContract().datasets,
  }));

  const datasets = Object.fromEntries(REQUIRED_FINAL_DATASETS.map((name) => [name, []]));
  for (const name of REQUIRED_NONEMPTY_FINAL_DATASETS) datasets[name] = [{}];
  const gasSnapshotHash = crypto.createHash('sha256').update('gas-sheet-export').digest('hex');
  const finalSnapshot = snapshot(datasets, {
    sheetId: 'sheet-id',
    sheetRevision: 'revision-7',
    finalReadOnlyRevision: 'revision-7',
    gasWritesFrozenAt: '2026-07-28T11:55:00+08:00',
    gasSnapshotHash,
    mysqlBackupId: 'mysql-backup-7',
    installerHash,
  });
  fs.writeFileSync(backupPath, JSON.stringify({
    mysqlBackupId: 'mysql-backup-7',
    mysqlBackupCreatedAt: '2026-07-28T11:50:00+08:00',
    gasBackupId: 'gas-backup-7',
    gasSnapshotHash,
    sourceMappingBackupId: 'mapping-backup-7',
    createdAt: '2026-07-28T11:58:00+08:00',
    finalSnapshotHash: crypto.createHash('sha256')
      .update(JSON.stringify(sortObject(finalSnapshot)))
      .digest('hex'),
  }));
  const result = validateFinalEvidence(finalSnapshot, {
    installer: installerPath,
    installerHash,
    sourceContract: contractPath,
    backupManifest: backupPath,
  });
  assert.equal(result.ok, true);
  assert.equal(result.evidence.installerHash, installerHash);
  assert.ok(result.evidence.backupManifestHash);
});

test('nested OrderItems are staged and mapped independently', () => {
  const validation = validateSnapshot(snapshot({
    students: [{ sourceId: 'student-1', email: 'member@example.com', displayName: '學員' }],
    ticketProducts: [{ sourceId: 'tp-1', code: 'PASS', name: '票', classCount: 1 }],
    shopProducts: [{
      sourceId: 'shop-1',
      code: 'SHOP',
      name: '方案',
      ticketProductCode: 'PASS',
      price: 100,
    }],
    orders: [{
      sourceId: 'order-1',
      code: 'ORDER-1',
      studentSourceId: 'student-1',
      status: 'paid',
      totalAmount: 100,
      buyerName: '學員',
      buyerEmail: 'member@example.com',
      termsAcceptedAt: '2026-07-28 10:00:00',
      createdAt: '2026-07-28 10:00:00',
      items: [{
        sourceId: 'line-1',
        itemType: 'primary',
        itemCode: 'SHOP',
        itemName: '方案',
        shopProductCode: 'SHOP',
        ticketProductCode: 'PASS',
        quantity: 1,
        unitPrice: 100,
        lineTotal: 100,
      }],
    }],
  }));
  assert.equal(validation.ok, true);
  const staged = buildStagingRows(validation);
  assert.ok(staged.some(
    (row) => row.datasetName === 'orderItems' && row.sourceId === 'line-1'
  ));
});

test('new-buyer required add-on is explicit and needs both add-on and returning qualification', () => {
  const valid = validateSnapshot(snapshot({
    ticketProducts: [
      { sourceId: 'tp-main', code: 'MAIN-PASS', name: '主票', classCount: 1 },
      { sourceId: 'tp-addon', code: 'ADDON-PASS', name: '加購票', classCount: 1 },
      { sourceId: 'tp-prior', code: 'PRIOR-PASS', name: '舊票', classCount: 1 },
    ],
    shopProducts: [
      {
        sourceId: 'shop-addon',
        code: 'ADDON',
        name: '加購',
        ticketProductCode: 'ADDON-PASS',
        price: 100,
      },
      {
        sourceId: 'shop-main',
        code: 'MAIN',
        name: '舊生方案',
        ticketProductCode: 'MAIN-PASS',
        price: 200,
        requireAddonForNew: true,
        qualifyingTicketProductCodes: ['PRIOR-PASS'],
        requiredAddonCodes: ['ADDON'],
      },
    ],
  }));
  assert.equal(valid.ok, true);
  assert.equal(valid.datasets.shopProducts[1].requireAddonForNew, true);

  const invalid = validateSnapshot(snapshot({
    ticketProducts: [
      { sourceId: 'tp-main', code: 'MAIN-PASS', name: '主票', classCount: 1 },
    ],
    shopProducts: [{
      sourceId: 'shop-main',
      code: 'MAIN',
      name: '未完整設定方案',
      ticketProductCode: 'MAIN-PASS',
      price: 200,
      requireAddonForNew: true,
    }],
  }));
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some(
    (error) => error.code === 'NEW_BUYER_REQUIRED_ADDON_MISSING'
  ));
  assert.ok(invalid.errors.some(
    (error) => error.code === 'RETURNING_QUALIFICATION_MISSING'
  ));
});

test('same ShopProduct role can issue different TicketProducts but issued lines require tickets', () => {
  const base = {
    students: [{ sourceId: 'student-1', email: 'member@example.com', displayName: '學員' }],
    ticketProducts: [
      { sourceId: 'tp-1', code: 'PASS-A', name: 'A票', classCount: 1 },
      { sourceId: 'tp-2', code: 'PASS-B', name: 'B票', classCount: 1 },
    ],
    shopProducts: [{
      sourceId: 'shop-1',
      code: 'BUNDLE',
      name: '組合',
      ticketProductCode: 'PASS-A',
      ticketComponents: [
        {
          ticketProductCode: 'PASS-A',
          componentRole: 'primary',
          quantity: 1,
          sortOrder: 0,
        },
        {
          ticketProductCode: 'PASS-B',
          componentRole: 'primary',
          quantity: 1,
          sortOrder: 1,
        },
      ],
      price: 200,
    }],
    orders: [{
      sourceId: 'order-1',
      code: 'ORDER-1',
      studentSourceId: 'student-1',
      status: 'paid',
      totalAmount: 200,
      buyerName: '學員',
      buyerEmail: 'member@example.com',
      termsAcceptedAt: '2026-07-28 10:00:00',
      createdAt: '2026-07-28 10:00:00',
      items: [
        {
          sourceId: 'line-a',
          itemType: 'primary',
          itemCode: 'PASS-A',
          itemName: 'A票',
          shopProductCode: 'BUNDLE',
          ticketProductCode: 'PASS-A',
          quantity: 1,
          unitPrice: 100,
          lineTotal: 100,
        },
        {
          sourceId: 'line-b',
          itemType: 'primary',
          itemCode: 'PASS-B',
          itemName: 'B票',
          shopProductCode: 'BUNDLE',
          ticketProductCode: 'PASS-B',
          quantity: 1,
          unitPrice: 100,
          lineTotal: 100,
        },
      ],
    }],
  };
  assert.equal(validateSnapshot(snapshot(base)).ok, true);
  base.orders[0].items[0].issuanceStatus = 'issued';
  const invalid = validateSnapshot(snapshot(base));
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some(
    (error) => error.code === 'ORDER_ITEM_ISSUANCE_WITHOUT_TICKETS'
  ));
});

test('materializer converts instants to Asia/Taipei and writes running balances', () => {
  assert.equal(mysqlDateTime('2026-07-30T01:00:00Z'), '2026-07-30 09:00:00');
  const source = fs.readFileSync(
    path.resolve(__dirname, '..', 'scripts', 'course-gas-import-materialize.js'),
    'utf8'
  );
  assert.match(source, /balance_after/);
  assert.match(source, /null_balances/);
  assert.match(source, /GAS_USAGE_NEGATIVE_RUNNING_BALANCE/);
  assert.match(source, /require_addon_for_new/);
  assert.match(source, /GAS_DUPLICATE_SESSION_STUDENT_RSVP/);
  assert.match(source, /GAS_RSVP_MAPPING_IDENTITY_CONFLICT/);
});

test('maintenance release smoke evidence is hash-bound and all checks must pass', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leader-course-smoke-test-'));
  const smokePath = path.join(directory, 'smoke.json');
  fs.writeFileSync(smokePath, JSON.stringify({
    snapshotHash: 'snapshot-hash',
    checkedAt: '2026-07-28T13:00:00+08:00',
    result: 'passed',
    checks: {
      databaseInvariants: true,
      authenticatedCourseRead: true,
    },
  }));
  assert.equal(validateSmokeEvidence('snapshot-hash', smokePath).ok, true);
  assert.equal(validateSmokeEvidence('another-hash', smokePath).ok, false);
});

test('activation keeps maintenance enabled and release stores smoke evidence separately', async () => {
  const calls = [];
  const connection = {
    async query(sql, values) {
      calls.push({ sql, values });
      return [{ affectedRows: 1 }];
    },
  };
  await applyCutoverTransition(connection, {
    state: 'active',
    runId: 7,
    snapshotHash: 'hash',
    providedHash: 'hash',
    blockers: 0,
  });
  assert.match(calls[0].sql, /maintenance_mode = 1/);
  assert.doesNotMatch(calls[0].sql, /maintenance_mode = 0/);

  await applyCutoverTransition(connection, {
    state: 'released',
    runId: 7,
    snapshotHash: 'hash',
    providedHash: 'hash',
    blockers: 0,
    smokeEvidence: {
      hash: 'a'.repeat(64),
      checkedAt: '2026-07-28T13:00:00+08:00',
    },
  });
  assert.match(calls[1].sql, /maintenance_mode = 0/);
  assert.match(calls[1].sql, /smoke_evidence_hash/);
});

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = sortObject(value[key]);
    return result;
  }, {});
}
