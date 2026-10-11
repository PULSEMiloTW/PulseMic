import { useEffect, useState } from "react";
import type { StatusReport, StatusComponent } from "../shared/types";
const labels: Record<StatusComponent["status"], string> = {
  healthy: "運作正常",
  idle: "待命／未派遣",
  unknown: "資料不足／未設定",
  degraded: "連線異常",
  demo: "示範模式",
};
export function StatusPage() {
  const [report, setReport] = useState<StatusReport>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    document.title = "PulseMic Status";
    let active = true;
    let pending = false;
    const update = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (active) {
          setReport(data);
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      } finally {
        pending = false;
      }
    };
    void update();
    const timer = setInterval(() => void update(), 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const overall = failed
    ? "無法取得最新狀態"
    : !report
      ? "正在取得系統狀態"
      : report.components.some((c) => c.status === "degraded")
        ? "部分連線異常"
        : report.components.some(
              (c) => c.status === "unknown" || c.status === "demo",
            )
          ? "部分元件待確認"
          : "系統運作正常";
  const end = report?.updated ?? Date.now();
  const bars = Array.from({ length: 24 }, (_, i) => {
    const start = end - (24 - i) * 3600000;
    const records =
      report?.history.filter(
        (row) => row.time >= start && row.time < start + 3600000,
      ) ?? [];
    const status = !records.length
      ? "unknown"
      : records.some((row) => row.status === "degraded")
        ? "degraded"
        : records.some((row) => row.status === "unknown")
          ? "unknown"
          : "healthy";
    return { start, status, count: records.length };
  });
  return (
    <main className="status-page">
      <header>
        <a href="/">
          <img
            src="/brand/PulseMic_MainLogo.png"
            alt="PulseMic"
            width="217"
            height="72"
          />
        </a>
        <nav>
          <a href="/console">控制台</a>
          <a href="#history">觀測歷史</a>
        </nav>
      </header>
      <section className="status-overview">
        <div className="status-mark" aria-hidden="true">
          ◉
        </div>
        <h1>{overall}</h1>
        <p>
          {report
            ? `最後更新 · ${new Date(report.updated).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}`
            : "等待服務回應"}{" "}
          · 每 60 秒更新
        </p>
        {failed ? (
          <p role="alert">
            連線中斷期間為未知；下方若保留資料，代表上次成功更新的紀錄。
          </p>
        ) : null}
      </section>
      <section className="status-summary">
        <div>
          <span>服務元件</span>
          <strong>{report?.components.length ?? "—"}</strong>
        </div>
        <div>
          <span>本次啟動 HTTP 請求</span>
          <strong>{report?.requests ?? "—"}</strong>
        </div>
        <div>
          <span>5xx 錯誤</span>
          <strong>{report?.failures ?? "—"}</strong>
        </div>
        <div>
          <span>最近伺服器處理時間</span>
          <strong>
            {report?.lastLatency === null || !report
              ? "—"
              : `${report.lastLatency} ms`}
          </strong>
        </div>
      </section>
      <section className="status-components">
        <h2>服務元件</h2>
        {report?.components.map((component) => (
          <div className="status-component" key={component.id}>
            <strong>{component.name}</strong>
            <span className={`health-${component.status}`}>
              <i aria-hidden="true" />
              {labels[component.status]}
            </span>
          </div>
        ))}
      </section>
      <section id="history" className="status-history">
        <h2>最近 24 小時</h2>
        <div className="history-bars" role="list" aria-label="每小時觀測狀態">
          {bars.map((bar) => (
            <div
              key={bar.start}
              role="listitem"
              tabIndex={0}
              className={`health-${bar.status}`}
              title={`${new Date(bar.start).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })} · ${labels[bar.status as StatusComponent["status"]]} · ${bar.count} 次觀測`}
              aria-label={`${new Date(bar.start).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })} · ${labels[bar.status as StatusComponent["status"]]} · ${bar.count} 次觀測`}
            />
          ))}
        </div>
        <div className="history-scale">
          <span>24 小時前</span>
          <span>現在</span>
        </div>
        <p>每分鐘記錄一次；未啟動、缺少觀測及示範模式為未知。歷史保存 7 天。</p>
      </section>
      <footer>
        這是 PulseMic 主機內部狀態，無法驗證 Cloudflare、外部網路或實際 Discord
        收音品質。待命不代表故障；處理時間不是音訊延遲。
      </footer>
    </main>
  );
}
