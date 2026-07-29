-- Migration 049: normalized course count-card domain and GAS cutover staging.
--
-- Design invariants:
--   * course_products remains the backwards-compatible ShopProduct surface.
--   * course_usage_events is the immutable balance source of truth.
--   * remaining_uses / remaining_uses_cache are transactional read caches only.
--   * reservations and attendance invitations reserve uses through active holds.
--   * imported data is staged and reconciled before the one-time cutover marker
--     can be changed by the import CLI.
--
-- This migration is safe to rerun. Legacy backfills use deterministic source
-- keys and INSERT IGNORE; ALTER statements are guarded through INFORMATION_SCHEMA.
-- Run it in the course maintenance window: MySQL DDL commits implicitly and the
-- immutable-ledger triggers are dropped/recreated only after every backfill.

CREATE TABLE IF NOT EXISTS `course_schema_versions` (
  `version` VARCHAR(80) NOT NULL,
  `description` VARCHAR(255) NOT NULL,
  `applied_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Remove a marker left by an earlier complete revision before repairing/rechecking
-- every object. It is restored only at the very end.
DELETE FROM `course_schema_versions`
 WHERE `version` = '049_course_count_card_normalization';

CREATE TABLE IF NOT EXISTS `course_students` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) DEFAULT NULL,
  `tenant_key` CHAR(36) NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  `user_id` CHAR(36) DEFAULT NULL,
  `email` VARCHAR(255) NOT NULL,
  `email_normalized` VARCHAR(255) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(32) DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending_claim',
  `source_system` VARCHAR(32) NOT NULL DEFAULT 'leader',
  `source_id` VARCHAR(128) DEFAULT NULL,
  `claimed_at` DATETIME DEFAULT NULL,
  `metadata_json` JSON DEFAULT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_students_tenant_email` (`tenant_key`, `email_normalized`),
  UNIQUE KEY `uq_course_students_tenant_user` (`tenant_key`, `user_id`),
  UNIQUE KEY `uq_course_students_source` (`source_system`, `source_id`),
  KEY `idx_course_students_owner_status` (`owner_user_id`, `status`, `id`),
  KEY `idx_course_students_user` (`user_id`),
  CONSTRAINT `fk_course_students_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_students_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_ticket_products` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) DEFAULT NULL,
  `code` VARCHAR(64) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `class_count` INT UNSIGNED NOT NULL DEFAULT 1,
  `valid_days` INT UNSIGNED NOT NULL DEFAULT 120,
  `activation_days` INT UNSIGNED NOT NULL DEFAULT 120,
  `transferable` TINYINT(1) NOT NULL DEFAULT 0,
  `max_transfers` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `terms_text` MEDIUMTEXT DEFAULT NULL,
  `redemption_policy_json` JSON DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'draft',
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_ticket_products_code` (`code`),
  KEY `idx_course_ticket_products_owner_status` (`owner_user_id`, `status`, `id`),
  CONSTRAINT `fk_course_ticket_products_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Guarded ALTER helpers are dropped at the end of this migration.
DROP PROCEDURE IF EXISTS `course_049_add_column`;
DELIMITER $$
CREATE PROCEDURE `course_049_add_column`(
  IN p_table_name VARCHAR(64),
  IN p_column_name VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND COLUMN_NAME = p_column_name
  ) THEN
    SET @course_049_column_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD COLUMN `', REPLACE(p_column_name, '`', '``'), '` ',
      p_definition
    );
    PREPARE course_049_column_stmt FROM @course_049_column_sql;
    EXECUTE course_049_column_stmt;
    DEALLOCATE PREPARE course_049_column_stmt;
  END IF;
END$$
DELIMITER ;

CALL `course_049_add_column`('course_products', 'ticket_product_id', 'BIGINT UNSIGNED NULL AFTER `owner_user_id`');
CALL `course_049_add_column`('course_products', 'returning_student_only', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `transferable`');
CALL `course_049_add_column`('course_products', 'require_addon_for_new', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `returning_student_only`');
CALL `course_049_add_column`('course_products', 'row_version', 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER `sort_order`');

CALL `course_049_add_column`('course_orders', 'student_id', 'BIGINT UNSIGNED NULL AFTER `user_id`');
CALL `course_049_add_column`('course_orders', 'row_version', 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER `note`');

CALL `course_049_add_column`('course_sessions', 'scenario_id', 'BIGINT UNSIGNED NULL AFTER `product_id`');
CALL `course_049_add_column`('course_sessions', 'coach_profile_id', 'BIGINT UNSIGNED NULL AFTER `coach_user_id`');
CALL `course_049_add_column`('course_sessions', 'booking_open_minutes_before', 'INT UNSIGNED NULL AFTER `booking_close_at`');
CALL `course_049_add_column`('course_sessions', 'booking_close_minutes_before', 'INT UNSIGNED NULL AFTER `booking_open_minutes_before`');
CALL `course_049_add_column`('course_sessions', 'cancel_close_minutes_before', 'INT UNSIGNED NULL AFTER `booking_close_minutes_before`');
CALL `course_049_add_column`('course_sessions', 'redeem_open_at', 'DATETIME NULL AFTER `cancel_close_minutes_before`');
CALL `course_049_add_column`('course_sessions', 'redeem_close_at', 'DATETIME NULL AFTER `redeem_open_at`');
CALL `course_049_add_column`('course_sessions', 'redeem_open_minutes_before', 'INT UNSIGNED NULL AFTER `redeem_close_at`');
CALL `course_049_add_column`('course_sessions', 'redeem_close_minutes_after', 'INT UNSIGNED NULL AFTER `redeem_open_minutes_before`');
CALL `course_049_add_column`('course_sessions', 'settings_snapshot_json', 'JSON NULL AFTER `notes`');
CALL `course_049_add_column`('course_sessions', 'row_version', 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER `status`');

CALL `course_049_add_column`('course_tickets', 'student_id', 'BIGINT UNSIGNED NULL AFTER `user_id`');
CALL `course_049_add_column`('course_tickets', 'ticket_product_id', 'BIGINT UNSIGNED NULL AFTER `product_id`');
CALL `course_049_add_column`('course_tickets', 'order_item_id', 'BIGINT UNSIGNED NULL AFTER `order_id`');
CALL `course_049_add_column`('course_tickets', 'product_code_snapshot', 'VARCHAR(64) NULL AFTER `order_item_id`');
CALL `course_049_add_column`('course_tickets', 'product_name_snapshot', 'VARCHAR(255) NULL AFTER `product_code_snapshot`');
CALL `course_049_add_column`('course_tickets', 'product_class_count_snapshot', 'INT UNSIGNED NULL AFTER `product_name_snapshot`');
CALL `course_049_add_column`('course_tickets', 'product_valid_days_snapshot', 'INT UNSIGNED NULL AFTER `product_class_count_snapshot`');
CALL `course_049_add_column`('course_tickets', 'product_activation_days_snapshot', 'INT UNSIGNED NULL AFTER `product_valid_days_snapshot`');
CALL `course_049_add_column`('course_tickets', 'product_transferable_snapshot', 'TINYINT(1) NULL AFTER `product_activation_days_snapshot`');
CALL `course_049_add_column`('course_tickets', 'product_max_transfers_snapshot', 'SMALLINT UNSIGNED NULL AFTER `product_transferable_snapshot`');
CALL `course_049_add_column`('course_tickets', 'product_terms_snapshot', 'MEDIUMTEXT NULL AFTER `product_max_transfers_snapshot`');
CALL `course_049_add_column`('course_tickets', 'product_redemption_policy_snapshot', 'JSON NULL AFTER `product_terms_snapshot`');
CALL `course_049_add_column`('course_tickets', 'provider_user_id_snapshot', 'CHAR(36) NULL AFTER `product_redemption_policy_snapshot`');
CALL `course_049_add_column`('course_tickets', 'provider_name_snapshot', 'VARCHAR(255) NULL AFTER `provider_user_id_snapshot`');
CALL `course_049_add_column`('course_tickets', 'remaining_uses_cache', 'INT NOT NULL DEFAULT 0 AFTER `remaining_uses`');
CALL `course_049_add_column`('course_tickets', 'frozen_at', 'DATETIME NULL AFTER `paused_at`');
CALL `course_049_add_column`('course_tickets', 'freeze_reason', 'VARCHAR(500) NULL AFTER `frozen_at`');
CALL `course_049_add_column`('course_tickets', 'row_version', 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER `transferable`');

CALL `course_049_add_column`('course_bookings', 'resolution_reason', 'VARCHAR(500) NULL AFTER `attended_at`');
CALL `course_049_add_column`('course_bookings', 'student_id', 'BIGINT UNSIGNED NULL AFTER `user_id`');
CALL `course_049_add_column`('course_bookings', 'student_identity_conflict_key', 'VARCHAR(191) NULL AFTER `student_id`');
CALL `course_049_add_column`('course_bookings', 'row_version', 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER `resolution_reason`');

CALL `course_049_add_column`('course_request_idempotency_keys', 'resource_type', 'VARCHAR(64) NULL AFTER `operation`');
CALL `course_049_add_column`('course_request_idempotency_keys', 'resource_id', 'BIGINT UNSIGNED NULL AFTER `resource_type`');
CALL `course_049_add_column`('course_request_idempotency_keys', 'expires_at', 'DATETIME NULL AFTER `response_json`');
CALL `course_049_add_column`('course_request_idempotency_keys', 'row_version', 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER `expires_at`');

-- A GAS student or a no-ticket NO_SHOW may not have a Leader account/ticket yet.
-- Existing rows remain valid while these two legacy foreign keys become nullable.
DROP PROCEDURE IF EXISTS `course_049_make_nullable`;
DELIMITER $$
CREATE PROCEDURE `course_049_make_nullable`(
  IN p_table_name VARCHAR(64),
  IN p_column_name VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF EXISTS (
    SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND COLUMN_NAME = p_column_name
       AND IS_NULLABLE = 'NO'
  ) THEN
    SET @course_049_nullable_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` MODIFY COLUMN `', REPLACE(p_column_name, '`', '``'), '` ',
      p_definition
    );
    PREPARE course_049_nullable_stmt FROM @course_049_nullable_sql;
    EXECUTE course_049_nullable_stmt;
    DEALLOCATE PREPARE course_049_nullable_stmt;
  END IF;
END$$
DELIMITER ;

CALL `course_049_make_nullable`('course_bookings', 'ticket_id', 'BIGINT UNSIGNED NULL');
CALL `course_049_make_nullable`('course_bookings', 'user_id', 'CHAR(36) NULL');
CALL `course_049_make_nullable`('course_tickets', 'user_id', 'CHAR(36) NULL');
CALL `course_049_make_nullable`('course_tickets', 'product_id', 'INT UNSIGNED NULL');
CALL `course_049_make_nullable`('course_attendance_logs', 'user_id', 'CHAR(36) NULL');
CALL `course_049_make_nullable`('course_orders', 'user_id', 'CHAR(36) NULL');
CALL `course_049_make_nullable`('course_orders', 'product_id', 'INT UNSIGNED NULL');

-- TicketProduct is backfilled one-to-one from the legacy ShopProduct. Keeping
-- the numeric ID makes reconciliation deterministic and preserves product IDs.
INSERT IGNORE INTO `course_ticket_products` (
  `id`, `owner_user_id`, `code`, `name`, `description`, `class_count`,
  `valid_days`, `activation_days`, `transferable`, `max_transfers`,
  `status`, `created_at`, `updated_at`
)
SELECT
  p.`id`, p.`owner_user_id`, p.`code`, p.`name`, p.`description`, p.`class_count`,
  p.`valid_days`, p.`activation_days`, p.`transferable`, 1,
  p.`status`, p.`created_at`, p.`updated_at`
FROM `course_products` p;

UPDATE `course_products`
   SET `ticket_product_id` = `id`
 WHERE `id` >= 1
   AND `ticket_product_id` IS NULL;

CREATE TABLE IF NOT EXISTS `course_shop_product_components` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `shop_product_id` INT UNSIGNED NOT NULL,
  `ticket_product_id` BIGINT UNSIGNED NOT NULL,
  `component_role` VARCHAR(24) NOT NULL DEFAULT 'primary',
  `quantity` INT UNSIGNED NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_shop_component` (`shop_product_id`, `ticket_product_id`, `component_role`),
  KEY `idx_course_shop_components_ticket_product` (`ticket_product_id`),
  CONSTRAINT `fk_course_shop_components_shop` FOREIGN KEY (`shop_product_id`) REFERENCES `course_products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_course_shop_components_ticket` FOREIGN KEY (`ticket_product_id`) REFERENCES `course_ticket_products` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `course_shop_product_components` (
  `shop_product_id`, `ticket_product_id`, `component_role`, `quantity`, `sort_order`
)
SELECT p.`id`, p.`ticket_product_id`, 'primary', 1, 0
  FROM `course_products` p
 WHERE p.`ticket_product_id` IS NOT NULL;

CREATE TABLE IF NOT EXISTS `course_product_returning_requirements` (
  `product_id` INT UNSIGNED NOT NULL,
  `qualifying_ticket_product_id` BIGINT UNSIGNED NOT NULL,
  `lookback_days` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`product_id`, `qualifying_ticket_product_id`),
  KEY `idx_course_returning_requirement_ticket` (`qualifying_ticket_product_id`),
  CONSTRAINT `fk_course_returning_requirement_product` FOREIGN KEY (`product_id`) REFERENCES `course_products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_course_returning_requirement_ticket` FOREIGN KEY (`qualifying_ticket_product_id`) REFERENCES `course_ticket_products` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_product_required_addons` (
  `product_id` INT UNSIGNED NOT NULL,
  `addon_product_id` INT UNSIGNED NOT NULL,
  `quantity` INT UNSIGNED NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`product_id`, `addon_product_id`),
  KEY `idx_course_required_addons_addon` (`addon_product_id`),
  CONSTRAINT `fk_course_required_addons_product` FOREIGN KEY (`product_id`) REFERENCES `course_products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_course_required_addons_addon` FOREIGN KEY (`addon_product_id`) REFERENCES `course_products` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_order_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT UNSIGNED NOT NULL,
  `shop_product_id` INT UNSIGNED DEFAULT NULL,
  `ticket_product_id` BIGINT UNSIGNED DEFAULT NULL,
  `item_type` VARCHAR(24) NOT NULL DEFAULT 'primary',
  `line_identity_key` VARCHAR(191) GENERATED ALWAYS AS (
    CONCAT_WS(':', `item_type`, COALESCE(`shop_product_id`, 0), COALESCE(`ticket_product_id`, 0))
  ) STORED,
  `item_code_snapshot` VARCHAR(64) NOT NULL,
  `item_name_snapshot` VARCHAR(255) NOT NULL,
  `quantity` INT UNSIGNED NOT NULL DEFAULT 1,
  `unit_price` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `line_total` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `issuance_status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `metadata_json` JSON DEFAULT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_order_items_line_identity` (`order_id`, `line_identity_key`),
  KEY `idx_course_order_items_ticket_product` (`ticket_product_id`),
  KEY `idx_course_order_items_status` (`issuance_status`, `id`),
  CONSTRAINT `fk_course_order_items_order` FOREIGN KEY (`order_id`) REFERENCES `course_orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_course_order_items_shop_product` FOREIGN KEY (`shop_product_id`) REFERENCES `course_products` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_order_items_ticket_product` FOREIGN KEY (`ticket_product_id`) REFERENCES `course_ticket_products` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL `course_049_add_column`(
  'course_order_items',
  'line_identity_key',
  'VARCHAR(191) GENERATED ALWAYS AS (CONCAT_WS('':'', `item_type`, COALESCE(`shop_product_id`, 0), COALESCE(`ticket_product_id`, 0))) STORED AFTER `item_type`'
);

INSERT IGNORE INTO `course_order_items` (
  `id`, `order_id`, `shop_product_id`, `ticket_product_id`, `item_type`,
  `item_code_snapshot`, `item_name_snapshot`, `quantity`, `unit_price`,
  `line_total`, `issuance_status`, `created_at`, `updated_at`
)
SELECT
  o.`id`, o.`id`, o.`product_id`, p.`ticket_product_id`, 'primary',
  p.`code`, p.`name`, o.`quantity`, o.`unit_price`, o.`total_amount`,
  CASE
    WHEN (
      SELECT COUNT(*)
        FROM `course_tickets` issued_ticket
       WHERE issued_ticket.`order_id` = o.`id`
         AND issued_ticket.`product_id` = o.`product_id`
    ) >= o.`quantity`
    THEN 'issued'
    ELSE 'pending'
  END,
  o.`created_at`, o.`updated_at`
FROM `course_orders` o
JOIN `course_products` p ON p.`id` = o.`product_id`;

CREATE TABLE IF NOT EXISTS `course_redeem_scenarios` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) DEFAULT NULL,
  `code` VARCHAR(64) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `redeem_open_minutes_before` INT UNSIGNED DEFAULT NULL,
  `redeem_close_minutes_after` INT UNSIGNED DEFAULT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_redeem_scenarios_code` (`code`),
  KEY `idx_course_redeem_scenarios_owner_status` (`owner_user_id`, `status`, `id`),
  CONSTRAINT `fk_course_redeem_scenarios_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `course_redeem_scenarios` (
  `owner_user_id`, `code`, `name`, `description`, `status`
)
VALUES (
  NULL, 'PLATFORM-DEFAULT', '平台預設核銷情境',
  '未指定票券限制的相容情境；時間窗仍由統一設定解析器決定。', 'active'
);

INSERT IGNORE INTO `course_redeem_scenarios` (
  `owner_user_id`, `code`, `name`, `description`, `status`
)
SELECT
  p.`owner_user_id`, CONCAT('LEGACY-', p.`code`), CONCAT(p.`name`, '相容情境'),
  '由 migration 049 依既有單一商品場次關聯建立。', 'active'
FROM `course_products` p;

CREATE TABLE IF NOT EXISTS `course_scenario_allowed_products` (
  `scenario_id` BIGINT UNSIGNED NOT NULL,
  `ticket_product_id` BIGINT UNSIGNED NOT NULL,
  `priority` INT UNSIGNED NOT NULL DEFAULT 100,
  `redeem_open_minutes_before` INT UNSIGNED DEFAULT NULL,
  `redeem_close_minutes_after` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`scenario_id`, `ticket_product_id`),
  KEY `idx_course_scenario_allowed_priority` (`scenario_id`, `priority`, `ticket_product_id`),
  KEY `idx_course_scenario_allowed_ticket` (`ticket_product_id`),
  CONSTRAINT `fk_course_scenario_allowed_scenario` FOREIGN KEY (`scenario_id`) REFERENCES `course_redeem_scenarios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_course_scenario_allowed_ticket` FOREIGN KEY (`ticket_product_id`) REFERENCES `course_ticket_products` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `course_scenario_allowed_products` (
  `scenario_id`, `ticket_product_id`, `priority`
)
SELECT s.`id`, p.`ticket_product_id`, 100
  FROM `course_products` p
  JOIN `course_redeem_scenarios` s ON s.`code` = CONCAT('LEGACY-', p.`code`)
 WHERE p.`ticket_product_id` IS NOT NULL;

INSERT IGNORE INTO `course_scenario_allowed_products` (
  `scenario_id`, `ticket_product_id`, `priority`
)
SELECT s.`id`, tp.`id`, 1000
  FROM `course_redeem_scenarios` s
  CROSS JOIN `course_ticket_products` tp
 WHERE s.`code` = 'PLATFORM-DEFAULT';

UPDATE `course_sessions` cs
JOIN `course_products` p ON p.`id` = cs.`product_id`
JOIN `course_redeem_scenarios` s ON s.`code` = CONCAT('LEGACY-', p.`code`)
   SET cs.`scenario_id` = s.`id`
 WHERE cs.`id` >= 1
   AND cs.`scenario_id` IS NULL;

UPDATE `course_sessions` cs
JOIN `course_redeem_scenarios` s ON s.`code` = 'PLATFORM-DEFAULT'
   SET cs.`scenario_id` = s.`id`
 WHERE cs.`id` >= 1
   AND cs.`scenario_id` IS NULL;

CREATE TABLE IF NOT EXISTS `course_settings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scope_key` VARCHAR(80) NOT NULL,
  `scope` VARCHAR(24) NOT NULL,
  `owner_user_id` CHAR(36) DEFAULT NULL,
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Taipei',
  `booking_open_minutes_before` INT UNSIGNED NOT NULL DEFAULT 43200,
  `booking_close_minutes_before` INT UNSIGNED NOT NULL DEFAULT 0,
  `cancel_close_minutes_before` INT UNSIGNED NOT NULL DEFAULT 0,
  `redeem_open_minutes_before` INT UNSIGNED NOT NULL DEFAULT 120,
  `redeem_close_minutes_after` INT UNSIGNED NOT NULL DEFAULT 1440,
  `attendance_invite_expires_minutes` INT UNSIGNED NOT NULL DEFAULT 1440,
  `auto_no_show` TINYINT(1) NOT NULL DEFAULT 0,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_settings_scope_key` (`scope_key`),
  KEY `idx_course_settings_owner` (`owner_user_id`),
  CONSTRAINT `fk_course_settings_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `course_settings` (
  `scope_key`, `scope`, `owner_user_id`, `timezone`,
  `booking_open_minutes_before`, `booking_close_minutes_before`,
  `cancel_close_minutes_before`, `redeem_open_minutes_before`,
  `redeem_close_minutes_after`, `attendance_invite_expires_minutes`,
  `auto_no_show`
)
VALUES (
  'platform', 'platform', NULL, 'Asia/Taipei',
  43200, 0, 0, 120, 1440, 1440, 0
);

INSERT IGNORE INTO `course_settings` (
  `scope_key`, `scope`, `owner_user_id`, `timezone`,
  `booking_open_minutes_before`, `booking_close_minutes_before`,
  `cancel_close_minutes_before`, `redeem_open_minutes_before`,
  `redeem_close_minutes_after`, `attendance_invite_expires_minutes`,
  `auto_no_show`
)
SELECT
  CONCAT('provider:', owners.`owner_user_id`),
  'provider',
  owners.`owner_user_id`,
  platform.`timezone`,
  platform.`booking_open_minutes_before`,
  platform.`booking_close_minutes_before`,
  platform.`cancel_close_minutes_before`,
  platform.`redeem_open_minutes_before`,
  platform.`redeem_close_minutes_after`,
  platform.`attendance_invite_expires_minutes`,
  platform.`auto_no_show`
FROM (
  SELECT `owner_user_id` FROM `course_products` WHERE `owner_user_id` IS NOT NULL
  UNION
  SELECT `owner_user_id` FROM `course_sessions` WHERE `owner_user_id` IS NOT NULL
) owners
JOIN `course_settings` platform ON platform.`scope_key` = 'platform';

CREATE TABLE IF NOT EXISTS `course_staff_memberships` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `role` VARCHAR(24) NOT NULL,
  `capabilities_json` JSON DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_staff_membership` (`owner_user_id`, `user_id`),
  KEY `idx_course_staff_user_status` (`user_id`, `status`, `id`),
  CONSTRAINT `fk_course_staff_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_course_staff_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_coach_profiles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `user_id` CHAR(36) DEFAULT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `phone` VARCHAR(32) DEFAULT NULL,
  `bio` TEXT DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_coach_owner_code` (`owner_user_id`, `code`),
  UNIQUE KEY `uq_course_coach_owner_user` (`owner_user_id`, `user_id`),
  KEY `idx_course_coach_owner_status` (`owner_user_id`, `status`, `id`),
  CONSTRAINT `fk_course_coach_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_course_coach_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL `course_049_add_column`('course_coach_profiles', 'code', 'VARCHAR(64) NULL AFTER `owner_user_id`');
UPDATE `course_coach_profiles`
   SET `code` = CONCAT('LEGACY-', `id`)
 WHERE `id` >= 1
   AND (`code` IS NULL OR TRIM(`code`) = '');
SET @course_049_coach_code_nullable := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'course_coach_profiles'
     AND COLUMN_NAME = 'code'
     AND IS_NULLABLE = 'YES'
);
SET @course_049_coach_code_sql := IF(
  @course_049_coach_code_nullable > 0,
  'ALTER TABLE `course_coach_profiles` MODIFY COLUMN `code` VARCHAR(64) NOT NULL',
  'SELECT 1'
);
PREPARE course_049_coach_code_stmt FROM @course_049_coach_code_sql;
EXECUTE course_049_coach_code_stmt;
DEALLOCATE PREPARE course_049_coach_code_stmt;

-- MySQL forbids CASCADE/SET NULL actions when the FK column is an input to a
-- STORED generated column. The booking/invite identity links below therefore
-- preserve history with RESTRICT and are released through explicit state updates.
CREATE TABLE IF NOT EXISTS `course_ticket_holds` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ticket_id` BIGINT UNSIGNED NOT NULL,
  `booking_id` BIGINT UNSIGNED DEFAULT NULL,
  `invite_id` BIGINT UNSIGNED DEFAULT NULL,
  `quantity` INT UNSIGNED NOT NULL DEFAULT 1,
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `expires_at` DATETIME DEFAULT NULL,
  `released_at` DATETIME DEFAULT NULL,
  `release_reason` VARCHAR(64) DEFAULT NULL,
  `released_by_user_id` CHAR(36) DEFAULT NULL,
  `consumed_at` DATETIME DEFAULT NULL,
  `consumed_usage_event_id` BIGINT UNSIGNED DEFAULT NULL,
  `active_booking_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` = 'active' THEN `booking_id` ELSE NULL END
  ) STORED,
  `active_invite_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` = 'active' THEN `invite_id` ELSE NULL END
  ) STORED,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_ticket_holds_active_booking` (`active_booking_id`),
  UNIQUE KEY `uq_course_ticket_holds_active_invite` (`active_invite_id`),
  KEY `idx_course_ticket_holds_ticket_status` (`ticket_id`, `status`, `expires_at`),
  CONSTRAINT `fk_course_ticket_holds_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `course_tickets` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_ticket_holds_booking` FOREIGN KEY (`booking_id`) REFERENCES `course_bookings` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_ticket_holds_released_by` FOREIGN KEY (`released_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_attendance_invites` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) DEFAULT NULL,
  `session_id` BIGINT UNSIGNED NOT NULL,
  `booking_id` BIGINT UNSIGNED DEFAULT NULL,
  `student_id` BIGINT UNSIGNED DEFAULT NULL,
  `user_id` CHAR(36) DEFAULT NULL,
  `ticket_id` BIGINT UNSIGNED DEFAULT NULL,
  `hold_id` BIGINT UNSIGNED DEFAULT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `expires_at` DATETIME NOT NULL,
  `auto_redeem_at` DATETIME DEFAULT NULL,
  `confirmed_at` DATETIME DEFAULT NULL,
  `redeemed_usage_event_id` BIGINT UNSIGNED DEFAULT NULL,
  `note` VARCHAR(500) DEFAULT NULL,
  `active_user_id` CHAR(36) GENERATED ALWAYS AS (
    CASE WHEN `status` = 'pending' THEN `user_id` ELSE NULL END
  ) STORED,
  `active_student_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` = 'pending' THEN `student_id` ELSE NULL END
  ) STORED,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_attendance_invite_token` (`token_hash`),
  UNIQUE KEY `uq_course_attendance_invite_active_user` (`session_id`, `active_user_id`),
  UNIQUE KEY `uq_course_attendance_invite_active_student` (`session_id`, `active_student_id`),
  KEY `idx_course_attendance_invites_status_due` (`status`, `auto_redeem_at`, `expires_at`),
  KEY `idx_course_attendance_invites_booking` (`booking_id`),
  KEY `idx_course_attendance_invites_student` (`student_id`, `created_at`),
  CONSTRAINT `fk_course_attendance_invites_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_attendance_invites_session` FOREIGN KEY (`session_id`) REFERENCES `course_sessions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_attendance_invites_booking` FOREIGN KEY (`booking_id`) REFERENCES `course_bookings` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_course_attendance_invites_student` FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_attendance_invites_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_attendance_invites_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `course_tickets` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_attendance_invites_hold` FOREIGN KEY (`hold_id`) REFERENCES `course_ticket_holds` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_usage_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ticket_id` BIGINT UNSIGNED DEFAULT NULL,
  `student_id` BIGINT UNSIGNED DEFAULT NULL,
  `user_id` CHAR(36) DEFAULT NULL,
  `session_id` BIGINT UNSIGNED DEFAULT NULL,
  `booking_id` BIGINT UNSIGNED DEFAULT NULL,
  `invite_id` BIGINT UNSIGNED DEFAULT NULL,
  `event_type` VARCHAR(48) NOT NULL,
  `delta_uses` INT NOT NULL,
  `balance_after` INT DEFAULT NULL,
  `source_type` VARCHAR(48) NOT NULL,
  `source_id` VARCHAR(128) DEFAULT NULL,
  `reverses_event_id` BIGINT UNSIGNED DEFAULT NULL,
  `command_id` BIGINT UNSIGNED DEFAULT NULL,
  `idempotency_key` VARCHAR(128) DEFAULT NULL,
  `is_anomaly` TINYINT(1) NOT NULL DEFAULT 0,
  `occurred_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actor_user_id` CHAR(36) DEFAULT NULL,
  `note` VARCHAR(500) DEFAULT NULL,
  `metadata_json` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_usage_source` (`source_type`, `source_id`, `event_type`),
  UNIQUE KEY `uq_course_usage_reversal` (`reverses_event_id`),
  KEY `idx_course_usage_command` (`command_id`),
  KEY `idx_course_usage_idempotency` (`idempotency_key`),
  KEY `idx_course_usage_ticket_time` (`ticket_id`, `occurred_at`, `id`),
  KEY `idx_course_usage_booking` (`booking_id`, `id`),
  KEY `idx_course_usage_session_type` (`session_id`, `event_type`, `occurred_at`),
  KEY `idx_course_usage_anomaly` (`is_anomaly`, `occurred_at`, `id`),
  CONSTRAINT `fk_course_usage_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `course_tickets` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_usage_student` FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_usage_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_usage_session` FOREIGN KEY (`session_id`) REFERENCES `course_sessions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_usage_booking` FOREIGN KEY (`booking_id`) REFERENCES `course_bookings` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_usage_invite` FOREIGN KEY (`invite_id`) REFERENCES `course_attendance_invites` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_usage_reversal` FOREIGN KEY (`reverses_event_id`) REFERENCES `course_usage_events` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_usage_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A repair rerun may already have the immutable triggers from a prior complete
-- run. Drop them before the one permitted migration-time balance_after repair.
DROP TRIGGER IF EXISTS `course_usage_events_no_update`;
DROP TRIGGER IF EXISTS `course_usage_events_no_delete`;

-- Repair-safe additions for an interrupted earlier execution of this migration.
CALL `course_049_add_column`('course_ticket_holds', 'released_by_user_id', 'CHAR(36) NULL AFTER `release_reason`');
CALL `course_049_add_column`('course_ticket_holds', 'consumed_usage_event_id', 'BIGINT UNSIGNED NULL AFTER `consumed_at`');
CALL `course_049_add_column`(
  'course_ticket_holds',
  'active_booking_id',
  'BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN `status` = ''active'' THEN `booking_id` ELSE NULL END) STORED'
);
CALL `course_049_add_column`(
  'course_ticket_holds',
  'active_invite_id',
  'BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN `status` = ''active'' THEN `invite_id` ELSE NULL END) STORED'
);
CALL `course_049_add_column`('course_attendance_invites', 'booking_id', 'BIGINT UNSIGNED NULL AFTER `session_id`');
CALL `course_049_add_column`(
  'course_attendance_invites',
  'active_user_id',
  'CHAR(36) GENERATED ALWAYS AS (CASE WHEN `status` = ''pending'' THEN `user_id` ELSE NULL END) STORED'
);
CALL `course_049_add_column`(
  'course_attendance_invites',
  'active_student_id',
  'BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN `status` = ''pending'' THEN `student_id` ELSE NULL END) STORED'
);

SET @course_049_usage_source_is_varchar := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'course_usage_events'
     AND COLUMN_NAME = 'source_id'
     AND DATA_TYPE = 'varchar'
);
SET @course_049_usage_source_sql := IF(
  @course_049_usage_source_is_varchar = 0,
  'ALTER TABLE `course_usage_events` MODIFY COLUMN `source_id` VARCHAR(128) NULL',
  'SELECT 1'
);
PREPARE course_049_usage_source_stmt FROM @course_049_usage_source_sql;
EXECUTE course_049_usage_source_stmt;
DEALLOCATE PREPARE course_049_usage_source_stmt;

CREATE TABLE IF NOT EXISTS `course_ticket_state_periods` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ticket_id` BIGINT UNSIGNED NOT NULL,
  `state` VARCHAR(24) NOT NULL,
  `started_at` DATETIME NOT NULL,
  `ended_at` DATETIME DEFAULT NULL,
  `extension_days` INT UNSIGNED NOT NULL DEFAULT 0,
  `reason` VARCHAR(500) DEFAULT NULL,
  `actor_user_id` CHAR(36) DEFAULT NULL,
  `metadata_json` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_course_ticket_state_periods_active` (`ticket_id`, `state`, `ended_at`),
  CONSTRAINT `fk_course_ticket_state_periods_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `course_tickets` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_ticket_state_periods_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_mutation_commands` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `actor_user_id` CHAR(36) NOT NULL,
  `operation` VARCHAR(64) NOT NULL,
  `idempotency_key` VARCHAR(128) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `resource_type` VARCHAR(64) DEFAULT NULL,
  `resource_id` BIGINT UNSIGNED DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'processing',
  `response_json` JSON DEFAULT NULL,
  `expires_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_mutation_actor_operation_key` (`actor_user_id`, `operation`, `idempotency_key`),
  KEY `idx_course_mutation_status_updated` (`status`, `updated_at`, `id`),
  CONSTRAINT `fk_course_mutation_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL `course_049_add_column`(
  'course_usage_events',
  'command_id',
  'BIGINT UNSIGNED NULL AFTER `reverses_event_id`'
);

-- Deterministic legacy student linkage. Imported GAS students without a Leader
-- account use the same table with user_id NULL until verified-email claim.
INSERT IGNORE INTO `course_students` (
  `owner_user_id`, `tenant_key`, `user_id`, `email`, `email_normalized`,
  `display_name`, `status`, `source_system`, `source_id`, `claimed_at`
)
SELECT DISTINCT
  p.`owner_user_id`,
  COALESCE(p.`owner_user_id`, '00000000-0000-0000-0000-000000000000'),
  t.`user_id`,
  MIN(t.`owner_email`),
  LOWER(TRIM(t.`owner_email`)),
  MIN(COALESCE(NULLIF(TRIM(t.`owner_name`), ''), u.`username`, t.`owner_email`)),
  'active',
  'leader',
  CONCAT('user:', t.`user_id`, ':tenant:', COALESCE(p.`owner_user_id`, 'platform')),
  MIN(t.`issued_at`)
FROM `course_tickets` t
JOIN `course_products` p ON p.`id` = t.`product_id`
LEFT JOIN `users` u ON u.`id` = t.`user_id`
GROUP BY
  p.`owner_user_id`,
  COALESCE(p.`owner_user_id`, '00000000-0000-0000-0000-000000000000'),
  t.`user_id`,
  LOWER(TRIM(t.`owner_email`));

-- Complete ticket snapshot/link backfill before writing immutable ledger rows.
UPDATE `course_tickets` t
JOIN `course_products` p ON p.`id` = t.`product_id`
LEFT JOIN `course_ticket_products` tp ON tp.`id` = p.`ticket_product_id`
LEFT JOIN `users` provider ON provider.`id` = p.`owner_user_id`
LEFT JOIN `course_students` st
  ON st.`tenant_key` = COALESCE(p.`owner_user_id`, '00000000-0000-0000-0000-000000000000')
 AND st.`user_id` = t.`user_id`
LEFT JOIN `course_order_items` oi
  ON oi.`order_id` = t.`order_id`
 AND oi.`item_type` = 'primary'
 AND oi.`shop_product_id` = t.`product_id`
   SET t.`student_id` = COALESCE(t.`student_id`, st.`id`),
       t.`ticket_product_id` = COALESCE(t.`ticket_product_id`, p.`ticket_product_id`),
       t.`order_item_id` = COALESCE(t.`order_item_id`, oi.`id`),
       t.`product_code_snapshot` = COALESCE(t.`product_code_snapshot`, p.`code`),
       t.`product_name_snapshot` = COALESCE(t.`product_name_snapshot`, p.`name`),
       t.`product_class_count_snapshot` = COALESCE(t.`product_class_count_snapshot`, t.`total_uses`, p.`class_count`),
       t.`product_valid_days_snapshot` = COALESCE(t.`product_valid_days_snapshot`, p.`valid_days`),
       t.`product_activation_days_snapshot` = COALESCE(t.`product_activation_days_snapshot`, p.`activation_days`),
       t.`product_transferable_snapshot` = COALESCE(t.`product_transferable_snapshot`, t.`transferable`, p.`transferable`),
       t.`product_max_transfers_snapshot` = COALESCE(t.`product_max_transfers_snapshot`, 1),
       t.`product_redemption_policy_snapshot` = COALESCE(
         t.`product_redemption_policy_snapshot`,
         tp.`redemption_policy_json`
       ),
       t.`provider_user_id_snapshot` = COALESCE(t.`provider_user_id_snapshot`, p.`owner_user_id`),
       t.`provider_name_snapshot` = COALESCE(
         t.`provider_name_snapshot`,
         provider.`username`,
         CASE WHEN p.`owner_user_id` IS NULL THEN 'LEADER' ELSE NULL END
       ),
       t.`remaining_uses_cache` = t.`remaining_uses`
 WHERE t.`id` >= 1;

UPDATE `course_bookings` b
LEFT JOIN `course_tickets` t ON t.`id` = b.`ticket_id`
   SET b.`student_id` = COALESCE(b.`student_id`, t.`student_id`)
 WHERE b.`id` >= 1
   AND b.`student_id` IS NULL
   AND NOT EXISTS (
     SELECT 1
       FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'course_bookings'
        AND INDEX_NAME = 'uq_course_bookings_session_student'
   );

UPDATE `course_orders` o
JOIN `course_products` p ON p.`id` = o.`product_id`
LEFT JOIN `course_students` st
  ON st.`tenant_key` = COALESCE(p.`owner_user_id`, '00000000-0000-0000-0000-000000000000')
 AND st.`user_id` = o.`user_id`
   SET o.`student_id` = COALESCE(o.`student_id`, st.`id`)
 WHERE o.`id` >= 1
   AND o.`student_id` IS NULL;

-- Positive issuance, negative legacy SUCCESS, and zero-use NO_SHOW audit.
INSERT IGNORE INTO `course_usage_events` (
  `ticket_id`, `student_id`, `user_id`, `event_type`, `delta_uses`,
  `balance_after`, `source_type`, `source_id`, `occurred_at`, `note`,
  `metadata_json`
)
SELECT
  t.`id`, t.`student_id`, t.`user_id`, 'ISSUANCE', t.`total_uses`,
  t.`total_uses`, 'legacy_ticket', t.`id`, t.`issued_at`,
  'Migration 049 legacy ticket issuance backfill.',
  JSON_OBJECT('legacyProductId', t.`product_id`)
FROM `course_tickets` t;

INSERT IGNORE INTO `course_usage_events` (
  `ticket_id`, `student_id`, `user_id`, `session_id`, `booking_id`,
  `event_type`, `delta_uses`, `source_type`, `source_id`, `occurred_at`,
  `actor_user_id`, `note`, `metadata_json`
)
SELECT
  l.`ticket_id`, t.`student_id`, l.`user_id`, l.`session_id`, l.`booking_id`,
  'SUCCESS', -CAST(l.`quantity` AS SIGNED), 'legacy_attendance_log', l.`id`,
  l.`created_at`, l.`staff_user_id`,
  'Migration 049 legacy attended/redeem backfill.',
  JSON_OBJECT('legacyAction', l.`action`)
FROM `course_attendance_logs` l
JOIN `course_tickets` t ON t.`id` = l.`ticket_id`
WHERE l.`action` = 'redeem';

INSERT IGNORE INTO `course_usage_events` (
  `ticket_id`, `student_id`, `user_id`, `session_id`, `booking_id`,
  `event_type`, `delta_uses`, `source_type`, `source_id`, `occurred_at`,
  `is_anomaly`, `note`, `metadata_json`
)
SELECT
  b.`ticket_id`, t.`student_id`, b.`user_id`, b.`session_id`, b.`id`,
  'NO_SHOW', 0, 'legacy_booking_no_show', b.`id`, COALESCE(b.`updated_at`, b.`created_at`),
  1,
  'Legacy NO_SHOW changed RSVP only; retained as zero-use anomaly pending manual review.',
  JSON_OBJECT('requiresReview', TRUE, 'legacyStatus', b.`status`)
FROM `course_bookings` b
JOIN `course_tickets` t ON t.`id` = b.`ticket_id`
WHERE b.`status` = 'no_show';

-- If historical direct edits or incomplete logs made the ledger differ from the
-- stored remaining count, preserve the visible balance with an explicit event.
INSERT IGNORE INTO `course_usage_events` (
  `ticket_id`, `student_id`, `user_id`, `event_type`, `delta_uses`,
  `balance_after`, `source_type`, `source_id`, `occurred_at`,
  `is_anomaly`, `note`, `metadata_json`
)
SELECT
  t.`id`, t.`student_id`, t.`user_id`, 'LEGACY_BALANCE_RECONCILIATION',
  CAST(t.`remaining_uses` AS SIGNED) -
    (CAST(t.`total_uses` AS SIGNED) - COALESCE(a.`redeemed_uses`, 0)),
  t.`remaining_uses`, 'legacy_balance', t.`id`, t.`updated_at`,
  1,
  'Explicit reconciliation preserves legacy remaining_uses; review before cutover.',
  JSON_OBJECT(
    'legacyRemainingUses', t.`remaining_uses`,
    'legacyTotalUses', t.`total_uses`,
    'loggedRedeemedUses', COALESCE(a.`redeemed_uses`, 0)
  )
FROM `course_tickets` t
LEFT JOIN (
  SELECT `ticket_id`, SUM(`quantity`) AS `redeemed_uses`
    FROM `course_attendance_logs`
   WHERE `action` = 'redeem'
   GROUP BY `ticket_id`
) a ON a.`ticket_id` = t.`id`
WHERE CAST(t.`remaining_uses` AS SIGNED) <>
      (CAST(t.`total_uses` AS SIGNED) - COALESCE(a.`redeemed_uses`, 0));

-- Every ticket event carries its historical running balance. Runtime code maps
-- this value directly, so NULL would silently render as a false zero balance.
UPDATE `course_usage_events` event_row
JOIN (
  SELECT
    `id`,
    SUM(`delta_uses`) OVER (
      PARTITION BY `ticket_id`
      ORDER BY `occurred_at`, `id`
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS `running_balance`
  FROM `course_usage_events`
  WHERE `ticket_id` IS NOT NULL
) running ON running.`id` = event_row.`id`
   SET event_row.`balance_after` = running.`running_balance`
 WHERE event_row.`id` >= 1;

UPDATE `course_tickets` t
LEFT JOIN (
  SELECT `ticket_id`, SUM(`delta_uses`) AS `ledger_balance`
    FROM `course_usage_events`
   WHERE `ticket_id` IS NOT NULL
   GROUP BY `ticket_id`
) e ON e.`ticket_id` = t.`id`
   SET t.`remaining_uses_cache` = COALESCE(e.`ledger_balance`, 0)
 WHERE t.`id` >= 1;

-- Existing active bookings become one-use holds only while the legacy remaining
-- balance can cover them. Deterministic overflow bookings remain booked but are
-- emitted as zero-use anomalies for blocking reconciliation; availableUses
-- never becomes negative merely because the migration ran.
INSERT IGNORE INTO `course_ticket_holds` (
  `ticket_id`, `booking_id`, `quantity`, `status`, `created_at`, `updated_at`
)
SELECT b.`ticket_id`, b.`id`, 1, 'active', b.`booked_at`, b.`updated_at`
 FROM `course_bookings` b
  JOIN `course_tickets` t ON t.`id` = b.`ticket_id`
 WHERE b.`status` = 'booked'
   AND b.`ticket_id` IS NOT NULL
   AND (
     SELECT COUNT(*)
       FROM `course_bookings` earlier
      WHERE earlier.`ticket_id` = b.`ticket_id`
        AND earlier.`status` = 'booked'
        AND (
          earlier.`booked_at` < b.`booked_at`
          OR (earlier.`booked_at` = b.`booked_at` AND earlier.`id` <= b.`id`)
        )
   ) <= t.`remaining_uses`;

INSERT IGNORE INTO `course_usage_events` (
  `ticket_id`, `student_id`, `user_id`, `session_id`, `booking_id`,
  `event_type`, `delta_uses`, `source_type`, `source_id`, `occurred_at`,
  `is_anomaly`, `note`, `metadata_json`
)
SELECT
  b.`ticket_id`, t.`student_id`, b.`user_id`, b.`session_id`, b.`id`,
  'LEGACY_UNHELD_BOOKING', 0, 'legacy_unheld_booking', b.`id`, b.`booked_at`,
  1,
  'Booked reservation exceeded the legacy available balance and was not given a hold.',
  JSON_OBJECT('requiresReview', TRUE, 'legacyRemainingUses', t.`remaining_uses`)
FROM `course_bookings` b
JOIN `course_tickets` t ON t.`id` = b.`ticket_id`
LEFT JOIN `course_ticket_holds` h
  ON h.`booking_id` = b.`id`
 AND h.`status` = 'active'
WHERE b.`status` = 'booked'
  AND h.`id` IS NULL;

INSERT INTO `course_ticket_state_periods` (
  `ticket_id`, `state`, `started_at`, `reason`, `metadata_json`
)
SELECT
  t.`id`, 'paused', t.`paused_at`, t.`pause_reason`,
  JSON_OBJECT('source', 'legacy_ticket')
FROM `course_tickets` t
WHERE t.`paused_at` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
      FROM `course_ticket_state_periods` existing
     WHERE existing.`ticket_id` = t.`id`
       AND existing.`state` = 'paused'
       AND existing.`started_at` = t.`paused_at`
       AND JSON_UNQUOTE(JSON_EXTRACT(existing.`metadata_json`, '$.source')) = 'legacy_ticket'
  );

-- Import/cutover audit model. No imported row mutates live course data until a
-- reconciled run is explicitly applied by the cutover command.
CREATE TABLE IF NOT EXISTS `course_import_runs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_key` CHAR(36) NOT NULL,
  `source_system` VARCHAR(32) NOT NULL DEFAULT 'gas',
  `mode` VARCHAR(24) NOT NULL DEFAULT 'rehearsal',
  `status` VARCHAR(24) NOT NULL DEFAULT 'validating',
  `source_contract_version` VARCHAR(80) NOT NULL,
  `snapshot_hash` CHAR(64) NOT NULL,
  `started_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finished_at` DATETIME DEFAULT NULL,
  `created_by_user_id` CHAR(36) DEFAULT NULL,
  `summary_json` JSON DEFAULT NULL,
  `error_json` JSON DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_import_runs_key` (`run_key`),
  UNIQUE KEY `uq_course_import_runs_snapshot_mode` (`snapshot_hash`, `mode`),
  KEY `idx_course_import_runs_status_started` (`status`, `started_at`, `id`),
  CONSTRAINT `fk_course_import_runs_creator` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_import_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id` BIGINT UNSIGNED NOT NULL,
  `dataset_name` VARCHAR(64) NOT NULL,
  `row_count` INT UNSIGNED NOT NULL,
  `content_hash` CHAR(64) NOT NULL,
  `source_metadata_json` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_import_snapshot_dataset` (`run_id`, `dataset_name`),
  KEY `idx_course_import_snapshots_hash` (`content_hash`),
  CONSTRAINT `fk_course_import_snapshots_run` FOREIGN KEY (`run_id`) REFERENCES `course_import_runs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_import_staging_rows` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id` BIGINT UNSIGNED NOT NULL,
  `dataset_name` VARCHAR(64) NOT NULL,
  `source_id` VARCHAR(128) NOT NULL,
  `source_code` VARCHAR(128) DEFAULT NULL,
  `row_hash` CHAR(64) NOT NULL,
  `payload_json` JSON NOT NULL,
  `validation_status` VARCHAR(24) NOT NULL DEFAULT 'valid',
  `validation_errors_json` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_import_staging_source` (`run_id`, `dataset_name`, `source_id`),
  KEY `idx_course_import_staging_code` (`dataset_name`, `source_code`),
  KEY `idx_course_import_staging_validation` (`run_id`, `validation_status`, `id`),
  CONSTRAINT `fk_course_import_staging_run` FOREIGN KEY (`run_id`) REFERENCES `course_import_runs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_import_source_mappings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `source_system` VARCHAR(32) NOT NULL DEFAULT 'gas',
  `entity_type` VARCHAR(64) NOT NULL,
  `source_id` VARCHAR(128) NOT NULL,
  `target_table` VARCHAR(64) NOT NULL,
  `target_id` BIGINT UNSIGNED NOT NULL,
  `source_hash` CHAR(64) NOT NULL,
  `first_run_id` BIGINT UNSIGNED NOT NULL,
  `last_run_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_import_source_mapping` (`source_system`, `entity_type`, `source_id`),
  KEY `idx_course_import_mapping_target` (`target_table`, `target_id`),
  CONSTRAINT `fk_course_import_mapping_first_run` FOREIGN KEY (`first_run_id`) REFERENCES `course_import_runs` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_import_mapping_last_run` FOREIGN KEY (`last_run_id`) REFERENCES `course_import_runs` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_import_conflicts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id` BIGINT UNSIGNED NOT NULL,
  `dataset_name` VARCHAR(64) NOT NULL,
  `source_id` VARCHAR(128) DEFAULT NULL,
  `conflict_type` VARCHAR(64) NOT NULL,
  `severity` VARCHAR(24) NOT NULL DEFAULT 'blocking',
  `source_value_json` JSON DEFAULT NULL,
  `target_value_json` JSON DEFAULT NULL,
  `message` VARCHAR(1000) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'open',
  `resolution_json` JSON DEFAULT NULL,
  `resolved_by_user_id` CHAR(36) DEFAULT NULL,
  `resolved_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_import_conflict` (`run_id`, `dataset_name`, `source_id`, `conflict_type`),
  KEY `idx_course_import_conflicts_open` (`run_id`, `severity`, `status`, `id`),
  CONSTRAINT `fk_course_import_conflicts_run` FOREIGN KEY (`run_id`) REFERENCES `course_import_runs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_course_import_conflicts_resolver` FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_import_reconciliation_results` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id` BIGINT UNSIGNED NOT NULL,
  `metric_key` VARCHAR(128) NOT NULL,
  `source_value` DECIMAL(20,4) DEFAULT NULL,
  `target_value` DECIMAL(20,4) DEFAULT NULL,
  `difference_value` DECIMAL(20,4) DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL,
  `details_json` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_import_reconciliation_metric` (`run_id`, `metric_key`),
  KEY `idx_course_import_reconciliation_status` (`run_id`, `status`, `id`),
  CONSTRAINT `fk_course_import_reconciliation_run` FOREIGN KEY (`run_id`) REFERENCES `course_import_runs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_v2_cutover_state` (
  `id` TINYINT UNSIGNED NOT NULL,
  `schema_version` VARCHAR(80) NOT NULL,
  `state` VARCHAR(24) NOT NULL DEFAULT 'legacy',
  `maintenance_mode` TINYINT(1) NOT NULL DEFAULT 0,
  `active_import_run_id` BIGINT UNSIGNED DEFAULT NULL,
  `enabled_at` DATETIME DEFAULT NULL,
  `enabled_by_user_id` CHAR(36) DEFAULT NULL,
  `legacy_write_frozen_at` DATETIME DEFAULT NULL,
  `smoke_evidence_hash` CHAR(64) DEFAULT NULL,
  `smoke_checked_at` DATETIME DEFAULT NULL,
  `maintenance_released_at` DATETIME DEFAULT NULL,
  `notes` VARCHAR(1000) DEFAULT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_course_v2_cutover_run` FOREIGN KEY (`active_import_run_id`) REFERENCES `course_import_runs` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_v2_cutover_user` FOREIGN KEY (`enabled_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL `course_049_add_column`('course_v2_cutover_state', 'smoke_evidence_hash', 'CHAR(64) NULL AFTER `legacy_write_frozen_at`');
CALL `course_049_add_column`('course_v2_cutover_state', 'smoke_checked_at', 'DATETIME NULL AFTER `smoke_evidence_hash`');
CALL `course_049_add_column`('course_v2_cutover_state', 'maintenance_released_at', 'DATETIME NULL AFTER `smoke_checked_at`');

INSERT IGNORE INTO `course_v2_cutover_state` (
  `id`, `schema_version`, `state`, `maintenance_mode`, `notes`
)
VALUES (
  1, '049_course_count_card_normalization', 'legacy', 0,
  'Set to ready/active only after a zero-conflict GAS reconciliation run.'
);

-- Add/drop indexes and foreign keys on altered or repair-safe tables.
DROP PROCEDURE IF EXISTS `course_049_drop_index`;
DELIMITER $$
CREATE PROCEDURE `course_049_drop_index`(
  IN p_table_name VARCHAR(64),
  IN p_index_name VARCHAR(64)
)
BEGIN
  IF EXISTS (
    SELECT 1
      FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND INDEX_NAME = p_index_name
  ) THEN
    SET @course_049_drop_index_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` DROP INDEX `', REPLACE(p_index_name, '`', '``'), '`'
    );
    PREPARE course_049_drop_index_stmt FROM @course_049_drop_index_sql;
    EXECUTE course_049_drop_index_stmt;
    DEALLOCATE PREPARE course_049_drop_index_stmt;
  END IF;
END$$
DELIMITER ;

-- These unconditional unique keys appeared in an interrupted draft of 049.
-- Only active generated keys may be unique so a compensating hold can be
-- inserted for the same booking after an undo.
CALL `course_049_drop_index`('course_ticket_holds', 'uq_course_ticket_holds_booking');
CALL `course_049_drop_index`('course_ticket_holds', 'uq_course_ticket_holds_invite');
CALL `course_049_drop_index`('course_usage_events', 'uq_course_usage_idempotency');
CALL `course_049_drop_index`('course_usage_events', 'uq_course_usage_actor_idempotency');
CALL `course_049_drop_index`('course_attendance_invites', 'uq_course_attendance_invite_session_user');
CALL `course_049_drop_index`('course_order_items', 'uq_course_order_items_legacy_primary');
CALL `course_049_drop_index`('course_coach_profiles', 'uq_course_coach_code');

DROP PROCEDURE IF EXISTS `course_049_add_index`;
DELIMITER $$
CREATE PROCEDURE `course_049_add_index`(
  IN p_table_name VARCHAR(64),
  IN p_index_name VARCHAR(64),
  IN p_index_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND INDEX_NAME = p_index_name
  ) THEN
    SET @course_049_index_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD ', p_index_definition
    );
    PREPARE course_049_index_stmt FROM @course_049_index_sql;
    EXECUTE course_049_index_stmt;
    DEALLOCATE PREPARE course_049_index_stmt;
  END IF;
END$$
DELIMITER ;

-- Legacy databases can contain more than one booking for the same
-- (session_id, student_id), especially after manual account merges. Preserve
-- every booking and its ticket/hold history, but quarantine the ambiguous
-- Student links before adding the normalized unique key. The deterministic
-- migration run keeps a blocking conflict visible to every cutover rehearsal;
-- an operator must explicitly relink one booking and resolve the conflict.
INSERT INTO `course_import_runs` (
  `run_key`, `source_system`, `mode`, `status`, `source_contract_version`,
  `snapshot_hash`, `finished_at`, `summary_json`
)
SELECT
  '00000000-0000-0000-0049-000000000001',
  'leader_legacy',
  'migration',
  'conflict',
  '049_course_count_card_normalization',
  SHA2('course_bookings:duplicate_session_student', 256),
  NOW(),
  JSON_OBJECT('reason', 'legacy_duplicate_session_student_booking')
FROM DUAL
WHERE EXISTS (
  SELECT 1
    FROM `course_bookings`
   WHERE `student_id` IS NOT NULL
   GROUP BY `session_id`, `student_id`
  HAVING COUNT(*) > 1
)
ON DUPLICATE KEY UPDATE
  `status` = 'conflict',
  `finished_at` = NOW(),
  `summary_json` = JSON_OBJECT('reason', 'legacy_duplicate_session_student_booking');

INSERT INTO `course_import_conflicts` (
  `run_id`, `dataset_name`, `source_id`, `conflict_type`, `severity`,
  `source_value_json`, `target_value_json`, `message`, `status`
)
SELECT
  migration_run.`id`,
  'bookings',
  CONCAT('legacy-booking:', b.`id`),
  'DUPLICATE_SESSION_STUDENT',
  'blocking',
  JSON_OBJECT(
    'bookingId', b.`id`,
    'sessionId', b.`session_id`,
    'studentId', b.`student_id`,
    'ticketId', b.`ticket_id`,
    'userId', b.`user_id`,
    'status', b.`status`,
    'bookingCount', duplicate_booking.`booking_count`,
    'conflictKey', CONCAT(
      'session:', b.`session_id`, ':student:', b.`student_id`
    )
  ),
  NULL,
  CONCAT(
    'Legacy booking ', b.`id`, ' shares session ', b.`session_id`,
    ' and student ', b.`student_id`,
    ' with another booking; its student link was quarantined for manual resolution.'
  ),
  'open'
FROM `course_bookings` b
JOIN (
  SELECT
    `session_id`,
    `student_id`,
    COUNT(*) AS `booking_count`
  FROM `course_bookings`
  WHERE `student_id` IS NOT NULL
  GROUP BY `session_id`, `student_id`
  HAVING COUNT(*) > 1
) duplicate_booking
  ON duplicate_booking.`session_id` = b.`session_id`
 AND duplicate_booking.`student_id` = b.`student_id`
JOIN `course_import_runs` migration_run
  ON migration_run.`run_key` = '00000000-0000-0000-0049-000000000001'
ON DUPLICATE KEY UPDATE
  `source_value_json` = VALUES(`source_value_json`),
  `target_value_json` = VALUES(`target_value_json`),
  `message` = VALUES(`message`),
  `status` = 'open',
  `resolution_json` = NULL,
  `resolved_by_user_id` = NULL,
  `resolved_at` = NULL;

UPDATE `course_bookings` b
JOIN (
  SELECT `session_id`, `student_id`
    FROM `course_bookings`
   WHERE `student_id` IS NOT NULL
   GROUP BY `session_id`, `student_id`
  HAVING COUNT(*) > 1
) duplicate_booking
  ON duplicate_booking.`session_id` = b.`session_id`
 AND duplicate_booking.`student_id` = b.`student_id`
   SET b.`student_identity_conflict_key` = CONCAT(
         'session:', b.`session_id`, ':student:', b.`student_id`
       ),
       b.`student_id` = NULL,
       b.`row_version` = b.`row_version` + 1
 WHERE b.`id` >= 1;

CALL `course_049_add_index`('course_products', 'idx_course_products_ticket_product', 'KEY `idx_course_products_ticket_product` (`ticket_product_id`)');
CALL `course_049_add_index`('course_order_items', 'uq_course_order_items_line_identity', 'UNIQUE KEY `uq_course_order_items_line_identity` (`order_id`, `line_identity_key`)');
CALL `course_049_add_index`('course_sessions', 'idx_course_sessions_scenario', 'KEY `idx_course_sessions_scenario` (`scenario_id`)');
CALL `course_049_add_index`('course_sessions', 'idx_course_sessions_coach_profile', 'KEY `idx_course_sessions_coach_profile` (`coach_profile_id`)');
CALL `course_049_add_index`('course_tickets', 'idx_course_tickets_ticket_product', 'KEY `idx_course_tickets_ticket_product` (`ticket_product_id`)');
CALL `course_049_add_index`('course_tickets', 'idx_course_tickets_student', 'KEY `idx_course_tickets_student` (`student_id`, `status`, `id`)');
CALL `course_049_add_index`('course_tickets', 'idx_course_tickets_order_item', 'KEY `idx_course_tickets_order_item` (`order_item_id`)');
CALL `course_049_add_index`('course_orders', 'idx_course_orders_student', 'KEY `idx_course_orders_student` (`student_id`, `created_at`, `id`)');
CALL `course_049_add_index`('course_bookings', 'idx_course_bookings_student', 'KEY `idx_course_bookings_student` (`student_id`, `created_at`, `id`)');
CALL `course_049_add_index`('course_bookings', 'idx_course_bookings_identity_conflict', 'KEY `idx_course_bookings_identity_conflict` (`student_identity_conflict_key`)');
-- Preserve the legacy (session_id, user_id) key while also covering unclaimed
-- GAS students whose user_id is NULL.
CALL `course_049_add_index`('course_bookings', 'uq_course_bookings_session_student', 'UNIQUE KEY `uq_course_bookings_session_student` (`session_id`, `student_id`)');
CALL `course_049_add_index`('course_ticket_holds', 'uq_course_ticket_holds_active_booking', 'UNIQUE KEY `uq_course_ticket_holds_active_booking` (`active_booking_id`)');
CALL `course_049_add_index`('course_ticket_holds', 'uq_course_ticket_holds_active_invite', 'UNIQUE KEY `uq_course_ticket_holds_active_invite` (`active_invite_id`)');
CALL `course_049_add_index`('course_attendance_invites', 'idx_course_attendance_invites_booking', 'KEY `idx_course_attendance_invites_booking` (`booking_id`)');
CALL `course_049_add_index`('course_attendance_invites', 'uq_course_attendance_invite_active_user', 'UNIQUE KEY `uq_course_attendance_invite_active_user` (`session_id`, `active_user_id`)');
CALL `course_049_add_index`('course_attendance_invites', 'uq_course_attendance_invite_active_student', 'UNIQUE KEY `uq_course_attendance_invite_active_student` (`session_id`, `active_student_id`)');
CALL `course_049_add_index`('course_usage_events', 'idx_course_usage_command', 'KEY `idx_course_usage_command` (`command_id`)');
CALL `course_049_add_index`('course_usage_events', 'idx_course_usage_idempotency', 'KEY `idx_course_usage_idempotency` (`idempotency_key`)');
CALL `course_049_add_index`('course_usage_events', 'uq_course_usage_reversal', 'UNIQUE KEY `uq_course_usage_reversal` (`reverses_event_id`)');
CALL `course_049_add_index`('course_coach_profiles', 'uq_course_coach_owner_code', 'UNIQUE KEY `uq_course_coach_owner_code` (`owner_user_id`, `code`)');

DROP PROCEDURE IF EXISTS `course_049_drop_foreign_key`;
DELIMITER $$
CREATE PROCEDURE `course_049_drop_foreign_key`(
  IN p_table_name VARCHAR(64),
  IN p_constraint_name VARCHAR(64)
)
BEGIN
  IF EXISTS (
    SELECT 1
      FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND CONSTRAINT_NAME = p_constraint_name
  ) THEN
    SET @course_049_drop_fk_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` DROP FOREIGN KEY `', REPLACE(p_constraint_name, '`', '``'), '`'
    );
    PREPARE course_049_drop_fk_stmt FROM @course_049_drop_fk_sql;
    EXECUTE course_049_drop_fk_stmt;
    DEALLOCATE PREPARE course_049_drop_fk_stmt;
  END IF;
END$$
DELIMITER ;

-- An immutable ledger cannot accept the implicit UPDATE caused by SET NULL.
-- Preserve every referenced identity and attendance fact instead.
CALL `course_049_drop_foreign_key`('course_usage_events', 'fk_course_usage_student');
CALL `course_049_drop_foreign_key`('course_usage_events', 'fk_course_usage_user');
CALL `course_049_drop_foreign_key`('course_usage_events', 'fk_course_usage_booking');
CALL `course_049_drop_foreign_key`('course_usage_events', 'fk_course_usage_invite');
CALL `course_049_drop_foreign_key`('course_usage_events', 'fk_course_usage_actor');

DROP PROCEDURE IF EXISTS `course_049_add_foreign_key`;
DELIMITER $$
CREATE PROCEDURE `course_049_add_foreign_key`(
  IN p_table_name VARCHAR(64),
  IN p_constraint_name VARCHAR(64),
  IN p_constraint_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND CONSTRAINT_NAME = p_constraint_name
  ) THEN
    SET @course_049_fk_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD CONSTRAINT `', REPLACE(p_constraint_name, '`', '``'),
      '` ', p_constraint_definition
    );
    PREPARE course_049_fk_stmt FROM @course_049_fk_sql;
    EXECUTE course_049_fk_stmt;
    DEALLOCATE PREPARE course_049_fk_stmt;
  END IF;
END$$
DELIMITER ;

CALL `course_049_add_foreign_key`('course_products', 'fk_course_products_ticket_product', 'FOREIGN KEY (`ticket_product_id`) REFERENCES `course_ticket_products` (`id`) ON DELETE RESTRICT');
CALL `course_049_add_foreign_key`('course_sessions', 'fk_course_sessions_scenario', 'FOREIGN KEY (`scenario_id`) REFERENCES `course_redeem_scenarios` (`id`) ON DELETE RESTRICT');
CALL `course_049_add_foreign_key`('course_sessions', 'fk_course_sessions_coach_profile', 'FOREIGN KEY (`coach_profile_id`) REFERENCES `course_coach_profiles` (`id`) ON DELETE SET NULL');
CALL `course_049_add_foreign_key`('course_tickets', 'fk_course_tickets_student', 'FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT');
CALL `course_049_add_foreign_key`('course_tickets', 'fk_course_tickets_ticket_product', 'FOREIGN KEY (`ticket_product_id`) REFERENCES `course_ticket_products` (`id`) ON DELETE RESTRICT');
CALL `course_049_add_foreign_key`('course_tickets', 'fk_course_tickets_order_item', 'FOREIGN KEY (`order_item_id`) REFERENCES `course_order_items` (`id`) ON DELETE SET NULL');
CALL `course_049_add_foreign_key`('course_orders', 'fk_course_orders_student', 'FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT');
CALL `course_049_add_foreign_key`('course_bookings', 'fk_course_bookings_student', 'FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT');
CALL `course_049_add_foreign_key`('course_ticket_holds', 'fk_course_ticket_holds_released_by', 'FOREIGN KEY (`released_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE');
CALL `course_049_add_foreign_key`('course_ticket_holds', 'fk_course_ticket_holds_consumed_event', 'FOREIGN KEY (`consumed_usage_event_id`) REFERENCES `course_usage_events` (`id`) ON DELETE RESTRICT');
CALL `course_049_add_foreign_key`('course_ticket_holds', 'fk_course_ticket_holds_invite', 'FOREIGN KEY (`invite_id`) REFERENCES `course_attendance_invites` (`id`) ON DELETE RESTRICT');
CALL `course_049_add_foreign_key`('course_attendance_invites', 'fk_course_attendance_invites_booking', 'FOREIGN KEY (`booking_id`) REFERENCES `course_bookings` (`id`) ON DELETE SET NULL');
CALL `course_049_add_foreign_key`('course_attendance_invites', 'fk_course_attendance_invites_redeemed_event', 'FOREIGN KEY (`redeemed_usage_event_id`) REFERENCES `course_usage_events` (`id`) ON DELETE RESTRICT');
CALL `course_049_add_foreign_key`('course_usage_events', 'fk_course_usage_student', 'FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT');
CALL `course_049_add_foreign_key`('course_usage_events', 'fk_course_usage_user', 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE');
CALL `course_049_add_foreign_key`('course_usage_events', 'fk_course_usage_booking', 'FOREIGN KEY (`booking_id`) REFERENCES `course_bookings` (`id`) ON DELETE RESTRICT');
CALL `course_049_add_foreign_key`('course_usage_events', 'fk_course_usage_invite', 'FOREIGN KEY (`invite_id`) REFERENCES `course_attendance_invites` (`id`) ON DELETE RESTRICT');
CALL `course_049_add_foreign_key`('course_usage_events', 'fk_course_usage_actor', 'FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE');
CALL `course_049_add_foreign_key`('course_usage_events', 'fk_course_usage_command', 'FOREIGN KEY (`command_id`) REFERENCES `course_mutation_commands` (`id`) ON DELETE RESTRICT');

-- Immutability is enforced in MySQL as well as in the domain service. Reversal,
-- refund and correction are represented by compensating INSERT events.
DROP TRIGGER IF EXISTS `course_usage_events_no_update`;
DROP TRIGGER IF EXISTS `course_usage_events_no_delete`;
DELIMITER $$
CREATE TRIGGER `course_usage_events_no_update`
BEFORE UPDATE ON `course_usage_events`
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'course_usage_events is immutable; insert a compensating event';
END$$
CREATE TRIGGER `course_usage_events_no_delete`
BEFORE DELETE ON `course_usage_events`
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'course_usage_events is immutable; insert a compensating event';
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `course_049_add_column`;
DROP PROCEDURE IF EXISTS `course_049_make_nullable`;
DROP PROCEDURE IF EXISTS `course_049_drop_index`;
DROP PROCEDURE IF EXISTS `course_049_drop_foreign_key`;
DROP PROCEDURE IF EXISTS `course_049_add_index`;
DROP PROCEDURE IF EXISTS `course_049_add_foreign_key`;

-- The startup marker is deliberately last. A partially applied MySQL DDL file
-- must not be mistaken for a complete normalized schema.
INSERT IGNORE INTO `course_schema_versions` (`version`, `description`)
VALUES ('049_course_count_card_normalization', 'Immutable course usage ledger, holds, scenarios, staff and GAS cutover staging');

SELECT 'Migration 049_course_count_card_normalization applied' AS msg;
