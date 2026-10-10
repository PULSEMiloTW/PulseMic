import { createHash, randomBytes } from "node:crypto";

import type { OutputKind } from "../shared/types.js";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
type Grant = { expires: number; claimed: boolean; kind: OutputKind };

// All grants are memory-only: restarting the service revokes outstanding access.
export class Access {
  private codes = new Map<string, { expires: number; kind: OutputKind }>();
  private outputs = new Map<string, Grant>();
  private controllers = new Map<string, number>();
  private states = new Map<string, number>();
  constructor(private now = Date.now) {}
  private prune() {
    for (const map of [this.controllers, this.states])
      for (const [key, expires] of map)
        if (expires <= this.now()) map.delete(key);
    for (const [key, code] of this.codes)
      if (code.expires <= this.now()) this.codes.delete(key);
    for (const [key, grant] of this.outputs)
      if (grant.expires <= this.now()) this.outputs.delete(key);
  }
  issueCode(kind: OutputKind = "players") {
    this.prune();
    if (this.codes.size >= 100) throw new Error("Too many pending codes");
    const code = randomBytes(12).toString("hex").toUpperCase();
    const expires = this.now() + 5 * 60_000;
    this.codes.set(digest(code), { expires, kind });
    return { code, expires };
  }
  redeem(code: string, kind: OutputKind = "players") {
    this.prune();
    if (this.outputs.size >= 32) return undefined;
    const key = digest(code.trim().toUpperCase());
    if (this.codes.get(key)?.kind !== kind) return undefined;
    this.codes.delete(key);
    const token = secret();
    this.outputs.set(digest(token), {
      expires: this.now() + 60_000,
      claimed: false,
      kind,
    });
    return token;
  }
  claimOutput(token: string, kind: OutputKind = "players") {
    this.prune();
    const grant = this.outputs.get(digest(token));
    if (!grant || grant.claimed || grant.kind !== kind) return false;
    grant.claimed = true;
    grant.expires = this.now() + 8 * 60 * 60_000;
    return true;
  }
  outputValid(token: string) {
    const grant = this.outputs.get(digest(token));
    return Boolean(grant?.claimed && grant.expires > this.now());
  }
  revokeOutput(token: string) {
    this.outputs.delete(digest(token));
  }
  loginState() {
    this.prune();
    if (this.states.size >= 1000) throw new Error("Too many logins");
    const state = secret();
    this.states.set(digest(state), this.now() + 5 * 60_000);
    return state;
  }
  consumeState(state: string) {
    this.prune();
    return this.states.delete(digest(state));
  }
  controller() {
    this.prune();
    if (this.controllers.size >= 100) throw new Error("Too many sessions");
    const token = secret();
    this.controllers.set(digest(token), this.now() + 8 * 60 * 60_000);
    return token;
  }
  controllerValid(token: string) {
    this.prune();
    return this.controllers.has(digest(token));
  }
  logout(token: string) {
    this.controllers.delete(digest(token));
  }
}
