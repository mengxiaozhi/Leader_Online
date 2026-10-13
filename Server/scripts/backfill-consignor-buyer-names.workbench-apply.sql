-- MySQL 8, same Workbench connection as the preparation step.
-- Export and verify the preparation backup first. Do not commit until all
-- returned mismatch counts are zero and update counts match planned counts.
START TRANSACTION;
UPDATE leader_online.orders o
JOIN codex_consignor_plan_20261013_v3 p ON p.record_kind='order' AND p.record_id=o.id
SET o.details=JSON_SET(o.details,'$.consignorName',p.proposed_name,'$.rowVersion',p.row_version+1),
  o.row_version=p.row_version+1,o.updated_at=CURRENT_TIMESTAMP
WHERE o.row_version=p.row_version
  AND SHA2(CONCAT_WS('|',o.user_id,COALESCE(o.code,''),o.payment_status,o.fulfillment_status,
    CAST(JSON_REMOVE(COALESCE(o.details,JSON_OBJECT()),'$.consignorName','$.rowVersion') AS CHAR)),256)=p.business_hash
  AND (JSON_TYPE(JSON_EXTRACT(o.details,'$.consignorName')) IS NULL
    OR JSON_TYPE(JSON_EXTRACT(o.details,'$.consignorName'))='NULL'
    OR (JSON_TYPE(JSON_EXTRACT(o.details,'$.consignorName'))='STRING'
      AND TRIM(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(o.details,'$.consignorName')),'[[:space:]]+',' '))=''));
SET @consignor_orders_filled=ROW_COUNT();
UPDATE leader_online.reservations r
JOIN codex_consignor_plan_20261013_v3 p ON p.record_kind='reservation' AND p.record_id=r.id
SET r.consignor_name=p.proposed_name
WHERE r.consignor_name <=> p.before_value
  AND SHA2(CONCAT_WS('|',r.user_id,COALESCE(r.order_id,0),r.ticket_type,r.store,r.event,r.status,
    COALESCE(r.verify_code,''),COALESCE(r.verify_code_pre_dropoff,''),COALESCE(r.verify_code_pre_pickup,''),
    COALESCE(r.verify_code_post_dropoff,''),COALESCE(r.verify_code_post_pickup,''),
    COALESCE(CAST(r.pre_dropoff_checklist AS CHAR),''),COALESCE(CAST(r.pre_pickup_checklist AS CHAR),''),
    COALESCE(CAST(r.post_dropoff_checklist AS CHAR),''),COALESCE(CAST(r.post_pickup_checklist AS CHAR),'')),256)=p.business_hash;
SET @consignor_reservations_filled=ROW_COUNT();
SELECT @consignor_orders_filled AS orders_filled,@consignor_reservations_filled AS reservations_filled;
SELECT p.record_kind,COUNT(*) AS planned,
  CASE WHEN p.record_kind='order' THEN @consignor_orders_filled
    ELSE @consignor_reservations_filled END AS filled,
  SUM(CASE WHEN p.record_kind='order'
    THEN NOT(JSON_UNQUOTE(JSON_EXTRACT(o.details,'$.consignorName')) <=> p.proposed_name)
    ELSE NOT(r.consignor_name <=> p.proposed_name) END) AS name_mismatches,
  SUM(CASE WHEN p.record_kind='order' THEN o.row_version<>p.row_version+1 ELSE 0 END) AS version_mismatches,
  SUM(CASE WHEN p.record_kind='order' THEN
    SHA2(CONCAT_WS('|',o.user_id,COALESCE(o.code,''),o.payment_status,o.fulfillment_status,
      CAST(JSON_REMOVE(COALESCE(o.details,JSON_OBJECT()),'$.consignorName','$.rowVersion') AS CHAR)),256)<>p.business_hash
    ELSE SHA2(CONCAT_WS('|',r.user_id,COALESCE(r.order_id,0),r.ticket_type,r.store,r.event,r.status,
      COALESCE(r.verify_code,''),COALESCE(r.verify_code_pre_dropoff,''),COALESCE(r.verify_code_pre_pickup,''),
      COALESCE(r.verify_code_post_dropoff,''),COALESCE(r.verify_code_post_pickup,''),
      COALESCE(CAST(r.pre_dropoff_checklist AS CHAR),''),COALESCE(CAST(r.pre_pickup_checklist AS CHAR),''),
      COALESCE(CAST(r.post_dropoff_checklist AS CHAR),''),COALESCE(CAST(r.post_pickup_checklist AS CHAR),'')),256)<>p.business_hash
  END) AS other_business_changes
FROM codex_consignor_plan_20261013_v3 p
LEFT JOIN leader_online.orders o ON p.record_kind='order' AND p.record_id=o.id
LEFT JOIN leader_online.reservations r ON p.record_kind='reservation' AND p.record_id=r.id
GROUP BY p.record_kind;
-- Run COMMIT separately after verification, or ROLLBACK if any guard fails.
