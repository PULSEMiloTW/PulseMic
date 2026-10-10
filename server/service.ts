import { EventEmitter } from "node:events";
import {
  ids,
  playbackOwners,
  type Lane,
  type LaneId,
  type Snapshot,
  type SettingsInput,
  type SourceId,
} from "../shared/types.js";
import {
  emptySettings,
  publicSettings,
  settingsSchema,
  type SavedSettings,
  type SettingsStore,
} from "./store.js";
import type { VoiceDriver } from "./driver.js";
import { DiscordDriver } from "./driver.js";
import { DemoDriver } from "./demo.js";
import { ControlError } from "./errors.js";
function newLane(id: LaneId): Lane {
  return {
    id,
    botName: `PulseMic ${id}`,
    botOnline: false,
    selectedSource: id,
    status: "idle",
    channelId: null,
    channelName: null,
    targetName: null,
    members: [],
    error: null,
    playbackLane: null,
  };
}

export class ControlService extends EventEmitter {
  private settings: SavedSettings = emptySettings();
  private driver?: VoiceDriver;
  private busy = false;
  private retrying = new Set<LaneId>();
  private closed = false;
  private operations: Record<LaneId, number> = { A: 0, B: 0 };
  private signature = "";
  state: Snapshot = {
    mode: "live",
    guildName: null,
    validated: false,
    revision: 0,
    notice: "請先到設定輸入並驗證兩個 Bot 憑證。",
    settings: publicSettings(emptySettings()),
    sources: {
      A: { id: "A", channelId: "", name: "" },
      B: { id: "B", channelId: "", name: "" },
    },
    lanes: { A: newLane("A"), B: newLane("B") },
  };
  constructor(
    private store: SettingsStore,
    private factory: () => VoiceDriver = () => new DiscordDriver(),
    private retryDelays = [1000, 3000, 7000],
    private activeIds: readonly LaneId[] = ids,
  ) {
    super();
    if (activeIds.length === 1) {
      this.state.lanes.A.botName = "PulseMic Caster Desk";
      this.state.notice = "請先設定並驗證主播台 Bot 憑證。";
    }
  }
  async start() {
    try {
      this.settings = await this.store.load();
      for (const id of this.activeIds)
        this.state.lanes[id].selectedSource = this.settings.selected[id];
      this.state.settings = publicSettings(this.settings);
      if (this.activeIds.every((id) => this.settings.tokens[id]))
        await this.validate();
    } catch (error) {
      this.state.notice = this.safeError(
        error,
        "無法載入設定，請重新輸入憑證。",
      );
      this.publish();
    }
  }
  private safeError(error: unknown, fallback: string) {
    if (!(error instanceof ControlError)) return fallback;
    // Never echo library errors, which can include authentication or request details.
    const message = error.message;
    return !Object.values(this.settings.tokens).some(
      (token) => token && message.includes(token),
    )
      ? message
      : fallback;
  }
  private botLabel(id: LaneId) {
    return this.activeIds.length === 1
      ? "PulseMic Caster Desk"
      : `機器人 ${id}`;
  }
  private clearLane(id: LaneId) {
    const lane = this.state.lanes[id];
    lane.channelId = null;
    lane.channelName = null;
    lane.members = [];
    lane.playbackLane = null;
  }
  publish() {
    const owners = playbackOwners(this.state.lanes);
    for (const id of this.activeIds)
      this.state.lanes[id].playbackLane = owners[id];
    this.state.revision++;
    const signature = JSON.stringify(
      ids.map((id) => {
        const lane = this.state.lanes[id];
        return [
          id,
          lane.channelId,
          lane.status,
          lane.playbackLane,
          lane.members.map((member) => member.id).sort(),
        ];
      }),
    );
    if (signature !== this.signature) {
      this.signature = signature;
      this.emit("media-reset");
    }
    this.emit("state", this.state);
  }
  private refresh() {
    if (!this.driver) return;
    this.state.guildName = this.driver.metadata.guildName;
    for (const source of ids)
      this.state.sources[source] = {
        id: source,
        channelId: this.driver.metadata.channels[source].id,
        name: this.driver.metadata.channels[source].name,
      };
    for (const id of this.activeIds) {
      const lane = this.state.lanes[id];
      if (lane.status === "listening") {
        const channel = this.driver.metadata.channels[lane.selectedSource];
        if (!channel.name) {
          this.fail(id, "語音頻道已刪除，請重新設定並驗證。");
          continue;
        }
        lane.channelName = channel.name;
        lane.members = this.driver.members(id);
      } else if (["connecting", "reconnecting"].includes(lane.status))
        lane.targetName = this.state.sources[lane.selectedSource].name;
    }
    this.publish();
  }
  private bind(driver: VoiceDriver) {
    driver.bind({
      change: () => this.refresh(),
      online: (id, online) => {
        this.state.lanes[id].botOnline = online;
        this.publish();
      },
      disconnected: (id) => {
        void this.recover(id);
      },
      fault: (id, reason) => {
        if (this.closed) return;
        if (this.state.lanes[id].status === "listening") void this.recover(id);
        else if (this.state.lanes[id].status === "reconnecting") {
          this.state.lanes[id].error = reason;
          this.driver?.leave(id);
          this.publish();
        } else this.fail(id, reason);
      },
      speaking: (id, userId, speaking) => {
        const member = this.state.lanes[id].members.find(
          (member) => member.id === userId,
        );
        if (member && this.state.lanes[id].status === "listening") {
          member.speaking = speaking;
          this.publish();
        }
      },
      packet: (id, userId, packet) => {
        const lane = this.state.lanes[id];
        if (
          lane.status === "listening" &&
          lane.playbackLane === id &&
          lane.members.some((member) => member.id === userId)
        )
          this.emit("packet", id, userId, packet);
      },
    });
  }
  private assertAvailable() {
    if (
      this.busy ||
      this.activeIds.some((id) =>
        ["connecting", "disconnecting", "reconnecting"].includes(
          this.state.lanes[id].status,
        ),
      )
    )
      throw new ControlError("操作處理中，請等待後端確認。");
  }
  async validate(input?: SettingsInput) {
    this.assertAvailable();
    this.busy = true;
    let next: VoiceDriver | undefined;
    this.state.notice = "正在驗證伺服器、Bot 與語音頻道權限…";
    this.publish();
    try {
      const parsed = input ? settingsSchema.parse(input) : this.settings;
      const candidate: SavedSettings = {
        ...parsed,
        tokens: {
          A: parsed.tokens.A || this.settings.tokens.A,
          B: parsed.tokens.B || this.settings.tokens.B,
        },
        selected: { ...this.settings.selected },
      };
      if (this.activeIds.some((id) => !candidate.tokens[id]))
        throw new ControlError(
          this.activeIds.length === 1
            ? "請輸入主播台 Bot Token。"
            : "請輸入兩個 Bot Token。",
        );
      if (
        this.activeIds.length > 1 &&
        candidate.tokens.A === candidate.tokens.B
      )
        throw new ControlError("兩個 Bot Token 必須對應不同的 Bot。");
      if (
        this.state.mode === "live" &&
        this.activeIds.some((id) => this.state.lanes[id].status === "listening")
      )
        throw new ControlError("請先關閉語音，再變更或重新驗證設定。");
      next = this.factory();
      await next.initialize(candidate);
      await this.store.save(candidate);
      this.driver?.close();
      this.driver = next;
      next = undefined;
      this.settings = candidate;
      this.state.mode = "live";
      this.state.validated = true;
      this.state.settings = publicSettings(candidate);
      for (const id of this.activeIds) {
        this.clearLane(id);
        Object.assign(this.state.lanes[id], {
          status: "idle",
          error: null,
          targetName: null,
          botOnline: true,
          botName: this.driver.identities[id].name,
          selectedSource: candidate.selected[id],
        });
      }
      this.bind(this.driver);
      this.refresh();
      this.state.notice = "設定驗證成功。Bot 已在線，尚未加入語音。";
      this.publish();
    } catch (error) {
      next?.close();
      this.state.notice = this.safeError(
        error,
        "設定驗證失敗，請確認 Token、ID、Bot 邀請及網路。",
      );
      this.publish();
      throw new ControlError(this.state.notice);
    } finally {
      this.busy = false;
    }
  }
  async mode(mode: "live" | "demo") {
    this.assertAvailable();
    this.driver?.close();
    this.driver = undefined;
    this.state.mode = mode;
    this.state.validated = false;
    this.state.guildName = null;
    this.state.sources = {
      A: { id: "A", channelId: "", name: "" },
      B: { id: "B", channelId: "", name: "" },
    };
    for (const id of this.activeIds) {
      this.clearLane(id);
      Object.assign(this.state.lanes[id], {
        status: "idle",
        error: null,
        targetName: null,
        botOnline: false,
        botName:
          this.activeIds.length === 1
            ? "PulseMic Caster Desk"
            : `PulseMic ${id}`,
      });
    }
    if (mode === "demo") {
      this.driver = new DemoDriver(this.activeIds.length === 1);
      this.bind(this.driver);
      this.state.validated = true;
      for (const id of this.activeIds) this.state.lanes[id].botOnline = true;
      this.refresh();
      this.state.notice =
        "示範模式：虛構成員與本機測試音，不代表 Discord 收音。";
    } else this.state.notice = "已回到真實模式。請驗證設定後派遣 Bot。";
    this.publish();
  }
  async command(
    id: LaneId,
    action: "open" | "close" | "switch",
    source?: SourceId,
  ) {
    if (
      !this.activeIds.includes(id) ||
      (this.activeIds.length === 1 && source === "B")
    )
      throw new ControlError("主播台只能使用自己的語音來源。");
    if (this.busy || this.retrying.has(id))
      throw new ControlError("操作處理中，請等待後端確認。");
    const lane = this.state.lanes[id];
    if (["connecting", "disconnecting", "reconnecting"].includes(lane.status))
      throw new ControlError("這一路操作處理中。");
    if (!this.driver || !this.state.validated)
      throw new ControlError("請先驗證設定或啟用示範模式。");
    if (action === "close") {
      lane.status = "disconnecting";
      this.clearLane(id);
      this.publish();
      this.driver.leave(id);
      lane.status = "idle";
      lane.targetName = null;
      lane.error = null;
      this.state.notice = `${this.botLabel(id)} 已退出語音，保留 Discord 在線。`;
      this.publish();
      return;
    }
    const selected = source ?? lane.selectedSource;
    if (!this.state.sources[selected].name)
      throw new ControlError("無法取得目標頻道名稱，請重新驗證設定。");
    lane.status = "connecting";
    lane.error = null;
    lane.selectedSource = selected;
    const operation = ++this.operations[id];
    lane.targetName = this.state.sources[selected].name;
    this.clearLane(id);
    this.driver.leave(id);
    this.publish();
    try {
      if (this.state.mode === "live") {
        this.settings.selected[id] = selected;
        await this.store.save(this.settings);
      }
      this.state.settings = publicSettings(this.settings);
      await this.driver.join(id, selected);
      if (operation !== this.operations[id] || this.closed)
        throw new ControlError("語音連線已中止，請重試。");
      lane.status = "listening";
      lane.channelId = this.state.sources[selected].channelId;
      lane.channelName = this.state.sources[selected].name;
      lane.targetName = null;
      lane.members = this.driver.members(id);
      this.state.notice = `${this.botLabel(id)} 已加入 ${lane.channelName}。`;
      this.publish();
    } catch (error) {
      this.fail(
        id,
        this.safeError(error, "加入語音失敗，請檢查網路及 Bot 權限後重試。"),
      );
      throw new ControlError(lane.error!);
    }
  }
  private fail(id: LaneId, reason: string) {
    this.operations[id]++;
    this.driver?.leave(id);
    this.clearLane(id);
    Object.assign(this.state.lanes[id], {
      status: "error",
      error: reason,
      targetName: null,
    });
    this.state.notice = `${this.botLabel(id)}：${reason}`;
    this.publish();
  }
  private async recover(id: LaneId) {
    const lane = this.state.lanes[id];
    if (
      this.closed ||
      this.retrying.has(id) ||
      lane.status !== "listening" ||
      !this.driver
    )
      return;
    this.retrying.add(id);
    lane.error = null;
    lane.status = "reconnecting";
    lane.targetName = this.state.sources[lane.selectedSource].name;
    this.clearLane(id);
    this.driver.leave(id);
    this.publish();
    try {
      for (const delay of this.retryDelays) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (this.closed || lane.status !== "reconnecting") return;
        try {
          await this.driver.join(id, lane.selectedSource);
          if (this.closed || lane.status !== "reconnecting") {
            this.driver.leave(id);
            return;
          }
          lane.status = "listening";
          lane.channelId = this.state.sources[lane.selectedSource].channelId;
          lane.channelName = this.state.sources[lane.selectedSource].name;
          lane.targetName = null;
          lane.error = null;
          lane.members = this.driver.members(id);
          this.state.notice = `${this.botLabel(id)} 語音連線已恢復。`;
          this.publish();
          return;
        } catch {
          this.driver.leave(id);
        }
      }
      this.fail(id, "自動恢復失敗，請檢查網路及頻道權限，再按重試連線。");
    } finally {
      this.retrying.delete(id);
    }
  }
  close() {
    this.closed = true;
    this.driver?.close();
    this.removeAllListeners();
  }
}
