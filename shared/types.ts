export const ids = ["A", "B"] as const;
export type LaneId = (typeof ids)[number];
export type SourceId = LaneId;
export interface Member {
  id: string;
  name: string;
  avatar: string;
  speaking: boolean;
}
export interface Source {
  id: SourceId;
  channelId: string;
  name: string;
}
export type ConnectionStatus =
  | "unknown"
  | "idle"
  | "connecting"
  | "listening"
  | "disconnecting"
  | "reconnecting"
  | "error";
export interface Lane {
  id: LaneId;
  botName: string;
  botOnline: boolean;
  selectedSource: SourceId;
  status: ConnectionStatus;
  channelId: string | null;
  channelName: string | null;
  targetName: string | null;
  members: Member[];
  error: string | null;
  playbackLane: LaneId | null;
}
export interface PublicSettings {
  guildId: string;
  channels: Record<SourceId, string>;
  tokensSaved: Record<LaneId, boolean>;
  selected: Record<LaneId, SourceId>;
}
export interface Snapshot {
  mode: "live" | "demo";
  guildName: string | null;
  validated: boolean;
  sources: Record<SourceId, Source>;
  lanes: Record<LaneId, Lane>;
  settings: PublicSettings;
  notice: string;
  revision: number;
}
export interface SettingsInput {
  guildId: string;
  channels: Record<SourceId, string>;
  tokens: Record<LaneId, string>;
}
export interface TrackInfo {
  mid: string;
  lane: LaneId;
  userId: string;
}
export type ServerMessage =
  | { type: "mix"; mix: Mix }
  | {
      type: "opus";
      lane: LaneId;
      userId: string;
      payload: string;
      generation: number;
    }
  | { type: "state"; state: Snapshot }
  | { type: "offer"; sdp: string; tracks: TrackInfo[]; generation: number }
  | { type: "audio-reset" }
  | { type: "error"; message: string };
export interface MemberMix {
  volume: number;
  muted: boolean;
}
export interface Mix {
  master: number;
  muted: boolean;
  solo: LaneId | null;
  lanes: Record<LaneId, MemberMix>;
  members: Record<string, MemberMix>;
}
export function playbackOwners(
  lanes: Record<LaneId, Lane>,
): Record<LaneId, LaneId | null> {
  const owners = new Map<string, LaneId>();
  return Object.fromEntries(
    ids.map((id) => {
      const lane = lanes[id];
      if (lane.status !== "listening" || !lane.channelId) return [id, null];
      const owner = owners.get(lane.channelId) ?? id;
      owners.set(lane.channelId, owner);
      return [id, owner];
    }),
  ) as Record<LaneId, LaneId | null>;
}
export function laneTitle(lane: Lane): string {
  if (lane.status === "unknown") return "頻道狀態待確認";
  return lane.status === "listening"
    ? (lane.channelName ?? "頻道名稱暫不可用")
    : lane.status === "connecting" || lane.status === "reconnecting"
      ? (lane.targetName ?? "等待確認頻道")
      : "尚未收聽頻道";
}
export function laneStatus(lane: Lane): string {
  switch (lane.status) {
    case "unknown":
      return "控制連線中斷";
    case "listening":
      return "正在收聽";
    case "connecting":
      return `正在切換至 ${lane.targetName ?? "目標頻道"}…`;
    case "reconnecting":
      return `正在恢復至 ${lane.targetName ?? "目標頻道"}…`;
    case "disconnecting":
      return "正在退出頻道…";
    case "error":
      return "連線失敗";
    default:
      return "已退出語音";
  }
}
