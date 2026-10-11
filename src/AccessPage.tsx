import { useEffect, useState, type FormEvent } from "react";
import { App } from "./App";

export function AccessPage() {
  const caster = location.pathname === "/caster-output";
  const output = location.pathname === "/output" || caster;
  const [token, setToken] = useState("");
  const [requester, setRequester] = useState("");
  const [requestNotice, setRequestNotice] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() => {
    const result = new URLSearchParams(location.search).get("login");
    return result === "denied"
      ? "此 Discord 帳號未被指定使用控制台。"
      : result
        ? "登入未完成，請確認本機 OAuth 設定後重試。"
        : "";
  });
  useEffect(() => {
    if (!output)
      void fetch("/api/access", { cache: "no-store" })
        .then((res) => res.json())
        .then((body) => setReady(body.loginReady))
        .catch(() => setError("服務暫時無法連線。"));
  }, [output]);
  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/auth/output", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: new FormData(form).get("code"),
          kind: caster ? "caster" : "players",
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "授權驗證失敗，請重試。");
      form.reset();
      setToken(body.token);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "連線失敗，請重試。",
      );
    } finally {
      setBusy(false);
    }
  }
  async function requestCode() {
    if (requestBusy) return;
    setRequestBusy(true);
    setError("");
    setRequestNotice("");
    try {
      const response = await fetch("/auth/output-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requester,
          kind: caster ? "caster" : "players",
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "要求失敗，請重試。");
      setRequestNotice(
        `要求編號 ${body.requestId}：授權碼已顯示於主機 CMD，請向主機操作員取得。`,
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "服務暫時無法連線。",
      );
    } finally {
      setRequestBusy(false);
    }
  }
  if (token)
    return (
      <App outputToken={token} outputKind={caster ? "caster" : "players"} />
    );
  return (
    <main className="access-page">
      <img
        src="/brand/PulseMic_MainLogo.png"
        width="289"
        height="96"
        alt="PulseMic"
      />
      <h1>
        {caster
          ? "Caster Desk 主播台輸出"
          : output
            ? "音源輸出"
            : "PulseMic 登入"}
      </h1>
      <p>
        {output
          ? "輸入這個輸出頁專用的一次性授權碼，開啟本次音源輸出。"
          : "以指定的 Discord 帳號登入，進入專屬後台或賽事語音控制台。"}
      </p>
      {output ? (
        <form onSubmit={(event) => void redeem(event)}>
          <label htmlFor="requester-name">要求者名稱</label>
          <input
            id="requester-name"
            value={requester}
            maxLength={80}
            autoComplete="name"
            onChange={(event) => setRequester(event.target.value)}
          />
          <button
            type="button"
            disabled={requestBusy || busy || !requester.trim()}
            onClick={() => void requestCode()}
          >
            {requestBusy ? "要求中…" : "獲取授權碼"}
          </button>
          {requestNotice ? <p role="status">{requestNotice}</p> : null}
          <label htmlFor="access-code">一次性授權碼</label>
          <input
            id="access-code"
            name="code"
            type="password"
            autoComplete="off"
            required
            maxLength={100}
            autoCapitalize="none"
            spellCheck={false}
          />
          <button className="primary" disabled={busy}>
            {busy ? "驗證中…" : "驗證並進入"}
          </button>
          <p>
            一碼只能使用一次，有效期限 5
            分鐘。重新整理或連線中斷後，請向導播取得新碼。單次播放最長 8 小時。
          </p>
        </form>
      ) : (
        <>
          {ready ? (
            <a className="access-login" href="/auth/discord">
              使用 Discord 登入
            </a>
          ) : (
            <p role="status">Discord 登入尚待本機設定完成。</p>
          )}
          <a href="/status">查看系統狀態</a>
          <a href="/output">前往選手音源輸出頁</a>
          <a href="/caster-output">前往主播台音源輸出頁</a>
        </>
      )}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </main>
  );
}
