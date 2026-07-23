-- Migration 045: course multi-tenant ownership, buyer contact snapshot and
-- operation-scoped request idempotency.
--
-- Existing course products and sessions intentionally remain platform-owned
-- (owner_user_id IS NULL). Every ALTER is guarded so this migration is safe to
-- run more than once and it does not require disabling SQL_SAFE_UPDATES.

SET @course_products_owner_column_exists := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'course_products'
     AND COLUMN_NAME = 'owner_user_id'
);
SET @course_products_owner_column_sql := IF(
  @course_products_owner_column_exists = 0,
  'ALTER TABLE `course_products` ADD COLUMN `owner_user_id` CHAR(36) NULL AFTER `id`',
  'SELECT 1'
);
PREPARE course_products_owner_column_stmt FROM @course_products_owner_column_sql;
EXECUTE course_products_owner_column_stmt;
DEALLOCATE PREPARE course_products_owner_column_stmt;

SET @course_sessions_owner_column_exists := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'course_sessions'
     AND COLUMN_NAME = 'owner_user_id'
);
SET @course_sessions_owner_column_sql := IF(
  @course_sessions_owner_column_exists = 0,
  'ALTER TABLE `course_sessions` ADD COLUMN `owner_user_id` CHAR(36) NULL AFTER `id`',
  'SELECT 1'
);
PREPARE course_sessions_owner_column_stmt FROM @course_sessions_owner_column_sql;
EXECUTE course_sessions_owner_column_stmt;
DEALLOCATE PREPARE course_sessions_owner_column_stmt;

SET @course_orders_buyer_phone_column_exists := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'course_orders'
     AND COLUMN_NAME = 'buyer_phone'
);
SET @course_orders_buyer_phone_column_sql := IF(
  @course_orders_buyer_phone_column_exists = 0,
  'ALTER TABLE `course_orders` ADD COLUMN `buyer_phone` VARCHAR(20) NULL AFTER `buyer_email`',
  'SELECT 1'
);
PREPARE course_orders_buyer_phone_column_stmt FROM @course_orders_buyer_phone_column_sql;
EXECUTE course_orders_buyer_phone_column_stmt;
DEALLOCATE PREPARE course_orders_buyer_phone_column_stmt;

SET @course_products_owner_status_index_exists := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'course_products'
     AND INDEX_NAME = 'idx_course_products_owner_status_sort'
);
SET @course_products_owner_status_index_sql := IF(
  @course_products_owner_status_index_exists = 0,
  'ALTER TABLE `course_products` ADD KEY `idx_course_products_owner_status_sort` (`owner_user_id`, `status`, `sort_order`, `id`)',
  'SELECT 1'
);
PREPARE course_products_owner_status_index_stmt FROM @course_products_owner_status_index_sql;
EXECUTE course_products_owner_status_index_stmt;
DEALLOCATE PREPARE course_products_owner_status_index_stmt;

SET @course_sessions_owner_status_index_exists := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'course_sessions'
     AND INDEX_NAME = 'idx_course_sessions_owner_status_time'
);
SET @course_sessions_owner_status_index_sql := IF(
  @course_sessions_owner_status_index_exists = 0,
  'ALTER TABLE `course_sessions` ADD KEY `idx_course_sessions_owner_status_time` (`owner_user_id`, `status`, `starts_at`, `id`)',
  'SELECT 1'
);
PREPARE course_sessions_owner_status_index_stmt FROM @course_sessions_owner_status_index_sql;
EXECUTE course_sessions_owner_status_index_stmt;
DEALLOCATE PREPARE course_sessions_owner_status_index_stmt;

SET @course_products_owner_fk_exists := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = DATABASE()
     AND TABLE_NAME = 'course_products'
     AND CONSTRAINT_NAME = 'fk_course_products_owner_user'
);
SET @course_products_owner_fk_sql := IF(
  @course_products_owner_fk_exists = 0,
  'ALTER TABLE `course_products` ADD CONSTRAINT `fk_course_products_owner_user` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE course_products_owner_fk_stmt FROM @course_products_owner_fk_sql;
EXECUTE course_products_owner_fk_stmt;
DEALLOCATE PREPARE course_products_owner_fk_stmt;

SET @course_sessions_owner_fk_exists := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = DATABASE()
     AND TABLE_NAME = 'course_sessions'
     AND CONSTRAINT_NAME = 'fk_course_sessions_owner_user'
);
SET @course_sessions_owner_fk_sql := IF(
  @course_sessions_owner_fk_exists = 0,
  'ALTER TABLE `course_sessions` ADD CONSTRAINT `fk_course_sessions_owner_user` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE course_sessions_owner_fk_stmt FROM @course_sessions_owner_fk_sql;
EXECUTE course_sessions_owner_fk_stmt;
DEALLOCATE PREPARE course_sessions_owner_fk_stmt;

CREATE TABLE IF NOT EXISTS `course_request_idempotency_keys` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` CHAR(36) NOT NULL,
  `operation` VARCHAR(32) NOT NULL,
  `request_key` VARCHAR(128) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'processing',
  `response_json` JSON DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_request_user_operation_key` (`user_id`, `operation`, `request_key`),
  KEY `idx_course_request_operation_status_updated` (`operation`, `status`, `updated_at`),
  KEY `idx_course_request_created_at` (`created_at`),
  CONSTRAINT `fk_course_request_idempotency_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Migration 045_course_multi_tenant_ownership applied' AS msg;
