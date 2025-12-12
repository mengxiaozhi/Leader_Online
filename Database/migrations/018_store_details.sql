-- Migration 018: add store address, external URL, and business hours fields (idempotent for MySQL < 8.0.28)
USE leader_online;

-- store_templates.address
SET @has_st_address := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'store_templates'
    AND column_name = 'address'
);
SET @ddl := IF(
  @has_st_address = 0,
  'ALTER TABLE `store_templates` ADD COLUMN `address` VARCHAR(255) NULL AFTER `name`;',
  'SELECT "store_templates.address already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- store_templates.external_url
SET @has_st_ext := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'store_templates'
    AND column_name = 'external_url'
);
SET @ddl := IF(
  @has_st_ext = 0,
  'ALTER TABLE `store_templates` ADD COLUMN `external_url` VARCHAR(500) NULL AFTER `address`;',
  'SELECT "store_templates.external_url already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- store_templates.business_hours
SET @has_st_hours := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'store_templates'
    AND column_name = 'business_hours'
);
SET @ddl := IF(
  @has_st_hours = 0,
  'ALTER TABLE `store_templates` ADD COLUMN `business_hours` TEXT NULL AFTER `external_url`;',
  'SELECT "store_templates.business_hours already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- event_stores.address
SET @has_es_address := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'event_stores'
    AND column_name = 'address'
);
SET @ddl := IF(
  @has_es_address = 0,
  'ALTER TABLE `event_stores` ADD COLUMN `address` VARCHAR(255) NULL AFTER `name`;',
  'SELECT "event_stores.address already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- event_stores.external_url
SET @has_es_ext := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'event_stores'
    AND column_name = 'external_url'
);
SET @ddl := IF(
  @has_es_ext = 0,
  'ALTER TABLE `event_stores` ADD COLUMN `external_url` VARCHAR(500) NULL AFTER `address`;',
  'SELECT "event_stores.external_url already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- event_stores.business_hours
SET @has_es_hours := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'event_stores'
    AND column_name = 'business_hours'
);
SET @ddl := IF(
  @has_es_hours = 0,
  'ALTER TABLE `event_stores` ADD COLUMN `business_hours` TEXT NULL AFTER `external_url`;',
  'SELECT "event_stores.business_hours already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 018_store_details applied' AS msg;
