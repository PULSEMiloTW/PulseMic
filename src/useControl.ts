import { useCallback, useEffect, useRef, useState } from "react";
import type { Lane, ServerMessage, Snapshot } from "../shared/types";
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
export function useControl(audio: HeadphoneMixer) {
  const [state, setState] = useState<Snapshot>();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const session = useRef("");
  const socket = useRef<WebSocket | undefined>(undefined);
  const latestState = useRef<Snapshot | undefined>(undefined);
  const monitoring = useRef(false);
  useEffect(() => {
    let disposed = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = async () => {
      try {
        const response = await fetch("/api/session", { cache: "no-store" });
        if (!response.ok) throw new Error();
        const body = await response.json();
        if (disposed) return;
        session.current = body.session;
        const ws = new WebSocket(`ws://${location.host}/control`, body.session);
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
          if (message.type === "audio-reset") audio.reset();
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
            event.code === 4001
              ? "另一個控制台已接手。請關閉其他控制台並重新整理。"
              : "本機控制服務中斷，正在重新連線；耳機音源已停止。",
          );
          if (event.code !== 4001)
            retry = setTimeout(() => {
              void connect();
            }, 2000);
        };
        ws.onerror = () => ws.close();
      } catch {
        if (!disposed) {
          setError("無法連接本機服務，請執行 Windows 啟動檔。");
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
  }, [audio]);
  const request = useCallback(async (path: string, body: unknown) => {
    if (socket.current?.readyState !== WebSocket.OPEN)
      throw new Error("本機服務尚未連線，請等待恢復。");
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
  }, []);
  const monitor = useCallback(
    async (enabled: boolean) => {
      if (enabled && socket.current?.readyState !== WebSocket.OPEN)
        throw new Error("請等待本機控制服務連線後再開始監聽。");
      if (enabled) await audio.start();
      else await audio.stop();
      monitoring.current = enabled;
      if (socket.current?.readyState === WebSocket.OPEN)
        socket.current.send(JSON.stringify({ type: "monitor", enabled }));
    },
    [audio],
  );
  return { state, connected, error, setError, request, monitor };
}
