'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const migrationPath = path.join(
  root,
  'Database',
  'migrations',
  '049_course_count_card_normalization.sql'
);
const indexPath = path.join(root, 'Database', 'index.sql');
const schemaPath = path.join(root, 'Database', 'schema.mysql.sql');
const importScriptPath = path.join(root, 'Server', 'scripts', 'course-gas-import.js');
const migration = fs.readFileSync(migrationPath, 'utf8');
const indexSql = fs.readFileSync(indexPath, 'utf8');
const schemaSql = fs.readFileSync(schemaPath, 'utf8');
const importScript = fs.readFileSync(importScriptPath, 'utf8');

function normalizedFreshBlock(sql) {
  const marker = '-- Course count-card V2 normalized schema (fresh install).';
  const start = sql.indexOf(marker);
  assert.notEqual(start, -1, `missing ${marker}`);
  return sql.slice(start + marker.length).trim()
    .replace(
      "1, '049_course_count_card_normalization', 'active', 0,",
      "1, '049_course_count_card_normalization', 'legacy', 0,"
    )
    .replace(
      'Fresh install starts on the normalized course runtime; imported installations must reconcile before activation.',
      'Set to ready/active only after a zero-conflict GAS reconciliation run.'
    );
}

test('049 declares every normalized course and cutover table', () => {
  const tables = [
    'course_schema_versions',
    'course_students',
    'course_ticket_products',
    'course_shop_product_components',
    'course_product_returning_requirements',
    'course_product_required_addons',
    'course_order_items',
    'course_redeem_scenarios',
    'course_scenario_allowed_products',
    'course_settings',
    'course_staff_memberships',
    'course_coach_profiles',
    'course_ticket_holds',
    'course_attendance_invites',
    'course_usage_events',
    'course_ticket_state_periods',
    'course_mutation_commands',
    'course_import_runs',
    'course_import_snapshots',
    'course_import_staging_rows',
    'course_import_source_mappings',
    'course_import_conflicts',
    'course_import_reconciliation_results',
    'course_v2_cutover_state',
  ];
  for (const table of tables) {
    assert.match(
      migration,
      new RegExp(`CREATE TABLE IF NOT EXISTS \\\`${table}\\\``),
      `missing ${table}`
    );
  }
});

test('ledger immutability, command linkage and single reversal are DB-enforced', () => {
  assert.match(migration, /CREATE TRIGGER `course_usage_events_no_update`/);
  assert.match(migration, /CREATE TRIGGER `course_usage_events_no_delete`/);
  assert.match(
    migration,
    /KEY `idx_course_usage_command` \(`command_id`\)/
  );
  assert.match(
    migration,
    /KEY `idx_course_usage_idempotency` \(`idempotency_key`\)/
  );
  assert.doesNotMatch(migration, /UNIQUE KEY `uq_course_usage_actor_idempotency`/);
  assert.match(
    migration,
    /UNIQUE KEY `uq_course_usage_reversal` \(`reverses_event_id`\)/
  );
  assert.match(migration, /insert a compensating event/);
  assert.match(migration, /fk_course_usage_command/);
  assert.match(migration, /`command_id` BIGINT UNSIGNED DEFAULT NULL/);
  assert.match(migration, /`balance_after` = running\.`running_balance`/);
});

test('immutable ledger foreign keys preserve referenced facts instead of SET NULL', () => {
  for (const constraint of [
    'fk_course_usage_student',
    'fk_course_usage_user',
    'fk_course_usage_booking',
    'fk_course_usage_invite',
    'fk_course_usage_actor',
  ]) {
    const line = migration.split('\n').find(
      (candidate) => candidate.includes(
        `CALL \`course_049_add_foreign_key\`('course_usage_events', '${constraint}'`
      )
    ) || '';
    assert.match(line, /ON DELETE RESTRICT/);
    assert.doesNotMatch(line, /ON DELETE SET NULL/);
  }
  assert.match(migration, /CREATE PROCEDURE `course_049_drop_foreign_key`/);
});

test('order item identity permits multiple TicketProducts in the same ShopProduct role', () => {
  assert.match(migration, /`line_identity_key` VARCHAR\(191\) GENERATED ALWAYS AS/);
  assert.match(
    migration,
    /UNIQUE KEY `uq_course_order_items_line_identity` \(`order_id`, `line_identity_key`\)/
  );
  assert.doesNotMatch(
    migration.slice(
      migration.indexOf('CREATE TABLE IF NOT EXISTS `course_order_items`'),
      migration.indexOf('CREATE TABLE IF NOT EXISTS `course_redeem_scenarios`')
    ),
    /uq_course_order_items_legacy_primary/
  );
});

test('booking identity covers unclaimed Students and keeps legacy user uniqueness', () => {
  assert.match(
    migration,
    /CALL `course_049_add_index`\('course_bookings', 'uq_course_bookings_session_student', 'UNIQUE KEY `uq_course_bookings_session_student` \(`session_id`, `student_id`\)'\)/
  );
  assert.doesNotMatch(
    migration,
    /course_049_drop_index`\('course_bookings', 'uq_course_booking_session_user'/
  );
  for (const sql of [indexSql, schemaSql]) {
    assert.match(
      sql,
      /UNIQUE KEY `uq_course_booking_session_user` \(`session_id`, `user_id`\)/
    );
  }
});

test('legacy duplicate Student bookings are quarantined before uniqueness is enforced', () => {
  const quarantineRun = migration.indexOf(
    "'00000000-0000-0000-0049-000000000001'"
  );
  const conflictInsert = migration.indexOf(
    "'DUPLICATE_SESSION_STUDENT'"
  );
  const quarantineUpdate = migration.indexOf(
    'UPDATE `course_bookings` b',
    conflictInsert
  );
  const uniqueIndex = migration.indexOf(
    "CALL `course_049_add_index`('course_bookings', 'uq_course_bookings_session_student'"
  );

  assert.ok(quarantineRun > migration.indexOf('CREATE TABLE IF NOT EXISTS `course_import_runs`'));
  assert.ok(conflictInsert > quarantineRun);
  assert.ok(quarantineUpdate > conflictInsert);
  assert.ok(uniqueIndex > quarantineUpdate);
  assert.match(
    migration.slice(quarantineUpdate, uniqueIndex),
    /SET b\.`student_identity_conflict_key` = CONCAT\([\s\S]*b\.`student_id` = NULL,[\s\S]*WHERE b\.`id` >= 1;/
  );
  assert.match(migration, /CONCAT\('legacy-booking:', b\.`id`\)/);
  assert.doesNotMatch(migration, /GROUP_CONCAT\(`id`/);
  assert.match(
    migration,
    /UPDATE `course_bookings` b[\s\S]*INDEX_NAME = 'uq_course_bookings_session_student'[\s\S]*?;/
  );
  assert.match(
    importScript,
    /run_key = '00000000-0000-0000-0049-000000000001'[\s\S]*conflict_type = 'DUPLICATE_SESSION_STUDENT'[\s\S]*c\.status = 'open'/
  );
  assert.match(
    importScript,
    /student_identity_conflict_key IS NOT NULL/
  );
});

test('new-buyer add-on policy is independent from legacy returning eligibility', () => {
  assert.match(
    migration,
    /CALL `course_049_add_column`\('course_products', 'require_addon_for_new', 'TINYINT\(1\) NOT NULL DEFAULT 0 AFTER `returning_student_only`'\)/
  );
  assert.match(migration, /'course_products', 'returning_student_only'/);
});

test('active hold uniqueness allows a new compensating hold after release', () => {
  const holdsStart = migration.indexOf('CREATE TABLE IF NOT EXISTS `course_ticket_holds`');
  const holdsEnd = migration.indexOf(
    'CREATE TABLE IF NOT EXISTS `course_attendance_invites`',
    holdsStart
  );
  const holdsCreate = migration.slice(holdsStart, holdsEnd);
  assert.match(holdsCreate, /active_booking_id.*GENERATED ALWAYS AS/s);
  assert.match(holdsCreate, /active_invite_id.*GENERATED ALWAYS AS/s);
  assert.match(holdsCreate, /uq_course_ticket_holds_active_booking/);
  assert.match(holdsCreate, /uq_course_ticket_holds_active_invite/);
  assert.doesNotMatch(holdsCreate, /uq_course_ticket_holds_booking`/);
  assert.doesNotMatch(holdsCreate, /uq_course_ticket_holds_invite`/);
  assert.match(
    migration,
    /CALL `course_049_drop_index`\('course_ticket_holds', 'uq_course_ticket_holds_booking'\)/
  );
  assert.match(
    migration,
    /CALL `course_049_drop_index`\('course_ticket_holds', 'uq_course_ticket_holds_invite'\)/
  );
});

test('foreign keys on generated-column inputs use restrictive actions', () => {
  assert.match(
    migration,
    /fk_course_order_items_shop_product` FOREIGN KEY \(`shop_product_id`\)[^\n]+ON DELETE RESTRICT/
  );
  assert.match(
    migration,
    /fk_course_order_items_ticket_product` FOREIGN KEY \(`ticket_product_id`\)[^\n]+ON DELETE RESTRICT/
  );
  assert.match(
    migration,
    /fk_course_ticket_holds_booking` FOREIGN KEY \(`booking_id`\)[^\n]+ON DELETE RESTRICT/
  );
  assert.match(
    migration,
    /fk_course_ticket_holds_invite', 'FOREIGN KEY \(`invite_id`\)[^\n]+ON DELETE RESTRICT/
  );
  assert.match(
    migration,
    /fk_course_attendance_invites_student` FOREIGN KEY \(`student_id`\)[^\n]+ON DELETE RESTRICT/
  );
  assert.match(
    migration,
    /fk_course_attendance_invites_user` FOREIGN KEY \(`user_id`\)[^\n]+ON DELETE RESTRICT/
  );
});

test('GAS student, no-ticket audit and direct TicketProduct issuance columns are nullable', () => {
  assert.match(
    migration,
    /CALL `course_049_make_nullable`\('course_bookings', 'ticket_id', 'BIGINT UNSIGNED NULL'\)/
  );
  assert.match(
    migration,
    /CALL `course_049_make_nullable`\('course_bookings', 'user_id', 'CHAR\(36\) NULL'\)/
  );
  assert.match(
    migration,
    /CALL `course_049_make_nullable`\('course_tickets', 'user_id', 'CHAR\(36\) NULL'\)/
  );
  assert.match(
    migration,
    /CALL `course_049_make_nullable`\('course_tickets', 'product_id', 'INT UNSIGNED NULL'\)/
  );
  assert.match(
    migration,
    /CALL `course_049_make_nullable`\('course_attendance_logs', 'user_id', 'CHAR\(36\) NULL'\)/
  );
  assert.match(migration, /'course_bookings', 'student_id'/);
  assert.match(migration, /fk_course_bookings_student/);
  assert.match(migration, /`source_id` VARCHAR\(128\) DEFAULT NULL/);
});

test('ticket policy, provider and issue-time product facts are snapshotted', () => {
  for (const column of [
    'product_code_snapshot',
    'product_name_snapshot',
    'product_class_count_snapshot',
    'product_valid_days_snapshot',
    'product_activation_days_snapshot',
    'product_transferable_snapshot',
    'product_max_transfers_snapshot',
    'product_terms_snapshot',
    'product_redemption_policy_snapshot',
    'provider_user_id_snapshot',
    'provider_name_snapshot',
  ]) {
    assert.match(migration, new RegExp(`'course_tickets', '${column}'`));
  }
  assert.match(migration, /tp\.`redemption_policy_json`/);
  assert.match(migration, /provider\.`username`/);
});

test('legacy backfill preserves balances and never creates an uncovered active hold', () => {
  assert.match(migration, /'ISSUANCE', t\.`total_uses`/);
  assert.match(migration, /'SUCCESS', -CAST\(l\.`quantity` AS SIGNED\)/);
  assert.match(migration, /'NO_SHOW', 0, 'legacy_booking_no_show'/);
  assert.match(migration, /'LEGACY_BALANCE_RECONCILIATION'/);
  assert.match(migration, /CAST\(t\.`remaining_uses` AS SIGNED\) -/);
  assert.match(migration, /legacy_unheld_booking/);
  assert.match(migration, /\) <= t\.`remaining_uses`/);
  assert.match(
    migration,
    /FROM `course_tickets` issued_ticket[\s\S]*issued_ticket\.`order_id` = o\.`id`[\s\S]*\) >= o\.`quantity`/
  );
});

test('legacy batch updates remain compatible with SQL_SAFE_UPDATES', () => {
  const updates = migration.match(/^UPDATE `[\s\S]*?;/gm) || [];

  assert.equal(updates.length, 10);
  for (const statement of updates) {
    assert.match(
      statement,
      /WHERE (?:`id`|(?:cs|t|b|o|event_row)\.`id`) >= 1/,
      `missing target primary-key predicate:\n${statement}`
    );
  }
});

test('interrupted migration repairs columns, indexes and foreign keys on rerun', () => {
  assert.match(migration, /CREATE PROCEDURE `course_049_add_column`/);
  assert.match(migration, /CREATE PROCEDURE `course_049_make_nullable`/);
  assert.match(migration, /CREATE PROCEDURE `course_049_drop_index`/);
  assert.match(migration, /CREATE PROCEDURE `course_049_add_index`/);
  assert.match(migration, /CREATE PROCEDURE `course_049_add_foreign_key`/);
  assert.match(migration, /INFORMATION_SCHEMA\.COLUMNS/);
  assert.match(migration, /INFORMATION_SCHEMA\.STATISTICS/);
  assert.match(migration, /INFORMATION_SCHEMA\.REFERENTIAL_CONSTRAINTS/);
  assert.match(migration, /fk_course_ticket_holds_consumed_event/);
  assert.match(migration, /fk_course_attendance_invites_booking/);
  assert.match(migration, /fk_course_attendance_invites_redeemed_event/);
  assert.match(migration, /smoke_evidence_hash/);
  assert.match(migration, /maintenance_released_at/);
  assert.equal(
    (migration.match(/SET @course_049_coach_code_nullable/g) || []).length,
    1
  );
  assert.equal(
    (
      migration.match(
        /CONSTRAINT `fk_course_shop_components_ticket` FOREIGN KEY/g
      ) || []
    ).length,
    1
  );
});

test('schema marker is legacy for migration and active only for fresh installs', () => {
  assert.match(
    migration,
    /1, '049_course_count_card_normalization', 'legacy', 0/
  );
  assert.match(
    indexSql,
    /1, '049_course_count_card_normalization', 'active', 0/
  );
  assert.match(
    schemaSql,
    /1, '049_course_count_card_normalization', 'active', 0/
  );
  assert.match(
    migration,
    /VALUES \('049_course_count_card_normalization',/
  );
  const markerInsert = migration.lastIndexOf(
    'INSERT IGNORE INTO `course_schema_versions`'
  );
  const markerDelete = migration.indexOf(
    "DELETE FROM `course_schema_versions`\n WHERE `version` = '049_course_count_card_normalization'"
  );
  assert.ok(markerDelete > migration.indexOf('CREATE TABLE IF NOT EXISTS `course_schema_versions`'));
  assert.ok(markerDelete < migration.indexOf('CREATE TABLE IF NOT EXISTS `course_students`'));
  assert.ok(markerInsert > migration.indexOf('CREATE TRIGGER `course_usage_events_no_delete`'));
  assert.ok(markerInsert < migration.lastIndexOf("SELECT 'Migration 049_course_count_card_normalization applied'"));
  assert.match(
    migration,
    /INSERT INTO `course_ticket_state_periods`[\s\S]*AND NOT EXISTS \([\s\S]*existing\.`ticket_id` = t\.`id`[\s\S]*legacy_ticket/
  );
});

test('fresh schemas contain the exact 049 contract after legacy course tables', () => {
  assert.equal(normalizedFreshBlock(indexSql), migration.trim());
  assert.equal(normalizedFreshBlock(schemaSql), migration.trim());
  for (const sql of [indexSql, schemaSql]) {
    assert.ok(
      sql.indexOf('-- Course count-card V2 normalized schema (fresh install).')
      > sql.indexOf('CREATE TABLE IF NOT EXISTS `course_tickets`')
    );
    assert.doesNotMatch(sql, /COURSE_V2_SCHEMA_(?:APPEND_MARKER|SYNC_END)/);
    assert.match(sql, /CREATE TRIGGER `course_usage_events_no_update`/);
    assert.match(sql, /CREATE TRIGGER `course_usage_events_no_delete`/);
  }
});
