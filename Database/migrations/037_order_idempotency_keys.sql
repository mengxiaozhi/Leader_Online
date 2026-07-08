-- Migration 037: persist order request idempotency keys to prevent duplicate checkout/reservation submits

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

SELECT 'Migration 037_order_idempotency_keys applied' AS msg;
