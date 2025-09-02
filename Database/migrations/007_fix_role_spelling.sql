-- Fix misspelling ADMN -> ADMIN
USE leader_online;

UPDATE `users` SET `role` = 'ADMIN' WHERE UPPER(`role`) = 'ADMN';

SELECT 'Migration 007_fix_role_spelling applied' AS msg;

