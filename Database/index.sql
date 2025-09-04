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
    `cover_data` LONGBLOB NULL,
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
    `verify_code_pre_pickup` varchar(12) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `verify_code_post_dropoff` varchar(12) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `verify_code_post_pickup` varchar(12) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `status` enum (
      'service_booking',
      'pre_dropoff',
      'pre_pickup',
      'post_dropoff',
      'post_pickup',
      'done'
    ) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'service_booking'
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
-- 資料表結構 `users`
--
CREATE TABLE
  `users` (
    `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
    `username` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
    `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
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
    `password_hash`,
    `created_at`,
    `updated_at`
  )
VALUES
  (
    '452edb78-fae1-4467-8be3-481b552ea382',
    'ppgirl',
    'ppgirlfan@gmail.com',
    '$2b$12$LHO.frFR5U0ofdc0p1cnvuT/CW0jOygaRh/t9bvbkbiD5WI.Lodc.',
    '2025-08-27 04:21:06',
    '2025-08-27 04:21:06'
  ),
  (
    'f950d304-e124-49d1-ae1c-43bdb73ca465',
    'Mengxiaozhi',
    'me@xiaozhi.moe',
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
-- 使用資料表自動遞增(AUTO_INCREMENT) `tickets`
--
ALTER TABLE `tickets` MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT;

-- 使用資料表自動遞增(AUTO_INCREMENT) `ticket_transfers`
ALTER TABLE `ticket_transfers` MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT;

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
-- 資料表的限制式 `tickets`
--
ALTER TABLE `tickets` ADD CONSTRAINT `fk_tickets_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `events` ADD CONSTRAINT `fk_events_owner_user` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;

/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;

/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
