-- Migration 035: service provider legal terms
-- Adds an optional per-provider terms field. Existing user rows are not modified.

SET @has_provider_service_terms := (
  SELECT COUNT(*)
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'users'
     AND column_name = 'service_terms'
);

SET @provider_service_terms_sql := IF(
  @has_provider_service_terms = 0,
  'ALTER TABLE `users` ADD COLUMN `service_terms` MEDIUMTEXT NULL AFTER `remittance_bank_name`;',
  'SELECT "users.service_terms already exists" AS info;'
);

PREPARE stmt FROM @provider_service_terms_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration 035_provider_service_terms applied' AS msg;
