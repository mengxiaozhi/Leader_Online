# Leader Online

Email 驗證已整合於後端（Server/index.js）並於前端註冊流程（Web/src/pages/login.vue）加上檢查與寄送驗證信。請設定以下環境變數並執行資料庫 migration。

後端環境變數（Server/.env）：
- EMAIL_USER：Gmail 帳號（建議使用應用程式密碼）
- EMAIL_PASS：Gmail 密碼或應用程式密碼
- EMAIL_FROM_NAME：寄件名稱（預設 Leader Online）
- PUBLIC_API_BASE：對外 API Base，用於產生確認連結（例如 https://api.example.com/uat/leader_online）
- PUBLIC_WEB_URL：前端網址（確認成功後回到此處，預設 http://localhost:5173）
- REQUIRE_EMAIL_VERIFICATION：是否強制註冊前完成 Email 驗證（1/0，預設 0）
- RESTRICT_EMAIL_DOMAIN_TO_EDU_TW：是否限制只能 .edu.tw 網域（1/0，預設 0）

資料庫 migration：
- 新增 `Database/migrations/008_email_verifications.sql`，請在資料庫執行以建立 `email_verifications` 資料表。

API 端點：
- POST `/verify-email`：傳入 `{ email }` 建立/重送驗證信
- GET `/confirm-email?token=...`：點擊信中連結確認驗證（回傳簡單 HTML）
- GET `/check-verification?email=...`：查詢是否已驗證
- POST `/users`：當 `REQUIRE_EMAIL_VERIFICATION=1` 時，未驗證將回報錯誤

前端調整：
- 註冊時先呼叫 `/check-verification`，未通過則自動呼叫 `/verify-email` 寄送驗證信並提示使用者完成驗證後再註冊。

注意事項：
- Gmail 必須啟用應用程式密碼或允許安全性較低的應用（不建議）。
- 若未設定 EMAIL_USER/EMAIL_PASS，後端仍會建立驗證記錄，但無法寄送郵件。
