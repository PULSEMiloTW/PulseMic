import { useEffect, useRef, useState } from "react";
import type { LogEntry } from "../shared/types";
function useUnsaved() {
  const dirty = useRef(false);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (dirty.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, []);
  return dirty;
}
type Request = (path: string, body: unknown) => Promise<unknown>;
export function OperatorSettings({ request }: { request: Request }) {
  const dirty = useUnsaved();
  const [ready, setReady] = useState(false);
  const [users, setUsers] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [owner, setOwner] = useState("");
  useEffect(() => {
    let active = true;
    void fetch("/api/session")
      .then((r) => r.json())
      .then((auth) =>
        fetch("/api/admin/operators", {
          headers: { "X-PulseMic-Session": auth.session },
        }),
      )
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((body) => {
        if (active) {
          setUsers(body.users.join("\n"));
          setOwner(body.ownerId);
          setReady(true);
        }
      })
      .catch(() => active && setMessage("無法讀取操作員名單。"));
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="operator-settings">
      <h2>控制台人員</h2>
      <p>擁有者 · {owner}</p>
      <form
        onChange={() => {
          dirty.current = true;
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setMessage("");
          void request("/api/admin/operators", {
            users: users.split(/[\s,，]+/).filter(Boolean),
          })
            .then(() => {
              dirty.current = false;
              setMessage("人員權限已保存，移除的人員立即失去控制權。");
            })
            .catch(() => setMessage("保存失敗，請確認 Discord ID。"))
            .finally(() => setBusy(false));
        }}
      >
        <label htmlFor="operator-ids">
          可進入控制台的 Discord User ID（每行一位）
        </label>
        <textarea
          disabled={!ready || busy}
          id="operator-ids"
          rows={5}
          value={users}
          onChange={(event) => setUsers(event.target.value)}
          maxLength={2100}
        />
        <button disabled={busy || !ready}>
          {busy ? "保存中…" : "保存人員權限"}
        </button>
      </form>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
export function RuntimeLogs({
  request,
  connected,
}: {
  request: Request;
  connected: boolean;
}) {
  const [rows, setRows] = useState<LogEntry[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!connected) return;
    let active = true;
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const auth = await fetch("/api/session");
        if (!auth.ok) throw new Error();
        const session = await auth.json();
        const result = await fetch("/api/logs", {
          headers: { "X-PulseMic-Session": session.session },
          cache: "no-store",
        });
        if (!result.ok) throw new Error();
        const data = await result.json();
        if (active) {
          setRows(data);
          setError("");
        }
      } catch {
        if (active) setError("日誌暫時無法更新。");
      } finally {
        pending = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [connected, request]);
  return (
    <section id="logs" className="runtime-logs">
      <h2>運行日誌</h2>
      {error ? <p role="status">{error}</p> : null}
      <div className="log-scroll" tabIndex={0} aria-label="運行日誌紀錄">
        {rows.length ? (
          [...rows].reverse().map((row) => (
            <div className="log-row" key={row.id}>
              <time dateTime={new Date(row.time).toISOString()}>
                {new Date(row.time).toLocaleTimeString("zh-TW", {
                  timeZone: "Asia/Taipei",
                  hour12: false,
                })}
              </time>
              <span>{row.level === "warning" ? "警告" : "資訊"}</span>
              <p>{row.message}</p>
            </div>
          ))
        ) : (
          <p>尚無運行紀錄</p>
        )}
      </div>
    </section>
  );
}

export function OAuthSettings({ request }: { request: Request }) {
  const dirty = useUnsaved();
  const [ready, setReady] = useState(false);
  const [clientId, setClientId] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    void fetch("/api/session")
      .then((r) => r.json())
      .then((auth) =>
        fetch("/api/admin/oauth", {
          headers: { "X-PulseMic-Session": auth.session },
        }),
      )
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((body) => {
        if (active) {
          setClientId(body.clientId);
          setSaved(body.secretSaved);
          setReady(true);
        }
      })
      .catch(() => active && setMessage("無法讀取 OAuth 設定。"));
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="operator-settings">
      <h2>Discord 登入設定</h2>
      <form
        onChange={() => {
          dirty.current = true;
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          const form = event.currentTarget;
          const data = new FormData(form);
          setBusy(true);
          setMessage("");
          void request("/api/admin/oauth", {
            clientId,
            clientSecret: data.get("clientSecret"),
          })
            .then(() => {
              (
                form.elements.namedItem("clientSecret") as HTMLInputElement
              ).value = "";
              dirty.current = false;
              setSaved(true);
              setMessage("登入設定已加密保存。");
            })
            .catch(() => setMessage("保存失敗，請確認登入設定。"))
            .finally(() => setBusy(false));
        }}
      >
        <label htmlFor="oauth-client">OAuth Client ID</label>
        <input
          disabled={!ready || busy}
          id="oauth-client"
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          required
          pattern="[0-9]{17,20}"
        />
        <label htmlFor="oauth-secret">OAuth Client Secret</label>
        <input
          disabled={!ready || busy}
          id="oauth-secret"
          name="clientSecret"
          type="password"
          autoComplete="off"
          required={!saved}
          maxLength={256}
          placeholder={saved ? "已保存；留空沿用" : "輸入 Client Secret"}
        />
        <button disabled={busy || !ready}>
          {busy ? "保存中…" : "保存登入設定"}
        </button>
      </form>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
