import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  WindowsSettingsStore,
  emptySettings,
  publicSettings,
  settingsSchema,
} from "../server/store.js";
import { validHost, validOrigin, validSession } from "../server/security.js";
import { opusSamples } from "../server/media.js";
import { laneGain, defaultMix } from "../src/mix.js";
test(
  "Windows caster credentials are encrypted separately from player credentials",
  { skip: process.platform !== "win32" },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "pulsemic-caster-test-"));
    try {
      const players = new WindowsSettingsStore(directory);
      const caster = new WindowsSettingsStore(directory, "caster.secrets");
      const playerSettings = {
        ...emptySettings(),
        guildId: "123456789012345678",
        channels: { A: "223456789012345678", B: "323456789012345678" },
        tokens: { A: "synthetic-player-a", B: "synthetic-player-b" },
      };
      const casterSettings = {
        ...playerSettings,
        tokens: { A: "synthetic-caster", B: "" },
      };
      await Promise.all([
        players.save(playerSettings),
        caster.save(casterSettings),
      ]);
      assert.deepEqual(await players.load(), playerSettings);
      assert.deepEqual(await caster.load(), casterSettings);
      assert.equal(
        (await readFile(join(directory, "caster.secrets"), "utf8")).includes(
          "synthetic",
        ),
        false,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
test(
  "Windows DPAPI saves encrypted credentials and reloads selected sources",
  { skip: process.platform !== "win32" },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "pulsemic-test-"));
    try {
      const store = new WindowsSettingsStore(directory);
      assert.deepEqual(await store.load(), emptySettings());
      const settings = {
        guildId: "123456789012345678",
        channels: { A: "223456789012345678", B: "323456789012345678" },
        tokens: { A: "synthetic-test-token-a", B: "synthetic-test-token-b" },
        selected: { A: "B", B: "A" },
      } as const;
      await store.save(settings);
      const encrypted = await readFile(
        join(directory, "credentials.secrets"),
        "utf8",
      );
      assert.equal(encrypted.includes("synthetic"), false);
      assert.deepEqual(await store.load(), settings);
      assert.equal(
        JSON.stringify(publicSettings(settings)).includes("synthetic"),
        false,
      );
      await Promise.all([
        store.save({ ...settings, selected: { A: "A", B: "B" } }),
        store.save(settings),
      ]);
      assert.deepEqual(await store.load(), settings);
      await writeFile(
        join(directory, "credentials.secrets"),
        Buffer.from("old-machine-invalid-ciphertext").toString("base64"),
      );
      await assert.rejects(store.load(), /重新輸入/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
test("reject invalid Discord identifiers", () => {
  assert.equal(
    settingsSchema.safeParse({
      guildId: "foo",
      channels: { A: "", B: "" },
      tokens: { A: "", B: "" },
    }).success,
    false,
  );
});
test("localhost API rejects foreign origin, DNS rebinding host and invalid session", () => {
  assert.equal(validHost("localhost:3210", 3210), true);
  assert.equal(validHost("evil.example:3210", 3210), false);
  assert.equal(
    validOrigin("https://evil.example", "localhost:3210", 3210),
    false,
  );
  assert.equal(
    validOrigin("http://localhost:3210", "localhost:3210", 3210),
    true,
  );
  assert.equal(validSession(undefined, "key"), false);
  assert.equal(validSession("wrong", "key"), false);
  assert.equal(validSession("key", "key"), true);
});
test("Opus durations support standard Discord silence and variable packet sizes", () => {
  assert.equal(opusSamples(Buffer.from([0xf8, 0xff, 0xfe])), 960);
  assert.equal(opusSamples(Buffer.from([0xf0])), 480);
  assert.equal(opusSamples(Buffer.from([0xf9])), 1920);
  assert.throws(() => opusSamples(Buffer.alloc(0)));
});
test("lane mute and solo affect headphones only with explicit gains", () => {
  const mix = defaultMix();
  assert.equal(laneGain(mix, "A"), 1);
  mix.lanes.A.volume = 200;
  assert.equal(laneGain(mix, "A"), 2);
  mix.solo = "B";
  assert.equal(laneGain(mix, "A"), 0);
  mix.lanes.B.muted = true;
  assert.equal(laneGain(mix, "B"), 0);
});
