-- Migration 034: per-event service quantity limit
-- NULL means unlimited. This migration only adds the column and does not modify existing rows.

SET @has_event_store_capacity := (
  SELECT COUNT(*)
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'event_stores'
     AND column_name = 'capacity'
);

SET @event_store_capacity_sql := IF(
  @has_event_store_capacity = 0,
  'ALTER TABLE `event_stores` ADD COLUMN `capacity` INT UNSIGNED NULL AFTER `business_hours`;',
  'SELECT "event_stores.capacity already exists" AS info;'
);

PREPARE stmt FROM @event_store_capacity_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration 034_event_store_capacity applied' AS msg;
