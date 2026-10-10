import { test } from "node:test";
import assert from "node:assert/strict";
import { Access } from "../server/access.js";

test("output codes redeem once; grants claim one socket and revoke on exit", () => {
  const access = new Access();
  const { code } = access.issueCode();
  assert.equal(access.redeem("wrong"), undefined);
  const token = access.redeem(code)!;
  assert.ok(token);
  assert.equal(access.redeem(code), undefined);
  assert.equal(access.outputValid(token), false);
  assert.equal(access.claimOutput(token), true);
  assert.equal(access.claimOutput(token), false);
  assert.equal(access.outputValid(token), true);
  access.revokeOutput(token);
  assert.equal(access.outputValid(token), false);
});
test("expired codes, unclaimed grants, OAuth states and controller sessions deny access", () => {
  let time = 0;
  const access = new Access(() => time);
  const code = access.issueCode().code;
  const token = access.redeem(code)!;
  const code2 = access.issueCode().code;
  const state = access.loginState();
  const controller = access.controller();
  assert.equal(access.controllerValid(controller), true);
  time = 5 * 60_000 + 1;
  assert.equal(access.claimOutput(token), false);
  assert.equal(access.redeem(code2), undefined);
  assert.equal(access.consumeState(state), false);
  time = 8 * 60 * 60_000;
  assert.equal(access.controllerValid(controller), false);
});
test("OAuth state and logout invalidate authorization", () => {
  const access = new Access();
  const state = access.loginState();
  assert.equal(access.consumeState(state), true);
  assert.equal(access.consumeState(state), false);
  const token = access.controller();
  access.logout(token);
  assert.equal(access.controllerValid(token), false);
});
