CREATE TABLE IF NOT EXISTS app_settings (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `key` VARCHAR(64) NOT NULL,
  `value` TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_app_settings_key (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed default rows for匯款設定（備註、銀行名稱、銀行代碼、銀行帳號、帳戶名稱）
INSERT INTO app_settings (`key`, `value`) VALUES
  ('remittance_info', ''),
  ('remittance_bank_name', ''),
  ('remittance_bank_code', ''),
  ('remittance_bank_account', ''),
  ('remittance_account_name', ''),
  ('site_terms', ''),
  ('site_privacy', '')
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`);
