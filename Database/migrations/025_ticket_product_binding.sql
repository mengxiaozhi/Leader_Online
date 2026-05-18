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

UPDATE `tickets` t
JOIN `products` p ON p.`name` = t.`type`
SET t.`product_id` = p.`id`
WHERE t.`id` > 0
  AND t.`product_id` IS NULL;

SELECT 'Migration 025_ticket_product_binding applied' AS msg;
