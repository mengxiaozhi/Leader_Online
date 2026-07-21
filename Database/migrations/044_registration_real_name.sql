-- Registration must retain the user-declared real name until Email verification finishes.
-- Rerunnable for both fresh and existing databases.
SET @registration_name_column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'email_verifications'
    AND COLUMN_NAME = 'registration_name'
);

SET @registration_name_migration_sql := IF(
  @registration_name_column_exists = 0,
  'ALTER TABLE `email_verifications` ADD COLUMN `registration_name` VARCHAR(50) NULL AFTER `email`',
  'SELECT 1'
);

PREPARE registration_name_migration_stmt FROM @registration_name_migration_sql;
EXECUTE registration_name_migration_stmt;
DEALLOCATE PREPARE registration_name_migration_stmt;
