-- Migration 025: bind issued tickets to products for reliable reservation deductions
USE leader_online;

SET @has_ticket_product_id := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'tickets' AND column_name = 'product_id'
);
SET @ddl := IF(
  @has_ticket_product_id = 0,
  'ALTER TABLE `tickets` ADD COLUMN `product_id` INT UNSIGNED NULL AFTER `type`;',
  'SELECT "tickets.product_id already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_ticket_product_idx := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'tickets' AND index_name = 'idx_tickets_product'
);
SET @ddl := IF(
  @has_ticket_product_idx = 0,
  'ALTER TABLE `tickets` ADD INDEX `idx_tickets_product` (`product_id`);',
  'SELECT "tickets.idx_tickets_product already exists" AS info;'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `ticket_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ticket_id` BIGINT UNSIGNED NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  `meta` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ticket_logs_user` (`user_id`),
  KEY `idx_ticket_logs_ticket` (`ticket_id`),
  KEY `idx_ticket_logs_action` (`action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

UPDATE `tickets` t
JOIN (
  SELECT
    l.`ticket_id`,
    MAX(COALESCE(
      CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.`details`, '$.productId')), '') AS UNSIGNED),
      CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.`details`, '$.product_id')), '') AS UNSIGNED),
      CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.`details`, '$.product.id')), '') AS UNSIGNED)
    )) AS `product_id`
  FROM `ticket_logs` l
  JOIN `orders` o
    ON o.`id` = COALESCE(
      CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(l.`meta`, '$.order_id')), '') AS UNSIGNED),
      CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(l.`meta`, '$.orderId')), '') AS UNSIGNED)
    )
  WHERE l.`ticket_id` IS NOT NULL
  GROUP BY l.`ticket_id`
  HAVING `product_id` IS NOT NULL AND `product_id` > 0
) src ON src.`ticket_id` = t.`id`
JOIN `products` p ON p.`id` = src.`product_id`
SET t.`product_id` = p.`id`
WHERE t.`product_id` IS NULL;

UPDATE `tickets` t
JOIN (
  SELECT `name`, MIN(`id`) AS `product_id`, COUNT(*) AS `product_count`
  FROM `products`
  WHERE `name` IS NOT NULL AND `name` <> ''
  GROUP BY `name`
  HAVING `product_count` = 1
) p ON p.`name` = t.`type`
SET t.`product_id` = p.`product_id`
WHERE t.`product_id` IS NULL;

SELECT 'Migration 025_ticket_product_binding applied' AS msg;
