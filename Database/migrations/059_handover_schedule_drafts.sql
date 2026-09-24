-- 059: private schedule drafts. Apply after 057 and before the updated Server/Web.
-- Published revisions keep their meaning for notifications. NULL edit versions
-- initially use the existing published version, without rewriting existing data.
SET @handover_draft_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_stores' AND COLUMN_NAME = 'handover_schedule_draft') = 0,
  'ALTER TABLE event_stores ADD COLUMN handover_schedule_draft JSON DEFAULT NULL', 'SELECT 1');
PREPARE handover_draft_stmt FROM @handover_draft_ddl;
EXECUTE handover_draft_stmt;
DEALLOCATE PREPARE handover_draft_stmt;

SET @handover_draft_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_stores' AND COLUMN_NAME = 'handover_edit_version') = 0,
  'ALTER TABLE event_stores ADD COLUMN handover_edit_version INT UNSIGNED DEFAULT NULL', 'SELECT 1');
PREPARE handover_draft_stmt FROM @handover_draft_ddl;
EXECUTE handover_draft_stmt;
DEALLOCATE PREPARE handover_draft_stmt;
