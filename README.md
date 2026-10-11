# PulseMic

已確認的必要產品需求集中於 [REQUIREMENTS.md](REQUIREMENTS.md)。登入首頁採 PulseVeto 左側品牌、右側登入的版型，內容與入口使用 PulseMic 的 Discord 授權及獨立音源流程。桌面品牌圖示、光點與來源卡片緩慢浮動，可用「暫停動畫」停止；系統減少動畫設定停用進場及浮動，窄螢幕隱藏裝飾動畫。裝飾效果不代表 Bot 已連線或正在發言。

供賽事導播使用的 **Windows 本機 Discord 選手雙機器人與主播台監聽系統**。兩個獨立 Bot 身分各自選擇 Channel A 或 B，另以第三個 **PulseMic Caster Desk** Bot 收取主播／賽評音源。每位成員保留獨立音源，在瀏覽器調整音量與靜音。

![PulseMic](public/brand/PulseMic_MainLogo.png)

## 啟動

需要 Windows 10/11、Node.js **22.12 以上**（建議 Node.js 24 LTS）、Edge 或 Chrome，以及可連接 Discord 的網路。

1. 在目前專案資料夾雙擊 **`00_啟動PulseMic.cmd`**，同時檢查並啟動 PulseMic 與專用 Tunnel。兩者獨立判斷：已有服務或 Tunnel 時只啟動缺少的一個；兩者都有則只開啟控制台。不會停止其他專案的程序。專用 Tunnel 必須先完成 `.local/cloudflared.yml` 設定。
2. 首次或套件 lockfile 更新後自動以 `npm ci` 安裝依賴；每次全新啟動會型別檢查並重新建置。
3. 瀏覽器開啟 **http://localhost:3210/console**。保留服務視窗；按 Ctrl+C 停止服務，所有已設定 Bot 會登出。
4. 若服務與 Tunnel 都已啟動，再次點擊只開啟控制台。不同應用占用連接埠時不會終止該應用。服務與 Tunnel 使用各自的 CMD 視窗，請保持兩者開啟；授權碼顯示在服務 CMD。

控制服務僅綁定 `127.0.0.1`，公網僅支援專用 Cloudflare Tunnel 的 `mic.pulse-studio.live`。公網控制台需 Discord 指定帳號登入，輸出頁需一次性授權碼。localhost 與公網控制台皆需 Discord 登入；本機登入會導向正式 HTTPS 網域，瀏覽器 Cookie 不跨主機分享。另一個控制台會接手；獨立輸出頁不會接管控制台。

## 網域登入與獨立音源輸出

- `https://mic.pulse-studio.live/`：Discord 登入首頁。
- `/admin`：擁有者專屬後台，僅 Discord ID `1456945476933914626` 可進入。設定選手 A/B 與 Caster Token、伺服器／來源、OAuth Client ID／Secret，以及控制台人員名單。機密值保存後清空，永不讀回瀏覽器。
- `/console`：擁有者及其指定操作員的音控台；未指定帳號在後端拒絕登入、API 與控制 WebSocket。操作員無連線設定或人員管理權限。
- `/output`：選手 A/B 音源輸出頁。收聽者由輸出登入頁要求授權碼，主機操作員查看 CMD 後私下交付；收聽者輸入後點「開始監聽」。控制台本身不播放音訊，輸出頁無 Bot 操作權限。
- `/console` 同頁並列選手 A/B 與 PulseMic Caster Desk；下方只提供兩種輸出頁的新分頁連結與運行日誌；連線設定移至 `/admin`。主播台仍使用第三個獨立 Bot 與獨立輸出頁。
- `/caster-output`：主播台獨立輸出頁；必須使用主播台專用授權碼。選手與主播台授權碼、播放授權和 WebSocket 來源互不通用，輸出頁只收到所屬來源。
- 新版要求授權功能需要重新啟動後端。`00_啟動PulseMic.cmd` 先以 PowerShell 檢查依賴與建置，再由 CMD 直接執行 Node 後端；該 CMD 就是實際服務終端，請保持視窗開啟；已在其他終端執行的服務需先停止，再由此啟動，不能用第二個視窗取得原程序 stdout。重啟會退出語音並撤銷現有授權。
- 輸出登入頁填「要求者名稱」後按「獲取授權碼」，主機 CMD 會顯示一次性碼、要求編號、UTC 時間、輸出種類、IP 與瀏覽器資訊。名稱為自行填寫，不能作為身分驗證；操作員確認後私下交付授權碼。網頁只取得要求編號，同一 IP 每分鐘限一次。此授權碼刻意只輸出至主機終端，不寫入應用程式檔案；請勿將終端內容存入 Git 或分享完整截圖。
- 一碼只兌換一次，5 分鐘內有效。播放授權只在當前頁面記憶體中，僅可開啟一條輸出連線，最長 8 小時；重新整理、離開或斷線後需新碼。授權碼不放入網址、Cookie 或 localStorage，服務重啟會撤銷所有登入、授權碼與播放授權。
- 選手與主播台有獨立混音設定，音量、靜音及 solo 同步到各自已連線的輸出頁；輸出頁也可自行調整目前裝置的播放音量。停止播放不影響 Bot 所在頻道。控制台頂部「全部靜音」會停止選手與主播台所有輸出，取消後恢復原先的個別／單路／總音量；輸出頁的「本頁靜音」只影響目前裝置。
- 本機輸出保留逐成員 Opus / WebRTC；遠端輸出以 HTTPS/WSS 傳送逐成員 Opus，由瀏覽器 WebCodecs 解碼，再以 Web Audio 分別調音。需要支援 Opus AudioDecoder 的新版 Edge／Chrome。不預先混音。網路壅塞時停止輸出並要求新碼，避免累積延遲。
- Bot／OAuth 機密值只允許登入擁有者在 `https://mic.pulse-studio.live/admin` 輸入，透過 HTTPS 送到 Windows 後端，以 DPAPI 保存；不沿用舊版 localhost 免登入設定權限。

### 入口與權限

擁有者登入後導向 `/admin`，指定操作員登入後導向 `/console`。側欄名稱與頭像取自 Discord `identify` 身分資料，角色由伺服器判定，不能由前端提交變更。擁有者固定且不可被人員名單移除；操作員 User ID 每行一位，保存於 `%LOCALAPPDATA%\PulseMic\operators.json`，一般操作員無法讀寫。撤銷後既有 WebSocket 立即關閉，後續 API 拒絕。專屬後台以 HTTP 輪詢狀態，不會接管音控台的 WebSocket。

`/status` 與 `/api/status` 公開顯示五個元件的內部狀態、這次啟動的 HTTP 計數／5xx／處理時間及最近 24 小時觀測。每分鐘保存一次，歷史保留 7 天於 `%LOCALAPPDATA%\PulseMic\status-history.json`；無紀錄、示範與未設定標示為未知，待命不是故障。這不是外部可用率或端到端音訊延遲測試，不提供伺服器／頻道名稱、Discord ID、IP、Token 或授權碼。

運行日誌僅登入控制人員可見，保留當次程序最近 200 筆操作／Bot 狀態變更，重啟清空，不寫磁碟。機密值、授權碼、原始錯誤與要求者 IP 不進入網頁日誌；輸出要求的授權碼仍僅顯示在實際 CMD。

### Discord OAuth 登入設定

1. 在 [Discord Developer Portal](https://discord.com/developers/applications) 建立登入用 Application（可與 Bot Application 共用，但 Client Secret 與 Bot Token 不同）。
2. OAuth2 的 Redirects 加入 **`https://mic.pulse-studio.live/auth/discord/callback`**；只使用 `identify` scope，不要求伺服器管理權限。
3. 雙擊 `01_設定Discord登入.cmd`，填入 Application ID 與隱藏輸入的 Client Secret；也可在本機專案 PowerShell 執行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\configure-oauth.ps1`。不要將 Secret 貼到聊天或提交 Git。
4. 設定以 Windows CurrentUser DPAPI 保存於 `%LOCALAPPDATA%\PulseMic\oauth.secrets`。首次透過 CMD 設定需重新啟動；已登入的擁有者在後台保存則立即供下一次登入使用。未設定、解密失敗或 Discord 驗證失敗時，公網維持拒絕登入。
5. 登入授權最長 8 小時，HttpOnly / Secure / SameSite Cookie；OAuth state 綁定瀏覽器且只能使用一次。登出後控制 API 立即拒絕，控制連線在下次心跳撤銷。

### Cloudflare Tunnel

本機使用專用 **PulseMic** Tunnel，設定在忽略於 Git 的 `.local/cloudflared.yml`，不修改其他產品的 Tunnel。平常雙擊 `00_啟動PulseMic.cmd` 即可檢查並啟動兩者。`02_啟動PulseMic網域.cmd`（或執行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-tunnel.ps1`）仍可單獨啟動缺少的 Tunnel，已運行時不重複啟動；兩個服務視窗都需保持開啟。也可依下面範本在新的電腦重新建立專用 Tunnel；憑證不能提交 Git。

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
# 正式服務正在使用時，先在隔離目錄建置與測試，不覆寫 live dist
npm run build:preview
$env:PULSEMIC_TEST_PREVIEW = "1"
npm run test:browser
```

## Discord 設定

1. 到 [Discord Developer Portal](https://discord.com/developers/applications) 建立 **兩個 Application / Bot**，分別取得 Bot Token。不能使用同一個 Bot 的兩組 Token。
2. 在各 Application 的 OAuth2 設定建立含 `bot` scope 的邀請連結，將兩隻 Bot 邀請至同一伺服器。
3. 在目標頻道授予每隻 Bot **查看頻道（View Channel）與連接（Connect）** 權限。此版不發送語音，不要求 Administrator 或 Speak。
4. 開啟 Discord「使用者設定 → 進階 → 開發者模式」，複製伺服器 ID，以及兩個 **一般語音頻道** ID。舞台頻道不支援。
5. 在 PulseMic「設定」輸入伺服器 ID、Channel A/B ID、兩個 Bot Token，點擊「驗證並保存設定」。
6. 驗證確認兩個不同身分、伺服器、頻道種類及兩隻 Bot 對兩個來源的權限；成功後顯示 **實際伺服器與頻道名稱**。
7. Bot 登入後不自動加入語音。到控制台選擇目標來源、另開音源輸出頁並要求授權碼，點「開始監聽」啟用瀏覽器音訊。

### PulseMic Caster Desk

1. 另建第三個 Discord Bot，名稱設為 **PulseMic Caster Desk**；不可沿用選手 A/B 的 Bot 身分。邀請到所需伺服器，只需查看／連接主播台的一般語音頻道。
2. 以擁有者 Discord 帳號開啟 `https://mic.pulse-studio.live/admin`，輸入主播台伺服器 ID、語音頻道 ID 與第三個 Bot Token，按「保存並驗證主播台」。Token 不回傳至瀏覽器；保存後欄位清空，留空可沿用。
3. 主播台憑證獨立以 CurrentUser DPAPI 保存於 `%LOCALAPPDATA%\PulseMic\caster.secrets`；選手仍使用 `credentials.secrets`。移轉電腦須重新輸入。
4. 成功後顯示 Discord 實際伺服器與頻道名稱。按「開啟主播台語音」才加入；首次啟動不自動加入。關閉僅退出語音，保持 Discord 在線。
5. 於同一工作區調整主播／賽評個別音量、靜音與主播台總音量，另開 `/caster-output` 要求主播台專用授權碼，輸入後點「開始監聽」。每位成員保留獨立音源，所有自己派遣的 Bot 均不列入可監聽成員。
6. 「演練主播台介面」是獨立示範模式，不改變選手 A/B 的派遣。若正在正式收音，請勿切換至示範模式。

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

Token 只從擁有者專屬後台透過 HTTPS 傳給 Windows 後端，**不回傳至瀏覽器、不存 localStorage、不寫入日誌或原始碼**。設定頁的 Token 欄位保存成功後清空；留白可以沿用本機已保存的該 Bot 憑證。

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
src/App.tsx       繁體中文導播控制、擁有者後台與獨立輸出混音
src/AccessPage.tsx Discord 登入首頁、一次性輸出授權入口
public/brand/     原始主 Logo 與圖示；頁首、設定與 favicon
scripts/          Windows 啟動流程
tests/            狀態、加密、安全、瀏覽器與本機 WebRTC 測試
```

React / TypeScript / Vite；Node.js / TypeScript / discord.js；`@discordjs/voice` **0.19.2** 包含 `@snazzah/davey`，保持預設 DAVE 加密啟用。逐人 Opus 直接送至 werift WebRTC，不先在後端解碼或混成單一音軌；由瀏覽器解碼。自帶 Noto Sans TC / Barlow 字體，不需要外部字體網路請求。

[Discord VoiceReceiver 文件](https://discord.js.org/docs/packages/voice/0.19.2/VoiceReceiver:Class)說明逐人訂閱輸出 Opus；[voice 套件文件](https://github.com/discordjs/discord.js/tree/main/packages/voice)指出 Discord 未公開收音協定，收音穩定性須以真實環境驗證。

## 驗證範圍

已建立自動測試：Bot／來源不同、實際名稱、切換等待與撤除舊音源、重新命名、成員 ID、同頻道去重與接手、斷線恢復／失敗重試、啟動不加入語音、Token 不回傳、Windows DPAPI 保存／讀回／錯誤處理，以及 Host／Origin／角色／工作階段 API 邊界。

瀏覽器測試使用 Edge，檢查桌面／390 px 窄螢幕、示範派遣、個別音量／靜音、保存、同頻道播放接手、停止監聽不退出 Bot、鍵盤焦點與 console。另以真實 localhost WebRTC 連線驗證兩個獨立 Opus 音軌封包接收；這不是 Discord 收音驗證。

2026-10-11 更新檢查：型別檢查、正式版建置及隔離預覽建置通過；30 項 Node 測試、15 項 Edge／HTTP／WebSocket 整合測試通過，Windows 啟動檔 preflight 通過。本次分開擁有者／操作員入口、公開狀態頁與運行日誌，控制台保留三路音控及新分頁輸出連結；示範標記保留於音源，避免混淆真實連線。測試涵蓋主播台單 Bot、頻道重新命名、Bot 身分保留／衝突、Windows 主播台加密設定、輸出授權範圍、主播台獨立混音、全域緊急靜音與 320／390 px 版面測試。測試音／封包不代表 Discord 收音。

本次版本已由可見 CMD 發布。發布時 PulseMic 與其專用 Tunnel 原本均已停止，依發布授權啟動兩者；其他服務未變動。公開 `/status`／`/api/status` 回傳 200，匿名控制台／後台導向登入，匿名 session／identity／state／settings 回傳 401／403。已透過真實 Discord 帳號完成擁有者登入，驗證 `/admin` 導向與 MiloTW 名稱／頭像；操作員撤銷與權限隔離使用測試身分驗證，尚待真實指定操作員實測。重啟撤銷舊登入與輸出授權，Bot 保持待命不自動加入語音。OAuth 與 Bot 憑證不納入 Git，以上不代表真實收音通過。

**尚待真實 Discord 驗證**（需要你在專屬後台輸入選手與主播台共三個 Token，以及測試人員）：

- 雙 Bot 在真實伺服器／DAVE 語音環境逐人收音與頭像／成員同步。
- 成員加入／離開、同名成員、音量／靜音／solo 的實際耳機聽感。
- 頻道切換、重新命名、同頻道去重與接手、網路中斷及恢復。
- **端到端延遲目標 <500 ms**：由說話者輸入到導播耳機輸出實測；WebSocket ping / WebRTC stats 不等於此結果。
- 依實際賽事人數連續至少 **兩小時**，記錄時間、成員數、掉音／重連、CPU／記憶體與聽感。測試報告不得包含 Token、加密檔、原始音訊或設定頁憑證截圖。

第一版不包含 OBS 整合、錄音或 Discord 語音轉送；後端仍在 Windows 本機執行。正式賽事採用前完成上述真實測試，尤其遠端 WSS 經 Tunnel 的網路壅塞與實際延遲尚未驗證。

## Git 交付

目標儲存庫：[PULSEMiloTW/PulseMic](https://github.com/PULSEMiloTW/PulseMic)，初始分支 `main`。每次修改完成必要檢查後，僅 commit / push 本次任務檔案；不提交 `dist`、`node_modules`、憑證、使用者資料、測試截圖或日誌。
