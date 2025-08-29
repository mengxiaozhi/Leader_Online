-- Add cover image URL column to events
ALTER TABLE `events`
  ADD COLUMN `cover` varchar(512) NULL AFTER `description`;

