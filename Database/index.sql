-- phpMyAdmin SQL Dump
-- version 5.2.2
-- https://www.phpmyadmin.net/
--
-- 主機： 127.0.0.1
-- 產生時間： 2025 年 08 月 28 日 11:18
-- 伺服器版本： 8.0.34
-- PHP 版本： 8.3.9
SET
  SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";

START TRANSACTION;

SET
  time_zone = "+00:00";

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;

/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;

/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;

/*!40101 SET NAMES utf8mb4 */;

--
-- 資料庫： `leader_online`
--
-- --------------------------------------------------------
--
-- 資料表結構 `events`
--
CREATE TABLE
  `events` (
    `id` int UNSIGNED NOT NULL,
    `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
    `starts_at` datetime NOT NULL,
    `ends_at` datetime NOT NULL,
    `deadline` datetime DEFAULT NULL,
    `location` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `description` text COLLATE utf8mb4_unicode_ci,
    `cover` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `cover_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `cover_data` longblob DEFAULT NULL,
    `cover_path` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `rules` json DEFAULT NULL,
    `owner_user_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

--
-- 傾印資料表的資料 `events`
--
INSERT INTO
  `events` (
    `id`,
    `code`,
    `title`,
    `starts_at`,
    `ends_at`,
    `deadline`,
    `location`,
    `description`,
    `rules`,
    `created_at`,
    `updated_at`
  )
VALUES
  (
    1,
    '24200032',
    '2025 大鵬灣單車託運券',
    '2025-12-05 00:00:00',
    '2025-12-07 23:59:59',
    '2025-11-28 23:59:59',
    '大鵬灣',
    '提供賽事單車託運服務之憑證，登記購買後，我們將在賽事期間提供專業單車運送。',
    '[\"17 噸卡車運送，車體置於封閉空間\", \"專業龍車固定，專屬存放空間\", \"依法規投保貨物險，完整交付檢核\", \"裸車不予交寄，請妥善包覆車體\"]',
    '2025-08-27 02:15:21',
    '2025-08-27 02:15:21'
  ),
  (
    2,
    'E2',
    '親子滑步趣跑賽',
    '2025-09-01 09:00:00',
    '2025-09-01 17:00:00',
    '2025-08-25 23:59:59',
    '台灣',
    '',
    '[\"適合 3-8 歲兒童\", \"含安全檢查與托運保險\"]',
    '2025-08-27 02:15:21',
    '2025-08-27 02:15:21'
  );

-- --------------------------------------------------------
--
-- 資料表結構 `orders`
--
CREATE TABLE
  `orders` (
    `id` bigint UNSIGNED NOT NULL,
    `user_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
    `code` varchar(14) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `details` json DEFAULT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

--
-- 傾印資料表的資料 `orders`
--
INSERT INTO
  `orders` (`id`, `user_id`, `code`, `details`, `created_at`)
VALUES
  (
    1,
    'f950d304-e124-49d1-ae1c-43bdb73ca465',
    NULL,
    '{\"total\": 300, \"status\": \"待匯款\", \"quantity\": 1, \"ticketType\": \"小鐵人\"}',
    '2025-08-27 02:55:02'
  ),
  (
    2,
    'f950d304-e124-49d1-ae1c-43bdb73ca465',
    NULL,
    '{\"total\": 300, \"status\": \"待匯款\", \"quantity\": 1, \"ticketType\": \"小鐵人\"}',
    '2025-08-27 03:06:55'
  ),
  (
    3,
    '452edb78-fae1-4467-8be3-481b552ea382',
    '23FYLP2MCR',
    '{\"total\": 600, \"status\": \"待匯款\", \"quantity\": 2, \"ticketType\": \"小鐵人\"}',
    '2025-08-27 04:21:46'
  ),
  (
    4,
    '452edb78-fae1-4467-8be3-481b552ea382',
    'HNNN32YS2S',
    '{\"total\": 1000, \"status\": \"已完成\", \"quantity\": 2, \"ticketType\": \"大鐵人\"}',
    '2025-08-27 04:21:46'
  ),
  (
    5,
    'f950d304-e124-49d1-ae1c-43bdb73ca465',
    'SBZPJFNDKV',
    '{\"total\": 300, \"status\": \"已完成\", \"quantity\": 1, \"ticketType\": \"小鐵人\"}',
    '2025-08-27 04:30:44'
  );

-- --------------------------------------------------------
--
-- 資料表結構 `products`
--
CREATE TABLE
  `products` (
    `id` int UNSIGNED NOT NULL,
    `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
    `description` text COLLATE utf8mb4_unicode_ci,
    `price` decimal(10, 2) NOT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

--
-- 傾印資料表的資料 `products`
--
INSERT INTO
  `products` (
    `id`,
    `name`,
    `description`,
    `price`,
    `created_at`,
    `updated_at`
  )
VALUES
  (
    1,
    '小鐵人',
    '適合 5~8 歲',
    300.00,
    '2025-08-27 02:15:21',
    '2025-08-27 02:15:21'
  ),
  (
    2,
    '大鐵人',
    '適合 9~12 歲',
    500.00,
    '2025-08-27 02:15:21',
    '2025-08-27 02:15:21'
  ),
  (
    3,
    '滑步車',
    '適合 3~6 歲',
    200.00,
    '2025-08-27 02:15:21',
    '2025-08-27 02:15:21'
  );

-- --------------------------------------------------------
--
-- 資料表結構 `reservations`
--
CREATE TABLE
  `reservations` (
    `id` bigint UNSIGNED NOT NULL,
    `user_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
    `ticket_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
    `store` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
    `event` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
    `reserved_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `verify_code` varchar(12) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `verify_code_pre_dropoff` varchar(12) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `pre_dropoff_checklist` json DEFAULT NULL,
    `verify_code_pre_pickup` varchar(12) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `pre_pickup_checklist` json DEFAULT NULL,
    `verify_code_post_dropoff` varchar(12) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `post_dropoff_checklist` json DEFAULT NULL,
    `verify_code_post_pickup` varchar(12) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `post_pickup_checklist` json DEFAULT NULL,
    `status` enum (
      'service_booking',
      'pre_dropoff',
      'pre_pickup',
      'post_dropoff',
      'post_pickup',
      'done'
    ) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'service_booking'
  ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------
--
-- 資料表結構 `reservation_checklist_photos`
--
CREATE TABLE
  `reservation_checklist_photos` (
    `id` bigint UNSIGNED NOT NULL,
    `reservation_id` bigint UNSIGNED NOT NULL,
    `stage` enum('pre_dropoff','pre_pickup','post_dropoff','post_pickup') COLLATE utf8mb4_unicode_ci NOT NULL,
    `mime` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
    `original_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `size` int UNSIGNED NOT NULL,
    `storage_path` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `checksum` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `data` longblob DEFAULT NULL,
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

--
-- 傾印資料表的資料 `reservations`
--
INSERT INTO
  `reservations` (
    `id`,
    `user_id`,
    `ticket_type`,
    `store`,
    `event`,
    `reserved_at`,
    `verify_code`,
    `pre_dropoff_checklist`,
    `pre_pickup_checklist`,
    `post_dropoff_checklist`,
    `post_pickup_checklist`,
    `status`
  )
VALUES
  (
    1,
    'f950d304-e124-49d1-ae1c-43bdb73ca465',
    'event',
    'default',
    '1',
    '2025-08-27 11:16:38',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'pending'
  ),
  (
    2,
    'f950d304-e124-49d1-ae1c-43bdb73ca465',
    'event',
    'default',
    '1',
    '2025-08-27 11:16:41',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'pending'
  ),
  (
    3,
    'f950d304-e124-49d1-ae1c-43bdb73ca465',
    'event',
    'default',
    '2',
    '2025-08-27 11:38:08',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'pending'
  );

-- --------------------------------------------------------
--
-- 資料表結構 `tickets`
--
CREATE TABLE
  `tickets` (
    `id` bigint UNSIGNED NOT NULL,
    `user_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
    `type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
    `expiry` date DEFAULT NULL,
    `uuid` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
    `discount` int NOT NULL DEFAULT '0',
    `used` tinyint (1) NOT NULL DEFAULT '0',
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------
--
-- 資料表結構 `ticket_transfers`
--
CREATE TABLE
  `ticket_transfers` (
    `id` bigint UNSIGNED NOT NULL,
    `ticket_id` bigint UNSIGNED NOT NULL,
    `from_user_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
    `to_user_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `to_user_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `code` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `status` enum('pending','accepted','declined','canceled','expired') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------
--
-- 資料表結構 `reservation_transfers`
--
CREATE TABLE
  `reservation_transfers` (
    `id` bigint UNSIGNED NOT NULL,
    `reservation_id` bigint UNSIGNED NOT NULL,
    `from_user_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
    `to_user_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `to_user_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `code` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `status` enum('pending','accepted','declined','canceled','expired') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------
--
-- 資料表結構 `oauth_identities`
--
CREATE TABLE
  `oauth_identities` (
    `id` bigint UNSIGNED NOT NULL,
    `user_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
    `provider` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
    `subject` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
    `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------
--
-- 資料表結構 `user_carts`
--
CREATE TABLE
  `user_carts` (
    `user_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
    `items` json NOT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`user_id`)
  ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------
--
-- 資料表結構 `users`
--
CREATE TABLE
  `users` (
    `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
    `username` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
    `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
    `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `remittance_last5` char(5) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

--
-- 傾印資料表的資料 `users`
--
INSERT INTO
  `users` (
    `id`,
    `username`,
    `email`,
    `phone`,
    `remittance_last5`,
    `password_hash`,
    `created_at`,
    `updated_at`
  )
VALUES
  (
    '452edb78-fae1-4467-8be3-481b552ea382',
    'ppgirl',
    'ppgirlfan@gmail.com',
    NULL,
    NULL,
    '$2b$12$LHO.frFR5U0ofdc0p1cnvuT/CW0jOygaRh/t9bvbkbiD5WI.Lodc.',
    '2025-08-27 04:21:06',
    '2025-08-27 04:21:06'
  ),
  (
    'f950d304-e124-49d1-ae1c-43bdb73ca465',
    'Mengxiaozhi',
    'me@xiaozhi.moe',
    NULL,
    NULL,
    '$2b$12$Va10m1CkK9htx6G5b5/6t.aIrBLp46t/jOfrwd8vGt/XkSjDKcKeS',
    '2025-08-27 02:18:05',
    '2025-08-27 02:18:05'
  );

--
-- 已傾印資料表的索引
--
--
-- 資料表索引 `events`
--
ALTER TABLE `events` ADD PRIMARY KEY (`id`),
ADD KEY `idx_events_time` (`starts_at`, `ends_at`),
ADD KEY `idx_events_code` (`code`),
ADD KEY `idx_events_owner` (`owner_user_id`);

--
-- 資料表索引 `orders`
--
ALTER TABLE `orders` ADD PRIMARY KEY (`id`),
ADD UNIQUE KEY `code` (`code`),
ADD KEY `idx_orders_user` (`user_id`);

--
-- 資料表索引 `products`
--
ALTER TABLE `products` ADD PRIMARY KEY (`id`);

--
-- 資料表索引 `reservations`
--
ALTER TABLE `reservations` ADD PRIMARY KEY (`id`),
ADD KEY `idx_reservations_user` (`user_id`);

--
-- 資料表索引 `reservation_checklist_photos`
--
ALTER TABLE `reservation_checklist_photos` ADD PRIMARY KEY (`id`),
ADD KEY `idx_reservation_stage` (`reservation_id`, `stage`);

--
-- 資料表索引 `tickets`
--
ALTER TABLE `tickets` ADD PRIMARY KEY (`id`),
ADD UNIQUE KEY `uq_tickets_uuid` (`uuid`),
ADD KEY `idx_tickets_user` (`user_id`);

--
-- 資料表索引 `ticket_transfers`
--
ALTER TABLE `ticket_transfers` ADD PRIMARY KEY (`id`),
ADD UNIQUE KEY `uq_ticket_transfers_code` (`code`),
ADD KEY `idx_ticket_transfers_ticket` (`ticket_id`),
ADD KEY `idx_ticket_transfers_to_user` (`to_user_id`),
ADD KEY `idx_ticket_transfers_to_email` (`to_user_email`),
ADD KEY `idx_ticket_transfers_status` (`status`);

--
-- 資料表索引 `reservation_transfers`
--
ALTER TABLE `reservation_transfers` ADD PRIMARY KEY (`id`),
ADD UNIQUE KEY `uq_reservation_transfers_code` (`code`),
ADD KEY `idx_reservation_transfers_reservation` (`reservation_id`),
ADD KEY `idx_reservation_transfers_from_user` (`from_user_id`),
ADD KEY `idx_reservation_transfers_to_user` (`to_user_id`),
ADD KEY `idx_reservation_transfers_to_email` (`to_user_email`),
ADD KEY `idx_reservation_transfers_status` (`status`);

--
-- 資料表索引 `oauth_identities`
--
ALTER TABLE `oauth_identities` ADD PRIMARY KEY (`id`),
ADD UNIQUE KEY `uq_provider_subject` (`provider`, `subject`),
ADD KEY `idx_oauth_user` (`user_id`),
ADD KEY `idx_oauth_provider_email` (`provider`, `email`);

--
-- 資料表索引 `users`
--
ALTER TABLE `users` ADD PRIMARY KEY (`id`),
ADD UNIQUE KEY `uq_users_email` (`email`),
ADD KEY `idx_users_created_at` (`created_at`);

--
-- 在傾印的資料表使用自動遞增(AUTO_INCREMENT)
--
--
-- 使用資料表自動遞增(AUTO_INCREMENT) `events`
--
ALTER TABLE `events` MODIFY `id` int UNSIGNED NOT NULL AUTO_INCREMENT,
AUTO_INCREMENT = 3;

--
-- 使用資料表自動遞增(AUTO_INCREMENT) `orders`
--
ALTER TABLE `orders` MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
AUTO_INCREMENT = 6;

--
-- 使用資料表自動遞增(AUTO_INCREMENT) `products`
--
ALTER TABLE `products` MODIFY `id` int UNSIGNED NOT NULL AUTO_INCREMENT,
AUTO_INCREMENT = 4;

--
-- 使用資料表自動遞增(AUTO_INCREMENT) `reservations`
--
ALTER TABLE `reservations` MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
AUTO_INCREMENT = 4;

--
-- 使用資料表自動遞增(AUTO_INCREMENT) `reservation_checklist_photos`
--
ALTER TABLE `reservation_checklist_photos` MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- 使用資料表自動遞增(AUTO_INCREMENT) `tickets`
--
ALTER TABLE `tickets` MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT;

-- 使用資料表自動遞增(AUTO_INCREMENT) `ticket_transfers`
ALTER TABLE `ticket_transfers` MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT;

-- 使用資料表自動遞增(AUTO_INCREMENT) `reservation_transfers`
ALTER TABLE `reservation_transfers` MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- 使用資料表自動遞增(AUTO_INCREMENT) `oauth_identities`
--
ALTER TABLE `oauth_identities` MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- 已傾印資料表的限制式
--
--
-- 資料表的限制式 `orders`
--
ALTER TABLE `orders` ADD CONSTRAINT `fk_orders_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

--
-- 資料表的限制式 `reservations`
--
ALTER TABLE `reservations` ADD CONSTRAINT `fk_reservations_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

--
-- 資料表的限制式 `reservation_checklist_photos`
--
ALTER TABLE `reservation_checklist_photos` ADD CONSTRAINT `fk_reservation_photo_reservation` FOREIGN KEY (`reservation_id`) REFERENCES `reservations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- 資料表的限制式 `tickets`
--
ALTER TABLE `tickets` ADD CONSTRAINT `fk_tickets_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `events` ADD CONSTRAINT `fk_events_owner_user` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `user_carts` ADD CONSTRAINT `fk_user_carts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Email 驗證記錄（新安裝可直接建立）
CREATE TABLE IF NOT EXISTS `email_verifications` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `registration_name` VARCHAR(50) DEFAULT NULL,
  `token` VARCHAR(128) DEFAULT NULL,
  `token_expiry` BIGINT UNSIGNED DEFAULT NULL,
  `verified` TINYINT(1) NOT NULL DEFAULT 0,
  `last_send_attempt_at` DATETIME DEFAULT NULL,
  `send_window_started_at` DATETIME DEFAULT NULL,
  `send_attempt_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `delivered_at` DATETIME DEFAULT NULL,
  `used_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_email_verifications_email` (`email`),
  UNIQUE KEY `uq_email_verifications_token` (`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- LEADER 課程／計次票模塊（新安裝可直接建立）
CREATE TABLE IF NOT EXISTS `course_products` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) DEFAULT NULL,
  `code` VARCHAR(40) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `category` VARCHAR(80) DEFAULT NULL,
  `summary` VARCHAR(500) DEFAULT NULL,
  `description` MEDIUMTEXT DEFAULT NULL,
  `cover_url` VARCHAR(1000) DEFAULT NULL,
  `cover_type` VARCHAR(100) DEFAULT NULL,
  `cover_path` VARCHAR(512) DEFAULT NULL,
  `price` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `class_count` INT UNSIGNED NOT NULL DEFAULT 1,
  `valid_days` INT UNSIGNED NOT NULL DEFAULT 120,
  `activation_days` INT UNSIGNED NOT NULL DEFAULT 120,
  `transferable` TINYINT(1) NOT NULL DEFAULT 0,
  `external_purchase_url` VARCHAR(1000) DEFAULT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_products_code` (`code`),
  KEY `idx_course_products_status_sort` (`status`, `sort_order`, `id`),
  KEY `idx_course_products_owner_status_sort` (`owner_user_id`, `status`, `sort_order`, `id`),
  CONSTRAINT `fk_course_products_owner_user` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) DEFAULT NULL,
  `code` VARCHAR(40) NOT NULL,
  `product_id` INT UNSIGNED DEFAULT NULL,
  `title` VARCHAR(255) NOT NULL,
  `coach_user_id` CHAR(36) DEFAULT NULL,
  `coach_name` VARCHAR(255) DEFAULT NULL,
  `location` VARCHAR(255) DEFAULT NULL,
  `starts_at` DATETIME NOT NULL,
  `ends_at` DATETIME NOT NULL,
  `booking_open_at` DATETIME DEFAULT NULL,
  `booking_close_at` DATETIME DEFAULT NULL,
  `capacity` INT UNSIGNED NOT NULL DEFAULT 20,
  `notes` TEXT DEFAULT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_sessions_code` (`code`),
  KEY `idx_course_sessions_time_status` (`starts_at`, `status`),
  KEY `idx_course_sessions_product` (`product_id`),
  KEY `idx_course_sessions_coach` (`coach_user_id`),
  KEY `idx_course_sessions_owner_status_time` (`owner_user_id`, `status`, `starts_at`, `id`),
  CONSTRAINT `fk_course_sessions_product` FOREIGN KEY (`product_id`) REFERENCES `course_products` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_course_sessions_coach` FOREIGN KEY (`coach_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_course_sessions_owner_user` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_orders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(40) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `buyer_name` VARCHAR(255) NOT NULL,
  `buyer_email` VARCHAR(255) NOT NULL,
  `buyer_phone` VARCHAR(20) DEFAULT NULL,
  `product_id` INT UNSIGNED NOT NULL,
  `quantity` INT UNSIGNED NOT NULL DEFAULT 1,
  `unit_price` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `total_amount` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `remittance_last5` CHAR(5) DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `terms_accepted_at` DATETIME NOT NULL,
  `note` TEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_orders_code` (`code`),
  KEY `idx_course_orders_user_created` (`user_id`, `created_at`),
  KEY `idx_course_orders_status_created` (`status`, `created_at`),
  KEY `idx_course_orders_product` (`product_id`),
  CONSTRAINT `fk_course_orders_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_orders_product` FOREIGN KEY (`product_id`) REFERENCES `course_products` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_request_idempotency_keys` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` CHAR(36) NOT NULL,
  `operation` VARCHAR(32) NOT NULL,
  `request_key` VARCHAR(128) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'processing',
  `response_json` JSON DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_request_user_operation_key` (`user_id`, `operation`, `request_key`),
  KEY `idx_course_request_operation_status_updated` (`operation`, `status`, `updated_at`),
  KEY `idx_course_request_created_at` (`created_at`),
  CONSTRAINT `fk_course_request_idempotency_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_tickets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(40) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `owner_name` VARCHAR(255) DEFAULT NULL,
  `owner_email` VARCHAR(255) NOT NULL,
  `product_id` INT UNSIGNED NOT NULL,
  `order_id` BIGINT UNSIGNED DEFAULT NULL,
  `total_uses` INT UNSIGNED NOT NULL DEFAULT 1,
  `remaining_uses` INT UNSIGNED NOT NULL DEFAULT 1,
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `issued_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `activation_deadline` DATE DEFAULT NULL,
  `activated_at` DATETIME DEFAULT NULL,
  `expires_at` DATE DEFAULT NULL,
  `paused_at` DATETIME DEFAULT NULL,
  `pause_reason` VARCHAR(500) DEFAULT NULL,
  `transferable` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_tickets_code` (`code`),
  KEY `idx_course_tickets_user_status` (`user_id`, `status`),
  KEY `idx_course_tickets_product` (`product_id`),
  KEY `idx_course_tickets_order` (`order_id`),
  CONSTRAINT `fk_course_tickets_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_tickets_product` FOREIGN KEY (`product_id`) REFERENCES `course_products` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_tickets_order` FOREIGN KEY (`order_id`) REFERENCES `course_orders` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_bookings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `session_id` BIGINT UNSIGNED NOT NULL,
  `ticket_id` BIGINT UNSIGNED NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `attendee_name` VARCHAR(255) NOT NULL,
  `attendee_email` VARCHAR(255) NOT NULL,
  `verify_code` VARCHAR(40) DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'booked',
  `booked_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cancelled_at` DATETIME DEFAULT NULL,
  `attended_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_booking_session_user` (`session_id`, `user_id`),
  UNIQUE KEY `uq_course_bookings_verify_code` (`verify_code`),
  KEY `idx_course_bookings_user_created` (`user_id`, `created_at`),
  KEY `idx_course_bookings_session_status` (`session_id`, `status`),
  KEY `idx_course_bookings_ticket` (`ticket_id`),
  CONSTRAINT `fk_course_bookings_session` FOREIGN KEY (`session_id`) REFERENCES `course_sessions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_course_bookings_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `course_tickets` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_bookings_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_attendance_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `session_id` BIGINT UNSIGNED NOT NULL,
  `booking_id` BIGINT UNSIGNED DEFAULT NULL,
  `ticket_id` BIGINT UNSIGNED NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `action` VARCHAR(24) NOT NULL DEFAULT 'redeem',
  `quantity` INT UNSIGNED NOT NULL DEFAULT 1,
  `staff_user_id` CHAR(36) NOT NULL,
  `note` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_attendance_booking_action` (`booking_id`, `action`),
  KEY `idx_course_attendance_session` (`session_id`, `created_at`),
  KEY `idx_course_attendance_ticket` (`ticket_id`, `created_at`),
  CONSTRAINT `fk_course_attendance_session` FOREIGN KEY (`session_id`) REFERENCES `course_sessions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_attendance_booking` FOREIGN KEY (`booking_id`) REFERENCES `course_bookings` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_course_attendance_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `course_tickets` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_attendance_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_attendance_staff` FOREIGN KEY (`staff_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_ticket_transfers` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ticket_id` BIGINT UNSIGNED NOT NULL,
  `from_user_id` CHAR(36) NOT NULL,
  `to_user_id` CHAR(36) DEFAULT NULL,
  `from_email` VARCHAR(255) NOT NULL,
  `to_email` VARCHAR(255) DEFAULT NULL,
  `code` VARCHAR(32) DEFAULT NULL,
  `status` ENUM('pending','accepted','declined','canceled','expired') NOT NULL DEFAULT 'accepted',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_ticket_transfers_code` (`code`),
  KEY `idx_course_ticket_transfers_ticket` (`ticket_id`, `created_at`),
  KEY `idx_course_ticket_transfers_users` (`from_user_id`, `to_user_id`),
  KEY `idx_course_ticket_transfers_to_user` (`to_user_id`),
  KEY `idx_course_ticket_transfers_to_email` (`to_email`),
  KEY `idx_course_ticket_transfers_status` (`status`),
  CONSTRAINT `fk_course_ticket_transfers_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `course_tickets` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_ticket_transfers_from` FOREIGN KEY (`from_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_ticket_transfers_to` FOREIGN KEY (`to_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_ticket_transfer_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `transfer_id` BIGINT UNSIGNED NOT NULL,
  `ticket_id` BIGINT UNSIGNED NOT NULL,
  `ticket_code` VARCHAR(40) DEFAULT NULL,
  `user_id` CHAR(36) NOT NULL,
  `from_user_id` CHAR(36) NOT NULL,
  `to_user_id` CHAR(36) DEFAULT NULL,
  `action` VARCHAR(32) NOT NULL,
  `method` VARCHAR(16) NOT NULL,
  `product_name` VARCHAR(255) NOT NULL,
  `from_email` VARCHAR(255) DEFAULT NULL,
  `to_email` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_transfer_log_event` (`transfer_id`, `user_id`, `action`),
  KEY `idx_course_transfer_logs_user_created` (`user_id`, `created_at`, `id`),
  KEY `idx_course_transfer_logs_ticket` (`ticket_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `email_login_codes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `code_hash` CHAR(64) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `used_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_email_login_codes_email_created` (`email`, `created_at`, `id`),
  KEY `idx_email_login_codes_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;

/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;

/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
