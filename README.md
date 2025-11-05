# Leader Online

Leader Online 是一個集購票、場次預約、票券管理與 LINE Bot 互動於一身的全端專案。此儲存庫同時包含：

- **Server/**：Node.js + Express REST API，串接 MySQL、發送通知與第三方登入。
- **Web/**：Vue 3 + Vite 前端單頁應用，提供購物車、票券錢包、預約流程與後台介面。
- **Line_bot/**：純 Node.js LINE Messaging API Bot，支援登入綁定、系統通知與訂單查詢。
- **Database/**：MySQL schema 匯出與遷移腳本。

---

## 目錄

- [系統概覽](#系統概覽)
- [專案結構](#專案結構)
- [技術棧](#技術棧)
- [前置需求](#前置需求)
- [快速開始](#快速開始)
  - [安裝與資料庫初始化](#安裝與資料庫初始化)
  - [環境變數](#環境變數)
  - [本地開發流程](#本地開發流程)
- [部署指南](#部署指南)
- [API 參考](#api-參考)
  - [回應格式與角色](#回應格式與角色)
  - [公開 API](#公開-api)
  - [認證與帳號](#認證與帳號)
  - [一般使用者功能](#一般使用者功能)
  - [票券與轉贈](#票券與轉贈)
  - [預約與檢核](#預約與檢核)
  - [管理員／後台](#管理員後台)
- [LINE Bot 與通知](#line-bot-與通知)
- [常見腳本與維運建議](#常見腳本與維運建議)

---

## 系統概覽

- **多角色帳號**：支援一般用戶、管理員、店家、編輯、掃描人員等權限控管。
- **登入整合**：Email/密碼、Google OAuth、LINE Login、Magic Link 深連結、自動補發票券轉贈。
- **購物商店**：商品上架、雲端購物車、訂單建立、匯款資訊同步。
- **票券管理**：發券、使用紀錄、轉贈 (Email / QR Code)、LINE Bot 通知、票券封面管理。
- **活動預約**：活動與門市設定、預約建立、分站檢核 (含照片上傳)、進度通知。
- **後台工具**：使用者匯出、訂單/匯款/頁面設定、活動模板、預約檢核模板等。
- **LINE Bot**：處理 follow / message 事件、提供訂單與預約查詢、推送通知、發 magic link。

資料流程概念：

```
使用者 → Web SPA (Vue) → Server (Express + MySQL)
                              ↘ LINE Bot ↔ LINE 平台
```

---

## 專案結構

```text
Leader_Online/
├── Database/                # MySQL schema 與匯出
│   ├── index.sql            # 完整資料庫匯出（啟動環境建議從這裡匯入）
│   └── migrations/          # 額外 SQL 遷移腳本
├── Line_bot/                # LINE Messaging API Bot
│   ├── index.js             # Bot 主程式
│   ├── package.json
│   └── package-lock.json
├── Server/                  # 後端 REST API
│   ├── index.js             # 主要 Express 伺服器
│   ├── storage.js           # 檔案儲存抽象（本地/相對路徑）
│   ├── scripts/migrate-storage.js  # BLOB → 檔案系統遷移工具
│   ├── package.json
│   └── package-lock.json
├── Web/                     # 前端（Vue 3 + Vite + Tailwind）
│   ├── src/                 # 單頁應用程式
│   ├── public/
│   ├── package.json
│   └── vite.config.js
└── README.md                # 本文件
```

---

## 技術棧

- **語言**：Node.js 18+、Vue 3 (Composition API)
- **後端**：Express 4、MySQL 8、bcrypt、jsonwebtoken、zod、Nodemailer、QRCode
- **前端**：Vite 6、Vue Router 4、Tailwind CSS、Axios、Hammer.js、JS Cookie
- **LINE Bot**：LINE Messaging API、HTTP / HTTPS 原生模組、Nodemailer
- **其他**：JWT 驗證、HttpOnly Cookie、快取、本地檔案儲存、Google OAuth 2.0、LINE Login

---

## 前置需求

在開始前請準備：

- Node.js **18 或以上版本**（建議使用 LTS）。
- npm 10+。
- MySQL **8.0**（相容 5.7，但 8.0 可享全文索引與 JSON 功能）。
- 可用的 SMTP 帳號（建議 Gmail 應用程式密碼）用於寄送驗證信與通知。
- (選用) Google Cloud 專案與 OAuth 2.0 憑證。
- (選用) LINE Developers 帳號與 LINE Login + Messaging API Channel。
- 伺服器部署環境請先準備 HTTPS 憑證與反向代理（例如 Nginx）。

---

## 快速開始

### 安裝與資料庫初始化

1. **取得程式碼**

   ```bash
   git clone <repo-url> Leader_Online
   cd Leader_Online
   ```

2. **安裝相依套件**

   ```bash
   # 後端 API
   cd Server
   npm install

   # LINE Bot
   cd ../Line_bot
   npm install

   # 前端
   cd ../Web
   npm install
   ```

3. **建立資料庫**

   - 啟動 MySQL 服務並建立資料庫 `leader_online`。
   - 匯入 `Database/index.sql`：

     ```bash
     mysql -u <user> -p leader_online < ../Database/index.sql
     ```

   - 可選：`Database/migrations/` 內包含補充 SQL，視需求執行。

4. **建立儲存目錄**

   - 伺服器預設將檔案寫入 `Server/storage/`，請確保該目錄對執行使用者可寫。
   - 若要自訂路徑，可於 `.env` 設定 `STORAGE_ROOT`。

### 環境變數

> 建議在 `Server/.env` 與 `Line_bot/.env` 建立相同的設定檔，前端則需自行指定 API URL。

#### Server/.env

**一般**

- `NODE_ENV`：執行模式（例：`development`、`production`）。生產環境請設定為 `production`。
- `PORT`：後端 API 監聽埠（預設 `3020`）。
- `STORAGE_ROOT`：上傳檔案儲存的絕對路徑（預設 `Server/storage`）。
- `CORS_ORIGINS`：允許的前端來源，逗號分隔（例：`https://web.example.com,http://localhost:5173`）。
- `JWT_SECRET`：JWT 簽章金鑰（**務必自訂**）。
- `JWT_EXPIRES`：JWT 有效期間（預設 `7d`）。

**資料庫**

- `DB_HOST`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`：MySQL 連線資訊（預設資料庫名稱 `leader_online`）。
- `DB_POOL`：連線池上限（預設 `10`）。

**公開網址**

- `PUBLIC_API_BASE`：對外 API 根路徑，供信件與 LINE Bot 產生連結（例：`https://api.example.com/leader_online`）。
- `PUBLIC_WEB_URL`：前端網頁位址（例：`https://leader.example.com`）。用於 OAuth 回跳、Magic Link 轉址。

**Email / 匯款**

- `EMAIL_USER`、`EMAIL_PASS`：SMTP 帳密（建議使用應用程式密碼）。
- `EMAIL_FROM_NAME`、`EMAIL_FROM_ADDRESS`：寄件者顯示名稱與信箱（未設定時使用 `EMAIL_USER`）。
- `BANK_TRANSFER_INFO`、`BANK_CODE`、`BANK_ACCOUNT`、`BANK_ACCOUNT_NAME`、`BANK_NAME`：預設匯款資訊，會同步到 LINE Bot 與訂單通知。

**帳號政策**

- `REQUIRE_EMAIL_VERIFICATION`：是否強制 Email 驗證後才能註冊（`1` 或 `0`，預設 `0`）。
- `RESTRICT_EMAIL_DOMAIN_TO_EDU_TW`：是否只允許 `.edu.tw` 信箱（`1` 或 `0`，預設 `0`）。

**Google OAuth**

- `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`：Google OAuth 2.0 憑證。
  - OAuth 授權回呼請設定為 `<PUBLIC_API_BASE>/auth/google/callback`。

**LINE Login 與 Messaging API**

- `LINE_CLIENT_ID` / `LINE_CHANNEL_ID`：LINE Login Channel ID。
- `LINE_CLIENT_SECRET` / `LINE_CHANNEL_SECRET`：LINE Login Channel Secret。
- `LINE_BOT_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_ACCESS_TOKEN`：Messaging API Channel Access Token（Server 端推播用）。

**Magic Link／LINE 深連結**

- `MAGIC_LINK_SECRET`：生成一次性自動登入連結的金鑰（Server 與 Line_bot 必須一致）。

**可選參數**

- `EMAIL_FROM_USER`：覆蓋寄件者信箱。
- `LINE_BOT_QR_FALLBACK`：LINE Bot 未設定公開 API 時的 QR 產生 fallback（預設 `http://localhost:3020`）。
- 任何未列出參數皆可依需求延伸，Server 端會安全忽略未知變數。

#### Line_bot/.env

Line Bot 會讀取與 Server 相同的大部分參數，額外支援：

- `LINE_BOT_PORT`：Bot 監聽埠（預設 `3021`）。
- `LINE_BOT_CHANNEL_SECRET` / `LINE_CHANNEL_SECRET`：Messaging API Channel Secret。
- `LINE_BOT_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_ACCESS_TOKEN`：Messaging API Channel Access Token。
- `LINE_BOT_QR_BASE` / `LINE_BOT_QR_API` / `LINE_BOT_PUBLIC_BASE` / `LINE_BOT_PUBLIC_URL`：覆寫 QR Code API 根路徑，若未設定則使用 `PUBLIC_API_BASE`。
- `THEME_PRIMARY`、`THEME_SECONDARY`：Bot Flex Message 主題色，預設與前端一致。

> 確保 `MAGIC_LINK_SECRET`、`PUBLIC_API_BASE`、`PUBLIC_WEB_URL` 與 Server 端完全相同，以免 Magic Link 驗證失敗。

#### Web 前端 API Base

前端預設在多個頁面中以常數指定 API 路徑，目前為示範網址：

```
const API = 'https://api.xiaozhi.moe/uat/leader_online'
```

請依部署環境 **搜尋並替換** 為你的 API 網域（建議集中於共用檔案後再引用）。為避免遺漏，可執行：

```bash
rg "https://api.xiaozhi.moe/uat/leader_online" Web/src
```

若需要以環境變數注入，可建立共用設定檔（例如 `Web/src/config/api.js`）並於各頁引用，或改用 Vite `import.meta.env`。

### 本地開發流程

1. **啟動後端 API**

   ```bash
    cd Server
    npm start
    # 監聽 http://localhost:3020
   ```

2. **啟動前端**

   ```bash
   cd Web
   npm run dev -- --host 0.0.0.0 --port 5173
   # 瀏覽 http://localhost:5173
   ```

3. **啟動 LINE Bot**

   ```bash
   cd Line_bot
   npm run dev
   # 監聽 http://localhost:3021
   ```

4. **測試**

   - 伺服器健康檢查：`curl http://localhost:3020/healthz`
   - 登入流程：於前端註冊帳號後測試購物車、訂單建立、票券錢包。
   - 若 LINE Bot 在本地開發，可透過 ngrok / cloudflared 曝露 `LINE_BOT_PORT`，並於 LINE Developers 設定 Webhook。

---

## 部署指南

1. **準備環境**
   - Linux 伺服器（建議 Ubuntu 22.04+）。
   - Node.js 18+、npm。
   - MySQL 8，並開啟遠端連線或在同機部署。
   - 反向代理（Nginx / Caddy），配置 SSL 憑證。

2. **佈署後端**
   ```bash
   cd /srv/leader-online/Server
   npm ci --omit=dev
   NODE_ENV=production pm2 start index.js --name leader-api
   ```
   - 設定 `.env`。
   - 透過反向代理轉發 `https://api.example.com` → `http://127.0.0.1:3020`，記得保留 `X-Forwarded-*`，Server 已 `app.set('trust proxy', 1)` 以支援 secure cookie。
   - 調整 `CORS_ORIGINS` 為正式前端網域。

3. **前端打包**
   ```bash
   cd /srv/leader-online/Web
   npm ci
   npm run build
   ```
   - 將 `dist/` 發佈至靜態伺服器或 CDN（例如 Nginx `root /srv/leader-online/Web/dist;`）。
   - 在部署前先確認已更新 API Base。

4. **LINE Bot**
   ```bash
   cd /srv/leader-online/Line_bot
   npm ci --omit=dev
   NODE_ENV=production pm2 start index.js --name leader-linebot
   ```
   - Webhook URL 指向 `https://bot.example.com/`（或與後端共網域，再由反向代理分流）。
   - 確保 `LINE_BOT_CHANNEL_SECRET`、`LINE_BOT_CHANNEL_ACCESS_TOKEN` 正確。

5. **資料庫匯入與遷移**
   - 若由空白環境開始，先匯入 `Database/index.sql`。
   - 若既有資料庫欲使用檔案儲存，執行：

     ```bash
     cd Server
     node scripts/migrate-storage.js
     ```
     會將活動封面、票券封面、預約檢核照片從 BLOB 移至 `storage/`。

6. **DNS / HTTPS / Cookie 設定**
   - 所有對外服務需使用 HTTPS，以確保 HttpOnly + Secure cookie 可正常寫入。
   - 設定 `PUBLIC_API_BASE`、`PUBLIC_WEB_URL`（皆需 HTTPS / 不可結尾 `/`）。

7. **部署後自我檢查**
   - `curl https://api.example.com/healthz` 回傳 `{ ok: true }`。
   - 前端登入、購物車同步、訂單建立、預約流程。
   - Google / LINE OAuth 回跳是否正確。
   - LINE Bot 回覆、推播與 magic link 登入。
   - 若啟用 Email 驗證，確認郵件送達。

8. **備援與監控**
   - 設置資料庫備份排程。
   - 使用 PM2 / systemd 監控 Node 進程。
   - 針對 `/healthz` 建立健康檢查（例如 UptimeRobot）。

---

## API 參考

### 回應格式與角色

所有 API（除 OAuth Redirect 外）均回傳以下結構：

```json
成功: { "ok": true, "message": "Success", "data": ... }
失敗: { "ok": false, "code": "ERROR_CODE", "message": "錯誤說明" }
```

授權資訊可透過兩種方式攜帶：

- `auth_token` HttpOnly Secure Cookie（預設）。
- `Authorization: Bearer <JWT>` Header（前端因 Safari WebView 限制會自動帶入）。

系統角色與權限：

- `USER`：一般登入會員。
- `ADMIN`：完整後台權限。
- `STORE`：活動擁有者，可管理所屬活動 / 預約 / 訂單。
- `EDITOR`：商品與活動內容維護。
- `OPERATOR`：掃描 / 進度確認權限。

> 後台端點會標示所需角色。若多個角色皆可使用，會列出集合。

### 公開 API

| Method | Path | 說明 | 權限 | 備註 |
| --- | --- | --- | --- | --- |
| GET | `/healthz` | 簡易健康檢查 | 無 | 回傳 uptime |
| GET | `/__debug/echo` | 偵錯資訊 | 無 | 列出 Host、CORS、Cookie 狀態 |
| GET | `/events` | 取得未過期活動列表 | 無 | 含 `code`, `rules` 等欄位，30 秒快取 |
| GET | `/events/:id` | 取得單一活動詳細 | 無 | 支援舊欄位兼容（cover、rules JSON） |
| GET | `/events/:id/cover` | 活動封面（圖片或 redirect） | 無 | 會設定快取 Header |
| GET | `/events/:id/stores` | 活動門市列表 | 無 | 回傳對應的門市與可預約資訊 |
| GET | `/products` | 商品列表 | 無 | 回傳 `code`（若無則自動帶 `PDxxxxxx`） |
| GET | `/tickets/cover/:type` | 票券封面 | 無 | 從檔案系統或 BLOB 提供圖片 |
| GET | `/pages/:slug` | 靜態頁面內容 | 無 | slug：`terms` / `privacy` / `reservation-notice` / `reservation-rules` |
| GET | `/app/reservation_checklists` | 預約檢核表定義 | 無 | 提供 App 端使用的檢核模板 |
| GET | `/qr?data=...` | 產生 PNG QR Code | 無 | 最多 300 秒快取；長度限制約 1024 字元 |

### 認證與帳號

| Method | Path | 說明 | 權限 | 主要參數 / 備註 |
| --- | --- | --- | --- | --- |
| GET | `/auth/magic_link` | Magic Link 自動登入 | 無 | Query：`provider`, `subject`, `redirect`, `ts`, `sig` |
| GET | `/auth/google/start` | 導向 Google OAuth | 無 | Query：`redirect`（選填） |
| GET | `/auth/google/callback` | Google OAuth 回調 | 無 | 成功後簽發 Cookie 並 302 前端 |
| GET | `/auth/line/start` | LINE OAuth | 無 | Query：`redirect`、`mode=link`（綁定模式） |
| GET | `/auth/line/callback` | LINE OAuth 回調 | 無 | 成功後簽發 Cookie，支援綁定與登入 |
| POST | `/verify-email` | 建立 / 重送 Email 驗證信 | 無 | Body：`email` |
| GET | `/check-verification` | 查詢 Email 驗證狀態 | 無 | Query：`email` |
| GET | `/confirm-email` | 驗證信連結 | 無 | Query：`token`，成功後自動登入或提示設定密碼 |
| GET | `/confirm-email-change` | Email 更換確認 | 無 | Query：`token`，完成後更新帳號 Email |
| POST | `/users` | 註冊 | 無 | Body：`username`, `email`, `password` |
| POST | `/login` | 密碼登入 | 無 | Body：`email`, `password` |
| POST | `/logout` | 登出 | 登入 | 清除 Cookie |
| GET | `/whoami` | 取得目前登入資訊 | 登入 | 回傳 `id`, `email`, `username`, `role`, `providers` |
| POST | `/forgot-password` | 忘記密碼寄信 | 無 | Body：`email` |
| POST | `/me/password/send_reset` | 已登入使用者寄送重設信 | 登入 | 無 Body |
| GET | `/password_resets/validate` | 驗證重設 token | 無 | Query：`token` |
| POST | `/reset-password` | 重設密碼 | 無 | Body：`token`, `password` |
| GET | `/auth/providers` | 列出已綁定登入方式 | 登入 | 回傳 provider 陣列 |
| DELETE | `/auth/providers/google` | 解除 Google 綁定 | 登入 | 需仍保有至少一種登入方式 |
| DELETE | `/auth/providers/line` | 解除 LINE 綁定 | 登入 | 同上 |

### 一般使用者功能

| Method | Path | 說明 | 權限 | 主要參數 / 備註 |
| --- | --- | --- | --- | --- |
| GET | `/me` | 取得個人資料 | 登入 | 包含電話、匯款後五碼（若有欄位） |
| PATCH | `/me` | 更新個人資料 | 登入 | Body 可含 `username`, `email`(需驗證), `phone`, `remittanceLast5` |
| PATCH | `/me/password` | 修改密碼 | 登入 | Body：`currentPassword`, `newPassword` |
| POST | `/me/export` | 匯出個人資料 | 登入 | 回傳票券、訂單、預約、轉贈紀錄 |
| POST | `/me/delete` | 刪除帳號 | 登入 | 會匿名化資料並紀錄 tombstone |
| GET | `/cart` | 讀取雲端購物車 | 登入 | 回傳 `items` 陣列 |
| PUT | `/cart` | 儲存購物車 | 登入 | Body：`items`（陣列） |
| DELETE | `/cart` | 清空購物車 | 登入 | 無 Body |
| GET | `/orders/me` | 取得個人訂單 | 登入 | `details` 為 JSON 字串 |
| POST | `/orders` | 建立訂單 | 登入 | Body：`items`（陣列，每筆為 JSON 字串或物件） |
| GET | `/reservations/me` | 取得個人預約 | 登入 | 回傳含檢核進度與照片資訊 |
| POST | `/reservations` | 建立預約 | 登入 | Body：`ticketType`, `store`, `event`, 選填 `eventId`, `storeId` |
| POST | `/reservations/:id/checklists/:stage/photos` | 上傳檢核照片 | 登入 | Body：`data` (DataURL), `name`；stage：`pre_dropoff`/`pre_pickup`/`post_dropoff`/`post_pickup` |
| DELETE | `/reservations/:id/checklists/:stage/photos/:photoId` | 刪除檢核照片 | 登入 | 僅擁有者可刪除 |
| GET | `/reservations/:id/checklists/:stage/photos/:photoId/raw` | 原始檢核照片 | 登入 | 需要檢核權限或本人 |
| PATCH | `/reservations/:id/checklists/:stage` | 更新檢核狀態 | 登入 | Body 可含 `completed`, `notes` |

### 票券與轉贈

| Method | Path | 說明 | 權限 | 主要參數 / 備註 |
| --- | --- | --- | --- | --- |
| GET | `/tickets/me` | 取得持有票券 | 登入 | 含 `uuid`, `type`, `discount`, `expiry` |
| GET | `/tickets/logs` | 票券操作紀錄 | 登入 | 支援 `?limit=`（預設 100） |
| PATCH | `/tickets/:id/use` | 使用票券 | 登入 | 僅未使用票券；成功後寫入 log |
| POST | `/tickets/transfers/initiate` | 發起轉贈 | 登入 | Body：`ticketId`, `mode` (`email`/`qr`), `email` (若 email 模式) |
| POST | `/tickets/transfers/:id/accept` | 接受轉贈 | 登入 | 路徑：轉贈 ID |
| POST | `/tickets/transfers/:id/decline` | 拒絕轉贈 | 登入 | 路徑：轉贈 ID |
| POST | `/tickets/transfers/claim_code` | 掃描 QR 立即領取 | 登入 | Body：`code` |
| GET | `/tickets/transfers/incoming` | 查看待接受轉贈 | 登入 | 自動清理過期紀錄 |
| POST | `/tickets/transfers/cancel_pending` | 取消等待中的轉贈 | 登入 | Body：`ticketId` |

### 預約與檢核

| Method | Path | 說明 | 權限 | 備註 |
| --- | --- | --- | --- | --- |
| GET | `/admin/reservations` | 預約列表 | `ADMIN`、`STORE` | 支援搜尋、分頁；STORE 僅能看自己活動 |
| GET | `/admin/reservations/:id/checklists` | 檢視檢核與照片 | `ADMIN`、`STORE` | 回傳所有階段與照片路徑 |
| PATCH | `/admin/reservations/:id/status` | 更新預約狀態 | `ADMIN`、`STORE` | Body：`status`（如 `scheduled`） |
| POST | `/admin/reservations/progress_scan` | 掃描核銷進度 | `ADMIN`、`STORE`、`OPERATOR` | Body：`code`, `stage`，回應下一階段通知 |

### 管理員／後台

**使用者與權限**

| Method | Path | 說明 | 權限 | 備註 |
| --- | --- | --- | --- | --- |
| GET | `/users` | 使用者列表 | `ADMIN` | |
| GET | `/admin/users` | 後台使用者列表（含搜尋） | `ADMIN` | 支援 `?query=&role=&limit=&offset=` |
| GET | `/admin/users/:id/export` | 匯出指定使用者完整資料 | `ADMIN` | |
| PATCH | `/admin/users/:id` | 更新使用者帳號 | `ADMIN` | Body：`username`, `email` |
| PATCH | `/admin/users/:id/role` | 調整角色 | `ADMIN` | Body：`role` |
| PATCH | `/admin/users/:id/password` | 重設密碼 | `ADMIN` | Body：`password` |
| DELETE | `/admin/users/:id` | 刪除帳號與關聯資料 | `ADMIN` | 會同步刪除／匿名化關聯表 |
| GET | `/admin/users/:id/oauth_identities` | 檢視第三方登入 | `ADMIN` | |
| POST | `/admin/users/:id/oauth_identities` | 新增第三方綁定 | `ADMIN` | Body：`provider`, `subject`, `email` |
| DELETE | `/admin/users/:id/oauth_identities/:provider` | 移除綁定 | `ADMIN` | |
| POST | `/admin/oauth/cleanup_providers` | 清理多餘的 OAuth 資料 | `ADMIN` | |
| GET | `/admin/tombstones` | 查看帳號封鎖記錄 | `ADMIN` | |
| POST | `/admin/tombstones` | 新增封鎖紀錄 | `ADMIN` | Body：`provider`, `subject`, `email`, `reason` |
| DELETE | `/admin/tombstones/:id` | 刪除封鎖紀錄 | `ADMIN` | |

**商品、活動與門市**

| Method | Path | 說明 | 權限 | 備註 |
| --- | --- | --- | --- | --- |
| POST | `/admin/products` | 新增商品 | `ADMIN`、`EDITOR` | Body：`code?`, `name`, `description?`, `price` |
| PATCH | `/admin/products/:id` | 更新商品 | `ADMIN`、`EDITOR` | |
| DELETE | `/admin/products/:id` | 刪除商品 | `ADMIN`、`EDITOR` | |
| GET | `/admin/events` | 活動列表（含搜尋、分頁） | `ADMIN`、`STORE`、`EDITOR` | STORE 僅能看到自己管理的活動 |
| POST | `/admin/events` | 新增活動 | `ADMIN`、`STORE`、`EDITOR` | Body：`title`, `starts_at`, `ends_at`, `deadline?`, `location?`, `description?`, `cover?`, `rules` |
| PATCH | `/admin/events/:id` | 更新活動 | `ADMIN`、`STORE`、`EDITOR` | STORE 僅能改自己擁有的活動 |
| DELETE | `/admin/events/:id` | 刪除活動 | `ADMIN`、`STORE`、`EDITOR` | STORE 同樣需為擁有者 |
| DELETE | `/admin/events/:id/cover` | 刪除活動封面 | `ADMIN`、`STORE`、`EDITOR` | 同步移除檔案 |
| POST | `/admin/events/:id/cover_json` | 上傳活動封面 (Base64) | `ADMIN`、`STORE`、`EDITOR` | Body：`dataUrl` or `mime` + `base64` |
| GET | `/admin/store_templates` | 門市模板列表 | `ADMIN`、`STORE`、`EDITOR` | |
| POST | `/admin/store_templates` | 新增門市模板 | `ADMIN`、`STORE`、`EDITOR` | |
| PATCH | `/admin/store_templates/:id` | 更新門市模板 | `ADMIN`、`STORE`、`EDITOR` | |
| DELETE | `/admin/store_templates/:id` | 刪除門市模板 | `ADMIN`、`STORE`、`EDITOR` | |
| GET | `/admin/events/:id/stores` | 活動門市列表 (後台) | `ADMIN`、`STORE`、`EDITOR` | |
| POST | `/admin/events/:id/stores` | 匯入新門市 | `ADMIN`、`STORE`、`EDITOR` | Body：`stores` 陣列 |
| PATCH | `/admin/events/stores/:storeId` | 更新門市資訊 | `ADMIN`、`STORE`、`EDITOR` | |
| DELETE | `/admin/events/stores/:storeId` | 刪除門市 | `ADMIN`、`STORE`、`EDITOR` | |
| GET | `/admin/tickets/types` | 管理票券封面列表 | `ADMIN` | |
| POST | `/admin/tickets/types/:type/cover_json` | 上傳票券封面 | `ADMIN` | Body：`dataUrl` 或 `mime` + `base64` |
| DELETE | `/admin/tickets/types/:type/cover` | 刪除票券封面 | `ADMIN` | |

**訂單與匯款**

| Method | Path | 說明 | 權限 | 備註 |
| --- | --- | --- | --- | --- |
| GET | `/admin/orders` | 訂單列表 | `ADMIN`、`STORE` | 支援 `?limit`、`offset`、`q` |
| PATCH | `/admin/orders/:id/status` | 更新訂單狀態 | `ADMIN` | Body：`status` (`待匯款`/`處理中`/`已完成`) |
| GET | `/admin/remittance` | 匯款資訊設定 | `ADMIN` | |
| PATCH | `/admin/remittance` | 更新匯款資訊 | `ADMIN` | Body：`info`, `bankCode`, `bankAccount`, `accountName`, `bankName` |

**內容管理**

| Method | Path | 說明 | 權限 | 備註 |
| --- | --- | --- | --- | --- |
| GET | `/admin/site_pages` | 官方頁面內容 | `ADMIN` | 內容包含 `terms`, `privacy`, `reservationNotice`, `reservationRules` |
| PATCH | `/admin/site_pages` | 更新官方頁面內容 | `ADMIN` | Body 對應上述欄位 |
| GET | `/admin/reservation_checklists` | 預約檢核模板 | `ADMIN` | |
| PATCH | `/admin/reservation_checklists` | 更新預約檢核模板 | `ADMIN` | Body：`definitions` JSON |

---

## LINE Bot 與通知

- Bot 依據 LINE Messaging API Webhook 觸發，支援 follow、message、postback 等事件。
- 主要功能：
  - 綁定網站帳號（使用 `/auth/line/start?mode=link` 流程）。
  - 推播訂單建立、匯款提醒、預約進度、票券轉贈等 Flex Message。
  - 產生 Magic Link，提供 LINE → 網站的一鍵登入。
  - 透過 Email/SMS 補發資訊（若設定 SMTP）。
- Bot 使用與後端相同的 MySQL，請確保 `.env` 設定一致。
- 若需要讓 LINE Bot 提供 QR Code，請確保 `PUBLIC_API_BASE` 可從外網存取 `/qr`。

---

## 常見腳本與維運建議

- **資料搬移**
  - `node Server/scripts/migrate-storage.js`：將舊資料庫的 BLOB 轉存至檔案系統，避免 DB 空間膨脹。
- **備份**
  - 定期 `mysqldump` 資料庫，並備份 `Server/storage/` 內的檔案。
- **日誌**
  - Server 會在主控台輸出錯誤，可透過 PM2 / systemd 搭配 logrotate 管理。
- **定期清理**
  - 系統會自動於轉贈流程中過期無效紀錄 (`expireOldTransfers`)，無需額外 Cron。
- **Troubleshooting**
  - CORS 失敗：確認 `CORS_ORIGINS` 包含前端來源。
  - Cookie 未寫入：確保以 HTTPS 連線，並在反向代理加上 `proxy_set_header X-Forwarded-Proto https;`。
  - Magic Link 失敗：確認 `MAGIC_LINK_SECRET`、`PUBLIC_API_BASE`、`PUBLIC_WEB_URL` 在 Server 與 Line Bot 一致，且伺服器時間同步 (NTP)。

---

如需擴充或整合第三方服務，建議於 Server 層新增 REST 端點並於 Web / LINE Bot 中呼叫，維持單一資料來源與權限控管。若 README 有需補充之處，歡迎提交 PR 或更新筆記。祝開發順利！
