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
  `password_hash` VARCHAR(255) NOT NULL,
  `role` VARCHAR(20) NOT NULL DEFAULT 'USER',
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
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_events_time` (`starts_at`, `ends_at`),
  KEY `idx_events_code` (`code`),
  KEY `idx_events_owner` (`owner_user_id`),
  CONSTRAINT `fk_events_owner_user` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Event stores (truck tiers per event)
CREATE TABLE IF NOT EXISTS `event_stores` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id` INT UNSIGNED NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `address` VARCHAR(255) DEFAULT NULL,
  `external_url` VARCHAR(500) DEFAULT NULL,
  `business_hours` TEXT DEFAULT NULL,
  `pre_start` DATE DEFAULT NULL,
  `pre_end` DATE DEFAULT NULL,
  `post_start` DATE DEFAULT NULL,
  `post_end` DATE DEFAULT NULL,
  `prices` JSON NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_event_stores_event` (`event_id`),
  CONSTRAINT `fk_event_stores_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Store templates
CREATE TABLE IF NOT EXISTS `store_templates` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `address` VARCHAR(255) DEFAULT NULL,
  `external_url` VARCHAR(500) DEFAULT NULL,
  `business_hours` TEXT DEFAULT NULL,
  `pre_start` DATE DEFAULT NULL,
  `pre_end` DATE DEFAULT NULL,
  `post_start` DATE DEFAULT NULL,
  `post_end` DATE DEFAULT NULL,
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
  `price` DECIMAL(10,2) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_products_code` (`code`)
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

-- Tickets
CREATE TABLE IF NOT EXISTS `tickets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` CHAR(36) NOT NULL,
  `type` VARCHAR(50) NOT NULL,
  `expiry` DATE DEFAULT NULL,
  `uuid` CHAR(36) NOT NULL,
  `discount` INT NOT NULL DEFAULT 0,
  `used` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tickets_uuid` (`uuid`),
  KEY `idx_tickets_user` (`user_id`),
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

-- Reservations
CREATE TABLE IF NOT EXISTS `reservations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` CHAR(36) NOT NULL,
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
