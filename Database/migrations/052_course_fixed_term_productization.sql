-- Migration 052: fixed-term course productization.
--
-- Count-card balances remain in course_usage_events. Fixed-term attendance and
-- leave/makeup rights are represented by enrollment/session entitlement rows.
-- Every aggregate is provider scoped and mutable resources carry row_version.

CREATE TABLE IF NOT EXISTS `course_schema_versions` (
  `version` VARCHAR(80) NOT NULL,
  `description` VARCHAR(255) NOT NULL,
  `applied_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM `course_schema_versions`
 WHERE `version` = '052_course_fixed_term_productization';

DROP PROCEDURE IF EXISTS `course_052_add_column`;
DELIMITER $$
CREATE PROCEDURE `course_052_add_column`(
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
    SET @course_052_column_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD COLUMN `', REPLACE(p_column_name, '`', '``'), '` ', p_definition
    );
    PREPARE course_052_column_stmt FROM @course_052_column_sql;
    EXECUTE course_052_column_stmt;
    DEALLOCATE PREPARE course_052_column_stmt;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `course_052_add_foreign_key`;
DELIMITER $$
CREATE PROCEDURE `course_052_add_foreign_key`(
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
    SET @course_052_fk_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD CONSTRAINT `', REPLACE(p_constraint_name, '`', '``'), '` ', p_definition
    );
    PREPARE course_052_fk_stmt FROM @course_052_fk_sql;
    EXECUTE course_052_fk_stmt;
    DEALLOCATE PREPARE course_052_fk_stmt;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `course_052_add_index`;
DELIMITER $$
CREATE PROCEDURE `course_052_add_index`(
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
    SET @course_052_index_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'), '` ADD ', p_definition
    );
    PREPARE course_052_index_stmt FROM @course_052_index_sql;
    EXECUTE course_052_index_stmt;
    DEALLOCATE PREPARE course_052_index_stmt;
  END IF;
END$$
DELIMITER ;

CREATE TABLE IF NOT EXISTS `course_programs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `slug` VARCHAR(120) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `summary` VARCHAR(500) DEFAULT NULL,
  `description` MEDIUMTEXT DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'draft',
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_programs_owner_code` (`owner_user_id`, `code`),
  UNIQUE KEY `uq_course_programs_owner_slug` (`owner_user_id`, `slug`),
  KEY `idx_course_programs_owner_status` (`owner_user_id`, `status`, `id`),
  CONSTRAINT `fk_course_programs_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_level_schemes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_level_schemes_owner_code` (`owner_user_id`, `code`),
  KEY `idx_course_level_schemes_owner_status` (`owner_user_id`, `status`, `id`),
  CONSTRAINT `fk_course_level_schemes_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_levels` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `scheme_id` BIGINT UNSIGNED NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_levels_scheme_code` (`scheme_id`, `code`),
  KEY `idx_course_levels_owner_scheme` (`owner_user_id`, `scheme_id`, `status`, `sort_order`, `id`),
  CONSTRAINT `fk_course_levels_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_levels_scheme` FOREIGN KEY (`scheme_id`) REFERENCES `course_level_schemes` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_student_level_records` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `student_id` BIGINT UNSIGNED NOT NULL,
  `scheme_id` BIGINT UNSIGNED NOT NULL,
  `level_id` BIGINT UNSIGNED DEFAULT NULL,
  `assessment_status` VARCHAR(24) NOT NULL DEFAULT 'NOT_STARTED',
  `is_current` TINYINT(1) NOT NULL DEFAULT 1,
  `active_scheme_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `is_current` = 1 THEN `scheme_id` ELSE NULL END
  ) STORED,
  `assessed_by_user_id` CHAR(36) DEFAULT NULL,
  `assessed_at` DATETIME DEFAULT NULL,
  `expires_at` DATETIME DEFAULT NULL,
  `evidence_json` JSON DEFAULT NULL,
  `note` VARCHAR(500) DEFAULT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_student_current_scheme` (`owner_user_id`, `student_id`, `active_scheme_id`),
  KEY `idx_course_student_levels_owner_status` (`owner_user_id`, `assessment_status`, `student_id`, `id`),
  CONSTRAINT `fk_course_student_levels_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_student_levels_student` FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_student_levels_scheme` FOREIGN KEY (`scheme_id`) REFERENCES `course_level_schemes` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_student_levels_level` FOREIGN KEY (`level_id`) REFERENCES `course_levels` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_student_levels_actor` FOREIGN KEY (`assessed_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_terms` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `program_id` BIGINT UNSIGNED NOT NULL,
  `level_id` BIGINT UNSIGNED DEFAULT NULL,
  `code` VARCHAR(64) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` MEDIUMTEXT DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'draft',
  `enrollment_open_at` DATETIME DEFAULT NULL,
  `enrollment_close_at` DATETIME DEFAULT NULL,
  `starts_on` DATE NOT NULL,
  `ends_on` DATE NOT NULL,
  `capacity` INT UNSIGNED DEFAULT NULL,
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Taipei',
  `leave_quota` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `leave_cutoff_minutes` INT UNSIGNED NOT NULL DEFAULT 0,
  `makeup_valid_days` SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  `rules_snapshot_json` JSON NOT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_terms_owner_code` (`owner_user_id`, `code`),
  KEY `idx_course_terms_owner_status_dates` (`owner_user_id`, `status`, `starts_on`, `ends_on`, `id`),
  KEY `idx_course_terms_program` (`program_id`, `status`, `starts_on`, `id`),
  CONSTRAINT `fk_course_terms_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_terms_program` FOREIGN KEY (`program_id`) REFERENCES `course_programs` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_terms_level` FOREIGN KEY (`level_id`) REFERENCES `course_levels` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_course_terms_dates` CHECK (`ends_on` >= `starts_on`),
  CONSTRAINT `chk_course_terms_enrollment_window` CHECK (`enrollment_close_at` IS NULL OR `enrollment_open_at` IS NULL OR `enrollment_close_at` >= `enrollment_open_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL `course_052_add_column`('course_sessions', 'program_id', 'BIGINT UNSIGNED NULL AFTER `scenario_id`');
CALL `course_052_add_column`('course_sessions', 'term_id', 'BIGINT UNSIGNED NULL AFTER `program_id`');
CALL `course_052_add_column`('course_sessions', 'session_kind', 'VARCHAR(24) NOT NULL DEFAULT ''COUNT_CARD'' AFTER `term_id`');
CALL `course_052_add_column`('course_sessions', 'term_session_sequence', 'INT UNSIGNED NULL AFTER `session_kind`');
CALL `course_052_add_column`('course_sessions', 'entitlement_required', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER `term_session_sequence`');
CALL `course_052_add_index`('course_sessions', 'idx_course_sessions_term_sequence', 'KEY `idx_course_sessions_term_sequence` (`term_id`, `term_session_sequence`, `starts_at`, `id`)');
CALL `course_052_add_foreign_key`('course_sessions', 'fk_course_sessions_program', 'FOREIGN KEY (`program_id`) REFERENCES `course_programs` (`id`) ON DELETE RESTRICT');
CALL `course_052_add_foreign_key`('course_sessions', 'fk_course_sessions_term', 'FOREIGN KEY (`term_id`) REFERENCES `course_terms` (`id`) ON DELETE RESTRICT');

CREATE TABLE IF NOT EXISTS `course_term_pricing_rules` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `term_id` BIGINT UNSIGNED NOT NULL,
  `pricing_mode` VARCHAR(32) NOT NULL,
  `unit_price` DECIMAL(10,2) DEFAULT NULL,
  `full_price` DECIMAL(10,2) DEFAULT NULL,
  `currency` CHAR(3) NOT NULL DEFAULT 'TWD',
  `valid_from_session_id` BIGINT UNSIGNED DEFAULT NULL,
  `valid_through_session_id` BIGINT UNSIGNED DEFAULT NULL,
  `configuration_json` JSON DEFAULT NULL,
  `priority` INT UNSIGNED NOT NULL DEFAULT 100,
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_term_pricing_identity` (`term_id`, `pricing_mode`, `valid_from_session_id`),
  KEY `idx_course_term_pricing_owner` (`owner_user_id`, `term_id`, `status`, `id`),
  CONSTRAINT `fk_course_term_pricing_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_pricing_term` FOREIGN KEY (`term_id`) REFERENCES `course_terms` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_pricing_from_session` FOREIGN KEY (`valid_from_session_id`) REFERENCES `course_sessions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_pricing_through_session` FOREIGN KEY (`valid_through_session_id`) REFERENCES `course_sessions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_course_term_pricing_mode` CHECK (`pricing_mode` IN ('FULL_TERM', 'PRO_RATA_SESSIONS', 'UNIT_X_REMAINING', 'PRO_RATA_CALENDAR')),
  CONSTRAINT `chk_course_term_pricing_amount` CHECK (`unit_price` IS NOT NULL OR `full_price` IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_term_renewal_rules` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `source_term_id` BIGINT UNSIGNED NOT NULL,
  `target_term_id` BIGINT UNSIGNED NOT NULL,
  `renewal_open_at` DATETIME NOT NULL,
  `renewal_close_at` DATETIME NOT NULL,
  `reserved_capacity` INT UNSIGNED NOT NULL DEFAULT 0,
  `eligibility_json` JSON DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_term_renewal_pair` (`source_term_id`, `target_term_id`),
  KEY `idx_course_term_renewal_owner_window` (`owner_user_id`, `status`, `renewal_open_at`, `renewal_close_at`, `id`),
  CONSTRAINT `fk_course_term_renewal_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_renewal_source` FOREIGN KEY (`source_term_id`) REFERENCES `course_terms` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_renewal_target` FOREIGN KEY (`target_term_id`) REFERENCES `course_terms` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_course_term_renewal_window` CHECK (`renewal_close_at` >= `renewal_open_at`),
  CONSTRAINT `chk_course_term_renewal_distinct` CHECK (`source_term_id` <> `target_term_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_term_quotes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `quote_code` VARCHAR(48) NOT NULL,
  `owner_user_id` CHAR(36) NOT NULL,
  `term_id` BIGINT UNSIGNED NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `student_id` BIGINT UNSIGNED NOT NULL,
  `idempotency_key` VARCHAR(128) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `session_ids_json` JSON NOT NULL,
  `pricing_snapshot_json` JSON NOT NULL,
  `rules_snapshot_json` JSON NOT NULL,
  `total_amount` DECIMAL(10,2) NOT NULL,
  `currency` CHAR(3) NOT NULL DEFAULT 'TWD',
  `status` VARCHAR(24) NOT NULL DEFAULT 'OPEN',
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME DEFAULT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_term_quotes_code` (`quote_code`),
  UNIQUE KEY `uq_course_term_quotes_user_key` (`user_id`, `idempotency_key`),
  KEY `idx_course_term_quotes_owner_status_due` (`owner_user_id`, `status`, `expires_at`, `id`),
  KEY `idx_course_term_quotes_term_student` (`term_id`, `student_id`, `created_at`, `id`),
  CONSTRAINT `fk_course_term_quotes_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_quotes_term` FOREIGN KEY (`term_id`) REFERENCES `course_terms` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_quotes_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_quotes_student` FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_course_term_quotes_amount` CHECK (`total_amount` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_term_enrollments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `enrollment_code` VARCHAR(48) NOT NULL,
  `owner_user_id` CHAR(36) NOT NULL,
  `term_id` BIGINT UNSIGNED NOT NULL,
  `student_id` BIGINT UNSIGNED NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `order_id` BIGINT UNSIGNED DEFAULT NULL,
  `quote_id` BIGINT UNSIGNED DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING_PAYMENT',
  `start_session_id` BIGINT UNSIGNED DEFAULT NULL,
  `quote_snapshot_json` JSON NOT NULL,
  `rules_snapshot_json` JSON NOT NULL,
  `checkout_idempotency_key` VARCHAR(128) NOT NULL,
  `enrolled_at` DATETIME DEFAULT NULL,
  `cancelled_at` DATETIME DEFAULT NULL,
  `cancel_reason` VARCHAR(500) DEFAULT NULL,
  `completed_at` DATETIME DEFAULT NULL,
  `active_student_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` IN ('PENDING_PAYMENT', 'CONFIRMED') THEN `student_id` ELSE NULL END
  ) STORED,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_term_enrollments_code` (`enrollment_code`),
  UNIQUE KEY `uq_course_term_enrollments_checkout_key` (`user_id`, `checkout_idempotency_key`),
  UNIQUE KEY `uq_course_term_enrollments_active_student` (`term_id`, `active_student_id`),
  UNIQUE KEY `uq_course_term_enrollments_order` (`order_id`),
  KEY `idx_course_term_enrollments_owner_status` (`owner_user_id`, `status`, `created_at`, `id`),
  KEY `idx_course_term_enrollments_user` (`user_id`, `created_at`, `id`),
  CONSTRAINT `fk_course_term_enrollments_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_enrollments_term` FOREIGN KEY (`term_id`) REFERENCES `course_terms` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_enrollments_student` FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_enrollments_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_enrollments_order` FOREIGN KEY (`order_id`) REFERENCES `course_orders` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_enrollments_quote` FOREIGN KEY (`quote_id`) REFERENCES `course_term_quotes` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_enrollments_start_session` FOREIGN KEY (`start_session_id`) REFERENCES `course_sessions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_term_session_entitlements` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `enrollment_id` BIGINT UNSIGNED NOT NULL,
  `session_id` BIGINT UNSIGNED NOT NULL,
  `student_id` BIGINT UNSIGNED NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'SCHEDULED',
  `entitlement_kind` VARCHAR(24) NOT NULL DEFAULT 'REGULAR',
  `leave_request_id` BIGINT UNSIGNED DEFAULT NULL,
  `makeup_entitlement_id` BIGINT UNSIGNED DEFAULT NULL,
  `booking_id` BIGINT UNSIGNED DEFAULT NULL,
  `attended_at` DATETIME DEFAULT NULL,
  `resolved_at` DATETIME DEFAULT NULL,
  `resolved_by_user_id` CHAR(36) DEFAULT NULL,
  `resolution_reason` VARCHAR(500) DEFAULT NULL,
  `attendance_idempotency_key` VARCHAR(128) DEFAULT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_term_entitlement_session_kind` (`enrollment_id`, `session_id`, `entitlement_kind`),
  UNIQUE KEY `uq_course_term_entitlement_booking` (`booking_id`),
  KEY `idx_course_term_entitlements_owner_status` (`owner_user_id`, `status`, `session_id`, `id`),
  KEY `idx_course_term_entitlements_session_status` (`session_id`, `status`, `id`),
  CONSTRAINT `fk_course_term_entitlements_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_entitlements_enrollment` FOREIGN KEY (`enrollment_id`) REFERENCES `course_term_enrollments` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_entitlements_session` FOREIGN KEY (`session_id`) REFERENCES `course_sessions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_entitlements_student` FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_entitlements_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_entitlements_resolver` FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_entitlements_booking` FOREIGN KEY (`booking_id`) REFERENCES `course_bookings` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_course_term_entitlement_status` CHECK (`status` IN ('SCHEDULED', 'LEAVE', 'LEAVE_PENDING', 'LEAVE_LOCKED', 'ATTENDED', 'ABSENT', 'CANCELLED')),
  CONSTRAINT `chk_course_term_entitlement_kind` CHECK (`entitlement_kind` IN ('REGULAR', 'MAKEUP'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_term_waitlist_entries` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `term_id` BIGINT UNSIGNED NOT NULL,
  `student_id` BIGINT UNSIGNED NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'WAITING',
  `priority` INT UNSIGNED NOT NULL DEFAULT 100,
  `joined_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cancelled_at` DATETIME DEFAULT NULL,
  `idempotency_key` VARCHAR(128) NOT NULL,
  `active_student_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` IN ('WAITING', 'OFFERED') THEN `student_id` ELSE NULL END
  ) STORED,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_term_waitlist_active_student` (`term_id`, `active_student_id`),
  UNIQUE KEY `uq_course_term_waitlist_user_key` (`user_id`, `idempotency_key`),
  KEY `idx_course_term_waitlist_fifo` (`owner_user_id`, `term_id`, `status`, `priority`, `joined_at`, `id`),
  CONSTRAINT `fk_course_term_waitlist_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_waitlist_term` FOREIGN KEY (`term_id`) REFERENCES `course_terms` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_waitlist_student` FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_waitlist_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `chk_course_term_waitlist_status` CHECK (`status` IN ('WAITING', 'OFFERED', 'ACCEPTED', 'EXPIRED', 'CANCELLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_seat_allocations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `term_id` BIGINT UNSIGNED NOT NULL,
  `student_id` BIGINT UNSIGNED DEFAULT NULL,
  `enrollment_id` BIGINT UNSIGNED DEFAULT NULL,
  `order_id` BIGINT UNSIGNED DEFAULT NULL,
  `quote_id` BIGINT UNSIGNED DEFAULT NULL,
  `waitlist_entry_id` BIGINT UNSIGNED DEFAULT NULL,
  `user_id` CHAR(36) NOT NULL,
  `allocation_type` VARCHAR(32) NOT NULL DEFAULT 'CHECKOUT_HOLD',
  `status` VARCHAR(24) NOT NULL DEFAULT 'HELD',
  `expires_at` DATETIME DEFAULT NULL,
  `released_at` DATETIME DEFAULT NULL,
  `release_reason` VARCHAR(500) DEFAULT NULL,
  `active_student_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` IN ('HELD', 'ACTIVE', 'CONFIRMED') THEN `student_id` ELSE NULL END
  ) STORED,
  `active_order_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` IN ('HELD', 'ACTIVE', 'CONFIRMED') THEN `order_id` ELSE NULL END
  ) STORED,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_seat_active_student` (`term_id`, `active_student_id`),
  UNIQUE KEY `uq_course_seat_active_order` (`active_order_id`),
  KEY `idx_course_seat_capacity` (`owner_user_id`, `term_id`, `status`, `expires_at`, `id`),
  KEY `idx_course_seat_enrollment` (`enrollment_id`, `id`),
  CONSTRAINT `fk_course_seat_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_seat_term` FOREIGN KEY (`term_id`) REFERENCES `course_terms` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_seat_student` FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_seat_enrollment` FOREIGN KEY (`enrollment_id`) REFERENCES `course_term_enrollments` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_seat_order` FOREIGN KEY (`order_id`) REFERENCES `course_orders` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_seat_quote` FOREIGN KEY (`quote_id`) REFERENCES `course_term_quotes` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_seat_waitlist` FOREIGN KEY (`waitlist_entry_id`) REFERENCES `course_term_waitlist_entries` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_seat_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `chk_course_seat_allocation_type` CHECK (`allocation_type` IN ('CHECKOUT_HOLD', 'WAITLIST_OFFER', 'ENROLLMENT', 'RENEWAL', 'MAKEUP_INSURANCE')),
  CONSTRAINT `chk_course_seat_status` CHECK (`status` IN ('HELD', 'ACTIVE', 'CONFIRMED', 'RELEASED', 'EXPIRED', 'CANCELLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_term_seat_offers` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `offer_code` VARCHAR(48) NOT NULL,
  `owner_user_id` CHAR(36) NOT NULL,
  `waitlist_entry_id` BIGINT UNSIGNED NOT NULL,
  `term_id` BIGINT UNSIGNED NOT NULL,
  `student_id` BIGINT UNSIGNED NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `seat_allocation_id` BIGINT UNSIGNED NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'OFFERED',
  `expires_at` DATETIME NOT NULL,
  `accepted_at` DATETIME DEFAULT NULL,
  `active_waitlist_entry_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` = 'OFFERED' THEN `waitlist_entry_id` ELSE NULL END
  ) STORED,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_term_seat_offers_code` (`offer_code`),
  UNIQUE KEY `uq_course_term_seat_offers_active_waitlist` (`active_waitlist_entry_id`),
  UNIQUE KEY `uq_course_term_seat_offers_allocation` (`seat_allocation_id`),
  KEY `idx_course_term_seat_offers_due` (`owner_user_id`, `status`, `expires_at`, `id`),
  CONSTRAINT `fk_course_term_seat_offers_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_seat_offers_waitlist` FOREIGN KEY (`waitlist_entry_id`) REFERENCES `course_term_waitlist_entries` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_seat_offers_term` FOREIGN KEY (`term_id`) REFERENCES `course_terms` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_seat_offers_student` FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_seat_offers_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_seat_offers_allocation` FOREIGN KEY (`seat_allocation_id`) REFERENCES `course_seat_allocations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_course_term_seat_offer_status` CHECK (`status` IN ('OFFERED', 'ACCEPTED', 'EXPIRED', 'CANCELLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_term_leave_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `entitlement_id` BIGINT UNSIGNED NOT NULL,
  `enrollment_id` BIGINT UNSIGNED NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'REQUESTED',
  `requested_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cancel_close_at` DATETIME NOT NULL,
  `reason` VARCHAR(500) DEFAULT NULL,
  `cancelled_at` DATETIME DEFAULT NULL,
  `approved_at` DATETIME DEFAULT NULL,
  `idempotency_key` VARCHAR(128) NOT NULL,
  `cancel_idempotency_key` VARCHAR(128) DEFAULT NULL,
  `locked_at` DATETIME DEFAULT NULL,
  `active_entitlement_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` IN ('REQUESTED', 'APPROVED', 'LOCKED') THEN `entitlement_id` ELSE NULL END
  ) STORED,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_term_leave_active_entitlement` (`active_entitlement_id`),
  UNIQUE KEY `uq_course_term_leave_request_key` (`user_id`, `idempotency_key`),
  KEY `idx_course_term_leave_owner_status_due` (`owner_user_id`, `status`, `cancel_close_at`, `id`),
  CONSTRAINT `fk_course_term_leave_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_leave_entitlement` FOREIGN KEY (`entitlement_id`) REFERENCES `course_term_session_entitlements` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_leave_enrollment` FOREIGN KEY (`enrollment_id`) REFERENCES `course_term_enrollments` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_leave_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `chk_course_term_leave_status` CHECK (`status` IN ('REQUESTED', 'APPROVED', 'LOCKED', 'CANCELLED', 'REJECTED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_makeup_entitlements` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(48) NOT NULL,
  `owner_user_id` CHAR(36) NOT NULL,
  `source_entitlement_id` BIGINT UNSIGNED NOT NULL,
  `leave_request_id` BIGINT UNSIGNED NOT NULL,
  `enrollment_id` BIGINT UNSIGNED NOT NULL,
  `student_id` BIGINT UNSIGNED NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'AVAILABLE',
  `valid_until` DATETIME NOT NULL,
  `used_booking_id` BIGINT UNSIGNED DEFAULT NULL,
  `requires_insurance` TINYINT(1) NOT NULL DEFAULT 0,
  `revoked_at` DATETIME DEFAULT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_makeup_entitlements_code` (`code`),
  UNIQUE KEY `uq_course_makeup_entitlements_source` (`source_entitlement_id`),
  UNIQUE KEY `uq_course_makeup_entitlements_leave` (`leave_request_id`),
  KEY `idx_course_makeup_entitlements_owner_status` (`owner_user_id`, `status`, `valid_until`, `id`),
  KEY `idx_course_makeup_entitlements_user` (`user_id`, `status`, `valid_until`, `id`),
  CONSTRAINT `fk_course_makeup_entitlements_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_makeup_entitlements_source` FOREIGN KEY (`source_entitlement_id`) REFERENCES `course_term_session_entitlements` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_entitlements_leave` FOREIGN KEY (`leave_request_id`) REFERENCES `course_term_leave_requests` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_entitlements_enrollment` FOREIGN KEY (`enrollment_id`) REFERENCES `course_term_enrollments` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_entitlements_student` FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_entitlements_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `chk_course_makeup_entitlement_status` CHECK (`status` IN ('PENDING_INSURANCE', 'AVAILABLE', 'RESERVED', 'BOOKED', 'USED', 'EXPIRED', 'REVOKED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_makeup_routes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `source_term_id` BIGINT UNSIGNED NOT NULL,
  `target_session_id` BIGINT UNSIGNED NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `capacity_override` INT UNSIGNED DEFAULT NULL,
  `booking_open_at` DATETIME DEFAULT NULL,
  `booking_close_at` DATETIME DEFAULT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_makeup_routes_target` (`source_term_id`, `target_session_id`),
  KEY `idx_course_makeup_routes_owner_status` (`owner_user_id`, `status`, `target_session_id`, `id`),
  CONSTRAINT `fk_course_makeup_routes_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_makeup_routes_source_term` FOREIGN KEY (`source_term_id`) REFERENCES `course_terms` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_routes_target_session` FOREIGN KEY (`target_session_id`) REFERENCES `course_sessions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_course_makeup_routes_window` CHECK (`booking_close_at` IS NULL OR `booking_open_at` IS NULL OR `booking_close_at` >= `booking_open_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_makeup_bookings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(48) NOT NULL,
  `owner_user_id` CHAR(36) NOT NULL,
  `makeup_entitlement_id` BIGINT UNSIGNED NOT NULL,
  `session_id` BIGINT UNSIGNED NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `seat_allocation_id` BIGINT UNSIGNED DEFAULT NULL,
  `booking_id` BIGINT UNSIGNED DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'BOOKED',
  `booked_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cancelled_at` DATETIME DEFAULT NULL,
  `attended_at` DATETIME DEFAULT NULL,
  `idempotency_key` VARCHAR(128) NOT NULL,
  `active_entitlement_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` IN ('RESERVED', 'BOOKED') THEN `makeup_entitlement_id` ELSE NULL END
  ) STORED,
  `active_user_id` CHAR(36) GENERATED ALWAYS AS (
    CASE WHEN `status` IN ('RESERVED', 'BOOKED') THEN `user_id` ELSE NULL END
  ) STORED,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_makeup_bookings_code` (`code`),
  UNIQUE KEY `uq_course_makeup_bookings_active_entitlement` (`active_entitlement_id`),
  UNIQUE KEY `uq_course_makeup_bookings_active_session_user` (`session_id`, `active_user_id`),
  UNIQUE KEY `uq_course_makeup_bookings_seat` (`seat_allocation_id`),
  UNIQUE KEY `uq_course_makeup_bookings_booking` (`booking_id`),
  KEY `idx_course_makeup_bookings_owner_status` (`owner_user_id`, `status`, `session_id`, `id`),
  CONSTRAINT `fk_course_makeup_bookings_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_makeup_bookings_entitlement` FOREIGN KEY (`makeup_entitlement_id`) REFERENCES `course_makeup_entitlements` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_bookings_session` FOREIGN KEY (`session_id`) REFERENCES `course_sessions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_bookings_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_bookings_seat` FOREIGN KEY (`seat_allocation_id`) REFERENCES `course_seat_allocations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_bookings_booking` FOREIGN KEY (`booking_id`) REFERENCES `course_bookings` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_course_makeup_booking_status` CHECK (`status` IN ('RESERVED', 'BOOKED', 'CANCELLED', 'ATTENDED', 'NO_SHOW'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cyclic business references are added after both sides exist. Restrictive
-- deletes preserve the entitlement/leave audit chain.
CALL `course_052_add_foreign_key`('course_term_session_entitlements', 'fk_course_term_entitlements_leave', 'FOREIGN KEY (`leave_request_id`) REFERENCES `course_term_leave_requests` (`id`) ON DELETE RESTRICT');
CALL `course_052_add_foreign_key`('course_term_session_entitlements', 'fk_course_term_entitlements_makeup', 'FOREIGN KEY (`makeup_entitlement_id`) REFERENCES `course_makeup_entitlements` (`id`) ON DELETE RESTRICT');
CALL `course_052_add_foreign_key`('course_makeup_entitlements', 'fk_course_makeup_entitlements_used_booking', 'FOREIGN KEY (`used_booking_id`) REFERENCES `course_makeup_bookings` (`id`) ON DELETE RESTRICT');

CALL `course_052_add_column`('course_settings', 'fixed_term_enabled', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `count_card_parity_enabled`');

DROP PROCEDURE IF EXISTS `course_052_add_column`;
DROP PROCEDURE IF EXISTS `course_052_add_foreign_key`;
DROP PROCEDURE IF EXISTS `course_052_add_index`;

INSERT IGNORE INTO `course_schema_versions` (`version`, `description`)
VALUES ('052_course_fixed_term_productization', 'Fixed-term programs, enrollment, capacity, per-session rights, leave and makeup');

SELECT 'Migration 052_course_fixed_term_productization applied' AS msg;
