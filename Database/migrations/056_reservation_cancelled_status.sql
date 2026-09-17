-- Apply after 005_reservations_six_stage_status and before deploying whole-order refunds.
-- Append the cancellation value without removing existing ENUM values or changing rows.
-- Re-running this migration is safe; VARCHAR installations already accept cancelled.
SET @reservation_status_type = (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'status'
);
SET @reservation_cancelled_ddl = IF(
  @reservation_status_type LIKE 'enum(%' AND LOCATE('''cancelled''', @reservation_status_type) = 0,
  CONCAT('ALTER TABLE `reservations` MODIFY COLUMN `status` ',
    LEFT(@reservation_status_type, CHAR_LENGTH(@reservation_status_type) - 1),
    ',''cancelled'') NOT NULL DEFAULT ''service_booking'''),
  'SELECT 1'
);
PREPARE reservation_cancelled_stmt FROM @reservation_cancelled_ddl;
EXECUTE reservation_cancelled_stmt;
DEALLOCATE PREPARE reservation_cancelled_stmt;
