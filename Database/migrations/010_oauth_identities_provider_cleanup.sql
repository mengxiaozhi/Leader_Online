-- Leader Online - Migration: normalize oauth_identities.provider (trim + lower)
-- Idempotent: safe to run multiple times

-- 1) Remove duplicates that would conflict after normalization
--    Keep the smallest id per (normalized provider, subject)
DELETE oi FROM oauth_identities oi
JOIN (
  SELECT LOWER(TRIM(provider)) AS provider, subject, MIN(id) AS keep_id
  FROM oauth_identities
  GROUP BY LOWER(TRIM(provider)), subject
) k ON LOWER(TRIM(oi.provider)) = k.provider AND oi.subject = k.subject
WHERE oi.id > 0 AND oi.id <> k.keep_id;

-- 2) Normalize provider column in-place
UPDATE oauth_identities
SET provider = LOWER(TRIM(provider))
WHERE id > 0 AND provider <> LOWER(TRIM(provider));

-- 3) Optional: remove rows with empty provider after trim (defensive)
DELETE FROM oauth_identities WHERE id > 0 AND provider = '';

SELECT 'Migration 010_oauth_identities_provider_cleanup applied' AS msg;
