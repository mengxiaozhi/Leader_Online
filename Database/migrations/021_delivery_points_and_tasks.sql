-- Migration 021: delivery points and reservation tasks
USE leader_online;

CREATE TABLE IF NOT EXISTS `delivery_points` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NULL,
  `name` VARCHAR(255) NOT NULL,
  `address` VARCHAR(255) NULL,
  `external_url` VARCHAR(500) NULL,
  `business_hours` TEXT NULL,
  `remittance_info` TEXT NULL,
  `remittance_bank_code` VARCHAR(32) NULL,
  `remittance_bank_account` VARCHAR(64) NULL,
  `remittance_account_name` VARCHAR(64) NULL,
  `remittance_bank_name` VARCHAR(64) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_delivery_points_owner` (`owner_user_id`),
  KEY `idx_delivery_points_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @has_es_delivery_point := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'event_stores'
    AND column_name = 'delivery_point_id'
);
SET @ddl := IF(
  @has_es_delivery_point = 0,
  'ALTER TABLE `event_stores` ADD COLUMN `delivery_point_id` INT UNSIGNED NULL AFTER `owner_user_id`;',
  'SELECT "event_stores.delivery_point_id already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_es_delivery_point_idx := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'event_stores'
    AND index_name = 'idx_event_stores_delivery_point'
);
SET @ddl := IF(
  @has_es_delivery_point_idx = 0,
  'ALTER TABLE `event_stores` ADD INDEX `idx_event_stores_delivery_point` (`delivery_point_id`);',
  'SELECT "idx_event_stores_delivery_point already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_res_delivery_point := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'reservations'
    AND column_name = 'delivery_point_id'
);
SET @ddl := IF(
  @has_res_delivery_point = 0,
  'ALTER TABLE `reservations` ADD COLUMN `delivery_point_id` INT UNSIGNED NULL AFTER `order_id`;',
  'SELECT "reservations.delivery_point_id already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_res_delivery_point_idx := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'reservations'
    AND index_name = 'idx_reservations_delivery_point'
);
SET @ddl := IF(
  @has_res_delivery_point_idx = 0,
  'ALTER TABLE `reservations` ADD INDEX `idx_reservations_delivery_point` (`delivery_point_id`);',
  'SELECT "idx_reservations_delivery_point already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `reservation_tasks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reservation_id` BIGINT UNSIGNED NOT NULL,
  `order_id` BIGINT UNSIGNED NULL,
  `assignee_user_id` CHAR(36) NOT NULL,
  `assignee_role` VARCHAR(32) NOT NULL,
  `delivery_point_id` INT UNSIGNED NULL,
  `driver_id` CHAR(36) NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  `completed_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reservation_tasks_assignee` (`reservation_id`, `assignee_user_id`, `assignee_role`),
  KEY `idx_reservation_tasks_assignee` (`assignee_user_id`, `assignee_role`, `status`),
  KEY `idx_reservation_tasks_reservation` (`reservation_id`),
  KEY `idx_reservation_tasks_order` (`order_id`),
  KEY `idx_reservation_tasks_delivery_point` (`delivery_point_id`),
  KEY `idx_reservation_tasks_driver` (`driver_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Migration 021_delivery_points_and_tasks applied' AS msg;
