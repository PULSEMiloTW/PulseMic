import { randomInt } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  MediaStreamTrack,
  RTCPeerConnection,
  RTCRtpCodecParameters,
  RtpHeader,
  RtpPacket,
} from "werift";
import type { WebSocket } from "ws";
import {
  ids,
  type LaneId,
  type ServerMessage,
  type TrackInfo,
} from "../shared/types.js";
import type { ControlService } from "./service.js";

// Opus TOC frame duration at 48 kHz (RFC 6716 §3.1). Discord silence is also Opus.
export function opusSamples(packet: Buffer): number {
  if (!packet.length) throw new Error("Empty Opus packet");
  const toc = packet[0];
  const frame =
    toc & 0x80
      ? (48000 << ((toc >> 3) & 3)) / 400
      : (toc & 0x60) === 0x60
        ? toc & 8
          ? 960
          : 480
        : ((toc >> 3) & 3) === 3
          ? 2880
          : (48000 << ((toc >> 3) & 3)) / 100;
  const code = toc & 3;
  const count = code === 0 ? 1 : code === 3 ? (packet[1] ?? 0) & 63 : 2;
  if (!count || frame * count > 5760) throw new Error("Invalid Opus duration");
  return frame * count;
}
export function createLocalPeer() {
  return new RTCPeerConnection({
    codecs: {
      audio: [
        new RTCRtpCodecParameters({
          mimeType: "audio/opus",
          clockRate: 48000,
          channels: 2,
          payloadType: 111,
        }),
      ],
    },
    iceServers: [],
    iceUseIpv6: false,
    iceUseTcp: false,
    iceInterfaceAddresses: { udp4: "127.0.0.1" },
    iceAdditionalHostAddresses: ["127.0.0.1"],
  });
}
export class MediaSession {
  private peer?: RTCPeerConnection;
  private generation = 0;
  private enabled = false;
  private timer?: ReturnType<typeof setTimeout>;
  private tracks = new Map<
    string,
    {
      track: MediaStreamTrack;
      sequence: number;
      timestamp: number;
      start: number;
      base: number;
    }
  >();
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
  reset = () => {
    this.generation++;
    const generation = this.generation;
    clearTimeout(this.timer);
    this.drop();
    this.send({ type: "audio-reset" });
    if (this.enabled && this.service.state.mode === "live")
      this.timer = setTimeout(() => {
        void this.offer(generation);
      }, 120);
  };
  private drop() {
    for (const item of this.tracks.values()) item.track.stop();
    this.tracks.clear();
    const peer = this.peer;
    this.peer = undefined;
    if (peer) void peer.close().catch(() => {});
  }
  private async offer(generation: number) {
    const info: TrackInfo[] = [];
    const lanes = this.service.state.lanes;
    if (
      !ids.some(
        (id) =>
          lanes[id].status === "listening" &&
          lanes[id].playbackLane === id &&
          lanes[id].members.length,
      )
    )
      return;
    const peer = createLocalPeer();
    this.peer = peer;
    for (const lane of ids) {
      if (
        lanes[lane].status !== "listening" ||
        lanes[lane].playbackLane !== lane
      )
        continue;
      for (const member of lanes[lane].members) {
        const track = new MediaStreamTrack({
          kind: "audio",
          id: `${lane}-${member.id}`,
        });
        const transceiver = peer.addTransceiver(track, {
          direction: "sendonly",
        });
        this.tracks.set(`${lane}:${member.id}`, {
          track,
          sequence: randomInt(65536),
          timestamp: 0,
          base: randomInt(2 ** 32),
          start: performance.now(),
        });
        info.push({
          mid: String(transceiver.mid ?? info.length),
          lane,
          userId: member.id,
        });
      }
    }
    try {
      await peer.setLocalDescription(await peer.createOffer());
      if (generation !== this.generation) {
        await peer.close();
        return;
      }
      // MIDs are assigned when creating the local description.
      peer.getTransceivers().forEach((transceiver, index) => {
        info[index].mid = transceiver.mid!;
      });
      this.send({
        type: "offer",
        sdp: peer.localDescription!.sdp,
        tracks: info,
        generation,
      });
    } catch {
      if (generation === this.generation) {
        this.drop();
        this.send({
          type: "error",
          message: "本機音訊連線建立失敗，請停止並重新開始監聽。",
        });
      }
    }
  }
  async answer(sdp: string, generation: number) {
    if (generation !== this.generation || !this.peer) return;
    await this.peer.setRemoteDescription({ type: "answer", sdp });
  }
  packet = (lane: LaneId, userId: string, payload: Buffer) => {
    if (!this.enabled || this.peer?.connectionState !== "connected") return;
    const item = this.tracks.get(`${lane}:${userId}`);
    if (!item) return;
    try {
      const duration = opusSamples(payload);
      const timestamp = Math.max(
        item.timestamp,
        Math.round((performance.now() - item.start) * 48),
      );
      const header = new RtpHeader({
        payloadType: 111,
        sequenceNumber: item.sequence++ & 65535,
        timestamp: (item.base + timestamp) >>> 0,
        ssrc: 1,
      });
      item.timestamp = timestamp + duration;
      item.track.writeRtp(new RtpPacket(header, payload));
    } catch {
      /* Discard malformed packets; never log audio or credentials. */
    }
  };
  close() {
    this.enabled = false;
    this.generation++;
    clearTimeout(this.timer);
    this.drop();
    this.service.off("media-reset", this.reset);
    this.service.off("packet", this.packet);
  }
}
