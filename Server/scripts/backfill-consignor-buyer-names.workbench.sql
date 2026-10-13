-- MySQL 8 Workbench preparation. Only temporary tables are created here.
-- Export the final result grid before executing the apply section separately.
CREATE TEMPORARY TABLE codex_consignor_orders_20261013_v3 AS
SELECT o.id, o.row_version,
  JSON_CONTAINS_PATH(o.details, 'one', '$.consignorName') AS before_present,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(o.details, '$.consignorName')) = 'STRING'
    THEN JSON_UNQUOTE(JSON_EXTRACT(o.details, '$.consignorName')) ELSE NULL END AS before_value,
  (JSON_TYPE(JSON_EXTRACT(o.details, '$.consignorName')) IS NULL
    OR JSON_TYPE(JSON_EXTRACT(o.details, '$.consignorName')) = 'NULL'
    OR (JSON_TYPE(JSON_EXTRACT(o.details, '$.consignorName')) = 'STRING'
      AND TRIM(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(o.details, '$.consignorName')), '[[:space:]]+', ' ')) = '')) AS missing_name,
  (JSON_UNQUOTE(JSON_EXTRACT(o.details, '$.kind')) = 'event-reservation'
    OR (JSON_TYPE(JSON_EXTRACT(o.details, '$.selections')) = 'ARRAY'
      AND JSON_LENGTH(JSON_EXTRACT(o.details, '$.selections')) > 0)) AS is_shipment,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(o.details, '$.consignorName')) = 'STRING'
    THEN NULLIF(TRIM(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(o.details, '$.consignorName')), '[[:space:]]+', ' ')), '') END AS current_consignor,
  COALESCE(
    CASE WHEN JSON_TYPE(JSON_EXTRACT(o.details, '$.contactSnapshot.username')) = 'STRING'
      THEN NULLIF(TRIM(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(o.details, '$.contactSnapshot.username')), '[[:space:]]+', ' ')), '') END,
    CASE WHEN JSON_TYPE(JSON_EXTRACT(o.details, '$.contact_snapshot.username')) = 'STRING'
      THEN NULLIF(TRIM(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(o.details, '$.contact_snapshot.username')), '[[:space:]]+', ' ')), '') END,
    NULLIF(TRIM(REGEXP_REPLACE(u.username, '[[:space:]]+', ' ')), '')) AS buyer_name,
  SHA2(CONCAT_WS('|', o.user_id, COALESCE(o.code,''), o.payment_status, o.fulfillment_status,
    CAST(JSON_REMOVE(COALESCE(o.details, JSON_OBJECT()), '$.consignorName', '$.rowVersion') AS CHAR)),256) AS business_hash
FROM leader_online.orders o LEFT JOIN leader_online.users u ON u.id=o.user_id;

CREATE TEMPORARY TABLE codex_consignor_plan_20261013_v3 AS
SELECT CAST('order' AS CHAR(16)) AS record_kind, id AS record_id, before_present, before_value,
  buyer_name AS proposed_name, row_version, business_hash
FROM codex_consignor_orders_20261013_v3
WHERE is_shipment=1 AND missing_name=1 AND CHAR_LENGTH(buyer_name) BETWEEN 1 AND 50;
INSERT INTO codex_consignor_plan_20261013_v3
SELECT 'reservation', q.id, 1, q.before_value, q.proposed_name, 0, q.business_hash
FROM (
  SELECT r.id, r.consignor_name AS before_value,
    CASE WHEN o.id IS NOT NULL THEN COALESCE(o.current_consignor, o.buyer_name)
      ELSE NULLIF(TRIM(REGEXP_REPLACE(buyer.username, '[[:space:]]+', ' ')), '') END AS proposed_name,
    SHA2(CONCAT_WS('|',r.user_id,COALESCE(r.order_id,0),r.ticket_type,r.store,r.event,r.status,
      COALESCE(r.verify_code,''),COALESCE(r.verify_code_pre_dropoff,''),COALESCE(r.verify_code_pre_pickup,''),
      COALESCE(r.verify_code_post_dropoff,''),COALESCE(r.verify_code_post_pickup,''),
      COALESCE(CAST(r.pre_dropoff_checklist AS CHAR),''),COALESCE(CAST(r.pre_pickup_checklist AS CHAR),''),
      COALESCE(CAST(r.post_dropoff_checklist AS CHAR),''),COALESCE(CAST(r.post_pickup_checklist AS CHAR),'')),256) AS business_hash
  FROM leader_online.reservations r
  LEFT JOIN codex_consignor_orders_20261013_v3 o ON o.id=r.order_id
  LEFT JOIN leader_online.reservation_transfers original_transfer ON original_transfer.id=(
    SELECT MIN(t.id) FROM leader_online.reservation_transfers t WHERE t.reservation_id=r.id AND t.status='accepted')
  LEFT JOIN leader_online.users buyer ON buyer.id=COALESCE(original_transfer.from_user_id,r.user_id)
  WHERE r.consignor_name IS NULL OR TRIM(REGEXP_REPLACE(r.consignor_name, '[[:space:]]+', ' '))=''
) q WHERE CHAR_LENGTH(q.proposed_name) BETWEEN 1 AND 50;

SELECT record_kind, COUNT(*) AS to_fill, MAX(CHAR_LENGTH(proposed_name)) AS max_name_length
FROM codex_consignor_plan_20261013_v3 GROUP BY record_kind;
SELECT record_kind, record_id, before_present, before_value, proposed_name, row_version, business_hash
FROM codex_consignor_plan_20261013_v3 ORDER BY record_kind,record_id;
