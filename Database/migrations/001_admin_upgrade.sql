-- Leader Online - Migration: add admin/role + align with new APIs
-- 用途：舊資料庫（UUID 版 users.id）升級以支援後台權限與訂單代碼等功能。
-- 使用方式：導入既有資料庫後，在同一個 DB 連線下執行本腳本。

USE leader_online;

-- users：加入 role 欄位（預設 user）。如已存在會報錯，請只執行一次。
ALTER TABLE users
  ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'user' AFTER password_hash;

-- 可選：指定一位管理員帳號
-- UPDATE users SET role = 'admin' WHERE email = 'your-admin@example.com';

-- orders：確保有唯一代碼欄位（若舊版已存在可略過此段）
-- 若欄位缺少，請取消註解以下兩段再執行。
-- ALTER TABLE orders ADD COLUMN code VARCHAR(16) NULL;
-- CREATE UNIQUE INDEX orders_code_unique ON orders(code);

-- 參考：若舊版 users.password 是明文，可先保留，由後端登入成功後自動升級為雜湊
-- （目前你的舊表多為 password_hash，不需要此步驟）

-- 完成
SELECT 'Migration 001_admin_upgrade applied' AS msg;

