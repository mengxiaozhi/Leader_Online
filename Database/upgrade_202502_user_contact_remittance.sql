-- Leader Online - One-click upgrade script (2025-02 contact verification release)
-- 目的：套用使用者手機與匯款帳號後五碼欄位的變更
-- 使用方式：
--   mysql -u <user> -p < Database/upgrade_202502_user_contact_remittance.sql

SOURCE migrations/013_user_contact_remittance.sql;

SELECT 'Upgrade script 202502_user_contact_remittance completed' AS msg;
