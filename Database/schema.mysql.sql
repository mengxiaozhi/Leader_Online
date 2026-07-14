-- Leader Online - Full schema (MySQL)
-- Generated from current code + migrations

CREATE DATABASE IF NOT EXISTS `leader_online` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `leader_online`;

SET NAMES utf8mb4;
SET time_zone = "+00:00";

-- Users
CREATE TABLE IF NOT EXISTS `users` (
  `id` CHAR(36) NOT NULL,
  `username` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `remittance_last5` CHAR(5) DEFAULT NULL,
  `remittance_info` TEXT DEFAULT NULL,
  `remittance_bank_code` VARCHAR(32) DEFAULT NULL,
  `remittance_bank_account` VARCHAR(64) DEFAULT NULL,
  `remittance_account_name` VARCHAR(64) DEFAULT NULL,
  `remittance_bank_name` VARCHAR(64) DEFAULT NULL,
  `service_terms` MEDIUMTEXT DEFAULT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` VARCHAR(20) NOT NULL DEFAULT 'USER',
  `is_vip` TINYINT(1) NOT NULL DEFAULT 0,
  `provider_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `idx_users_created_at` (`created_at`),
  KEY `idx_users_provider` (`provider_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Events (service windows)
CREATE TABLE IF NOT EXISTS `events` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) DEFAULT NULL,
  `title` VARCHAR(255) NOT NULL,
  `starts_at` DATETIME NOT NULL,
  `ends_at` DATETIME NOT NULL,
  `deadline` DATETIME DEFAULT NULL,
  `location` VARCHAR(255) DEFAULT NULL,
  `description` TEXT,
  `cover` VARCHAR(512) DEFAULT NULL,
  `cover_type` VARCHAR(100) DEFAULT NULL,
  `cover_data` LONGBLOB DEFAULT NULL,
  `cover_path` VARCHAR(512) DEFAULT NULL,
  `rules` JSON DEFAULT NULL,
  `owner_user_id` CHAR(36) DEFAULT NULL,
  `is_exclusive` TINYINT(1) NOT NULL DEFAULT 0,
  `listing_status` VARCHAR(16) NOT NULL DEFAULT 'published',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_events_time` (`starts_at`, `ends_at`),
  KEY `idx_events_code` (`code`),
  KEY `idx_events_owner` (`owner_user_id`),
  KEY `idx_events_exclusive_owner` (`is_exclusive`, `owner_user_id`),
  KEY `idx_events_listing_status` (`listing_status`),
  CONSTRAINT `fk_events_owner_user` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Event stores (truck tiers per event)
CREATE TABLE IF NOT EXISTS `event_stores` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id` INT UNSIGNED NOT NULL,
  `owner_user_id` CHAR(36) DEFAULT NULL,
  `delivery_point_id` INT UNSIGNED DEFAULT NULL,
  `name` VARCHAR(255) NOT NULL,
  `address` VARCHAR(255) DEFAULT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `external_url` VARCHAR(500) DEFAULT NULL,
  `business_hours` TEXT DEFAULT NULL,
  `capacity` INT UNSIGNED DEFAULT NULL,
  `remittance_info` TEXT DEFAULT NULL,
  `remittance_bank_code` VARCHAR(32) DEFAULT NULL,
  `remittance_bank_account` VARCHAR(64) DEFAULT NULL,
  `remittance_account_name` VARCHAR(64) DEFAULT NULL,
  `remittance_bank_name` VARCHAR(64) DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `pre_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `pre_start` DATE DEFAULT NULL,
  `pre_end` DATE DEFAULT NULL,
  `post_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `post_start` DATE DEFAULT NULL,
  `post_end` DATE DEFAULT NULL,
  `prices` JSON NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_event_stores_event` (`event_id`),
  KEY `idx_event_stores_owner` (`owner_user_id`),
  KEY `idx_event_stores_delivery_point` (`delivery_point_id`),
  CONSTRAINT `fk_event_stores_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Default driver per service provider and event
CREATE TABLE IF NOT EXISTS `event_driver_assignments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id` INT UNSIGNED NOT NULL,
  `provider_user_id` CHAR(36) NOT NULL,
  `driver_id` CHAR(36) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_event_driver_provider` (`event_id`, `provider_user_id`),
  KEY `idx_event_driver_assignments_provider` (`provider_user_id`),
  KEY `idx_event_driver_assignments_driver` (`driver_id`),
  CONSTRAINT `fk_event_driver_assignments_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Event service prices
CREATE TABLE IF NOT EXISTS `event_service_prices` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id` INT UNSIGNED NOT NULL,
  `type` VARCHAR(255) NOT NULL,
  `product_id` INT UNSIGNED DEFAULT NULL,
  `normal_price` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `early_price` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `early_start` DATETIME DEFAULT NULL,
  `early_end` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_event_service_prices_event_type` (`event_id`, `type`),
  KEY `idx_event_service_prices_product` (`product_id`),
  CONSTRAINT `fk_event_service_prices_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Delivery points
CREATE TABLE IF NOT EXISTS `delivery_points` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) DEFAULT NULL,
  `name` VARCHAR(255) NOT NULL,
  `address` VARCHAR(255) DEFAULT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `external_url` VARCHAR(500) DEFAULT NULL,
  `business_hours` TEXT DEFAULT NULL,
  `remittance_info` TEXT DEFAULT NULL,
  `remittance_bank_code` VARCHAR(32) DEFAULT NULL,
  `remittance_bank_account` VARCHAR(64) DEFAULT NULL,
  `remittance_account_name` VARCHAR(64) DEFAULT NULL,
  `remittance_bank_name` VARCHAR(64) DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_delivery_points_owner` (`owner_user_id`),
  KEY `idx_delivery_points_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Delivery point to provider bindings
CREATE TABLE IF NOT EXISTS `delivery_point_provider_bindings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `delivery_point_id` INT UNSIGNED NOT NULL,
  `provider_user_id` CHAR(36) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  `requested_by_user_id` CHAR(36) NOT NULL,
  `responded_by_user_id` CHAR(36) DEFAULT NULL,
  `requested_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `responded_at` DATETIME DEFAULT NULL,
  `approved_at` DATETIME DEFAULT NULL,
  `rejected_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_delivery_point_provider_pair` (`delivery_point_id`, `provider_user_id`),
  KEY `idx_delivery_point_provider_status` (`delivery_point_id`, `status`),
  KEY `idx_provider_delivery_point_status` (`provider_user_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Store templates
CREATE TABLE IF NOT EXISTS `store_templates` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `address` VARCHAR(255) DEFAULT NULL,
  `external_url` VARCHAR(500) DEFAULT NULL,
  `business_hours` TEXT DEFAULT NULL,
  `prices` TEXT DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Products
CREATE TABLE IF NOT EXISTS `products` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) DEFAULT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `cover_url` VARCHAR(512) DEFAULT NULL,
  `cover_type` VARCHAR(100) DEFAULT NULL,
  `cover_data` LONGBLOB DEFAULT NULL,
  `cover_path` VARCHAR(512) DEFAULT NULL,
  `price` DECIMAL(10,2) NOT NULL,
  `owner_user_id` CHAR(36) DEFAULT NULL,
  `listing_status` VARCHAR(16) NOT NULL DEFAULT 'published',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_products_code` (`code`),
  KEY `idx_products_owner` (`owner_user_id`),
  KEY `idx_products_listing_status` (`listing_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Orders
CREATE TABLE IF NOT EXISTS `orders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` CHAR(36) NOT NULL,
  `code` VARCHAR(14) DEFAULT NULL,
  `details` JSON DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  KEY `idx_orders_user` (`user_id`),
  CONSTRAINT `fk_orders_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `order_idempotency_keys` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` CHAR(36) NOT NULL,
  `request_key` VARCHAR(128) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'processing',
  `response_json` JSON DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_order_idempotency_user_key` (`user_id`, `request_key`),
  KEY `idx_order_idempotency_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tickets
CREATE TABLE IF NOT EXISTS `tickets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` CHAR(36) NOT NULL,
  `type` VARCHAR(50) NOT NULL,
  `product_id` INT UNSIGNED DEFAULT NULL,
  `expiry` DATE DEFAULT NULL,
  `uuid` CHAR(36) NOT NULL,
  `discount` INT NOT NULL DEFAULT 0,
  `used` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tickets_uuid` (`uuid`),
  KEY `idx_tickets_user` (`user_id`),
  KEY `idx_tickets_product` (`product_id`),
  CONSTRAINT `fk_tickets_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ticket covers
CREATE TABLE IF NOT EXISTS `ticket_covers` (
  `type` VARCHAR(100) NOT NULL,
  `cover_url` VARCHAR(512) DEFAULT NULL,
  `cover_type` VARCHAR(100) DEFAULT NULL,
  `storage_path` VARCHAR(512) DEFAULT NULL,
  `cover_data` LONGBLOB DEFAULT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`type`),
  UNIQUE KEY `uniq_type` (`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ticket transfers
CREATE TABLE IF NOT EXISTS `ticket_transfers` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ticket_id` BIGINT UNSIGNED NOT NULL,
  `from_user_id` CHAR(36) NOT NULL,
  `to_user_id` CHAR(36) DEFAULT NULL,
  `to_user_email` VARCHAR(255) DEFAULT NULL,
  `code` VARCHAR(32) DEFAULT NULL,
  `status` ENUM('pending','accepted','declined','canceled','expired') NOT NULL DEFAULT 'pending',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ticket_transfers_code` (`code`),
  KEY `idx_ticket_transfers_ticket` (`ticket_id`),
  KEY `idx_ticket_transfers_to_user` (`to_user_id`),
  KEY `idx_ticket_transfers_to_email` (`to_user_email`),
  KEY `idx_ticket_transfers_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reservation transfers
CREATE TABLE IF NOT EXISTS `reservation_transfers` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reservation_id` BIGINT UNSIGNED NOT NULL,
  `from_user_id` CHAR(36) NOT NULL,
  `to_user_id` CHAR(36) DEFAULT NULL,
  `to_user_email` VARCHAR(255) DEFAULT NULL,
  `code` VARCHAR(32) DEFAULT NULL,
  `status` ENUM('pending','accepted','declined','canceled','expired') NOT NULL DEFAULT 'pending',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reservation_transfers_code` (`code`),
  KEY `idx_reservation_transfers_reservation` (`reservation_id`),
  KEY `idx_reservation_transfers_from_user` (`from_user_id`),
  KEY `idx_reservation_transfers_to_user` (`to_user_id`),
  KEY `idx_reservation_transfers_to_email` (`to_user_email`),
  KEY `idx_reservation_transfers_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reservations
CREATE TABLE IF NOT EXISTS `reservations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` CHAR(36) NOT NULL,
  `order_id` BIGINT UNSIGNED DEFAULT NULL,
  `delivery_point_id` INT UNSIGNED DEFAULT NULL,
  `ticket_type` VARCHAR(50) NOT NULL,
  `event_id` INT UNSIGNED DEFAULT NULL,
  `store_id` INT UNSIGNED DEFAULT NULL,
  `driver_id` CHAR(36) DEFAULT NULL,
  `store` VARCHAR(100) NOT NULL,
  `event` VARCHAR(100) NOT NULL,
  `reserved_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `verify_code` VARCHAR(12) DEFAULT NULL,
  `verify_code_pre_dropoff` VARCHAR(12) DEFAULT NULL,
  `pre_dropoff_checklist` JSON DEFAULT NULL,
  `verify_code_pre_pickup` VARCHAR(12) DEFAULT NULL,
  `pre_pickup_checklist` JSON DEFAULT NULL,
  `verify_code_post_dropoff` VARCHAR(12) DEFAULT NULL,
  `post_dropoff_checklist` JSON DEFAULT NULL,
  `verify_code_post_pickup` VARCHAR(12) DEFAULT NULL,
  `post_pickup_checklist` JSON DEFAULT NULL,
  `status` ENUM('service_booking','pre_dropoff','pre_pickup','post_dropoff','post_pickup','done') NOT NULL DEFAULT 'service_booking',
  PRIMARY KEY (`id`),
  KEY `idx_reservations_user` (`user_id`),
  KEY `idx_reservations_order` (`order_id`),
  KEY `idx_reservations_delivery_point` (`delivery_point_id`),
  KEY `idx_reservations_event` (`event_id`),
  KEY `idx_reservations_store` (`store_id`),
  KEY `idx_reservations_driver` (`driver_id`),
  CONSTRAINT `fk_reservations_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reservation checklist photos
CREATE TABLE IF NOT EXISTS `reservation_checklist_photos` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reservation_id` BIGINT UNSIGNED NOT NULL,
  `stage` ENUM('pre_dropoff','pre_pickup','post_dropoff','post_pickup') NOT NULL,
  `mime` VARCHAR(64) NOT NULL,
  `original_name` VARCHAR(255) DEFAULT NULL,
  `size` INT UNSIGNED NOT NULL,
  `storage_path` VARCHAR(512) DEFAULT NULL,
  `checksum` VARCHAR(128) DEFAULT NULL,
  `data` LONGBLOB DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_reservation_stage` (`reservation_id`, `stage`),
  CONSTRAINT `fk_reservation_photo_reservation` FOREIGN KEY (`reservation_id`) REFERENCES `reservations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reservation assignments (driver history)
CREATE TABLE IF NOT EXISTS `reservation_assignments` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `reservation_id` BIGINT UNSIGNED NOT NULL,
  `driver_id` CHAR(36) DEFAULT NULL,
  `assigned_by` CHAR(36) DEFAULT NULL,
  `action` VARCHAR(32) NOT NULL DEFAULT 'assign',
  `note` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_res_assign_reservation` (`reservation_id`),
  KEY `idx_res_assign_driver` (`driver_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reservation tasks
CREATE TABLE IF NOT EXISTS `reservation_tasks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reservation_id` BIGINT UNSIGNED NOT NULL,
  `order_id` BIGINT UNSIGNED DEFAULT NULL,
  `assignee_user_id` CHAR(36) NOT NULL,
  `assignee_role` VARCHAR(32) NOT NULL,
  `task_stage` VARCHAR(32) NOT NULL DEFAULT 'general',
  `store_id` INT UNSIGNED DEFAULT NULL,
  `delivery_point_id` INT UNSIGNED DEFAULT NULL,
  `driver_id` CHAR(36) DEFAULT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  `completed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reservation_tasks_assignee` (`reservation_id`,`assignee_user_id`,`assignee_role`,`task_stage`),
  KEY `idx_reservation_tasks_assignee` (`assignee_user_id`,`assignee_role`,`task_stage`,`status`),
  KEY `idx_reservation_tasks_reservation` (`reservation_id`),
  KEY `idx_reservation_tasks_order` (`order_id`),
  KEY `idx_reservation_tasks_store` (`store_id`),
  KEY `idx_reservation_tasks_delivery_point` (`delivery_point_id`),
  KEY `idx_reservation_tasks_driver` (`driver_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- OAuth identities
CREATE TABLE IF NOT EXISTS `oauth_identities` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` CHAR(36) NOT NULL,
  `provider` VARCHAR(32) NOT NULL,
  `subject` VARCHAR(128) NOT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_provider_subject` (`provider`, `subject`),
  KEY `idx_oauth_user` (`user_id`),
  KEY `idx_oauth_provider_email` (`provider`, `email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Email verifications
CREATE TABLE IF NOT EXISTS `email_verifications` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `token` VARCHAR(128) DEFAULT NULL,
  `token_expiry` BIGINT UNSIGNED DEFAULT NULL,
  `verified` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_email_verifications_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Email change requests
CREATE TABLE IF NOT EXISTS `email_change_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` CHAR(36) NOT NULL,
  `new_email` VARCHAR(255) NOT NULL,
  `token` VARCHAR(128) NOT NULL,
  `token_expiry` BIGINT UNSIGNED DEFAULT NULL,
  `used` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_email_change_token` (`token`),
  UNIQUE KEY `uq_email_change_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Password resets
CREATE TABLE IF NOT EXISTS `password_resets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` CHAR(36) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `token` VARCHAR(128) NOT NULL,
  `token_expiry` BIGINT UNSIGNED DEFAULT NULL,
  `used` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_password_resets_token` (`token`),
  KEY `idx_password_resets_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- App settings
CREATE TABLE IF NOT EXISTS `app_settings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `key` VARCHAR(64) NOT NULL,
  `value` TEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_app_settings_key` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- User carts
CREATE TABLE IF NOT EXISTS `user_carts` (
  `user_id` CHAR(36) NOT NULL,
  `items` JSON NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_user_carts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ticket logs
CREATE TABLE IF NOT EXISTS `ticket_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ticket_id` BIGINT UNSIGNED NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  `meta` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ticket_logs_user` (`user_id`),
  KEY `idx_ticket_logs_ticket` (`ticket_id`),
  KEY `idx_ticket_logs_action` (`action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Account tombstones
CREATE TABLE IF NOT EXISTS `account_tombstones` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `provider` VARCHAR(32) DEFAULT NULL,
  `subject` VARCHAR(128) DEFAULT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `reason` VARCHAR(64) NOT NULL DEFAULT 'deleted',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tombstone_provider_subject` (`provider`, `subject`),
  KEY `idx_tombstone_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Course products, sessions, orders, class-count tickets, bookings and attendance
CREATE TABLE IF NOT EXISTS `course_products` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(40) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `category` VARCHAR(80) DEFAULT NULL,
  `summary` VARCHAR(500) DEFAULT NULL,
  `description` MEDIUMTEXT DEFAULT NULL,
  `cover_url` VARCHAR(1000) DEFAULT NULL,
  `price` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `class_count` INT UNSIGNED NOT NULL DEFAULT 1,
  `valid_days` INT UNSIGNED NOT NULL DEFAULT 120,
  `activation_days` INT UNSIGNED NOT NULL DEFAULT 120,
  `transferable` TINYINT(1) NOT NULL DEFAULT 0,
  `external_purchase_url` VARCHAR(1000) DEFAULT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_products_code` (`code`),
  KEY `idx_course_products_status_sort` (`status`, `sort_order`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(40) NOT NULL,
  `product_id` INT UNSIGNED DEFAULT NULL,
  `title` VARCHAR(255) NOT NULL,
  `coach_user_id` CHAR(36) DEFAULT NULL,
  `coach_name` VARCHAR(255) DEFAULT NULL,
  `location` VARCHAR(255) DEFAULT NULL,
  `starts_at` DATETIME NOT NULL,
  `ends_at` DATETIME NOT NULL,
  `booking_open_at` DATETIME DEFAULT NULL,
  `booking_close_at` DATETIME DEFAULT NULL,
  `capacity` INT UNSIGNED NOT NULL DEFAULT 20,
  `notes` TEXT DEFAULT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_sessions_code` (`code`),
  KEY `idx_course_sessions_time_status` (`starts_at`, `status`),
  KEY `idx_course_sessions_product` (`product_id`),
  KEY `idx_course_sessions_coach` (`coach_user_id`),
  CONSTRAINT `fk_course_sessions_product` FOREIGN KEY (`product_id`) REFERENCES `course_products` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_course_sessions_coach` FOREIGN KEY (`coach_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_orders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(40) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `buyer_name` VARCHAR(255) NOT NULL,
  `buyer_email` VARCHAR(255) NOT NULL,
  `product_id` INT UNSIGNED NOT NULL,
  `quantity` INT UNSIGNED NOT NULL DEFAULT 1,
  `unit_price` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `total_amount` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `remittance_last5` CHAR(5) DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `terms_accepted_at` DATETIME NOT NULL,
  `note` TEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_orders_code` (`code`),
  KEY `idx_course_orders_user_created` (`user_id`, `created_at`),
  KEY `idx_course_orders_status_created` (`status`, `created_at`),
  KEY `idx_course_orders_product` (`product_id`),
  CONSTRAINT `fk_course_orders_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_orders_product` FOREIGN KEY (`product_id`) REFERENCES `course_products` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_tickets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(40) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `owner_name` VARCHAR(255) DEFAULT NULL,
  `owner_email` VARCHAR(255) NOT NULL,
  `product_id` INT UNSIGNED NOT NULL,
  `order_id` BIGINT UNSIGNED DEFAULT NULL,
  `total_uses` INT UNSIGNED NOT NULL DEFAULT 1,
  `remaining_uses` INT UNSIGNED NOT NULL DEFAULT 1,
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `issued_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `activation_deadline` DATE DEFAULT NULL,
  `activated_at` DATETIME DEFAULT NULL,
  `expires_at` DATE DEFAULT NULL,
  `paused_at` DATETIME DEFAULT NULL,
  `pause_reason` VARCHAR(500) DEFAULT NULL,
  `transferable` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_tickets_code` (`code`),
  KEY `idx_course_tickets_user_status` (`user_id`, `status`),
  KEY `idx_course_tickets_product` (`product_id`),
  KEY `idx_course_tickets_order` (`order_id`),
  CONSTRAINT `fk_course_tickets_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_tickets_product` FOREIGN KEY (`product_id`) REFERENCES `course_products` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_tickets_order` FOREIGN KEY (`order_id`) REFERENCES `course_orders` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_bookings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `session_id` BIGINT UNSIGNED NOT NULL,
  `ticket_id` BIGINT UNSIGNED NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `attendee_name` VARCHAR(255) NOT NULL,
  `attendee_email` VARCHAR(255) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'booked',
  `booked_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cancelled_at` DATETIME DEFAULT NULL,
  `attended_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_booking_session_user` (`session_id`, `user_id`),
  KEY `idx_course_bookings_user_created` (`user_id`, `created_at`),
  KEY `idx_course_bookings_session_status` (`session_id`, `status`),
  KEY `idx_course_bookings_ticket` (`ticket_id`),
  CONSTRAINT `fk_course_bookings_session` FOREIGN KEY (`session_id`) REFERENCES `course_sessions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_course_bookings_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `course_tickets` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_bookings_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_attendance_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `session_id` BIGINT UNSIGNED NOT NULL,
  `booking_id` BIGINT UNSIGNED DEFAULT NULL,
  `ticket_id` BIGINT UNSIGNED NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `action` VARCHAR(24) NOT NULL DEFAULT 'redeem',
  `quantity` INT UNSIGNED NOT NULL DEFAULT 1,
  `staff_user_id` CHAR(36) NOT NULL,
  `note` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_course_attendance_session` (`session_id`, `created_at`),
  KEY `idx_course_attendance_ticket` (`ticket_id`, `created_at`),
  CONSTRAINT `fk_course_attendance_session` FOREIGN KEY (`session_id`) REFERENCES `course_sessions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_attendance_booking` FOREIGN KEY (`booking_id`) REFERENCES `course_bookings` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_course_attendance_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `course_tickets` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_attendance_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_attendance_staff` FOREIGN KEY (`staff_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_ticket_transfers` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ticket_id` BIGINT UNSIGNED NOT NULL,
  `from_user_id` CHAR(36) NOT NULL,
  `to_user_id` CHAR(36) NOT NULL,
  `from_email` VARCHAR(255) NOT NULL,
  `to_email` VARCHAR(255) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_course_ticket_transfers_ticket` (`ticket_id`, `created_at`),
  KEY `idx_course_ticket_transfers_users` (`from_user_id`, `to_user_id`),
  CONSTRAINT `fk_course_ticket_transfers_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `course_tickets` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_ticket_transfers_from` FOREIGN KEY (`from_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_ticket_transfers_to` FOREIGN KEY (`to_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
