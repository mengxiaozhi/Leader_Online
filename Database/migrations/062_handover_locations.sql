-- 062: race-site pickup and dropoff locations belong to each event store.
-- Never infer these locations from events.location (the race venue).
-- Pause application writers and workers, apply this migration, then run
-- Server's audit:install and audit:check before restarting updated servers.
SET @handover_location_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_stores' AND COLUMN_NAME = 'pre_pickup_location') = 0,
  'ALTER TABLE event_stores ADD COLUMN pre_pickup_location VARCHAR(255) DEFAULT NULL', 'SELECT 1');
PREPARE handover_location_stmt FROM @handover_location_ddl;
EXECUTE handover_location_stmt;
DEALLOCATE PREPARE handover_location_stmt;

SET @handover_location_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_stores' AND COLUMN_NAME = 'post_dropoff_location') = 0,
  'ALTER TABLE event_stores ADD COLUMN post_dropoff_location VARCHAR(255) DEFAULT NULL', 'SELECT 1');
PREPARE handover_location_stmt FROM @handover_location_ddl;
EXECUTE handover_location_stmt;
DEALLOCATE PREPARE handover_location_stmt;
