-- Reservations: extend checklist support to dropoff stages
-- up
ALTER TABLE `reservations`
  ADD COLUMN `pre_dropoff_checklist` JSON NULL AFTER `verify_code_pre_dropoff`,
  ADD COLUMN `post_dropoff_checklist` JSON NULL AFTER `verify_code_post_dropoff`;

UPDATE `reservations`
SET
  `pre_dropoff_checklist` = COALESCE(`pre_dropoff_checklist`, JSON_OBJECT()),
  `post_dropoff_checklist` = COALESCE(`post_dropoff_checklist`, JSON_OBJECT()),
  `pre_pickup_checklist` = COALESCE(`pre_pickup_checklist`, JSON_OBJECT()),
  `post_pickup_checklist` = COALESCE(`post_pickup_checklist`, JSON_OBJECT());

ALTER TABLE `reservation_checklist_photos`
  MODIFY `stage` ENUM('pre_dropoff','pre_pickup','post_dropoff','post_pickup') NOT NULL;

-- down (manual):
-- ALTER TABLE `reservations`
--   DROP COLUMN `pre_dropoff_checklist`,
--   DROP COLUMN `post_dropoff_checklist`;
-- ALTER TABLE `reservation_checklist_photos`
--   MODIFY `stage` ENUM('pre_pickup','post_pickup') NOT NULL;
