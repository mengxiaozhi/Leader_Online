-- Migration 023: collapse reservations to a single delivery-point/store binding
USE leader_online;

SET @has_pre_delivery_point := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'reservations' AND column_name = 'pre_delivery_point_id'
);
SET @has_post_delivery_point := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'reservations' AND column_name = 'post_delivery_point_id'
);
SET @has_pre_store := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'reservations' AND column_name = 'pre_store_id'
);
SET @has_post_store := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'reservations' AND column_name = 'post_store_id'
);

SET @store_expr := CASE
  WHEN @has_pre_store > 0 AND @has_post_store > 0 THEN 'COALESCE(`store_id`, `pre_store_id`, `post_store_id`)' 
  WHEN @has_pre_store > 0 THEN 'COALESCE(`store_id`, `pre_store_id`)' 
  WHEN @has_post_store > 0 THEN 'COALESCE(`store_id`, `post_store_id`)' 
  ELSE '`store_id`'
END;

SET @delivery_point_expr := CASE
  WHEN @has_pre_delivery_point > 0 AND @has_post_delivery_point > 0 THEN 'COALESCE(`delivery_point_id`, `pre_delivery_point_id`, `post_delivery_point_id`)' 
  WHEN @has_pre_delivery_point > 0 THEN 'COALESCE(`delivery_point_id`, `pre_delivery_point_id`)' 
  WHEN @has_post_delivery_point > 0 THEN 'COALESCE(`delivery_point_id`, `post_delivery_point_id`)' 
  ELSE '`delivery_point_id`'
END;

SET @ddl := CONCAT(
  'UPDATE `reservations` SET `store_id` = ', @store_expr,
  ', `delivery_point_id` = ', @delivery_point_expr,
  ' WHERE `id` > 0 AND (', @store_expr, ' IS NOT NULL OR ', @delivery_point_expr, ' IS NOT NULL);'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_pre_delivery_point := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'reservations' AND index_name = 'idx_reservations_pre_delivery_point'
);
SET @ddl := IF(
  @has_idx_pre_delivery_point > 0,
  'ALTER TABLE `reservations` DROP INDEX `idx_reservations_pre_delivery_point`;',
  'SELECT "idx_reservations_pre_delivery_point missing" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_post_delivery_point := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'reservations' AND index_name = 'idx_reservations_post_delivery_point'
);
SET @ddl := IF(
  @has_idx_post_delivery_point > 0,
  'ALTER TABLE `reservations` DROP INDEX `idx_reservations_post_delivery_point`;',
  'SELECT "idx_reservations_post_delivery_point missing" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_pre_store := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'reservations' AND index_name = 'idx_reservations_pre_store'
);
SET @ddl := IF(
  @has_idx_pre_store > 0,
  'ALTER TABLE `reservations` DROP INDEX `idx_reservations_pre_store`;',
  'SELECT "idx_reservations_pre_store missing" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_post_store := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'reservations' AND index_name = 'idx_reservations_post_store'
);
SET @ddl := IF(
  @has_idx_post_store > 0,
  'ALTER TABLE `reservations` DROP INDEX `idx_reservations_post_store`;',
  'SELECT "idx_reservations_post_store missing" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  @has_pre_delivery_point > 0,
  'ALTER TABLE `reservations` DROP COLUMN `pre_delivery_point_id`;',
  'SELECT "reservations.pre_delivery_point_id missing" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  @has_post_delivery_point > 0,
  'ALTER TABLE `reservations` DROP COLUMN `post_delivery_point_id`;',
  'SELECT "reservations.post_delivery_point_id missing" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  @has_pre_store > 0,
  'ALTER TABLE `reservations` DROP COLUMN `pre_store_id`;',
  'SELECT "reservations.pre_store_id missing" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  @has_post_store > 0,
  'ALTER TABLE `reservations` DROP COLUMN `post_store_id`;',
  'SELECT "reservations.post_store_id missing" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 023_single_delivery_point_model applied' AS msg;
