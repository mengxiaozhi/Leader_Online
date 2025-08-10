CREATE DATABASE IF NOT EXISTS leader_online;
USE leader_online;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL
);

INSERT INTO products (name, description, price) VALUES
('小鐵人', '適合5~8歲', 300),
('大鐵人', '適合9~12歲', 500),
('滑步車', '適合3~6歲', 200);

CREATE TABLE IF NOT EXISTS events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50),
  name VARCHAR(255) NOT NULL,
  date VARCHAR(255) NOT NULL,
  deadline VARCHAR(255) NOT NULL,
  description TEXT,
  rules TEXT
);

INSERT INTO events (code, name, date, deadline, description, rules) VALUES
('24200032', '2025 大鵬灣單車託運券', '2025/12/05 ~ 12/07', '2025/11/28', '本票券主要為提供賽事單車託運服務之憑證，登記購買後，我們將在賽事期間提供專業單車運送。', JSON_ARRAY('17 噸卡車運送，車體置於封閉空間', '專業龍車固定，專屬存放空間', '依法規投保貨物險，完整交付檢核', '裸車不予交寄，請妥善包覆車體')),
('E2', '親子滑步趣跑賽', '2025-09-01', '2025-08-25', '', JSON_ARRAY('適合 3-8 歲兒童', '含安全檢查與托運保險'));

CREATE TABLE IF NOT EXISTS tickets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type VARCHAR(50) NOT NULL,
  expiry DATE NOT NULL,
  uuid VARCHAR(64) NOT NULL,
  discount INT DEFAULT 0,
  used BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

INSERT INTO tickets (user_id, type, expiry, uuid, discount, used) VALUES
(1, '小鐵人', '2025-12-31', 'a1', 100, FALSE),
(1, '大鐵人', '2025-08-01', 'b2', 150, FALSE),
(1, '滑步車', '2025-10-15', 'c3', 0, TRUE),
(1, 'VIP票', '2026-01-01', 'd4', 200, FALSE);

CREATE TABLE IF NOT EXISTS reservations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  ticket_type VARCHAR(50) NOT NULL,
  store VARCHAR(100) NOT NULL,
  event VARCHAR(100) NOT NULL,
  reserved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verify_code VARCHAR(10),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  FOREIGN KEY (user_id) REFERENCES users(id)
);