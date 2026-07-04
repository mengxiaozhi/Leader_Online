INSERT INTO app_settings (`key`, `value`)
VALUES ('order_email_cc', '{"emails":[],"userIds":[]}')
ON DUPLICATE KEY UPDATE `value` = `value`;

SELECT 'Migration 032_order_email_cc_settings applied' AS msg;
