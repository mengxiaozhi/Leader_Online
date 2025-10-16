-- Migration 002: Add event_stores for per-event store scheduling and pricing
USE leader_online;

CREATE TABLE IF NOT EXISTS event_stores (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id INT UNSIGNED NOT NULL,
  name VARCHAR(255) NOT NULL,
  pre_start DATE NULL,
  pre_end DATE NULL,
  post_start DATE NULL,
  post_end DATE NULL,
  prices JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_event_stores_event (event_id),
  CONSTRAINT fk_event_stores_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Migration 002_event_stores applied' AS msg;

