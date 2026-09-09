-- Apply before deploying order price editing. No existing prices are rewritten.
DROP PROCEDURE IF EXISTS `pricing_054_add_column`;
DELIMITER $$
CREATE PROCEDURE `pricing_054_add_column`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'course_orders'
       AND COLUMN_NAME = 'pricing_json'
  ) THEN
    ALTER TABLE `course_orders` ADD COLUMN `pricing_json` JSON NULL AFTER `total_amount`;
  END IF;
END$$
DELIMITER ;
CALL `pricing_054_add_column`();
DROP PROCEDURE `pricing_054_add_column`;
