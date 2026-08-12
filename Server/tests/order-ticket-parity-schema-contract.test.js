'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const migration = read('Database', 'migrations', '050_order_ticket_parity.sql');
const schema = read('Database', 'schema.mysql.sql');
const indexSql = read('Database', 'index.sql');
const modularAccount = read('Server', 'src', 'routes', 'account.js');
const modularContext = read('Server', 'src', 'context.js');
const legacyRuntime = read('Server', 'v1', 'index.js');

function tableDefinition(sql, tableName) {
  const escaped = tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = sql.match(new RegExp(
    `CREATE TABLE(?: IF NOT EXISTS)?\\s+${'`'}${escaped}${'`'}\\s*\\(([\\s\\S]*?)\\)\\s*ENGINE`,
    'i'
  ));
  assert.ok(match, `missing ${tableName} table`);
  return match[1];
}

test('050 keeps the two ticket domains separate and adds shared lifecycle storage', () => {
  for (const table of [
    'course_carts',
    'course_checkout_batches',
    'order_action_idempotency',
    'order_lifecycle_events',
  ]) {
    const createPattern = new RegExp(`CREATE TABLE IF NOT EXISTS ${'`'}${table}${'`'}`);
    assert.match(migration, createPattern);
    assert.match(schema, createPattern);
    assert.match(indexSql, createPattern);
  }
  assert.doesNotMatch(migration, /RENAME TABLE\s+`?(orders|tickets|course_orders|course_tickets)/i);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS `orders`/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS `course_orders`/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS `tickets`/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS `course_tickets`/);
});

test('050 adds canonical lifecycle, version and quantity columns to both domains', () => {
  const requiredMigrationCalls = [
    /parity_050_add_column`\('products', 'max_purchase_quantity'/,
    /parity_050_add_column`\('course_products', 'max_purchase_quantity'/,
    /parity_050_add_column`\('orders', 'payment_status'/,
    /parity_050_add_column`\('orders', 'fulfillment_status'/,
    /parity_050_add_column`\('orders', 'row_version'/,
    /parity_050_add_column`\('course_orders', 'payment_status'/,
    /parity_050_add_column`\('course_orders', 'fulfillment_status'/,
    /parity_050_add_column`\('tickets', 'order_id'/,
    /parity_050_add_column`\('tickets', 'voided_at'/,
    /parity_050_add_column`\('tickets', 'replaced_by_ticket_id'/,
  ];
  for (const pattern of requiredMigrationCalls) assert.match(migration, pattern);
  assert.match(migration, /chk_products_max_purchase_quantity/);
  assert.match(migration, /chk_course_products_max_purchase_quantity/);
  assert.match(
    migration,
    /UPDATE `products`[\s\S]*?WHERE `id` >= 1[\s\S]*?`max_purchase_quantity` IS NULL/
  );
  assert.match(
    migration,
    /UPDATE `course_products`[\s\S]*?WHERE `id` >= 1[\s\S]*?`max_purchase_quantity` IS NULL/
  );

  for (const fresh of [schema, indexSql]) {
    assert.match(fresh, /`max_purchase_quantity` TINYINT UNSIGNED NOT NULL DEFAULT 10/i);
    assert.match(fresh, /`payment_status` VARCHAR\(24\) NOT NULL DEFAULT 'pending'/i);
    assert.match(fresh, /`fulfillment_status` VARCHAR\(24\) NOT NULL DEFAULT 'pending'/i);
    assert.match(fresh, /`voided_at` DATETIME DEFAULT NULL/i);
    assert.match(fresh, /`replaced_by_ticket_id` BIGINT UNSIGNED DEFAULT NULL/i);
    assert.match(fresh, /CHECK \(`max_purchase_quantity` BETWEEN 1 AND 99\)/i);
    assert.match(fresh, /050_order_ticket_parity/);
  }
});

test('050 backfills lifecycle without deleting ambiguous legacy tickets', () => {
  assert.match(migration, /JSON_EXTRACT\(`details`, '\$\.status'\)/);
  assert.match(migration, /UPDATE `course_orders`[\s\S]*WHEN `status` = 'issued' THEN 'fulfilled'/);
  assert.match(migration, /HAVING COUNT\(DISTINCT parsed\.`order_id`\) = 1/);
  assert.match(
    migration,
    /WHEN o\.`payment_status` = 'paid'\s+AND \(\s*SELECT COUNT\(\*\) FROM `course_tickets`/
  );
  assert.match(
    migration,
    /o\.`payment_status` IN \('pending', 'reviewing'\)[\s\S]*?FROM `course_tickets` t/
  );
  assert.match(migration, /migration-repair-required/);
  assert.match(migration, /Legacy order lifecycle and issued-ticket evidence disagree/);
  assert.doesNotMatch(migration, /DELETE FROM `tickets`/i);
  assert.doesNotMatch(migration, /DELETE FROM `course_tickets`/i);
});

test('050 batch updates remain compatible with SQL_SAFE_UPDATES', () => {
  const updates = migration.match(/^UPDATE `[\s\S]*?;/gm) || [];

  assert.equal(updates.length, 7);
  for (const statement of updates) {
    assert.match(
      statement,
      /WHERE (?:`id`|(?:t|o)\.`id`) >= 1/,
      `missing target primary-key predicate:\n${statement}`
    );
  }
});

test('050 reruns repair DDL without re-deriving completed canonical lifecycle state', () => {
  assert.match(migration, /CREATE PROCEDURE `parity_050_backfill`\(\)/);
  assert.match(
    migration,
    /IF NOT EXISTS \([\s\S]*?FROM `course_schema_versions`[\s\S]*?WHERE `version` = '050_order_ticket_parity'[\s\S]*?\) THEN/
  );
  const backfillCall = migration.indexOf('CALL `parity_050_backfill`()');
  const markerInsert = migration.indexOf("VALUES ('050_order_ticket_parity'");
  assert.ok(backfillCall >= 0 && markerInsert > backfillCall);
});

test('fresh-install schemas include the pre-existing product binding and ticket log contracts', () => {
  for (const fresh of [schema, indexSql]) {
    const tickets = tableDefinition(fresh, 'tickets');
    assert.match(tickets, /`product_id`\s+INT UNSIGNED DEFAULT NULL/i);
    assert.match(tickets, /`order_id`\s+BIGINT UNSIGNED DEFAULT NULL/i);
    const ticketLogs = tableDefinition(fresh, 'ticket_logs');
    assert.match(ticketLogs, /`ticket_id`\s+BIGINT UNSIGNED NOT NULL/i);
    assert.match(ticketLogs, /`action`\s+VARCHAR\(32\) NOT NULL/i);
    assert.match(ticketLogs, /`meta`\s+JSON DEFAULT NULL/i);
  }
  assert.match(indexSql, /ADD KEY `idx_tickets_product` \(`product_id`\)/);
  assert.match(indexSql, /migration-repair-required/);
  assert.match(modularContext, /INSERT INTO ticket_logs/);
  assert.match(legacyRuntime, /INSERT INTO ticket_logs/);
});

test('index.sql fresh products support provider ownership and the canonical catalog query', () => {
  for (const fresh of [schema, indexSql]) {
    const products = tableDefinition(fresh, 'products');
    assert.match(products, /`code`\s+VARCHAR\(50\)[^\n]*DEFAULT NULL/i);
    assert.match(products, /`cover_url`\s+VARCHAR\(512\)[^\n]*DEFAULT NULL/i);
    assert.match(products, /`cover_type`\s+VARCHAR\(100\)[^\n]*DEFAULT NULL/i);
    assert.match(products, /`cover_data`\s+LONGBLOB/i);
    assert.match(products, /`cover_path`\s+VARCHAR\(512\)[^\n]*DEFAULT NULL/i);
    assert.match(products, /`owner_user_id`\s+CHAR\(36\)[^\n]*DEFAULT NULL/i);
    assert.match(products, /`listing_status`\s+VARCHAR\(16\)[^\n]*DEFAULT 'published'/i);
  }
  assert.match(indexSql, /ADD UNIQUE KEY `uq_products_code` \(`code`\)/);
  assert.match(indexSql, /ADD KEY `idx_products_owner` \(`owner_user_id`\)/);
  assert.match(indexSql, /ADD KEY `idx_products_listing_status` \(`listing_status`\)/);
});

test('course carts participate in account export, merge and deletion parity', () => {
  assert.match(modularAccount, /async function mergeCourseCart/);
  assert.match(modularAccount, /courseCartItemsMerged/);
  assert.match(modularAccount, /SELECT items, created_at, updated_at FROM course_carts/);
  assert.match(modularAccount, /DELETE FROM course_carts WHERE user_id = \?/);
  assert.match(legacyRuntime, /SELECT items, created_at, updated_at FROM course_carts/);
  assert.match(legacyRuntime, /DELETE FROM course_carts WHERE user_id = \?/);
});

test('multi-ticket purchase does not remove one-account-one-seat booking uniqueness', () => {
  for (const fresh of [schema, indexSql]) {
    assert.match(
      fresh,
      /UNIQUE KEY `uq_course_booking_session_user` \(`session_id`, `user_id`\)/
    );
  }
});
