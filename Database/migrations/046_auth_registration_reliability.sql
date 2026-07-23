-- Migration 046: reliable email-registration delivery and one-time completion.
--
-- Existing verification rows and tokens are intentionally preserved. Every
-- ALTER is guarded so this migration is safe to run more than once and it does
-- not require disabling SQL_SAFE_UPDATES.

SET @email_verifications_last_send_attempt_at_exists := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'email_verifications'
     AND COLUMN_NAME = 'last_send_attempt_at'
);
SET @email_verifications_last_send_attempt_at_sql := IF(
  @email_verifications_last_send_attempt_at_exists = 0,
  'ALTER TABLE `email_verifications` ADD COLUMN `last_send_attempt_at` DATETIME NULL AFTER `verified`',
  'SELECT 1'
);
PREPARE email_verifications_last_send_attempt_at_stmt
  FROM @email_verifications_last_send_attempt_at_sql;
EXECUTE email_verifications_last_send_attempt_at_stmt;
DEALLOCATE PREPARE email_verifications_last_send_attempt_at_stmt;

SET @email_verifications_send_window_started_at_exists := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'email_verifications'
     AND COLUMN_NAME = 'send_window_started_at'
);
SET @email_verifications_send_window_started_at_sql := IF(
  @email_verifications_send_window_started_at_exists = 0,
  'ALTER TABLE `email_verifications` ADD COLUMN `send_window_started_at` DATETIME NULL AFTER `last_send_attempt_at`',
  'SELECT 1'
);
PREPARE email_verifications_send_window_started_at_stmt
  FROM @email_verifications_send_window_started_at_sql;
EXECUTE email_verifications_send_window_started_at_stmt;
DEALLOCATE PREPARE email_verifications_send_window_started_at_stmt;

SET @email_verifications_send_attempt_count_exists := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'email_verifications'
     AND COLUMN_NAME = 'send_attempt_count'
);
SET @email_verifications_send_attempt_count_sql := IF(
  @email_verifications_send_attempt_count_exists = 0,
  'ALTER TABLE `email_verifications` ADD COLUMN `send_attempt_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER `send_window_started_at`',
  'SELECT 1'
);
PREPARE email_verifications_send_attempt_count_stmt
  FROM @email_verifications_send_attempt_count_sql;
EXECUTE email_verifications_send_attempt_count_stmt;
DEALLOCATE PREPARE email_verifications_send_attempt_count_stmt;

SET @email_verifications_delivered_at_exists := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'email_verifications'
     AND COLUMN_NAME = 'delivered_at'
);
SET @email_verifications_delivered_at_sql := IF(
  @email_verifications_delivered_at_exists = 0,
  'ALTER TABLE `email_verifications` ADD COLUMN `delivered_at` DATETIME NULL AFTER `send_attempt_count`',
  'SELECT 1'
);
PREPARE email_verifications_delivered_at_stmt
  FROM @email_verifications_delivered_at_sql;
EXECUTE email_verifications_delivered_at_stmt;
DEALLOCATE PREPARE email_verifications_delivered_at_stmt;

SET @email_verifications_used_at_exists := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'email_verifications'
     AND COLUMN_NAME = 'used_at'
);
SET @email_verifications_used_at_sql := IF(
  @email_verifications_used_at_exists = 0,
  'ALTER TABLE `email_verifications` ADD COLUMN `used_at` DATETIME NULL AFTER `delivered_at`',
  'SELECT 1'
);
PREPARE email_verifications_used_at_stmt
  FROM @email_verifications_used_at_sql;
EXECUTE email_verifications_used_at_stmt;
DEALLOCATE PREPARE email_verifications_used_at_stmt;

SET @email_verifications_token_unique_index_exists := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'email_verifications'
     AND INDEX_NAME = 'uq_email_verifications_token'
);
SET @email_verifications_token_unique_index_sql := IF(
  @email_verifications_token_unique_index_exists = 0,
  'ALTER TABLE `email_verifications` ADD UNIQUE KEY `uq_email_verifications_token` (`token`)',
  'SELECT 1'
);
PREPARE email_verifications_token_unique_index_stmt
  FROM @email_verifications_token_unique_index_sql;
EXECUTE email_verifications_token_unique_index_stmt;
DEALLOCATE PREPARE email_verifications_token_unique_index_stmt;

SELECT 'Migration 046_auth_registration_reliability applied' AS msg;
