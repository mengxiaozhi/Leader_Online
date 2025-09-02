-- Reservations: migrate 3 statuses to 6-stage workflow
-- Steps:
-- 1) Temporarily extend ENUM to include both old and new values
-- 2) Migrate existing rows: pending->pre_dropoff, pickup->pre_pickup
-- 3) Shrink ENUM to the final six values and set new default

-- 1) Extend ENUM (allow both old and new during transition)
ALTER TABLE `reservations`
  MODIFY COLUMN `status` ENUM(
    'pending',
    'pickup',
    'done',
    'service_booking',
    'pre_dropoff',
    'pre_pickup',
    'post_dropoff',
    'post_pickup'
  ) NOT NULL DEFAULT 'service_booking';

-- 2) Update existing data to new statuses
UPDATE `reservations` SET `status` = 'pre_dropoff' WHERE `status` = 'pending';
UPDATE `reservations` SET `status` = 'pre_pickup'  WHERE `status` = 'pickup';

-- 3) Finalize ENUM: only keep six-stage values and default
ALTER TABLE `reservations`
  MODIFY COLUMN `status` ENUM(
    'service_booking',
    'pre_dropoff',
    'pre_pickup',
    'post_dropoff',
    'post_pickup',
    'done'
  ) NOT NULL DEFAULT 'service_booking';

-- Done
SELECT 'Migration 005_reservations_six_stage_status applied' AS msg;

