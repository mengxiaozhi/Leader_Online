-- Roles upgrade + event owner mapping
USE leader_online;

-- 1) Normalize users.role to new set (USER / STORE / ADMIN)
ALTER TABLE `users`
  MODIFY COLUMN `role` VARCHAR(20) NOT NULL DEFAULT 'USER';

UPDATE `users` SET `role` = 'ADMIN' WHERE `role` = 'admin';
UPDATE `users` SET `role` = 'USER' WHERE `role` IS NULL OR `role` = '' OR `role` = 'user';

-- 2) Add owner_user_id to events for STORE scoping
ALTER TABLE `events`
  ADD COLUMN `owner_user_id` CHAR(36) NULL AFTER `rules`;

-- Index + FK (optional; skip if you prefer no FK)
ALTER TABLE `events`
  ADD INDEX `idx_events_owner` (`owner_user_id`);
ALTER TABLE `events`
  ADD CONSTRAINT `fk_events_owner_user` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

SELECT 'Migration 006_roles_and_event_owner applied' AS msg;
