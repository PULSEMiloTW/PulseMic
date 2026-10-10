import { memo, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ids,
  laneStatus,
  laneTitle,
  type Lane,
  type LaneId,
  type Member,
  type MemberMix,
  type Mix,
  type Snapshot,
  type SourceId,
} from "../shared/types";
import { HeadphoneMixer } from "./audio";
import { readMix } from "./mix";
import { useControl } from "./useControl";

type Tab = "listen" | "control" | "settings";
function readTab(): Tab {
  const tab = new URLSearchParams(location.search).get("tab");
  return tab === "settings" || tab === "control" ? tab : "listen";
}
function Icon({
  name,
}: {
  name: "headphones" | "power" | "mute" | "settings" | "signal";
}) {
  const paths = {
    headphones: "M4 14v-3a8 8 0 0 1 16 0v3M4 13h3v7H4zM17 13h3v7h-3z",
    power: "M12 3v9M6 5a9 9 0 1 0 12 0",
    mute: "M11 5 6 9H3v6h3l5 4zM16 9l5 6M21 9l-5 6",
    settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
    signal: "M4 20v-4M9 20v-8M14 20V8M19 20V4",
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
function Volume({
  label,
  value,
  max = 200,
  onChange,
  compact = false,
}: {
  label: string;
  value: number;
  max?: number;
  onChange: (volume: number) => void;
  compact?: boolean;
}) {
  return (
    <label className={`volume ${compact ? "compact" : ""}`}>
      <span className="sr-only">{label}</span>
      <input
        aria-label={label}
        type="range"
        min="0"
        max={max}
        step="1"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>
        {value}
        <small>%</small>
      </output>
    </label>
  );
}
const MemberRow = memo(function MemberRow({
  member,
  lane,
  mix,
  audio,
  onChange,
  standby,
}: {
  member: Member;
  lane: LaneId;
  mix: MemberMix;
  audio: HeadphoneMixer;
  onChange: (id: string, value: MemberMix) => void;
  standby: boolean;
}) {
  return (
    <li
      className={`member ${member.speaking ? "speaking" : ""} ${mix.muted ? "member-muted" : ""}`}
    >
      <div className="avatar">
        {member.avatar ? (
          <img
            src={member.avatar}
            width="40"
            height="40"
            alt=""
            loading="lazy"
          />
        ) : (
          <span aria-hidden="true">{member.name.slice(0, 1)}</span>
        )}
      </div>
      <div className="member-info">
        <strong title={member.name}>{member.name}</strong>
        <span title={member.id}>
          {member.speaking ? "正在發言" : standby ? "備援音源" : "等待發言"}{" "}
          <small>· {member.id.slice(-4)}</small>
        </span>
        <div
          className="meter"
          role="img"
          aria-label={`${member.name} 音量表`}
          ref={(element) => audio.meter(`${lane}:${member.id}`, element)}
        >
          <i />
        </div>
      </div>
      <Volume
        compact
        label={`${lane} 路 ${member.name} ${member.id} 音量`}
        value={mix.volume}
        onChange={(volume) => onChange(member.id, { ...mix, volume })}
      />
      <button
        className={`square ${mix.muted ? "active-danger" : ""}`}
        aria-label={`${mix.muted ? "取消靜音" : "靜音"} ${lane} 路 ${member.name} ${member.id}`}
        aria-pressed={mix.muted}
        onClick={() => onChange(member.id, { ...mix, muted: !mix.muted })}
      >
        <Icon name="mute" />
      </button>
    </li>
  );
});
const defaultMember: MemberMix = { volume: 100, muted: false };
function SourceButtons({
  state,
  lane,
  busy,
  command,
}: {
  state: Snapshot;
  lane: Lane;
  busy: boolean;
  command: (
    id: LaneId,
    action: "open" | "close" | "switch",
    source?: SourceId,
  ) => void;
}) {
  return (
    <div className="source-buttons">
      {ids.map((source) => (
        <button
          key={source}
          disabled={busy || !state.validated || !state.sources[source].name}
          className={lane.selectedSource === source ? "selected" : ""}
          aria-pressed={lane.selectedSource === source}
          onClick={() => command(lane.id, "switch", source)}
        >
          <span>Channel {source}</span>
          <strong title={state.sources[source].name}>
            {state.sources[source].name || "請先驗證頻道"}
          </strong>
        </button>
      ))}
    </div>
  );
}
function LanePanel({
  state,
  id,
  mix,
  audio,
  pending,
  command,
  updateMix,
  updateMember,
}: {
  state: Snapshot;
  id: LaneId;
  mix: Mix;
  audio: HeadphoneMixer;
  pending: boolean;
  command: (
    id: LaneId,
    action: "open" | "close" | "switch",
    source?: SourceId,
  ) => void;
  updateMix: (next: Mix) => void;
  updateMember: (id: string, value: MemberMix) => void;
}) {
  const lane = state.lanes[id];
  const busy =
    pending ||
    ["connecting", "disconnecting", "reconnecting"].includes(lane.status);
  const standby = lane.playbackLane !== null && lane.playbackLane !== id;
  return (
    <section
      className={`lane lane-${id.toLowerCase()}`}
      aria-labelledby={`lane-${id}-title`}
    >
      <div className="lane-heading">
        <span className="lane-badge" aria-label={`${id} 路`}>
          {id}
        </span>
        <div>
          <h2 id={`lane-${id}-title`} title={laneTitle(lane)}>
            {laneTitle(lane)}
          </h2>
          <p>
            機器人 {id} · 來源 Channel {lane.selectedSource}
          </p>
        </div>
        <span className={`status ${lane.status === "error" ? "error" : ""}`}>
          {laneStatus(lane)}
        </span>
      </div>
      <div className="lane-meta">
        <span>
          {lane.botName}{" "}
          <small>
            ／
            {lane.status === "unknown"
              ? "Discord 狀態待確認"
              : state.mode === "demo"
                ? "示範 Bot 就緒"
                : lane.botOnline
                  ? "Discord 在線"
                  : "Discord 未連線"}
          </small>
        </span>
        <span>{lane.members.length} 位成員</span>
      </div>
      <div className="playback-info">
        {standby ? (
          <>
            <Icon name="headphones" />
            同頻道備援 · 由 {lane.playbackLane} 路播放一份音訊
          </>
        ) : lane.status === "listening" ? (
          <>
            <Icon name="headphones" />由 {id} 路播放
            {ids.some(
              (other) => other !== id && state.lanes[other].playbackLane === id,
            )
              ? " · 另一隻 Bot 備援"
              : " · 獨立成員音源"}
          </>
        ) : (
          <>
            <Icon name="signal" />
            {lane.error ?? "派遣機器人後，這裡會顯示實際成員"}
          </>
        )}
      </div>
      <div className="lane-controls">
        <button
          className="power"
          disabled={busy || !state.validated}
          onClick={() =>
            command(id, lane.status === "listening" ? "close" : "open")
          }
        >
          <Icon name="power" />
          {busy
            ? "處理中…"
            : lane.status === "listening"
              ? "關閉語音"
              : lane.status === "error"
                ? "重試連線"
                : "開啟語音"}
        </button>
        <span>派遣來源</span>
      </div>
      <SourceButtons state={state} lane={lane} busy={busy} command={command} />
      <div className="member-header">
        <span>成員音源</span>
        <span>音量 / 靜音</span>
      </div>
      {lane.members.length ? (
        <ul className="members">
          {lane.members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              lane={id}
              mix={mix.members[member.id] ?? defaultMember}
              audio={audio}
              onChange={updateMember}
              standby={standby}
            />
          ))}
        </ul>
      ) : (
        <div className="empty">
          <Icon name="headphones" />
          <strong>
            {lane.status === "listening"
              ? "頻道目前沒有可監聽成員"
              : "等待語音派遣"}
          </strong>
          <p>
            {lane.status === "listening"
              ? "成員加入後會自動出現在這裡。"
              : "選擇目標頻道，或按開啟語音加入上次來源。"}
          </p>
        </div>
      )}
      <div className="lane-mix">
        <div>
          <strong>{id} 路音量</strong>
          <span>
            {standby
              ? `目前由 ${lane.playbackLane} 路控制播放音量`
              : "只影響本機耳機"}
          </span>
        </div>
        <Volume
          label={`${id} 路音量`}
          value={mix.lanes[id].volume}
          onChange={(volume) =>
            updateMix({
              ...mix,
              lanes: { ...mix.lanes, [id]: { ...mix.lanes[id], volume } },
            })
          }
        />
        <div className="mix-buttons">
          <button
            aria-pressed={mix.lanes[id].muted}
            className={mix.lanes[id].muted ? "active-danger" : ""}
            onClick={() =>
              updateMix({
                ...mix,
                lanes: {
                  ...mix.lanes,
                  [id]: { ...mix.lanes[id], muted: !mix.lanes[id].muted },
                },
              })
            }
          >
            單路靜音
          </button>
          <button
            aria-pressed={mix.solo === id}
            disabled={standby}
            className={mix.solo === id ? "selected" : ""}
            onClick={() =>
              updateMix({ ...mix, solo: mix.solo === id ? null : id })
            }
          >
            單獨監聽
          </button>
        </div>
      </div>
    </section>
  );
}
function Settings({
  state,
  request,
  run,
  pending,
}: {
  state: Snapshot;
  request: (path: string, body: unknown) => Promise<void>;
  run: (task: () => Promise<void>, key: string) => Promise<boolean>;
  pending: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);
  const [formError, setFormError] = useState("");
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = {
      guildId: String(data.get("guildId")).trim(),
      channels: {
        A: String(data.get("channelA")).trim(),
        B: String(data.get("channelB")).trim(),
      },
      tokens: {
        A: String(data.get("tokenA")).trim(),
        B: String(data.get("tokenB")).trim(),
      },
    };
    setFormError("");
    if (
      await run(async () => {
        try {
          await request("/api/settings", input);
        } catch (error) {
          setFormError((error as Error).message);
          throw error;
        }
      }, "settings")
    ) {
      for (const name of ["tokenA", "tokenB"])
        (form.current!.elements.namedItem(name) as HTMLInputElement).value = "";
      setDirty(false);
    } else form.current?.querySelector<HTMLInputElement>("input")?.focus();
  }
  return (
    <div className="settings-layout">
      <section className="settings-panel">
        <h2>Discord 連線設定</h2>
        <p>設定兩個獨立 Bot，以及共同可選的兩個語音來源。</p>
        <form
          ref={form}
          onSubmit={(event) => {
            void submit(event);
          }}
          onChange={() => setDirty(true)}
        >
          <label>
            伺服器 ID
            <input
              name="guildId"
              autoComplete="off"
              inputMode="numeric"
              spellCheck={false}
              pattern="[0-9]{17,20}"
              required
              defaultValue={state.settings.guildId}
              placeholder="例如 123456789012345678…"
            />
          </label>
          <div className="field-pair">
            {ids.map((id) => (
              <label key={id}>
                Channel {id} ID
                <input
                  name={`channel${id}`}
                  autoComplete="off"
                  inputMode="numeric"
                  spellCheck={false}
                  pattern="[0-9]{17,20}"
                  required
                  defaultValue={state.settings.channels[id]}
                  placeholder="一般語音頻道 ID…"
                />
              </label>
            ))}
          </div>
          <div className="field-pair">
            {ids.map((id) => (
              <label key={id}>
                機器人 {id} Token
                <span className="field-help">
                  {state.settings.tokensSaved[id]
                    ? "已加密保存；留白沿用本機憑證"
                    : "尚未設定；移轉電腦後需重新輸入"}
                </span>
                <input
                  type="password"
                  name={`token${id}`}
                  autoComplete="new-password"
                  spellCheck={false}
                  required={!state.settings.tokensSaved[id]}
                  maxLength={256}
                  placeholder="輸入 Bot Token…"
                />
              </label>
            ))}
          </div>
          <p className="privacy">
            Token 只傳至本機後端，使用目前 Windows 使用者加密保存；後端不回傳
            Token。
          </p>
          {formError ? (
            <p className="form-error" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="settings-actions">
            <button className="primary" disabled={pending} type="submit">
              {pending ? "正在驗證…" : "驗證並保存設定"}
            </button>
            <button
              type="button"
              disabled={
                pending ||
                !state.settings.tokensSaved.A ||
                !state.settings.tokensSaved.B
              }
              onClick={() => {
                void run(() => request("/api/validate", {}), "settings");
              }}
            >
              重新驗證本機設定
            </button>
          </div>
          {dirty ? (
            <p className="field-help">
              有尚未保存的變更。切換分頁仍會保留輸入。
            </p>
          ) : null}
        </form>
      </section>
      <aside className="setup-info">
        <img
          src="/brand/PulseMic_Icon.png"
          width="100"
          height="100"
          alt="PulseMic 圖示"
        />
        <h2>把語音帶進導播席</h2>
        <ol>
          <li>建立兩個 Discord Application，取得不同 Bot 的 Token。</li>
          <li>邀請兩隻 Bot 到相同伺服器，授予「查看頻道」與「連接」權限。</li>
          <li>開啟 Discord 開發者模式，複製伺服器及一般語音頻道 ID。</li>
          <li>驗證成功後到收聽分頁派遣，再點擊「開始監聽」。</li>
        </ol>
        <p>不需要麥克風權限。停止耳機監聽不會讓 Bot 退出。</p>
        <div className="verified">
          <strong>
            {state.mode === "demo"
              ? "示範資料 · 未驗證真實 Discord"
              : state.validated
                ? "Discord 設定已驗證"
                : "等待真實設定驗證"}
          </strong>
          <p>{state.guildName ?? "尚未取得伺服器名稱"}</p>
          {ids.map((id) => (
            <p key={id}>
              Channel {id}
              <b>{state.sources[id].name || "尚未取得實際頻道名稱"}</b>
            </p>
          ))}
        </div>
      </aside>
    </div>
  );
}
export function App() {
  const [audio] = useState(() => new HeadphoneMixer());
  const control = useControl(audio);
  const { state, connected, error, setError, request, monitor } = control;
  const [mix, setMix] = useState(readMix);
  const mixRef = useRef(mix);
  const [tab, setTab] = useState<Tab>(readTab);
  const [monitoring, setMonitoring] = useState(false);
  const [audioStatus, setAudioStatus] = useState("耳機監聽尚未啟用");
  const [tone, setTone] = useState(false);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const locks = useRef(new Set<string>());
  useEffect(() => {
    audio.onStatus = setAudioStatus;
    return () => {
      audio.onStatus = () => {};
    };
  }, [audio]);
  useEffect(() => {
    audio.updateMix(mix);
    const timer = setTimeout(() => {
      try {
        localStorage.setItem("pulsemic.mix.v1", JSON.stringify(mix));
      } catch {
        setError("無法保存音量偏好；目前調整仍有效。");
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [audio, mix, setError]);
  useEffect(() => {
    const listener = () => setTab(readTab());
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, []);
  useEffect(
    () => () => {
      void audio.stop();
    },
    [audio],
  );
  async function run(task: () => Promise<void>, key: string) {
    if (locks.current.has(key)) return false;
    locks.current.add(key);
    setPending((previous) => ({ ...previous, [key]: true }));
    setError("");
    try {
      await task();
      return true;
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "操作失敗，請重試。",
      );
      return false;
    } finally {
      locks.current.delete(key);
      setPending((previous) => ({ ...previous, [key]: false }));
    }
  }
  function updateMix(next: Mix) {
    mixRef.current = next;
    audio.updateMix(next);
    setMix(next);
  }
  const updateMember = useRef((id: string, value: MemberMix) => {
    const current = mixRef.current;
    updateMix({ ...current, members: { ...current.members, [id]: value } });
  }).current;
  function command(
    id: LaneId,
    action: "open" | "close" | "switch",
    source?: SourceId,
  ) {
    void run(() => request(`/api/bots/${id}`, { action, source }), id);
  }
  async function toggleMonitor() {
    await run(async () => {
      const enabled = !monitoring;
      await monitor(enabled);
      setMonitoring(enabled);
    }, "monitor");
  }
  function navigate(next: Tab) {
    setTab(next);
    const url = new URL(location.href);
    url.searchParams.set("tab", next);
    history.pushState({}, "", url);
  }
  const globalBusy = Boolean(pending.settings || pending.mode);
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        跳至控制台
      </a>
      <header className="topbar">
        <a
          className="brand"
          href="/?tab=listen"
          aria-label="PulseMic 收聽控制台"
        >
          <img
            src="/brand/PulseMic_MainLogo.png"
            width="217"
            height="72"
            alt="PulseMic"
          />
        </a>
        <div className="system">
          <span className={`status ${!connected ? "error" : ""}`}>
            {connected ? "本機服務已連線" : "本機服務未連線"}
          </span>
          <span>
            {state?.mode === "demo" ? "示範模式" : "Discord 真實模式"}
          </span>
        </div>
        <button
          className={`panic ${mix.muted ? "active-danger" : ""}`}
          aria-pressed={mix.muted}
          onClick={() => updateMix({ ...mix, muted: !mix.muted })}
        >
          <Icon name="mute" />
          {mix.muted ? "全部已靜音 · 取消" : "全部靜音"}
        </button>
      </header>
      <div className="shell">
        <nav className="navigation" aria-label="主要分頁">
          <div>
            {(
              [
                { id: "control", text: "導播控制", icon: "signal" },
                { id: "listen", text: "收聽", icon: "headphones" },
                { id: "settings", text: "設定", icon: "settings" },
              ] as const
            ).map((item) => (
              <a
                key={item.id}
                href={`?tab=${item.id}`}
                aria-current={tab === item.id ? "page" : undefined}
                onClick={(event) => {
                  if (
                    event.button === 0 &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.shiftKey &&
                    !event.altKey
                  ) {
                    event.preventDefault();
                    navigate(item.id);
                  }
                }}
              >
                <Icon name={item.icon} />
                {item.text}
              </a>
            ))}
          </div>
          <span>Windows 本機音控台</span>
        </nav>
        <main id="main">
          <div className="page-heading">
            <div>
              <h1>
                {tab === "listen"
                  ? "雙路語音監聽"
                  : tab === "control"
                    ? "機器人派遣"
                    : "系統設定"}
              </h1>
              <p>
                {tab === "listen"
                  ? "每位成員獨立控制，掌握賽場兩端的聲音。"
                  : tab === "control"
                    ? "兩個 Bot 身分，各自選擇 Channel A 或 B。"
                    : "驗證 Discord 來源，憑證留在這台電腦。"}
              </p>
            </div>
            <span className="guild-label">
              {state?.guildName ?? "尚未設定伺服器"}
            </span>
          </div>
          {state?.mode === "demo" ? (
            <div className="demo-banner">
              <strong>示範模式</strong>
              <span>虛構伺服器與成員；測試音由本機產生，未連接 Discord。</span>
              <button
                disabled={!monitoring}
                aria-pressed={tone}
                onClick={() => {
                  const next = !tone;
                  setTone(next);
                  audio.toggleTone(next);
                }}
              >
                {tone ? "停止示範測試音" : "播放示範測試音"}
              </button>
            </div>
          ) : null}
          {error ? (
            <div className="error-banner" role="alert">
              {error}
              <button aria-label="關閉錯誤提示" onClick={() => setError("")}>
                ×
              </button>
            </div>
          ) : null}
          {!state ? (
            <div className="loading" role="status">
              正在連接 PulseMic 本機服務…
            </div>
          ) : (
            <>
              <div hidden={tab !== "listen"}>
                <div className="mixer-grid">
                  {ids.map((id) => (
                    <LanePanel
                      key={id}
                      state={state}
                      id={id}
                      mix={mix}
                      audio={audio}
                      pending={!connected || globalBusy || Boolean(pending[id])}
                      command={command}
                      updateMix={updateMix}
                      updateMember={updateMember}
                    />
                  ))}
                </div>
                <p className="mix-note">
                  音量只影響本機耳機。個別設定依 Discord 使用者 ID
                  保存，同名成員仍可分別調整。
                </p>
              </div>
              <div hidden={tab !== "control"}>
                <div className="dispatch-grid">
                  {ids.map((id) => {
                    const lane = state.lanes[id];
                    const busy =
                      !connected ||
                      globalBusy ||
                      Boolean(pending[id]) ||
                      ["connecting", "disconnecting", "reconnecting"].includes(
                        lane.status,
                      );
                    return (
                      <section
                        key={id}
                        className={`dispatch lane-${id.toLowerCase()}`}
                      >
                        <span className="lane-badge">{id}</span>
                        <h2>機器人 {id}</h2>
                        <p>
                          {lane.botName} ·{" "}
                          {lane.status === "unknown"
                            ? "Discord 狀態待確認"
                            : state.mode === "demo"
                              ? "示範 Bot 就緒"
                              : lane.botOnline
                                ? "Discord 在線"
                                : "尚未連線"}
                        </p>
                        <h3>{laneTitle(lane)}</h3>
                        <p className="connection-text">{laneStatus(lane)}</p>
                        {lane.error ? (
                          <p className="form-error">{lane.error}</p>
                        ) : null}
                        <SourceButtons
                          state={state}
                          lane={lane}
                          busy={busy}
                          command={command}
                        />
                        <div className="dispatch-actions">
                          <button
                            className="primary"
                            disabled={busy || !state.validated}
                            onClick={() => command(id, "open")}
                          >
                            開啟 · Channel {lane.selectedSource}
                          </button>
                          <button
                            disabled={
                              busy || !state.validated || lane.status === "idle"
                            }
                            onClick={() => command(id, "close")}
                          >
                            關閉語音
                          </button>
                        </div>
                        <p>
                          開啟加入上次選定來源。關閉退出語音，保留 Bot 在線。
                        </p>
                      </section>
                    );
                  })}
                </div>
                <div className="mode-panel">
                  <div>
                    <h2>操作演練</h2>
                    <p>
                      切換模式會讓兩隻 Bot
                      退出語音。示範模式可演練派遣、同頻道備援及音量調整。
                    </p>
                  </div>
                  <button
                    disabled={globalBusy || !connected}
                    onClick={() => {
                      setTone(false);
                      audio.toggleTone(false);
                      void run(
                        () =>
                          request("/api/mode", {
                            mode: state.mode === "demo" ? "live" : "demo",
                          }),
                        "mode",
                      );
                    }}
                  >
                    {state.mode === "demo" ? "返回真實模式" : "進入示範模式"}
                  </button>
                </div>
              </div>
              <div hidden={tab !== "settings"}>
                <Settings
                  state={state}
                  request={request}
                  run={run}
                  pending={!connected || globalBusy}
                />
              </div>
            </>
          )}
        </main>
      </div>
      <footer className="monitor-bar">
        <div className="monitor-title">
          <Icon name="headphones" />
          <div>
            <strong>{monitoring ? "耳機監聽中" : "耳機監聽已停止"}</strong>
            <span>{audioStatus}</span>
          </div>
        </div>
        <button
          className={monitoring ? "" : "primary"}
          disabled={Boolean(pending.monitor) || (!connected && !monitoring)}
          onClick={() => {
            void toggleMonitor();
          }}
        >
          {pending.monitor ? "處理中…" : monitoring ? "停止監聽" : "開始監聽"}
        </button>
        <div className="master">
          <strong>耳機總音量</strong>
          <Volume
            max={100}
            label="耳機總音量"
            value={mix.master}
            onChange={(master) => updateMix({ ...mix, master })}
          />
        </div>
        <div className="recent" aria-live="polite">
          <span>最近操作</span>
          <p>{state?.notice ?? "等待本機服務連線"}</p>
        </div>
      </footer>
    </div>
  );
}
