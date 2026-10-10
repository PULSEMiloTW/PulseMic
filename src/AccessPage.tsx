import { useEffect, useState, type FormEvent } from "react";
import { App } from "./App";

export function AccessPage() {
  const output = location.pathname === "/output";
  const [token, setToken] = useState("");
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
        body: JSON.stringify({ code: new FormData(form).get("code") }),
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
  if (token) return <App outputToken={token} />;
  return (
    <main className="access-page">
      <img
        src="/brand/PulseMic_MainLogo.png"
        width="289"
        height="96"
        alt="PulseMic"
      />
      <h1>{output ? "音源輸出" : "導播登入"}</h1>
      <p>
        {output
          ? "輸入導播提供的一次性授權碼，開啟本次音源輸出。"
          : "以指定的 Discord 帳號登入，進入賽事語音控制台。"}
      </p>
      {output ? (
        <form onSubmit={(event) => void redeem(event)}>
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
          <a href="/output">前往音源輸出頁</a>
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
