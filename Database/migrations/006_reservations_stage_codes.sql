-- Reservations: add per-stage verify codes and drop legacy unique index
-- up
ALTER TABLE `reservations`
  ADD COLUMN `verify_code_pre_dropoff` VARCHAR(12) NULL AFTER `verify_code`,
  ADD COLUMN `verify_code_pre_pickup` VARCHAR(12) NULL AFTER `verify_code_pre_dropoff`,
  ADD COLUMN `verify_code_post_dropoff` VARCHAR(12) NULL AFTER `verify_code_pre_pickup`,
  ADD COLUMN `verify_code_post_pickup` VARCHAR(12) NULL AFTER `verify_code_post_dropoff`;

-- Some environments may still have a unique index on the legacy `verify_code`
-- It must be dropped to allow duplicates across different stage columns
ALTER TABLE `reservations` DROP INDEX `uq_reservations_verify`;

-- Optional: migrate existing single verify_code into the most common stage
-- (no-op if NULL). Here we copy legacy code to pre_dropoff when status matches
UPDATE `reservations`
SET `verify_code_pre_dropoff` = COALESCE(`verify_code_pre_dropoff`, `verify_code`)
WHERE `status` IN ('service_booking','pre_dropoff');

-- down (manual):
-- ALTER TABLE `reservations`
--   DROP COLUMN `verify_code_pre_dropoff`,
--   DROP COLUMN `verify_code_pre_pickup`,
--   DROP COLUMN `verify_code_post_dropoff`,
--   DROP COLUMN `verify_code_post_pickup`;
