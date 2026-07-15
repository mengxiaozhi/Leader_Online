-- Store uploaded course-product covers outside MySQL while preserving cover_url compatibility.
SET @course_cover_type_exists = (
  SELECT COUNT(*)
  FROM `information_schema`.`COLUMNS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME` = 'course_products'
    AND `COLUMN_NAME` = 'cover_type'
);
SET @course_cover_type_sql = IF(
  @course_cover_type_exists = 0,
  'ALTER TABLE `course_products` ADD COLUMN `cover_type` VARCHAR(100) NULL AFTER `cover_url`',
  'SELECT 1'
);
PREPARE course_cover_type_statement FROM @course_cover_type_sql;
EXECUTE course_cover_type_statement;
DEALLOCATE PREPARE course_cover_type_statement;

SET @course_cover_path_exists = (
  SELECT COUNT(*)
  FROM `information_schema`.`COLUMNS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME` = 'course_products'
    AND `COLUMN_NAME` = 'cover_path'
);
SET @course_cover_path_sql = IF(
  @course_cover_path_exists = 0,
  'ALTER TABLE `course_products` ADD COLUMN `cover_path` VARCHAR(512) NULL AFTER `cover_type`',
  'SELECT 1'
);
PREPARE course_cover_path_statement FROM @course_cover_path_sql;
EXECUTE course_cover_path_statement;
DEALLOCATE PREPARE course_cover_path_statement;
