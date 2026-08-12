-- Migration 051: productized count-card operations.
--
-- This migration extends the normalized 049 model without changing the 049
-- cutover marker. It is safe to rerun: every ALTER/constraint/index/FK is
-- guarded and the completion marker is written only after all DDL/backfills.

CREATE TABLE IF NOT EXISTS `course_schema_versions` (
  `version` VARCHAR(80) NOT NULL,
  `description` VARCHAR(255) NOT NULL,
  `applied_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM `course_schema_versions`
 WHERE `version` = '051_course_count_card_operational_parity';

DROP PROCEDURE IF EXISTS `course_051_add_column`;
DELIMITER $$
CREATE PROCEDURE `course_051_add_column`(
  IN p_table_name VARCHAR(64),
  IN p_column_name VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND COLUMN_NAME = p_column_name
  ) THEN
    SET @course_051_column_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD COLUMN `', REPLACE(p_column_name, '`', '``'), '` ', p_definition
    );
    PREPARE course_051_column_stmt FROM @course_051_column_sql;
    EXECUTE course_051_column_stmt;
    DEALLOCATE PREPARE course_051_column_stmt;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `course_051_make_nullable`;
DELIMITER $$
CREATE PROCEDURE `course_051_make_nullable`(
  IN p_table_name VARCHAR(64),
  IN p_column_name VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND COLUMN_NAME = p_column_name
       AND IS_NULLABLE = 'NO'
  ) THEN
    SET @course_051_nullable_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` MODIFY COLUMN `', REPLACE(p_column_name, '`', '``'), '` ', p_definition
    );
    PREPARE course_051_nullable_stmt FROM @course_051_nullable_sql;
    EXECUTE course_051_nullable_stmt;
    DEALLOCATE PREPARE course_051_nullable_stmt;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `course_051_add_index`;
DELIMITER $$
CREATE PROCEDURE `course_051_add_index`(
  IN p_table_name VARCHAR(64),
  IN p_index_name VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND INDEX_NAME = p_index_name
  ) THEN
    SET @course_051_index_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'), '` ADD ', p_definition
    );
    PREPARE course_051_index_stmt FROM @course_051_index_sql;
    EXECUTE course_051_index_stmt;
    DEALLOCATE PREPARE course_051_index_stmt;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `course_051_add_check`;
DELIMITER $$
CREATE PROCEDURE `course_051_add_check`(
  IN p_table_name VARCHAR(64),
  IN p_constraint_name VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND CONSTRAINT_NAME = p_constraint_name
  ) THEN
    SET @course_051_check_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD CONSTRAINT `', REPLACE(p_constraint_name, '`', '``'),
      '` CHECK (', p_definition, ')'
    );
    PREPARE course_051_check_stmt FROM @course_051_check_sql;
    EXECUTE course_051_check_stmt;
    DEALLOCATE PREPARE course_051_check_stmt;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `course_051_add_foreign_key`;
DELIMITER $$
CREATE PROCEDURE `course_051_add_foreign_key`(
  IN p_table_name VARCHAR(64),
  IN p_constraint_name VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND CONSTRAINT_NAME = p_constraint_name
  ) THEN
    SET @course_051_fk_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD CONSTRAINT `', REPLACE(p_constraint_name, '`', '``'), '` ', p_definition
    );
    PREPARE course_051_fk_stmt FROM @course_051_fk_sql;
    EXECUTE course_051_fk_stmt;
    DEALLOCATE PREPARE course_051_fk_stmt;
  END IF;
END$$
DELIMITER ;

-- Redeem contexts are not synonymous with classes. Only a session-bound class
-- requires a scheduled course_session; term contexts are payment/eligibility
-- instruments and never become fixed-term attendance truth.
CALL `course_051_add_column`('course_redeem_scenarios', 'item_type', 'VARCHAR(24) NOT NULL DEFAULT ''class'' AFTER `description`');
CALL `course_051_add_column`('course_redeem_scenarios', 'session_bound', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER `item_type`');
CALL `course_051_add_column`('course_redeem_scenarios', 'redeem_quantity', 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER `session_bound`');

CALL `course_051_add_check`('course_redeem_scenarios', 'chk_course_redeem_item_type', '`item_type` IN (''class'', ''term'', ''event'', ''merchant'', ''service'', ''other'')');
CALL `course_051_add_check`('course_redeem_scenarios', 'chk_course_redeem_quantity', '`redeem_quantity` >= 1');

-- NULL capacity is the canonical unlimited-capacity representation. Existing
-- zero-capacity rows are normalized only after the column permits NULL.
CALL `course_051_add_column`('course_sessions', 'cancel_close_at', 'DATETIME NULL AFTER `booking_close_at`');
CALL `course_051_add_column`('course_sessions', 'venue_name', 'VARCHAR(255) NULL AFTER `location`');
CALL `course_051_add_column`('course_sessions', 'city', 'VARCHAR(120) NULL AFTER `venue_name`');
CALL `course_051_make_nullable`('course_sessions', 'capacity', 'INT UNSIGNED NULL');
UPDATE `course_sessions`
   SET `capacity` = NULL
 WHERE `id` >= 1
   AND `capacity` = 0;

CALL `course_051_add_index`('course_sessions', 'idx_course_sessions_owner_city_time', 'KEY `idx_course_sessions_owner_city_time` (`owner_user_id`, `city`, `starts_at`, `id`)');

-- Product policies are canonical defaults. Ticket snapshots stay nullable so
-- old issuance SQL remains compatible and runtime may COALESCE to the product.
CALL `course_051_add_column`('course_ticket_products', 'product_type', 'VARCHAR(32) NOT NULL DEFAULT ''count_pass'' AFTER `description`');
CALL `course_051_add_column`('course_ticket_products', 'usage_mode', 'VARCHAR(16) NOT NULL DEFAULT ''finite'' AFTER `product_type`');
CALL `course_051_add_column`('course_ticket_products', 'usage_notice_scope', 'VARCHAR(24) NOT NULL DEFAULT ''product'' AFTER `usage_mode`');
CALL `course_051_add_column`('course_ticket_products', 'source_system', 'VARCHAR(32) NOT NULL DEFAULT ''leader'' AFTER `usage_notice_scope`');
CALL `course_051_add_column`('course_ticket_products', 'source_id', 'VARCHAR(128) NULL AFTER `source_system`');
CALL `course_051_add_column`('course_ticket_products', 'max_transfer_operations', 'SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER `max_transfers`');
CALL `course_051_add_column`('course_ticket_products', 'pause_max_operations', 'SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER `max_transfer_operations`');
CALL `course_051_add_column`('course_ticket_products', 'pause_max_days', 'SMALLINT UNSIGNED NOT NULL DEFAULT 365 AFTER `pause_max_operations`');

CALL `course_051_add_check`('course_ticket_products', 'chk_course_ticket_product_usage_mode', '`usage_mode` IN (''finite'', ''unlimited'')');
CALL `course_051_add_check`('course_ticket_products', 'chk_course_ticket_product_type', '`product_type` IN (''count_pass'', ''trial_discount'', ''course_payment'')');
CALL `course_051_add_check`('course_ticket_products', 'chk_course_ticket_pause_days', '`pause_max_days` BETWEEN 1 AND 3650');
CALL `course_051_add_index`('course_ticket_products', 'uq_course_ticket_products_source', 'UNIQUE KEY `uq_course_ticket_products_source` (`source_system`, `source_id`)');

CALL `course_051_add_column`('course_tickets', 'usage_mode_snapshot', 'VARCHAR(16) NULL AFTER `product_class_count_snapshot`');
CALL `course_051_add_column`('course_tickets', 'product_type_snapshot', 'VARCHAR(32) NULL AFTER `usage_mode_snapshot`');
CALL `course_051_add_column`('course_tickets', 'usage_notice_scope_snapshot', 'VARCHAR(24) NULL AFTER `product_type_snapshot`');
CALL `course_051_add_column`('course_tickets', 'max_transfer_operations_snapshot', 'SMALLINT UNSIGNED NULL AFTER `product_max_transfers_snapshot`');
CALL `course_051_add_column`('course_tickets', 'pause_max_operations_snapshot', 'SMALLINT UNSIGNED NULL AFTER `max_transfer_operations_snapshot`');
CALL `course_051_add_column`('course_tickets', 'pause_max_days_snapshot', 'SMALLINT UNSIGNED NULL AFTER `pause_max_operations_snapshot`');
CALL `course_051_add_column`('course_tickets', 'source_system', 'VARCHAR(32) NOT NULL DEFAULT ''leader'' AFTER `provider_name_snapshot`');
CALL `course_051_add_column`('course_tickets', 'source_id', 'VARCHAR(128) NULL AFTER `source_system`');
CALL `course_051_add_column`('course_tickets', 'parent_ticket_id', 'BIGINT UNSIGNED NULL AFTER `source_id`');
CALL `course_051_add_column`('course_tickets', 'transfer_root_ticket_id', 'BIGINT UNSIGNED NULL AFTER `parent_ticket_id`');

UPDATE `course_tickets` t
LEFT JOIN `course_ticket_products` tp ON tp.`id` = t.`ticket_product_id`
   SET t.`usage_mode_snapshot` = COALESCE(t.`usage_mode_snapshot`, tp.`usage_mode`, 'finite'),
       t.`product_type_snapshot` = COALESCE(t.`product_type_snapshot`, tp.`product_type`, 'count_pass'),
       t.`usage_notice_scope_snapshot` = COALESCE(t.`usage_notice_scope_snapshot`, tp.`usage_notice_scope`, 'product'),
       t.`max_transfer_operations_snapshot` = COALESCE(t.`max_transfer_operations_snapshot`, tp.`max_transfer_operations`, t.`product_max_transfers_snapshot`, 1),
       t.`pause_max_operations_snapshot` = COALESCE(t.`pause_max_operations_snapshot`, tp.`pause_max_operations`, 1),
       t.`pause_max_days_snapshot` = COALESCE(t.`pause_max_days_snapshot`, tp.`pause_max_days`, 365),
       t.`transfer_root_ticket_id` = COALESCE(t.`transfer_root_ticket_id`, t.`id`)
 WHERE t.`id` >= 1;

CALL `course_051_add_index`('course_tickets', 'uq_course_tickets_source', 'UNIQUE KEY `uq_course_tickets_source` (`source_system`, `source_id`)');
CALL `course_051_add_index`('course_tickets', 'idx_course_tickets_transfer_root', 'KEY `idx_course_tickets_transfer_root` (`transfer_root_ticket_id`, `parent_ticket_id`, `id`)');
CALL `course_051_add_foreign_key`('course_tickets', 'fk_course_tickets_parent', 'FOREIGN KEY (`parent_ticket_id`) REFERENCES `course_tickets` (`id`) ON DELETE RESTRICT');
CALL `course_051_add_foreign_key`('course_tickets', 'fk_course_tickets_transfer_root', 'FOREIGN KEY (`transfer_root_ticket_id`) REFERENCES `course_tickets` (`id`) ON DELETE RESTRICT');

-- Booking status remains the coarse lifecycle. Typed resolution facts preserve
-- the operational distinction between cancellation, leave, no-show and repair.
CALL `course_051_add_column`('course_bookings', 'origin', 'VARCHAR(32) NOT NULL DEFAULT ''MEMBER_RSVP'' AFTER `status`');
CALL `course_051_add_column`('course_bookings', 'redeem_quantity_snapshot', 'INT UNSIGNED NULL AFTER `origin`');
CALL `course_051_add_column`('course_bookings', 'resolution_type', 'VARCHAR(32) NULL AFTER `attended_at`');
CALL `course_051_add_column`('course_bookings', 'resolution_actor_user_id', 'CHAR(36) NULL AFTER `resolution_type`');
CALL `course_051_add_column`('course_bookings', 'resolution_at', 'DATETIME NULL AFTER `resolution_actor_user_id`');
CALL `course_051_add_column`('course_bookings', 'capacity_override', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `resolution_reason`');
CALL `course_051_add_column`('course_bookings', 'capacity_override_reason', 'VARCHAR(500) NULL AFTER `capacity_override`');

CALL `course_051_add_check`('course_bookings', 'chk_course_booking_origin', '`origin` IN (''MEMBER_RSVP'', ''WALK_IN'', ''ATTENDANCE_INVITE'', ''TERM_ROSTER'', ''MAKEUP'')');
CALL `course_051_add_check`('course_bookings', 'chk_course_booking_resolution', '`resolution_type` IS NULL OR `resolution_type` IN (''member_cancel'', ''excused_leave'', ''attended'', ''late_attend'', ''no_show'', ''reversal'', ''provider_cancel'')');
CALL `course_051_add_check`('course_bookings', 'chk_course_booking_capacity_override', '`capacity_override` = 0 OR NULLIF(TRIM(`capacity_override_reason`), '''') IS NOT NULL');
CALL `course_051_add_foreign_key`('course_bookings', 'fk_course_bookings_resolution_actor', 'FOREIGN KEY (`resolution_actor_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE');

-- Holds reserve operational quantity even for unlimited tickets. Unlimited
-- redemption is represented by delta_uses=0, not by a zero-quantity hold.
CALL `course_051_add_column`('course_ticket_holds', 'purpose', 'VARCHAR(32) NOT NULL DEFAULT ''BOOKING'' AFTER `ticket_id`');
CALL `course_051_add_column`('course_ticket_holds', 'source_type', 'VARCHAR(48) NULL AFTER `purpose`');
CALL `course_051_add_column`('course_ticket_holds', 'source_id', 'VARCHAR(128) NULL AFTER `source_type`');
CALL `course_051_add_column`(
  'course_ticket_holds',
  'active_source_key',
  'VARCHAR(240) GENERATED ALWAYS AS (CASE WHEN `status` = ''active'' AND `source_type` IS NOT NULL AND `source_id` IS NOT NULL THEN CONCAT(`purpose`, '':'', `source_type`, '':'', `source_id`) ELSE NULL END) STORED AFTER `active_invite_id`'
);
CALL `course_051_add_check`('course_ticket_holds', 'chk_course_ticket_hold_purpose', '`purpose` IN (''BOOKING'', ''ATTENDANCE_CONFIRMATION'', ''TRANSFER'', ''PAYMENT_INSTRUMENT'')');
CALL `course_051_add_index`('course_ticket_holds', 'uq_course_ticket_holds_active_source', 'UNIQUE KEY `uq_course_ticket_holds_active_source` (`active_source_key`)');

CALL `course_051_add_column`('course_attendance_invites', 'expiry_action', 'VARCHAR(24) NOT NULL DEFAULT ''release'' AFTER `expires_at`');
CALL `course_051_add_column`('course_attendance_invites', 'expiry_action_snapshot_at', 'DATETIME NULL AFTER `expiry_action`');
UPDATE `course_attendance_invites`
   SET `expiry_action_snapshot_at` = COALESCE(`expiry_action_snapshot_at`, `created_at`)
 WHERE `id` >= 1
   AND `expiry_action_snapshot_at` IS NULL;
CALL `course_051_add_check`('course_attendance_invites', 'chk_course_attendance_invite_expiry', '`expiry_action` IN (''release'', ''auto_redeem'')');

-- Typed immutable usage facts keep historical KPI dimensions stable after
-- scenarios, coaches or venues are renamed.
-- Canonical event vocabulary retained by this operational layer:
-- SUCCESS, NO_SHOW, REVERSAL, TRANSFER_OUT, TRANSFER_IN.
CALL `course_051_add_column`('course_usage_events', 'usage_method', 'VARCHAR(32) NULL AFTER `event_type`');
CALL `course_051_add_column`('course_usage_events', 'scenario_id', 'BIGINT UNSIGNED NULL AFTER `session_id`');
CALL `course_051_add_column`('course_usage_events', 'coach_profile_id', 'BIGINT UNSIGNED NULL AFTER `scenario_id`');
CALL `course_051_add_column`('course_usage_events', 'provider_user_id_snapshot', 'CHAR(36) NULL AFTER `coach_profile_id`');
CALL `course_051_add_column`('course_usage_events', 'venue_name_snapshot', 'VARCHAR(255) NULL AFTER `provider_user_id_snapshot`');
CALL `course_051_add_column`('course_usage_events', 'city_snapshot', 'VARCHAR(120) NULL AFTER `venue_name_snapshot`');
CALL `course_051_add_column`('course_usage_events', 'quantity_snapshot', 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER `delta_uses`');
CALL `course_051_add_check`('course_usage_events', 'chk_course_usage_method', '`usage_method` IS NULL OR `usage_method` IN (''booking_attendance'', ''late_attendance'', ''walk_in'', ''attendance_invite'', ''no_show'', ''transfer'', ''course_payment'', ''refund'', ''migration'', ''admin_adjustment'', ''system'')');
CALL `course_051_add_check`('course_usage_events', 'chk_course_usage_quantity_snapshot', '`quantity_snapshot` >= 1');
CALL `course_051_add_index`('course_usage_events', 'idx_course_usage_provider_dimensions', 'KEY `idx_course_usage_provider_dimensions` (`provider_user_id_snapshot`, `event_type`, `occurred_at`, `id`)');
CALL `course_051_add_foreign_key`('course_usage_events', 'fk_course_usage_scenario', 'FOREIGN KEY (`scenario_id`) REFERENCES `course_redeem_scenarios` (`id`) ON DELETE RESTRICT');
CALL `course_051_add_foreign_key`('course_usage_events', 'fk_course_usage_coach_profile', 'FOREIGN KEY (`coach_profile_id`) REFERENCES `course_coach_profiles` (`id`) ON DELETE RESTRICT');
CALL `course_051_add_foreign_key`('course_usage_events', 'fk_course_usage_provider_snapshot', 'FOREIGN KEY (`provider_user_id_snapshot`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE');

-- Existing rows are explicitly whole-ticket legacy transfers. New partial
-- transfers reserve uses in course_ticket_holds before acceptance creates a
-- child CTK ticket and compensating TRANSFER_OUT/TRANSFER_IN ledger facts.
CALL `course_051_add_column`('course_ticket_transfers', 'transfer_mode', 'VARCHAR(24) NOT NULL DEFAULT ''WHOLE_LEGACY'' AFTER `ticket_id`');
CALL `course_051_add_column`('course_ticket_transfers', 'quantity', 'INT UNSIGNED NULL AFTER `transfer_mode`');
CALL `course_051_add_column`('course_ticket_transfers', 'hold_id', 'BIGINT UNSIGNED NULL AFTER `quantity`');
CALL `course_051_add_column`('course_ticket_transfers', 'child_ticket_id', 'BIGINT UNSIGNED NULL AFTER `hold_id`');
CALL `course_051_add_column`('course_ticket_transfers', 'expires_at', 'DATETIME NULL AFTER `status`');
CALL `course_051_add_column`('course_ticket_transfers', 'accepted_at', 'DATETIME NULL AFTER `expires_at`');
CALL `course_051_add_column`('course_ticket_transfers', 'declined_at', 'DATETIME NULL AFTER `accepted_at`');
CALL `course_051_add_column`('course_ticket_transfers', 'cancelled_at', 'DATETIME NULL AFTER `declined_at`');
CALL `course_051_add_column`('course_ticket_transfers', 'row_version', 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER `cancelled_at`');
CALL `course_051_add_check`('course_ticket_transfers', 'chk_course_ticket_transfer_mode', '`transfer_mode` IN (''WHOLE_LEGACY'', ''PARTIAL'')');
CALL `course_051_add_check`('course_ticket_transfers', 'chk_course_ticket_transfer_quantity', '(`transfer_mode` = ''WHOLE_LEGACY'' AND `quantity` IS NULL) OR (`transfer_mode` = ''PARTIAL'' AND `quantity` >= 1)');
CALL `course_051_add_index`('course_ticket_transfers', 'uq_course_ticket_transfers_hold', 'UNIQUE KEY `uq_course_ticket_transfers_hold` (`hold_id`)');
CALL `course_051_add_index`('course_ticket_transfers', 'uq_course_ticket_transfers_child', 'UNIQUE KEY `uq_course_ticket_transfers_child` (`child_ticket_id`)');
CALL `course_051_add_index`('course_ticket_transfers', 'idx_course_ticket_transfers_due', 'KEY `idx_course_ticket_transfers_due` (`status`, `expires_at`, `id`)');
CALL `course_051_add_foreign_key`('course_ticket_transfers', 'fk_course_ticket_transfers_hold', 'FOREIGN KEY (`hold_id`) REFERENCES `course_ticket_holds` (`id`) ON DELETE RESTRICT');
CALL `course_051_add_foreign_key`('course_ticket_transfers', 'fk_course_ticket_transfers_child', 'FOREIGN KEY (`child_ticket_id`) REFERENCES `course_tickets` (`id`) ON DELETE RESTRICT');

-- Provider settings are fail-closed until the 051 runtime and provider are both
-- explicitly enabled. Thresholds are operational defaults, never code constants.
CALL `course_051_add_column`('course_settings', 'attendance_invite_expiry_action', 'VARCHAR(24) NOT NULL DEFAULT ''release'' AFTER `attendance_invite_expires_minutes`');
CALL `course_051_add_column`('course_settings', 'bank_transfer_hold_hours', 'SMALLINT UNSIGNED NOT NULL DEFAULT 24 AFTER `attendance_invite_expiry_action`');
CALL `course_051_add_column`('course_settings', 'pause_max_operations', 'SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER `bank_transfer_hold_hours`');
CALL `course_051_add_column`('course_settings', 'pause_max_days', 'SMALLINT UNSIGNED NOT NULL DEFAULT 365 AFTER `pause_max_operations`');
CALL `course_051_add_column`('course_settings', 'push_plan_max_available_uses', 'INT UNSIGNED NOT NULL DEFAULT 3 AFTER `pause_max_days`');
CALL `course_051_add_column`('course_settings', 'expiring_ticket_days', 'SMALLINT UNSIGNED NOT NULL DEFAULT 30 AFTER `push_plan_max_available_uses`');
CALL `course_051_add_column`('course_settings', 'dormant_student_days', 'SMALLINT UNSIGNED NOT NULL DEFAULT 90 AFTER `expiring_ticket_days`');
CALL `course_051_add_column`('course_settings', 'count_card_parity_enabled', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `auto_no_show`');
CALL `course_051_add_check`('course_settings', 'chk_course_settings_invite_expiry', '`attendance_invite_expiry_action` IN (''release'', ''auto_redeem'')');
CALL `course_051_add_check`('course_settings', 'chk_course_settings_hold_hours', '`bank_transfer_hold_hours` BETWEEN 1 AND 720');
CALL `course_051_add_check`('course_settings', 'chk_course_settings_pause_days', '`pause_max_days` BETWEEN 1 AND 3650');

DROP PROCEDURE IF EXISTS `course_051_add_column`;
DROP PROCEDURE IF EXISTS `course_051_make_nullable`;
DROP PROCEDURE IF EXISTS `course_051_add_index`;
DROP PROCEDURE IF EXISTS `course_051_add_check`;
DROP PROCEDURE IF EXISTS `course_051_add_foreign_key`;

INSERT IGNORE INTO `course_schema_versions` (`version`, `description`)
VALUES ('051_course_count_card_operational_parity', 'Productized count-card scenarios, operations, partial transfers and reporting facts');

SELECT 'Migration 051_course_count_card_operational_parity applied' AS msg;
