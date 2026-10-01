-- 060: independently configurable reminder offsets (minutes before each stage).
-- NULL preserves the existing 24-hour reminder. Existing outbox keys and drafts
-- remain valid; the new server reads both legacy stage-only and expanded drafts.
SET @handover_reminder_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_stores' AND COLUMN_NAME = 'handover_reminder_offsets') = 0,
  'ALTER TABLE event_stores ADD COLUMN handover_reminder_offsets JSON DEFAULT NULL', 'SELECT 1');
PREPARE handover_reminder_stmt FROM @handover_reminder_ddl;
EXECUTE handover_reminder_stmt;
DEALLOCATE PREPARE handover_reminder_stmt;
