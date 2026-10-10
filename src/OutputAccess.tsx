import { useState } from "react";
import type { OutputKind } from "../shared/types";

export function OutputAccess({
  kind,
  connected,
  request,
}: {
  kind: OutputKind;
  connected: boolean;
  request: (
    path: string,
    body: unknown,
  ) => Promise<{ code: string; expires: number }>;
}) {
  const [grant, setGrant] = useState<{ code: string; expires: number }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const name = kind === "caster" ? "主播台" : "選手雙路";
  return (
    <section className="output-access" aria-label={`${name}輸出授權`}>
      <div>
        <h2>{name} · 獨立輸出</h2>
        <p>專用授權碼，單次使用。重新整理需取新碼；控制台持續在線。</p>
      </div>
      <div className="output-actions">
        <a
          className="output-link"
          href={kind === "caster" ? "/caster-output" : "/output"}
          target="_blank"
          rel="noopener"
        >
          開啟{name}輸出 ↗
        </a>
        <button
          disabled={!connected || busy}
          onClick={() => {
            if (busy) return;
            setBusy(true);
            setMessage("");
            void request("/api/output-code", { kind })
              .then(setGrant)
              .catch(() => setMessage("無法產生授權碼，請重試。"))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "產生中…" : "產生一次性授權碼"}
        </button>
      </div>
      {grant ? (
        <div className="issued-code">
          <label htmlFor={`code-${kind}`}>
            {name}專用 ·{" "}
            {new Date(grant.expires).toLocaleTimeString("zh-TW", {
              hour12: false,
            })}{" "}
            前使用
          </label>
          <div className="code-actions">
            <input
              id={`code-${kind}`}
              readOnly
              value={grant.code}
              onFocus={(event) => event.currentTarget.select()}
              autoComplete="off"
            />
            <button
              onClick={() =>
                void navigator.clipboard.writeText(grant.code).then(
                  () => setMessage("已複製，請私下交付。"),
                  () => setMessage("無法複製，請選取授權碼手動複製。"),
                )
              }
            >
              複製
            </button>
            <button
              onClick={() => {
                setGrant(undefined);
                setMessage("");
              }}
            >
              隱藏
            </button>
          </div>
        </div>
      ) : null}
      <p className="output-feedback" role="status">
        {message}
      </p>
    </section>
  );
}
