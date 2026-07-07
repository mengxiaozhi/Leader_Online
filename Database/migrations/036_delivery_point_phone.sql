-- Migration 036: add phone to delivery point master data and event-store snapshots
USE leader_online;

SET @has_dp_phone := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'delivery_points'
    AND column_name = 'phone'
);
SET @ddl := IF(
  @has_dp_phone = 0,
  'ALTER TABLE `delivery_points` ADD COLUMN `phone` VARCHAR(20) NULL AFTER `address`;',
  'SELECT "delivery_points.phone already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_es_phone := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'event_stores'
    AND column_name = 'phone'
);
SET @ddl := IF(
  @has_es_phone = 0,
  'ALTER TABLE `event_stores` ADD COLUMN `phone` VARCHAR(20) NULL AFTER `address`;',
  'SELECT "event_stores.phone already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE `event_stores` es
JOIN `delivery_points` dp ON dp.`id` = es.`delivery_point_id`
SET es.`phone` = NULLIF(TRIM(dp.`phone`), '')
WHERE NULLIF(TRIM(dp.`phone`), '') IS NOT NULL
  AND (es.`phone` IS NULL OR TRIM(es.`phone`) = '');

SELECT 'Migration 036_delivery_point_phone applied' AS msg;
