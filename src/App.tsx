import { OAuthSettings, OperatorSettings, RuntimeLogs } from "./Management";
import type { Identity } from "../shared/types";
import {
  memo,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
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
  type OutputKind,
} from "../shared/types";
import { HeadphoneMixer } from "./audio";
import { readMix } from "./mix";
import { OutputAccess } from "./OutputAccess";
import { useControl } from "./useControl";

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
  label,
}: {
  member: Member;
  lane: LaneId;
  mix: MemberMix;
  audio: HeadphoneMixer;
  onChange: (id: string, value: MemberMix) => void;
  standby: boolean;
  label?: string;
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
        label={`${label ?? `${lane} 路`} ${member.name} ${member.id} 音量`}
        value={mix.volume}
        onChange={(volume) => onChange(member.id, { ...mix, volume })}
      />
      <button
        className={`square ${mix.muted ? "active-danger" : ""}`}
        aria-label={`${mix.muted ? "取消靜音" : "靜音"} ${label ?? `${lane} 路`} ${member.name} ${member.id}`}
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
  readOnly = false,
  caster = false,
  footer,
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
  readOnly?: boolean;
  caster?: boolean;
  footer?: ReactNode;
}) {
  const lane = state.lanes[id];
  const busy =
    pending ||
    ["connecting", "disconnecting", "reconnecting"].includes(lane.status);
  const standby = lane.playbackLane !== null && lane.playbackLane !== id;
  return (
    <section
      className={`lane lane-${caster ? "c" : id.toLowerCase()}`}
      aria-labelledby={`${caster ? "caster" : "lane"}-${id}-title`}
    >
      <div className="lane-heading">
        <span
          className="lane-badge"
          aria-label={caster ? "主播台" : `${id} 路`}
        >
          {caster ? "C" : id}
        </span>
        <div>
          <h2
            id={`${caster ? "caster" : "lane"}-${id}-title`}
            title={laneTitle(lane)}
          >
            {laneTitle(lane)}
          </h2>
          <p>
            {caster
              ? "PulseMic Caster Desk · 主播台來源"
              : `機器人 ${id} · 來源 Channel ${lane.selectedSource}`}
          </p>
        </div>
        <span className={`status ${lane.status === "error" ? "error" : ""}`}>
          {laneStatus(lane)}
        </span>
      </div>
      {state.mode === "demo" ? (
        <span className="demo-tag">示範音源</span>
      ) : null}
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
            <Icon name="headphones" />
            {caster ? "主播台獨立播放" : `由 ${id} 路播放`}
            {ids.some(
              (other) => other !== id && state.lanes[other].playbackLane === id,
            )
              ? " · 另一隻 Bot 備援"
              : " · 獨立成員音源"}
          </>
        ) : (
          <>
            <Icon name="signal" />
            {lane.error ?? "尚未開啟語音"}
          </>
        )}
      </div>
      <div className="lane-controls" hidden={readOnly}>
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
              ? caster
                ? "關閉主播台語音"
                : "關閉語音"
              : lane.status === "error"
                ? caster
                  ? "重試主播台連線"
                  : "重試連線"
                : caster
                  ? "開啟主播台語音"
                  : "開啟語音"}
        </button>
        {caster ? (
          <span title={state.sources.A.name}>{state.sources.A.name}</span>
        ) : null}
      </div>
      {!readOnly && !caster ? (
        <SourceButtons
          state={state}
          lane={lane}
          busy={busy}
          command={command}
        />
      ) : null}
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
              label={caster ? "主播台" : undefined}
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
        </div>
      )}
      <div className="lane-mix">
        <div>
          <strong>{caster ? "主播台音量" : `${id} 路音量`}</strong>
          <span>
            {standby
              ? `目前由 ${lane.playbackLane} 路控制播放音量`
              : "只影響監聽輸出"}
          </span>
        </div>
        <Volume
          label={caster ? "主播台音量" : `${id} 路音量`}
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
      {footer}
    </section>
  );
}
function CasterSettings({
  state,
  connected,
  request,
}: {
  state?: Snapshot;
  connected: boolean;
  request: (path: string, body: unknown) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const dirty = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (dirty.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, []);
  async function run(path: string, body: unknown) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await request(path, body);
      return true;
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "操作失敗，請重試。",
      );
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!state) return <p role="status">正在取得主播台設定…</p>;
  const lane = state.lanes.A;
  const pending =
    busy ||
    !connected ||
    ["connecting", "disconnecting", "reconnecting"].includes(lane.status);
  return (
    <section className="caster-settings">
      <h2>主播台來源設定</h2>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <form
        onChange={() => {
          dirty.current = true;
        }}
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void run("/api/caster/settings", {
            guildId: data.get("guildId"),
            channelId: data.get("channelId"),
            token: data.get("token"),
          }).then((ok) => {
            if (ok) {
              dirty.current = false;
              (form.elements.namedItem("token") as HTMLInputElement).value = "";
            }
          });
        }}
      >
        <label htmlFor="caster-guild">
          主播台伺服器 ID
          <input
            id="caster-guild"
            name="guildId"
            defaultValue={state.settings.guildId}
            required
            pattern="[0-9]{17,20}"
            inputMode="numeric"
            autoComplete="off"
          />
        </label>
        <label htmlFor="caster-channel">
          主播台語音頻道 ID
          <input
            id="caster-channel"
            name="channelId"
            defaultValue={state.settings.channels.A}
            required
            pattern="[0-9]{17,20}"
            inputMode="numeric"
            autoComplete="off"
          />
        </label>
        <label htmlFor="caster-token">
          Caster Desk Bot Token
          <input
            id="caster-token"
            name="token"
            type="password"
            maxLength={256}
            autoComplete="off"
            required={!state.settings.tokensSaved.A}
            placeholder={
              state.settings.tokensSaved.A
                ? "已加密保存；留空沿用"
                : "輸入主播台 Bot Token"
            }
          />
        </label>
        <div className="settings-actions">
        <button disabled={pending || lane.status === "listening"}>
          {busy ? "驗證中…" : "保存並驗證主播台"}
        </button>
        </div>
      </form>

      {state.validated ? (
        <div className="caster-verified">
          <strong>{state.mode === "demo" ? "示範資料 · 未驗證真實 Discord" : "Discord 設定已驗證"}</strong>
          <p className="source-guild">{state.guildName}</p>
          <div className="source-channels">
            <div className="source-channel" data-source="caster">
              <span className="source-marker"><Icon name="headphones" /></span>
              <div><span>主播台語音</span><b>{state.sources.A.name}</b></div>
            </div>
          </div>
        </div>
      ) : null}
      <div className="caster-mode">
        <button
          disabled={pending}
          onClick={() =>
            void run("/api/caster/mode", {
              mode: state.mode === "demo" ? "live" : "demo",
            })
          }
        >
          {state.mode === "demo" ? "回到主播台真實模式" : "演練主播台介面"}
        </button>
        {state.mode === "live" && state.settings.tokensSaved.A ? (
          <button
            disabled={pending || lane.status === "listening"}
            onClick={() => void run("/api/caster/validate", {})}
          >
            重新驗證主播台
          </button>
        ) : null}
      </div>
    </section>
  );
}
function CasterDesk({
  state,
  connected,
  remoteMix,
  request,
}: {
  state?: Snapshot;
  connected: boolean;
  remoteMix?: Mix;
  request: (path: string, body: unknown) => Promise<unknown>;
}) {
  const [audio] = useState(() => new HeadphoneMixer());
  const [mix, setMix] = useState(() => readMix("pulsemic.caster.mix.v1"));
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (remoteMix) setMix(remoteMix);
  }, [remoteMix]);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem("pulsemic.caster.mix.v1", JSON.stringify(mix));
      } catch {
        setError("無法保存主播台音量偏好。");
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [mix]);
  useEffect(
    () => () => {
      void audio.stop();
    },
    [audio],
  );
  function updateMix(next: Mix) {
    setMix(next);
    void request("/api/caster/mix", next).catch(() =>
      setError("主播台音量未同步，請重試。"),
    );
  }
  async function command(_: LaneId, action: "open" | "close" | "switch") {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await request("/api/caster/bot", { action });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "主播台操作失敗。");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!state) return <p role="status">正在取得主播台狀態…</p>;
  return (
    <div className="caster-desk caster-mixer">
      <LanePanel
        caster
        state={state}
        id="A"
        mix={mix}
        audio={audio}
        pending={busy || !connected}
        command={(id, action) => void command(id, action)}
        updateMix={updateMix}
        updateMember={(id, value) =>
          updateMix({ ...mix, members: { ...mix.members, [id]: value } })
        }
        footer={
          <>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="caster-master">
              <strong>主播台輸出總音量</strong>
              <Volume
                max={100}
                label="主播台輸出總音量"
                value={mix.master}
                onChange={(master) => updateMix({ ...mix, master })}
              />
            </div>
            <span className="sr-only" role="status">
              {state.notice}
            </span>
          </>
        }
      />
    </div>
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
        <h2>選手來源設定</h2>
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
                <input
                  type="password"
                  name={`token${id}`}
                  autoComplete="new-password"
                  spellCheck={false}
                  required={!state.settings.tokensSaved[id]}
                  maxLength={256}
                  placeholder={
                    state.settings.tokensSaved[id]
                      ? "已保存；留空沿用"
                      : "輸入 Bot Token"
                  }
                />
              </label>
            ))}
          </div>
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
              重新驗證連線
            </button>
          </div>
          {dirty ? <p className="field-help">尚未保存</p> : null}
        </form>
      </section>
      <div className="verified">
        <strong>
          {state.mode === "demo"
            ? "示範資料 · 未驗證真實 Discord"
            : state.validated
              ? "Discord 設定已驗證"
              : "等待真實設定驗證"}
        </strong>
        <p className="source-guild">{state.guildName ?? "尚未取得伺服器名稱"}</p>
        <div className="source-channels">
        {ids.map((id) => (
          <div className="source-channel" data-source={id} key={id}>
            <span className="source-marker">{id}</span>
            <div><span>Channel {id}</span><b>{state.sources[id].name || "尚未取得實際頻道名稱"}</b></div>
          </div>
        ))}
        </div>
      </div>
    </div>
  );
}
export function App({
  outputToken,
  outputKind = "players",
}: { outputToken?: string; outputKind?: OutputKind } = {}) {
  const output = Boolean(outputToken);
  const consolePage = !output;
  const admin = !output && location.pathname === "/admin";
  const [identity, setIdentity] = useState<Identity>();
  useEffect(() => {
    if (output) return;
    let active = true;
    void fetch("/api/identity", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((user) => {
        if (active) setIdentity(user);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [output]);
  const canConfigure = identity?.role === "owner";
  const [audio] = useState(() => new HeadphoneMixer());
  const control = useControl(audio, outputToken, outputKind, admin);
  const mixKey =
    outputKind === "caster" ? "pulsemic.caster.mix.v1" : "pulsemic.mix.v1";
  const { state, connected, error, setError, request, monitor } = control;
  const [mix, setMix] = useState(() => readMix(mixKey));
  const mixRef = useRef(mix);
  useEffect(() => {
    if (!output || !control.remoteMix) return;
    mixRef.current = control.remoteMix;
    audio.updateMix(control.remoteMix);
    setMix(control.remoteMix);
  }, [audio, output, control.remoteMix]);
  const [recentNotice, setRecentNotice] = useState("等待本機服務連線");
  useEffect(() => {
    if (state?.notice) setRecentNotice(state.notice);
  }, [state?.notice]);
  useEffect(() => {
    if (control.casterState?.notice)
      setRecentNotice(control.casterState.notice);
  }, [control.casterState?.notice]);
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
        localStorage.setItem(mixKey, JSON.stringify(mix));
      } catch {
        setError("無法保存音量偏好；目前調整仍有效。");
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [audio, mix, setError, mixKey]);
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
    if (!output)
      void request("/api/mix", next).catch((failure) =>
        setError(
          failure instanceof Error
            ? failure.message
            : "輸出音量同步失敗，請重試。",
        ),
      );
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
  const globalBusy = Boolean(pending.settings || pending.mode);
  return (
    <div className={`app desk-app ${output ? "output-app" : "console-app"}`}>
      <a className="skip-link" href="#main">
        跳至控制台
      </a>
      {!output ? (
        <aside className="desk-sidebar">
          <a
            className="desk-brand"
            href="/console"
            aria-label="PulseMic 控制台"
          >
            <img
              src="/brand/PulseMic_MainLogo.png"
              width="217"
              height="72"
              alt="PulseMic"
            />
          </a>
          <nav aria-label="控制台區域">
            <a
              href={admin ? "/console" : "#main"}
              aria-current={admin ? undefined : "page"}
            >
              <Icon name="headphones" />
              音控台
            </a>
            <a href={admin ? "/console#outputs" : "#outputs"}>
              <Icon name="signal" />
              輸出頁
            </a>
            {canConfigure ? (
              <a href="/admin" aria-current={admin ? "page" : undefined}>
                <Icon name="settings" />
                專屬後台
              </a>
            ) : null}
            <a href="/status" target="_blank" rel="noopener noreferrer">
              <Icon name="signal" />
              系統狀態
            </a>
            <a href="#logs">
              <Icon name="signal" />
              運行日誌
            </a>
          </nav>
          <div className="sidebar-bottom">
            <img
              src={identity?.avatar || "/brand/PulseMic_Icon.png"}
              width="42"
              height="42"
              alt=""
            />
            <span>
              {identity?.name || "驗證身分中"}
              <small>{identity?.role === "owner" ? "擁有者" : "操作員"}</small>
            </span>
            {identity ? (
              <button
                onClick={() =>
                  void fetch("/auth/logout", { method: "POST" }).then(() =>
                    location.assign("/"),
                  )
                }
              >
                登出
              </button>
            ) : null}
          </div>
        </aside>
      ) : null}
      <div className="desk-content">
        <header className="topbar">
          {output ? (
            <a
              className="brand"
              href={outputKind === "caster" ? "/caster-output" : "/output"}
            >
              <img
                src="/brand/PulseMic_MainLogo.png"
                width="217"
                height="72"
                alt="PulseMic"
              />
            </a>
          ) : (
            <h1>{admin ? "專屬後台" : "語音控制台"}</h1>
          )}
          <span className={`status ${!connected ? "error" : ""}`}>
            {connected ? "本機服務已連線" : "本機服務未連線"}
          </span>
          {!admin ? (
            <button
              className={`panic ${(output ? mix.muted : control.panicMuted) ? "active-danger" : ""}`}
              aria-pressed={output ? mix.muted : control.panicMuted}
              disabled={!connected || Boolean(pending.panic)}
              onClick={() =>
                output
                  ? updateMix({ ...mix, muted: !mix.muted })
                  : void run(
                      () =>
                        request("/api/panic", { muted: !control.panicMuted }),
                      "panic",
                    )
              }
            >
              <Icon name="mute" />
              {(output ? mix.muted : control.panicMuted)
                ? "全部已靜音 · 取消"
                : output
                  ? "本頁靜音"
                  : "全部靜音"}
            </button>
          ) : null}
        </header>
        <main id="main" className="desk-main">
          {output ? (
            <h1 className="output-title">
              {outputKind === "caster" ? "Caster Desk 主播台輸出" : "音源輸出"}
            </h1>
          ) : null}
          {output && state?.mode === "demo" ? (
            <div className="demo-banner">
              <strong>示範音源</strong>
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
          {output && control.panicMuted ? (
            <div className="error-banner" role="status">
              導播已啟用全部靜音，所有輸出暫停播放。
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
              {!admin ? (
                <div
                  className={`mixer-grid ${output && outputKind === "caster" ? "caster-output-grid" : ""}`}
                >
                  {(output && outputKind === "caster"
                    ? (["A"] as const)
                    : ids
                  ).map((id) => (
                    <LanePanel
                      key={id}
                      state={state}
                      id={id}
                      readOnly={output}
                      caster={output && outputKind === "caster"}
                      mix={mix}
                      audio={audio}
                      pending={
                        output ||
                        !connected ||
                        globalBusy ||
                        Boolean(pending[id])
                      }
                      command={output ? () => {} : command}
                      updateMix={updateMix}
                      updateMember={updateMember}
                    />
                  ))}
                  {!output ? (
                    <CasterDesk
                      state={control.casterState}
                      connected={connected}
                      remoteMix={control.remoteCasterMix}
                      request={request}
                    />
                  ) : null}
                </div>
              ) : null}
              {!output ? (
                <>
                  {!admin ? (
                    <section
                      id="outputs"
                      className="outputs-grid"
                      aria-label="輸出頁"
                    >
                      <OutputAccess
                        kind="players"
                        connected={connected}
                        request={request}
                      />
                      <OutputAccess
                        kind="caster"
                        connected={connected}
                        request={request}
                      />
                    </section>
                  ) : null}
                  {admin && canConfigure ? (
                    <details
                      id="settings"
                      className="desk-settings"
                      open={true}
                    >
                      <summary>
                        <Icon name="settings" />
                        連線設定
                      </summary>
                      {canConfigure ? (
                        <div className="connection-grid">
                          <div>
                            <Settings
                              state={state}
                              request={request}
                              run={run}
                              pending={!connected || globalBusy}
                            />
                            <div className="mode-actions">
                              <button
                                disabled={globalBusy || !connected}
                                onClick={() => {
                                  setTone(false);
                                  audio.toggleTone(false);
                                  void run(
                                    () =>
                                      request("/api/mode", {
                                        mode:
                                          state.mode === "demo"
                                            ? "live"
                                            : "demo",
                                      }),
                                    "mode",
                                  );
                                }}
                              >
                                {state.mode === "demo"
                                  ? "返回真實模式"
                                  : "進入示範模式"}
                              </button>
                            </div>
                          </div>
                          <CasterSettings
                            state={control.casterState}
                            connected={connected}
                            request={request}
                          />
                        </div>
                      ) : (
                        <p className="local-settings-note">
                          只有擁有者能修改連線設定。
                        </p>
                      )}
                    </details>
                  ) : null}
                  {admin && canConfigure ? (
                    <div className="admin-grid">
                      <OperatorSettings request={request} />
                      <OAuthSettings request={request} />
                    </div>
                  ) : null}
                  <RuntimeLogs request={request} connected={connected} />
                </>
              ) : null}
            </>
          )}
        </main>
        {!admin ? (
          <footer className="monitor-bar">
            {output ? (
              <>
                <div className="monitor-title">
                  <Icon name="headphones" />
                  <div>
                    <strong>
                      {monitoring ? "耳機監聽中" : "耳機監聽已停止"}
                    </strong>
                    <span>{audioStatus}</span>
                  </div>
                </div>
                <button
                  className={monitoring ? "" : "primary"}
                  disabled={
                    Boolean(pending.monitor) || (!connected && !monitoring)
                  }
                  onClick={() => void toggleMonitor()}
                >
                  {pending.monitor
                    ? "處理中…"
                    : monitoring
                      ? "停止監聽"
                      : "開始監聽"}
                </button>
              </>
            ) : null}
            <div className="recent" aria-live="polite">
              <a href="#logs">運行日誌</a>
              <p>{recentNotice}</p>
            </div>
            <div className="master">
              <strong>{consolePage ? "選手輸出總音量" : "耳機總音量"}</strong>
              <Volume
                max={100}
                label="耳機總音量"
                value={mix.master}
                onChange={(master) => updateMix({ ...mix, master })}
              />
            </div>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
