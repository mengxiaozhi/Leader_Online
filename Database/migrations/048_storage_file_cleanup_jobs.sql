-- Migration 048: durable cleanup queue for private files removed with DB records

CREATE TABLE IF NOT EXISTS `storage_file_cleanup_jobs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `storage_path` VARCHAR(512) NOT NULL,
  `status` ENUM('pending','processing','completed') NOT NULL DEFAULT 'pending',
  `attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `available_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lease_owner` VARCHAR(128) DEFAULT NULL,
  `lease_expires_at` DATETIME DEFAULT NULL,
  `last_error_code` VARCHAR(64) DEFAULT NULL,
  `last_error_message` TEXT DEFAULT NULL,
  `completed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_storage_file_cleanup_path` (`storage_path`),
  KEY `idx_storage_file_cleanup_due` (`status`, `available_at`, `lease_expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Migration 048_storage_file_cleanup_jobs applied' AS msg;
