import { ControlError } from "./errors.js";

/** Reserve identities before awaiting settings writes, including concurrent validation. */
export class BotIdentities {
  private claims = new Map<string, { group: string; owners: Set<object> }>();
  claim(id: string, group: string, owner: object) {
    const current = this.claims.get(id);
    if (current && current.group !== group)
      throw new ControlError("主播台與選手必須使用不同的 Discord Bot 身分。");
    const claim = current ?? { group, owners: new Set<object>() };
    claim.owners.add(owner);
    this.claims.set(id, claim);
  }
  release(owner: object) {
    for (const [id, claim] of this.claims) {
      claim.owners.delete(owner);
      if (!claim.owners.size) this.claims.delete(id);
    }
  }
  ids(): ReadonlySet<string> {
    return new Set(this.claims.keys());
  }
}
export const botIdentities = new BotIdentities();
