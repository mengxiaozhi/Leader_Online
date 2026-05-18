-- Allow service providers to own and manage their own ticket products.
-- Existing products remain global (owner_user_id = NULL) and stay manageable by admins/editors.
-- This migration is idempotent because some installs may already have product cover columns.

SET @schema_name := DATABASE();

SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'products' AND COLUMN_NAME = 'owner_user_id'
    ),
    'SELECT ''products.owner_user_id already exists'' AS msg',
    'ALTER TABLE `products` ADD COLUMN `owner_user_id` CHAR(36) NULL AFTER `price`'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'products' AND COLUMN_NAME = 'cover_url'
    ),
    'SELECT ''products.cover_url already exists'' AS msg',
    'ALTER TABLE `products` ADD COLUMN `cover_url` VARCHAR(512) NULL AFTER `description`'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'products' AND COLUMN_NAME = 'cover_type'
    ),
    'SELECT ''products.cover_type already exists'' AS msg',
    'ALTER TABLE `products` ADD COLUMN `cover_type` VARCHAR(100) NULL AFTER `cover_url`'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'products' AND COLUMN_NAME = 'cover_data'
    ),
    'SELECT ''products.cover_data already exists'' AS msg',
    'ALTER TABLE `products` ADD COLUMN `cover_data` LONGBLOB NULL AFTER `cover_type`'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'products' AND COLUMN_NAME = 'cover_path'
    ),
    'SELECT ''products.cover_path already exists'' AS msg',
    'ALTER TABLE `products` ADD COLUMN `cover_path` VARCHAR(512) NULL AFTER `cover_data`'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'products' AND INDEX_NAME = 'idx_products_owner'
    ),
    'SELECT ''products.idx_products_owner already exists'' AS msg',
    'ALTER TABLE `products` ADD INDEX `idx_products_owner` (`owner_user_id`)'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
