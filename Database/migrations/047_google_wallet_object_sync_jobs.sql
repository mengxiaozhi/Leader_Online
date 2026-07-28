-- Migration 047: durable, leased Google Wallet object synchronization outbox
--
-- Jobs are coalesced by object_id. Enqueuers must increment generation when
-- replacing a pending payload, and workers must include the claimed generation
-- and lease_owner when completing a job so an older attempt cannot overwrite a
-- newer desired object state.

CREATE TABLE IF NOT EXISTS `google_wallet_object_sync_jobs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `object_type` VARCHAR(32) NOT NULL DEFAULT 'generic',
  `resource_type` VARCHAR(32) NOT NULL,
  `resource_id` BIGINT UNSIGNED DEFAULT NULL,
  `holder_user_id` CHAR(36) DEFAULT NULL,
  `object_id` VARCHAR(255) NOT NULL,
  `action` ENUM('UPSERT','INACTIVATE') NOT NULL DEFAULT 'UPSERT',
  `payload` JSON NOT NULL,
  `generation` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `status` ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
  `attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `max_attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 8,
  `available_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lease_owner` VARCHAR(128) DEFAULT NULL,
  `lease_expires_at` DATETIME DEFAULT NULL,
  `last_error_code` VARCHAR(64) DEFAULT NULL,
  `last_error_message` TEXT DEFAULT NULL,
  `completed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_google_wallet_sync_object` (`object_id`),
  KEY `idx_google_wallet_sync_due` (`status`, `available_at`, `lease_expires_at`),
  KEY `idx_google_wallet_sync_lease` (`lease_expires_at`),
  KEY `idx_google_wallet_sync_resource` (`resource_type`, `resource_id`),
  KEY `idx_google_wallet_sync_holder` (`holder_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Migration 047_google_wallet_object_sync_jobs applied' AS msg;
