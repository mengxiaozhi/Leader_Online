-- Leader Online - Migration 013: user contact info for checkout
-- Adds phone & remittance account last-5 columns to users table and normalizes existing values.
-- Safe to run multiple times (uses IF NOT EXISTS / defensive UPDATE).

USE leader_online;

-- MySQL 8.0.28 以前不支援 ADD COLUMN IF NOT EXISTS，以下改用資訊結構檢查

SET @has_phone := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'users'
    AND column_name = 'phone'
);

SET @ddl := IF(
  @has_phone = 0,
  'ALTER TABLE `users` ADD COLUMN `phone` VARCHAR(20) NULL DEFAULT NULL AFTER `email`;',
  'SELECT "users.phone already exists" AS info;'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_last5 := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'users'
    AND column_name = 'remittance_last5'
);

SET @ddl := IF(
  @has_last5 = 0,
  'ALTER TABLE `users` ADD COLUMN `remittance_last5` CHAR(5) NULL DEFAULT NULL AFTER `phone`;',
  'SELECT "users.remittance_last5 already exists" AS info;'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Cleanup: trim blanks and keep only 5-digit remittance codes if pre-populated
UPDATE users
SET
  phone = NULLIF(TRIM(phone), ''),
  remittance_last5 = CASE
    WHEN remittance_last5 REGEXP '^[0-9]{5}$' THEN remittance_last5
    ELSE NULL
  END;

SELECT 'Migration 013_user_contact_remittance applied' AS msg;
