-- Migration 053: fixed-term payments, count-card payment instruments,
-- open-water makeup insurance and durable notifications.
--
-- Payment confirmation services must consume instruments, fulfill orders,
-- confirm seats and materialize fixed-term rights in one DB transaction. The
-- outbox is written in that transaction; delivery happens only after commit.

CREATE TABLE IF NOT EXISTS `course_schema_versions` (
  `version` VARCHAR(80) NOT NULL,
  `description` VARCHAR(255) NOT NULL,
  `applied_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM `course_schema_versions`
 WHERE `version` = '053_course_term_payments_notifications';

DROP PROCEDURE IF EXISTS `course_053_add_column`;
DELIMITER $$
CREATE PROCEDURE `course_053_add_column`(
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
    SET @course_053_column_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD COLUMN `', REPLACE(p_column_name, '`', '``'), '` ', p_definition
    );
    PREPARE course_053_column_stmt FROM @course_053_column_sql;
    EXECUTE course_053_column_stmt;
    DEALLOCATE PREPARE course_053_column_stmt;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `course_053_make_nullable`;
DELIMITER $$
CREATE PROCEDURE `course_053_make_nullable`(
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
    SET @course_053_nullable_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` MODIFY COLUMN `', REPLACE(p_column_name, '`', '``'), '` ', p_definition
    );
    PREPARE course_053_nullable_stmt FROM @course_053_nullable_sql;
    EXECUTE course_053_nullable_stmt;
    DEALLOCATE PREPARE course_053_nullable_stmt;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `course_053_add_index`;
DELIMITER $$
CREATE PROCEDURE `course_053_add_index`(
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
    SET @course_053_index_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'), '` ADD ', p_definition
    );
    PREPARE course_053_index_stmt FROM @course_053_index_sql;
    EXECUTE course_053_index_stmt;
    DEALLOCATE PREPARE course_053_index_stmt;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `course_053_add_check`;
DELIMITER $$
CREATE PROCEDURE `course_053_add_check`(
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
    SET @course_053_check_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD CONSTRAINT `', REPLACE(p_constraint_name, '`', '``'),
      '` CHECK (', p_definition, ')'
    );
    PREPARE course_053_check_stmt FROM @course_053_check_sql;
    EXECUTE course_053_check_stmt;
    DEALLOCATE PREPARE course_053_check_stmt;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `course_053_drop_check`;
DELIMITER $$
CREATE PROCEDURE `course_053_drop_check`(
  IN p_table_name VARCHAR(64),
  IN p_constraint_name VARCHAR(64)
)
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND CONSTRAINT_NAME = p_constraint_name
       AND CONSTRAINT_TYPE = 'CHECK'
  ) THEN
    SET @course_053_drop_check_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` DROP CHECK `', REPLACE(p_constraint_name, '`', '``'), '`'
    );
    PREPARE course_053_drop_check_stmt FROM @course_053_drop_check_sql;
    EXECUTE course_053_drop_check_stmt;
    DEALLOCATE PREPARE course_053_drop_check_stmt;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `course_053_add_foreign_key`;
DELIMITER $$
CREATE PROCEDURE `course_053_add_foreign_key`(
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
    SET @course_053_fk_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD CONSTRAINT `', REPLACE(p_constraint_name, '`', '``'), '` ', p_definition
    );
    PREPARE course_053_fk_stmt FROM @course_053_fk_sql;
    EXECUTE course_053_fk_stmt;
    DEALLOCATE PREPARE course_053_fk_stmt;
  END IF;
END$$
DELIMITER ;

-- Existing count-pass orders default to count_pass/bank_transfer. Fixed-term
-- orders may have no ShopProduct and are linked to a term/quote/enrollment.
CALL `course_053_add_column`('course_orders', 'owner_user_id', 'CHAR(36) NULL AFTER `checkout_batch_id`');
CALL `course_053_add_column`('course_orders', 'term_id', 'BIGINT UNSIGNED NULL AFTER `product_id`');
CALL `course_053_add_column`('course_orders', 'enrollment_id', 'BIGINT UNSIGNED NULL AFTER `term_id`');
CALL `course_053_add_column`('course_orders', 'quote_id', 'BIGINT UNSIGNED NULL AFTER `enrollment_id`');
CALL `course_053_add_column`('course_orders', 'order_purpose', 'VARCHAR(32) NOT NULL DEFAULT ''COUNT_PASS'' AFTER `quote_id`');
CALL `course_053_add_column`('course_orders', 'payment_method', 'VARCHAR(32) NOT NULL DEFAULT ''BANK_TRANSFER'' AFTER `order_purpose`');
CALL `course_053_add_column`('course_orders', 'currency', 'CHAR(3) NOT NULL DEFAULT ''TWD'' AFTER `total_amount`');
CALL `course_053_add_column`('course_orders', 'pay_by_at', 'DATETIME NULL AFTER `remittance_last5`');
CALL `course_053_add_column`('course_orders', 'cancelled_at', 'DATETIME NULL AFTER `pay_by_at`');
CALL `course_053_add_column`('course_orders', 'cancel_reason', 'VARCHAR(500) NULL AFTER `cancelled_at`');
CALL `course_053_make_nullable`('course_orders', 'user_id', 'CHAR(36) NULL');
CALL `course_053_make_nullable`('course_orders', 'product_id', 'INT UNSIGNED NULL');

UPDATE `course_orders` o
LEFT JOIN `course_products` p ON p.`id` = o.`product_id`
   SET o.`owner_user_id` = COALESCE(o.`owner_user_id`, p.`owner_user_id`)
 WHERE o.`id` >= 1
   AND o.`owner_user_id` IS NULL;

CALL `course_053_add_check`('course_orders', 'chk_course_orders_purpose', '`order_purpose` IN (''COUNT_PASS'', ''TERM_ENROLLMENT'', ''MAKEUP_INSURANCE'')');
-- Existing installations may already have the pre-053 BANK_TRANSFER/
-- COURSE_TICKET check. Recreate it so zero-payable trial discounts can fulfill
-- atomically with the explicit NONE method on both upgrade and fresh paths.
CALL `course_053_drop_check`('course_orders', 'chk_course_orders_payment_method');
CALL `course_053_add_check`('course_orders', 'chk_course_orders_payment_method', '`payment_method` IN (''BANK_TRANSFER'', ''COURSE_TICKET'', ''NONE'')');
CALL `course_053_add_index`('course_orders', 'idx_course_orders_owner_purpose', 'KEY `idx_course_orders_owner_purpose` (`owner_user_id`, `order_purpose`, `created_at`, `id`)');
CALL `course_053_add_index`('course_orders', 'idx_course_orders_payment_due', 'KEY `idx_course_orders_payment_due` (`payment_status`, `pay_by_at`, `id`)');
CALL `course_053_add_index`('course_orders', 'uq_course_orders_enrollment', 'UNIQUE KEY `uq_course_orders_enrollment` (`enrollment_id`)');
CALL `course_053_add_index`('course_orders', 'uq_course_orders_quote', 'UNIQUE KEY `uq_course_orders_quote` (`quote_id`)');
CALL `course_053_add_foreign_key`('course_orders', 'fk_course_orders_owner', 'FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE');
CALL `course_053_add_foreign_key`('course_orders', 'fk_course_orders_term', 'FOREIGN KEY (`term_id`) REFERENCES `course_terms` (`id`) ON DELETE RESTRICT');
CALL `course_053_add_foreign_key`('course_orders', 'fk_course_orders_enrollment', 'FOREIGN KEY (`enrollment_id`) REFERENCES `course_term_enrollments` (`id`) ON DELETE RESTRICT');
CALL `course_053_add_foreign_key`('course_orders', 'fk_course_orders_quote', 'FOREIGN KEY (`quote_id`) REFERENCES `course_term_quotes` (`id`) ON DELETE RESTRICT');

CREATE TABLE IF NOT EXISTS `course_payment_submissions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `order_id` BIGINT UNSIGNED NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `last5` CHAR(5) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'REVIEWING',
  `idempotency_key` VARCHAR(128) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `submitted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reviewed_by` CHAR(36) DEFAULT NULL,
  `reviewed_at` DATETIME DEFAULT NULL,
  `reason` VARCHAR(500) DEFAULT NULL,
  `active_order_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` IN ('SUBMITTED', 'REVIEWING') THEN `order_id` ELSE NULL END
  ) STORED,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_payment_submission_active_order` (`active_order_id`),
  UNIQUE KEY `uq_course_payment_submission_user_key` (`user_id`, `idempotency_key`),
  KEY `idx_course_payment_submission_review` (`owner_user_id`, `status`, `submitted_at`, `id`),
  KEY `idx_course_payment_submission_user` (`user_id`, `submitted_at`, `id`),
  CONSTRAINT `fk_course_payment_submission_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_payment_submission_order` FOREIGN KEY (`order_id`) REFERENCES `course_orders` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_payment_submission_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_payment_submission_reviewer` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `chk_course_payment_submission_status` CHECK (`status` IN ('SUBMITTED', 'REVIEWING', 'CONFIRMED', 'REJECTED', 'CANCELLED')),
  CONSTRAINT `chk_course_payment_submission_last5` CHECK (CHAR_LENGTH(`last5`) = 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_order_payment_instruments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `order_id` BIGINT UNSIGNED NOT NULL,
  `enrollment_id` BIGINT UNSIGNED DEFAULT NULL,
  `instrument_type` VARCHAR(32) NOT NULL,
  `course_ticket_id` BIGINT UNSIGNED NOT NULL,
  `hold_id` BIGINT UNSIGNED DEFAULT NULL,
  `units_applied` INT UNSIGNED NOT NULL,
  `amount_applied` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `currency` CHAR(3) NOT NULL DEFAULT 'TWD',
  `status` VARCHAR(24) NOT NULL DEFAULT 'RESERVED',
  `idempotency_key` VARCHAR(128) NOT NULL,
  `usage_event_id` BIGINT UNSIGNED DEFAULT NULL,
  `reversed_usage_event_id` BIGINT UNSIGNED DEFAULT NULL,
  `policy_snapshot_json` JSON NOT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_order_instrument_type` (`order_id`, `instrument_type`),
  UNIQUE KEY `uq_course_order_instrument_user_key` (`order_id`, `idempotency_key`),
  UNIQUE KEY `uq_course_order_instrument_hold` (`hold_id`),
  UNIQUE KEY `uq_course_order_instrument_usage` (`usage_event_id`),
  KEY `idx_course_order_instrument_ticket_status` (`course_ticket_id`, `status`, `id`),
  CONSTRAINT `fk_course_order_instrument_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_order_instrument_order` FOREIGN KEY (`order_id`) REFERENCES `course_orders` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_order_instrument_enrollment` FOREIGN KEY (`enrollment_id`) REFERENCES `course_term_enrollments` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_order_instrument_ticket` FOREIGN KEY (`course_ticket_id`) REFERENCES `course_tickets` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_order_instrument_hold` FOREIGN KEY (`hold_id`) REFERENCES `course_ticket_holds` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_order_instrument_usage` FOREIGN KEY (`usage_event_id`) REFERENCES `course_usage_events` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_order_instrument_reversal` FOREIGN KEY (`reversed_usage_event_id`) REFERENCES `course_usage_events` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_course_order_instrument_type` CHECK (`instrument_type` IN ('TRIAL_DISCOUNT', 'COURSE_TICKET')),
  CONSTRAINT `chk_course_order_instrument_status` CHECK (`status` IN ('RESERVED', 'CONSUMED', 'RELEASED', 'REVERSED')),
  CONSTRAINT `chk_course_order_instrument_uses` CHECK (`units_applied` >= 0),
  CONSTRAINT `chk_course_order_instrument_amount` CHECK (`amount_applied` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_order_discounts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `order_id` BIGINT UNSIGNED NOT NULL,
  `payment_instrument_id` BIGINT UNSIGNED NOT NULL,
  `discount_type` VARCHAR(32) NOT NULL DEFAULT 'trial_discount',
  `amount` DECIMAL(10,2) NOT NULL,
  `currency` CHAR(3) NOT NULL DEFAULT 'TWD',
  `status` VARCHAR(24) NOT NULL DEFAULT 'reserved',
  `discount_snapshot_json` JSON NOT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_order_discount_instrument` (`payment_instrument_id`),
  UNIQUE KEY `uq_course_order_discount_type` (`order_id`, `discount_type`),
  KEY `idx_course_order_discounts_owner` (`owner_user_id`, `status`, `created_at`, `id`),
  CONSTRAINT `fk_course_order_discounts_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_order_discounts_order` FOREIGN KEY (`order_id`) REFERENCES `course_orders` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_order_discounts_instrument` FOREIGN KEY (`payment_instrument_id`) REFERENCES `course_order_payment_instruments` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_course_order_discount_amount` CHECK (`amount` >= 0),
  CONSTRAINT `chk_course_order_discount_status` CHECK (`status` IN ('reserved', 'applied', 'released', 'reversed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_makeup_insurance_policies` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `target_session_id` BIGINT UNSIGNED NOT NULL,
  `fee_product_id` INT UNSIGNED DEFAULT NULL,
  `required` TINYINT(1) NOT NULL DEFAULT 1,
  `fee_amount` DECIMAL(10,2) NOT NULL,
  `currency` CHAR(3) NOT NULL DEFAULT 'TWD',
  `payment_hold_minutes` INT UNSIGNED NOT NULL DEFAULT 1440,
  `cancel_close_at` DATETIME DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `active_session_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` = 'active' THEN `target_session_id` ELSE NULL END
  ) STORED,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_makeup_insurance_active_session` (`active_session_id`),
  KEY `idx_course_makeup_insurance_owner_status` (`owner_user_id`, `status`, `target_session_id`, `id`),
  CONSTRAINT `fk_course_makeup_insurance_policy_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_makeup_insurance_policy_session` FOREIGN KEY (`target_session_id`) REFERENCES `course_sessions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_insurance_policy_product` FOREIGN KEY (`fee_product_id`) REFERENCES `course_products` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_course_makeup_insurance_fee` CHECK (`fee_amount` >= 0),
  CONSTRAINT `chk_course_makeup_insurance_hold` CHECK (`payment_hold_minutes` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_makeup_insurance_coverages` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(48) NOT NULL,
  `owner_user_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `policy_id` BIGINT UNSIGNED NOT NULL,
  `makeup_entitlement_id` BIGINT UNSIGNED NOT NULL,
  `makeup_booking_id` BIGINT UNSIGNED DEFAULT NULL,
  `seat_allocation_id` BIGINT UNSIGNED NOT NULL,
  `order_id` BIGINT UNSIGNED DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending_payment',
  `idempotency_key` VARCHAR(128) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `fee_snapshot_json` JSON NOT NULL,
  `pay_by_at` DATETIME NOT NULL,
  `effective_at` DATETIME DEFAULT NULL,
  `cancelled_at` DATETIME DEFAULT NULL,
  `refunded_at` DATETIME DEFAULT NULL,
  `active_entitlement_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` IN ('pending_payment', 'reviewing', 'active') THEN `makeup_entitlement_id` ELSE NULL END
  ) STORED,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_makeup_insurance_coverages_code` (`code`),
  UNIQUE KEY `uq_course_makeup_insurance_user_key` (`user_id`, `idempotency_key`),
  UNIQUE KEY `uq_course_makeup_insurance_active_entitlement` (`active_entitlement_id`),
  UNIQUE KEY `uq_course_makeup_insurance_booking` (`makeup_booking_id`),
  UNIQUE KEY `uq_course_makeup_insurance_seat` (`seat_allocation_id`),
  UNIQUE KEY `uq_course_makeup_insurance_order` (`order_id`),
  KEY `idx_course_makeup_insurance_due` (`owner_user_id`, `status`, `pay_by_at`, `id`),
  CONSTRAINT `fk_course_makeup_insurance_coverage_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_makeup_insurance_coverage_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_makeup_insurance_coverage_policy` FOREIGN KEY (`policy_id`) REFERENCES `course_makeup_insurance_policies` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_insurance_coverage_entitlement` FOREIGN KEY (`makeup_entitlement_id`) REFERENCES `course_makeup_entitlements` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_insurance_coverage_booking` FOREIGN KEY (`makeup_booking_id`) REFERENCES `course_makeup_bookings` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_insurance_coverage_seat` FOREIGN KEY (`seat_allocation_id`) REFERENCES `course_seat_allocations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_insurance_coverage_order` FOREIGN KEY (`order_id`) REFERENCES `course_orders` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_course_makeup_insurance_coverage_status` CHECK (`status` IN ('pending_payment', 'reviewing', 'active', 'cancelled', 'expired', 'refunded'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A makeup-insurance hold is scoped to the target session, not to the fixed
-- term's enrollment capacity. Nullable guarded columns keep partially applied
-- 053 databases rerunnable while all new runtime writes provide the values.
CALL `course_053_add_column`('course_seat_allocations', 'session_id', 'BIGINT UNSIGNED NULL AFTER `term_id`');
CALL `course_053_add_index`('course_seat_allocations', 'idx_course_seat_session_capacity', 'KEY `idx_course_seat_session_capacity` (`owner_user_id`, `session_id`, `allocation_type`, `status`, `expires_at`, `id`)');
CALL `course_053_add_foreign_key`('course_seat_allocations', 'fk_course_seat_session', 'FOREIGN KEY (`session_id`) REFERENCES `course_sessions` (`id`) ON DELETE RESTRICT');
CALL `course_053_add_column`('course_makeup_insurance_coverages', 'user_id', 'CHAR(36) NULL AFTER `owner_user_id`');
CALL `course_053_add_column`('course_makeup_insurance_coverages', 'idempotency_key', 'VARCHAR(128) NULL AFTER `status`');
CALL `course_053_add_column`('course_makeup_insurance_coverages', 'request_hash', 'CHAR(64) NULL AFTER `idempotency_key`');
CALL `course_053_add_index`('course_makeup_insurance_coverages', 'uq_course_makeup_insurance_user_key', 'UNIQUE KEY `uq_course_makeup_insurance_user_key` (`user_id`, `idempotency_key`)');
CALL `course_053_add_foreign_key`('course_makeup_insurance_coverages', 'fk_course_makeup_insurance_coverage_user', 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE');

CALL `course_053_add_column`('course_orders', 'insurance_coverage_id', 'BIGINT UNSIGNED NULL AFTER `quote_id`');
CALL `course_053_add_index`('course_orders', 'uq_course_orders_insurance_coverage', 'UNIQUE KEY `uq_course_orders_insurance_coverage` (`insurance_coverage_id`)');
CALL `course_053_add_foreign_key`('course_orders', 'fk_course_orders_insurance_coverage', 'FOREIGN KEY (`insurance_coverage_id`) REFERENCES `course_makeup_insurance_coverages` (`id`) ON DELETE RESTRICT');

CREATE TABLE IF NOT EXISTS `course_user_notifications` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `event_type` VARCHAR(64) NOT NULL,
  `dedupe_key` VARCHAR(191) NOT NULL,
  `entity_type` VARCHAR(64) DEFAULT NULL,
  `entity_id` VARCHAR(128) DEFAULT NULL,
  `title` VARCHAR(255) NOT NULL,
  `body` TEXT NOT NULL,
  `action_url` VARCHAR(1000) DEFAULT NULL,
  `payload_json` JSON DEFAULT NULL,
  `read_at` DATETIME DEFAULT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_user_notifications_dedupe` (`dedupe_key`),
  KEY `idx_course_user_notifications_inbox` (`user_id`, `read_at`, `created_at`, `id`),
  KEY `idx_course_user_notifications_owner_event` (`owner_user_id`, `event_type`, `created_at`, `id`),
  CONSTRAINT `fk_course_user_notifications_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_user_notifications_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_notification_outbox` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) DEFAULT NULL,
  `user_id` CHAR(36) DEFAULT NULL,
  `event_type` VARCHAR(64) NOT NULL,
  `dedupe_key` VARCHAR(191) NOT NULL,
  `payload_json` JSON NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  `attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `available_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `locked_at` DATETIME DEFAULT NULL,
  `sent_at` DATETIME DEFAULT NULL,
  `last_error` TEXT DEFAULT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_notification_outbox_dedupe` (`dedupe_key`),
  KEY `idx_course_notification_outbox_due` (`status`, `available_at`, `id`),
  KEY `idx_course_notification_outbox_owner_event` (`owner_user_id`, `event_type`, `created_at`, `id`),
  CONSTRAINT `fk_course_notification_outbox_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_notification_outbox_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `chk_course_notification_outbox_status` CHECK (`status` IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'DEAD'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL `course_053_add_column`('course_settings', 'advanced_payments_enabled', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `fixed_term_enabled`');

DROP PROCEDURE IF EXISTS `course_053_add_column`;
DROP PROCEDURE IF EXISTS `course_053_make_nullable`;
DROP PROCEDURE IF EXISTS `course_053_add_index`;
DROP PROCEDURE IF EXISTS `course_053_add_check`;
DROP PROCEDURE IF EXISTS `course_053_drop_check`;
DROP PROCEDURE IF EXISTS `course_053_add_foreign_key`;

INSERT IGNORE INTO `course_schema_versions` (`version`, `description`)
VALUES ('053_course_term_payments_notifications', 'Fixed-term remittance, course-ticket instruments, makeup insurance and durable notifications');

SELECT 'Migration 053_course_term_payments_notifications applied' AS msg;
