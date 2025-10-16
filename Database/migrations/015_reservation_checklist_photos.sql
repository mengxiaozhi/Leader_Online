-- Reservation checklist photos stored as BLOBs
-- up
CREATE TABLE IF NOT EXISTS `reservation_checklist_photos` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reservation_id` BIGINT UNSIGNED NOT NULL,
  `stage` ENUM('pre_pickup','post_pickup') NOT NULL,
  `mime` VARCHAR(64) NOT NULL,
  `original_name` VARCHAR(255) DEFAULT NULL,
  `size` INT UNSIGNED NOT NULL,
  `data` LONGBLOB NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_reservation_stage` (`reservation_id`, `stage`),
  CONSTRAINT `fk_reservation_photo_reservation`
    FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- down (manual):
-- DROP TABLE IF EXISTS `reservation_checklist_photos`;
