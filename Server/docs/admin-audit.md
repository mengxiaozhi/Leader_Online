# 管理操作日誌

入口：`/admin?tab=audit-logs`。一般瀏覽不記錄；管理／服務商／司機／交車點／教練異動、具後台身分的人員異動、匯出，以及登入完成與失敗嘗試會建立請求紀錄。身分只取自已驗證憑證與目前資料庫帳號；未驗證登入不可使用使用者輸入的帳號來歸屬操作人。

## 部署順序

1. 暫停 API 寫入流量，備份資料庫。套用既有 001–057 migration；審查並套用 `058_admin_audit.sql`。
2. 在 **Server** 目錄、已設定該環境 DB 連線的情況下執行 `npm run audit:install`。此命令可重跑，會建立日誌表、依實際 schema 安裝所有業務表的三種 AFTER trigger，再檢查完整性。需要 CREATE／TRIGGER 權限；不可在持續寫入中替換 trigger。
3. 執行 `npm run audit:check`；它是唯讀檢查。必須每張業務表均為 InnoDB、有主鍵、三個 trigger 定義與程式一致。初始化 schema 也包含日誌表，但仍須執行 trigger 安裝命令。
4. 部署並重啟後端，再部署前端。啟動會驗證日誌 schema，未就緒時，受追蹤的操作回傳 `503 AUDIT_LOG_UNAVAILABLE`，讀取功能仍可使用。修正 schema 後需要重啟。新增表或欄位後須在維護期間重新安裝／驗證 trigger。
5. 用專用測試帳號驗證新增、修改、退款、掃碼、匯出、登入、權限撤銷及失敗情境，再恢復流量。現有資料不回填為新日誌。

沒有自動清除機制，沒有日誌修改／刪除 API。資料庫操作者仍有直接修改資料庫的能力；此功能不宣稱可抵抗資料庫管理者竄改。舊版 v1 runtime 不在目前 checkout 中，不能部署未整合日誌的其他 API runtime 來提供同一批管理入口。

## 原子性與外部效果

- `AsyncLocalStorage` 隔離每個請求；請求 journal 先獨立提交，業務異動、trigger 明細與 scope 使用同一個 request transaction。
- 既有 domain 的 begin／commit／rollback 在請求內映射成 savepoint；回應送出前才提交外層交易，批次失敗子項可單獨 rollback。非請求的排程與一般會員操作沿用原連線池行為。
- 日誌寫入錯誤會污染整筆 transaction，即使舊路由 catch 錯誤，最後也不能提交。DDL 不可在請求內隱含提交；既有 lazy schema guard 只允許已存在的表／欄位／索引檢查。
- 程序中斷留下 pending；commit 回覆遺失留下待確認，不能把連線錯誤推定成「一定沒提交」。有冪等鍵的業務仍沿用原重試契約。
- 驗證碼無效或帳號不存在的驗證失敗，安全計數／驗證碼消耗仍與日誌提交，避免回滾破壞登入防護。業務失敗會先回滾，再提交失敗紀錄。
- 電子郵件、LINE、檔案新增與刪除改成交易內的持久化工作；背景 worker 在提交後執行，結果可在日誌明細查閱。API 業務成功不代表所有通知已送達。上傳先寫入私有 `.audit-staging` 暫存，DB 只保存加密的工作描述，避免大型圖片超過 SQL packet；提交後等待公開檔案寫入完成再送回成功。檔案失敗時回傳 `AUDIT_EXTERNAL_EFFECT_FAILED` 與 `committed: true`，日誌標記部分完成，不假裝已回滾資料。既有 Wallet／檔案清理 outbox 也只由提交後的 worker 處理。
- 工作 payload 以 AES-256-GCM 加密，金鑰由部署 JWT secret 派生，不暴露於日誌 API；成功或失敗後清除 payload。輪替 JWT secret 前必須排空 pending 工作。服務中斷時的 processing 工作超過五分鐘顯示待確認，不自動重送，以免重複通知；由營運確認外部結果。程序異常中止可能留下未引用的 `.audit-staging` 暫存檔，營運清理前應對照未完成工作，不能直接清空此目錄。
- 快取不儲存未提交讀取結果；失效操作延後到成功 commit。

## 記錄與查閱

`admin_audit_requests` 記錄請求結果；`admin_audit_changes` 記錄實際列異動與批次子項／匯出／重試；`admin_audit_scopes` 記錄歷史歸屬；`admin_audit_jobs` 記錄外部效果。所有表均無指向會員或業務資料的外鍵，刪除帳號不會連帶刪除日誌。外鍵 cascade 的隱含子列刪除不會觸發 MySQL row trigger；父資源的 DELETE 紀錄會保留，不能把它解讀為每個 cascade 子列的獨立快照。

只保存白名單欄位值；其他欄位只記錄其名稱是否變更。密碼／驗證碼／轉讓碼／聯絡資料／任意 JSON／圖片不存入 before/after。一般訂單 JSON 僅投影數值價格與數量。操作理由若在既有業務紀錄內仍保留原契約，不任意把自由輸入內容複製到通用日誌。

API：

- `GET /admin/audit-logs?from=YYYY-MM-DD&to=YYYY-MM-DD&actorId=...&module=...&action=refund&status=success&resourceId=...&cursor=...&limit=50`
- `GET /admin/audit-logs/:id`

日期首尾包含在內，依資料庫台北時間，回應時間由前端以 Asia/Taipei 顯示。每頁 1–100 筆，預設 50；cursor 只往舊紀錄移動。不回傳全域總數。非 ADMIN 的結果與 status 篩選僅根據授權後的可見明細計算（回傳 resultScope=visible），不包含整批結果或外部工作列表，以免洩漏其他租戶。

ADMIN 可看所有；其他角色須同時具備歷史與目前資源授權。服務商、課務 capability、教練指派、司機／交車點的預約權限逐筆重查。已刪除、歸屬移轉或無法證明授權的紀錄僅 ADMIN 可讀；登入事件另允許當事人。新增可授權資源關係時，必須擴充 scope 解析與權限測試，不能以「同角色」或「自己做的」替代資料授權。

## 驗證

`npm run audit:routes` 輸出目前路由的完整納管清單（含來源行號、模組、操作與是否必須驗證後台身分）；新增管理 guard 卻未納入記錄的端點會直接報錯。

- `npm run test:audit`：HTTP 回應閘門、故障注入、交易／scope／遮蔽／批次隔離測試。
- `AUDIT_TEST_MYSQL_SOCKET=/absolute/path/to/disposable/mysql.sock npm run test:audit`：額外在獨立生成並清除的 `audit_test_*` 資料庫，測試真實 trigger、rollback、歸屬快照與敏感欄位；未設定 socket 時明確跳過，不讀正式環境 `.env`。
- `npm test`、Web 的 `npm test` 與 `npm run build`，以及桌面／手機實際操作日誌 UI。
- 監控 `AUDIT_SCHEMA_NOT_READY`、`AUDIT_LOG_UNAVAILABLE`、`AUDIT_WORKER_FAILED`、`AUDIT_EXTERNAL_EFFECT_FAILED`；管理頁可查 pending、failed、partial 與工作結果。正式資料庫 migration／trigger 安裝與正式站操作驗收仍需在部署環境執行。
