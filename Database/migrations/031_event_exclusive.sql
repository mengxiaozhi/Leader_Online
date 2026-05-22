SET @schema_name := DATABASE();

SET @has_event_exclusive := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'events'
    AND COLUMN_NAME = 'is_exclusive'
);

SET @sql := IF(
  @has_event_exclusive = 0,
  'ALTER TABLE `events` ADD COLUMN `is_exclusive` TINYINT(1) NOT NULL DEFAULT 0 AFTER `owner_user_id`',
  'SELECT ''events.is_exclusive already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_event_exclusive_owner_index := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'events'
    AND INDEX_NAME = 'idx_events_exclusive_owner'
);

SET @sql := IF(
  @has_event_exclusive_owner_index = 0,
  'ALTER TABLE `events` ADD INDEX `idx_events_exclusive_owner` (`is_exclusive`, `owner_user_id`)',
  'SELECT ''idx_events_exclusive_owner already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration 031_event_exclusive applied' AS msg;
