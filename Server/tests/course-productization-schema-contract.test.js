'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const readMigration = (name) => fs.readFileSync(
  path.join(root, 'Database', 'migrations', name),
  'utf8'
);

const countCard = readMigration('051_course_count_card_operational_parity.sql');
const fixedTerm = readMigration('052_course_fixed_term_productization.sql');
const payments = readMigration('053_course_term_payments_notifications.sql');
const indexSql = fs.readFileSync(path.join(root, 'Database', 'index.sql'), 'utf8');
const schemaSql = fs.readFileSync(path.join(root, 'Database', 'schema.mysql.sql'), 'utf8');

function mirroredBlock(sql, number) {
  const begin = `-- COURSE_PRODUCTIZATION_${number}_BEGIN`;
  const end = `-- COURSE_PRODUCTIZATION_${number}_END`;
  const start = sql.indexOf(begin);
  const finish = sql.indexOf(end, start);
  assert.notEqual(start, -1, `missing ${begin}`);
  assert.notEqual(finish, -1, `missing ${end}`);
  assert.equal(sql.indexOf(begin, start + begin.length), -1, `duplicate ${begin}`);
  return sql.slice(start + begin.length, finish).trim();
}

function assertCreates(sql, tables) {
  for (const table of tables) {
    assert.match(
      sql,
      new RegExp(`CREATE TABLE IF NOT EXISTS ${'`'}${table}${'`'}`),
      `missing ${table}`
    );
  }
}

function assertGuardedMigration(sql, number, marker) {
  assert.doesNotMatch(sql, /^\+/m, `${marker} contains a leaked patch marker`);
  assert.match(sql, new RegExp(`CREATE PROCEDURE ${'`'}course_${number}_add_column${'`'}`));
  assert.match(sql, /INFORMATION_SCHEMA\.COLUMNS/);
  assert.match(sql, /INFORMATION_SCHEMA\.STATISTICS/);
  assert.match(sql, /INFORMATION_SCHEMA\.REFERENTIAL_CONSTRAINTS/);
  assert.match(sql, new RegExp(`DELETE FROM ${'`'}course_schema_versions${'`'}[\\s\\S]*${marker}`));
  const markerInsert = sql.lastIndexOf(`VALUES ('${marker}'`);
  const cleanup = sql.lastIndexOf(`DROP PROCEDURE IF EXISTS \`course_${number}_add_column\``);
  assert.ok(cleanup >= 0 && markerInsert > cleanup, `${marker} marker must be last`);
}

function assertGeneratedColumnBasesUseRestrictiveForeignKeys(sql) {
  const tables = sql.match(/CREATE TABLE IF NOT EXISTS `[\s\S]*?\) ENGINE=InnoDB[^;]*;/g) || [];
  let auditedForeignKeys = 0;

  for (const table of tables) {
    const generatedBases = new Set();
    for (const generated of table.matchAll(
      /`[^`]+`[^\n]*GENERATED ALWAYS AS \(([\s\S]*?)\) STORED/g
    )) {
      for (const token of generated[1].matchAll(/`([^`]+)`/g)) {
        generatedBases.add(token[1]);
      }
    }

    for (const line of table.split('\n')) {
      const foreignKey = line.match(/FOREIGN KEY \(`([^`]+)`\)/);
      if (!foreignKey || !generatedBases.has(foreignKey[1])) continue;
      auditedForeignKeys += 1;
      assert.doesNotMatch(
        line,
        /\b(?:CASCADE|SET NULL|SET DEFAULT)\b/,
        `generated-column base must use restrictive FK actions: ${line.trim()}`
      );
    }
  }

  assert.ok(auditedForeignKeys > 0, 'expected generated-column base foreign keys');
}

test('051 extends normalized count-card operations without changing the 049 cutover marker', () => {
  assertGuardedMigration(countCard, '051', '051_course_count_card_operational_parity');
  assert.doesNotMatch(countCard, /UPDATE\s+`course_v2_cutover_state`/i);

  for (const column of ['item_type', 'session_bound', 'redeem_quantity']) {
    assert.match(countCard, new RegExp(`course_redeem_scenarios', '${column}'`));
  }
  assert.match(countCard, /''class'', ''term'', ''event'', ''merchant'', ''service'', ''other''/);
  assert.match(countCard, /course_051_make_nullable`\('course_sessions', 'capacity'/);
  assert.match(countCard, /SET `capacity` = NULL[\s\S]*`capacity` = 0/);

  for (const column of [
    'product_type', 'usage_mode', 'source_system', 'max_transfer_operations',
    'pause_max_operations', 'pause_max_days',
  ]) {
    assert.match(countCard, new RegExp(`course_ticket_products', '${column}'`));
  }
  assert.match(countCard, /'course_tickets', 'usage_mode_snapshot', 'VARCHAR\(16\) NULL/);
  assert.match(countCard, /'course_tickets', 'product_type_snapshot', 'VARCHAR\(32\) NULL/);
  assert.match(countCard, /'course_tickets', 'parent_ticket_id'/);
  assert.match(countCard, /fk_course_tickets_transfer_root/);

  for (const origin of [
    'MEMBER_RSVP', 'WALK_IN', 'ATTENDANCE_INVITE', 'TERM_ROSTER', 'MAKEUP',
  ]) assert.match(countCard, new RegExp(origin));
  for (const purpose of [
    'BOOKING', 'ATTENDANCE_CONFIRMATION', 'TRANSFER', 'PAYMENT_INSTRUMENT',
  ]) assert.match(countCard, new RegExp(purpose));
  assert.match(countCard, /active_source_key/);
  assert.doesNotMatch(countCard, /chk_course_ticket_hold_quantity/);
  assert.match(countCard, /expiry_action[\s\S]*release[\s\S]*auto_redeem/);

  assert.match(countCard, /Typed immutable usage facts/);
  assert.match(countCard, /'course_usage_events', 'usage_method'/);
  assert.match(countCard, /'course_usage_events', 'quantity_snapshot'/);
  for (const fact of [
    'usage_method', 'scenario_id', 'coach_profile_id', 'provider_user_id_snapshot',
    'venue_name_snapshot', 'city_snapshot', 'quantity_snapshot',
  ]) assert.match(countCard, new RegExp(`course_usage_events', '${fact}'`));

  assert.match(countCard, /transfer_mode[\s\S]*WHOLE_LEGACY[\s\S]*PARTIAL/);
  assert.match(countCard, /uq_course_ticket_transfers_hold/);
  assert.match(countCard, /fk_course_ticket_transfers_child/);
  for (const setting of [
    'attendance_invite_expiry_action', 'bank_transfer_hold_hours',
    'pause_max_operations', 'pause_max_days', 'push_plan_max_available_uses',
    'expiring_ticket_days', 'dormant_student_days', 'count_card_parity_enabled',
  ]) assert.match(countCard, new RegExp(`course_settings', '${setting}'`));
});

test('052 keeps fixed-term enrollment and per-session rights separate from count-card usage', () => {
  assertGuardedMigration(fixedTerm, '052', '052_course_fixed_term_productization');
  assertCreates(fixedTerm, [
    'course_programs',
    'course_level_schemes',
    'course_levels',
    'course_student_level_records',
    'course_terms',
    'course_term_pricing_rules',
    'course_term_renewal_rules',
    'course_term_quotes',
    'course_term_enrollments',
    'course_term_session_entitlements',
    'course_term_waitlist_entries',
    'course_term_seat_offers',
    'course_seat_allocations',
    'course_term_leave_requests',
    'course_makeup_entitlements',
    'course_makeup_routes',
    'course_makeup_bookings',
  ]);
  assert.doesNotMatch(fixedTerm, /INSERT\s+INTO\s+`course_usage_events`/i);

  for (const column of [
    'program_id', 'code', 'name', 'enrollment_open_at', 'enrollment_close_at',
    'starts_on', 'ends_on', 'capacity', 'timezone', 'rules_snapshot_json', 'row_version',
  ]) assert.match(fixedTerm, new RegExp(`${'`'}${column}${'`'}`));
  assert.match(fixedTerm, /PRO_RATA_SESSIONS/);
  assert.match(fixedTerm, /UNIT_X_REMAINING/);
  assert.match(fixedTerm, /PRO_RATA_CALENDAR/);

  assert.match(fixedTerm, /`quote_code` VARCHAR\(48\) NOT NULL/);
  assert.match(fixedTerm, /UNIQUE KEY `uq_course_term_quotes_user_key` \(`user_id`, `idempotency_key`\)/);
  assert.match(fixedTerm, /`session_ids_json` JSON NOT NULL/);
  assert.match(fixedTerm, /`pricing_snapshot_json` JSON NOT NULL/);
  assert.match(fixedTerm, /`rules_snapshot_json` JSON NOT NULL/);

  assert.match(fixedTerm, /`enrollment_code` VARCHAR\(48\) NOT NULL/);
  assert.match(fixedTerm, /`status` VARCHAR\(24\) NOT NULL DEFAULT 'PENDING_PAYMENT'/);
  assert.match(fixedTerm, /course_term_session_entitlements[\s\S]*`student_id` BIGINT UNSIGNED NOT NULL/);
  assert.match(fixedTerm, /course_term_session_entitlements[\s\S]*`user_id` CHAR\(36\) NOT NULL/);
  assert.match(fixedTerm, /course_seat_allocations[\s\S]*active_student_id.*GENERATED ALWAYS AS/s);
  assert.match(fixedTerm, /course_seat_allocations[\s\S]*active_order_id.*GENERATED ALWAYS AS/s);
  assert.match(fixedTerm, /course_makeup_entitlements[\s\S]*PENDING_INSURANCE/s);
  const makeupBookings = fixedTerm.slice(
    fixedTerm.indexOf('CREATE TABLE IF NOT EXISTS `course_makeup_bookings`'),
    fixedTerm.indexOf('-- Cyclic business references')
  );
  assert.match(makeupBookings, /active_user_id[\s\S]*GENERATED ALWAYS AS/s);
  assert.match(
    makeupBookings,
    /fk_course_makeup_bookings_user` FOREIGN KEY \(`user_id`\)[^\n]+ON DELETE RESTRICT,/
  );
  assert.doesNotMatch(
    makeupBookings,
    /fk_course_makeup_bookings_user`[^\n]+(?:CASCADE|SET NULL)/
  );
  assert.match(fixedTerm, /'course_settings', 'fixed_term_enabled'.*DEFAULT 0/);
});

test('053 models remittance, ticket instruments, insurance and post-commit delivery', () => {
  assertGuardedMigration(payments, '053', '053_course_term_payments_notifications');
  assertCreates(payments, [
    'course_payment_submissions',
    'course_order_payment_instruments',
    'course_order_discounts',
    'course_makeup_insurance_policies',
    'course_makeup_insurance_coverages',
    'course_user_notifications',
    'course_notification_outbox',
  ]);

  for (const column of [
    'owner_user_id', 'term_id', 'order_purpose', 'payment_method', 'pay_by_at',
    'cancelled_at', 'cancel_reason',
  ]) assert.match(payments, new RegExp(`course_orders', '${column}'`));
  assert.match(payments, /course_053_make_nullable`\('course_orders', 'user_id'/);
  assert.match(payments, /course_053_make_nullable`\('course_orders', 'product_id'/);
  assert.match(payments, /fk_course_orders_term/);
  assert.match(payments, /CREATE PROCEDURE `course_053_drop_check`/);
  assert.match(
    payments,
    /course_053_drop_check`\('course_orders', 'chk_course_orders_payment_method'\)/
  );
  assert.doesNotMatch(payments, /DROP CHECK IF EXISTS/i);

  const submissions = payments.slice(
    payments.indexOf('CREATE TABLE IF NOT EXISTS `course_payment_submissions`'),
    payments.indexOf('CREATE TABLE IF NOT EXISTS `course_order_payment_instruments`')
  );
  for (const field of [
    'order_id', 'user_id', 'last5', 'status', 'submitted_at', 'reviewed_by',
    'reviewed_at', 'reason', 'row_version',
  ]) assert.match(submissions, new RegExp(`${'`'}${field}${'`'}`));
  assert.match(submissions, /active_order_id.*GENERATED ALWAYS AS/s);

  const instruments = payments.slice(
    payments.indexOf('CREATE TABLE IF NOT EXISTS `course_order_payment_instruments`'),
    payments.indexOf('CREATE TABLE IF NOT EXISTS `course_order_discounts`')
  );
  assert.match(instruments, /TRIAL_DISCOUNT/);
  assert.match(instruments, /COURSE_TICKET/);
  assert.match(instruments, /fk_course_order_instrument_hold/);
  assert.match(instruments, /fk_course_order_instrument_usage/);
  assert.match(instruments, /policy_snapshot_json/);

  assert.match(payments, /course_makeup_insurance_policies[\s\S]*target_session_id/s);
  assert.match(payments, /course_makeup_insurance_coverages[\s\S]*seat_allocation_id/s);
  assert.match(payments, /course_makeup_insurance_coverages[\s\S]*pending_payment/s);
  assert.match(payments, /course_seat_allocations', 'session_id'/);
  assert.match(payments, /uq_course_makeup_insurance_user_key/);
  assert.match(payments, /course_makeup_insurance_coverages[\s\S]*`request_hash` CHAR\(64\) NOT NULL/s);

  const outbox = payments.slice(
    payments.indexOf('CREATE TABLE IF NOT EXISTS `course_notification_outbox`')
  );
  for (const field of [
    'owner_user_id', 'user_id', 'event_type', 'dedupe_key', 'payload_json',
    'status', 'attempts', 'available_at', 'locked_at', 'sent_at', 'last_error',
  ]) assert.match(outbox, new RegExp(`${'`'}${field}${'`'}`));
  assert.match(outbox, /UNIQUE KEY `uq_course_notification_outbox_dedupe`/);
  assert.match(payments, /'course_settings', 'advanced_payments_enabled'.*DEFAULT 0/);
});

test('052 and 053 generated-column bases use MySQL-compatible restrictive foreign keys', () => {
  assertGeneratedColumnBasesUseRestrictiveForeignKeys(fixedTerm);
  assertGeneratedColumnBasesUseRestrictiveForeignKeys(payments);
});

test('all new provider-owned aggregates are scoped and mutable aggregates are versioned', () => {
  const tables = [
    [fixedTerm, [
      'course_programs', 'course_terms', 'course_term_quotes',
      'course_term_enrollments', 'course_term_session_entitlements',
      'course_term_waitlist_entries', 'course_term_seat_offers',
      'course_seat_allocations', 'course_term_leave_requests',
      'course_makeup_entitlements', 'course_makeup_routes', 'course_makeup_bookings',
    ]],
    [payments, [
      'course_payment_submissions', 'course_order_payment_instruments',
      'course_order_discounts', 'course_makeup_insurance_policies',
      'course_makeup_insurance_coverages', 'course_user_notifications',
      'course_notification_outbox',
    ]],
  ];

  for (const [sql, names] of tables) {
    for (const name of names) {
      const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS \`${name}\``);
      assert.notEqual(start, -1, `missing ${name}`);
      const end = sql.indexOf('ENGINE=InnoDB', start);
      const definition = sql.slice(start, end);
      assert.match(definition, /`owner_user_id` CHAR\(36\) (?:NOT NULL|DEFAULT NULL)/, `${name} owner scope`);
      assert.match(definition, /`row_version` INT UNSIGNED NOT NULL DEFAULT 1/, `${name} row_version`);
      assert.match(definition, /FOREIGN KEY \(`owner_user_id`\) REFERENCES `users`/, `${name} owner FK`);
    }
  }
});

test('fresh-install schemas mirror the exact current 051-053 migrations after 050', () => {
  const contracts = [
    ['051', countCard],
    ['052', fixedTerm],
    ['053', payments],
  ];
  for (const fresh of [indexSql, schemaSql]) {
    const parityMarker = fresh.lastIndexOf("SELECT 'Migration 050_order_ticket_parity applied' AS msg;");
    assert.ok(parityMarker >= 0, 'missing preserved 050 marker');
    let previous = parityMarker;
    for (const [number, migration] of contracts) {
      const marker = fresh.indexOf(`-- COURSE_PRODUCTIZATION_${number}_BEGIN`);
      assert.ok(marker > previous, `${number} must follow the prior migration`);
      assert.equal(mirroredBlock(fresh, number), migration.trim(), `${number} mirror drift`);
      previous = marker;
    }
  }
});
