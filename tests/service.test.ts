import { test } from "node:test";
import assert from "node:assert/strict";
import { ControlService } from "../server/service.js";
import { emptySettings, type SavedSettings } from "../server/store.js";
import type { DriverEvents, VoiceDriver } from "../server/driver.js";
import {
  laneTitle,
  laneStatus,
  type LaneId,
  type SourceId,
} from "../shared/types.js";

const settings: SavedSettings = {
  guildId: "123456789012345678",
  channels: { A: "223456789012345678", B: "323456789012345678" },
  tokens: { A: "test-only-a", B: "test-only-b" },
  selected: { A: "B", B: "A" },
};
class FakeDriver implements VoiceDriver {
  metadata = {
    guildName: "測試伺服器",
    channels: {
      A: { id: settings.channels.A, name: "藍隊選手語音" },
      B: { id: settings.channels.B, name: "琥珀隊選手語音" },
    },
  };
  identities = {
    A: { id: "bot-a", name: "Bot A" },
    B: { id: "bot-b", name: "Bot B" },
  };
  events?: DriverEvents;
  joined = new Map<LaneId, SourceId>();
  wait?: () => Promise<void>;
  reject = false;
  async initialize(_: SavedSettings) {}
  bind(events: DriverEvents) {
    this.events = events;
  }
  async join(id: LaneId, source: SourceId) {
    await this.wait?.();
    if (this.reject) throw new Error("測試連線失敗");
    this.joined.set(id, source);
  }
  leave(id: LaneId) {
    this.joined.delete(id);
  }
  members(id: LaneId) {
    return this.joined.has(id)
      ? [
          { id: "user-1", name: "隊長", avatar: "", speaking: false },
          { id: "user-2", name: "隊長", avatar: "", speaking: false },
        ]
      : [];
  }
  close() {
    this.joined.clear();
  }
}
async function fixture(delays = [0]) {
  const driver = new FakeDriver();
  let saved = structuredClone(settings);
  const service = new ControlService(
    {
      load: async () => structuredClone(saved),
      save: async (input) => {
        saved = structuredClone(input);
      },
    },
    () => driver,
    delays,
  );
  await service.start();
  return { service, driver, saved: () => saved };
}
test("startup validates identities but never automatically joins voice or exposes tokens", async () => {
  const { service, driver } = await fixture();
  assert.equal(service.state.validated, true);
  assert.equal(driver.joined.size, 0);
  assert.equal(service.state.lanes.A.selectedSource, "B");
  assert.equal(JSON.stringify(service.state).includes("test-only"), false);
  service.close();
});
test("Bot A can select source B with actual Discord channel name", async () => {
  const { service } = await fixture();
  await service.command("A", "open");
  const lane = service.state.lanes.A;
  assert.equal(lane.id, "A");
  assert.equal(lane.selectedSource, "B");
  assert.equal(laneTitle(lane), "琥珀隊選手語音");
  assert.equal(laneStatus(lane), "正在收聽");
  service.close();
});
test("switch clears old streams immediately and waits for confirmed join; duplicate commands rejected", async () => {
  const { service, driver } = await fixture();
  await service.command("A", "open");
  let done!: () => void;
  driver.wait = () =>
    new Promise((resolve) => {
      done = resolve;
    });
  const operation = service.command("A", "switch", "A");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.state.lanes.A.status, "connecting");
  assert.equal(service.state.lanes.A.channelId, null);
  assert.equal(service.state.lanes.A.members.length, 0);
  assert.match(laneStatus(service.state.lanes.A), /正在切換至 藍隊/);
  await assert.rejects(service.command("A", "open"), /處理中/);
  done();
  await operation;
  assert.equal(laneTitle(service.state.lanes.A), "藍隊選手語音");
  service.close();
});
test("channel rename updates settings display and both live lanes", async () => {
  const { service, driver } = await fixture();
  await service.command("A", "switch", "A");
  await service.command("B", "switch", "A");
  driver.metadata.channels.A.name = "藍隊・決賽語音";
  driver.events!.change();
  assert.equal(service.state.sources.A.name, "藍隊・決賽語音");
  assert.equal(service.state.lanes.A.channelName, "藍隊・決賽語音");
  assert.equal(service.state.lanes.B.channelName, "藍隊・決賽語音");
  service.close();
});
test("same-channel audio forwards only owner packets and standby takes over on close", async () => {
  const { service, driver } = await fixture();
  await service.command("A", "switch", "B");
  await service.command("B", "switch", "B");
  let played: string[] = [];
  service.on("packet", (id) => played.push(id));
  driver.events!.packet("A", "user-1", Buffer.from([0xf8]));
  driver.events!.packet("B", "user-1", Buffer.from([0xf8]));
  assert.deepEqual(played, ["A"]);
  assert.equal(service.state.lanes.B.playbackLane, "A");
  await service.command("A", "close");
  driver.events!.packet("B", "user-1", Buffer.from([0xf8]));
  assert.deepEqual(played, ["A", "B"]);
  assert.equal(service.state.lanes.B.playbackLane, "B");
  service.close();
});
test("different source codes pointing to same physical channel still deduplicate", async () => {
  const { service, driver } = await fixture();
  driver.metadata.channels.B.id = driver.metadata.channels.A.id;
  driver.events!.change();
  await service.command("A", "switch", "A");
  await service.command("B", "switch", "B");
  assert.equal(service.state.lanes.B.playbackLane, "A");
  service.close();
});
test("failed switch and exit never present previous channel as listening", async () => {
  const { service, driver } = await fixture();
  await service.command("A", "open");
  driver.reject = true;
  await assert.rejects(service.command("A", "switch", "A"));
  const lane = service.state.lanes.A;
  assert.equal(lane.status, "error");
  assert.equal(lane.channelName, null);
  assert.equal(laneTitle(lane), "尚未收聽頻道");
  await service.command("A", "close");
  assert.equal(lane.status, "idle");
  assert.equal(lane.botOnline, true);
  service.close();
});
test("member join/leave and same names preserve separate user IDs; speaking does not renegotiate", async () => {
  const { service, driver } = await fixture();
  await service.command("A", "open");
  let resets = 0;
  service.on("media-reset", () => resets++);
  assert.equal(
    service.state.lanes.A.members[0].name,
    service.state.lanes.A.members[1].name,
  );
  assert.notEqual(
    service.state.lanes.A.members[0].id,
    service.state.lanes.A.members[1].id,
  );
  driver.events!.speaking("A", "user-1", true);
  assert.equal(resets, 0);
  driver.members = () => [
    { id: "user-2", name: "隊長", avatar: "", speaking: false },
  ];
  driver.events!.change();
  assert.equal(service.state.lanes.A.members.length, 1);
  assert.equal(resets, 1);
  service.close();
});
test("disconnect stops audio immediately and auto-recovers only after confirmation", async () => {
  const { service, driver } = await fixture();
  await service.command("A", "open");
  driver.events!.disconnected("A");
  assert.equal(service.state.lanes.A.status, "reconnecting");
  assert.equal(service.state.lanes.A.channelName, null);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(service.state.lanes.A.status, "listening");
  service.close();
});
test("exhausted recovery exposes reason and manual retry succeeds", async () => {
  const { service, driver } = await fixture([0, 0, 0]);
  await service.command("B", "open");
  driver.reject = true;
  driver.events!.disconnected("B");
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(service.state.lanes.B.status, "error");
  assert.match(service.state.lanes.B.error!, /自動恢復失敗/);
  driver.reject = false;
  await service.command("B", "open");
  assert.equal(service.state.lanes.B.status, "listening");
  service.close();
});
test("cannot change real settings while lanes are live", async () => {
  const { service } = await fixture();
  await service.command("A", "open");
  await assert.rejects(service.validate(settings), /先關閉/);
  assert.equal(service.state.lanes.A.status, "listening");
  service.close();
});
test("two tokens required and same token rejected before Discord login", async () => {
  const service = new ControlService({
    load: async () => emptySettings(),
    save: async () => {},
  });
  await service.start();
  await assert.rejects(
    service.validate({ ...settings, tokens: { A: "", B: "" } }),
    /兩個 Bot Token/,
  );
  await assert.rejects(
    service.validate({ ...settings, tokens: { A: "same", B: "same" } }),
    /不同/,
  );
  service.close();
});

test("raw library errors never echo submitted credentials, even with Chinese text", async () => {
  const driver = new FakeDriver();
  driver.initialize = async () => {
    throw new Error("請求失敗 synthetic-sensitive-token");
  };
  const service = new ControlService(
    { load: async () => emptySettings(), save: async () => {} },
    () => driver,
  );
  await service.start();
  await assert.rejects(
    service.validate({
      ...settings,
      tokens: { A: "synthetic-sensitive-token", B: "other-synthetic-token" },
    }),
    (error) => {
      assert.equal(
        (error as Error).message.includes("synthetic-sensitive-token"),
        false,
      );
      return true;
    },
  );
  assert.equal(
    JSON.stringify(service.state).includes("synthetic-sensitive-token"),
    false,
  );
  service.close();
});
test("demo starts idle, clearly marked; return to live clears fictional names", async () => {
  const { service } = await fixture();
  await service.mode("demo");
  assert.equal(service.state.mode, "demo");
  assert.equal(service.state.lanes.A.status, "idle");
  await service.mode("live");
  assert.equal(service.state.guildName, null);
  assert.equal(service.state.sources.A.name, "");
  assert.equal(service.state.validated, false);
  service.close();
});
