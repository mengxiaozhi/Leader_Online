-- Run before deploying the consignor-name server change.
-- Adding a column changes the audit trigger definitions. With application writers
-- paused, run Server's npm run audit:install, then npm run audit:check before restart.
-- Keep historical consignors unknown; membership does not establish consignor identity.
SET @consignor_name_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'consignor_name') = 0,
  'ALTER TABLE reservations ADD COLUMN consignor_name VARCHAR(50) DEFAULT NULL AFTER user_id', 'SELECT 1');
PREPARE consignor_name_stmt FROM @consignor_name_ddl;
EXECUTE consignor_name_stmt;
DEALLOCATE PREPARE consignor_name_stmt;
