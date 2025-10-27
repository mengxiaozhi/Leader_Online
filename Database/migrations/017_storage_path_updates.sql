-- Introduce storage_path metadata columns for file-based image persistence
-- up
ALTER TABLE `reservation_checklist_photos`
  ADD COLUMN `storage_path` VARCHAR(512) NULL AFTER `size`,
  ADD COLUMN `checksum` VARCHAR(128) NULL AFTER `storage_path`,
  MODIFY COLUMN `data` LONGBLOB NULL;

ALTER TABLE `events`
  ADD COLUMN `cover_path` VARCHAR(512) NULL AFTER `cover_data`;

ALTER TABLE `ticket_covers`
  ADD COLUMN `storage_path` VARCHAR(512) NULL AFTER `cover_type`,
  MODIFY COLUMN `cover_data` LONGBLOB NULL;

-- down (manual rollback required)
