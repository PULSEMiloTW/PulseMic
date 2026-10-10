import type { LaneId, Mix } from "../shared/types";
export const defaultMix = (): Mix => ({
  master: 100,
  muted: false,
  solo: null,
  lanes: { A: { volume: 100, muted: false }, B: { volume: 100, muted: false } },
  members: {},
});
export function readMix(key = "pulsemic.mix.v1"): Mix {
  const fallback = defaultMix();
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!saved || typeof saved !== "object") return fallback;
    const volume = (value: unknown, maximum: number) =>
      typeof value === "number" && Number.isFinite(value)
        ? Math.max(0, Math.min(maximum, value))
        : 100;
    for (const id of ["A", "B"] as const)
      fallback.lanes[id] = {
        volume: volume(saved.lanes?.[id]?.volume, 200),
        muted: saved.lanes?.[id]?.muted === true,
      };
    fallback.master = volume(saved.master, 100);
    for (const [id, member] of Object.entries(saved.members ?? {}).slice(
      0,
      2000,
    )) {
      if (!member || typeof member !== "object") continue;
      const input = member as { volume?: unknown; muted?: unknown };
      fallback.members[id] = {
        volume: volume(input.volume, 200),
        muted: input.muted === true,
      };
    }
    // Emergency mute and solo are deliberate session actions, not startup surprises.
    return fallback;
  } catch {
    return fallback;
  }
}
export function laneGain(mix: Mix, lane: LaneId) {
  return mix.lanes[lane].muted || (mix.solo && mix.solo !== lane)
    ? 0
    : mix.lanes[lane].volume / 100;
}
