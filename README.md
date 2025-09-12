# Leader Online

以下為專案需要設定的所有環境變數（放在 `Server/.env`）。每個變數都有預設值，但建議在正式環境明確設定。

**一般**
- `NODE_ENV`: 運行模式（例如 `production`）
- `PORT`: 伺服器埠號（預設 `3020`）
- `CORS_ORIGINS`: 允許的跨來源清單（以逗號分隔）
- `JWT_SECRET`: JWT 簽章密鑰（請務必更換）
- `JWT_EXPIRES`: JWT 有效期（例如 `7d`）

**資料庫**
- `DB_HOST`: MySQL 主機（預設 `localhost`）
- `DB_USER`: MySQL 使用者
- `DB_PASSWORD`: MySQL 密碼
- `DB_NAME`: 資料庫名稱（預設 `leader_online`）
- `DB_POOL`: 連線池上限（預設 `10`）

**郵件服務 / 網址**
- `EMAIL_USER`: 寄信帳號（建議使用 Gmail 應用程式密碼）
- `EMAIL_PASS`: 寄信密碼或應用程式密碼
- `EMAIL_FROM_NAME`: 寄件者名稱（預設 `Leader Online`）
- `PUBLIC_API_BASE`: 對外 API Base，用於產生確認連結（例如 `https://api.example.com/uat/leader_online`）
- `PUBLIC_WEB_URL`: 前端網址（驗證成功、OAuth 回跳時使用；開發預設 `http://localhost:5173`）
- `REQUIRE_EMAIL_VERIFICATION`: 是否強制註冊前完成 Email 驗證（`1`/`0`，預設 `0`）
- `RESTRICT_EMAIL_DOMAIN_TO_EDU_TW`: 是否限制只能 `.edu.tw` 網域（`1`/`0`，預設 `0`）

**Google OAuth（第三方登入）**
- `GOOGLE_CLIENT_ID`: Google OAuth 2.0 Client ID
- `GOOGLE_CLIENT_SECRET`: Google OAuth 2.0 Client Secret

設定完成後，請在 Google Cloud Console 的 OAuth 2.0 設定中加入下列 Redirect URI：
- `<PUBLIC_API_BASE>/auth/google/callback`

登入頁會呼叫：
- `/auth/google/start?redirect=/store` → 導向 Google 授權 → `/auth/google/callback` → 成功後簽發 Cookie 並導回 `PUBLIC_WEB_URL + redirect`

**LINE Login（第三方登入）**
- `LINE_CLIENT_ID` 或 `LINE_CHANNEL_ID`: LINE Login 的 Channel ID（相當於 Client ID）
- `LINE_CLIENT_SECRET` 或 `LINE_CHANNEL_SECRET`: LINE Login 的 Channel Secret

LINE Developers 設定：
- Callback URL：`<PUBLIC_API_BASE>/auth/line/callback`
- Scope：至少勾選 `openid`、`profile`，若需以 Email 建立/對應帳號請申請並啟用 `email`
- 開發/測試階段，可先將使用者加入測試白名單

流程對應：
- `/auth/line/start?redirect=/store` → 導向 LINE 授權 → `/auth/line/callback` → 成功後簽發 Cookie 並導回 `PUBLIC_WEB_URL + redirect`
- 支援「綁定模式」：`/auth/line/start?mode=link&redirect=/account`（登入中的使用者可將 LINE 綁定到自己的帳號）

注意事項：
- 若使用者未授權提供 Email，且系統找不到既有 LINE 綁定，將無法自動建立新帳號，回調會導回登入頁並帶上 `oauth_error=line_no_email`。
- 首次使用第三方登入建立新帳號時，系統會建立一次性重設密碼連結並 302 導向 `/reset?token=...&first=1`，使用者必須先設定密碼後才能使用（完成後會自動登入）。

**Email 驗證 / 註冊流程**
- POST `/verify-email`: 建立/重送驗證信
- GET `/confirm-email?token=...`: 點擊後「已註冊者」直接登入、「新用戶」自動建立帳號並 302 導向 `/reset?token=...&first=1` 以設定密碼
- POST `/users`: 直接註冊（若啟用強制驗證，未驗證將拒絕）
- 限制：同一 Email 只能註冊一次；若要重註冊請先刪除帳號或更改成其他 Email
- 變更 Email（驗證後才生效）：
  - 自助：`PATCH /me` 傳入 `email` 時，不會直接更新資料庫，而是建立變更請求並寄出驗證信。
  - 管理：`PATCH /admin/users/:id` 傳入 `email` 時，亦改為建立變更請求並寄出驗證信。
  - 驗證：使用者點擊 `GET /confirm-email-change?token=...` 後，新的 Email 才會正式寫入 `users.email`。

**資料庫表**
- `Database/index.sql` 含基本 schema
- `Database/migrations/008_email_verifications.sql` 建立 `email_verifications` 表（Email 驗證）

**.env 範例**
以下為參考設定（請依環境調整）：

```
# 一般
NODE_ENV=production
PORT=3020
CORS_ORIGINS=https://uat.xiaozhi.moe,http://localhost:5173
JWT_SECRET=請替換為隨機長字串
JWT_EXPIRES=7d

# 資料庫
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=leader_online
DB_POOL=15

# 郵件與網址
EMAIL_USER=me@xiaozhi.moe
EMAIL_PASS=your_app_password
EMAIL_FROM_NAME=Leader Online 用戶中心
PUBLIC_API_BASE=https://api.xiaozhi.moe/uat/leader_online
PUBLIC_WEB_URL=https://uat.xiaozhi.moe
REQUIRE_EMAIL_VERIFICATION=1
RESTRICT_EMAIL_DOMAIN_TO_EDU_TW=0

# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

啟動後端：
- 進入 `Server/`，建立 `.env`，啟動 Node 伺服器（例如 `node index.js` 或使用 PM2）。

啟動前端：
- 進入 `Web/`，安裝依賴並啟動（`npm i && npm run dev`）。

## Google 登入（Google Cloud Console 設定步驟）

以下步驟在 Google Cloud Console（APIs & Services）完成：

1) 建立 OAuth 2.0 憑證（Web application）
- Authorized redirect URIs（需與後端對應，大小寫與協議要完全相同）：
  - 產品：`<PUBLIC_API_BASE>/auth/google/callback`（例如 `https://api.xiaozhi.moe/uat/leader_online/auth/google/callback`）
  - 本機：`http://localhost:3020/auth/google/callback`
- Authorized JavaScript origins（可選，便於前端調用）：
  - 產品：`<PUBLIC_WEB_URL>`（例如 `https://uat.xiaozhi.moe`）
  - 本機：`http://localhost:5173`

2) 設定 OAuth 同意畫面
- User Type：建議先用 `External`。
- App information：App name、Support email 任意填寫。
- Scopes：基本的 `openid`、`email`、`profile` 即可。
- Authorized domains：
  - 若要把 App 發佈為 Production 且不限測試使用者，需把使用中的網域加入，並在 Google Search Console 完成「網域所有權驗證」。
  - 如果你無法驗證網域（例如前端不是你的網站），可先把 App 保持在「Testing」模式，並把要測試的 Google 帳號加入 Test users（上限 100 位）。

3) 將 Client ID / Client Secret 放到 `.env`
- `GOOGLE_CLIENT_ID=...`
- `GOOGLE_CLIENT_SECRET=...`

4) 後端與前端對應
- 後端：本專案提供兩個端點
  - `GET /auth/google/start?redirect=/store`：導向 Google 登入
  - `GET /auth/google/callback`：從 Google 回調 → 兜資料 → 發 Cookie → 302 回 `PUBLIC_WEB_URL + redirect`
- 前端：登入頁已有「使用 Google 登入」按鈕會打到 `/auth/google/start`。

## LINE Login（LINE Developers 設定步驟）

1) 建立 LINE Login Channel（LINE Developers Console）
- Basic settings 中取得 Channel ID 與 Channel secret，填入 `.env`：
  - `LINE_CLIENT_ID=...`（或 `LINE_CHANNEL_ID=...`）
  - `LINE_CLIENT_SECRET=...`（或 `LINE_CHANNEL_SECRET=...`）
- Callback URL：
  - 產品：`<PUBLIC_API_BASE>/auth/line/callback`
  - 本機：`http://localhost:3020/auth/line/callback`

2) OpenID Connect 設定
- Scopes：`openid`、`profile`；若要以 Email 建立/對應帳號，請申請啟用 `email` 權限。

3) 後端與前端對應
- 後端：
  - `GET /auth/line/start?redirect=/store`：導向 LINE 登入
  - `GET /auth/line/callback`：從 LINE 回調 → 兜資料（含驗證 id_token 以取得 email）→ 發 Cookie → 302 回 `PUBLIC_WEB_URL + redirect`
- 前端：登入頁新增「使用 LINE 登入」按鈕會打到 `/auth/line/start`；帳戶中心可進行 LINE 綁定/解除。

4) 常見錯誤排查
- invalid_state：回調 `state` 不一致，清 Cookie 後重試；確認 `/auth/line/start` 與 `/auth/line/callback` 使用相同網域/協議。
- line_no_email：使用者未授權 Email 或 Channel 未啟用 Email 權限，無法建立新帳號；請改用已註冊 Email 登入後再綁定，或啟用 Email 權限。

5) Cookie 與 HTTPS 注意事項
- 後端 Cookie 參數為 `secure: true` 與 `sameSite: 'none'`，正式環境必須使用 HTTPS。
- 本機開發若用 http，瀏覽器可能不接受 Cookie；可改用 https 反向代理或以 Bearer 進行調試。

6) 常見錯誤排查
- redirect_uri_mismatch：檢查 Google 憑證上的 Redirect URI 是否與實際完全一致（含 http/https、尾斜線）。
- invalid_state：回調 `state` 不一致，清 Cookie 後重試，或確認 `/auth/google/start` 與 `/auth/google/callback` 的主機/協議一致。
- cookies not set：非 HTTPS 下 `secure` Cookie 不會被存，請改走 HTTPS 或以別的方式驗證。

7) 非自有網域的情境（前端不是你的網站）
- 可以把 OAuth App 保持在「Testing」模式，將需要測試的 Google 帳號加入 Test users，即可使用（最多 100 位）。
- OAuth 回調是打到你可控的 API 網域（`PUBLIC_API_BASE`）；回調成功後由後端 302 導向 `PUBLIC_WEB_URL`，因此前端網域無須在你的控制之下也可運作。
