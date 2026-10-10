# PulseMic

供賽事導播使用的 **Windows 本機 Discord 雙機器人耳機監聽系統**。兩個獨立 Bot 身分各自選擇 Channel A 或 B，每位成員保留獨立音源，在瀏覽器調整音量與靜音。

![PulseMic](public/brand/PulseMic_MainLogo.png)

## 啟動

需要 Windows 10/11、Node.js **22.12 以上**（建議 Node.js 24 LTS）、Edge 或 Chrome，以及可連接 Discord 的網路。

1. 在目前專案資料夾雙擊 **`00_啟動PulseMic.cmd`**。
2. 首次或套件 lockfile 更新後自動以 `npm ci` 安裝依賴；每次全新啟動會型別檢查並重新建置。
3. 瀏覽器開啟 **http://localhost:3210**。保留服務視窗；按 Ctrl+C 停止服務，兩隻 Bot 會登出。
4. 若服務已啟動，再次點擊只開啟控制台。不同應用占用連接埠時不會終止該應用。

控制服務僅綁定 `127.0.0.1`，不要透過反向代理或 Tunnel 公開。單一導播、單一控制台操作；開啟另一個控制台會接手，舊控制台停止音訊並提示重新整理。

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
7. Bot 登入後不自動加入語音。到「收聽」或「導播控制」選擇目標來源，再點「開始監聽」啟用瀏覽器音訊。

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
- 單路音量／靜音、單獨監聽、耳機總音量 **0–100%**、全部靜音都只影響 PulseMic 本機耳機。重新開啟頁面不保留緊急全部靜音或 solo 狀態；個別／單路靜音設定保留。
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
server/index.ts    localhost HTTP、WebSocket 控制與安全限制
shared/types.ts   Bot / 來源 / 狀態模型
src/audio.ts      WebRTC → 個別 gain / analyser → 單路 gain → 總 gain → limiter
src/App.tsx       繁體中文導播控制、收聽與設定
public/brand/     原始主 Logo 與圖示；頁首、設定與 favicon
scripts/          Windows 啟動流程
tests/            狀態、加密、安全、瀏覽器與本機 WebRTC 測試
```

React / TypeScript / Vite；Node.js / TypeScript / discord.js；`@discordjs/voice` **0.19.2** 包含 `@snazzah/davey`，保持預設 DAVE 加密啟用。逐人 Opus 直接送至 werift WebRTC，不先在後端解碼或混成單一音軌；由瀏覽器解碼。自帶 Noto Sans TC / Barlow 字體，不需要外部字體網路請求。

[Discord VoiceReceiver 文件](https://discord.js.org/docs/packages/voice/0.19.2/VoiceReceiver:Class)說明逐人訂閱輸出 Opus；[voice 套件文件](https://github.com/discordjs/discord.js/tree/main/packages/voice)指出 Discord 未公開收音協定，收音穩定性須以真實環境驗證。

## 驗證範圍

已建立自動測試：Bot／來源不同、實際名稱、切換等待與撤除舊音源、重新命名、成員 ID、同頻道去重與接手、斷線恢復／失敗重試、啟動不加入語音、Token 不回傳、Windows DPAPI 保存／讀回／錯誤處理，以及本機 API 邊界。

瀏覽器測試使用 Edge，檢查桌面／390 px 窄螢幕、示範派遣、個別音量／靜音、保存、同頻道播放接手、停止監聽不退出 Bot、鍵盤焦點與 console。另以真實 localhost WebRTC 連線驗證兩個獨立 Opus 音軌封包接收；這不是 Discord 收音驗證。

2026-10-11 本機驗證：型別檢查與正式版建置通過；19 項 Node 測試與 6 項 Edge 瀏覽器測試通過（含 320 px 長名稱、控制台接手與兩個獨立 WebRTC 音軌）。Windows DPAPI 加密讀回、啟動檢查、直接執行 `.cmd` 開啟服務及重複啟動沿用服務均通過；服務實際只監聽 `127.0.0.1:3210`。

**尚待真實 Discord 驗證**（需要你在本機輸入兩個 Token，以及測試人員）：

- 雙 Bot 在真實伺服器／DAVE 語音環境逐人收音與頭像／成員同步。
- 成員加入／離開、同名成員、音量／靜音／solo 的實際耳機聽感。
- 頻道切換、重新命名、同頻道去重與接手、網路中斷及恢復。
- **端到端延遲目標 <500 ms**：由說話者輸入到導播耳機輸出實測；WebSocket ping / WebRTC stats 不等於此結果。
- 依實際賽事人數連續至少 **兩小時**，記錄時間、成員數、掉音／重連、CPU／記憶體與聽感。測試報告不得包含 Token、加密檔、原始音訊或設定頁憑證截圖。

第一版不包含 OBS 輸出、錄音、語音轉送或雲端部署。正式賽事採用前完成上述真實測試。

## Git 交付

目標儲存庫：[PULSEMiloTW/PulseMic](https://github.com/PULSEMiloTW/PulseMic)，初始分支 `main`。每次修改完成必要檢查後，僅 commit / push 本次任務檔案；不提交 `dist`、`node_modules`、憑證、使用者資料、測試截圖或日誌。
