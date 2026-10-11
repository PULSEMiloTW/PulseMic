import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Lane,
  Mix,
  ServerMessage,
  Snapshot,
  OutputKind,
} from "../shared/types";
import type { HeadphoneMixer } from "./audio";
function unconfirmedLane(lane: Lane): Lane {
  return {
    ...lane,
    status: "unknown",
    channelId: null,
    channelName: null,
    targetName: null,
    members: [],
    playbackLane: null,
    error: "控制連線中斷，無法確認 Bot 目前所在頻道。",
  };
}
export function useControl(
  audio: HeadphoneMixer,
  outputToken?: string,
  outputKind: OutputKind = "players",
  admin = false,
) {
  const [state, setState] = useState<Snapshot>();
  const [panicMuted, setPanicMuted] = useState(false);
  const [casterState, setCasterState] = useState<Snapshot>();
  const [remoteCasterMix, setRemoteCasterMix] = useState<Mix>();
  const [remoteMix, setRemoteMix] = useState<Mix>();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const session = useRef("");
  const socket = useRef<WebSocket | undefined>(undefined);
  const latestState = useRef<Snapshot | undefined>(undefined);
  const monitoring = useRef(false);
  useEffect(() => {
    let disposed = false;
    let retry: ReturnType<typeof setTimeout>;
    if (admin) {
      let polling = false;
      const refresh = async () => {
        if (polling || disposed) return;
        polling = true;
        try {
          const auth = await fetch("/api/session", { cache: "no-store" });
          if (!auth.ok) throw new Error();
          const body = await auth.json();
          if (disposed) return;
          session.current = body.session;
          const headers = { "X-PulseMic-Session": body.session };
          const responses = await Promise.all([
            fetch("/api/state", { headers }),
            fetch("/api/caster/state", { headers }),
          ]);
          if (responses.some((response) => !response.ok)) throw new Error();
          const [players, caster] = await Promise.all(
            responses.map((response) => response.json()),
          );
          if (disposed) return;
          setState(players);
          setCasterState(caster);
          setConnected(true);
          setError("");
        } catch {
          if (!disposed) {
            setConnected(false);
            setError("後台授權或連線失效，請重新登入。");
          }
        } finally {
          polling = false;
        }
      };
      void refresh();
      const interval = setInterval(() => void refresh(), 2000);
      return () => {
        disposed = true;
        clearInterval(interval);
      };
    }
    const connect = async () => {
      try {
        const body = outputToken
          ? { session: outputToken }
          : await (async () => {
              const response = await fetch("/api/session", {
                cache: "no-store",
              });
              if (!response.ok) throw new Error();
              return response.json();
            })();
        if (disposed) return;
        session.current = body.session;
        const ws = new WebSocket(
          `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/${outputToken ? (outputKind === "caster" ? "caster-output-stream" : "output-stream") : "control"}`,
          body.session,
        );
        socket.current = ws;
        ws.onopen = () => {
          if (disposed) return ws.close();
          setConnected(true);
          setError("");
          ws.send(
            JSON.stringify({ type: "monitor", enabled: monitoring.current }),
          );
        };
        ws.onmessage = (event) => {
          if (disposed) return;
          const message: ServerMessage = JSON.parse(event.data);
          if (message.type === "state") {
            latestState.current = message.state;
            setState(message.state);
            audio.updateState(message.state);
          }
          if (message.type === "panic") {
            setPanicMuted(message.muted);
            audio.emergencyMute(message.muted);
          }
          if (message.type === "caster-state") setCasterState(message.state);
          if (message.type === "caster-mix") setRemoteCasterMix(message.mix);
          if (message.type === "audio-reset") audio.reset();
          if (message.type === "mix") setRemoteMix(message.mix);
          if (message.type === "opus")
            audio.opus(message.lane, message.userId, message.payload);
          if (message.type === "error") setError(message.message);
          if (message.type === "offer")
            void audio.offer(
              message.sdp,
              message.tracks,
              message.generation,
              (sdp, generation) => {
                if (ws.readyState === WebSocket.OPEN)
                  ws.send(JSON.stringify({ type: "answer", sdp, generation }));
              },
            );
        };
        ws.onclose = (event) => {
          if (disposed) return;
          setConnected(false);
          audio.reset();
          setCasterState((previous) =>
            previous
              ? {
                  ...previous,
                  lanes: {
                    A: unconfirmedLane(previous.lanes.A),
                    B: unconfirmedLane(previous.lanes.B),
                  },
                }
              : previous,
          );
          const previous = latestState.current;
          if (previous) {
            const next: Snapshot = {
              ...previous,
              lanes: {
                A: unconfirmedLane(previous.lanes.A),
                B: unconfirmedLane(previous.lanes.B),
              },
            };
            latestState.current = next;
            setState(next);
            audio.updateState(next);
          }
          audio.onStatus("控制服務中斷，耳機音源已停止");
          setError(
            outputToken
              ? "輸出連線已結束。請重新整理並輸入新的授權碼。"
              : event.code === 4001
                ? "另一個控制台已接手。請關閉其他控制台並重新整理。"
                : "本機控制服務中斷，正在重新連線；耳機音源已停止。",
          );
          if (!outputToken && event.code !== 4001 && event.code !== 4003)
            retry = setTimeout(() => {
              void connect();
            }, 2000);
        };
        ws.onerror = () => ws.close();
      } catch {
        if (!disposed) {
          setError("無法連接本機服務，請執行 Windows 啟動檔。");
          if (!outputToken)
            retry = setTimeout(() => {
              void connect();
            }, 2000);
        }
      }
    };
    void connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      socket.current?.close();
      audio.reset();
    };
  }, [audio, outputToken, outputKind, admin]);
  const request = useCallback(
    async (path: string, body: unknown) => {
      if (
        !session.current ||
        (!admin && socket.current?.readyState !== WebSocket.OPEN)
      )
        throw new Error("控制服務尚未連線，請等待恢復。");
      const response = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PulseMic-Session": session.current,
        },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "操作失敗，請重試。");
      return result;
    },
    [admin],
  );
  const monitor = useCallback(
    async (enabled: boolean) => {
      if (enabled && socket.current?.readyState !== WebSocket.OPEN)
        throw new Error("請等待本機控制服務連線後再開始監聽。");
      if (
        enabled &&
        outputToken &&
        location.hostname !== "localhost" &&
        location.hostname !== "127.0.0.1" &&
        (typeof AudioDecoder === "undefined" ||
          !(
            await AudioDecoder.isConfigSupported({
              codec: "opus",
              sampleRate: 48000,
              numberOfChannels: 2,
            })
          ).supported)
      )
        throw new Error(
          "這個瀏覽器不支援獨立音源解碼。請使用最新版 Chrome 或 Edge。",
        );
      if (enabled) await audio.start();
      else await audio.stop();
      monitoring.current = enabled;
      if (socket.current?.readyState === WebSocket.OPEN)
        socket.current.send(JSON.stringify({ type: "monitor", enabled }));
    },
    [audio, outputToken],
  );
  return {
    state,
    connected,
    error,
    setError,
    request,
    monitor,
    remoteMix,
    casterState,
    remoteCasterMix,
    panicMuted,
  };
}
