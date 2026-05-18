USE leader_online;

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
