import { test } from "node:test";
import assert from "node:assert/strict";
import { BotIdentities } from "../server/bot-identities.js";

test("identity reservation rejects shared caster/player Bot even before validation completes", () => {
  const identities = new BotIdentities();
  const players = {},
    caster = {};
  identities.claim("bot-1", "players", players);
  assert.throws(() => identities.claim("bot-1", "caster", caster), /不同/);
  identities.claim("bot-2", "caster", caster);
  assert.deepEqual([...identities.ids()].sort(), ["bot-1", "bot-2"]);
  identities.release(caster);
  assert.deepEqual([...identities.ids()], ["bot-1"]);
});

test("revalidation retains a Bot reservation until both old and candidate drivers close", () => {
  const identities = new BotIdentities();
  const old = {},
    candidate = {};
  identities.claim("bot-1", "players", old);
  identities.claim("bot-1", "players", candidate);
  identities.release(old);
  assert.throws(() => identities.claim("bot-1", "caster", {}), /不同/);
  identities.release(candidate);
  assert.equal(identities.ids().size, 0);
  identities.claim("bot-1", "caster", {});
});
