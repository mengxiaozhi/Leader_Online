const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const modularReservations = fs.readFileSync(path.join(root, 'src/routes/reservations.js'), 'utf8');
const modularOrders = fs.readFileSync(path.join(root, 'src/routes/orders.js'), 'utf8');
const modularContext = fs.readFileSync(path.join(root, 'src/context.js'), 'utf8');
const modularAccount = fs.readFileSync(path.join(root, 'src/routes/account.js'), 'utf8');
const legacyRuntime = fs.readFileSync(path.join(root, 'v1/index.js'), 'utf8');

test('main and v1 expose the owner-scoped reservation Google Wallet endpoint', () => {
  for (const source of [modularReservations, legacyRuntime]) {
    assert.match(source, /post\(['"]\/reservations\/:id\/google-wallet['"]/i);
    assert.match(source, /holderUserId:\s*req\.user\.id/);
    assert.match(source, /createReservationGoogleWalletSaveResult/);
  }
});

test('main and v1 share multipart parsing and enforce current-stage checklist mutations', () => {
  for (const source of [modularReservations, legacyRuntime]) {
    assert.match(source, /checklistPhotoUploadMiddleware/);
    assert.match(source, /parseChecklistPhotoRequest/);
    assert.ok((source.match(/CHECKLIST_STAGE_MISMATCH/g) || []).length >= 3);
    assert.match(source, /isChecklistPhotoLimitReached\(countRow\?\.cnt,\s*CHECKLIST_PHOTO_LIMIT\)/);
    assert.match(source, /SELECT \* FROM reservations WHERE id = \? LIMIT 1 FOR UPDATE/);
    assert.ok((source.match(/enqueueReservationWalletForCommit\(conn,\s*reservationId\)/g) || []).length >= 3);
  }
});

test('main and v1 return the same canonical photo policy and retain 12 MiB legacy JSON support', () => {
  for (const source of [modularOrders, legacyRuntime]) {
    assert.match(source, /photoPolicy:\s*\{/);
    assert.match(source, /maxCount:\s*CHECKLIST_PHOTO_LIMIT/);
    assert.match(source, /maxBytes:\s*MAX_CHECKLIST_IMAGE_BYTES/);
    assert.match(source, /allowedMimeTypes:/);
  }
  assert.match(modularContext, /express\.json\(\{\s*limit:\s*['"]12mb['"]/);
  assert.match(legacyRuntime, /express\.json\(\{\s*limit:\s*['"]12mb['"]/);
});

test('wallet sync hooks cover checklist, status, scan, transfer and deletion flows', () => {
  assert.ok((modularReservations.match(/flushReservationWalletBestEffort/g) || []).length >= 5);
  assert.ok((legacyRuntime.match(/flushReservationWalletBestEffort/g) || []).length >= 5);
  for (const source of [modularReservations, modularContext, legacyRuntime]) {
    assert.match(source, /rotateReservationVerificationCodes/);
    assert.match(source, /inactivateReservationGoogleWalletForHolder/);
    assert.match(source, /queryable:\s*conn/);
  }
  assert.match(modularOrders, /reservation deletion inactivation enqueue failed/);
  assert.match(legacyRuntime, /reservation deletion inactivation enqueue failed/);
  assert.match(modularAccount, /merged reservation sync failed/);
  assert.match(modularAccount, /reservationWalletObjectIds/);
});

test('cancellation and scan invalidate old reservation QR codes transactionally', () => {
  assert.match(
    modularOrders,
    /reservationsToInactivate[\s\S]*rotateReservationVerificationCodes\(conn,\s*reservation,[\s\S]*enqueueInactiveReservationPassesBestEffort/
  );
  assert.match(
    legacyRuntime,
    /reservationsToInactivate[\s\S]*rotateReservationVerificationCodes\(conn,\s*reservation,[\s\S]*inactivateReservationGoogleWalletForHolder/
  );
  for (const source of [modularReservations, legacyRuntime]) {
    assert.match(source, /reservationOrderIsCancelled\(r\)/);
    assert.match(source, /SELECT details FROM orders WHERE id = \? LIMIT 1 FOR UPDATE/);
    assert.match(source, /normalizeStage\(locked\.status\) !== stage/);
    assert.match(source, /enqueueReservationWalletForCommit\(progressConn,\s*r\.id\)/);
  }
});

test('photo deletion persists a durable cleanup job before removing its DB pointer', () => {
  for (const source of [modularReservations, legacyRuntime]) {
    assert.match(
      source,
      /SELECT id, storage_path FROM reservation_checklist_photos[\s\S]*LIMIT 1 FOR UPDATE/
    );
    assert.match(
      source,
      /enqueueStorageFileCleanup\(conn,\s*storage,\s*storagePathForDeletion\)/
    );
    assert.match(source, /flushStorageFileCleanupBestEffort\(storagePathForDeletion\)/);
    assert.doesNotMatch(source, /storage\.deleteFile\(storagePathForDeletion\)\.catch/);
  }
});

test('account deletion locks orders before reservations and queues private photo cleanup', () => {
  for (const source of [modularAccount, legacyRuntime]) {
    const deleteRoute = source.slice(
      source.indexOf('// Admin: delete user (and cleanup all associations)')
    );
    const orderLock = deleteRoute.indexOf('SELECT o.id');
    const reservationLock = deleteRoute.indexOf(
      'SELECT * FROM reservations WHERE user_id = ? FOR UPDATE'
    );
    assert.ok(orderLock >= 0 && reservationLock > orderLock);
    assert.match(
      deleteRoute,
      /enqueueStorageFileCleanup\(conn,\s*storage,\s*row\.storage_path\)/
    );
    assert.match(
      deleteRoute,
      /processStorageFileCleanupJobs\(\{[\s\S]*storagePath:\s*relPath,[\s\S]*limit:\s*1/
    );
    assert.match(deleteRoute, /await detectChecklistPhotoStorageSupport\(\)/);
    assert.doesNotMatch(
      deleteRoute.slice(0, deleteRoute.indexOf('await ensureCourseTransferLifecycleSchema')),
      /detectChecklistPhotoStorageSupport\(\)\.catch/
    );
  }
  assert.match(
    modularAccount,
    /operationalCleanup\.productCoverPaths = await enqueueStoragePathsForCleanup/
  );
  assert.doesNotMatch(
    modularAccount.slice(
      modularAccount.indexOf('// Admin: delete user (and cleanup all associations)')
    ),
    /storage\.deleteFile\(relPath\)\.catch/
  );
  assert.match(
    modularContext,
    /ER_NO_SUCH_TABLE[\s\S]*checklistPhotosHaveStoragePath = false[\s\S]*throw err/
  );
  assert.match(
    legacyRuntime,
    /ER_NO_SUCH_TABLE[\s\S]*checklistPhotosHaveStoragePath = false[\s\S]*throw err/
  );
});

test('account merge locks related orders before rotating reservation holders', () => {
  const mergeStart = modularAccount.indexOf('async function mergeUserAccounts');
  const mergeEnd = modularAccount.indexOf('async function cleanupAccountLinkedOperationalData');
  const mergeSource = modularAccount.slice(mergeStart, mergeEnd);
  const orderLock = mergeSource.indexOf('SELECT o.id');
  const reservationLock = mergeSource.indexOf(
    'SELECT * FROM reservations WHERE user_id = ? FOR UPDATE'
  );

  assert.ok(orderLock >= 0 && reservationLock > orderLock);
  assert.match(mergeSource, /o\.user_id IN \(\?, \?\)/);
  assert.match(mergeSource, /ORDER BY o\.id[\s\S]*FOR UPDATE/);
});
