-- Migration 027: per-price-item early bird windows
USE leader_online;

SET @has_early_start := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'event_service_prices' AND column_name = 'early_start'
);
SET @ddl := IF(
  @has_early_start = 0,
  'ALTER TABLE `event_service_prices` ADD COLUMN `early_start` DATETIME NULL AFTER `early_price`;',
  'SELECT "event_service_prices.early_start already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_early_end := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'event_service_prices' AND column_name = 'early_end'
);
SET @ddl := IF(
  @has_early_end = 0,
  'ALTER TABLE `event_service_prices` ADD COLUMN `early_end` DATETIME NULL AFTER `early_start`;',
  'SELECT "event_service_prices.early_end already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 027_price_item_early_windows applied' AS msg;
