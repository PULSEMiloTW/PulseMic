# PulseMic

供賽事導播使用的 **Windows 本機 Discord 雙機器人耳機監聽系統**。兩個獨立 Bot 身分各自選擇 Channel A 或 B，每位成員保留獨立音源，在瀏覽器調整音量與靜音。

![PulseMic](public/brand/PulseMic_MainLogo.png)

## 啟動

需要 Windows 10/11、Node.js **22.12 以上**（建議 Node.js 24 LTS）、Edge 或 Chrome，以及可連接 Discord 的網路。

1. 在目前專案資料夾雙擊 **`00_啟動PulseMic.cmd`**。
2. 首次或套件 lockfile 更新後自動以 `npm ci` 安裝依賴；每次全新啟動會型別檢查並重新建置。
3. 瀏覽器開啟 **http://localhost:3210/console**。保留服務視窗；按 Ctrl+C 停止服務，兩隻 Bot 會登出。
4. 若服務已啟動，再次點擊只開啟控制台。不同應用占用連接埠時不會終止該應用。

控制服務僅綁定 `127.0.0.1`，公網僅支援專用 Cloudflare Tunnel 的 `mic.pulse-studio.live`。公網控制台需 Discord 指定帳號登入，輸出頁需一次性授權碼。本機控制台由此 Windows 使用者直接操作。另一個控制台會接手；獨立輸出頁不會接管控制台。

## 網域登入與獨立音源輸出

- `https://mic.pulse-studio.live/`：Discord 登入首頁。
- `/console`：控制台；目前僅允許 Discord 使用者 ID `1456945476933914626`。其他帳號在後端拒絕，不能操作 API 或控制 WebSocket。
- `/output`：音源輸出頁。導播在控制台點「產生一次性授權碼」，私下提供給收聽者；收聽者輸入後點「開始監聽」。控制台本身不播放音訊，輸出頁無 Bot 操作權限。
- 一碼只兌換一次，5 分鐘內有效。播放授權只在當前頁面記憶體中，僅可開啟一條輸出連線，最長 8 小時；重新整理、離開或斷線後需新碼。授權碼不放入網址、Cookie 或 localStorage，服務重啟會撤銷所有登入、授權碼與播放授權。
- 控制台的音量、靜音及 solo 會同步到所有已連線的輸出頁；輸出頁也可自行調整目前裝置的播放音量。停止播放不影響 Bot 所在頻道。
- 本機輸出保留逐成員 Opus / WebRTC；遠端輸出以 HTTPS/WSS 傳送逐成員 Opus，由瀏覽器 WebCodecs 解碼，再以 Web Audio 分別調音。需要支援 Opus AudioDecoder 的新版 Edge／Chrome。不預先混音。網路壅塞時停止輸出並要求新碼，避免累積延遲。
- 公網 Bot Token 設定被禁止；憑證只能從 `http://localhost:3210/console?tab=settings` 輸入。

### Discord OAuth 登入設定

1. 在 [Discord Developer Portal](https://discord.com/developers/applications) 建立登入用 Application（可與 Bot Application 共用，但 Client Secret 與 Bot Token 不同）。
2. OAuth2 的 Redirects 加入 **`https://mic.pulse-studio.live/auth/discord/callback`**；只使用 `identify` scope，不要求伺服器管理權限。
3. 雙擊 `01_設定Discord登入.cmd`，填入 Application ID 與隱藏輸入的 Client Secret；也可在本機專案 PowerShell 執行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\configure-oauth.ps1`。不要將 Secret 貼到聊天或提交 Git。
4. 設定以 Windows CurrentUser DPAPI 保存於 `%LOCALAPPDATA%\PulseMic\oauth.secrets`。重新啟動 PulseMic 後生效。未設定、解密失敗或 Discord 驗證失敗時，公網維持拒絕登入。
5. 登入授權最長 8 小時，HttpOnly / Secure / SameSite Cookie；OAuth state 綁定瀏覽器且只能使用一次。登出後控制 API 立即拒絕，控制連線在下次心跳撤銷。

### Cloudflare Tunnel

本機使用專用 **PulseMic** Tunnel，設定在忽略於 Git 的 `.local/cloudflared.yml`，不修改其他產品的 Tunnel。先啟動 PulseMic，再雙擊 `02_啟動PulseMic網域.cmd`（或執行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-tunnel.ps1`）；兩個服務視窗都需保持開啟。也可依下面範本在新的電腦重新建立專用 Tunnel；憑證不能提交 Git。

```yaml
tunnel: YOUR_PULSEMIC_TUNNEL_UUID
credentials-file: YOUR_CURRENT_WINDOWS_CREDENTIAL_FILE
ingress:
  - hostname: mic.pulse-studio.live
    service: http://127.0.0.1:3210
  - service: http_status:404
```

使用 `cloudflared tunnel create PulseMic` 建立，`cloudflared tunnel --config .local/cloudflared.yml ingress validate` 檢查。DNS 在 **pulse-studio.live** 的 zone 新增 `mic` CNAME，指向 `YOUR_PULSEMIC_TUNNEL_UUID.cfargotunnel.com` 並啟用 Proxy；只有確認管理憑證選取的是此 zone，才使用 `cloudflared tunnel route dns`，否則可能加到別的網域尾碼下。保留原始 Host，不設定將公網 Host 改為 localhost 的 `httpHostHeader`。移轉主機須重新輸入 OAuth 與 Bot 憑證。

可設定環境變數 `PULSEMIC_PORT` 使用其他本機埠；預設不使用 3000 或 3100。所有程式與啟動路徑由目前專案位置解析，支援含空格的資料夾。

更新程式後，先在服務視窗 Ctrl+C 停止，再重新點擊啟動檔。啟動檔不會自動重啟已執行的服務。

開發指令：

```powershell
npm ci
npm run dev       # 同一個 localhost:3210，同時提供 Vite 與本機 API
npm run typecheck
npm test
npm run build
npm run start     # 啟動建置後版本
npm run test:browser # Edge；隔離測試設定、使用 localhost:3211
```

## Discord 設定

1. 到 [Discord Developer Portal](https://discord.com/developers/applications) 建立 **兩個 Application / Bot**，分別取得 Bot Token。不能使用同一個 Bot 的兩組 Token。
2. 在各 Application 的 OAuth2 設定建立含 `bot` scope 的邀請連結，將兩隻 Bot 邀請至同一伺服器。
3. 在目標頻道授予每隻 Bot **查看頻道（View Channel）與連接（Connect）** 權限。此版不發送語音，不要求 Administrator 或 Speak。
4. 開啟 Discord「使用者設定 → 進階 → 開發者模式」，複製伺服器 ID，以及兩個 **一般語音頻道** ID。舞台頻道不支援。
5. 在 PulseMic「設定」輸入伺服器 ID、Channel A/B ID、兩個 Bot Token，點擊「驗證並保存設定」。
6. 驗證確認兩個不同身分、伺服器、頻道種類及兩隻 Bot 對兩個來源的權限；成功後顯示 **實際伺服器與頻道名稱**。
7. Bot 登入後不自動加入語音。到控制台選擇目標來源，再產生授權碼、另開音源輸出頁，點「開始監聽」啟用瀏覽器音訊。

目前只使用 `Guilds` / `GuildVoiceStates` intents，不需要 Message Content 或 Server Members 特權 intent。成員資料來自語音頻道狀態與 Discord 快取。

## 操作

- **Bot A/B** 是獨立 Discord 身分；**Channel A/B** 是兩個可設定來源。任一 Bot 可選任一來源。
- 每路主標題顯示實際頻道名稱，次要資訊顯示「機器人 A · 來源 Channel B」等身分與來源。長名稱主標題換行，派遣按鈕可透過 hover 查看完整名稱。
- **開啟語音**：加入上次選定來源；**關閉語音**：退出頻道、停止收音，Bot 保持 Discord 在線。
- 派遣按鈕同時顯示來源代號和實際頻道名稱。按下來源會直接加入／切換到該來源。
- 切換立即撤下舊音源，顯示「正在切換至…」；後端確認語音連線 Ready 且 Bot 位於目標頻道後才顯示「正在收聽」。處理中同一路不能重複下指令。
- 退出、連線失敗或重連時清除正在收聽的頻道與成員；錯誤顯示原因。斷線嘗試三次恢復，失敗後提供重試。
- Discord 頻道重新命名時更新設定、派遣目標與收聽標題。頻道刪除後停止該路並要求重新驗證。
- 成員依 Discord 使用者 ID 識別；同名成員顯示 ID 尾碼並可分別控制，自己派遣的兩隻 Bot 不列入成員。
- 個別音量 **0–200%**，預設 100%；依使用者 ID 保存於此瀏覽器的 `pulsemic.mix.v1` localStorage。成員重新加入、頁面重新整理後沿用；換瀏覽器不共用。
- 單路音量／靜音、單獨監聽、耳機總音量 **0–100%**、全部靜音都只影響 PulseMic 播放，不改變 Discord 音量。控制台操作同步各輸出頁，輸出頁操作影響當前裝置；個別／單路靜音設定依瀏覽器保存，新輸出也會套用本次控制台已同步的混音設定。
- 發言亮框依 Discord speaking 狀態；音量表讀取各成員 Web Audio 音源（個別增益後、單路／總增益前），不是語音通過驗證或端到端延遲指標。
- **停止監聽**僅關閉耳機播放，不讓 Bot 退出。**開始監聽**須由使用者點擊以啟用瀏覽器 AudioContext；首次開啟頁面不自動播放。
- 兩 Bot 同頻道時，A 路優先播放；另一隻顯示「同頻道備援 · 由 A 路播放一份音訊」。A 退出或斷線時 B 接手。來源代號不同但 ID 相同也會去重。單路／solo 操作以當下標示的播放路為準。
- 示範模式使用明確標示的虛構資料。先派遣、開始監聽，再按「播放示範測試音」可聽到低音量本機音調；只對每個播放路的第一位示範成員產生音源。切換模式退出兩路語音。

## 憑證與本機保存

Token 只從本機設定頁傳給 localhost 後端，**不回傳至瀏覽器、不存 localStorage、不寫入日誌或原始碼**。設定頁的 Token 欄位保存成功後清空；留白可以沿用本機已保存的該 Bot 憑證。

設定（包括 Token 和上次來源）使用 **Windows DPAPI CurrentUser** 加密，保存至 `%LOCALAPPDATA%\PulseMic\credentials.secrets`，不在 Git 專案內。保存採序列化與原子檔案取代。

**移轉電腦或 Windows 使用者後，重新輸入兩個 Token，不複製舊加密檔案。** 無法解密時會提示重新輸入，不改存明文。不使用 `.env` 保存 Token。此版憑證持久化只支援 Windows。

本機 API 有工作階段驗證、Host / Origin 限制；WebRTC 僅使用 loopback ICE，沒有公共 STUN/TURN。停止後端會銷毀 voice connection 與 Bot client。音訊不寫磁碟，也不傳到其他 Discord 頻道。

控制服務中斷或另一頁接手後，舊控制台立即停止音訊、清除上次頻道並顯示「頻道狀態待確認」，不推定 Bot 已退出。恢復控制連線後重新取得後端狀態。

## 技術結構

```text
server/driver.ts   Discord 登入、權限、成員與逐人 Opus 訂閱
server/service.ts  雙 Bot 狀態機、切換、重連與同頻道播放權
server/media.ts    每成員獨立 Opus RTP → WebRTC / SRTP
server/store.ts    Windows DPAPI 憑證保存
server/access.ts   登入工作階段、OAuth state、一次性輸出授權
server/output.ts   遠端逐成員 Opus / WSS 輸出與壅塞限制
server/index.ts    localhost HTTP、公網登入、WebSocket 控制與安全限制
shared/types.ts   Bot / 來源 / 狀態模型
src/audio.ts      WebRTC → 個別 gain / analyser → 單路 gain → 總 gain → limiter
src/App.tsx       繁體中文導播控制、獨立輸出混音與本機設定
src/AccessPage.tsx Discord 登入首頁、一次性輸出授權入口
public/brand/     原始主 Logo 與圖示；頁首、設定與 favicon
scripts/          Windows 啟動流程
tests/            狀態、加密、安全、瀏覽器與本機 WebRTC 測試
```

React / TypeScript / Vite；Node.js / TypeScript / discord.js；`@discordjs/voice` **0.19.2** 包含 `@snazzah/davey`，保持預設 DAVE 加密啟用。逐人 Opus 直接送至 werift WebRTC，不先在後端解碼或混成單一音軌；由瀏覽器解碼。自帶 Noto Sans TC / Barlow 字體，不需要外部字體網路請求。

[Discord VoiceReceiver 文件](https://discord.js.org/docs/packages/voice/0.19.2/VoiceReceiver:Class)說明逐人訂閱輸出 Opus；[voice 套件文件](https://github.com/discordjs/discord.js/tree/main/packages/voice)指出 Discord 未公開收音協定，收音穩定性須以真實環境驗證。

## 驗證範圍

已建立自動測試：Bot／來源不同、實際名稱、切換等待與撤除舊音源、重新命名、成員 ID、同頻道去重與接手、斷線恢復／失敗重試、啟動不加入語音、Token 不回傳、Windows DPAPI 保存／讀回／錯誤處理，以及本機 API 邊界。

瀏覽器測試使用 Edge，檢查桌面／390 px 窄螢幕、示範派遣、個別音量／靜音、保存、同頻道播放接手、停止監聽不退出 Bot、鍵盤焦點與 console。另以真實 localhost WebRTC 連線驗證兩個獨立 Opus 音軌封包接收；這不是 Discord 收音驗證。

2026-10-11 本機驗證：型別檢查與正式版建置通過；22 項 Node 測試與 11 項 Edge／HTTP／WebSocket 整合測試通過（含 320 px 長名稱、控制台與獨立輸出並存、重新整理要求新碼、授權碼重用與跨來源拒絕、公網匿名 API 拒絕、輸出授權不能控制 Bot、兩個獨立 WebRTC 音軌，以及 WebCodecs 解碼兩個獨立測試 Opus 音源）。測試封包不是 Discord 收音。Windows DPAPI 加密讀回、啟動檢查、直接執行 `.cmd` 開啟服務及重複啟動沿用服務均通過；新增 PowerShell 設定及 Tunnel 腳本語法檢查通過，OAuth 真實登入尚待本機填入憑證。服務實際只監聽 `127.0.0.1:3210`。

公網發布狀態：已在 `pulse-studio.live` 的 Cloudflare zone 新增專用 `mic` CNAME（Proxy），PulseMic 專用 Tunnel 已啟動。實測 HTTPS 首頁／輸出入口回傳 200，匿名 session／state 回傳 401／403；正式網域的授權碼兌換及輸出 WSS 連線通過、重用同碼回傳 403。Edge 桌面與 390 px 窄螢幕無溢出、無 console 錯誤。OAuth 尚未填入憑證，因此公網控制台維持拒絕登入，未宣稱真實 Discord 登入／收音完成。現有 cloudflared 管理憑證選取的是另一個 zone，DNS 已由目標 zone 的已登入管理頁確認建立；誤建至其他 zone 的紀錄已撤回並確認不存在，未修改或重啟其他產品的 Tunnel。

**尚待真實 Discord 驗證**（需要你在本機輸入兩個 Token，以及測試人員）：

- 雙 Bot 在真實伺服器／DAVE 語音環境逐人收音與頭像／成員同步。
- 成員加入／離開、同名成員、音量／靜音／solo 的實際耳機聽感。
- 頻道切換、重新命名、同頻道去重與接手、網路中斷及恢復。
- **端到端延遲目標 <500 ms**：由說話者輸入到導播耳機輸出實測；WebSocket ping / WebRTC stats 不等於此結果。
- 依實際賽事人數連續至少 **兩小時**，記錄時間、成員數、掉音／重連、CPU／記憶體與聽感。測試報告不得包含 Token、加密檔、原始音訊或設定頁憑證截圖。

第一版不包含 OBS 整合、錄音或 Discord 語音轉送；後端仍在 Windows 本機執行。正式賽事採用前完成上述真實測試，尤其遠端 WSS 經 Tunnel 的網路壅塞與實際延遲尚未驗證。

## Git 交付

目標儲存庫：[PULSEMiloTW/PulseMic](https://github.com/PULSEMiloTW/PulseMic)，初始分支 `main`。每次修改完成必要檢查後，僅 commit / push 本次任務檔案；不提交 `dist`、`node_modules`、憑證、使用者資料、測試截圖或日誌。
