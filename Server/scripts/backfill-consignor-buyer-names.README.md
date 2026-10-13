既有託運訂單及預約的空白姓名，一次性沿用購買者姓名；已填寫的託運者姓名不會被覆蓋。補入後與會員姓名分開保存，會員後續改名不會連動。

姓名來源依序為訂單已記錄的託運者姓名、下單姓名快照、訂單購買帳號姓名。無訂單關聯的歷史預約，使用最早已接受轉讓的原持有人；沒有轉讓紀錄時使用預約會員姓名。空白或超過 50 字的來源列入 skipped，避免猜測或截斷姓名。

需先完成 migration 061。此程序沒有新增欄位或修改照片、檢核、驗證碼、付款及託運狀態；訂單版本會增加，避免舊畫面覆蓋補入結果。使用 `Server/.env` 指定的資料庫，執行前核對目標環境，並在維護時段暫停相關寫入。

在 Server 目錄預覽數量（只讀）：

```sh
node scripts/backfill-consignor-buyer-names.js
```

套用時必須指定尚不存在、位於受保護持久儲存目錄的備份檔。備份包含姓名，權限為 0600，不應放入 Git 或公開目錄。程序會先完成備份，再於同一交易補入資料；重複執行不會覆蓋已填資料。

```sh
node scripts/backfill-consignor-buyer-names.js --apply --backup /secure/backup/consignor-buyer-names.json
```

需要還原時：

```sh
node scripts/backfill-consignor-buyer-names.js --rollback /secure/backup/consignor-buyer-names.json
```

還原只恢復補入的姓名欄位，版本仍遞增。若姓名或訂單版本已被其他操作更新，整筆還原交易會取消，不覆蓋後續修改。無法判斷最早持有人的不完整轉讓歷史，需由客服核對；程序不修改訂單購買者或目前持有人。
