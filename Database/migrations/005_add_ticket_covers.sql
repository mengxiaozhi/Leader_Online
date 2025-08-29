-- Ticket covers by type
CREATE TABLE IF NOT EXISTS `ticket_covers` (
  `type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `cover_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cover_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cover_data` LONGBLOB NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`type`),
  UNIQUE KEY `uniq_type` (`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

