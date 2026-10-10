import type { WebSocket } from "ws";
import type { ControlService } from "./service.js";
import type { LaneId, ServerMessage } from "../shared/types.js";

// Remote fallback through HTTPS/WSS; per-user Opus packets are never mixed here.
export class OpusOutput {
  private enabled = false;
  private generation = 0;
  constructor(
    private socket: WebSocket,
    private service: ControlService,
  ) {
    service.on("media-reset", this.reset);
    service.on("packet", this.packet);
  }
  send(message: ServerMessage) {
    if (this.socket.readyState === 1) this.socket.send(JSON.stringify(message));
  }
  async monitor(enabled: boolean) {
    this.enabled = enabled;
    this.reset();
  }
  async answer(_: string, __: number) {
    throw new Error("Not WebRTC");
  }
  reset = () => {
    this.generation++;
    this.send({ type: "audio-reset" });
  };
  packet = (lane: LaneId, userId: string, payload: Buffer) => {
    if (!this.enabled || this.socket.readyState !== 1) return;
    if (this.socket.bufferedAmount > 256 * 1024) {
      this.socket.close(4002, "網路壅塞，請取得新碼重新連線");
      return;
    }
    this.socket.send(
      JSON.stringify({
        type: "opus",
        lane,
        userId,
        payload: payload.toString("base64"),
        generation: this.generation,
      }),
    );
  };
  close() {
    this.enabled = false;
    this.service.off("media-reset", this.reset);
    this.service.off("packet", this.packet);
  }
}
