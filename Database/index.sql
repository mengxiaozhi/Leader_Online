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
    `payment_status` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
    `fulfillment_status` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
    `row_version` int UNSIGNED NOT NULL DEFAULT 1,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
    `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
    `description` text COLLATE utf8mb4_unicode_ci,
    `cover_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `cover_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `cover_data` longblob,
    `cover_path` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `price` decimal(10, 2) NOT NULL,
    `owner_user_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `listing_status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'published',
    `max_purchase_quantity` tinyint UNSIGNED NOT NULL DEFAULT 10,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `chk_products_max_purchase_quantity` CHECK (`max_purchase_quantity` BETWEEN 1 AND 99)
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
    `order_id` bigint UNSIGNED DEFAULT NULL,
    `delivery_point_id` int UNSIGNED DEFAULT NULL,
    `ticket_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
    `event_id` int UNSIGNED DEFAULT NULL,
    `store_id` int UNSIGNED DEFAULT NULL,
    `driver_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
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
-- 資料表結構 `google_wallet_object_sync_jobs`
--
CREATE TABLE IF NOT EXISTS `google_wallet_object_sync_jobs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `object_type` VARCHAR(32) NOT NULL DEFAULT 'generic',
  `resource_type` VARCHAR(32) NOT NULL,
  `resource_id` BIGINT UNSIGNED DEFAULT NULL,
  `holder_user_id` CHAR(36) DEFAULT NULL,
  `object_id` VARCHAR(255) NOT NULL,
  `action` ENUM('UPSERT','INACTIVATE') NOT NULL DEFAULT 'UPSERT',
  `payload` JSON NOT NULL,
  `generation` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `status` ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
  `attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `max_attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 8,
  `available_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lease_owner` VARCHAR(128) DEFAULT NULL,
  `lease_expires_at` DATETIME DEFAULT NULL,
  `last_error_code` VARCHAR(64) DEFAULT NULL,
  `last_error_message` TEXT DEFAULT NULL,
  `completed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_google_wallet_sync_object` (`object_id`),
  KEY `idx_google_wallet_sync_due` (`status`, `available_at`, `lease_expires_at`),
  KEY `idx_google_wallet_sync_lease` (`lease_expires_at`),
  KEY `idx_google_wallet_sync_resource` (`resource_type`, `resource_id`),
  KEY `idx_google_wallet_sync_holder` (`holder_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
--
-- 資料表結構 `storage_file_cleanup_jobs`
--
CREATE TABLE IF NOT EXISTS `storage_file_cleanup_jobs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `storage_path` VARCHAR(512) NOT NULL,
  `status` ENUM('pending','processing','completed') NOT NULL DEFAULT 'pending',
  `attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `available_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lease_owner` VARCHAR(128) DEFAULT NULL,
  `lease_expires_at` DATETIME DEFAULT NULL,
  `last_error_code` VARCHAR(64) DEFAULT NULL,
  `last_error_message` TEXT DEFAULT NULL,
  `completed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_storage_file_cleanup_path` (`storage_path`),
  KEY `idx_storage_file_cleanup_due` (`status`, `available_at`, `lease_expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
    'service_booking'
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
    'service_booking'
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
    'service_booking'
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
    `product_id` int UNSIGNED DEFAULT NULL,
    `order_id` bigint UNSIGNED DEFAULT NULL,
    `expiry` date DEFAULT NULL,
    `uuid` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
    `discount` int NOT NULL DEFAULT '0',
    `used` tinyint (1) NOT NULL DEFAULT '0',
    `voided_at` datetime DEFAULT NULL,
    `void_reason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `replaced_by_ticket_id` bigint UNSIGNED DEFAULT NULL,
    `row_version` int UNSIGNED NOT NULL DEFAULT 1,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------
--
-- 資料表結構 `ticket_logs`
--
CREATE TABLE IF NOT EXISTS `ticket_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ticket_id` BIGINT UNSIGNED NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  `meta` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ticket_logs_user` (`user_id`),
  KEY `idx_ticket_logs_ticket` (`ticket_id`),
  KEY `idx_ticket_logs_action` (`action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
ADD KEY `idx_orders_user` (`user_id`),
ADD KEY `idx_orders_lifecycle` (`payment_status`, `fulfillment_status`, `created_at`, `id`);

--
-- 資料表索引 `products`
--
ALTER TABLE `products` ADD PRIMARY KEY (`id`),
ADD UNIQUE KEY `uq_products_code` (`code`),
ADD KEY `idx_products_owner` (`owner_user_id`),
ADD KEY `idx_products_listing_status` (`listing_status`);

--
-- 資料表索引 `reservations`
--
ALTER TABLE `reservations` ADD PRIMARY KEY (`id`),
ADD KEY `idx_reservations_user` (`user_id`),
ADD KEY `idx_reservations_order` (`order_id`),
ADD KEY `idx_reservations_delivery_point` (`delivery_point_id`),
ADD KEY `idx_reservations_event` (`event_id`),
ADD KEY `idx_reservations_store` (`store_id`),
ADD KEY `idx_reservations_driver` (`driver_id`);

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
ADD KEY `idx_tickets_user` (`user_id`),
ADD KEY `idx_tickets_product` (`product_id`),
ADD KEY `idx_tickets_order` (`order_id`, `id`),
ADD KEY `idx_tickets_voided` (`voided_at`, `id`);

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
ALTER TABLE `tickets` ADD CONSTRAINT `fk_tickets_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT `fk_tickets_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE SET NULL,
ADD CONSTRAINT `fk_tickets_replaced_by` FOREIGN KEY (`replaced_by_ticket_id`) REFERENCES `tickets` (`id`) ON DELETE SET NULL;
ALTER TABLE `events` ADD CONSTRAINT `fk_events_owner_user` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `user_carts` ADD CONSTRAINT `fk_user_carts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS `course_carts` (
  `user_id` CHAR(36) NOT NULL,
  `items` JSON NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_course_carts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `order_action_idempotency` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `actor_user_id` CHAR(36) NOT NULL,
  `operation` VARCHAR(64) NOT NULL,
  `resource_id` BIGINT UNSIGNED NOT NULL,
  `request_key` VARCHAR(128) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'processing',
  `response_json` JSON DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_order_action_actor_operation_key` (`actor_user_id`, `operation`, `request_key`),
  KEY `idx_order_action_resource` (`operation`, `resource_id`),
  KEY `idx_order_action_status_updated` (`status`, `updated_at`),
  CONSTRAINT `fk_order_action_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `order_lifecycle_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `domain` VARCHAR(16) NOT NULL,
  `order_id` BIGINT UNSIGNED NOT NULL,
  `actor_user_id` CHAR(36) DEFAULT NULL,
  `action` VARCHAR(64) NOT NULL,
  `from_payment_status` VARCHAR(24) DEFAULT NULL,
  `to_payment_status` VARCHAR(24) DEFAULT NULL,
  `from_fulfillment_status` VARCHAR(24) DEFAULT NULL,
  `to_fulfillment_status` VARCHAR(24) DEFAULT NULL,
  `reason` VARCHAR(500) DEFAULT NULL,
  `idempotency_key` VARCHAR(128) DEFAULT NULL,
  `metadata` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_order_lifecycle_replay` (`domain`, `order_id`, `action`, `idempotency_key`),
  KEY `idx_order_lifecycle_order` (`domain`, `order_id`, `created_at`, `id`),
  KEY `idx_order_lifecycle_actor` (`actor_user_id`, `created_at`),
  CONSTRAINT `fk_order_lifecycle_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  `max_purchase_quantity` TINYINT UNSIGNED NOT NULL DEFAULT 10,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_products_code` (`code`),
  KEY `idx_course_products_status_sort` (`status`, `sort_order`, `id`),
  KEY `idx_course_products_owner_status_sort` (`owner_user_id`, `status`, `sort_order`, `id`),
  CONSTRAINT `chk_course_products_max_purchase_quantity` CHECK (`max_purchase_quantity` BETWEEN 1 AND 99),
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

CREATE TABLE IF NOT EXISTS `course_checkout_batches` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` CHAR(36) NOT NULL,
  `idempotency_key` VARCHAR(128) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'processing',
  `response_json` JSON DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_checkout_user_key` (`user_id`, `idempotency_key`),
  KEY `idx_course_checkout_status_updated` (`status`, `updated_at`),
  CONSTRAINT `fk_course_checkout_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_orders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `checkout_batch_id` BIGINT UNSIGNED DEFAULT NULL,
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
  `payment_status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `fulfillment_status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `terms_accepted_at` DATETIME NOT NULL,
  `note` TEXT DEFAULT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_orders_code` (`code`),
  KEY `idx_course_orders_user_created` (`user_id`, `created_at`),
  KEY `idx_course_orders_status_created` (`status`, `created_at`),
  KEY `idx_course_orders_product` (`product_id`),
  KEY `idx_course_orders_lifecycle` (`payment_status`, `fulfillment_status`, `created_at`, `id`),
  KEY `idx_course_orders_checkout_batch` (`checkout_batch_id`, `id`),
  CONSTRAINT `fk_course_orders_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_orders_product` FOREIGN KEY (`product_id`) REFERENCES `course_products` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_orders_checkout_batch` FOREIGN KEY (`checkout_batch_id`) REFERENCES `course_checkout_batches` (`id`) ON DELETE SET NULL
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

-- Course count-card V2 normalized schema (fresh install).
-- Migration 049: normalized course count-card domain and GAS cutover staging.
--
-- Design invariants:
--   * course_products remains the backwards-compatible ShopProduct surface.
--   * course_usage_events is the immutable balance source of truth.
--   * remaining_uses / remaining_uses_cache are transactional read caches only.
--   * reservations and attendance invitations reserve uses through active holds.
--   * imported data is staged and reconciled before the one-time cutover marker
--     can be changed by the import CLI.
--
-- This migration is safe to rerun. Legacy backfills use deterministic source
-- keys and INSERT IGNORE; ALTER statements are guarded through INFORMATION_SCHEMA.
-- Run it in the course maintenance window: MySQL DDL commits implicitly and the
-- immutable-ledger triggers are dropped/recreated only after every backfill.

CREATE TABLE IF NOT EXISTS `course_schema_versions` (
  `version` VARCHAR(80) NOT NULL,
  `description` VARCHAR(255) NOT NULL,
  `applied_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Remove a marker left by an earlier complete revision before repairing/rechecking
-- every object. It is restored only at the very end.
DELETE FROM `course_schema_versions`
 WHERE `version` = '049_course_count_card_normalization';

CREATE TABLE IF NOT EXISTS `course_students` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) DEFAULT NULL,
  `tenant_key` CHAR(36) NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  `user_id` CHAR(36) DEFAULT NULL,
  `email` VARCHAR(255) NOT NULL,
  `email_normalized` VARCHAR(255) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(32) DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending_claim',
  `source_system` VARCHAR(32) NOT NULL DEFAULT 'leader',
  `source_id` VARCHAR(128) DEFAULT NULL,
  `claimed_at` DATETIME DEFAULT NULL,
  `metadata_json` JSON DEFAULT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_students_tenant_email` (`tenant_key`, `email_normalized`),
  UNIQUE KEY `uq_course_students_tenant_user` (`tenant_key`, `user_id`),
  UNIQUE KEY `uq_course_students_source` (`source_system`, `source_id`),
  KEY `idx_course_students_owner_status` (`owner_user_id`, `status`, `id`),
  KEY `idx_course_students_user` (`user_id`),
  CONSTRAINT `fk_course_students_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_students_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_ticket_products` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) DEFAULT NULL,
  `code` VARCHAR(64) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `class_count` INT UNSIGNED NOT NULL DEFAULT 1,
  `valid_days` INT UNSIGNED NOT NULL DEFAULT 120,
  `activation_days` INT UNSIGNED NOT NULL DEFAULT 120,
  `transferable` TINYINT(1) NOT NULL DEFAULT 0,
  `max_transfers` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `terms_text` MEDIUMTEXT DEFAULT NULL,
  `redemption_policy_json` JSON DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'draft',
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_ticket_products_code` (`code`),
  KEY `idx_course_ticket_products_owner_status` (`owner_user_id`, `status`, `id`),
  CONSTRAINT `fk_course_ticket_products_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Guarded ALTER helpers are dropped at the end of this migration.
DROP PROCEDURE IF EXISTS `course_049_add_column`;
DELIMITER $$
CREATE PROCEDURE `course_049_add_column`(
  IN p_table_name VARCHAR(64),
  IN p_column_name VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND COLUMN_NAME = p_column_name
  ) THEN
    SET @course_049_column_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD COLUMN `', REPLACE(p_column_name, '`', '``'), '` ',
      p_definition
    );
    PREPARE course_049_column_stmt FROM @course_049_column_sql;
    EXECUTE course_049_column_stmt;
    DEALLOCATE PREPARE course_049_column_stmt;
  END IF;
END$$
DELIMITER ;

CALL `course_049_add_column`('course_products', 'ticket_product_id', 'BIGINT UNSIGNED NULL AFTER `owner_user_id`');
CALL `course_049_add_column`('course_products', 'returning_student_only', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `transferable`');
CALL `course_049_add_column`('course_products', 'require_addon_for_new', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `returning_student_only`');
CALL `course_049_add_column`('course_products', 'row_version', 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER `sort_order`');

CALL `course_049_add_column`('course_orders', 'student_id', 'BIGINT UNSIGNED NULL AFTER `user_id`');
CALL `course_049_add_column`('course_orders', 'row_version', 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER `note`');

CALL `course_049_add_column`('course_sessions', 'scenario_id', 'BIGINT UNSIGNED NULL AFTER `product_id`');
CALL `course_049_add_column`('course_sessions', 'coach_profile_id', 'BIGINT UNSIGNED NULL AFTER `coach_user_id`');
CALL `course_049_add_column`('course_sessions', 'booking_open_minutes_before', 'INT UNSIGNED NULL AFTER `booking_close_at`');
CALL `course_049_add_column`('course_sessions', 'booking_close_minutes_before', 'INT UNSIGNED NULL AFTER `booking_open_minutes_before`');
CALL `course_049_add_column`('course_sessions', 'cancel_close_minutes_before', 'INT UNSIGNED NULL AFTER `booking_close_minutes_before`');
CALL `course_049_add_column`('course_sessions', 'redeem_open_at', 'DATETIME NULL AFTER `cancel_close_minutes_before`');
CALL `course_049_add_column`('course_sessions', 'redeem_close_at', 'DATETIME NULL AFTER `redeem_open_at`');
CALL `course_049_add_column`('course_sessions', 'redeem_open_minutes_before', 'INT UNSIGNED NULL AFTER `redeem_close_at`');
CALL `course_049_add_column`('course_sessions', 'redeem_close_minutes_after', 'INT UNSIGNED NULL AFTER `redeem_open_minutes_before`');
CALL `course_049_add_column`('course_sessions', 'settings_snapshot_json', 'JSON NULL AFTER `notes`');
CALL `course_049_add_column`('course_sessions', 'row_version', 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER `status`');

CALL `course_049_add_column`('course_tickets', 'student_id', 'BIGINT UNSIGNED NULL AFTER `user_id`');
CALL `course_049_add_column`('course_tickets', 'ticket_product_id', 'BIGINT UNSIGNED NULL AFTER `product_id`');
CALL `course_049_add_column`('course_tickets', 'order_item_id', 'BIGINT UNSIGNED NULL AFTER `order_id`');
CALL `course_049_add_column`('course_tickets', 'product_code_snapshot', 'VARCHAR(64) NULL AFTER `order_item_id`');
CALL `course_049_add_column`('course_tickets', 'product_name_snapshot', 'VARCHAR(255) NULL AFTER `product_code_snapshot`');
CALL `course_049_add_column`('course_tickets', 'product_class_count_snapshot', 'INT UNSIGNED NULL AFTER `product_name_snapshot`');
CALL `course_049_add_column`('course_tickets', 'product_valid_days_snapshot', 'INT UNSIGNED NULL AFTER `product_class_count_snapshot`');
CALL `course_049_add_column`('course_tickets', 'product_activation_days_snapshot', 'INT UNSIGNED NULL AFTER `product_valid_days_snapshot`');
CALL `course_049_add_column`('course_tickets', 'product_transferable_snapshot', 'TINYINT(1) NULL AFTER `product_activation_days_snapshot`');
CALL `course_049_add_column`('course_tickets', 'product_max_transfers_snapshot', 'SMALLINT UNSIGNED NULL AFTER `product_transferable_snapshot`');
CALL `course_049_add_column`('course_tickets', 'product_terms_snapshot', 'MEDIUMTEXT NULL AFTER `product_max_transfers_snapshot`');
CALL `course_049_add_column`('course_tickets', 'product_redemption_policy_snapshot', 'JSON NULL AFTER `product_terms_snapshot`');
CALL `course_049_add_column`('course_tickets', 'provider_user_id_snapshot', 'CHAR(36) NULL AFTER `product_redemption_policy_snapshot`');
CALL `course_049_add_column`('course_tickets', 'provider_name_snapshot', 'VARCHAR(255) NULL AFTER `provider_user_id_snapshot`');
CALL `course_049_add_column`('course_tickets', 'remaining_uses_cache', 'INT NOT NULL DEFAULT 0 AFTER `remaining_uses`');
CALL `course_049_add_column`('course_tickets', 'frozen_at', 'DATETIME NULL AFTER `paused_at`');
CALL `course_049_add_column`('course_tickets', 'freeze_reason', 'VARCHAR(500) NULL AFTER `frozen_at`');
CALL `course_049_add_column`('course_tickets', 'row_version', 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER `transferable`');

CALL `course_049_add_column`('course_bookings', 'resolution_reason', 'VARCHAR(500) NULL AFTER `attended_at`');
CALL `course_049_add_column`('course_bookings', 'student_id', 'BIGINT UNSIGNED NULL AFTER `user_id`');
CALL `course_049_add_column`('course_bookings', 'student_identity_conflict_key', 'VARCHAR(191) NULL AFTER `student_id`');
CALL `course_049_add_column`('course_bookings', 'row_version', 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER `resolution_reason`');

CALL `course_049_add_column`('course_request_idempotency_keys', 'resource_type', 'VARCHAR(64) NULL AFTER `operation`');
CALL `course_049_add_column`('course_request_idempotency_keys', 'resource_id', 'BIGINT UNSIGNED NULL AFTER `resource_type`');
CALL `course_049_add_column`('course_request_idempotency_keys', 'expires_at', 'DATETIME NULL AFTER `response_json`');
CALL `course_049_add_column`('course_request_idempotency_keys', 'row_version', 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER `expires_at`');

-- A GAS student or a no-ticket NO_SHOW may not have a Leader account/ticket yet.
-- Existing rows remain valid while these two legacy foreign keys become nullable.
DROP PROCEDURE IF EXISTS `course_049_make_nullable`;
DELIMITER $$
CREATE PROCEDURE `course_049_make_nullable`(
  IN p_table_name VARCHAR(64),
  IN p_column_name VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF EXISTS (
    SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND COLUMN_NAME = p_column_name
       AND IS_NULLABLE = 'NO'
  ) THEN
    SET @course_049_nullable_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` MODIFY COLUMN `', REPLACE(p_column_name, '`', '``'), '` ',
      p_definition
    );
    PREPARE course_049_nullable_stmt FROM @course_049_nullable_sql;
    EXECUTE course_049_nullable_stmt;
    DEALLOCATE PREPARE course_049_nullable_stmt;
  END IF;
END$$
DELIMITER ;

CALL `course_049_make_nullable`('course_bookings', 'ticket_id', 'BIGINT UNSIGNED NULL');
CALL `course_049_make_nullable`('course_bookings', 'user_id', 'CHAR(36) NULL');
CALL `course_049_make_nullable`('course_tickets', 'user_id', 'CHAR(36) NULL');
CALL `course_049_make_nullable`('course_tickets', 'product_id', 'INT UNSIGNED NULL');
CALL `course_049_make_nullable`('course_attendance_logs', 'user_id', 'CHAR(36) NULL');
CALL `course_049_make_nullable`('course_orders', 'user_id', 'CHAR(36) NULL');
CALL `course_049_make_nullable`('course_orders', 'product_id', 'INT UNSIGNED NULL');

-- TicketProduct is backfilled one-to-one from the legacy ShopProduct. Keeping
-- the numeric ID makes reconciliation deterministic and preserves product IDs.
INSERT IGNORE INTO `course_ticket_products` (
  `id`, `owner_user_id`, `code`, `name`, `description`, `class_count`,
  `valid_days`, `activation_days`, `transferable`, `max_transfers`,
  `status`, `created_at`, `updated_at`
)
SELECT
  p.`id`, p.`owner_user_id`, p.`code`, p.`name`, p.`description`, p.`class_count`,
  p.`valid_days`, p.`activation_days`, p.`transferable`, 1,
  p.`status`, p.`created_at`, p.`updated_at`
FROM `course_products` p;

UPDATE `course_products`
   SET `ticket_product_id` = `id`
 WHERE `id` >= 1
   AND `ticket_product_id` IS NULL;

CREATE TABLE IF NOT EXISTS `course_shop_product_components` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `shop_product_id` INT UNSIGNED NOT NULL,
  `ticket_product_id` BIGINT UNSIGNED NOT NULL,
  `component_role` VARCHAR(24) NOT NULL DEFAULT 'primary',
  `quantity` INT UNSIGNED NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_shop_component` (`shop_product_id`, `ticket_product_id`, `component_role`),
  KEY `idx_course_shop_components_ticket_product` (`ticket_product_id`),
  CONSTRAINT `fk_course_shop_components_shop` FOREIGN KEY (`shop_product_id`) REFERENCES `course_products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_course_shop_components_ticket` FOREIGN KEY (`ticket_product_id`) REFERENCES `course_ticket_products` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `course_shop_product_components` (
  `shop_product_id`, `ticket_product_id`, `component_role`, `quantity`, `sort_order`
)
SELECT p.`id`, p.`ticket_product_id`, 'primary', 1, 0
  FROM `course_products` p
 WHERE p.`ticket_product_id` IS NOT NULL;

CREATE TABLE IF NOT EXISTS `course_product_returning_requirements` (
  `product_id` INT UNSIGNED NOT NULL,
  `qualifying_ticket_product_id` BIGINT UNSIGNED NOT NULL,
  `lookback_days` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`product_id`, `qualifying_ticket_product_id`),
  KEY `idx_course_returning_requirement_ticket` (`qualifying_ticket_product_id`),
  CONSTRAINT `fk_course_returning_requirement_product` FOREIGN KEY (`product_id`) REFERENCES `course_products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_course_returning_requirement_ticket` FOREIGN KEY (`qualifying_ticket_product_id`) REFERENCES `course_ticket_products` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_product_required_addons` (
  `product_id` INT UNSIGNED NOT NULL,
  `addon_product_id` INT UNSIGNED NOT NULL,
  `quantity` INT UNSIGNED NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`product_id`, `addon_product_id`),
  KEY `idx_course_required_addons_addon` (`addon_product_id`),
  CONSTRAINT `fk_course_required_addons_product` FOREIGN KEY (`product_id`) REFERENCES `course_products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_course_required_addons_addon` FOREIGN KEY (`addon_product_id`) REFERENCES `course_products` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_order_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT UNSIGNED NOT NULL,
  `shop_product_id` INT UNSIGNED DEFAULT NULL,
  `ticket_product_id` BIGINT UNSIGNED DEFAULT NULL,
  `item_type` VARCHAR(24) NOT NULL DEFAULT 'primary',
  `line_identity_key` VARCHAR(191) GENERATED ALWAYS AS (
    CONCAT_WS(':', `item_type`, COALESCE(`shop_product_id`, 0), COALESCE(`ticket_product_id`, 0))
  ) STORED,
  `item_code_snapshot` VARCHAR(64) NOT NULL,
  `item_name_snapshot` VARCHAR(255) NOT NULL,
  `quantity` INT UNSIGNED NOT NULL DEFAULT 1,
  `unit_price` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `line_total` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `issuance_status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `metadata_json` JSON DEFAULT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_order_items_line_identity` (`order_id`, `line_identity_key`),
  KEY `idx_course_order_items_ticket_product` (`ticket_product_id`),
  KEY `idx_course_order_items_status` (`issuance_status`, `id`),
  CONSTRAINT `fk_course_order_items_order` FOREIGN KEY (`order_id`) REFERENCES `course_orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_course_order_items_shop_product` FOREIGN KEY (`shop_product_id`) REFERENCES `course_products` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_order_items_ticket_product` FOREIGN KEY (`ticket_product_id`) REFERENCES `course_ticket_products` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL `course_049_add_column`(
  'course_order_items',
  'line_identity_key',
  'VARCHAR(191) GENERATED ALWAYS AS (CONCAT_WS('':'', `item_type`, COALESCE(`shop_product_id`, 0), COALESCE(`ticket_product_id`, 0))) STORED AFTER `item_type`'
);

INSERT IGNORE INTO `course_order_items` (
  `id`, `order_id`, `shop_product_id`, `ticket_product_id`, `item_type`,
  `item_code_snapshot`, `item_name_snapshot`, `quantity`, `unit_price`,
  `line_total`, `issuance_status`, `created_at`, `updated_at`
)
SELECT
  o.`id`, o.`id`, o.`product_id`, p.`ticket_product_id`, 'primary',
  p.`code`, p.`name`, o.`quantity`, o.`unit_price`, o.`total_amount`,
  CASE
    WHEN (
      SELECT COUNT(*)
        FROM `course_tickets` issued_ticket
       WHERE issued_ticket.`order_id` = o.`id`
         AND issued_ticket.`product_id` = o.`product_id`
    ) >= o.`quantity`
    THEN 'issued'
    ELSE 'pending'
  END,
  o.`created_at`, o.`updated_at`
FROM `course_orders` o
JOIN `course_products` p ON p.`id` = o.`product_id`;

CREATE TABLE IF NOT EXISTS `course_redeem_scenarios` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) DEFAULT NULL,
  `code` VARCHAR(64) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `redeem_open_minutes_before` INT UNSIGNED DEFAULT NULL,
  `redeem_close_minutes_after` INT UNSIGNED DEFAULT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_redeem_scenarios_code` (`code`),
  KEY `idx_course_redeem_scenarios_owner_status` (`owner_user_id`, `status`, `id`),
  CONSTRAINT `fk_course_redeem_scenarios_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `course_redeem_scenarios` (
  `owner_user_id`, `code`, `name`, `description`, `status`
)
VALUES (
  NULL, 'PLATFORM-DEFAULT', '平台預設核銷情境',
  '未指定票券限制的相容情境；時間窗仍由統一設定解析器決定。', 'active'
);

INSERT IGNORE INTO `course_redeem_scenarios` (
  `owner_user_id`, `code`, `name`, `description`, `status`
)
SELECT
  p.`owner_user_id`, CONCAT('LEGACY-', p.`code`), CONCAT(p.`name`, '相容情境'),
  '由 migration 049 依既有單一商品場次關聯建立。', 'active'
FROM `course_products` p;

CREATE TABLE IF NOT EXISTS `course_scenario_allowed_products` (
  `scenario_id` BIGINT UNSIGNED NOT NULL,
  `ticket_product_id` BIGINT UNSIGNED NOT NULL,
  `priority` INT UNSIGNED NOT NULL DEFAULT 100,
  `redeem_open_minutes_before` INT UNSIGNED DEFAULT NULL,
  `redeem_close_minutes_after` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`scenario_id`, `ticket_product_id`),
  KEY `idx_course_scenario_allowed_priority` (`scenario_id`, `priority`, `ticket_product_id`),
  KEY `idx_course_scenario_allowed_ticket` (`ticket_product_id`),
  CONSTRAINT `fk_course_scenario_allowed_scenario` FOREIGN KEY (`scenario_id`) REFERENCES `course_redeem_scenarios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_course_scenario_allowed_ticket` FOREIGN KEY (`ticket_product_id`) REFERENCES `course_ticket_products` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `course_scenario_allowed_products` (
  `scenario_id`, `ticket_product_id`, `priority`
)
SELECT s.`id`, p.`ticket_product_id`, 100
  FROM `course_products` p
  JOIN `course_redeem_scenarios` s ON s.`code` = CONCAT('LEGACY-', p.`code`)
 WHERE p.`ticket_product_id` IS NOT NULL;

INSERT IGNORE INTO `course_scenario_allowed_products` (
  `scenario_id`, `ticket_product_id`, `priority`
)
SELECT s.`id`, tp.`id`, 1000
  FROM `course_redeem_scenarios` s
  CROSS JOIN `course_ticket_products` tp
 WHERE s.`code` = 'PLATFORM-DEFAULT';

UPDATE `course_sessions` cs
JOIN `course_products` p ON p.`id` = cs.`product_id`
JOIN `course_redeem_scenarios` s ON s.`code` = CONCAT('LEGACY-', p.`code`)
   SET cs.`scenario_id` = s.`id`
 WHERE cs.`id` >= 1
   AND cs.`scenario_id` IS NULL;

UPDATE `course_sessions` cs
JOIN `course_redeem_scenarios` s ON s.`code` = 'PLATFORM-DEFAULT'
   SET cs.`scenario_id` = s.`id`
 WHERE cs.`id` >= 1
   AND cs.`scenario_id` IS NULL;

CREATE TABLE IF NOT EXISTS `course_settings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scope_key` VARCHAR(80) NOT NULL,
  `scope` VARCHAR(24) NOT NULL,
  `owner_user_id` CHAR(36) DEFAULT NULL,
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Taipei',
  `booking_open_minutes_before` INT UNSIGNED NOT NULL DEFAULT 43200,
  `booking_close_minutes_before` INT UNSIGNED NOT NULL DEFAULT 0,
  `cancel_close_minutes_before` INT UNSIGNED NOT NULL DEFAULT 0,
  `redeem_open_minutes_before` INT UNSIGNED NOT NULL DEFAULT 120,
  `redeem_close_minutes_after` INT UNSIGNED NOT NULL DEFAULT 1440,
  `attendance_invite_expires_minutes` INT UNSIGNED NOT NULL DEFAULT 1440,
  `auto_no_show` TINYINT(1) NOT NULL DEFAULT 0,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_settings_scope_key` (`scope_key`),
  KEY `idx_course_settings_owner` (`owner_user_id`),
  CONSTRAINT `fk_course_settings_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `course_settings` (
  `scope_key`, `scope`, `owner_user_id`, `timezone`,
  `booking_open_minutes_before`, `booking_close_minutes_before`,
  `cancel_close_minutes_before`, `redeem_open_minutes_before`,
  `redeem_close_minutes_after`, `attendance_invite_expires_minutes`,
  `auto_no_show`
)
VALUES (
  'platform', 'platform', NULL, 'Asia/Taipei',
  43200, 0, 0, 120, 1440, 1440, 0
);

INSERT IGNORE INTO `course_settings` (
  `scope_key`, `scope`, `owner_user_id`, `timezone`,
  `booking_open_minutes_before`, `booking_close_minutes_before`,
  `cancel_close_minutes_before`, `redeem_open_minutes_before`,
  `redeem_close_minutes_after`, `attendance_invite_expires_minutes`,
  `auto_no_show`
)
SELECT
  CONCAT('provider:', owners.`owner_user_id`),
  'provider',
  owners.`owner_user_id`,
  platform.`timezone`,
  platform.`booking_open_minutes_before`,
  platform.`booking_close_minutes_before`,
  platform.`cancel_close_minutes_before`,
  platform.`redeem_open_minutes_before`,
  platform.`redeem_close_minutes_after`,
  platform.`attendance_invite_expires_minutes`,
  platform.`auto_no_show`
FROM (
  SELECT `owner_user_id` FROM `course_products` WHERE `owner_user_id` IS NOT NULL
  UNION
  SELECT `owner_user_id` FROM `course_sessions` WHERE `owner_user_id` IS NOT NULL
) owners
JOIN `course_settings` platform ON platform.`scope_key` = 'platform';

CREATE TABLE IF NOT EXISTS `course_staff_memberships` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `role` VARCHAR(24) NOT NULL,
  `capabilities_json` JSON DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_staff_membership` (`owner_user_id`, `user_id`),
  KEY `idx_course_staff_user_status` (`user_id`, `status`, `id`),
  CONSTRAINT `fk_course_staff_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_course_staff_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_coach_profiles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `user_id` CHAR(36) DEFAULT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `phone` VARCHAR(32) DEFAULT NULL,
  `bio` TEXT DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_coach_owner_code` (`owner_user_id`, `code`),
  UNIQUE KEY `uq_course_coach_owner_user` (`owner_user_id`, `user_id`),
  KEY `idx_course_coach_owner_status` (`owner_user_id`, `status`, `id`),
  CONSTRAINT `fk_course_coach_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_course_coach_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL `course_049_add_column`('course_coach_profiles', 'code', 'VARCHAR(64) NULL AFTER `owner_user_id`');
UPDATE `course_coach_profiles`
   SET `code` = CONCAT('LEGACY-', `id`)
 WHERE `id` >= 1
   AND (`code` IS NULL OR TRIM(`code`) = '');
SET @course_049_coach_code_nullable := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'course_coach_profiles'
     AND COLUMN_NAME = 'code'
     AND IS_NULLABLE = 'YES'
);
SET @course_049_coach_code_sql := IF(
  @course_049_coach_code_nullable > 0,
  'ALTER TABLE `course_coach_profiles` MODIFY COLUMN `code` VARCHAR(64) NOT NULL',
  'SELECT 1'
);
PREPARE course_049_coach_code_stmt FROM @course_049_coach_code_sql;
EXECUTE course_049_coach_code_stmt;
DEALLOCATE PREPARE course_049_coach_code_stmt;

-- MySQL forbids CASCADE/SET NULL actions when the FK column is an input to a
-- STORED generated column. The booking/invite identity links below therefore
-- preserve history with RESTRICT and are released through explicit state updates.
CREATE TABLE IF NOT EXISTS `course_ticket_holds` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ticket_id` BIGINT UNSIGNED NOT NULL,
  `booking_id` BIGINT UNSIGNED DEFAULT NULL,
  `invite_id` BIGINT UNSIGNED DEFAULT NULL,
  `quantity` INT UNSIGNED NOT NULL DEFAULT 1,
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `expires_at` DATETIME DEFAULT NULL,
  `released_at` DATETIME DEFAULT NULL,
  `release_reason` VARCHAR(64) DEFAULT NULL,
  `released_by_user_id` CHAR(36) DEFAULT NULL,
  `consumed_at` DATETIME DEFAULT NULL,
  `consumed_usage_event_id` BIGINT UNSIGNED DEFAULT NULL,
  `active_booking_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` = 'active' THEN `booking_id` ELSE NULL END
  ) STORED,
  `active_invite_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` = 'active' THEN `invite_id` ELSE NULL END
  ) STORED,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_ticket_holds_active_booking` (`active_booking_id`),
  UNIQUE KEY `uq_course_ticket_holds_active_invite` (`active_invite_id`),
  KEY `idx_course_ticket_holds_ticket_status` (`ticket_id`, `status`, `expires_at`),
  CONSTRAINT `fk_course_ticket_holds_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `course_tickets` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_ticket_holds_booking` FOREIGN KEY (`booking_id`) REFERENCES `course_bookings` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_ticket_holds_released_by` FOREIGN KEY (`released_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_attendance_invites` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) DEFAULT NULL,
  `session_id` BIGINT UNSIGNED NOT NULL,
  `booking_id` BIGINT UNSIGNED DEFAULT NULL,
  `student_id` BIGINT UNSIGNED DEFAULT NULL,
  `user_id` CHAR(36) DEFAULT NULL,
  `ticket_id` BIGINT UNSIGNED DEFAULT NULL,
  `hold_id` BIGINT UNSIGNED DEFAULT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `expires_at` DATETIME NOT NULL,
  `auto_redeem_at` DATETIME DEFAULT NULL,
  `confirmed_at` DATETIME DEFAULT NULL,
  `redeemed_usage_event_id` BIGINT UNSIGNED DEFAULT NULL,
  `note` VARCHAR(500) DEFAULT NULL,
  `active_user_id` CHAR(36) GENERATED ALWAYS AS (
    CASE WHEN `status` = 'pending' THEN `user_id` ELSE NULL END
  ) STORED,
  `active_student_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` = 'pending' THEN `student_id` ELSE NULL END
  ) STORED,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_attendance_invite_token` (`token_hash`),
  UNIQUE KEY `uq_course_attendance_invite_active_user` (`session_id`, `active_user_id`),
  UNIQUE KEY `uq_course_attendance_invite_active_student` (`session_id`, `active_student_id`),
  KEY `idx_course_attendance_invites_status_due` (`status`, `auto_redeem_at`, `expires_at`),
  KEY `idx_course_attendance_invites_booking` (`booking_id`),
  KEY `idx_course_attendance_invites_student` (`student_id`, `created_at`),
  CONSTRAINT `fk_course_attendance_invites_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_attendance_invites_session` FOREIGN KEY (`session_id`) REFERENCES `course_sessions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_attendance_invites_booking` FOREIGN KEY (`booking_id`) REFERENCES `course_bookings` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_course_attendance_invites_student` FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_attendance_invites_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_attendance_invites_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `course_tickets` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_attendance_invites_hold` FOREIGN KEY (`hold_id`) REFERENCES `course_ticket_holds` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_usage_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ticket_id` BIGINT UNSIGNED DEFAULT NULL,
  `student_id` BIGINT UNSIGNED DEFAULT NULL,
  `user_id` CHAR(36) DEFAULT NULL,
  `session_id` BIGINT UNSIGNED DEFAULT NULL,
  `booking_id` BIGINT UNSIGNED DEFAULT NULL,
  `invite_id` BIGINT UNSIGNED DEFAULT NULL,
  `event_type` VARCHAR(48) NOT NULL,
  `delta_uses` INT NOT NULL,
  `balance_after` INT DEFAULT NULL,
  `source_type` VARCHAR(48) NOT NULL,
  `source_id` VARCHAR(128) DEFAULT NULL,
  `reverses_event_id` BIGINT UNSIGNED DEFAULT NULL,
  `command_id` BIGINT UNSIGNED DEFAULT NULL,
  `idempotency_key` VARCHAR(128) DEFAULT NULL,
  `is_anomaly` TINYINT(1) NOT NULL DEFAULT 0,
  `occurred_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actor_user_id` CHAR(36) DEFAULT NULL,
  `note` VARCHAR(500) DEFAULT NULL,
  `metadata_json` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_usage_source` (`source_type`, `source_id`, `event_type`),
  UNIQUE KEY `uq_course_usage_reversal` (`reverses_event_id`),
  KEY `idx_course_usage_command` (`command_id`),
  KEY `idx_course_usage_idempotency` (`idempotency_key`),
  KEY `idx_course_usage_ticket_time` (`ticket_id`, `occurred_at`, `id`),
  KEY `idx_course_usage_booking` (`booking_id`, `id`),
  KEY `idx_course_usage_session_type` (`session_id`, `event_type`, `occurred_at`),
  KEY `idx_course_usage_anomaly` (`is_anomaly`, `occurred_at`, `id`),
  CONSTRAINT `fk_course_usage_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `course_tickets` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_usage_student` FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_usage_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_usage_session` FOREIGN KEY (`session_id`) REFERENCES `course_sessions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_usage_booking` FOREIGN KEY (`booking_id`) REFERENCES `course_bookings` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_usage_invite` FOREIGN KEY (`invite_id`) REFERENCES `course_attendance_invites` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_usage_reversal` FOREIGN KEY (`reverses_event_id`) REFERENCES `course_usage_events` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_usage_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A repair rerun may already have the immutable triggers from a prior complete
-- run. Drop them before the one permitted migration-time balance_after repair.
DROP TRIGGER IF EXISTS `course_usage_events_no_update`;
DROP TRIGGER IF EXISTS `course_usage_events_no_delete`;

-- Repair-safe additions for an interrupted earlier execution of this migration.
CALL `course_049_add_column`('course_ticket_holds', 'released_by_user_id', 'CHAR(36) NULL AFTER `release_reason`');
CALL `course_049_add_column`('course_ticket_holds', 'consumed_usage_event_id', 'BIGINT UNSIGNED NULL AFTER `consumed_at`');
CALL `course_049_add_column`(
  'course_ticket_holds',
  'active_booking_id',
  'BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN `status` = ''active'' THEN `booking_id` ELSE NULL END) STORED'
);
CALL `course_049_add_column`(
  'course_ticket_holds',
  'active_invite_id',
  'BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN `status` = ''active'' THEN `invite_id` ELSE NULL END) STORED'
);
CALL `course_049_add_column`('course_attendance_invites', 'booking_id', 'BIGINT UNSIGNED NULL AFTER `session_id`');
CALL `course_049_add_column`(
  'course_attendance_invites',
  'active_user_id',
  'CHAR(36) GENERATED ALWAYS AS (CASE WHEN `status` = ''pending'' THEN `user_id` ELSE NULL END) STORED'
);
CALL `course_049_add_column`(
  'course_attendance_invites',
  'active_student_id',
  'BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN `status` = ''pending'' THEN `student_id` ELSE NULL END) STORED'
);

SET @course_049_usage_source_is_varchar := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'course_usage_events'
     AND COLUMN_NAME = 'source_id'
     AND DATA_TYPE = 'varchar'
);
SET @course_049_usage_source_sql := IF(
  @course_049_usage_source_is_varchar = 0,
  'ALTER TABLE `course_usage_events` MODIFY COLUMN `source_id` VARCHAR(128) NULL',
  'SELECT 1'
);
PREPARE course_049_usage_source_stmt FROM @course_049_usage_source_sql;
EXECUTE course_049_usage_source_stmt;
DEALLOCATE PREPARE course_049_usage_source_stmt;

CREATE TABLE IF NOT EXISTS `course_ticket_state_periods` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ticket_id` BIGINT UNSIGNED NOT NULL,
  `state` VARCHAR(24) NOT NULL,
  `started_at` DATETIME NOT NULL,
  `ended_at` DATETIME DEFAULT NULL,
  `extension_days` INT UNSIGNED NOT NULL DEFAULT 0,
  `reason` VARCHAR(500) DEFAULT NULL,
  `actor_user_id` CHAR(36) DEFAULT NULL,
  `metadata_json` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_course_ticket_state_periods_active` (`ticket_id`, `state`, `ended_at`),
  CONSTRAINT `fk_course_ticket_state_periods_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `course_tickets` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_ticket_state_periods_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_mutation_commands` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `actor_user_id` CHAR(36) NOT NULL,
  `operation` VARCHAR(64) NOT NULL,
  `idempotency_key` VARCHAR(128) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `resource_type` VARCHAR(64) DEFAULT NULL,
  `resource_id` BIGINT UNSIGNED DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'processing',
  `response_json` JSON DEFAULT NULL,
  `expires_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_mutation_actor_operation_key` (`actor_user_id`, `operation`, `idempotency_key`),
  KEY `idx_course_mutation_status_updated` (`status`, `updated_at`, `id`),
  CONSTRAINT `fk_course_mutation_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL `course_049_add_column`(
  'course_usage_events',
  'command_id',
  'BIGINT UNSIGNED NULL AFTER `reverses_event_id`'
);

-- Deterministic legacy student linkage. Imported GAS students without a Leader
-- account use the same table with user_id NULL until verified-email claim.
INSERT IGNORE INTO `course_students` (
  `owner_user_id`, `tenant_key`, `user_id`, `email`, `email_normalized`,
  `display_name`, `status`, `source_system`, `source_id`, `claimed_at`
)
SELECT DISTINCT
  p.`owner_user_id`,
  COALESCE(p.`owner_user_id`, '00000000-0000-0000-0000-000000000000'),
  t.`user_id`,
  MIN(t.`owner_email`),
  LOWER(TRIM(t.`owner_email`)),
  MIN(COALESCE(NULLIF(TRIM(t.`owner_name`), ''), u.`username`, t.`owner_email`)),
  'active',
  'leader',
  CONCAT('user:', t.`user_id`, ':tenant:', COALESCE(p.`owner_user_id`, 'platform')),
  MIN(t.`issued_at`)
FROM `course_tickets` t
JOIN `course_products` p ON p.`id` = t.`product_id`
LEFT JOIN `users` u ON u.`id` = t.`user_id`
GROUP BY
  p.`owner_user_id`,
  COALESCE(p.`owner_user_id`, '00000000-0000-0000-0000-000000000000'),
  t.`user_id`,
  LOWER(TRIM(t.`owner_email`));

-- Complete ticket snapshot/link backfill before writing immutable ledger rows.
UPDATE `course_tickets` t
JOIN `course_products` p ON p.`id` = t.`product_id`
LEFT JOIN `course_ticket_products` tp ON tp.`id` = p.`ticket_product_id`
LEFT JOIN `users` provider ON provider.`id` = p.`owner_user_id`
LEFT JOIN `course_students` st
  ON st.`tenant_key` = COALESCE(p.`owner_user_id`, '00000000-0000-0000-0000-000000000000')
 AND st.`user_id` = t.`user_id`
LEFT JOIN `course_order_items` oi
  ON oi.`order_id` = t.`order_id`
 AND oi.`item_type` = 'primary'
 AND oi.`shop_product_id` = t.`product_id`
   SET t.`student_id` = COALESCE(t.`student_id`, st.`id`),
       t.`ticket_product_id` = COALESCE(t.`ticket_product_id`, p.`ticket_product_id`),
       t.`order_item_id` = COALESCE(t.`order_item_id`, oi.`id`),
       t.`product_code_snapshot` = COALESCE(t.`product_code_snapshot`, p.`code`),
       t.`product_name_snapshot` = COALESCE(t.`product_name_snapshot`, p.`name`),
       t.`product_class_count_snapshot` = COALESCE(t.`product_class_count_snapshot`, t.`total_uses`, p.`class_count`),
       t.`product_valid_days_snapshot` = COALESCE(t.`product_valid_days_snapshot`, p.`valid_days`),
       t.`product_activation_days_snapshot` = COALESCE(t.`product_activation_days_snapshot`, p.`activation_days`),
       t.`product_transferable_snapshot` = COALESCE(t.`product_transferable_snapshot`, t.`transferable`, p.`transferable`),
       t.`product_max_transfers_snapshot` = COALESCE(t.`product_max_transfers_snapshot`, 1),
       t.`product_redemption_policy_snapshot` = COALESCE(
         t.`product_redemption_policy_snapshot`,
         tp.`redemption_policy_json`
       ),
       t.`provider_user_id_snapshot` = COALESCE(t.`provider_user_id_snapshot`, p.`owner_user_id`),
       t.`provider_name_snapshot` = COALESCE(
         t.`provider_name_snapshot`,
         provider.`username`,
         CASE WHEN p.`owner_user_id` IS NULL THEN 'LEADER' ELSE NULL END
       ),
       t.`remaining_uses_cache` = t.`remaining_uses`
 WHERE t.`id` >= 1;

UPDATE `course_bookings` b
LEFT JOIN `course_tickets` t ON t.`id` = b.`ticket_id`
   SET b.`student_id` = COALESCE(b.`student_id`, t.`student_id`)
 WHERE b.`id` >= 1
   AND b.`student_id` IS NULL
   AND NOT EXISTS (
     SELECT 1
       FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'course_bookings'
        AND INDEX_NAME = 'uq_course_bookings_session_student'
   );

UPDATE `course_orders` o
JOIN `course_products` p ON p.`id` = o.`product_id`
LEFT JOIN `course_students` st
  ON st.`tenant_key` = COALESCE(p.`owner_user_id`, '00000000-0000-0000-0000-000000000000')
 AND st.`user_id` = o.`user_id`
   SET o.`student_id` = COALESCE(o.`student_id`, st.`id`)
 WHERE o.`id` >= 1
   AND o.`student_id` IS NULL;

-- Positive issuance, negative legacy SUCCESS, and zero-use NO_SHOW audit.
INSERT IGNORE INTO `course_usage_events` (
  `ticket_id`, `student_id`, `user_id`, `event_type`, `delta_uses`,
  `balance_after`, `source_type`, `source_id`, `occurred_at`, `note`,
  `metadata_json`
)
SELECT
  t.`id`, t.`student_id`, t.`user_id`, 'ISSUANCE', t.`total_uses`,
  t.`total_uses`, 'legacy_ticket', t.`id`, t.`issued_at`,
  'Migration 049 legacy ticket issuance backfill.',
  JSON_OBJECT('legacyProductId', t.`product_id`)
FROM `course_tickets` t;

INSERT IGNORE INTO `course_usage_events` (
  `ticket_id`, `student_id`, `user_id`, `session_id`, `booking_id`,
  `event_type`, `delta_uses`, `source_type`, `source_id`, `occurred_at`,
  `actor_user_id`, `note`, `metadata_json`
)
SELECT
  l.`ticket_id`, t.`student_id`, l.`user_id`, l.`session_id`, l.`booking_id`,
  'SUCCESS', -CAST(l.`quantity` AS SIGNED), 'legacy_attendance_log', l.`id`,
  l.`created_at`, l.`staff_user_id`,
  'Migration 049 legacy attended/redeem backfill.',
  JSON_OBJECT('legacyAction', l.`action`)
FROM `course_attendance_logs` l
JOIN `course_tickets` t ON t.`id` = l.`ticket_id`
WHERE l.`action` = 'redeem';

INSERT IGNORE INTO `course_usage_events` (
  `ticket_id`, `student_id`, `user_id`, `session_id`, `booking_id`,
  `event_type`, `delta_uses`, `source_type`, `source_id`, `occurred_at`,
  `is_anomaly`, `note`, `metadata_json`
)
SELECT
  b.`ticket_id`, t.`student_id`, b.`user_id`, b.`session_id`, b.`id`,
  'NO_SHOW', 0, 'legacy_booking_no_show', b.`id`, COALESCE(b.`updated_at`, b.`created_at`),
  1,
  'Legacy NO_SHOW changed RSVP only; retained as zero-use anomaly pending manual review.',
  JSON_OBJECT('requiresReview', TRUE, 'legacyStatus', b.`status`)
FROM `course_bookings` b
JOIN `course_tickets` t ON t.`id` = b.`ticket_id`
WHERE b.`status` = 'no_show';

-- If historical direct edits or incomplete logs made the ledger differ from the
-- stored remaining count, preserve the visible balance with an explicit event.
INSERT IGNORE INTO `course_usage_events` (
  `ticket_id`, `student_id`, `user_id`, `event_type`, `delta_uses`,
  `balance_after`, `source_type`, `source_id`, `occurred_at`,
  `is_anomaly`, `note`, `metadata_json`
)
SELECT
  t.`id`, t.`student_id`, t.`user_id`, 'LEGACY_BALANCE_RECONCILIATION',
  CAST(t.`remaining_uses` AS SIGNED) -
    (CAST(t.`total_uses` AS SIGNED) - COALESCE(a.`redeemed_uses`, 0)),
  t.`remaining_uses`, 'legacy_balance', t.`id`, t.`updated_at`,
  1,
  'Explicit reconciliation preserves legacy remaining_uses; review before cutover.',
  JSON_OBJECT(
    'legacyRemainingUses', t.`remaining_uses`,
    'legacyTotalUses', t.`total_uses`,
    'loggedRedeemedUses', COALESCE(a.`redeemed_uses`, 0)
  )
FROM `course_tickets` t
LEFT JOIN (
  SELECT `ticket_id`, SUM(`quantity`) AS `redeemed_uses`
    FROM `course_attendance_logs`
   WHERE `action` = 'redeem'
   GROUP BY `ticket_id`
) a ON a.`ticket_id` = t.`id`
WHERE CAST(t.`remaining_uses` AS SIGNED) <>
      (CAST(t.`total_uses` AS SIGNED) - COALESCE(a.`redeemed_uses`, 0));

-- Every ticket event carries its historical running balance. Runtime code maps
-- this value directly, so NULL would silently render as a false zero balance.
UPDATE `course_usage_events` event_row
JOIN (
  SELECT
    `id`,
    SUM(`delta_uses`) OVER (
      PARTITION BY `ticket_id`
      ORDER BY `occurred_at`, `id`
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS `running_balance`
  FROM `course_usage_events`
  WHERE `ticket_id` IS NOT NULL
) running ON running.`id` = event_row.`id`
   SET event_row.`balance_after` = running.`running_balance`
 WHERE event_row.`id` >= 1;

UPDATE `course_tickets` t
LEFT JOIN (
  SELECT `ticket_id`, SUM(`delta_uses`) AS `ledger_balance`
    FROM `course_usage_events`
   WHERE `ticket_id` IS NOT NULL
   GROUP BY `ticket_id`
) e ON e.`ticket_id` = t.`id`
   SET t.`remaining_uses_cache` = COALESCE(e.`ledger_balance`, 0)
 WHERE t.`id` >= 1;

-- Existing active bookings become one-use holds only while the legacy remaining
-- balance can cover them. Deterministic overflow bookings remain booked but are
-- emitted as zero-use anomalies for blocking reconciliation; availableUses
-- never becomes negative merely because the migration ran.
INSERT IGNORE INTO `course_ticket_holds` (
  `ticket_id`, `booking_id`, `quantity`, `status`, `created_at`, `updated_at`
)
SELECT b.`ticket_id`, b.`id`, 1, 'active', b.`booked_at`, b.`updated_at`
 FROM `course_bookings` b
  JOIN `course_tickets` t ON t.`id` = b.`ticket_id`
 WHERE b.`status` = 'booked'
   AND b.`ticket_id` IS NOT NULL
   AND (
     SELECT COUNT(*)
       FROM `course_bookings` earlier
      WHERE earlier.`ticket_id` = b.`ticket_id`
        AND earlier.`status` = 'booked'
        AND (
          earlier.`booked_at` < b.`booked_at`
          OR (earlier.`booked_at` = b.`booked_at` AND earlier.`id` <= b.`id`)
        )
   ) <= t.`remaining_uses`;

INSERT IGNORE INTO `course_usage_events` (
  `ticket_id`, `student_id`, `user_id`, `session_id`, `booking_id`,
  `event_type`, `delta_uses`, `source_type`, `source_id`, `occurred_at`,
  `is_anomaly`, `note`, `metadata_json`
)
SELECT
  b.`ticket_id`, t.`student_id`, b.`user_id`, b.`session_id`, b.`id`,
  'LEGACY_UNHELD_BOOKING', 0, 'legacy_unheld_booking', b.`id`, b.`booked_at`,
  1,
  'Booked reservation exceeded the legacy available balance and was not given a hold.',
  JSON_OBJECT('requiresReview', TRUE, 'legacyRemainingUses', t.`remaining_uses`)
FROM `course_bookings` b
JOIN `course_tickets` t ON t.`id` = b.`ticket_id`
LEFT JOIN `course_ticket_holds` h
  ON h.`booking_id` = b.`id`
 AND h.`status` = 'active'
WHERE b.`status` = 'booked'
  AND h.`id` IS NULL;

INSERT INTO `course_ticket_state_periods` (
  `ticket_id`, `state`, `started_at`, `reason`, `metadata_json`
)
SELECT
  t.`id`, 'paused', t.`paused_at`, t.`pause_reason`,
  JSON_OBJECT('source', 'legacy_ticket')
FROM `course_tickets` t
WHERE t.`paused_at` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
      FROM `course_ticket_state_periods` existing
     WHERE existing.`ticket_id` = t.`id`
       AND existing.`state` = 'paused'
       AND existing.`started_at` = t.`paused_at`
       AND JSON_UNQUOTE(JSON_EXTRACT(existing.`metadata_json`, '$.source')) = 'legacy_ticket'
  );

-- Import/cutover audit model. No imported row mutates live course data until a
-- reconciled run is explicitly applied by the cutover command.
CREATE TABLE IF NOT EXISTS `course_import_runs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_key` CHAR(36) NOT NULL,
  `source_system` VARCHAR(32) NOT NULL DEFAULT 'gas',
  `mode` VARCHAR(24) NOT NULL DEFAULT 'rehearsal',
  `status` VARCHAR(24) NOT NULL DEFAULT 'validating',
  `source_contract_version` VARCHAR(80) NOT NULL,
  `snapshot_hash` CHAR(64) NOT NULL,
  `started_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finished_at` DATETIME DEFAULT NULL,
  `created_by_user_id` CHAR(36) DEFAULT NULL,
  `summary_json` JSON DEFAULT NULL,
  `error_json` JSON DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_import_runs_key` (`run_key`),
  UNIQUE KEY `uq_course_import_runs_snapshot_mode` (`snapshot_hash`, `mode`),
  KEY `idx_course_import_runs_status_started` (`status`, `started_at`, `id`),
  CONSTRAINT `fk_course_import_runs_creator` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_import_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id` BIGINT UNSIGNED NOT NULL,
  `dataset_name` VARCHAR(64) NOT NULL,
  `row_count` INT UNSIGNED NOT NULL,
  `content_hash` CHAR(64) NOT NULL,
  `source_metadata_json` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_import_snapshot_dataset` (`run_id`, `dataset_name`),
  KEY `idx_course_import_snapshots_hash` (`content_hash`),
  CONSTRAINT `fk_course_import_snapshots_run` FOREIGN KEY (`run_id`) REFERENCES `course_import_runs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_import_staging_rows` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id` BIGINT UNSIGNED NOT NULL,
  `dataset_name` VARCHAR(64) NOT NULL,
  `source_id` VARCHAR(128) NOT NULL,
  `source_code` VARCHAR(128) DEFAULT NULL,
  `row_hash` CHAR(64) NOT NULL,
  `payload_json` JSON NOT NULL,
  `validation_status` VARCHAR(24) NOT NULL DEFAULT 'valid',
  `validation_errors_json` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_import_staging_source` (`run_id`, `dataset_name`, `source_id`),
  KEY `idx_course_import_staging_code` (`dataset_name`, `source_code`),
  KEY `idx_course_import_staging_validation` (`run_id`, `validation_status`, `id`),
  CONSTRAINT `fk_course_import_staging_run` FOREIGN KEY (`run_id`) REFERENCES `course_import_runs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_import_source_mappings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `source_system` VARCHAR(32) NOT NULL DEFAULT 'gas',
  `entity_type` VARCHAR(64) NOT NULL,
  `source_id` VARCHAR(128) NOT NULL,
  `target_table` VARCHAR(64) NOT NULL,
  `target_id` BIGINT UNSIGNED NOT NULL,
  `source_hash` CHAR(64) NOT NULL,
  `first_run_id` BIGINT UNSIGNED NOT NULL,
  `last_run_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_import_source_mapping` (`source_system`, `entity_type`, `source_id`),
  KEY `idx_course_import_mapping_target` (`target_table`, `target_id`),
  CONSTRAINT `fk_course_import_mapping_first_run` FOREIGN KEY (`first_run_id`) REFERENCES `course_import_runs` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_import_mapping_last_run` FOREIGN KEY (`last_run_id`) REFERENCES `course_import_runs` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_import_conflicts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id` BIGINT UNSIGNED NOT NULL,
  `dataset_name` VARCHAR(64) NOT NULL,
  `source_id` VARCHAR(128) DEFAULT NULL,
  `conflict_type` VARCHAR(64) NOT NULL,
  `severity` VARCHAR(24) NOT NULL DEFAULT 'blocking',
  `source_value_json` JSON DEFAULT NULL,
  `target_value_json` JSON DEFAULT NULL,
  `message` VARCHAR(1000) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'open',
  `resolution_json` JSON DEFAULT NULL,
  `resolved_by_user_id` CHAR(36) DEFAULT NULL,
  `resolved_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_import_conflict` (`run_id`, `dataset_name`, `source_id`, `conflict_type`),
  KEY `idx_course_import_conflicts_open` (`run_id`, `severity`, `status`, `id`),
  CONSTRAINT `fk_course_import_conflicts_run` FOREIGN KEY (`run_id`) REFERENCES `course_import_runs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_course_import_conflicts_resolver` FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_import_reconciliation_results` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id` BIGINT UNSIGNED NOT NULL,
  `metric_key` VARCHAR(128) NOT NULL,
  `source_value` DECIMAL(20,4) DEFAULT NULL,
  `target_value` DECIMAL(20,4) DEFAULT NULL,
  `difference_value` DECIMAL(20,4) DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL,
  `details_json` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_import_reconciliation_metric` (`run_id`, `metric_key`),
  KEY `idx_course_import_reconciliation_status` (`run_id`, `status`, `id`),
  CONSTRAINT `fk_course_import_reconciliation_run` FOREIGN KEY (`run_id`) REFERENCES `course_import_runs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_v2_cutover_state` (
  `id` TINYINT UNSIGNED NOT NULL,
  `schema_version` VARCHAR(80) NOT NULL,
  `state` VARCHAR(24) NOT NULL DEFAULT 'legacy',
  `maintenance_mode` TINYINT(1) NOT NULL DEFAULT 0,
  `active_import_run_id` BIGINT UNSIGNED DEFAULT NULL,
  `enabled_at` DATETIME DEFAULT NULL,
  `enabled_by_user_id` CHAR(36) DEFAULT NULL,
  `legacy_write_frozen_at` DATETIME DEFAULT NULL,
  `smoke_evidence_hash` CHAR(64) DEFAULT NULL,
  `smoke_checked_at` DATETIME DEFAULT NULL,
  `maintenance_released_at` DATETIME DEFAULT NULL,
  `notes` VARCHAR(1000) DEFAULT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_course_v2_cutover_run` FOREIGN KEY (`active_import_run_id`) REFERENCES `course_import_runs` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_v2_cutover_user` FOREIGN KEY (`enabled_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL `course_049_add_column`('course_v2_cutover_state', 'smoke_evidence_hash', 'CHAR(64) NULL AFTER `legacy_write_frozen_at`');
CALL `course_049_add_column`('course_v2_cutover_state', 'smoke_checked_at', 'DATETIME NULL AFTER `smoke_evidence_hash`');
CALL `course_049_add_column`('course_v2_cutover_state', 'maintenance_released_at', 'DATETIME NULL AFTER `smoke_checked_at`');

INSERT IGNORE INTO `course_v2_cutover_state` (
  `id`, `schema_version`, `state`, `maintenance_mode`, `notes`
)
VALUES (
  1, '049_course_count_card_normalization', 'active', 0,
  'Fresh install starts on the normalized course runtime; imported installations must reconcile before activation.'
);

-- Add/drop indexes and foreign keys on altered or repair-safe tables.
DROP PROCEDURE IF EXISTS `course_049_drop_index`;
DELIMITER $$
CREATE PROCEDURE `course_049_drop_index`(
  IN p_table_name VARCHAR(64),
  IN p_index_name VARCHAR(64)
)
BEGIN
  IF EXISTS (
    SELECT 1
      FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND INDEX_NAME = p_index_name
  ) THEN
    SET @course_049_drop_index_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` DROP INDEX `', REPLACE(p_index_name, '`', '``'), '`'
    );
    PREPARE course_049_drop_index_stmt FROM @course_049_drop_index_sql;
    EXECUTE course_049_drop_index_stmt;
    DEALLOCATE PREPARE course_049_drop_index_stmt;
  END IF;
END$$
DELIMITER ;

-- These unconditional unique keys appeared in an interrupted draft of 049.
-- Only active generated keys may be unique so a compensating hold can be
-- inserted for the same booking after an undo.
CALL `course_049_drop_index`('course_ticket_holds', 'uq_course_ticket_holds_booking');
CALL `course_049_drop_index`('course_ticket_holds', 'uq_course_ticket_holds_invite');
CALL `course_049_drop_index`('course_usage_events', 'uq_course_usage_idempotency');
CALL `course_049_drop_index`('course_usage_events', 'uq_course_usage_actor_idempotency');
CALL `course_049_drop_index`('course_attendance_invites', 'uq_course_attendance_invite_session_user');
CALL `course_049_drop_index`('course_order_items', 'uq_course_order_items_legacy_primary');
CALL `course_049_drop_index`('course_coach_profiles', 'uq_course_coach_code');

DROP PROCEDURE IF EXISTS `course_049_add_index`;
DELIMITER $$
CREATE PROCEDURE `course_049_add_index`(
  IN p_table_name VARCHAR(64),
  IN p_index_name VARCHAR(64),
  IN p_index_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND INDEX_NAME = p_index_name
  ) THEN
    SET @course_049_index_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD ', p_index_definition
    );
    PREPARE course_049_index_stmt FROM @course_049_index_sql;
    EXECUTE course_049_index_stmt;
    DEALLOCATE PREPARE course_049_index_stmt;
  END IF;
END$$
DELIMITER ;

-- Legacy databases can contain more than one booking for the same
-- (session_id, student_id), especially after manual account merges. Preserve
-- every booking and its ticket/hold history, but quarantine the ambiguous
-- Student links before adding the normalized unique key. The deterministic
-- migration run keeps a blocking conflict visible to every cutover rehearsal;
-- an operator must explicitly relink one booking and resolve the conflict.
INSERT INTO `course_import_runs` (
  `run_key`, `source_system`, `mode`, `status`, `source_contract_version`,
  `snapshot_hash`, `finished_at`, `summary_json`
)
SELECT
  '00000000-0000-0000-0049-000000000001',
  'leader_legacy',
  'migration',
  'conflict',
  '049_course_count_card_normalization',
  SHA2('course_bookings:duplicate_session_student', 256),
  NOW(),
  JSON_OBJECT('reason', 'legacy_duplicate_session_student_booking')
FROM DUAL
WHERE EXISTS (
  SELECT 1
    FROM `course_bookings`
   WHERE `student_id` IS NOT NULL
   GROUP BY `session_id`, `student_id`
  HAVING COUNT(*) > 1
)
ON DUPLICATE KEY UPDATE
  `status` = 'conflict',
  `finished_at` = NOW(),
  `summary_json` = JSON_OBJECT('reason', 'legacy_duplicate_session_student_booking');

INSERT INTO `course_import_conflicts` (
  `run_id`, `dataset_name`, `source_id`, `conflict_type`, `severity`,
  `source_value_json`, `target_value_json`, `message`, `status`
)
SELECT
  migration_run.`id`,
  'bookings',
  CONCAT('legacy-booking:', b.`id`),
  'DUPLICATE_SESSION_STUDENT',
  'blocking',
  JSON_OBJECT(
    'bookingId', b.`id`,
    'sessionId', b.`session_id`,
    'studentId', b.`student_id`,
    'ticketId', b.`ticket_id`,
    'userId', b.`user_id`,
    'status', b.`status`,
    'bookingCount', duplicate_booking.`booking_count`,
    'conflictKey', CONCAT(
      'session:', b.`session_id`, ':student:', b.`student_id`
    )
  ),
  NULL,
  CONCAT(
    'Legacy booking ', b.`id`, ' shares session ', b.`session_id`,
    ' and student ', b.`student_id`,
    ' with another booking; its student link was quarantined for manual resolution.'
  ),
  'open'
FROM `course_bookings` b
JOIN (
  SELECT
    `session_id`,
    `student_id`,
    COUNT(*) AS `booking_count`
  FROM `course_bookings`
  WHERE `student_id` IS NOT NULL
  GROUP BY `session_id`, `student_id`
  HAVING COUNT(*) > 1
) duplicate_booking
  ON duplicate_booking.`session_id` = b.`session_id`
 AND duplicate_booking.`student_id` = b.`student_id`
JOIN `course_import_runs` migration_run
  ON migration_run.`run_key` = '00000000-0000-0000-0049-000000000001'
ON DUPLICATE KEY UPDATE
  `source_value_json` = VALUES(`source_value_json`),
  `target_value_json` = VALUES(`target_value_json`),
  `message` = VALUES(`message`),
  `status` = 'open',
  `resolution_json` = NULL,
  `resolved_by_user_id` = NULL,
  `resolved_at` = NULL;

UPDATE `course_bookings` b
JOIN (
  SELECT `session_id`, `student_id`
    FROM `course_bookings`
   WHERE `student_id` IS NOT NULL
   GROUP BY `session_id`, `student_id`
  HAVING COUNT(*) > 1
) duplicate_booking
  ON duplicate_booking.`session_id` = b.`session_id`
 AND duplicate_booking.`student_id` = b.`student_id`
   SET b.`student_identity_conflict_key` = CONCAT(
         'session:', b.`session_id`, ':student:', b.`student_id`
       ),
       b.`student_id` = NULL,
       b.`row_version` = b.`row_version` + 1
 WHERE b.`id` >= 1;

CALL `course_049_add_index`('course_products', 'idx_course_products_ticket_product', 'KEY `idx_course_products_ticket_product` (`ticket_product_id`)');
CALL `course_049_add_index`('course_order_items', 'uq_course_order_items_line_identity', 'UNIQUE KEY `uq_course_order_items_line_identity` (`order_id`, `line_identity_key`)');
CALL `course_049_add_index`('course_sessions', 'idx_course_sessions_scenario', 'KEY `idx_course_sessions_scenario` (`scenario_id`)');
CALL `course_049_add_index`('course_sessions', 'idx_course_sessions_coach_profile', 'KEY `idx_course_sessions_coach_profile` (`coach_profile_id`)');
CALL `course_049_add_index`('course_tickets', 'idx_course_tickets_ticket_product', 'KEY `idx_course_tickets_ticket_product` (`ticket_product_id`)');
CALL `course_049_add_index`('course_tickets', 'idx_course_tickets_student', 'KEY `idx_course_tickets_student` (`student_id`, `status`, `id`)');
CALL `course_049_add_index`('course_tickets', 'idx_course_tickets_order_item', 'KEY `idx_course_tickets_order_item` (`order_item_id`)');
CALL `course_049_add_index`('course_orders', 'idx_course_orders_student', 'KEY `idx_course_orders_student` (`student_id`, `created_at`, `id`)');
CALL `course_049_add_index`('course_bookings', 'idx_course_bookings_student', 'KEY `idx_course_bookings_student` (`student_id`, `created_at`, `id`)');
CALL `course_049_add_index`('course_bookings', 'idx_course_bookings_identity_conflict', 'KEY `idx_course_bookings_identity_conflict` (`student_identity_conflict_key`)');
-- Preserve the legacy (session_id, user_id) key while also covering unclaimed
-- GAS students whose user_id is NULL.
CALL `course_049_add_index`('course_bookings', 'uq_course_bookings_session_student', 'UNIQUE KEY `uq_course_bookings_session_student` (`session_id`, `student_id`)');
CALL `course_049_add_index`('course_ticket_holds', 'uq_course_ticket_holds_active_booking', 'UNIQUE KEY `uq_course_ticket_holds_active_booking` (`active_booking_id`)');
CALL `course_049_add_index`('course_ticket_holds', 'uq_course_ticket_holds_active_invite', 'UNIQUE KEY `uq_course_ticket_holds_active_invite` (`active_invite_id`)');
CALL `course_049_add_index`('course_attendance_invites', 'idx_course_attendance_invites_booking', 'KEY `idx_course_attendance_invites_booking` (`booking_id`)');
CALL `course_049_add_index`('course_attendance_invites', 'uq_course_attendance_invite_active_user', 'UNIQUE KEY `uq_course_attendance_invite_active_user` (`session_id`, `active_user_id`)');
CALL `course_049_add_index`('course_attendance_invites', 'uq_course_attendance_invite_active_student', 'UNIQUE KEY `uq_course_attendance_invite_active_student` (`session_id`, `active_student_id`)');
CALL `course_049_add_index`('course_usage_events', 'idx_course_usage_command', 'KEY `idx_course_usage_command` (`command_id`)');
CALL `course_049_add_index`('course_usage_events', 'idx_course_usage_idempotency', 'KEY `idx_course_usage_idempotency` (`idempotency_key`)');
CALL `course_049_add_index`('course_usage_events', 'uq_course_usage_reversal', 'UNIQUE KEY `uq_course_usage_reversal` (`reverses_event_id`)');
CALL `course_049_add_index`('course_coach_profiles', 'uq_course_coach_owner_code', 'UNIQUE KEY `uq_course_coach_owner_code` (`owner_user_id`, `code`)');

DROP PROCEDURE IF EXISTS `course_049_drop_foreign_key`;
DELIMITER $$
CREATE PROCEDURE `course_049_drop_foreign_key`(
  IN p_table_name VARCHAR(64),
  IN p_constraint_name VARCHAR(64)
)
BEGIN
  IF EXISTS (
    SELECT 1
      FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND CONSTRAINT_NAME = p_constraint_name
  ) THEN
    SET @course_049_drop_fk_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` DROP FOREIGN KEY `', REPLACE(p_constraint_name, '`', '``'), '`'
    );
    PREPARE course_049_drop_fk_stmt FROM @course_049_drop_fk_sql;
    EXECUTE course_049_drop_fk_stmt;
    DEALLOCATE PREPARE course_049_drop_fk_stmt;
  END IF;
END$$
DELIMITER ;

-- An immutable ledger cannot accept the implicit UPDATE caused by SET NULL.
-- Preserve every referenced identity and attendance fact instead.
CALL `course_049_drop_foreign_key`('course_usage_events', 'fk_course_usage_student');
CALL `course_049_drop_foreign_key`('course_usage_events', 'fk_course_usage_user');
CALL `course_049_drop_foreign_key`('course_usage_events', 'fk_course_usage_booking');
CALL `course_049_drop_foreign_key`('course_usage_events', 'fk_course_usage_invite');
CALL `course_049_drop_foreign_key`('course_usage_events', 'fk_course_usage_actor');

DROP PROCEDURE IF EXISTS `course_049_add_foreign_key`;
DELIMITER $$
CREATE PROCEDURE `course_049_add_foreign_key`(
  IN p_table_name VARCHAR(64),
  IN p_constraint_name VARCHAR(64),
  IN p_constraint_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND CONSTRAINT_NAME = p_constraint_name
  ) THEN
    SET @course_049_fk_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD CONSTRAINT `', REPLACE(p_constraint_name, '`', '``'),
      '` ', p_constraint_definition
    );
    PREPARE course_049_fk_stmt FROM @course_049_fk_sql;
    EXECUTE course_049_fk_stmt;
    DEALLOCATE PREPARE course_049_fk_stmt;
  END IF;
END$$
DELIMITER ;

CALL `course_049_add_foreign_key`('course_products', 'fk_course_products_ticket_product', 'FOREIGN KEY (`ticket_product_id`) REFERENCES `course_ticket_products` (`id`) ON DELETE RESTRICT');
CALL `course_049_add_foreign_key`('course_sessions', 'fk_course_sessions_scenario', 'FOREIGN KEY (`scenario_id`) REFERENCES `course_redeem_scenarios` (`id`) ON DELETE RESTRICT');
CALL `course_049_add_foreign_key`('course_sessions', 'fk_course_sessions_coach_profile', 'FOREIGN KEY (`coach_profile_id`) REFERENCES `course_coach_profiles` (`id`) ON DELETE SET NULL');
CALL `course_049_add_foreign_key`('course_tickets', 'fk_course_tickets_student', 'FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT');
CALL `course_049_add_foreign_key`('course_tickets', 'fk_course_tickets_ticket_product', 'FOREIGN KEY (`ticket_product_id`) REFERENCES `course_ticket_products` (`id`) ON DELETE RESTRICT');
CALL `course_049_add_foreign_key`('course_tickets', 'fk_course_tickets_order_item', 'FOREIGN KEY (`order_item_id`) REFERENCES `course_order_items` (`id`) ON DELETE SET NULL');
CALL `course_049_add_foreign_key`('course_orders', 'fk_course_orders_student', 'FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT');
CALL `course_049_add_foreign_key`('course_bookings', 'fk_course_bookings_student', 'FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT');
CALL `course_049_add_foreign_key`('course_ticket_holds', 'fk_course_ticket_holds_released_by', 'FOREIGN KEY (`released_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE');
CALL `course_049_add_foreign_key`('course_ticket_holds', 'fk_course_ticket_holds_consumed_event', 'FOREIGN KEY (`consumed_usage_event_id`) REFERENCES `course_usage_events` (`id`) ON DELETE RESTRICT');
CALL `course_049_add_foreign_key`('course_ticket_holds', 'fk_course_ticket_holds_invite', 'FOREIGN KEY (`invite_id`) REFERENCES `course_attendance_invites` (`id`) ON DELETE RESTRICT');
CALL `course_049_add_foreign_key`('course_attendance_invites', 'fk_course_attendance_invites_booking', 'FOREIGN KEY (`booking_id`) REFERENCES `course_bookings` (`id`) ON DELETE SET NULL');
CALL `course_049_add_foreign_key`('course_attendance_invites', 'fk_course_attendance_invites_redeemed_event', 'FOREIGN KEY (`redeemed_usage_event_id`) REFERENCES `course_usage_events` (`id`) ON DELETE RESTRICT');
CALL `course_049_add_foreign_key`('course_usage_events', 'fk_course_usage_student', 'FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT');
CALL `course_049_add_foreign_key`('course_usage_events', 'fk_course_usage_user', 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE');
CALL `course_049_add_foreign_key`('course_usage_events', 'fk_course_usage_booking', 'FOREIGN KEY (`booking_id`) REFERENCES `course_bookings` (`id`) ON DELETE RESTRICT');
CALL `course_049_add_foreign_key`('course_usage_events', 'fk_course_usage_invite', 'FOREIGN KEY (`invite_id`) REFERENCES `course_attendance_invites` (`id`) ON DELETE RESTRICT');
CALL `course_049_add_foreign_key`('course_usage_events', 'fk_course_usage_actor', 'FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE');
CALL `course_049_add_foreign_key`('course_usage_events', 'fk_course_usage_command', 'FOREIGN KEY (`command_id`) REFERENCES `course_mutation_commands` (`id`) ON DELETE RESTRICT');

-- Immutability is enforced in MySQL as well as in the domain service. Reversal,
-- refund and correction are represented by compensating INSERT events.
DROP TRIGGER IF EXISTS `course_usage_events_no_update`;
DROP TRIGGER IF EXISTS `course_usage_events_no_delete`;
DELIMITER $$
CREATE TRIGGER `course_usage_events_no_update`
BEFORE UPDATE ON `course_usage_events`
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'course_usage_events is immutable; insert a compensating event';
END$$
CREATE TRIGGER `course_usage_events_no_delete`
BEFORE DELETE ON `course_usage_events`
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'course_usage_events is immutable; insert a compensating event';
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `course_049_add_column`;
DROP PROCEDURE IF EXISTS `course_049_make_nullable`;
DROP PROCEDURE IF EXISTS `course_049_drop_index`;
DROP PROCEDURE IF EXISTS `course_049_drop_foreign_key`;
DROP PROCEDURE IF EXISTS `course_049_add_index`;
DROP PROCEDURE IF EXISTS `course_049_add_foreign_key`;

-- The startup marker is deliberately last. A partially applied MySQL DDL file
-- must not be mistaken for a complete normalized schema.
INSERT IGNORE INTO `course_schema_versions` (`version`, `description`)
VALUES ('049_course_count_card_normalization', 'Immutable course usage ledger, holds, scenarios, staff and GAS cutover staging');

SELECT 'Migration 049_course_count_card_normalization applied' AS msg;

UPDATE `tickets` t
JOIN (
  SELECT parsed.`ticket_id`, MIN(parsed.`order_id`) AS `order_id`
    FROM (
      SELECT l.`ticket_id`,
             COALESCE(
               CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(l.`meta`, '$.order_id')), '') AS UNSIGNED),
               CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(l.`meta`, '$.orderId')), '') AS UNSIGNED)
             ) AS `order_id`
        FROM `ticket_logs` l
       WHERE l.`action` = 'issued'
         AND l.`meta` IS NOT NULL
    ) parsed
   WHERE parsed.`order_id` IS NOT NULL
     AND parsed.`order_id` > 0
   GROUP BY parsed.`ticket_id`
  HAVING COUNT(DISTINCT parsed.`order_id`) = 1
) linked ON linked.`ticket_id` = t.`id`
JOIN `orders` o ON o.`id` = linked.`order_id`
   SET t.`order_id` = linked.`order_id`
 WHERE t.`order_id` IS NULL;

UPDATE `orders`
   SET `payment_status` = CASE
         WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`details`, '$.status')), '') IN ('已付款', '已完成', '待指派') THEN 'paid'
         WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`details`, '$.status')), '') IN ('已退款', 'refunded') THEN 'refunded'
         WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`details`, '$.status')), '') = '已取消' THEN 'cancelled'
         WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`details`, '$.status')), '') = '處理中' THEN 'reviewing'
         ELSE 'pending'
       END,
       `fulfillment_status` = CASE
         WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`details`, '$.status')), '') IN ('已付款', '已完成', '待指派')
          AND (
            COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`details`, '$.granted')), 'false') = 'true'
            OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`details`, '$.reservations_granted')), 'false') = 'true'
          ) THEN 'fulfilled'
         ELSE 'pending'
       END
 WHERE `id` >= 1;

UPDATE `orders` o
   SET o.`fulfillment_status` = CASE
     WHEN o.`payment_status` = 'refunded'
      AND (SELECT COUNT(*) FROM `tickets` t WHERE t.`order_id` = o.`id` AND t.`voided_at` IS NULL) = 0
      THEN 'voided'
     WHEN o.`payment_status` IN ('cancelled', 'refunded')
      AND (SELECT COUNT(*) FROM `tickets` t WHERE t.`order_id` = o.`id` AND t.`voided_at` IS NULL) > 0
      THEN 'fulfilled'
     WHEN o.`payment_status` = 'paid'
      AND COALESCE(JSON_LENGTH(JSON_EXTRACT(o.`details`, '$.selections')), 0) > 0
      AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(o.`details`, '$.reservations_granted')), 'false') = 'true'
      THEN 'fulfilled'
     WHEN o.`payment_status` = 'paid'
      AND COALESCE(JSON_LENGTH(JSON_EXTRACT(o.`details`, '$.selections')), 0) = 0
      AND (SELECT COUNT(*) FROM `tickets` t WHERE t.`order_id` = o.`id` AND t.`voided_at` IS NULL)
          = CAST(COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.`details`, '$.quantity')), ''), '0') AS UNSIGNED)
      AND CAST(COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.`details`, '$.quantity')), ''), '0') AS UNSIGNED) > 0
      THEN 'fulfilled'
     ELSE 'pending'
   END
 WHERE o.`id` >= 1;

UPDATE `course_orders`
   SET `payment_status` = CASE
         WHEN `status` = 'payment_review' THEN 'reviewing'
         WHEN `status` IN ('paid', 'issued') THEN 'paid'
         WHEN `status` = 'cancelled' THEN 'cancelled'
         WHEN `status` = 'refunded' THEN 'refunded'
         ELSE 'pending'
       END,
       `fulfillment_status` = CASE
         WHEN `status` = 'issued' THEN 'fulfilled'
         WHEN `status` = 'refunded' THEN 'voided'
         ELSE 'pending'
       END
 WHERE `id` >= 1;

UPDATE `course_orders` o
   SET o.`fulfillment_status` = CASE
     WHEN o.`payment_status` = 'refunded'
      AND (
        SELECT COUNT(*) FROM `course_tickets` t
         WHERE t.`order_id` = o.`id`
           AND t.`status` NOT IN ('void', 'voided', 'refunded')
      ) = 0 THEN 'voided'
     WHEN o.`payment_status` IN ('cancelled', 'refunded')
      AND (
        SELECT COUNT(*) FROM `course_tickets` t
         WHERE t.`order_id` = o.`id`
           AND t.`status` NOT IN ('void', 'voided', 'refunded')
      ) > 0 THEN 'fulfilled'
     WHEN o.`payment_status` = 'paid'
      AND (
        SELECT COUNT(*) FROM `course_tickets` t
         WHERE t.`order_id` = o.`id`
           AND t.`status` NOT IN ('void', 'voided', 'refunded')
      ) = COALESCE(
        NULLIF((SELECT SUM(oi.`quantity`) FROM `course_order_items` oi WHERE oi.`order_id` = o.`id`), 0),
        o.`quantity`
      )
      AND (
        SELECT COUNT(*) FROM `course_tickets` t
         WHERE t.`order_id` = o.`id`
           AND t.`status` NOT IN ('void', 'voided', 'refunded')
      ) > 0 THEN 'fulfilled'
     ELSE 'pending'
   END
 WHERE o.`id` >= 1;

INSERT IGNORE INTO `order_lifecycle_events` (
  `domain`, `order_id`, `action`,
  `from_payment_status`, `to_payment_status`,
  `from_fulfillment_status`, `to_fulfillment_status`,
  `reason`, `idempotency_key`, `metadata`
)
SELECT 'general', o.`id`, 'migration-repair-required',
       o.`payment_status`, o.`payment_status`,
       o.`fulfillment_status`, o.`fulfillment_status`,
       'Legacy order lifecycle and issued-ticket evidence disagree',
       'migration-050', JSON_OBJECT('migration', '050_order_ticket_parity')
  FROM `orders` o
 WHERE (o.`payment_status` = 'paid' AND o.`fulfillment_status` = 'pending')
    OR (o.`payment_status` IN ('cancelled', 'refunded') AND o.`fulfillment_status` = 'fulfilled')
    OR (
      o.`payment_status` IN ('pending', 'reviewing')
      AND EXISTS (
        SELECT 1
          FROM `tickets` t
         WHERE t.`order_id` = o.`id`
           AND t.`voided_at` IS NULL
      )
    );

INSERT IGNORE INTO `order_lifecycle_events` (
  `domain`, `order_id`, `action`,
  `from_payment_status`, `to_payment_status`,
  `from_fulfillment_status`, `to_fulfillment_status`,
  `reason`, `idempotency_key`, `metadata`
)
SELECT 'course', o.`id`, 'migration-repair-required',
       o.`payment_status`, o.`payment_status`,
       o.`fulfillment_status`, o.`fulfillment_status`,
       'Legacy course order lifecycle and issued-ticket evidence disagree',
       'migration-050', JSON_OBJECT('migration', '050_order_ticket_parity')
  FROM `course_orders` o
 WHERE (o.`payment_status` = 'paid' AND o.`fulfillment_status` = 'pending')
    OR (o.`payment_status` IN ('cancelled', 'refunded') AND o.`fulfillment_status` = 'fulfilled')
    OR (
      o.`payment_status` IN ('pending', 'reviewing')
      AND EXISTS (
        SELECT 1
          FROM `course_tickets` t
         WHERE t.`order_id` = o.`id`
           AND t.`status` NOT IN ('void', 'voided', 'refunded')
      )
    );

INSERT IGNORE INTO `course_schema_versions` (`version`, `description`)
VALUES ('050_order_ticket_parity', 'Canonical order lifecycle, compensations and multi-course checkout');

SELECT 'Migration 050_order_ticket_parity applied' AS msg;

-- Course productization migrations 051-053 are mirrored verbatim below.
-- COURSE_PRODUCTIZATION_051_BEGIN
-- Migration 051: productized count-card operations.
--
-- This migration extends the normalized 049 model without changing the 049
-- cutover marker. It is safe to rerun: every ALTER/constraint/index/FK is
-- guarded and the completion marker is written only after all DDL/backfills.

CREATE TABLE IF NOT EXISTS `course_schema_versions` (
  `version` VARCHAR(80) NOT NULL,
  `description` VARCHAR(255) NOT NULL,
  `applied_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM `course_schema_versions`
 WHERE `version` = '051_course_count_card_operational_parity';

DROP PROCEDURE IF EXISTS `course_051_add_column`;
DELIMITER $$
CREATE PROCEDURE `course_051_add_column`(
  IN p_table_name VARCHAR(64),
  IN p_column_name VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND COLUMN_NAME = p_column_name
  ) THEN
    SET @course_051_column_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD COLUMN `', REPLACE(p_column_name, '`', '``'), '` ', p_definition
    );
    PREPARE course_051_column_stmt FROM @course_051_column_sql;
    EXECUTE course_051_column_stmt;
    DEALLOCATE PREPARE course_051_column_stmt;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `course_051_make_nullable`;
DELIMITER $$
CREATE PROCEDURE `course_051_make_nullable`(
  IN p_table_name VARCHAR(64),
  IN p_column_name VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND COLUMN_NAME = p_column_name
       AND IS_NULLABLE = 'NO'
  ) THEN
    SET @course_051_nullable_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` MODIFY COLUMN `', REPLACE(p_column_name, '`', '``'), '` ', p_definition
    );
    PREPARE course_051_nullable_stmt FROM @course_051_nullable_sql;
    EXECUTE course_051_nullable_stmt;
    DEALLOCATE PREPARE course_051_nullable_stmt;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `course_051_add_index`;
DELIMITER $$
CREATE PROCEDURE `course_051_add_index`(
  IN p_table_name VARCHAR(64),
  IN p_index_name VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND INDEX_NAME = p_index_name
  ) THEN
    SET @course_051_index_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'), '` ADD ', p_definition
    );
    PREPARE course_051_index_stmt FROM @course_051_index_sql;
    EXECUTE course_051_index_stmt;
    DEALLOCATE PREPARE course_051_index_stmt;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `course_051_add_check`;
DELIMITER $$
CREATE PROCEDURE `course_051_add_check`(
  IN p_table_name VARCHAR(64),
  IN p_constraint_name VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND CONSTRAINT_NAME = p_constraint_name
  ) THEN
    SET @course_051_check_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD CONSTRAINT `', REPLACE(p_constraint_name, '`', '``'),
      '` CHECK (', p_definition, ')'
    );
    PREPARE course_051_check_stmt FROM @course_051_check_sql;
    EXECUTE course_051_check_stmt;
    DEALLOCATE PREPARE course_051_check_stmt;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `course_051_add_foreign_key`;
DELIMITER $$
CREATE PROCEDURE `course_051_add_foreign_key`(
  IN p_table_name VARCHAR(64),
  IN p_constraint_name VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND CONSTRAINT_NAME = p_constraint_name
  ) THEN
    SET @course_051_fk_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD CONSTRAINT `', REPLACE(p_constraint_name, '`', '``'), '` ', p_definition
    );
    PREPARE course_051_fk_stmt FROM @course_051_fk_sql;
    EXECUTE course_051_fk_stmt;
    DEALLOCATE PREPARE course_051_fk_stmt;
  END IF;
END$$
DELIMITER ;

-- Redeem contexts are not synonymous with classes. Only a session-bound class
-- requires a scheduled course_session; term contexts are payment/eligibility
-- instruments and never become fixed-term attendance truth.
CALL `course_051_add_column`('course_redeem_scenarios', 'item_type', 'VARCHAR(24) NOT NULL DEFAULT ''class'' AFTER `description`');
CALL `course_051_add_column`('course_redeem_scenarios', 'session_bound', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER `item_type`');
CALL `course_051_add_column`('course_redeem_scenarios', 'redeem_quantity', 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER `session_bound`');

CALL `course_051_add_check`('course_redeem_scenarios', 'chk_course_redeem_item_type', '`item_type` IN (''class'', ''term'', ''event'', ''merchant'', ''service'', ''other'')');
CALL `course_051_add_check`('course_redeem_scenarios', 'chk_course_redeem_quantity', '`redeem_quantity` >= 1');

-- NULL capacity is the canonical unlimited-capacity representation. Existing
-- zero-capacity rows are normalized only after the column permits NULL.
CALL `course_051_add_column`('course_sessions', 'cancel_close_at', 'DATETIME NULL AFTER `booking_close_at`');
CALL `course_051_add_column`('course_sessions', 'venue_name', 'VARCHAR(255) NULL AFTER `location`');
CALL `course_051_add_column`('course_sessions', 'city', 'VARCHAR(120) NULL AFTER `venue_name`');
CALL `course_051_make_nullable`('course_sessions', 'capacity', 'INT UNSIGNED NULL');
UPDATE `course_sessions`
   SET `capacity` = NULL
 WHERE `id` >= 1
   AND `capacity` = 0;

CALL `course_051_add_index`('course_sessions', 'idx_course_sessions_owner_city_time', 'KEY `idx_course_sessions_owner_city_time` (`owner_user_id`, `city`, `starts_at`, `id`)');

-- Product policies are canonical defaults. Ticket snapshots stay nullable so
-- old issuance SQL remains compatible and runtime may COALESCE to the product.
CALL `course_051_add_column`('course_ticket_products', 'product_type', 'VARCHAR(32) NOT NULL DEFAULT ''count_pass'' AFTER `description`');
CALL `course_051_add_column`('course_ticket_products', 'usage_mode', 'VARCHAR(16) NOT NULL DEFAULT ''finite'' AFTER `product_type`');
CALL `course_051_add_column`('course_ticket_products', 'usage_notice_scope', 'VARCHAR(24) NOT NULL DEFAULT ''product'' AFTER `usage_mode`');
CALL `course_051_add_column`('course_ticket_products', 'source_system', 'VARCHAR(32) NOT NULL DEFAULT ''leader'' AFTER `usage_notice_scope`');
CALL `course_051_add_column`('course_ticket_products', 'source_id', 'VARCHAR(128) NULL AFTER `source_system`');
CALL `course_051_add_column`('course_ticket_products', 'max_transfer_operations', 'SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER `max_transfers`');
CALL `course_051_add_column`('course_ticket_products', 'pause_max_operations', 'SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER `max_transfer_operations`');
CALL `course_051_add_column`('course_ticket_products', 'pause_max_days', 'SMALLINT UNSIGNED NOT NULL DEFAULT 365 AFTER `pause_max_operations`');

CALL `course_051_add_check`('course_ticket_products', 'chk_course_ticket_product_usage_mode', '`usage_mode` IN (''finite'', ''unlimited'')');
CALL `course_051_add_check`('course_ticket_products', 'chk_course_ticket_product_type', '`product_type` IN (''count_pass'', ''trial_discount'', ''course_payment'')');
CALL `course_051_add_check`('course_ticket_products', 'chk_course_ticket_pause_days', '`pause_max_days` BETWEEN 1 AND 3650');
CALL `course_051_add_index`('course_ticket_products', 'uq_course_ticket_products_source', 'UNIQUE KEY `uq_course_ticket_products_source` (`source_system`, `source_id`)');

CALL `course_051_add_column`('course_tickets', 'usage_mode_snapshot', 'VARCHAR(16) NULL AFTER `product_class_count_snapshot`');
CALL `course_051_add_column`('course_tickets', 'product_type_snapshot', 'VARCHAR(32) NULL AFTER `usage_mode_snapshot`');
CALL `course_051_add_column`('course_tickets', 'usage_notice_scope_snapshot', 'VARCHAR(24) NULL AFTER `product_type_snapshot`');
CALL `course_051_add_column`('course_tickets', 'max_transfer_operations_snapshot', 'SMALLINT UNSIGNED NULL AFTER `product_max_transfers_snapshot`');
CALL `course_051_add_column`('course_tickets', 'pause_max_operations_snapshot', 'SMALLINT UNSIGNED NULL AFTER `max_transfer_operations_snapshot`');
CALL `course_051_add_column`('course_tickets', 'pause_max_days_snapshot', 'SMALLINT UNSIGNED NULL AFTER `pause_max_operations_snapshot`');
CALL `course_051_add_column`('course_tickets', 'source_system', 'VARCHAR(32) NOT NULL DEFAULT ''leader'' AFTER `provider_name_snapshot`');
CALL `course_051_add_column`('course_tickets', 'source_id', 'VARCHAR(128) NULL AFTER `source_system`');
CALL `course_051_add_column`('course_tickets', 'parent_ticket_id', 'BIGINT UNSIGNED NULL AFTER `source_id`');
CALL `course_051_add_column`('course_tickets', 'transfer_root_ticket_id', 'BIGINT UNSIGNED NULL AFTER `parent_ticket_id`');

UPDATE `course_tickets` t
LEFT JOIN `course_ticket_products` tp ON tp.`id` = t.`ticket_product_id`
   SET t.`usage_mode_snapshot` = COALESCE(t.`usage_mode_snapshot`, tp.`usage_mode`, 'finite'),
       t.`product_type_snapshot` = COALESCE(t.`product_type_snapshot`, tp.`product_type`, 'count_pass'),
       t.`usage_notice_scope_snapshot` = COALESCE(t.`usage_notice_scope_snapshot`, tp.`usage_notice_scope`, 'product'),
       t.`max_transfer_operations_snapshot` = COALESCE(t.`max_transfer_operations_snapshot`, tp.`max_transfer_operations`, t.`product_max_transfers_snapshot`, 1),
       t.`pause_max_operations_snapshot` = COALESCE(t.`pause_max_operations_snapshot`, tp.`pause_max_operations`, 1),
       t.`pause_max_days_snapshot` = COALESCE(t.`pause_max_days_snapshot`, tp.`pause_max_days`, 365),
       t.`transfer_root_ticket_id` = COALESCE(t.`transfer_root_ticket_id`, t.`id`)
 WHERE t.`id` >= 1;

CALL `course_051_add_index`('course_tickets', 'uq_course_tickets_source', 'UNIQUE KEY `uq_course_tickets_source` (`source_system`, `source_id`)');
CALL `course_051_add_index`('course_tickets', 'idx_course_tickets_transfer_root', 'KEY `idx_course_tickets_transfer_root` (`transfer_root_ticket_id`, `parent_ticket_id`, `id`)');
CALL `course_051_add_foreign_key`('course_tickets', 'fk_course_tickets_parent', 'FOREIGN KEY (`parent_ticket_id`) REFERENCES `course_tickets` (`id`) ON DELETE RESTRICT');
CALL `course_051_add_foreign_key`('course_tickets', 'fk_course_tickets_transfer_root', 'FOREIGN KEY (`transfer_root_ticket_id`) REFERENCES `course_tickets` (`id`) ON DELETE RESTRICT');

-- Booking status remains the coarse lifecycle. Typed resolution facts preserve
-- the operational distinction between cancellation, leave, no-show and repair.
CALL `course_051_add_column`('course_bookings', 'origin', 'VARCHAR(32) NOT NULL DEFAULT ''MEMBER_RSVP'' AFTER `status`');
CALL `course_051_add_column`('course_bookings', 'redeem_quantity_snapshot', 'INT UNSIGNED NULL AFTER `origin`');
CALL `course_051_add_column`('course_bookings', 'resolution_type', 'VARCHAR(32) NULL AFTER `attended_at`');
CALL `course_051_add_column`('course_bookings', 'resolution_actor_user_id', 'CHAR(36) NULL AFTER `resolution_type`');
CALL `course_051_add_column`('course_bookings', 'resolution_at', 'DATETIME NULL AFTER `resolution_actor_user_id`');
CALL `course_051_add_column`('course_bookings', 'capacity_override', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `resolution_reason`');
CALL `course_051_add_column`('course_bookings', 'capacity_override_reason', 'VARCHAR(500) NULL AFTER `capacity_override`');

CALL `course_051_add_check`('course_bookings', 'chk_course_booking_origin', '`origin` IN (''MEMBER_RSVP'', ''WALK_IN'', ''ATTENDANCE_INVITE'', ''TERM_ROSTER'', ''MAKEUP'')');
CALL `course_051_add_check`('course_bookings', 'chk_course_booking_resolution', '`resolution_type` IS NULL OR `resolution_type` IN (''member_cancel'', ''excused_leave'', ''attended'', ''late_attend'', ''no_show'', ''reversal'', ''provider_cancel'')');
CALL `course_051_add_check`('course_bookings', 'chk_course_booking_capacity_override', '`capacity_override` = 0 OR NULLIF(TRIM(`capacity_override_reason`), '''') IS NOT NULL');
CALL `course_051_add_foreign_key`('course_bookings', 'fk_course_bookings_resolution_actor', 'FOREIGN KEY (`resolution_actor_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE');

-- Holds reserve operational quantity even for unlimited tickets. Unlimited
-- redemption is represented by delta_uses=0, not by a zero-quantity hold.
CALL `course_051_add_column`('course_ticket_holds', 'purpose', 'VARCHAR(32) NOT NULL DEFAULT ''BOOKING'' AFTER `ticket_id`');
CALL `course_051_add_column`('course_ticket_holds', 'source_type', 'VARCHAR(48) NULL AFTER `purpose`');
CALL `course_051_add_column`('course_ticket_holds', 'source_id', 'VARCHAR(128) NULL AFTER `source_type`');
CALL `course_051_add_column`(
  'course_ticket_holds',
  'active_source_key',
  'VARCHAR(240) GENERATED ALWAYS AS (CASE WHEN `status` = ''active'' AND `source_type` IS NOT NULL AND `source_id` IS NOT NULL THEN CONCAT(`purpose`, '':'', `source_type`, '':'', `source_id`) ELSE NULL END) STORED AFTER `active_invite_id`'
);
CALL `course_051_add_check`('course_ticket_holds', 'chk_course_ticket_hold_purpose', '`purpose` IN (''BOOKING'', ''ATTENDANCE_CONFIRMATION'', ''TRANSFER'', ''PAYMENT_INSTRUMENT'')');
CALL `course_051_add_index`('course_ticket_holds', 'uq_course_ticket_holds_active_source', 'UNIQUE KEY `uq_course_ticket_holds_active_source` (`active_source_key`)');

CALL `course_051_add_column`('course_attendance_invites', 'expiry_action', 'VARCHAR(24) NOT NULL DEFAULT ''release'' AFTER `expires_at`');
CALL `course_051_add_column`('course_attendance_invites', 'expiry_action_snapshot_at', 'DATETIME NULL AFTER `expiry_action`');
UPDATE `course_attendance_invites`
   SET `expiry_action_snapshot_at` = COALESCE(`expiry_action_snapshot_at`, `created_at`)
 WHERE `id` >= 1
   AND `expiry_action_snapshot_at` IS NULL;
CALL `course_051_add_check`('course_attendance_invites', 'chk_course_attendance_invite_expiry', '`expiry_action` IN (''release'', ''auto_redeem'')');

-- Typed immutable usage facts keep historical KPI dimensions stable after
-- scenarios, coaches or venues are renamed.
-- Canonical event vocabulary retained by this operational layer:
-- SUCCESS, NO_SHOW, REVERSAL, TRANSFER_OUT, TRANSFER_IN.
CALL `course_051_add_column`('course_usage_events', 'usage_method', 'VARCHAR(32) NULL AFTER `event_type`');
CALL `course_051_add_column`('course_usage_events', 'scenario_id', 'BIGINT UNSIGNED NULL AFTER `session_id`');
CALL `course_051_add_column`('course_usage_events', 'coach_profile_id', 'BIGINT UNSIGNED NULL AFTER `scenario_id`');
CALL `course_051_add_column`('course_usage_events', 'provider_user_id_snapshot', 'CHAR(36) NULL AFTER `coach_profile_id`');
CALL `course_051_add_column`('course_usage_events', 'venue_name_snapshot', 'VARCHAR(255) NULL AFTER `provider_user_id_snapshot`');
CALL `course_051_add_column`('course_usage_events', 'city_snapshot', 'VARCHAR(120) NULL AFTER `venue_name_snapshot`');
CALL `course_051_add_column`('course_usage_events', 'quantity_snapshot', 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER `delta_uses`');
CALL `course_051_add_check`('course_usage_events', 'chk_course_usage_method', '`usage_method` IS NULL OR `usage_method` IN (''booking_attendance'', ''late_attendance'', ''walk_in'', ''attendance_invite'', ''no_show'', ''transfer'', ''course_payment'', ''refund'', ''migration'', ''admin_adjustment'', ''system'')');
CALL `course_051_add_check`('course_usage_events', 'chk_course_usage_quantity_snapshot', '`quantity_snapshot` >= 1');
CALL `course_051_add_index`('course_usage_events', 'idx_course_usage_provider_dimensions', 'KEY `idx_course_usage_provider_dimensions` (`provider_user_id_snapshot`, `event_type`, `occurred_at`, `id`)');
CALL `course_051_add_foreign_key`('course_usage_events', 'fk_course_usage_scenario', 'FOREIGN KEY (`scenario_id`) REFERENCES `course_redeem_scenarios` (`id`) ON DELETE RESTRICT');
CALL `course_051_add_foreign_key`('course_usage_events', 'fk_course_usage_coach_profile', 'FOREIGN KEY (`coach_profile_id`) REFERENCES `course_coach_profiles` (`id`) ON DELETE RESTRICT');
CALL `course_051_add_foreign_key`('course_usage_events', 'fk_course_usage_provider_snapshot', 'FOREIGN KEY (`provider_user_id_snapshot`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE');

-- Existing rows are explicitly whole-ticket legacy transfers. New partial
-- transfers reserve uses in course_ticket_holds before acceptance creates a
-- child CTK ticket and compensating TRANSFER_OUT/TRANSFER_IN ledger facts.
CALL `course_051_add_column`('course_ticket_transfers', 'transfer_mode', 'VARCHAR(24) NOT NULL DEFAULT ''WHOLE_LEGACY'' AFTER `ticket_id`');
CALL `course_051_add_column`('course_ticket_transfers', 'quantity', 'INT UNSIGNED NULL AFTER `transfer_mode`');
CALL `course_051_add_column`('course_ticket_transfers', 'hold_id', 'BIGINT UNSIGNED NULL AFTER `quantity`');
CALL `course_051_add_column`('course_ticket_transfers', 'child_ticket_id', 'BIGINT UNSIGNED NULL AFTER `hold_id`');
CALL `course_051_add_column`('course_ticket_transfers', 'expires_at', 'DATETIME NULL AFTER `status`');
CALL `course_051_add_column`('course_ticket_transfers', 'accepted_at', 'DATETIME NULL AFTER `expires_at`');
CALL `course_051_add_column`('course_ticket_transfers', 'declined_at', 'DATETIME NULL AFTER `accepted_at`');
CALL `course_051_add_column`('course_ticket_transfers', 'cancelled_at', 'DATETIME NULL AFTER `declined_at`');
CALL `course_051_add_column`('course_ticket_transfers', 'row_version', 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER `cancelled_at`');
CALL `course_051_add_check`('course_ticket_transfers', 'chk_course_ticket_transfer_mode', '`transfer_mode` IN (''WHOLE_LEGACY'', ''PARTIAL'')');
CALL `course_051_add_check`('course_ticket_transfers', 'chk_course_ticket_transfer_quantity', '(`transfer_mode` = ''WHOLE_LEGACY'' AND `quantity` IS NULL) OR (`transfer_mode` = ''PARTIAL'' AND `quantity` >= 1)');
CALL `course_051_add_index`('course_ticket_transfers', 'uq_course_ticket_transfers_hold', 'UNIQUE KEY `uq_course_ticket_transfers_hold` (`hold_id`)');
CALL `course_051_add_index`('course_ticket_transfers', 'uq_course_ticket_transfers_child', 'UNIQUE KEY `uq_course_ticket_transfers_child` (`child_ticket_id`)');
CALL `course_051_add_index`('course_ticket_transfers', 'idx_course_ticket_transfers_due', 'KEY `idx_course_ticket_transfers_due` (`status`, `expires_at`, `id`)');
CALL `course_051_add_foreign_key`('course_ticket_transfers', 'fk_course_ticket_transfers_hold', 'FOREIGN KEY (`hold_id`) REFERENCES `course_ticket_holds` (`id`) ON DELETE RESTRICT');
CALL `course_051_add_foreign_key`('course_ticket_transfers', 'fk_course_ticket_transfers_child', 'FOREIGN KEY (`child_ticket_id`) REFERENCES `course_tickets` (`id`) ON DELETE RESTRICT');

-- Provider settings are fail-closed until the 051 runtime and provider are both
-- explicitly enabled. Thresholds are operational defaults, never code constants.
CALL `course_051_add_column`('course_settings', 'attendance_invite_expiry_action', 'VARCHAR(24) NOT NULL DEFAULT ''release'' AFTER `attendance_invite_expires_minutes`');
CALL `course_051_add_column`('course_settings', 'bank_transfer_hold_hours', 'SMALLINT UNSIGNED NOT NULL DEFAULT 24 AFTER `attendance_invite_expiry_action`');
CALL `course_051_add_column`('course_settings', 'pause_max_operations', 'SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER `bank_transfer_hold_hours`');
CALL `course_051_add_column`('course_settings', 'pause_max_days', 'SMALLINT UNSIGNED NOT NULL DEFAULT 365 AFTER `pause_max_operations`');
CALL `course_051_add_column`('course_settings', 'push_plan_max_available_uses', 'INT UNSIGNED NOT NULL DEFAULT 3 AFTER `pause_max_days`');
CALL `course_051_add_column`('course_settings', 'expiring_ticket_days', 'SMALLINT UNSIGNED NOT NULL DEFAULT 30 AFTER `push_plan_max_available_uses`');
CALL `course_051_add_column`('course_settings', 'dormant_student_days', 'SMALLINT UNSIGNED NOT NULL DEFAULT 90 AFTER `expiring_ticket_days`');
CALL `course_051_add_column`('course_settings', 'count_card_parity_enabled', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `auto_no_show`');
CALL `course_051_add_check`('course_settings', 'chk_course_settings_invite_expiry', '`attendance_invite_expiry_action` IN (''release'', ''auto_redeem'')');
CALL `course_051_add_check`('course_settings', 'chk_course_settings_hold_hours', '`bank_transfer_hold_hours` BETWEEN 1 AND 720');
CALL `course_051_add_check`('course_settings', 'chk_course_settings_pause_days', '`pause_max_days` BETWEEN 1 AND 3650');

DROP PROCEDURE IF EXISTS `course_051_add_column`;
DROP PROCEDURE IF EXISTS `course_051_make_nullable`;
DROP PROCEDURE IF EXISTS `course_051_add_index`;
DROP PROCEDURE IF EXISTS `course_051_add_check`;
DROP PROCEDURE IF EXISTS `course_051_add_foreign_key`;

INSERT IGNORE INTO `course_schema_versions` (`version`, `description`)
VALUES ('051_course_count_card_operational_parity', 'Productized count-card scenarios, operations, partial transfers and reporting facts');

SELECT 'Migration 051_course_count_card_operational_parity applied' AS msg;
-- COURSE_PRODUCTIZATION_051_END
-- COURSE_PRODUCTIZATION_052_BEGIN
-- Migration 052: fixed-term course productization.
--
-- Count-card balances remain in course_usage_events. Fixed-term attendance and
-- leave/makeup rights are represented by enrollment/session entitlement rows.
-- Every aggregate is provider scoped and mutable resources carry row_version.

CREATE TABLE IF NOT EXISTS `course_schema_versions` (
  `version` VARCHAR(80) NOT NULL,
  `description` VARCHAR(255) NOT NULL,
  `applied_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM `course_schema_versions`
 WHERE `version` = '052_course_fixed_term_productization';

DROP PROCEDURE IF EXISTS `course_052_add_column`;
DELIMITER $$
CREATE PROCEDURE `course_052_add_column`(
  IN p_table_name VARCHAR(64),
  IN p_column_name VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND COLUMN_NAME = p_column_name
  ) THEN
    SET @course_052_column_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD COLUMN `', REPLACE(p_column_name, '`', '``'), '` ', p_definition
    );
    PREPARE course_052_column_stmt FROM @course_052_column_sql;
    EXECUTE course_052_column_stmt;
    DEALLOCATE PREPARE course_052_column_stmt;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `course_052_add_foreign_key`;
DELIMITER $$
CREATE PROCEDURE `course_052_add_foreign_key`(
  IN p_table_name VARCHAR(64),
  IN p_constraint_name VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND CONSTRAINT_NAME = p_constraint_name
  ) THEN
    SET @course_052_fk_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD CONSTRAINT `', REPLACE(p_constraint_name, '`', '``'), '` ', p_definition
    );
    PREPARE course_052_fk_stmt FROM @course_052_fk_sql;
    EXECUTE course_052_fk_stmt;
    DEALLOCATE PREPARE course_052_fk_stmt;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `course_052_add_index`;
DELIMITER $$
CREATE PROCEDURE `course_052_add_index`(
  IN p_table_name VARCHAR(64),
  IN p_index_name VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND INDEX_NAME = p_index_name
  ) THEN
    SET @course_052_index_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'), '` ADD ', p_definition
    );
    PREPARE course_052_index_stmt FROM @course_052_index_sql;
    EXECUTE course_052_index_stmt;
    DEALLOCATE PREPARE course_052_index_stmt;
  END IF;
END$$
DELIMITER ;

CREATE TABLE IF NOT EXISTS `course_programs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `slug` VARCHAR(120) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `summary` VARCHAR(500) DEFAULT NULL,
  `description` MEDIUMTEXT DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'draft',
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_programs_owner_code` (`owner_user_id`, `code`),
  UNIQUE KEY `uq_course_programs_owner_slug` (`owner_user_id`, `slug`),
  KEY `idx_course_programs_owner_status` (`owner_user_id`, `status`, `id`),
  CONSTRAINT `fk_course_programs_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_level_schemes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_level_schemes_owner_code` (`owner_user_id`, `code`),
  KEY `idx_course_level_schemes_owner_status` (`owner_user_id`, `status`, `id`),
  CONSTRAINT `fk_course_level_schemes_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_levels` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `scheme_id` BIGINT UNSIGNED NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_levels_scheme_code` (`scheme_id`, `code`),
  KEY `idx_course_levels_owner_scheme` (`owner_user_id`, `scheme_id`, `status`, `sort_order`, `id`),
  CONSTRAINT `fk_course_levels_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_levels_scheme` FOREIGN KEY (`scheme_id`) REFERENCES `course_level_schemes` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_student_level_records` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `student_id` BIGINT UNSIGNED NOT NULL,
  `scheme_id` BIGINT UNSIGNED NOT NULL,
  `level_id` BIGINT UNSIGNED DEFAULT NULL,
  `assessment_status` VARCHAR(24) NOT NULL DEFAULT 'NOT_STARTED',
  `is_current` TINYINT(1) NOT NULL DEFAULT 1,
  `active_scheme_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `is_current` = 1 THEN `scheme_id` ELSE NULL END
  ) STORED,
  `assessed_by_user_id` CHAR(36) DEFAULT NULL,
  `assessed_at` DATETIME DEFAULT NULL,
  `expires_at` DATETIME DEFAULT NULL,
  `evidence_json` JSON DEFAULT NULL,
  `note` VARCHAR(500) DEFAULT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_student_current_scheme` (`owner_user_id`, `student_id`, `active_scheme_id`),
  KEY `idx_course_student_levels_owner_status` (`owner_user_id`, `assessment_status`, `student_id`, `id`),
  CONSTRAINT `fk_course_student_levels_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_student_levels_student` FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_student_levels_scheme` FOREIGN KEY (`scheme_id`) REFERENCES `course_level_schemes` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_student_levels_level` FOREIGN KEY (`level_id`) REFERENCES `course_levels` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_student_levels_actor` FOREIGN KEY (`assessed_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_terms` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `program_id` BIGINT UNSIGNED NOT NULL,
  `level_id` BIGINT UNSIGNED DEFAULT NULL,
  `code` VARCHAR(64) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` MEDIUMTEXT DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'draft',
  `enrollment_open_at` DATETIME DEFAULT NULL,
  `enrollment_close_at` DATETIME DEFAULT NULL,
  `starts_on` DATE NOT NULL,
  `ends_on` DATE NOT NULL,
  `capacity` INT UNSIGNED DEFAULT NULL,
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Taipei',
  `leave_quota` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `leave_cutoff_minutes` INT UNSIGNED NOT NULL DEFAULT 0,
  `makeup_valid_days` SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  `rules_snapshot_json` JSON NOT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_terms_owner_code` (`owner_user_id`, `code`),
  KEY `idx_course_terms_owner_status_dates` (`owner_user_id`, `status`, `starts_on`, `ends_on`, `id`),
  KEY `idx_course_terms_program` (`program_id`, `status`, `starts_on`, `id`),
  CONSTRAINT `fk_course_terms_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_terms_program` FOREIGN KEY (`program_id`) REFERENCES `course_programs` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_terms_level` FOREIGN KEY (`level_id`) REFERENCES `course_levels` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_course_terms_dates` CHECK (`ends_on` >= `starts_on`),
  CONSTRAINT `chk_course_terms_enrollment_window` CHECK (`enrollment_close_at` IS NULL OR `enrollment_open_at` IS NULL OR `enrollment_close_at` >= `enrollment_open_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL `course_052_add_column`('course_sessions', 'program_id', 'BIGINT UNSIGNED NULL AFTER `scenario_id`');
CALL `course_052_add_column`('course_sessions', 'term_id', 'BIGINT UNSIGNED NULL AFTER `program_id`');
CALL `course_052_add_column`('course_sessions', 'session_kind', 'VARCHAR(24) NOT NULL DEFAULT ''COUNT_CARD'' AFTER `term_id`');
CALL `course_052_add_column`('course_sessions', 'term_session_sequence', 'INT UNSIGNED NULL AFTER `session_kind`');
CALL `course_052_add_column`('course_sessions', 'entitlement_required', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER `term_session_sequence`');
CALL `course_052_add_index`('course_sessions', 'idx_course_sessions_term_sequence', 'KEY `idx_course_sessions_term_sequence` (`term_id`, `term_session_sequence`, `starts_at`, `id`)');
CALL `course_052_add_foreign_key`('course_sessions', 'fk_course_sessions_program', 'FOREIGN KEY (`program_id`) REFERENCES `course_programs` (`id`) ON DELETE RESTRICT');
CALL `course_052_add_foreign_key`('course_sessions', 'fk_course_sessions_term', 'FOREIGN KEY (`term_id`) REFERENCES `course_terms` (`id`) ON DELETE RESTRICT');

CREATE TABLE IF NOT EXISTS `course_term_pricing_rules` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `term_id` BIGINT UNSIGNED NOT NULL,
  `pricing_mode` VARCHAR(32) NOT NULL,
  `unit_price` DECIMAL(10,2) DEFAULT NULL,
  `full_price` DECIMAL(10,2) DEFAULT NULL,
  `currency` CHAR(3) NOT NULL DEFAULT 'TWD',
  `valid_from_session_id` BIGINT UNSIGNED DEFAULT NULL,
  `valid_through_session_id` BIGINT UNSIGNED DEFAULT NULL,
  `configuration_json` JSON DEFAULT NULL,
  `priority` INT UNSIGNED NOT NULL DEFAULT 100,
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_term_pricing_identity` (`term_id`, `pricing_mode`, `valid_from_session_id`),
  KEY `idx_course_term_pricing_owner` (`owner_user_id`, `term_id`, `status`, `id`),
  CONSTRAINT `fk_course_term_pricing_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_pricing_term` FOREIGN KEY (`term_id`) REFERENCES `course_terms` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_pricing_from_session` FOREIGN KEY (`valid_from_session_id`) REFERENCES `course_sessions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_pricing_through_session` FOREIGN KEY (`valid_through_session_id`) REFERENCES `course_sessions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_course_term_pricing_mode` CHECK (`pricing_mode` IN ('FULL_TERM', 'PRO_RATA_SESSIONS', 'UNIT_X_REMAINING', 'PRO_RATA_CALENDAR')),
  CONSTRAINT `chk_course_term_pricing_amount` CHECK (`unit_price` IS NOT NULL OR `full_price` IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_term_renewal_rules` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `source_term_id` BIGINT UNSIGNED NOT NULL,
  `target_term_id` BIGINT UNSIGNED NOT NULL,
  `renewal_open_at` DATETIME NOT NULL,
  `renewal_close_at` DATETIME NOT NULL,
  `reserved_capacity` INT UNSIGNED NOT NULL DEFAULT 0,
  `eligibility_json` JSON DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_term_renewal_pair` (`source_term_id`, `target_term_id`),
  KEY `idx_course_term_renewal_owner_window` (`owner_user_id`, `status`, `renewal_open_at`, `renewal_close_at`, `id`),
  CONSTRAINT `fk_course_term_renewal_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_renewal_source` FOREIGN KEY (`source_term_id`) REFERENCES `course_terms` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_renewal_target` FOREIGN KEY (`target_term_id`) REFERENCES `course_terms` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_course_term_renewal_window` CHECK (`renewal_close_at` >= `renewal_open_at`),
  CONSTRAINT `chk_course_term_renewal_distinct` CHECK (`source_term_id` <> `target_term_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_term_quotes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `quote_code` VARCHAR(48) NOT NULL,
  `owner_user_id` CHAR(36) NOT NULL,
  `term_id` BIGINT UNSIGNED NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `student_id` BIGINT UNSIGNED NOT NULL,
  `idempotency_key` VARCHAR(128) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `session_ids_json` JSON NOT NULL,
  `pricing_snapshot_json` JSON NOT NULL,
  `rules_snapshot_json` JSON NOT NULL,
  `total_amount` DECIMAL(10,2) NOT NULL,
  `currency` CHAR(3) NOT NULL DEFAULT 'TWD',
  `status` VARCHAR(24) NOT NULL DEFAULT 'OPEN',
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME DEFAULT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_term_quotes_code` (`quote_code`),
  UNIQUE KEY `uq_course_term_quotes_user_key` (`user_id`, `idempotency_key`),
  KEY `idx_course_term_quotes_owner_status_due` (`owner_user_id`, `status`, `expires_at`, `id`),
  KEY `idx_course_term_quotes_term_student` (`term_id`, `student_id`, `created_at`, `id`),
  CONSTRAINT `fk_course_term_quotes_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_quotes_term` FOREIGN KEY (`term_id`) REFERENCES `course_terms` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_quotes_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_quotes_student` FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_course_term_quotes_amount` CHECK (`total_amount` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_term_enrollments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `enrollment_code` VARCHAR(48) NOT NULL,
  `owner_user_id` CHAR(36) NOT NULL,
  `term_id` BIGINT UNSIGNED NOT NULL,
  `student_id` BIGINT UNSIGNED NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `order_id` BIGINT UNSIGNED DEFAULT NULL,
  `quote_id` BIGINT UNSIGNED DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING_PAYMENT',
  `start_session_id` BIGINT UNSIGNED DEFAULT NULL,
  `quote_snapshot_json` JSON NOT NULL,
  `rules_snapshot_json` JSON NOT NULL,
  `checkout_idempotency_key` VARCHAR(128) NOT NULL,
  `enrolled_at` DATETIME DEFAULT NULL,
  `cancelled_at` DATETIME DEFAULT NULL,
  `cancel_reason` VARCHAR(500) DEFAULT NULL,
  `completed_at` DATETIME DEFAULT NULL,
  `active_student_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` IN ('PENDING_PAYMENT', 'CONFIRMED') THEN `student_id` ELSE NULL END
  ) STORED,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_term_enrollments_code` (`enrollment_code`),
  UNIQUE KEY `uq_course_term_enrollments_checkout_key` (`user_id`, `checkout_idempotency_key`),
  UNIQUE KEY `uq_course_term_enrollments_active_student` (`term_id`, `active_student_id`),
  UNIQUE KEY `uq_course_term_enrollments_order` (`order_id`),
  KEY `idx_course_term_enrollments_owner_status` (`owner_user_id`, `status`, `created_at`, `id`),
  KEY `idx_course_term_enrollments_user` (`user_id`, `created_at`, `id`),
  CONSTRAINT `fk_course_term_enrollments_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_enrollments_term` FOREIGN KEY (`term_id`) REFERENCES `course_terms` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_enrollments_student` FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_enrollments_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_enrollments_order` FOREIGN KEY (`order_id`) REFERENCES `course_orders` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_enrollments_quote` FOREIGN KEY (`quote_id`) REFERENCES `course_term_quotes` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_enrollments_start_session` FOREIGN KEY (`start_session_id`) REFERENCES `course_sessions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_term_session_entitlements` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `enrollment_id` BIGINT UNSIGNED NOT NULL,
  `session_id` BIGINT UNSIGNED NOT NULL,
  `student_id` BIGINT UNSIGNED NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'SCHEDULED',
  `entitlement_kind` VARCHAR(24) NOT NULL DEFAULT 'REGULAR',
  `leave_request_id` BIGINT UNSIGNED DEFAULT NULL,
  `makeup_entitlement_id` BIGINT UNSIGNED DEFAULT NULL,
  `booking_id` BIGINT UNSIGNED DEFAULT NULL,
  `attended_at` DATETIME DEFAULT NULL,
  `resolved_at` DATETIME DEFAULT NULL,
  `resolved_by_user_id` CHAR(36) DEFAULT NULL,
  `resolution_reason` VARCHAR(500) DEFAULT NULL,
  `attendance_idempotency_key` VARCHAR(128) DEFAULT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_term_entitlement_session_kind` (`enrollment_id`, `session_id`, `entitlement_kind`),
  UNIQUE KEY `uq_course_term_entitlement_booking` (`booking_id`),
  KEY `idx_course_term_entitlements_owner_status` (`owner_user_id`, `status`, `session_id`, `id`),
  KEY `idx_course_term_entitlements_session_status` (`session_id`, `status`, `id`),
  CONSTRAINT `fk_course_term_entitlements_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_entitlements_enrollment` FOREIGN KEY (`enrollment_id`) REFERENCES `course_term_enrollments` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_entitlements_session` FOREIGN KEY (`session_id`) REFERENCES `course_sessions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_entitlements_student` FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_entitlements_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_entitlements_resolver` FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_entitlements_booking` FOREIGN KEY (`booking_id`) REFERENCES `course_bookings` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_course_term_entitlement_status` CHECK (`status` IN ('SCHEDULED', 'LEAVE', 'LEAVE_PENDING', 'LEAVE_LOCKED', 'ATTENDED', 'ABSENT', 'CANCELLED')),
  CONSTRAINT `chk_course_term_entitlement_kind` CHECK (`entitlement_kind` IN ('REGULAR', 'MAKEUP'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_term_waitlist_entries` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `term_id` BIGINT UNSIGNED NOT NULL,
  `student_id` BIGINT UNSIGNED NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'WAITING',
  `priority` INT UNSIGNED NOT NULL DEFAULT 100,
  `joined_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cancelled_at` DATETIME DEFAULT NULL,
  `idempotency_key` VARCHAR(128) NOT NULL,
  `active_student_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` IN ('WAITING', 'OFFERED') THEN `student_id` ELSE NULL END
  ) STORED,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_term_waitlist_active_student` (`term_id`, `active_student_id`),
  UNIQUE KEY `uq_course_term_waitlist_user_key` (`user_id`, `idempotency_key`),
  KEY `idx_course_term_waitlist_fifo` (`owner_user_id`, `term_id`, `status`, `priority`, `joined_at`, `id`),
  CONSTRAINT `fk_course_term_waitlist_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_waitlist_term` FOREIGN KEY (`term_id`) REFERENCES `course_terms` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_waitlist_student` FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_waitlist_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `chk_course_term_waitlist_status` CHECK (`status` IN ('WAITING', 'OFFERED', 'ACCEPTED', 'EXPIRED', 'CANCELLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_seat_allocations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `term_id` BIGINT UNSIGNED NOT NULL,
  `student_id` BIGINT UNSIGNED DEFAULT NULL,
  `enrollment_id` BIGINT UNSIGNED DEFAULT NULL,
  `order_id` BIGINT UNSIGNED DEFAULT NULL,
  `quote_id` BIGINT UNSIGNED DEFAULT NULL,
  `waitlist_entry_id` BIGINT UNSIGNED DEFAULT NULL,
  `user_id` CHAR(36) NOT NULL,
  `allocation_type` VARCHAR(32) NOT NULL DEFAULT 'CHECKOUT_HOLD',
  `status` VARCHAR(24) NOT NULL DEFAULT 'HELD',
  `expires_at` DATETIME DEFAULT NULL,
  `released_at` DATETIME DEFAULT NULL,
  `release_reason` VARCHAR(500) DEFAULT NULL,
  `active_student_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` IN ('HELD', 'ACTIVE', 'CONFIRMED') THEN `student_id` ELSE NULL END
  ) STORED,
  `active_order_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` IN ('HELD', 'ACTIVE', 'CONFIRMED') THEN `order_id` ELSE NULL END
  ) STORED,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_seat_active_student` (`term_id`, `active_student_id`),
  UNIQUE KEY `uq_course_seat_active_order` (`active_order_id`),
  KEY `idx_course_seat_capacity` (`owner_user_id`, `term_id`, `status`, `expires_at`, `id`),
  KEY `idx_course_seat_enrollment` (`enrollment_id`, `id`),
  CONSTRAINT `fk_course_seat_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_seat_term` FOREIGN KEY (`term_id`) REFERENCES `course_terms` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_seat_student` FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_seat_enrollment` FOREIGN KEY (`enrollment_id`) REFERENCES `course_term_enrollments` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_seat_order` FOREIGN KEY (`order_id`) REFERENCES `course_orders` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_seat_quote` FOREIGN KEY (`quote_id`) REFERENCES `course_term_quotes` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_seat_waitlist` FOREIGN KEY (`waitlist_entry_id`) REFERENCES `course_term_waitlist_entries` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_seat_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `chk_course_seat_allocation_type` CHECK (`allocation_type` IN ('CHECKOUT_HOLD', 'WAITLIST_OFFER', 'ENROLLMENT', 'RENEWAL', 'MAKEUP_INSURANCE')),
  CONSTRAINT `chk_course_seat_status` CHECK (`status` IN ('HELD', 'ACTIVE', 'CONFIRMED', 'RELEASED', 'EXPIRED', 'CANCELLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_term_seat_offers` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `offer_code` VARCHAR(48) NOT NULL,
  `owner_user_id` CHAR(36) NOT NULL,
  `waitlist_entry_id` BIGINT UNSIGNED NOT NULL,
  `term_id` BIGINT UNSIGNED NOT NULL,
  `student_id` BIGINT UNSIGNED NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `seat_allocation_id` BIGINT UNSIGNED NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'OFFERED',
  `expires_at` DATETIME NOT NULL,
  `accepted_at` DATETIME DEFAULT NULL,
  `active_waitlist_entry_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` = 'OFFERED' THEN `waitlist_entry_id` ELSE NULL END
  ) STORED,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_term_seat_offers_code` (`offer_code`),
  UNIQUE KEY `uq_course_term_seat_offers_active_waitlist` (`active_waitlist_entry_id`),
  UNIQUE KEY `uq_course_term_seat_offers_allocation` (`seat_allocation_id`),
  KEY `idx_course_term_seat_offers_due` (`owner_user_id`, `status`, `expires_at`, `id`),
  CONSTRAINT `fk_course_term_seat_offers_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_seat_offers_waitlist` FOREIGN KEY (`waitlist_entry_id`) REFERENCES `course_term_waitlist_entries` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_seat_offers_term` FOREIGN KEY (`term_id`) REFERENCES `course_terms` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_seat_offers_student` FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_seat_offers_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_seat_offers_allocation` FOREIGN KEY (`seat_allocation_id`) REFERENCES `course_seat_allocations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_course_term_seat_offer_status` CHECK (`status` IN ('OFFERED', 'ACCEPTED', 'EXPIRED', 'CANCELLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_term_leave_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `entitlement_id` BIGINT UNSIGNED NOT NULL,
  `enrollment_id` BIGINT UNSIGNED NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'REQUESTED',
  `requested_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cancel_close_at` DATETIME NOT NULL,
  `reason` VARCHAR(500) DEFAULT NULL,
  `cancelled_at` DATETIME DEFAULT NULL,
  `approved_at` DATETIME DEFAULT NULL,
  `idempotency_key` VARCHAR(128) NOT NULL,
  `cancel_idempotency_key` VARCHAR(128) DEFAULT NULL,
  `locked_at` DATETIME DEFAULT NULL,
  `active_entitlement_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` IN ('REQUESTED', 'APPROVED', 'LOCKED') THEN `entitlement_id` ELSE NULL END
  ) STORED,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_term_leave_active_entitlement` (`active_entitlement_id`),
  UNIQUE KEY `uq_course_term_leave_request_key` (`user_id`, `idempotency_key`),
  KEY `idx_course_term_leave_owner_status_due` (`owner_user_id`, `status`, `cancel_close_at`, `id`),
  CONSTRAINT `fk_course_term_leave_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_term_leave_entitlement` FOREIGN KEY (`entitlement_id`) REFERENCES `course_term_session_entitlements` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_leave_enrollment` FOREIGN KEY (`enrollment_id`) REFERENCES `course_term_enrollments` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_term_leave_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `chk_course_term_leave_status` CHECK (`status` IN ('REQUESTED', 'APPROVED', 'LOCKED', 'CANCELLED', 'REJECTED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_makeup_entitlements` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(48) NOT NULL,
  `owner_user_id` CHAR(36) NOT NULL,
  `source_entitlement_id` BIGINT UNSIGNED NOT NULL,
  `leave_request_id` BIGINT UNSIGNED NOT NULL,
  `enrollment_id` BIGINT UNSIGNED NOT NULL,
  `student_id` BIGINT UNSIGNED NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'AVAILABLE',
  `valid_until` DATETIME NOT NULL,
  `used_booking_id` BIGINT UNSIGNED DEFAULT NULL,
  `requires_insurance` TINYINT(1) NOT NULL DEFAULT 0,
  `revoked_at` DATETIME DEFAULT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_makeup_entitlements_code` (`code`),
  UNIQUE KEY `uq_course_makeup_entitlements_source` (`source_entitlement_id`),
  UNIQUE KEY `uq_course_makeup_entitlements_leave` (`leave_request_id`),
  KEY `idx_course_makeup_entitlements_owner_status` (`owner_user_id`, `status`, `valid_until`, `id`),
  KEY `idx_course_makeup_entitlements_user` (`user_id`, `status`, `valid_until`, `id`),
  CONSTRAINT `fk_course_makeup_entitlements_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_makeup_entitlements_source` FOREIGN KEY (`source_entitlement_id`) REFERENCES `course_term_session_entitlements` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_entitlements_leave` FOREIGN KEY (`leave_request_id`) REFERENCES `course_term_leave_requests` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_entitlements_enrollment` FOREIGN KEY (`enrollment_id`) REFERENCES `course_term_enrollments` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_entitlements_student` FOREIGN KEY (`student_id`) REFERENCES `course_students` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_entitlements_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `chk_course_makeup_entitlement_status` CHECK (`status` IN ('PENDING_INSURANCE', 'AVAILABLE', 'RESERVED', 'BOOKED', 'USED', 'EXPIRED', 'REVOKED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_makeup_routes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `source_term_id` BIGINT UNSIGNED NOT NULL,
  `target_session_id` BIGINT UNSIGNED NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `capacity_override` INT UNSIGNED DEFAULT NULL,
  `booking_open_at` DATETIME DEFAULT NULL,
  `booking_close_at` DATETIME DEFAULT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_makeup_routes_target` (`source_term_id`, `target_session_id`),
  KEY `idx_course_makeup_routes_owner_status` (`owner_user_id`, `status`, `target_session_id`, `id`),
  CONSTRAINT `fk_course_makeup_routes_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_makeup_routes_source_term` FOREIGN KEY (`source_term_id`) REFERENCES `course_terms` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_routes_target_session` FOREIGN KEY (`target_session_id`) REFERENCES `course_sessions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_course_makeup_routes_window` CHECK (`booking_close_at` IS NULL OR `booking_open_at` IS NULL OR `booking_close_at` >= `booking_open_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_makeup_bookings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(48) NOT NULL,
  `owner_user_id` CHAR(36) NOT NULL,
  `makeup_entitlement_id` BIGINT UNSIGNED NOT NULL,
  `session_id` BIGINT UNSIGNED NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `seat_allocation_id` BIGINT UNSIGNED DEFAULT NULL,
  `booking_id` BIGINT UNSIGNED DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'BOOKED',
  `booked_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cancelled_at` DATETIME DEFAULT NULL,
  `attended_at` DATETIME DEFAULT NULL,
  `idempotency_key` VARCHAR(128) NOT NULL,
  `active_entitlement_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` IN ('RESERVED', 'BOOKED') THEN `makeup_entitlement_id` ELSE NULL END
  ) STORED,
  `active_user_id` CHAR(36) GENERATED ALWAYS AS (
    CASE WHEN `status` IN ('RESERVED', 'BOOKED') THEN `user_id` ELSE NULL END
  ) STORED,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_makeup_bookings_code` (`code`),
  UNIQUE KEY `uq_course_makeup_bookings_active_entitlement` (`active_entitlement_id`),
  UNIQUE KEY `uq_course_makeup_bookings_active_session_user` (`session_id`, `active_user_id`),
  UNIQUE KEY `uq_course_makeup_bookings_seat` (`seat_allocation_id`),
  UNIQUE KEY `uq_course_makeup_bookings_booking` (`booking_id`),
  KEY `idx_course_makeup_bookings_owner_status` (`owner_user_id`, `status`, `session_id`, `id`),
  CONSTRAINT `fk_course_makeup_bookings_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_makeup_bookings_entitlement` FOREIGN KEY (`makeup_entitlement_id`) REFERENCES `course_makeup_entitlements` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_bookings_session` FOREIGN KEY (`session_id`) REFERENCES `course_sessions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_bookings_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_bookings_seat` FOREIGN KEY (`seat_allocation_id`) REFERENCES `course_seat_allocations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_bookings_booking` FOREIGN KEY (`booking_id`) REFERENCES `course_bookings` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_course_makeup_booking_status` CHECK (`status` IN ('RESERVED', 'BOOKED', 'CANCELLED', 'ATTENDED', 'NO_SHOW'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cyclic business references are added after both sides exist. Restrictive
-- deletes preserve the entitlement/leave audit chain.
CALL `course_052_add_foreign_key`('course_term_session_entitlements', 'fk_course_term_entitlements_leave', 'FOREIGN KEY (`leave_request_id`) REFERENCES `course_term_leave_requests` (`id`) ON DELETE RESTRICT');
CALL `course_052_add_foreign_key`('course_term_session_entitlements', 'fk_course_term_entitlements_makeup', 'FOREIGN KEY (`makeup_entitlement_id`) REFERENCES `course_makeup_entitlements` (`id`) ON DELETE RESTRICT');
CALL `course_052_add_foreign_key`('course_makeup_entitlements', 'fk_course_makeup_entitlements_used_booking', 'FOREIGN KEY (`used_booking_id`) REFERENCES `course_makeup_bookings` (`id`) ON DELETE RESTRICT');

CALL `course_052_add_column`('course_settings', 'fixed_term_enabled', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `count_card_parity_enabled`');

DROP PROCEDURE IF EXISTS `course_052_add_column`;
DROP PROCEDURE IF EXISTS `course_052_add_foreign_key`;
DROP PROCEDURE IF EXISTS `course_052_add_index`;

INSERT IGNORE INTO `course_schema_versions` (`version`, `description`)
VALUES ('052_course_fixed_term_productization', 'Fixed-term programs, enrollment, capacity, per-session rights, leave and makeup');

SELECT 'Migration 052_course_fixed_term_productization applied' AS msg;
-- COURSE_PRODUCTIZATION_052_END
-- COURSE_PRODUCTIZATION_053_BEGIN
-- Migration 053: fixed-term payments, count-card payment instruments,
-- open-water makeup insurance and durable notifications.
--
-- Payment confirmation services must consume instruments, fulfill orders,
-- confirm seats and materialize fixed-term rights in one DB transaction. The
-- outbox is written in that transaction; delivery happens only after commit.

CREATE TABLE IF NOT EXISTS `course_schema_versions` (
  `version` VARCHAR(80) NOT NULL,
  `description` VARCHAR(255) NOT NULL,
  `applied_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM `course_schema_versions`
 WHERE `version` = '053_course_term_payments_notifications';

DROP PROCEDURE IF EXISTS `course_053_add_column`;
DELIMITER $$
CREATE PROCEDURE `course_053_add_column`(
  IN p_table_name VARCHAR(64),
  IN p_column_name VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND COLUMN_NAME = p_column_name
  ) THEN
    SET @course_053_column_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD COLUMN `', REPLACE(p_column_name, '`', '``'), '` ', p_definition
    );
    PREPARE course_053_column_stmt FROM @course_053_column_sql;
    EXECUTE course_053_column_stmt;
    DEALLOCATE PREPARE course_053_column_stmt;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `course_053_make_nullable`;
DELIMITER $$
CREATE PROCEDURE `course_053_make_nullable`(
  IN p_table_name VARCHAR(64),
  IN p_column_name VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND COLUMN_NAME = p_column_name
       AND IS_NULLABLE = 'NO'
  ) THEN
    SET @course_053_nullable_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` MODIFY COLUMN `', REPLACE(p_column_name, '`', '``'), '` ', p_definition
    );
    PREPARE course_053_nullable_stmt FROM @course_053_nullable_sql;
    EXECUTE course_053_nullable_stmt;
    DEALLOCATE PREPARE course_053_nullable_stmt;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `course_053_add_index`;
DELIMITER $$
CREATE PROCEDURE `course_053_add_index`(
  IN p_table_name VARCHAR(64),
  IN p_index_name VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND INDEX_NAME = p_index_name
  ) THEN
    SET @course_053_index_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'), '` ADD ', p_definition
    );
    PREPARE course_053_index_stmt FROM @course_053_index_sql;
    EXECUTE course_053_index_stmt;
    DEALLOCATE PREPARE course_053_index_stmt;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `course_053_add_check`;
DELIMITER $$
CREATE PROCEDURE `course_053_add_check`(
  IN p_table_name VARCHAR(64),
  IN p_constraint_name VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND CONSTRAINT_NAME = p_constraint_name
  ) THEN
    SET @course_053_check_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD CONSTRAINT `', REPLACE(p_constraint_name, '`', '``'),
      '` CHECK (', p_definition, ')'
    );
    PREPARE course_053_check_stmt FROM @course_053_check_sql;
    EXECUTE course_053_check_stmt;
    DEALLOCATE PREPARE course_053_check_stmt;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `course_053_drop_check`;
DELIMITER $$
CREATE PROCEDURE `course_053_drop_check`(
  IN p_table_name VARCHAR(64),
  IN p_constraint_name VARCHAR(64)
)
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND CONSTRAINT_NAME = p_constraint_name
       AND CONSTRAINT_TYPE = 'CHECK'
  ) THEN
    SET @course_053_drop_check_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` DROP CHECK `', REPLACE(p_constraint_name, '`', '``'), '`'
    );
    PREPARE course_053_drop_check_stmt FROM @course_053_drop_check_sql;
    EXECUTE course_053_drop_check_stmt;
    DEALLOCATE PREPARE course_053_drop_check_stmt;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `course_053_add_foreign_key`;
DELIMITER $$
CREATE PROCEDURE `course_053_add_foreign_key`(
  IN p_table_name VARCHAR(64),
  IN p_constraint_name VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table_name
       AND CONSTRAINT_NAME = p_constraint_name
  ) THEN
    SET @course_053_fk_sql = CONCAT(
      'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
      '` ADD CONSTRAINT `', REPLACE(p_constraint_name, '`', '``'), '` ', p_definition
    );
    PREPARE course_053_fk_stmt FROM @course_053_fk_sql;
    EXECUTE course_053_fk_stmt;
    DEALLOCATE PREPARE course_053_fk_stmt;
  END IF;
END$$
DELIMITER ;

-- Existing count-pass orders default to count_pass/bank_transfer. Fixed-term
-- orders may have no ShopProduct and are linked to a term/quote/enrollment.
CALL `course_053_add_column`('course_orders', 'owner_user_id', 'CHAR(36) NULL AFTER `checkout_batch_id`');
CALL `course_053_add_column`('course_orders', 'term_id', 'BIGINT UNSIGNED NULL AFTER `product_id`');
CALL `course_053_add_column`('course_orders', 'enrollment_id', 'BIGINT UNSIGNED NULL AFTER `term_id`');
CALL `course_053_add_column`('course_orders', 'quote_id', 'BIGINT UNSIGNED NULL AFTER `enrollment_id`');
CALL `course_053_add_column`('course_orders', 'order_purpose', 'VARCHAR(32) NOT NULL DEFAULT ''COUNT_PASS'' AFTER `quote_id`');
CALL `course_053_add_column`('course_orders', 'payment_method', 'VARCHAR(32) NOT NULL DEFAULT ''BANK_TRANSFER'' AFTER `order_purpose`');
CALL `course_053_add_column`('course_orders', 'currency', 'CHAR(3) NOT NULL DEFAULT ''TWD'' AFTER `total_amount`');
CALL `course_053_add_column`('course_orders', 'pay_by_at', 'DATETIME NULL AFTER `remittance_last5`');
CALL `course_053_add_column`('course_orders', 'cancelled_at', 'DATETIME NULL AFTER `pay_by_at`');
CALL `course_053_add_column`('course_orders', 'cancel_reason', 'VARCHAR(500) NULL AFTER `cancelled_at`');
CALL `course_053_make_nullable`('course_orders', 'user_id', 'CHAR(36) NULL');
CALL `course_053_make_nullable`('course_orders', 'product_id', 'INT UNSIGNED NULL');

UPDATE `course_orders` o
LEFT JOIN `course_products` p ON p.`id` = o.`product_id`
   SET o.`owner_user_id` = COALESCE(o.`owner_user_id`, p.`owner_user_id`)
 WHERE o.`id` >= 1
   AND o.`owner_user_id` IS NULL;

CALL `course_053_add_check`('course_orders', 'chk_course_orders_purpose', '`order_purpose` IN (''COUNT_PASS'', ''TERM_ENROLLMENT'', ''MAKEUP_INSURANCE'')');
-- Existing installations may already have the pre-053 BANK_TRANSFER/
-- COURSE_TICKET check. Recreate it so zero-payable trial discounts can fulfill
-- atomically with the explicit NONE method on both upgrade and fresh paths.
CALL `course_053_drop_check`('course_orders', 'chk_course_orders_payment_method');
CALL `course_053_add_check`('course_orders', 'chk_course_orders_payment_method', '`payment_method` IN (''BANK_TRANSFER'', ''COURSE_TICKET'', ''NONE'')');
CALL `course_053_add_index`('course_orders', 'idx_course_orders_owner_purpose', 'KEY `idx_course_orders_owner_purpose` (`owner_user_id`, `order_purpose`, `created_at`, `id`)');
CALL `course_053_add_index`('course_orders', 'idx_course_orders_payment_due', 'KEY `idx_course_orders_payment_due` (`payment_status`, `pay_by_at`, `id`)');
CALL `course_053_add_index`('course_orders', 'uq_course_orders_enrollment', 'UNIQUE KEY `uq_course_orders_enrollment` (`enrollment_id`)');
CALL `course_053_add_index`('course_orders', 'uq_course_orders_quote', 'UNIQUE KEY `uq_course_orders_quote` (`quote_id`)');
CALL `course_053_add_foreign_key`('course_orders', 'fk_course_orders_owner', 'FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE');
CALL `course_053_add_foreign_key`('course_orders', 'fk_course_orders_term', 'FOREIGN KEY (`term_id`) REFERENCES `course_terms` (`id`) ON DELETE RESTRICT');
CALL `course_053_add_foreign_key`('course_orders', 'fk_course_orders_enrollment', 'FOREIGN KEY (`enrollment_id`) REFERENCES `course_term_enrollments` (`id`) ON DELETE RESTRICT');
CALL `course_053_add_foreign_key`('course_orders', 'fk_course_orders_quote', 'FOREIGN KEY (`quote_id`) REFERENCES `course_term_quotes` (`id`) ON DELETE RESTRICT');

CREATE TABLE IF NOT EXISTS `course_payment_submissions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `order_id` BIGINT UNSIGNED NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `last5` CHAR(5) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'REVIEWING',
  `idempotency_key` VARCHAR(128) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `submitted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reviewed_by` CHAR(36) DEFAULT NULL,
  `reviewed_at` DATETIME DEFAULT NULL,
  `reason` VARCHAR(500) DEFAULT NULL,
  `active_order_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` IN ('SUBMITTED', 'REVIEWING') THEN `order_id` ELSE NULL END
  ) STORED,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_payment_submission_active_order` (`active_order_id`),
  UNIQUE KEY `uq_course_payment_submission_user_key` (`user_id`, `idempotency_key`),
  KEY `idx_course_payment_submission_review` (`owner_user_id`, `status`, `submitted_at`, `id`),
  KEY `idx_course_payment_submission_user` (`user_id`, `submitted_at`, `id`),
  CONSTRAINT `fk_course_payment_submission_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_payment_submission_order` FOREIGN KEY (`order_id`) REFERENCES `course_orders` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_payment_submission_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_payment_submission_reviewer` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `chk_course_payment_submission_status` CHECK (`status` IN ('SUBMITTED', 'REVIEWING', 'CONFIRMED', 'REJECTED', 'CANCELLED')),
  CONSTRAINT `chk_course_payment_submission_last5` CHECK (CHAR_LENGTH(`last5`) = 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_order_payment_instruments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `order_id` BIGINT UNSIGNED NOT NULL,
  `enrollment_id` BIGINT UNSIGNED DEFAULT NULL,
  `instrument_type` VARCHAR(32) NOT NULL,
  `course_ticket_id` BIGINT UNSIGNED NOT NULL,
  `hold_id` BIGINT UNSIGNED DEFAULT NULL,
  `units_applied` INT UNSIGNED NOT NULL,
  `amount_applied` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `currency` CHAR(3) NOT NULL DEFAULT 'TWD',
  `status` VARCHAR(24) NOT NULL DEFAULT 'RESERVED',
  `idempotency_key` VARCHAR(128) NOT NULL,
  `usage_event_id` BIGINT UNSIGNED DEFAULT NULL,
  `reversed_usage_event_id` BIGINT UNSIGNED DEFAULT NULL,
  `policy_snapshot_json` JSON NOT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_order_instrument_type` (`order_id`, `instrument_type`),
  UNIQUE KEY `uq_course_order_instrument_user_key` (`order_id`, `idempotency_key`),
  UNIQUE KEY `uq_course_order_instrument_hold` (`hold_id`),
  UNIQUE KEY `uq_course_order_instrument_usage` (`usage_event_id`),
  KEY `idx_course_order_instrument_ticket_status` (`course_ticket_id`, `status`, `id`),
  CONSTRAINT `fk_course_order_instrument_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_order_instrument_order` FOREIGN KEY (`order_id`) REFERENCES `course_orders` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_order_instrument_enrollment` FOREIGN KEY (`enrollment_id`) REFERENCES `course_term_enrollments` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_order_instrument_ticket` FOREIGN KEY (`course_ticket_id`) REFERENCES `course_tickets` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_order_instrument_hold` FOREIGN KEY (`hold_id`) REFERENCES `course_ticket_holds` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_order_instrument_usage` FOREIGN KEY (`usage_event_id`) REFERENCES `course_usage_events` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_order_instrument_reversal` FOREIGN KEY (`reversed_usage_event_id`) REFERENCES `course_usage_events` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_course_order_instrument_type` CHECK (`instrument_type` IN ('TRIAL_DISCOUNT', 'COURSE_TICKET')),
  CONSTRAINT `chk_course_order_instrument_status` CHECK (`status` IN ('RESERVED', 'CONSUMED', 'RELEASED', 'REVERSED')),
  CONSTRAINT `chk_course_order_instrument_uses` CHECK (`units_applied` >= 0),
  CONSTRAINT `chk_course_order_instrument_amount` CHECK (`amount_applied` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_order_discounts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `order_id` BIGINT UNSIGNED NOT NULL,
  `payment_instrument_id` BIGINT UNSIGNED NOT NULL,
  `discount_type` VARCHAR(32) NOT NULL DEFAULT 'trial_discount',
  `amount` DECIMAL(10,2) NOT NULL,
  `currency` CHAR(3) NOT NULL DEFAULT 'TWD',
  `status` VARCHAR(24) NOT NULL DEFAULT 'reserved',
  `discount_snapshot_json` JSON NOT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_order_discount_instrument` (`payment_instrument_id`),
  UNIQUE KEY `uq_course_order_discount_type` (`order_id`, `discount_type`),
  KEY `idx_course_order_discounts_owner` (`owner_user_id`, `status`, `created_at`, `id`),
  CONSTRAINT `fk_course_order_discounts_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_order_discounts_order` FOREIGN KEY (`order_id`) REFERENCES `course_orders` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_order_discounts_instrument` FOREIGN KEY (`payment_instrument_id`) REFERENCES `course_order_payment_instruments` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_course_order_discount_amount` CHECK (`amount` >= 0),
  CONSTRAINT `chk_course_order_discount_status` CHECK (`status` IN ('reserved', 'applied', 'released', 'reversed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_makeup_insurance_policies` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `target_session_id` BIGINT UNSIGNED NOT NULL,
  `fee_product_id` INT UNSIGNED DEFAULT NULL,
  `required` TINYINT(1) NOT NULL DEFAULT 1,
  `fee_amount` DECIMAL(10,2) NOT NULL,
  `currency` CHAR(3) NOT NULL DEFAULT 'TWD',
  `payment_hold_minutes` INT UNSIGNED NOT NULL DEFAULT 1440,
  `cancel_close_at` DATETIME DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `active_session_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` = 'active' THEN `target_session_id` ELSE NULL END
  ) STORED,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_makeup_insurance_active_session` (`active_session_id`),
  KEY `idx_course_makeup_insurance_owner_status` (`owner_user_id`, `status`, `target_session_id`, `id`),
  CONSTRAINT `fk_course_makeup_insurance_policy_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_makeup_insurance_policy_session` FOREIGN KEY (`target_session_id`) REFERENCES `course_sessions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_insurance_policy_product` FOREIGN KEY (`fee_product_id`) REFERENCES `course_products` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_course_makeup_insurance_fee` CHECK (`fee_amount` >= 0),
  CONSTRAINT `chk_course_makeup_insurance_hold` CHECK (`payment_hold_minutes` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_makeup_insurance_coverages` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(48) NOT NULL,
  `owner_user_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `policy_id` BIGINT UNSIGNED NOT NULL,
  `makeup_entitlement_id` BIGINT UNSIGNED NOT NULL,
  `makeup_booking_id` BIGINT UNSIGNED DEFAULT NULL,
  `seat_allocation_id` BIGINT UNSIGNED NOT NULL,
  `order_id` BIGINT UNSIGNED DEFAULT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending_payment',
  `idempotency_key` VARCHAR(128) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `fee_snapshot_json` JSON NOT NULL,
  `pay_by_at` DATETIME NOT NULL,
  `effective_at` DATETIME DEFAULT NULL,
  `cancelled_at` DATETIME DEFAULT NULL,
  `refunded_at` DATETIME DEFAULT NULL,
  `active_entitlement_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` IN ('pending_payment', 'reviewing', 'active') THEN `makeup_entitlement_id` ELSE NULL END
  ) STORED,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_makeup_insurance_coverages_code` (`code`),
  UNIQUE KEY `uq_course_makeup_insurance_user_key` (`user_id`, `idempotency_key`),
  UNIQUE KEY `uq_course_makeup_insurance_active_entitlement` (`active_entitlement_id`),
  UNIQUE KEY `uq_course_makeup_insurance_booking` (`makeup_booking_id`),
  UNIQUE KEY `uq_course_makeup_insurance_seat` (`seat_allocation_id`),
  UNIQUE KEY `uq_course_makeup_insurance_order` (`order_id`),
  KEY `idx_course_makeup_insurance_due` (`owner_user_id`, `status`, `pay_by_at`, `id`),
  CONSTRAINT `fk_course_makeup_insurance_coverage_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_makeup_insurance_coverage_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_makeup_insurance_coverage_policy` FOREIGN KEY (`policy_id`) REFERENCES `course_makeup_insurance_policies` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_insurance_coverage_entitlement` FOREIGN KEY (`makeup_entitlement_id`) REFERENCES `course_makeup_entitlements` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_insurance_coverage_booking` FOREIGN KEY (`makeup_booking_id`) REFERENCES `course_makeup_bookings` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_insurance_coverage_seat` FOREIGN KEY (`seat_allocation_id`) REFERENCES `course_seat_allocations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_course_makeup_insurance_coverage_order` FOREIGN KEY (`order_id`) REFERENCES `course_orders` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_course_makeup_insurance_coverage_status` CHECK (`status` IN ('pending_payment', 'reviewing', 'active', 'cancelled', 'expired', 'refunded'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A makeup-insurance hold is scoped to the target session, not to the fixed
-- term's enrollment capacity. Nullable guarded columns keep partially applied
-- 053 databases rerunnable while all new runtime writes provide the values.
CALL `course_053_add_column`('course_seat_allocations', 'session_id', 'BIGINT UNSIGNED NULL AFTER `term_id`');
CALL `course_053_add_index`('course_seat_allocations', 'idx_course_seat_session_capacity', 'KEY `idx_course_seat_session_capacity` (`owner_user_id`, `session_id`, `allocation_type`, `status`, `expires_at`, `id`)');
CALL `course_053_add_foreign_key`('course_seat_allocations', 'fk_course_seat_session', 'FOREIGN KEY (`session_id`) REFERENCES `course_sessions` (`id`) ON DELETE RESTRICT');
CALL `course_053_add_column`('course_makeup_insurance_coverages', 'user_id', 'CHAR(36) NULL AFTER `owner_user_id`');
CALL `course_053_add_column`('course_makeup_insurance_coverages', 'idempotency_key', 'VARCHAR(128) NULL AFTER `status`');
CALL `course_053_add_column`('course_makeup_insurance_coverages', 'request_hash', 'CHAR(64) NULL AFTER `idempotency_key`');
CALL `course_053_add_index`('course_makeup_insurance_coverages', 'uq_course_makeup_insurance_user_key', 'UNIQUE KEY `uq_course_makeup_insurance_user_key` (`user_id`, `idempotency_key`)');
CALL `course_053_add_foreign_key`('course_makeup_insurance_coverages', 'fk_course_makeup_insurance_coverage_user', 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE');

CALL `course_053_add_column`('course_orders', 'insurance_coverage_id', 'BIGINT UNSIGNED NULL AFTER `quote_id`');
CALL `course_053_add_index`('course_orders', 'uq_course_orders_insurance_coverage', 'UNIQUE KEY `uq_course_orders_insurance_coverage` (`insurance_coverage_id`)');
CALL `course_053_add_foreign_key`('course_orders', 'fk_course_orders_insurance_coverage', 'FOREIGN KEY (`insurance_coverage_id`) REFERENCES `course_makeup_insurance_coverages` (`id`) ON DELETE RESTRICT');

CREATE TABLE IF NOT EXISTS `course_user_notifications` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `event_type` VARCHAR(64) NOT NULL,
  `dedupe_key` VARCHAR(191) NOT NULL,
  `entity_type` VARCHAR(64) DEFAULT NULL,
  `entity_id` VARCHAR(128) DEFAULT NULL,
  `title` VARCHAR(255) NOT NULL,
  `body` TEXT NOT NULL,
  `action_url` VARCHAR(1000) DEFAULT NULL,
  `payload_json` JSON DEFAULT NULL,
  `read_at` DATETIME DEFAULT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_user_notifications_dedupe` (`dedupe_key`),
  KEY `idx_course_user_notifications_inbox` (`user_id`, `read_at`, `created_at`, `id`),
  KEY `idx_course_user_notifications_owner_event` (`owner_user_id`, `event_type`, `created_at`, `id`),
  CONSTRAINT `fk_course_user_notifications_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_user_notifications_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_notification_outbox` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` CHAR(36) DEFAULT NULL,
  `user_id` CHAR(36) DEFAULT NULL,
  `event_type` VARCHAR(64) NOT NULL,
  `dedupe_key` VARCHAR(191) NOT NULL,
  `payload_json` JSON NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  `attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `available_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `locked_at` DATETIME DEFAULT NULL,
  `sent_at` DATETIME DEFAULT NULL,
  `last_error` TEXT DEFAULT NULL,
  `row_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_notification_outbox_dedupe` (`dedupe_key`),
  KEY `idx_course_notification_outbox_due` (`status`, `available_at`, `id`),
  KEY `idx_course_notification_outbox_owner_event` (`owner_user_id`, `event_type`, `created_at`, `id`),
  CONSTRAINT `fk_course_notification_outbox_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_course_notification_outbox_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `chk_course_notification_outbox_status` CHECK (`status` IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'DEAD'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL `course_053_add_column`('course_settings', 'advanced_payments_enabled', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `fixed_term_enabled`');

DROP PROCEDURE IF EXISTS `course_053_add_column`;
DROP PROCEDURE IF EXISTS `course_053_make_nullable`;
DROP PROCEDURE IF EXISTS `course_053_add_index`;
DROP PROCEDURE IF EXISTS `course_053_add_check`;
DROP PROCEDURE IF EXISTS `course_053_drop_check`;
DROP PROCEDURE IF EXISTS `course_053_add_foreign_key`;

INSERT IGNORE INTO `course_schema_versions` (`version`, `description`)
VALUES ('053_course_term_payments_notifications', 'Fixed-term remittance, course-ticket instruments, makeup insurance and durable notifications');

SELECT 'Migration 053_course_term_payments_notifications applied' AS msg;
-- COURSE_PRODUCTIZATION_053_END
