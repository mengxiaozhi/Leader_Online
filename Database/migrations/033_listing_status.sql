-- Migration 033: add draft/published listing status to ticket products and service events.

SET @schema_name := DATABASE();

SET @has_product_listing_status := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @schema_name
     AND TABLE_NAME = 'products'
     AND COLUMN_NAME = 'listing_status'
);
SET @sql := IF(
  @has_product_listing_status = 0,
  'ALTER TABLE `products` ADD COLUMN `listing_status` VARCHAR(16) NOT NULL DEFAULT ''published'' AFTER `owner_user_id`',
  'SELECT ''products.listing_status already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `products`
   SET `listing_status` = 'published'
 WHERE `listing_status` IS NULL
    OR `listing_status` NOT IN ('draft', 'published');

SET @has_product_listing_status_idx := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = @schema_name
     AND TABLE_NAME = 'products'
     AND INDEX_NAME = 'idx_products_listing_status'
);
SET @sql := IF(
  @has_product_listing_status_idx = 0,
  'ALTER TABLE `products` ADD INDEX `idx_products_listing_status` (`listing_status`)',
  'SELECT ''products.idx_products_listing_status already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_event_listing_status := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @schema_name
     AND TABLE_NAME = 'events'
     AND COLUMN_NAME = 'listing_status'
);
SET @sql := IF(
  @has_event_listing_status = 0,
  'ALTER TABLE `events` ADD COLUMN `listing_status` VARCHAR(16) NOT NULL DEFAULT ''published'' AFTER `is_exclusive`',
  'SELECT ''events.listing_status already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `events`
   SET `listing_status` = 'published'
 WHERE `listing_status` IS NULL
    OR `listing_status` NOT IN ('draft', 'published');

SET @has_event_listing_status_idx := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = @schema_name
     AND TABLE_NAME = 'events'
     AND INDEX_NAME = 'idx_events_listing_status'
);
SET @sql := IF(
  @has_event_listing_status_idx = 0,
  'ALTER TABLE `events` ADD INDEX `idx_events_listing_status` (`listing_status`)',
  'SELECT ''events.idx_events_listing_status already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration 033_listing_status applied' AS msg;
