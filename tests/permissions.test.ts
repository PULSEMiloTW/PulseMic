import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Permissions, ownerId } from "../server/permissions.js";
import { Access } from "../server/access.js";
import { Journal, StatusMonitor, botStatus } from "../server/observability.js";
test("owner identity is fixed; operator allowlist persists and removal applies to existing sessions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pulsemic-permissions-"));
  try {
    const permissions = new Permissions(directory);
    await permissions.load();
    assert.equal(permissions.role(ownerId), "owner");
    assert.equal(permissions.role("123456789012345678"), null);
    await permissions.save([
      ownerId,
      "123456789012345678",
      "123456789012345678",
    ]);
    assert.deepEqual(permissions.list(), ["123456789012345678"]);
    const access = new Access();
    const token = access.controller({
      id: "123456789012345678",
      name: "operator",
      avatar: "",
    });
    assert.equal(permissions.role(access.profile(token)?.id), "operator");
    const reload = new Permissions(directory);
    await reload.load();
    assert.equal(reload.role(access.profile(token)?.id), "operator");
    await permissions.save([]);
    assert.equal(permissions.role(access.profile(token)?.id), null);
    assert.equal(permissions.role(ownerId), "owner");
    assert.throws(() => permissions.save(["bad"]));
    await writeFile(join(directory, "operators.json"), "invalid");
    await assert.rejects(new Permissions(directory).load());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("journal is bounded and status histories preserve unknown rather than invent uptime", async () => {
  const journal = new Journal();
  for (let i = 0; i < 205; i++) journal.add(`operation ${i}`);
  assert.equal(journal.list().length, 200);
  assert.equal(journal.list()[0].id, 6);
  const directory = await mkdtemp(join(tmpdir(), "pulsemic-status-"));
  try {
    const monitor = new StatusMonitor(directory);
    await monitor.load();
    assert.equal(monitor.report([]).history.length, 0);
    monitor.observe(403, 12);
    monitor.observe(500, 5);
    assert.equal(monitor.report([]).failures, 1);
    await monitor.sample([{ id: "bot", name: "Bot", status: "unknown" }]);
    assert.equal(monitor.report([]).history[0].status, "unknown");
    const reload = new StatusMonitor(directory);
    await reload.load();
    assert.equal(reload.report([]).history.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
