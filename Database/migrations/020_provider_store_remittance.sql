-- Migration 020: provider/store remittance settings
USE leader_online;

-- event_stores.owner_user_id
SET @has_es_owner := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'event_stores'
    AND column_name = 'owner_user_id'
);
SET @ddl := IF(
  @has_es_owner = 0,
  'ALTER TABLE `event_stores` ADD COLUMN `owner_user_id` CHAR(36) NULL AFTER `event_id`;',
  'SELECT "event_stores.owner_user_id already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_es_owner_idx := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'event_stores'
    AND index_name = 'idx_event_stores_owner'
);
SET @ddl := IF(
  @has_es_owner_idx = 0,
  'ALTER TABLE `event_stores` ADD INDEX `idx_event_stores_owner` (`owner_user_id`);',
  'SELECT "idx_event_stores_owner already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- users remittance columns
SET @has_u_rem_info := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'remittance_info'
);
SET @ddl := IF(
  @has_u_rem_info = 0,
  'ALTER TABLE `users` ADD COLUMN `remittance_info` TEXT NULL AFTER `remittance_last5`;',
  'SELECT "users.remittance_info already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_u_rem_code := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'remittance_bank_code'
);
SET @ddl := IF(
  @has_u_rem_code = 0,
  'ALTER TABLE `users` ADD COLUMN `remittance_bank_code` VARCHAR(32) NULL AFTER `remittance_info`;',
  'SELECT "users.remittance_bank_code already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_u_rem_account := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'remittance_bank_account'
);
SET @ddl := IF(
  @has_u_rem_account = 0,
  'ALTER TABLE `users` ADD COLUMN `remittance_bank_account` VARCHAR(64) NULL AFTER `remittance_bank_code`;',
  'SELECT "users.remittance_bank_account already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_u_rem_name := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'remittance_account_name'
);
SET @ddl := IF(
  @has_u_rem_name = 0,
  'ALTER TABLE `users` ADD COLUMN `remittance_account_name` VARCHAR(64) NULL AFTER `remittance_bank_account`;',
  'SELECT "users.remittance_account_name already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_u_bank_name := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'remittance_bank_name'
);
SET @ddl := IF(
  @has_u_bank_name = 0,
  'ALTER TABLE `users` ADD COLUMN `remittance_bank_name` VARCHAR(64) NULL AFTER `remittance_account_name`;',
  'SELECT "users.remittance_bank_name already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- event_stores remittance columns
SET @has_es_rem_info := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'event_stores' AND column_name = 'remittance_info'
);
SET @ddl := IF(
  @has_es_rem_info = 0,
  'ALTER TABLE `event_stores` ADD COLUMN `remittance_info` TEXT NULL AFTER `business_hours`;',
  'SELECT "event_stores.remittance_info already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_es_rem_code := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'event_stores' AND column_name = 'remittance_bank_code'
);
SET @ddl := IF(
  @has_es_rem_code = 0,
  'ALTER TABLE `event_stores` ADD COLUMN `remittance_bank_code` VARCHAR(32) NULL AFTER `remittance_info`;',
  'SELECT "event_stores.remittance_bank_code already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_es_rem_account := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'event_stores' AND column_name = 'remittance_bank_account'
);
SET @ddl := IF(
  @has_es_rem_account = 0,
  'ALTER TABLE `event_stores` ADD COLUMN `remittance_bank_account` VARCHAR(64) NULL AFTER `remittance_bank_code`;',
  'SELECT "event_stores.remittance_bank_account already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_es_rem_name := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'event_stores' AND column_name = 'remittance_account_name'
);
SET @ddl := IF(
  @has_es_rem_name = 0,
  'ALTER TABLE `event_stores` ADD COLUMN `remittance_account_name` VARCHAR(64) NULL AFTER `remittance_bank_account`;',
  'SELECT "event_stores.remittance_account_name already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_es_bank_name := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'event_stores' AND column_name = 'remittance_bank_name'
);
SET @ddl := IF(
  @has_es_bank_name = 0,
  'ALTER TABLE `event_stores` ADD COLUMN `remittance_bank_name` VARCHAR(64) NULL AFTER `remittance_account_name`;',
  'SELECT "event_stores.remittance_bank_name already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 020_provider_store_remittance applied' AS msg;
