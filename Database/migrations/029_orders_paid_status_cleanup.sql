-- Migration 029: normalize order payment status and remove order-level driver snapshots
USE leader_online;

UPDATE `orders`
SET `details` = JSON_REMOVE(
  JSON_SET(`details`, '$.status', '已付款'),
  '$.driver',
  '$.driverId',
  '$.driver_id'
)
WHERE `details` IS NOT NULL
  AND `id` > 0
  AND JSON_UNQUOTE(JSON_EXTRACT(`details`, '$.status')) IN ('已完成', '待指派');

UPDATE `orders`
SET `details` = JSON_REMOVE(
  `details`,
  '$.driver',
  '$.driverId',
  '$.driver_id'
)
WHERE `details` IS NOT NULL
  AND `id` > 0
  AND JSON_CONTAINS_PATH(`details`, 'one', '$.driver', '$.driverId', '$.driver_id');

SELECT 'Migration 029_orders_paid_status_cleanup applied' AS msg;
