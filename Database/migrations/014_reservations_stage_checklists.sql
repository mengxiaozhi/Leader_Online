-- Reservations: add JSON columns to store stage checklists (pre/post pickup)
-- up
ALTER TABLE `reservations`
  ADD COLUMN `pre_pickup_checklist` JSON NULL AFTER `verify_code_post_pickup`,
  ADD COLUMN `post_pickup_checklist` JSON NULL AFTER `pre_pickup_checklist`;

-- Optional initialization: ensure new columns exist for legacy data
UPDATE `reservations`
SET
  `pre_pickup_checklist` = COALESCE(`pre_pickup_checklist`, JSON_OBJECT()),
  `post_pickup_checklist` = COALESCE(`post_pickup_checklist`, JSON_OBJECT());

-- down (manual):
-- ALTER TABLE `reservations`
--   DROP COLUMN `pre_pickup_checklist`,
--   DROP COLUMN `post_pickup_checklist`;
