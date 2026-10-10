import {
  Client,
  Events,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits,
  type VoiceChannel,
} from "discord.js";
import {
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus,
  EndBehaviorType,
  type VoiceConnection,
} from "@discordjs/voice";
import type { LaneId, Member, SourceId } from "../shared/types.js";
import type { SavedSettings } from "./store.js";
import { ControlError } from "./errors.js";
import { botIdentities } from "./bot-identities.js";

export interface Metadata {
  guildName: string;
  channels: Record<SourceId, { id: string; name: string }>;
}
export interface DriverEvents {
  change(): void;
  disconnected(id: LaneId): void;
  online(id: LaneId, online: boolean): void;
  speaking(id: LaneId, userId: string, speaking: boolean): void;
  packet(id: LaneId, userId: string, packet: Buffer): void;
  fault(id: LaneId, reason: string): void;
}
export interface VoiceDriver {
  metadata: Metadata;
  identities: Record<LaneId, { id: string; name: string }>;
  initialize(settings: SavedSettings): Promise<void>;
  bind(events: DriverEvents): void;
  join(id: LaneId, source: SourceId): Promise<void>;
  leave(id: LaneId): void;
  members(id: LaneId): Member[];
  close(): void;
}
export class DiscordDriver implements VoiceDriver {
  metadata: Metadata = {
    guildName: "",
    channels: { A: { id: "", name: "" }, B: { id: "", name: "" } },
  };
  identities = { A: { id: "", name: "" }, B: { id: "", name: "" } };
  private clients = {
    A: new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    }),
    B: new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    }),
  };
  constructor(
    private activeIds: readonly LaneId[] = ["A", "B"],
    private group = "PulseMic",
  ) {}
  private connections = new Map<LaneId, VoiceConnection>();
  private channels = new Map<LaneId, VoiceChannel>();
  private events?: DriverEvents;
  private config!: SavedSettings;
  private closed = false;
  async initialize(settings: SavedSettings) {
    this.config = settings;
    try {
      await Promise.all(
        this.activeIds.map(async (id) => {
          const client = this.clients[id];
          // Register before login: ready can happen before login's promise resolves.
          const ready = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () =>
                reject(
                  new ControlError(
                    `機器人 ${id} 登入逾時，請檢查網路與 Token。`,
                  ),
                ),
              20_000,
            );
            timer.unref();
            client.once(Events.ClientReady, () => {
              clearTimeout(timer);
              resolve();
            });
          });
          client.on(Events.Error, () =>
            this.events?.fault(id, "Discord 連線發生錯誤，請檢查網路並重試。"),
          );
          await Promise.all([
            client.login(settings.tokens[id]).catch(() => {
              throw new ControlError(`機器人 ${id} 登入失敗，請確認 Token。`);
            }),
            ready,
          ]);
          if (this.closed) throw new ControlError("Bot 驗證已取消，請重試。");
          this.identities[id] = {
            id: client.user!.id,
            name: client.user!.username,
          };
          botIdentities.claim(client.user!.id, this.group, this);
          const guild = await client.guilds
            .fetch(settings.guildId)
            .catch(() => {
              throw new ControlError(
                `機器人 ${id} 無法存取伺服器，請確認 ID 並邀請 Bot。`,
              );
            });
          const me = await guild.members.fetchMe();
          const resolved = await Promise.all(
            (["A", "B"] as const).map(async (source) => {
              const channel = await guild.channels.fetch(
                settings.channels[source],
              );
              if (!channel || channel.type !== ChannelType.GuildVoice)
                throw new ControlError(
                  `Channel ${source} 必須是一般語音頻道。`,
                );
              if (
                !channel
                  .permissionsFor(me)
                  ?.has([
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.Connect,
                  ])
              )
                throw new ControlError(
                  `機器人 ${id} 缺少 Channel ${source} 的查看或連接權限。`,
                );
              return [source, { id: channel.id, name: channel.name }] as const;
            }),
          );
          if (id === "A")
            this.metadata = {
              guildName: guild.name,
              channels: Object.fromEntries(resolved) as Metadata["channels"],
            };
          client.on(Events.ChannelUpdate, () => this.refreshMetadata());
          client.on(Events.ChannelDelete, () => this.refreshMetadata());
          client.on(Events.GuildUpdate, () => this.refreshMetadata());
          client.on(Events.VoiceStateUpdate, (_, state) => {
            if (
              state.id === client.user?.id &&
              this.connections.has(id) &&
              state.channelId !== this.channels.get(id)?.id
            )
              this.events?.disconnected(id);
            this.syncSubscriptions(id);
            this.events?.change();
          });
          client.on(Events.GuildMemberUpdate, () => this.events?.change());
          client.on(Events.UserUpdate, () => this.events?.change());
          client.on(Events.ShardDisconnect, () => {
            this.events?.online(id, false);
            if (this.connections.has(id)) this.events?.disconnected(id);
          });
          client.on(Events.ShardResume, () => this.events?.online(id, true));
          client.on(Events.ShardReady, () => this.events?.online(id, true));
        }),
      );
      if (
        this.activeIds.length > 1 &&
        this.identities.A.id === this.identities.B.id
      )
        throw new ControlError("請使用兩個不同 Discord Bot 身分的 Token。");
    } catch (error) {
      this.close();
      throw error;
    }
  }
  bind(events: DriverEvents) {
    this.events = events;
  }
  private refreshMetadata() {
    const guild = this.clients.A.guilds.cache.get(this.config.guildId);
    if (!guild) return;
    this.metadata.guildName = guild.name;
    for (const source of ["A", "B"] as const) {
      const channel = guild.channels.cache.get(this.config.channels[source]);
      this.metadata.channels[source] = {
        id: this.config.channels[source],
        name: channel?.name ?? "",
      };
    }
    for (const id of this.activeIds) {
      const channel = this.channels.get(id);
      if (channel && !guild.channels.cache.has(channel.id))
        this.events?.fault(id, "語音頻道已刪除，請重新設定 Channel ID。");
    }
    this.events?.change();
  }
  async join(id: LaneId, source: SourceId) {
    this.leave(id);
    const guild = await this.clients[id].guilds.fetch(this.config.guildId);
    const channel = await guild.channels.fetch(this.config.channels[source]);
    const me = await guild.members.fetchMe();
    if (
      !channel ||
      channel.type !== ChannelType.GuildVoice ||
      !channel
        .permissionsFor(me)
        ?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect])
    )
      throw new ControlError(
        "目標頻道不存在或 Bot 缺少查看／連接權限，請重新驗證設定。",
      );
    this.channels.set(id, channel);
    const connection = joinVoiceChannel({
      guildId: guild.id,
      channelId: channel.id,
      adapterCreator: guild.voiceAdapterCreator,
      group: `${this.group}-${id}`,
      selfDeaf: false,
      selfMute: true,
    });
    this.connections.set(id, connection);
    connection.on("error", () =>
      this.events?.fault(id, "Discord 語音或 DAVE 收音發生錯誤，請重試連線。"),
    );
    connection.on(VoiceConnectionStatus.Disconnected, () =>
      this.events?.disconnected(id),
    );
    connection.receiver.speaking.on("start", (userId) =>
      this.events?.speaking(id, userId, true),
    );
    connection.receiver.speaking.on("end", (userId) =>
      this.events?.speaking(id, userId, false),
    );
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    if (
      this.connections.get(id) !== connection ||
      channel.id !== guild.members.me?.voice.channelId
    )
      throw new ControlError("Bot 未確認加入目標頻道，請重試。");
    this.syncSubscriptions(id);
  }
  members(id: LaneId): Member[] {
    const channel = this.channels.get(id);
    const botIds = new Set([
      ...botIdentities.ids(),
      this.identities.A.id,
      this.identities.B.id,
    ]);
    return channel
      ? [...channel.members.values()]
          .filter((member) => !botIds.has(member.id))
          .map((member) => ({
            id: member.id,
            name: member.displayName,
            avatar: member.displayAvatarURL({ size: 64, extension: "png" }),
            speaking:
              this.connections
                .get(id)
                ?.receiver.speaking.users.has(member.id) ?? false,
          }))
      : [];
  }
  private syncSubscriptions(id: LaneId) {
    const connection = this.connections.get(id);
    if (!connection || connection.state.status !== VoiceConnectionStatus.Ready)
      return;
    const members = this.members(id);
    const allowed = new Set(members.map((member) => member.id));
    for (const [userId, stream] of connection.receiver.subscriptions)
      if (!allowed.has(userId)) stream.destroy();
    for (const member of members) {
      if (connection.receiver.subscriptions.has(member.id)) continue;
      const stream = connection.receiver.subscribe(member.id, {
        end: { behavior: EndBehaviorType.Manual },
      });
      stream.on("data", (packet: Buffer) =>
        this.events?.packet(id, member.id, packet),
      );
      stream.on("error", () =>
        this.events?.fault(id, "成員語音解密失敗，請重試連線。"),
      );
    }
  }
  leave(id: LaneId) {
    const connection = this.connections.get(id);
    this.connections.delete(id);
    this.channels.delete(id);
    if (connection) {
      connection.removeAllListeners();
      for (const stream of connection.receiver.subscriptions.values())
        stream.destroy();
      if (connection.state.status !== VoiceConnectionStatus.Destroyed)
        connection.destroy();
    }
  }
  close() {
    this.closed = true;
    botIdentities.release(this);
    for (const id of this.activeIds) {
      this.leave(id);
      this.clients[id].destroy();
    }
  }
}
