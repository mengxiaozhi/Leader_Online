-- Add BLOB-based cover storage for events
ALTER TABLE `events`
  ADD COLUMN `cover_type` varchar(100) NULL AFTER `cover`,
  ADD COLUMN `cover_data` LONGBLOB NULL AFTER `cover_type`;

