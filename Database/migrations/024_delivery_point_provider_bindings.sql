-- Migration 024: delivery point provider binding requests and approvals
USE leader_online;

CREATE TABLE IF NOT EXISTS `delivery_point_provider_bindings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `delivery_point_id` INT UNSIGNED NOT NULL,
  `provider_user_id` CHAR(36) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  `requested_by_user_id` CHAR(36) NOT NULL,
  `responded_by_user_id` CHAR(36) NULL,
  `requested_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `responded_at` DATETIME NULL,
  `approved_at` DATETIME NULL,
  `rejected_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_delivery_point_provider_pair` (`delivery_point_id`, `provider_user_id`),
  KEY `idx_delivery_point_provider_status` (`delivery_point_id`, `status`),
  KEY `idx_provider_delivery_point_status` (`provider_user_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `delivery_point_provider_bindings` (
  `delivery_point_id`, `provider_user_id`, `status`, `requested_by_user_id`, `responded_by_user_id`,
  `requested_at`, `responded_at`, `approved_at`, `rejected_at`
)
SELECT
  dp.`id`,
  u.`provider_id`,
  'APPROVED',
  dp.`owner_user_id`,
  dp.`owner_user_id`,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  NULL
FROM `delivery_points` dp
JOIN `users` u ON u.`id` = dp.`owner_user_id`
WHERE UPPER(COALESCE(u.`role`, '')) = 'DELIVERY_POINT'
  AND u.`provider_id` IS NOT NULL
  AND u.`provider_id` <> ''
ON DUPLICATE KEY UPDATE
  `status` = 'APPROVED',
  `responded_by_user_id` = COALESCE(`responded_by_user_id`, VALUES(`responded_by_user_id`)),
  `responded_at` = COALESCE(`responded_at`, VALUES(`responded_at`)),
  `approved_at` = COALESCE(`approved_at`, VALUES(`approved_at`)),
  `rejected_at` = NULL,
  `updated_at` = CURRENT_TIMESTAMP;

SELECT 'Migration 024_delivery_point_provider_bindings applied' AS msg;
