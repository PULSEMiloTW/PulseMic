import type { LaneId, Mix, Snapshot, TrackInfo } from "../shared/types";
import { laneGain } from "./mix";
type Input = {
  source: AudioNode;
  gain: GainNode;
  analyser: AnalyserNode;
  stop: () => void;
  data: Float32Array<ArrayBuffer>;
};
export class HeadphoneMixer {
  private context?: AudioContext;
  private master?: GainNode;
  private lanes = new Map<LaneId, GainNode>();
  private inputs = new Map<string, Input>();
  private peer?: RTCPeerConnection;
  private decoders = new Map<
    string,
    {
      decoder: AudioDecoder;
      timestamp: number;
      next: number;
      bus: GainNode;
      playing: Set<AudioBufferSourceNode>;
    }
  >();
  private generation = 0;
  private meters = new Map<string, HTMLElement>();
  private raf = 0;
  private active = false;
  private testTone = false;
  private mix?: Mix;
  private state?: Snapshot;
  onStatus: (status: string) => void = () => {};
  async start() {
    this.context ??= new AudioContext({
      latencyHint: "interactive",
      sampleRate: 48000,
    });
    if (!this.master) {
      this.master = this.context.createGain();
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.1;
      this.master.connect(limiter);
      limiter.connect(this.context.destination);
      for (const id of ["A", "B"] as const) {
        const gain = this.context.createGain();
        gain.connect(this.master);
        this.lanes.set(id, gain);
      }
    }
    await this.context.resume();
    this.active = true;
    if (this.mix) this.updateMix(this.mix);
    this.onStatus("耳機監聽已啟用，等待獨立成員音源");
    this.measure();
    this.syncDemo();
  }
  async stop() {
    this.active = false;
    this.reset();
    cancelAnimationFrame(this.raf);
    await this.context?.suspend();
    this.onStatus("耳機監聽已停止");
  }
  reset() {
    this.generation++;
    this.peer?.close();
    this.peer = undefined;
    for (const item of this.decoders.values()) {
      if (item.decoder.state !== "closed") item.decoder.close();
      for (const source of item.playing) {
        source.stop();
        source.disconnect();
      }
    }
    this.decoders.clear();
    for (const input of this.inputs.values()) {
      input.stop();
      input.source.disconnect();
      input.gain.disconnect();
      input.analyser.disconnect();
    }
    this.inputs.clear();
    for (const meter of this.meters.values()) this.paint(meter, 0);
    if (this.active) this.onStatus("耳機監聽已啟用，等待獨立成員音源");
  }
  updateMix(mix: Mix) {
    this.mix = mix;
    const now = this.context?.currentTime ?? 0;
    this.master?.gain.setTargetAtTime(
      this.active && !mix.muted ? mix.master / 100 : 0,
      now,
      0.015,
    );
    for (const [id, gain] of this.lanes)
      gain.gain.setTargetAtTime(laneGain(mix, id), now, 0.015);
    for (const [key, input] of this.inputs) {
      const userId = key.slice(2);
      const member = mix.members[userId];
      input.gain.gain.setTargetAtTime(
        member?.muted ? 0 : (member?.volume ?? 100) / 100,
        now,
        0.015,
      );
    }
  }
  updateState(state: Snapshot) {
    this.state = state;
    this.syncDemo();
  }
  opus(lane: LaneId, userId: string, payload: string) {
    if (
      !this.active ||
      !this.context ||
      !this.state ||
      this.state.mode !== "live"
    )
      return;
    const laneState = this.state.lanes[lane];
    if (
      laneState.status !== "listening" ||
      laneState.playbackLane !== lane ||
      !laneState.members.some((member) => member.id === userId)
    )
      return;
    const key = `${lane}:${userId}`;
    let item = this.decoders.get(key);
    if (!item) {
      const context = this.context;
      const generation = this.generation;
      const bus = context.createGain();
      const playing = new Set<AudioBufferSourceNode>();
      const decoder = new AudioDecoder({
        output: (data) => {
          try {
            const current = this.decoders.get(key);
            if (!current || generation !== this.generation) return;
            if (current.next > context.currentTime + 0.25) return;
            const buffer = context.createBuffer(
              data.numberOfChannels,
              data.numberOfFrames,
              data.sampleRate,
            );
            for (let channel = 0; channel < data.numberOfChannels; channel++)
              data.copyTo(buffer.getChannelData(channel), {
                planeIndex: channel,
                format: "f32-planar",
              });
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.connect(bus);
            playing.add(source);
            source.onended = () => {
              playing.delete(source);
              source.disconnect();
            };
            const at = Math.max(current.next, context.currentTime + 0.04);
            source.start(at);
            current.next = at + buffer.duration;
            this.onStatus("遠端獨立音源播放中");
          } finally {
            data.close();
          }
        },
        error: () => {
          this.reset();
          this.onStatus("音訊解碼失敗，請停止並重新開始播放");
        },
      });
      decoder.configure({
        codec: "opus",
        sampleRate: 48000,
        numberOfChannels: 2,
      });
      item = { decoder, bus, playing, timestamp: 0, next: 0 };
      this.decoders.set(key, item);
      this.attach(lane, userId, bus, () => {});
    }
    if (
      item.decoder.state !== "configured" ||
      item.decoder.decodeQueueSize > 12
    )
      return;
    const bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
    item.decoder.decode(
      new EncodedAudioChunk({
        type: "key",
        timestamp: item.timestamp,
        data: bytes,
      }),
    );
    item.timestamp += 20000;
  }
  toggleTone(enabled: boolean) {
    this.testTone = enabled;
    this.syncDemo();
  }
  private attach(
    lane: LaneId,
    userId: string,
    source: AudioNode,
    stop: () => void,
  ) {
    if (!this.context) return;
    const gain = this.context.createGain();
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(gain);
    gain.connect(analyser);
    analyser.connect(this.lanes.get(lane)!);
    this.inputs.set(`${lane}:${userId}`, {
      source,
      gain,
      analyser,
      stop,
      data: new Float32Array(analyser.fftSize),
    });
    if (this.mix) this.updateMix(this.mix);
  }
  private syncDemo() {
    if (!this.active || this.state?.mode !== "demo" || !this.context) return;
    const expected = new Set<string>();
    if (this.testTone)
      for (const lane of ["A", "B"] as const) {
        const state = this.state.lanes[lane];
        const member = state.members[0];
        if (
          state.status !== "listening" ||
          state.playbackLane !== lane ||
          !member
        )
          continue;
        const key = `${lane}:${member.id}`;
        expected.add(key);
        if (this.inputs.has(key)) continue;
        const oscillator = this.context.createOscillator();
        oscillator.frequency.value = lane === "A" ? 440 : 660;
        const quiet = this.context.createGain();
        quiet.gain.value = 0.06;
        oscillator.connect(quiet);
        oscillator.start();
        this.attach(lane, member.id, quiet, () => {
          oscillator.stop();
          oscillator.disconnect();
        });
      }
    for (const [key, input] of this.inputs)
      if (!expected.has(key)) {
        input.stop();
        input.source.disconnect();
        input.gain.disconnect();
        input.analyser.disconnect();
        this.inputs.delete(key);
      }
    this.onStatus(
      this.inputs.size
        ? "示範測試音播放中（本機產生）"
        : "示範監聽已啟用，尚未播放測試音",
    );
  }
  async offer(
    sdp: string,
    tracks: TrackInfo[],
    generation: number,
    answer: (sdp: string, generation: number) => void,
  ) {
    this.reset();
    if (!this.active || !this.context) return;
    const localGeneration = this.generation;
    const peer = new RTCPeerConnection({ iceServers: [] });
    this.peer = peer;
    const mapping = new Map(tracks.map((track) => [track.mid, track]));
    peer.ontrack = (event) => {
      if (localGeneration !== this.generation || !this.context) {
        event.track.stop();
        return;
      }
      const info = mapping.get(event.transceiver.mid!);
      if (!info) return;
      const stream = new MediaStream([event.track]);
      const source = this.context.createMediaStreamSource(stream);
      this.attach(info.lane, info.userId, source, () => event.track.stop());
    };
    peer.onconnectionstatechange = () => {
      if (localGeneration !== this.generation) return;
      if (peer.connectionState === "connected")
        this.onStatus("WebRTC 已連線，耳機監聽中");
      if (["failed", "disconnected"].includes(peer.connectionState)) {
        this.reset();
        this.onStatus("音訊連線中斷，請停止並重新開始監聽");
      }
    };
    try {
      await peer.setRemoteDescription({ type: "offer", sdp });
      await peer.setLocalDescription(await peer.createAnswer());
      await new Promise<void>((resolve, reject) => {
        if (peer.iceGatheringState === "complete") return resolve();
        const timer = setTimeout(
          () => reject(new Error("本機音訊連線逾時")),
          6000,
        );
        peer.addEventListener("icegatheringstatechange", () => {
          if (peer.iceGatheringState === "complete") {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      if (localGeneration === this.generation)
        answer(peer.localDescription!.sdp, generation);
    } catch {
      if (localGeneration === this.generation) {
        this.reset();
        this.onStatus("音訊建立失敗，請停止並重新開始監聽");
      }
    }
  }
  meter(key: string, element: HTMLElement | null) {
    if (element) this.meters.set(key, element);
    else this.meters.delete(key);
  }
  private paint(element: HTMLElement, value: number) {
    element.style.setProperty("--level", String(value));
    element.dataset.active = value > 0.008 ? "true" : "false";
  }
  private measure = () => {
    if (!this.active) return;
    for (const [key, element] of this.meters) {
      const input = this.inputs.get(key);
      let rms = 0;
      if (input) {
        input.analyser.getFloatTimeDomainData(input.data);
        for (const sample of input.data) rms += sample * sample;
        rms = Math.sqrt(rms / input.data.length);
      }
      this.paint(element, Math.min(1, rms * 5));
    }
    this.raf = requestAnimationFrame(this.measure);
  };
  dispose() {
    void this.stop();
    void this.context?.close();
    this.meters.clear();
  }
}
