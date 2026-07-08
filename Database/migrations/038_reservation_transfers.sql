-- Migration 038: reservation transfers

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

SELECT 'Migration 038_reservation_transfers applied' AS msg;
