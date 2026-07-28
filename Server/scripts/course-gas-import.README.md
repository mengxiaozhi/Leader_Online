# Course GAS one-time cutover

`course-gas-import.js` validates, stages, materializes, reconciles and activates the
normalized course count-card model. It never reads Student/Staff PINs and rejects
unknown fields, duplicate source identities, cross-tenant references and
unreconciled balances.

RSVP identity is one row per Session and Student, including students not yet
linked to a Leader account. ShopProduct `requireAddonForNew` is separate from
returning qualification: it requires explicit `requiredAddonCodes` and
`qualifyingTicketProductCodes`, so non-qualifying buyers receive the configured
add-on while qualifying returning buyers may be exempted by the runtime.

The CLI can freeze only Leader/MySQL writes. An operator must first make the GAS
course source read-only, record `gasWritesFrozenAt` and
`finalReadOnlyRevision`, then export the final snapshot. Do not treat
`--freeze-writes` as proof that Google Apps Script was disabled.

Run `node scripts/course-gas-import.js --contract` to produce the exact reviewed
field contract. Rehearsals use dry-run or `--apply-staging`; they never mutate
live course domain rows.

Final cutover uses the same complete snapshot and its printed SHA-256 for four
separate commands:

1. `--freeze-writes <snapshotHash>` enables Leader maintenance mode.
2. `--materialize <snapshotHash>` imports every staged dataset, writes source
   mappings and rolls the transaction back unless all mapping, ledger and hold
   checks pass.
3. `--activate <snapshotHash>` sets the normalized runtime active but deliberately
   leaves maintenance mode enabled.
4. `--release-maintenance <snapshotHash> --smoke-evidence smoke.json` releases
   maintenance only after a post-activation, hash-bound smoke result and a fresh
   zero-conflict reconciliation.

Every cutover command also requires the reviewed `Installer.gs`, its SHA-256,
the source contract and a backup manifest. Snapshot metadata must include
`sheetId`, `sheetRevision`, `finalReadOnlyRevision`, `gasWritesFrozenAt`,
`gasSnapshotHash` and `mysqlBackupId`.

The backup manifest contract is:

```json
{
  "mysqlBackupId": "backup-id",
  "mysqlBackupCreatedAt": "2026-07-28T11:50:00+08:00",
  "gasBackupId": "drive-or-export-id",
  "gasSnapshotHash": "64-character-sha256",
  "sourceMappingBackupId": "mapping-backup-id",
  "createdAt": "2026-07-28T11:58:00+08:00",
  "finalSnapshotHash": "printed-final-snapshot-sha256"
}
```

The smoke evidence contract is:

```json
{
  "snapshotHash": "printed-final-snapshot-sha256",
  "checkedAt": "2026-07-28T13:00:00+08:00",
  "result": "passed",
  "checks": {
    "databaseInvariants": true,
    "authenticatedCourseRead": true
  }
}
```

The operator chooses the concrete smoke checks, but the file must be created
after activation, every recorded check must pass, and its content hash is stored
with the cutover state.
