-- Migration 050: align general/course order lifecycle and multi-course checkout.
--
-- This migration is safe to rerun. It keeps the general and course domains in
-- separate tables while adding a shared lifecycle vocabulary, optimistic
-- concurrency, compensation audit records and durable course carts/batches.

DROP PROCEDURE IF EXISTS `parity_050_add_column`;
DELIMITER $$
CREATE PROCEDURE `parity_050_add_column`(
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
    SET @parity_050_column_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD COLUMN `', REPLACE(p_column_name, '`', '``'), '` ',
      p_definition
    );
    PREPARE parity_050_column_stmt FROM @parity_050_column_sql;
    EXECUTE parity_050_column_stmt;
    DEALLOCATE PREPARE parity_050_column_stmt;
  END IF;
END$$
DELIMITER ;

CALL `parity_050_add_column`('products', 'max_purchase_quantity', 'TINYINT UNSIGNED NOT NULL DEFAULT 10 AFTER `listing_status`');
CALL `parity_050_add_column`('course_products', 'max_purchase_quantity', 'TINYINT UNSIGNED NOT NULL DEFAULT 10 AFTER `sort_order`');

CALL `parity_050_add_column`('orders', 'payment_status', 'VARCHAR(24) NOT NULL DEFAULT ''pending'' AFTER `details`');
CALL `parity_050_add_column`('orders', 'fulfillment_status', 'VARCHAR(24) NOT NULL DEFAULT ''pending'' AFTER `payment_status`');
CALL `parity_050_add_column`('orders', 'row_version', 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER `fulfillment_status`');
CALL `parity_050_add_column`('orders', 'updated_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`');

CALL `parity_050_add_column`('course_orders', 'checkout_batch_id', 'BIGINT UNSIGNED NULL AFTER `id`');
CALL `parity_050_add_column`('course_orders', 'payment_status', 'VARCHAR(24) NOT NULL DEFAULT ''pending'' AFTER `status`');
CALL `parity_050_add_column`('course_orders', 'fulfillment_status', 'VARCHAR(24) NOT NULL DEFAULT ''pending'' AFTER `payment_status`');
CALL `parity_050_add_column`('course_orders', 'row_version', 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER `note`');

CALL `parity_050_add_column`('tickets', 'order_id', 'BIGINT UNSIGNED NULL AFTER `product_id`');
CALL `parity_050_add_column`('tickets', 'voided_at', 'DATETIME NULL AFTER `used`');
CALL `parity_050_add_column`('tickets', 'void_reason', 'VARCHAR(500) NULL AFTER `voided_at`');
CALL `parity_050_add_column`('tickets', 'replaced_by_ticket_id', 'BIGINT UNSIGNED NULL AFTER `void_reason`');
CALL `parity_050_add_column`('tickets', 'row_version', 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER `replaced_by_ticket_id`');

UPDATE `products`
   SET `max_purchase_quantity` = 10
 WHERE `id` >= 1
   AND (
        `max_purchase_quantity` IS NULL
     OR `max_purchase_quantity` < 1
     OR `max_purchase_quantity` > 99
   );

UPDATE `course_products`
   SET `max_purchase_quantity` = 10
 WHERE `id` >= 1
   AND (
        `max_purchase_quantity` IS NULL
     OR `max_purchase_quantity` < 1
     OR `max_purchase_quantity` > 99
   );

DROP PROCEDURE IF EXISTS `parity_050_add_check`;
DELIMITER $$
CREATE PROCEDURE `parity_050_add_check`(
  IN p_table_name VARCHAR(64),
  IN p_constraint_name VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND CONSTRAINT_NAME = p_constraint_name
  ) THEN
    SET @parity_050_check_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD CONSTRAINT `', REPLACE(p_constraint_name, '`', '``'),
      '` CHECK (', p_definition, ')'
    );
    PREPARE parity_050_check_stmt FROM @parity_050_check_sql;
    EXECUTE parity_050_check_stmt;
    DEALLOCATE PREPARE parity_050_check_stmt;
  END IF;
END$$
DELIMITER ;

CALL `parity_050_add_check`('products', 'chk_products_max_purchase_quantity', '`max_purchase_quantity` BETWEEN 1 AND 99');
CALL `parity_050_add_check`('course_products', 'chk_course_products_max_purchase_quantity', '`max_purchase_quantity` BETWEEN 1 AND 99');

CREATE TABLE IF NOT EXISTS `course_carts` (
  `user_id` CHAR(36) NOT NULL,
  `items` JSON NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_course_carts_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_checkout_batches` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` CHAR(36) NOT NULL,
  `idempotency_key` VARCHAR(128) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'processing',
  `response_json` JSON DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_checkout_user_key` (`user_id`, `idempotency_key`),
  KEY `idx_course_checkout_status_updated` (`status`, `updated_at`),
  CONSTRAINT `fk_course_checkout_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `order_action_idempotency` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `actor_user_id` CHAR(36) NOT NULL,
  `operation` VARCHAR(64) NOT NULL,
  `resource_id` BIGINT UNSIGNED NOT NULL,
  `request_key` VARCHAR(128) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'processing',
  `response_json` JSON DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_order_action_actor_operation_key` (`actor_user_id`, `operation`, `request_key`),
  KEY `idx_order_action_resource` (`operation`, `resource_id`),
  KEY `idx_order_action_status_updated` (`status`, `updated_at`),
  CONSTRAINT `fk_order_action_actor`
    FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `order_lifecycle_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `domain` VARCHAR(16) NOT NULL,
  `order_id` BIGINT UNSIGNED NOT NULL,
  `actor_user_id` CHAR(36) DEFAULT NULL,
  `action` VARCHAR(64) NOT NULL,
  `from_payment_status` VARCHAR(24) DEFAULT NULL,
  `to_payment_status` VARCHAR(24) DEFAULT NULL,
  `from_fulfillment_status` VARCHAR(24) DEFAULT NULL,
  `to_fulfillment_status` VARCHAR(24) DEFAULT NULL,
  `reason` VARCHAR(500) DEFAULT NULL,
  `idempotency_key` VARCHAR(128) DEFAULT NULL,
  `metadata` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_order_lifecycle_replay` (`domain`, `order_id`, `action`, `idempotency_key`),
  KEY `idx_order_lifecycle_order` (`domain`, `order_id`, `created_at`, `id`),
  KEY `idx_order_lifecycle_actor` (`actor_user_id`, `created_at`),
  CONSTRAINT `fk_order_lifecycle_actor`
    FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS `parity_050_add_index`;
DELIMITER $$
CREATE PROCEDURE `parity_050_add_index`(
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
    SET @parity_050_index_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD ', p_index_definition
    );
    PREPARE parity_050_index_stmt FROM @parity_050_index_sql;
    EXECUTE parity_050_index_stmt;
    DEALLOCATE PREPARE parity_050_index_stmt;
  END IF;
END$$
DELIMITER ;

CALL `parity_050_add_index`('orders', 'idx_orders_lifecycle', 'KEY `idx_orders_lifecycle` (`payment_status`, `fulfillment_status`, `created_at`, `id`)');
CALL `parity_050_add_index`('course_orders', 'idx_course_orders_lifecycle', 'KEY `idx_course_orders_lifecycle` (`payment_status`, `fulfillment_status`, `created_at`, `id`)');
CALL `parity_050_add_index`('course_orders', 'idx_course_orders_checkout_batch', 'KEY `idx_course_orders_checkout_batch` (`checkout_batch_id`, `id`)');
CALL `parity_050_add_index`('tickets', 'idx_tickets_order', 'KEY `idx_tickets_order` (`order_id`, `id`)');
CALL `parity_050_add_index`('tickets', 'idx_tickets_voided', 'KEY `idx_tickets_voided` (`voided_at`, `id`)');

DROP PROCEDURE IF EXISTS `parity_050_add_foreign_key`;
DELIMITER $$
CREATE PROCEDURE `parity_050_add_foreign_key`(
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
    SET @parity_050_fk_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD CONSTRAINT `', REPLACE(p_constraint_name, '`', '``'),
      '` ', p_constraint_definition
    );
    PREPARE parity_050_fk_stmt FROM @parity_050_fk_sql;
    EXECUTE parity_050_fk_stmt;
    DEALLOCATE PREPARE parity_050_fk_stmt;
  END IF;
END$$
DELIMITER ;

CALL `parity_050_add_foreign_key`('course_orders', 'fk_course_orders_checkout_batch', 'FOREIGN KEY (`checkout_batch_id`) REFERENCES `course_checkout_batches` (`id`) ON DELETE SET NULL');
CALL `parity_050_add_foreign_key`('tickets', 'fk_tickets_order', 'FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE SET NULL');
CALL `parity_050_add_foreign_key`('tickets', 'fk_tickets_replaced_by', 'FOREIGN KEY (`replaced_by_ticket_id`) REFERENCES `tickets` (`id`) ON DELETE SET NULL');

-- DDL stays repairable on every run, but a completed migration must never
-- re-derive live canonical states from the legacy compatibility columns.
-- A run interrupted before the final marker can safely resume this backfill
-- before the new Server version is started.
DROP PROCEDURE IF EXISTS `parity_050_backfill`;
DELIMITER $$
CREATE PROCEDURE `parity_050_backfill`()
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM `course_schema_versions`
     WHERE `version` = '050_order_ticket_parity'
  ) THEN
-- Link historical general tickets to their source order when the issuance log
-- contains a valid order identifier. Ambiguous/untracked legacy tickets remain
-- untouched and are handled as manual compensation cases.
UPDATE `tickets` t
JOIN (
  SELECT parsed.`ticket_id`, MIN(parsed.`order_id`) AS `order_id`
    FROM (
      SELECT l.`ticket_id`,
             COALESCE(
               CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(l.`meta`, '$.order_id')), '') AS UNSIGNED),
               CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(l.`meta`, '$.orderId')), '') AS UNSIGNED)
             ) AS `order_id`
        FROM `ticket_logs` l
       WHERE l.`action` = 'issued'
         AND l.`meta` IS NOT NULL
    ) parsed
   WHERE parsed.`order_id` IS NOT NULL
     AND parsed.`order_id` > 0
   GROUP BY parsed.`ticket_id`
  HAVING COUNT(DISTINCT parsed.`order_id`) = 1
) linked ON linked.`ticket_id` = t.`id`
JOIN `orders` o ON o.`id` = linked.`order_id`
   SET t.`order_id` = linked.`order_id`
 WHERE t.`id` >= 1
   AND t.`order_id` IS NULL;

UPDATE `orders`
   SET `payment_status` = CASE
         WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`details`, '$.status')), '') IN ('已付款', '已完成', '待指派') THEN 'paid'
         WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`details`, '$.status')), '') IN ('已退款', 'refunded') THEN 'refunded'
         WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`details`, '$.status')), '') = '已取消' THEN 'cancelled'
         WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`details`, '$.status')), '') = '處理中' THEN 'reviewing'
         ELSE 'pending'
       END,
       `fulfillment_status` = CASE
         WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`details`, '$.status')), '') IN ('已付款', '已完成', '待指派')
          AND (
            COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`details`, '$.granted')), 'false') = 'true'
            OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`details`, '$.reservations_granted')), 'false') = 'true'
          ) THEN 'fulfilled'
         ELSE 'pending'
       END
 WHERE `id` >= 1;

UPDATE `orders` o
   SET o.`fulfillment_status` = CASE
     WHEN o.`payment_status` = 'refunded'
      AND (SELECT COUNT(*) FROM `tickets` t WHERE t.`order_id` = o.`id` AND t.`voided_at` IS NULL) = 0
      THEN 'voided'
     WHEN o.`payment_status` IN ('cancelled', 'refunded')
      AND (SELECT COUNT(*) FROM `tickets` t WHERE t.`order_id` = o.`id` AND t.`voided_at` IS NULL) > 0
      THEN 'fulfilled'
     WHEN o.`payment_status` = 'paid'
      AND COALESCE(JSON_LENGTH(JSON_EXTRACT(o.`details`, '$.selections')), 0) > 0
      AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(o.`details`, '$.reservations_granted')), 'false') = 'true'
      THEN 'fulfilled'
     WHEN o.`payment_status` = 'paid'
      AND COALESCE(JSON_LENGTH(JSON_EXTRACT(o.`details`, '$.selections')), 0) = 0
      AND (SELECT COUNT(*) FROM `tickets` t WHERE t.`order_id` = o.`id` AND t.`voided_at` IS NULL)
          = CAST(COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.`details`, '$.quantity')), ''), '0') AS UNSIGNED)
      AND CAST(COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.`details`, '$.quantity')), ''), '0') AS UNSIGNED) > 0
      THEN 'fulfilled'
     ELSE 'pending'
   END
 WHERE o.`id` >= 1;

UPDATE `course_orders`
   SET `payment_status` = CASE
         WHEN `status` = 'payment_review' THEN 'reviewing'
         WHEN `status` IN ('paid', 'issued') THEN 'paid'
         WHEN `status` = 'cancelled' THEN 'cancelled'
         WHEN `status` = 'refunded' THEN 'refunded'
         ELSE 'pending'
       END,
       `fulfillment_status` = CASE
         WHEN `status` = 'issued' THEN 'fulfilled'
         WHEN `status` = 'refunded' THEN 'voided'
         ELSE 'pending'
       END
 WHERE `id` >= 1;

UPDATE `course_orders` o
   SET o.`fulfillment_status` = CASE
     WHEN o.`payment_status` = 'refunded'
      AND (
        SELECT COUNT(*) FROM `course_tickets` t
         WHERE t.`order_id` = o.`id`
           AND t.`status` NOT IN ('void', 'voided', 'refunded')
      ) = 0 THEN 'voided'
     WHEN o.`payment_status` IN ('cancelled', 'refunded')
      AND (
        SELECT COUNT(*) FROM `course_tickets` t
         WHERE t.`order_id` = o.`id`
           AND t.`status` NOT IN ('void', 'voided', 'refunded')
      ) > 0 THEN 'fulfilled'
     WHEN o.`payment_status` = 'paid'
      AND (
        SELECT COUNT(*) FROM `course_tickets` t
         WHERE t.`order_id` = o.`id`
           AND t.`status` NOT IN ('void', 'voided', 'refunded')
      ) = COALESCE(
        NULLIF((SELECT SUM(oi.`quantity`) FROM `course_order_items` oi WHERE oi.`order_id` = o.`id`), 0),
        o.`quantity`
      )
      AND (
        SELECT COUNT(*) FROM `course_tickets` t
         WHERE t.`order_id` = o.`id`
           AND t.`status` NOT IN ('void', 'voided', 'refunded')
      ) > 0 THEN 'fulfilled'
     ELSE 'pending'
   END
 WHERE o.`id` >= 1;

INSERT IGNORE INTO `order_lifecycle_events` (
  `domain`, `order_id`, `action`,
  `from_payment_status`, `to_payment_status`,
  `from_fulfillment_status`, `to_fulfillment_status`,
  `reason`, `idempotency_key`, `metadata`
)
SELECT 'general', o.`id`, 'migration-repair-required',
       o.`payment_status`, o.`payment_status`,
       o.`fulfillment_status`, o.`fulfillment_status`,
       'Legacy order lifecycle and issued-ticket evidence disagree',
       'migration-050', JSON_OBJECT('migration', '050_order_ticket_parity')
  FROM `orders` o
 WHERE (o.`payment_status` = 'paid' AND o.`fulfillment_status` = 'pending')
    OR (o.`payment_status` IN ('cancelled', 'refunded') AND o.`fulfillment_status` = 'fulfilled')
    OR (
      o.`payment_status` IN ('pending', 'reviewing')
      AND EXISTS (
        SELECT 1
          FROM `tickets` t
         WHERE t.`order_id` = o.`id`
           AND t.`voided_at` IS NULL
      )
    );

INSERT IGNORE INTO `order_lifecycle_events` (
  `domain`, `order_id`, `action`,
  `from_payment_status`, `to_payment_status`,
  `from_fulfillment_status`, `to_fulfillment_status`,
  `reason`, `idempotency_key`, `metadata`
)
SELECT 'course', o.`id`, 'migration-repair-required',
       o.`payment_status`, o.`payment_status`,
       o.`fulfillment_status`, o.`fulfillment_status`,
       'Legacy course order lifecycle and issued-ticket evidence disagree',
       'migration-050', JSON_OBJECT('migration', '050_order_ticket_parity')
  FROM `course_orders` o
 WHERE (o.`payment_status` = 'paid' AND o.`fulfillment_status` = 'pending')
    OR (o.`payment_status` IN ('cancelled', 'refunded') AND o.`fulfillment_status` = 'fulfilled')
    OR (
      o.`payment_status` IN ('pending', 'reviewing')
      AND EXISTS (
        SELECT 1
          FROM `course_tickets` t
         WHERE t.`order_id` = o.`id`
           AND t.`status` NOT IN ('void', 'voided', 'refunded')
      )
    );
  END IF;
END$$
DELIMITER ;

CALL `parity_050_backfill`();

DROP PROCEDURE IF EXISTS `parity_050_add_column`;
DROP PROCEDURE IF EXISTS `parity_050_add_check`;
DROP PROCEDURE IF EXISTS `parity_050_add_index`;
DROP PROCEDURE IF EXISTS `parity_050_add_foreign_key`;
DROP PROCEDURE IF EXISTS `parity_050_backfill`;

INSERT IGNORE INTO `course_schema_versions` (`version`, `description`)
VALUES ('050_order_ticket_parity', 'Canonical order lifecycle, compensations and multi-course checkout');

SELECT 'Migration 050_order_ticket_parity applied' AS msg;
