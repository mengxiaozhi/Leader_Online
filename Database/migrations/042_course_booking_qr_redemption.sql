-- Course booking QR redemption parity with reservation scanning.

SET @has_course_booking_verify_code := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'course_bookings'
     AND COLUMN_NAME = 'verify_code'
);
SET @sql := IF(
  @has_course_booking_verify_code = 0,
  'ALTER TABLE `course_bookings` ADD COLUMN `verify_code` VARCHAR(40) NULL AFTER `attendee_email`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- MySQL safe-update mode can reject multi-table DELETE statements even when
-- the target table's primary key is constrained. Disable it only for this
-- deduplication statement, then restore the caller's session setting.
SET @course_booking_qr_previous_sql_safe_updates := @@SESSION.SQL_SAFE_UPDATES;
SET SESSION SQL_SAFE_UPDATES = 0;

DELETE duplicate_log
  FROM `course_attendance_logs` duplicate_log
  JOIN `course_attendance_logs` kept_log
    ON kept_log.`booking_id` = duplicate_log.`booking_id`
   AND kept_log.`action` = duplicate_log.`action`
   AND kept_log.`id` < duplicate_log.`id`
 WHERE duplicate_log.`id` >= 1
   AND duplicate_log.`booking_id` IS NOT NULL;

SET SESSION SQL_SAFE_UPDATES = @course_booking_qr_previous_sql_safe_updates;

SET @has_course_attendance_booking_action_index := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'course_attendance_logs'
     AND INDEX_NAME = 'uq_course_attendance_booking_action'
);
SET @sql := IF(
  @has_course_attendance_booking_action_index = 0,
  'ALTER TABLE `course_attendance_logs` ADD UNIQUE KEY `uq_course_attendance_booking_action` (`booking_id`, `action`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `course_bookings`
   SET `verify_code` = CONCAT('CBK-', UPPER(REPLACE(UUID(), '-', '')))
 WHERE `id` >= 1
   AND (`verify_code` IS NULL OR `verify_code` = '');

SET @has_course_booking_verify_index := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'course_bookings'
     AND INDEX_NAME = 'uq_course_bookings_verify_code'
);
SET @sql := IF(
  @has_course_booking_verify_index = 0,
  'ALTER TABLE `course_bookings` ADD UNIQUE KEY `uq_course_bookings_verify_code` (`verify_code`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
