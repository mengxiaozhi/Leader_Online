-- Leader Online - Migration: oauth_identities (third-party bindings)
-- 用途：新增第三方登入綁定表與必要索引；並正規化 provider 名稱為小寫。

USE leader_online;

CREATE TABLE IF NOT EXISTS oauth_identities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id CHAR(36) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  subject VARCHAR(128) NOT NULL,
  email VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_provider_subject (provider, subject),
  KEY idx_oauth_user (user_id),
  KEY idx_oauth_provider_email (provider, email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 資料清理：provider 一律小寫
UPDATE oauth_identities SET provider = LOWER(provider);

SELECT 'Migration 009_oauth_identities applied' AS msg;

