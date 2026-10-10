import type { LaneId, Member, SourceId } from "../shared/types.js";
import type { DriverEvents, Metadata, VoiceDriver } from "./driver.js";
import type { SavedSettings } from "./store.js";
export class DemoDriver implements VoiceDriver {
  metadata: Metadata = {
    guildName: "Pulse 賽事演練伺服器（示範）",
    channels: {
      A: { id: "demo-blue", name: "藍隊選手語音" },
      B: { id: "demo-amber", name: "琥珀隊選手語音" },
    },
  };
  identities = {
    A: { id: "demo-bot-a", name: "PulseMic A" },
    B: { id: "demo-bot-b", name: "PulseMic B" },
  };
  constructor(caster = false) {
    if (caster) {
      this.metadata.channels.A = {
        id: "demo-caster",
        name: "主播台語音（示範）",
      };
      this.metadata.channels.B = this.metadata.channels.A;
      this.identities.A = {
        id: "demo-caster-bot",
        name: "PulseMic Caster Desk",
      };
    }
  }
  private sources = new Map<LaneId, SourceId>();
  private events?: DriverEvents;
  async initialize(_: SavedSettings) {}
  bind(events: DriverEvents) {
    this.events = events;
  }
  async join(id: LaneId, source: SourceId) {
    await new Promise((resolve) => setTimeout(resolve, 650));
    this.sources.set(id, source);
  }
  leave(id: LaneId) {
    this.sources.delete(id);
  }
  members(id: LaneId): Member[] {
    const source = this.sources.get(id);
    return source
      ? (this.identities.A.id === "demo-caster-bot"
          ? ["主播", "賽評", "製播協調"]
          : ["隊長", "選手 02", "選手 03", "選手 04", "隊長"]
        ).map((name, index) => ({
          id:
            this.identities.A.id === "demo-caster-bot"
              ? `demo-caster-${index}`
              : `demo-${source}-${index}`,
          name,
          avatar: "",
          speaking: false,
        }))
      : [];
  }
  rename(source: SourceId, name: string) {
    this.metadata.channels[source].name = name;
    this.events?.change();
  }
  close() {
    this.sources.clear();
  }
}
