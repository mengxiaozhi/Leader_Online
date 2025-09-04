-- Ticket transfers: support email-initiated and QR in-person
-- up
CREATE TABLE IF NOT EXISTS `ticket_transfers` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ticket_id` BIGINT UNSIGNED NOT NULL,
  `from_user_id` CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `to_user_id` CHAR(36) COLLATE utf8mb4_unicode_ci NULL,
  `to_user_email` VARCHAR(255) COLLATE utf8mb4_unicode_ci NULL,
  `code` VARCHAR(32) COLLATE utf8mb4_unicode_ci NULL,
  `status` ENUM('pending','accepted','declined','canceled','expired') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ticket_transfers_code` (`code`),
  KEY `idx_ticket_transfers_ticket` (`ticket_id`),
  KEY `idx_ticket_transfers_to_user` (`to_user_id`),
  KEY `idx_ticket_transfers_to_email` (`to_user_email`),
  KEY `idx_ticket_transfers_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- down (manual)
-- DROP TABLE `ticket_transfers`;
