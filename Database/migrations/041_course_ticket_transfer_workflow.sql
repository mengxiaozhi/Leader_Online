-- Upgrade course-ticket transfers from immediate handoff records to the
-- pending email/QR workflow used by regular tickets. Existing 039-era rows
-- represent completed transfers and are preserved as accepted history.
CREATE TABLE IF NOT EXISTS `course_ticket_transfers` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ticket_id` BIGINT UNSIGNED NOT NULL,
  `from_user_id` CHAR(36) NOT NULL,
  `to_user_id` CHAR(36) DEFAULT NULL,
  `from_email` VARCHAR(255) NOT NULL,
  `to_email` VARCHAR(255) DEFAULT NULL,
  `code` VARCHAR(32) DEFAULT NULL,
  `status` ENUM('pending','accepted','declined','canceled','expired') NOT NULL DEFAULT 'accepted',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_ticket_transfers_code` (`code`),
  KEY `idx_course_ticket_transfers_ticket` (`ticket_id`, `created_at`),
  KEY `idx_course_ticket_transfers_users` (`from_user_id`, `to_user_id`),
  KEY `idx_course_ticket_transfers_to_user` (`to_user_id`),
  KEY `idx_course_ticket_transfers_to_email` (`to_email`),
  KEY `idx_course_ticket_transfers_status` (`status`),
  CONSTRAINT `fk_course_ticket_transfers_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `course_tickets` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_ticket_transfers_from` FOREIGN KEY (`from_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_ticket_transfers_to` FOREIGN KEY (`to_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `course_ticket_transfers`
  MODIFY COLUMN `to_user_id` CHAR(36) NULL,
  MODIFY COLUMN `to_email` VARCHAR(255) NULL;

SET @course_transfer_code_exists = (
  SELECT COUNT(*)
  FROM `information_schema`.`COLUMNS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME` = 'course_ticket_transfers'
    AND `COLUMN_NAME` = 'code'
);
SET @course_transfer_code_sql = IF(
  @course_transfer_code_exists = 0,
  'ALTER TABLE `course_ticket_transfers` ADD COLUMN `code` VARCHAR(32) NULL AFTER `to_email`',
  'SELECT 1'
);
PREPARE course_transfer_code_statement FROM @course_transfer_code_sql;
EXECUTE course_transfer_code_statement;
DEALLOCATE PREPARE course_transfer_code_statement;

SET @course_transfer_status_exists = (
  SELECT COUNT(*)
  FROM `information_schema`.`COLUMNS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME` = 'course_ticket_transfers'
    AND `COLUMN_NAME` = 'status'
);
SET @course_transfer_status_sql = IF(
  @course_transfer_status_exists = 0,
  'ALTER TABLE `course_ticket_transfers` ADD COLUMN `status` ENUM(''pending'',''accepted'',''declined'',''canceled'',''expired'') NOT NULL DEFAULT ''accepted'' AFTER `code`',
  'SELECT 1'
);
PREPARE course_transfer_status_statement FROM @course_transfer_status_sql;
EXECUTE course_transfer_status_statement;
DEALLOCATE PREPARE course_transfer_status_statement;

-- Rows created before this migration were transferred immediately. The NULL
-- branch also repairs a previously interrupted version of this migration.
UPDATE `course_ticket_transfers`
SET `status` = 'accepted'
WHERE `id` >= 1
  AND `status` IS NULL;

-- New application versions write pending explicitly. Keep the omitted-value
-- default accepted so older instances can finish their immediate-transfer flow
-- safely during a rolling deployment.
ALTER TABLE `course_ticket_transfers`
  MODIFY COLUMN `status` ENUM('pending','accepted','declined','canceled','expired') NOT NULL DEFAULT 'accepted';

SET @course_transfer_updated_at_exists = (
  SELECT COUNT(*)
  FROM `information_schema`.`COLUMNS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME` = 'course_ticket_transfers'
    AND `COLUMN_NAME` = 'updated_at'
);
SET @course_transfer_updated_at_sql = IF(
  @course_transfer_updated_at_exists = 0,
  'ALTER TABLE `course_ticket_transfers` ADD COLUMN `updated_at` DATETIME NULL AFTER `created_at`',
  'SELECT 1'
);
PREPARE course_transfer_updated_at_statement FROM @course_transfer_updated_at_sql;
EXECUTE course_transfer_updated_at_statement;
DEALLOCATE PREPARE course_transfer_updated_at_statement;

-- Keep historical ordering stable instead of stamping old transfers with the
-- migration execution time.
UPDATE `course_ticket_transfers`
SET `updated_at` = `created_at`
WHERE `id` >= 1
  AND `updated_at` IS NULL;

ALTER TABLE `course_ticket_transfers`
  MODIFY COLUMN `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

SET @course_transfer_code_index_exists = (
  SELECT COUNT(*)
  FROM `information_schema`.`STATISTICS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME` = 'course_ticket_transfers'
    AND `INDEX_NAME` = 'uq_course_ticket_transfers_code'
);
SET @course_transfer_code_index_sql = IF(
  @course_transfer_code_index_exists = 0,
  'ALTER TABLE `course_ticket_transfers` ADD UNIQUE KEY `uq_course_ticket_transfers_code` (`code`)',
  'SELECT 1'
);
PREPARE course_transfer_code_index_statement FROM @course_transfer_code_index_sql;
EXECUTE course_transfer_code_index_statement;
DEALLOCATE PREPARE course_transfer_code_index_statement;

SET @course_transfer_to_user_index_exists = (
  SELECT COUNT(*)
  FROM `information_schema`.`STATISTICS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME` = 'course_ticket_transfers'
    AND `INDEX_NAME` = 'idx_course_ticket_transfers_to_user'
);
SET @course_transfer_to_user_index_sql = IF(
  @course_transfer_to_user_index_exists = 0,
  'ALTER TABLE `course_ticket_transfers` ADD KEY `idx_course_ticket_transfers_to_user` (`to_user_id`)',
  'SELECT 1'
);
PREPARE course_transfer_to_user_index_statement FROM @course_transfer_to_user_index_sql;
EXECUTE course_transfer_to_user_index_statement;
DEALLOCATE PREPARE course_transfer_to_user_index_statement;

SET @course_transfer_to_email_index_exists = (
  SELECT COUNT(*)
  FROM `information_schema`.`STATISTICS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME` = 'course_ticket_transfers'
    AND `INDEX_NAME` = 'idx_course_ticket_transfers_to_email'
);
SET @course_transfer_to_email_index_sql = IF(
  @course_transfer_to_email_index_exists = 0,
  'ALTER TABLE `course_ticket_transfers` ADD KEY `idx_course_ticket_transfers_to_email` (`to_email`)',
  'SELECT 1'
);
PREPARE course_transfer_to_email_index_statement FROM @course_transfer_to_email_index_sql;
EXECUTE course_transfer_to_email_index_statement;
DEALLOCATE PREPARE course_transfer_to_email_index_statement;

SET @course_transfer_status_index_exists = (
  SELECT COUNT(*)
  FROM `information_schema`.`STATISTICS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME` = 'course_ticket_transfers'
    AND `INDEX_NAME` = 'idx_course_ticket_transfers_status'
);
SET @course_transfer_status_index_sql = IF(
  @course_transfer_status_index_exists = 0,
  'ALTER TABLE `course_ticket_transfers` ADD KEY `idx_course_ticket_transfers_status` (`status`)',
  'SELECT 1'
);
PREPARE course_transfer_status_index_statement FROM @course_transfer_status_index_sql;
EXECUTE course_transfer_status_index_statement;
DEALLOCATE PREPARE course_transfer_status_index_statement;


CREATE TABLE IF NOT EXISTS `course_ticket_transfer_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `transfer_id` BIGINT UNSIGNED NOT NULL,
  `ticket_id` BIGINT UNSIGNED NOT NULL,
  `ticket_code` VARCHAR(40) DEFAULT NULL,
  `user_id` CHAR(36) NOT NULL,
  `from_user_id` CHAR(36) NOT NULL,
  `to_user_id` CHAR(36) DEFAULT NULL,
  `action` VARCHAR(32) NOT NULL,
  `method` VARCHAR(16) NOT NULL,
  `product_name` VARCHAR(255) NOT NULL,
  `from_email` VARCHAR(255) DEFAULT NULL,
  `to_email` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_transfer_log_event` (`transfer_id`, `user_id`, `action`),
  KEY `idx_course_transfer_logs_user_created` (`user_id`, `created_at`, `id`),
  KEY `idx_course_transfer_logs_ticket` (`ticket_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `course_ticket_transfer_logs`
  (`transfer_id`, `ticket_id`, `ticket_code`, `user_id`, `from_user_id`, `to_user_id`, `action`, `method`, `product_name`, `from_email`, `to_email`, `created_at`)
SELECT tr.`id`, tr.`ticket_id`, t.`code`, tr.`from_user_id`, tr.`from_user_id`, tr.`to_user_id`,
       'transferred_out', IF(tr.`code` IS NULL, 'email', 'qr'), p.`name`,
       tr.`from_email`, tr.`to_email`, tr.`created_at`
  FROM `course_ticket_transfers` tr
  JOIN `course_tickets` t ON t.`id` = tr.`ticket_id`
  JOIN `course_products` p ON p.`id` = t.`product_id`
 WHERE tr.`status` = 'accepted'
UNION ALL
SELECT tr.`id`, tr.`ticket_id`, t.`code`, tr.`to_user_id`, tr.`from_user_id`, tr.`to_user_id`,
       'transferred_in', IF(tr.`code` IS NULL, 'email', 'qr'), p.`name`,
       tr.`from_email`, tr.`to_email`, tr.`created_at`
  FROM `course_ticket_transfers` tr
  JOIN `course_tickets` t ON t.`id` = tr.`ticket_id`
  JOIN `course_products` p ON p.`id` = t.`product_id`
 WHERE tr.`status` = 'accepted' AND tr.`to_user_id` IS NOT NULL;
