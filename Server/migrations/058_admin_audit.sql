-- Install with: node scripts/install-audit.js (also installs row triggers).
-- Deliberately no foreign keys to business/user tables: history survives deletion.
CREATE TABLE IF NOT EXISTS admin_audit_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id CHAR(36) NOT NULL,
  actor_id CHAR(36) NULL,
  actor_name VARCHAR(255) NULL,
  actor_role VARCHAR(32) NULL,
  module VARCHAR(64) NOT NULL,
  action VARCHAR(255) NOT NULL,
  method VARCHAR(8) NOT NULL,
  route VARCHAR(255) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  http_status SMALLINT NULL,
  error_code VARCHAR(100) NULL,
  source_ip VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  UNIQUE KEY uq_audit_request (request_id),
  KEY idx_audit_time (created_at,id),
  KEY idx_audit_actor (actor_id,id),
  KEY idx_audit_filter (module,status,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS admin_audit_changes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT UNSIGNED NOT NULL,
  resource_table VARCHAR(64) NOT NULL,
  resource_id VARCHAR(255) NOT NULL,
  operation VARCHAR(16) NOT NULL,
  error_code VARCHAR(100) NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  changed_fields JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_audit_change_request (request_id,id),
  KEY idx_audit_resource (resource_table,resource_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS admin_audit_scopes (
  change_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  request_id BIGINT UNSIGNED NOT NULL,
  before_scope JSON NULL,
  after_scope JSON NULL,
  KEY idx_audit_scope_request (request_id,change_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS admin_audit_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(32) NOT NULL,
  payload MEDIUMTEXT NULL,
  started_at DATETIME(3) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  error_code VARCHAR(100) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  KEY idx_audit_job_pending (status,id),
  KEY idx_audit_job_request (request_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
