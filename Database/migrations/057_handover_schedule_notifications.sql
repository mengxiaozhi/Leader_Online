-- 057: precise handover windows and durable email delivery. Apply before Server/Web.
-- Old pre_start/post_start date ranges are intentionally not backfilled.

SET @handover_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_stores' AND COLUMN_NAME = 'handover_schedule_version') = 0,
  'ALTER TABLE event_stores ADD COLUMN handover_schedule_version INT UNSIGNED NOT NULL DEFAULT 1', 'SELECT 1');
PREPARE handover_stmt FROM @handover_ddl;
EXECUTE handover_stmt;
DEALLOCATE PREPARE handover_stmt;

SET @handover_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_stores' AND COLUMN_NAME = 'handover_stage_versions') = 0,
  'ALTER TABLE event_stores ADD COLUMN handover_stage_versions JSON DEFAULT NULL', 'SELECT 1');
PREPARE handover_stmt FROM @handover_ddl;
EXECUTE handover_stmt;
DEALLOCATE PREPARE handover_stmt;

SET @handover_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_stores' AND COLUMN_NAME = 'pre_dropoff_starts_at') = 0,
  'ALTER TABLE event_stores ADD COLUMN pre_dropoff_starts_at DATETIME DEFAULT NULL', 'SELECT 1');
PREPARE handover_stmt FROM @handover_ddl;
EXECUTE handover_stmt;
DEALLOCATE PREPARE handover_stmt;

SET @handover_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_stores' AND COLUMN_NAME = 'pre_dropoff_ends_at') = 0,
  'ALTER TABLE event_stores ADD COLUMN pre_dropoff_ends_at DATETIME DEFAULT NULL', 'SELECT 1');
PREPARE handover_stmt FROM @handover_ddl;
EXECUTE handover_stmt;
DEALLOCATE PREPARE handover_stmt;

SET @handover_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_stores' AND COLUMN_NAME = 'pre_pickup_starts_at') = 0,
  'ALTER TABLE event_stores ADD COLUMN pre_pickup_starts_at DATETIME DEFAULT NULL', 'SELECT 1');
PREPARE handover_stmt FROM @handover_ddl;
EXECUTE handover_stmt;
DEALLOCATE PREPARE handover_stmt;

SET @handover_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_stores' AND COLUMN_NAME = 'pre_pickup_ends_at') = 0,
  'ALTER TABLE event_stores ADD COLUMN pre_pickup_ends_at DATETIME DEFAULT NULL', 'SELECT 1');
PREPARE handover_stmt FROM @handover_ddl;
EXECUTE handover_stmt;
DEALLOCATE PREPARE handover_stmt;

SET @handover_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_stores' AND COLUMN_NAME = 'post_dropoff_starts_at') = 0,
  'ALTER TABLE event_stores ADD COLUMN post_dropoff_starts_at DATETIME DEFAULT NULL', 'SELECT 1');
PREPARE handover_stmt FROM @handover_ddl;
EXECUTE handover_stmt;
DEALLOCATE PREPARE handover_stmt;

SET @handover_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_stores' AND COLUMN_NAME = 'post_dropoff_ends_at') = 0,
  'ALTER TABLE event_stores ADD COLUMN post_dropoff_ends_at DATETIME DEFAULT NULL', 'SELECT 1');
PREPARE handover_stmt FROM @handover_ddl;
EXECUTE handover_stmt;
DEALLOCATE PREPARE handover_stmt;

SET @handover_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_stores' AND COLUMN_NAME = 'post_pickup_starts_at') = 0,
  'ALTER TABLE event_stores ADD COLUMN post_pickup_starts_at DATETIME DEFAULT NULL', 'SELECT 1');
PREPARE handover_stmt FROM @handover_ddl;
EXECUTE handover_stmt;
DEALLOCATE PREPARE handover_stmt;

SET @handover_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_stores' AND COLUMN_NAME = 'post_pickup_ends_at') = 0,
  'ALTER TABLE event_stores ADD COLUMN post_pickup_ends_at DATETIME DEFAULT NULL', 'SELECT 1');
PREPARE handover_stmt FROM @handover_ddl;
EXECUTE handover_stmt;
DEALLOCATE PREPARE handover_stmt;

CREATE TABLE IF NOT EXISTS handover_notification_outbox (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id INT UNSIGNED NOT NULL,
  user_id CHAR(36) NOT NULL,
  kind VARCHAR(20) NOT NULL,
  stage VARCHAR(20) DEFAULT NULL,
  schedule_revision INT UNSIGNED NOT NULL DEFAULT 0,
  dedupe_key CHAR(64) NOT NULL,
  payload_json JSON NOT NULL,
  due_at DATETIME NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  locked_at DATETIME DEFAULT NULL,
  last_error VARCHAR(2000) DEFAULT NULL,
  sent_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_handover_notification_dedupe (dedupe_key),
  KEY idx_handover_notification_due (status, due_at),
  KEY idx_handover_notification_store (store_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS handover_notification_memberships (
  reservation_id BIGINT UNSIGNED NOT NULL,
  user_id CHAR(36) NOT NULL,
  store_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (reservation_id, user_id, store_id),
  KEY idx_handover_membership_store (store_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
