-- Migration 019: add reservations.order_id link for order-level driver sync
USE leader_online;

SET @has_res_order := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'reservations'
    AND column_name = 'order_id'
);
SET @ddl := IF(
  @has_res_order = 0,
  'ALTER TABLE `reservations` ADD COLUMN `order_id` BIGINT UNSIGNED NULL AFTER `driver_id`;',
  'SELECT "reservations.order_id already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_res_order_idx := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'reservations'
    AND index_name = 'idx_reservations_order'
);
SET @ddl := IF(
  @has_res_order_idx = 0,
  'ALTER TABLE `reservations` ADD INDEX `idx_reservations_order` (`order_id`);',
  'SELECT "idx_reservations_order already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 019_reservations_order_link applied' AS msg;
