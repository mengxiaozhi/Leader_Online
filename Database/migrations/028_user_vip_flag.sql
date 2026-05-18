-- Migration 028: user VIP membership flag
USE leader_online;

SET @has_is_vip := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'is_vip'
);
SET @ddl := IF(
  @has_is_vip = 0,
  'ALTER TABLE `users` ADD COLUMN `is_vip` TINYINT(1) NOT NULL DEFAULT 0 AFTER `role`;',
  'SELECT "users.is_vip already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 028_user_vip_flag applied' AS msg;
