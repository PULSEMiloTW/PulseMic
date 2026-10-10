# PulseMic 開發規範

- 專案根目錄為目前 checkout，所有路徑由專案位置解析；不使用移轉前電腦路徑。
- React / TypeScript / Vite 前端；Node.js / TypeScript 本機後端。
- Bot A/B 是兩個獨立身分，Channel A/B 是可選來源；頻道名稱由 Discord 取得。
- 真實與示範模式明確區分。Windows 本機後端可透過專用 Cloudflare Tunnel 提供 mic.pulse-studio.live；控制台需指定 Discord 帳號，音源輸出需一次性授權碼。不加入錄音、OBS 或 Discord 語音轉送。
- 每位 Discord 使用者保留獨立 Opus / WebRTC 音源；只在瀏覽器 Web Audio 混音。同頻道只播放一路。
- 不提交 Token、加密憑證、使用者設定、生成輸出、測試截圖或執行日誌。
- 修改後執行相關測試、`npm run typecheck` 與 `npm run build`；UI 修改須檢查桌面、窄螢幕及 console。
- 必要檢查通過後 commit 本次修改並一般 push 至 `origin` (`https://github.com/PULSEMiloTW/PulseMic.git`) 的目前 upstream；首次專案建立使用 `main`。不 force push。
- 真實 Discord 收音、端到端延遲與至少兩小時穩定性，須有真實憑證與人員實測；不得以示範或封包測試取代。
