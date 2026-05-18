-- Migration 022: event service prices and dual delivery-point reservations
USE leader_online;

CREATE TABLE IF NOT EXISTS `event_service_prices` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id` INT UNSIGNED NOT NULL,
  `type` VARCHAR(255) NOT NULL,
  `product_id` INT UNSIGNED NULL,
  `normal_price` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `early_price` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_event_service_prices_event_type` (`event_id`, `type`),
  KEY `idx_event_service_prices_product` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @has_pre_enabled := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'event_stores' AND column_name = 'pre_enabled'
);
SET @ddl := IF(
  @has_pre_enabled = 0,
  'ALTER TABLE `event_stores` ADD COLUMN `pre_enabled` TINYINT(1) NOT NULL DEFAULT 1 AFTER `remittance_bank_name`;',
  'SELECT "event_stores.pre_enabled already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_event_store_active := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'event_stores' AND column_name = 'is_active'
);
SET @ddl := IF(
  @has_event_store_active = 0,
  'ALTER TABLE `event_stores` ADD COLUMN `is_active` TINYINT(1) NOT NULL DEFAULT 1 AFTER `remittance_bank_name`;',
  'SELECT "event_stores.is_active already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_post_enabled := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'event_stores' AND column_name = 'post_enabled'
);
SET @ddl := IF(
  @has_post_enabled = 0,
  'ALTER TABLE `event_stores` ADD COLUMN `post_enabled` TINYINT(1) NOT NULL DEFAULT 1 AFTER `pre_end`;',
  'SELECT "event_stores.post_enabled already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE `event_stores`
SET `pre_enabled` = CASE
      WHEN `pre_start` IS NOT NULL OR `pre_end` IS NOT NULL THEN 1
      ELSE COALESCE(`pre_enabled`, 1)
    END,
    `post_enabled` = CASE
      WHEN `post_start` IS NOT NULL OR `post_end` IS NOT NULL THEN 1
      ELSE COALESCE(`post_enabled`, 1)
    END
WHERE `id` > 0
  AND (
    `pre_enabled` IS NULL
    OR `post_enabled` IS NULL
    OR `pre_start` IS NOT NULL
    OR `pre_end` IS NOT NULL
    OR `post_start` IS NOT NULL
    OR `post_end` IS NOT NULL
  );

SET @has_pre_delivery_point := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'reservations' AND column_name = 'pre_delivery_point_id'
);
SET @ddl := IF(
  @has_pre_delivery_point = 0,
  'ALTER TABLE `reservations` ADD COLUMN `pre_delivery_point_id` INT UNSIGNED NULL AFTER `delivery_point_id`;',
  'SELECT "reservations.pre_delivery_point_id already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_post_delivery_point := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'reservations' AND column_name = 'post_delivery_point_id'
);
SET @ddl := IF(
  @has_post_delivery_point = 0,
  'ALTER TABLE `reservations` ADD COLUMN `post_delivery_point_id` INT UNSIGNED NULL AFTER `pre_delivery_point_id`;',
  'SELECT "reservations.post_delivery_point_id already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_pre_store := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'reservations' AND column_name = 'pre_store_id'
);
SET @ddl := IF(
  @has_pre_store = 0,
  'ALTER TABLE `reservations` ADD COLUMN `pre_store_id` INT UNSIGNED NULL AFTER `store_id`;',
  'SELECT "reservations.pre_store_id already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_post_store := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'reservations' AND column_name = 'post_store_id'
);
SET @ddl := IF(
  @has_post_store = 0,
  'ALTER TABLE `reservations` ADD COLUMN `post_store_id` INT UNSIGNED NULL AFTER `pre_store_id`;',
  'SELECT "reservations.post_store_id already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_pre_delivery_point := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'reservations' AND index_name = 'idx_reservations_pre_delivery_point'
);
SET @ddl := IF(
  @has_idx_pre_delivery_point = 0,
  'ALTER TABLE `reservations` ADD INDEX `idx_reservations_pre_delivery_point` (`pre_delivery_point_id`);',
  'SELECT "idx_reservations_pre_delivery_point already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_post_delivery_point := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'reservations' AND index_name = 'idx_reservations_post_delivery_point'
);
SET @ddl := IF(
  @has_idx_post_delivery_point = 0,
  'ALTER TABLE `reservations` ADD INDEX `idx_reservations_post_delivery_point` (`post_delivery_point_id`);',
  'SELECT "idx_reservations_post_delivery_point already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_pre_store := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'reservations' AND index_name = 'idx_reservations_pre_store'
);
SET @ddl := IF(
  @has_idx_pre_store = 0,
  'ALTER TABLE `reservations` ADD INDEX `idx_reservations_pre_store` (`pre_store_id`);',
  'SELECT "idx_reservations_pre_store already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_post_store := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'reservations' AND index_name = 'idx_reservations_post_store'
);
SET @ddl := IF(
  @has_idx_post_store = 0,
  'ALTER TABLE `reservations` ADD INDEX `idx_reservations_post_store` (`post_store_id`);',
  'SELECT "idx_reservations_post_store already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE `reservations`
SET `pre_store_id` = COALESCE(`pre_store_id`, `store_id`),
    `post_store_id` = COALESCE(`post_store_id`, `store_id`),
    `pre_delivery_point_id` = COALESCE(`pre_delivery_point_id`, `delivery_point_id`),
    `post_delivery_point_id` = COALESCE(`post_delivery_point_id`, `delivery_point_id`)
WHERE `id` > 0
  AND (`store_id` IS NOT NULL OR `delivery_point_id` IS NOT NULL);

SET @has_task_stage := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'reservation_tasks' AND column_name = 'task_stage'
);
SET @ddl := IF(
  @has_task_stage = 0,
  'ALTER TABLE `reservation_tasks` ADD COLUMN `task_stage` VARCHAR(32) NOT NULL DEFAULT ''general'' AFTER `assignee_role`;',
  'SELECT "reservation_tasks.task_stage already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_task_store := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'reservation_tasks' AND column_name = 'store_id'
);
SET @ddl := IF(
  @has_task_store = 0,
  'ALTER TABLE `reservation_tasks` ADD COLUMN `store_id` INT UNSIGNED NULL AFTER `task_stage`;',
  'SELECT "reservation_tasks.store_id already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE `reservation_tasks`
SET `task_stage` = CASE
      WHEN `assignee_role` = 'DRIVER' THEN 'driver'
      ELSE 'general'
    END
WHERE `id` > 0
  AND (`task_stage` IS NULL OR `task_stage` = '');

SET @has_old_task_unique := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'reservation_tasks' AND index_name = 'uq_reservation_tasks_assignee'
);
SET @ddl := IF(
  @has_old_task_unique > 0,
  'ALTER TABLE `reservation_tasks` DROP INDEX `uq_reservation_tasks_assignee`;',
  'SELECT "reservation_tasks old unique index missing" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_new_task_unique := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'reservation_tasks' AND index_name = 'uq_reservation_tasks_assignee'
);
SET @ddl := IF(
  @has_new_task_unique = 0,
  'ALTER TABLE `reservation_tasks` ADD UNIQUE KEY `uq_reservation_tasks_assignee` (`reservation_id`, `assignee_user_id`, `assignee_role`, `task_stage`);',
  'SELECT "reservation_tasks new unique index already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_task_store_idx := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'reservation_tasks' AND index_name = 'idx_reservation_tasks_store'
);
SET @ddl := IF(
  @has_task_store_idx = 0,
  'ALTER TABLE `reservation_tasks` ADD KEY `idx_reservation_tasks_store` (`store_id`);',
  'SELECT "idx_reservation_tasks_store already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 022_event_service_prices_and_dual_delivery_points applied' AS msg;
