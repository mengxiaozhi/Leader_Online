-- New ticket orders snapshot this face value into tickets.discount on issuance.
-- Existing tickets retain their own value; 0 keeps full service redemption.
SET @ticket_discount_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'ticket_discount'),
  'SELECT 1',
  'ALTER TABLE products ADD COLUMN ticket_discount INT UNSIGNED NOT NULL DEFAULT 0 AFTER price'
);
PREPARE ticket_discount_stmt FROM @ticket_discount_ddl;
EXECUTE ticket_discount_stmt;
DEALLOCATE PREPARE ticket_discount_stmt;
