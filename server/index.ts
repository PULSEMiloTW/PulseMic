import express from "express";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import { DiscordDriver } from "./driver.js";
import { ControlService } from "./service.js";
import { WindowsSettingsStore, dpapi } from "./store.js";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MediaSession } from "./media.js";
import { validHost, validOrigin, validSession } from "./security.js";
import { ControlError } from "./errors.js";
import { Access } from "./access.js";
import { OpusOutput } from "./output.js";
import { Permissions, ownerId } from "./permissions.js";
import { Journal, StatusMonitor, botStatus } from "./observability.js";
import type { Mix } from "../shared/types.js";

const port = Number(process.env.PULSEMIC_PORT ?? 3210);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("PULSEMIC_PORT must be 1024–65535");
const dev = process.argv.includes("--dev");
const root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  dev ? ".." : "../../..",
);
const app = express();
app.disable("x-powered-by");
const server = createServer(app);
const service: ControlService = new ControlService(
  new WindowsSettingsStore(),
  () => new DiscordDriver(["A", "B"], "PulseMic"),
);
const caster: ControlService = new ControlService(
  new WindowsSettingsStore(undefined, "caster.secrets"),
  () => new DiscordDriver(["A"], "PulseMic-Caster"),
  undefined,
  ["A"],
);
try {
  const encrypted = await readFile(
    join(process.env.LOCALAPPDATA ?? ".", "PulseMic", "oauth.secrets"),
    "utf8",
  );
  const oauth = z
    .object({
      clientId: z.string().regex(/^\d{17,20}$/),
      clientSecret: z.string().min(16).max(256),
    })
    .parse(
      JSON.parse(
        Buffer.from(await dpapi(encrypted, true), "base64").toString("utf8"),
      ),
    );
  process.env.PULSEMIC_DISCORD_CLIENT_ID = oauth.clientId;
  process.env.PULSEMIC_DISCORD_CLIENT_SECRET = oauth.clientSecret;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT")
    console.warn(
      "Discord OAuth 設定無法讀取，請在本機重新設定。公網控制台維持拒絕登入。",
    );
}
export const access = new Access();
export const permissions = new Permissions();
await permissions.load();
const journal = new Journal();
const statusMonitor = new StatusMonitor();
await statusMonitor.load();
let outputMix: Mix | undefined;
let casterMix: Mix | undefined;
let panicMuted = false;
const publicOrigin = "https://mic.pulse-studio.live";
const publicHost = "mic.pulse-studio.live";
const identity = (
  req: express.Request | import("node:http").IncomingMessage,
) => {
  const profile = access.profile(cookie(req, "__Host-pulsemic"));
  const role = permissions.role(profile?.id);
  return profile && role ? { ...profile, role } : null;
};
const ownerAllowed = (req: express.Request) => identity(req)?.role === "owner";

const cookie = (
  req: express.Request | import("node:http").IncomingMessage,
  name: string,
) =>
  req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`))
    ?.slice(name.length + 1) ?? "";
const local = (host: string | undefined) => validHost(host, port);
const originAllowed = (origin: string | undefined, host: string | undefined) =>
  validOrigin(origin, host, port) ||
  (host === publicHost && origin === publicOrigin);
const controllerAllowed = (
  req: express.Request | import("node:http").IncomingMessage,
) => Boolean(identity(req));
const attempts = new Map<string, { count: number; expires: number }>();
function rateLimit(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const now = Date.now();
  for (const [key, item] of attempts)
    if (item.expires <= now) attempts.delete(key);
  // The header is trusted only on the hostname served by the dedicated Cloudflare tunnel.
  const key =
    req.headers.host === publicHost
      ? String(req.headers["cf-connecting-ip"] ?? "unknown")
      : "local";
  const item = attempts.get(key) ?? { count: 0, expires: now + 60_000 };
  if (attempts.size >= 10000 && !attempts.has(key))
    return void res.status(429).end();
  attempts.set(key, item);
  if (++item.count > 15)
    return void res.status(429).json({ error: "嘗試次數過多，請稍後再試。" });
  next();
}
app.use((req, res, next) => {
  if (!local(req.headers.host) && req.headers.host !== publicHost)
    return void res.status(403).end();
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  if (req.headers.host === publicHost)
    res.setHeader("Strict-Transport-Security", "max-age=86400");
  if (!dev)
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' https://cdn.discordapp.com https://media.discordapp.net; connect-src 'self' wss://mic.pulse-studio.live ws://localhost:* ws://127.0.0.1:*; media-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
    );
  next();
});
app.use(express.json({ limit: "8kb" }));
app.use((req, res, next) => {
  const began = performance.now();
  res.on("finish", () =>
    statusMonitor.observe(res.statusCode, performance.now() - began),
  );
  next();
});
const components = () => [
  { id: "service", name: "本機控制服務", status: "healthy" as const },
  {
    id: "login",
    name: "Discord 登入",
    status:
      process.env.PULSEMIC_DISCORD_CLIENT_ID &&
      process.env.PULSEMIC_DISCORD_CLIENT_SECRET
        ? ("healthy" as const)
        : ("unknown" as const),
  },
  botStatus("選手機器人 A", "bot-a", service.state, "A"),
  botStatus("選手機器人 B", "bot-b", service.state, "B"),
  botStatus("Caster Desk", "caster", caster.state, "A"),
];
app.get("/api/status", (_, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(statusMonitor.report(components()));
});
app.get("/api/identity", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const user = identity(req);
  if (!user)
    return void res
      .status(401)
      .json({ error: "請使用指定 Discord 帳號登入。" });
  res.json(user);
});

app.get("/api/access", (_, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    loginReady: Boolean(
      process.env.PULSEMIC_DISCORD_CLIENT_ID &&
        process.env.PULSEMIC_DISCORD_CLIENT_SECRET,
    ),
  });
});
const outputRequests = new Map<string, number>();
app.post("/auth/output-request", rateLimit, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!originAllowed(req.headers.origin, req.headers.host))
    return void res.status(403).end();
  const parsed = z
    .object({
      kind: z.enum(["players", "caster"]),
      requester: z.string().trim().min(1).max(80),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return void res.status(400).json({ error: "請填寫要求者名稱。" });
  const ip =
    req.headers.host === publicHost
      ? String(req.headers["cf-connecting-ip"] ?? "unknown")
      : (req.socket.remoteAddress ?? "local");
  const now = Date.now();
  for (const [key, expires] of outputRequests)
    if (expires <= now) outputRequests.delete(key);
  if (outputRequests.has(ip) || outputRequests.size >= 50)
    return void res.status(429).json({ error: "請稍候一分鐘再要求授權碼。" });
  outputRequests.set(ip, now + 60_000);
  try {
    const { code, expires } = access.issueCode(parsed.data.kind);
    const requestId = randomBytes(4).toString("hex").toUpperCase();
    // Explicit operator terminal delivery; never include Bot tokens or session secrets.
    const safe = (value: string) =>
      value.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").slice(0, 250);
    console.log(`\n[輸出授權要求 ${requestId}] ${new Date(now).toISOString()}
輸出：${parsed.data.kind === "caster" ? "主播台" : "選手 A/B"}
要求者（自行填寫，未驗證）：${safe(parsed.data.requester)}
連線 IP：${safe(ip)}
瀏覽器：${safe(String(req.headers["user-agent"] ?? "未知"))}
一次性授權碼：${code}
有效至：${new Date(expires).toISOString()}（僅可使用一次）\n`);
    res.status(202).json({ requestId });
  } catch {
    res.status(503).json({ error: "目前待用授權碼過多，請稍後重試。" });
  }
});
app.post("/auth/output", rateLimit, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!originAllowed(req.headers.origin, req.headers.host))
    return void res.status(403).end();
  const token = access.redeem(
    z.string().max(100).parse(req.body.code),
    z.enum(["players", "caster"]).default("players").parse(req.body.kind),
  );
  if (!token)
    return void res
      .status(403)
      .json({ error: "授權碼無效、已使用或已過期。請向導播取得新碼。" });
  res.json({ token });
});
app.get("/auth/discord", rateLimit, (req, res) => {
  if (local(req.headers.host))
    return void res.redirect(`${publicOrigin}/auth/discord`);
  if (
    req.headers.host !== publicHost ||
    !process.env.PULSEMIC_DISCORD_CLIENT_ID ||
    !process.env.PULSEMIC_DISCORD_CLIENT_SECRET
  )
    return void res.redirect("/?login=unavailable");
  const state = access.loginState();
  res.cookie("__Host-pulsemic-state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 5 * 60_000,
  });
  const url = new URL("https://discord.com/oauth2/authorize");
  url.search = new URLSearchParams({
    client_id: process.env.PULSEMIC_DISCORD_CLIENT_ID,
    response_type: "code",
    scope: "identify",
    redirect_uri: `${publicOrigin}/auth/discord/callback`,
    state,
  }).toString();
  res.redirect(url.href);
});
app.get("/auth/discord/callback", rateLimit, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const state = typeof req.query.state === "string" ? req.query.state : "";
  res.clearCookie("__Host-pulsemic-state", {
    secure: true,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  if (
    req.headers.host !== publicHost ||
    !state ||
    !validSession(state, cookie(req, "__Host-pulsemic-state")) ||
    !access.consumeState(state) ||
    typeof req.query.code !== "string"
  )
    return void res.redirect("/?login=failed");
  try {
    const response = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({
        client_id: process.env.PULSEMIC_DISCORD_CLIENT_ID!,
        client_secret: process.env.PULSEMIC_DISCORD_CLIENT_SECRET!,
        grant_type: "authorization_code",
        code: req.query.code,
        redirect_uri: `${publicOrigin}/auth/discord/callback`,
      }),
    });
    if (!response.ok) throw new Error();
    const token = (await response.json()) as { access_token?: string };
    if (!token.access_token) throw new Error();
    const profile = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!profile.ok) throw new Error();
    const user = z
      .object({
        id: z.string().regex(/^\d{17,20}$/),
        username: z.string().max(100),
        global_name: z.string().max(100).nullable().optional(),
        avatar: z
          .string()
          .regex(/^[a-zA-Z0-9_]+$/)
          .nullable()
          .optional(),
      })
      .parse(await profile.json());
    const role = permissions.role(user.id);
    if (!role) return void res.redirect("/?login=denied");
    const avatar = user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
      : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`;
    res.cookie(
      "__Host-pulsemic",
      access.controller({
        id: user.id,
        name: user.global_name || user.username,
        avatar,
      }),
      {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 8 * 60 * 60_000,
      },
    );
    journal.add(`Discord ${role === "owner" ? "擁有者" : "操作員"}登入成功`);
    res.redirect(role === "owner" ? "/admin" : "/console");
  } catch {
    res.redirect("/?login=failed");
  }
});
app.post("/auth/logout", (req, res) => {
  if (!originAllowed(req.headers.origin, req.headers.host))
    return void res.status(403).end();
  access.logout(cookie(req, "__Host-pulsemic"));
  res.clearCookie("__Host-pulsemic", {
    secure: true,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  res.json({ ok: true });
});
app.get("/api/health", (_, res) =>
  res.json({ app: "PulseMic", version: "0.1.0" }),
);
app.get("/api/session", (req, res) => {
  if (req.headers["sec-fetch-site"] === "cross-site")
    return void res.status(403).end();
  res.setHeader("Cache-Control", "no-store");
  if (!controllerAllowed(req))
    return void res.status(401).json({ error: "請登入指定的 Discord 帳號。" });
  res.json({
    session: cookie(req, "__Host-pulsemic"),
  });
});
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (
    !controllerAllowed(req) ||
    !validSession(
      req.headers["x-pulsemic-session"] as string | undefined,
      cookie(req, "__Host-pulsemic"),
    )
  )
    return void res.status(403).json({ error: "操作授權失效，請重新登入。" });
  if (
    req.method !== "GET" &&
    !originAllowed(req.headers.origin, req.headers.host)
  )
    return void res.status(403).end();
  next();
});
app.get("/api/logs", (_, res) => res.json(journal.list()));
let savingOauth = false;
app.get("/api/admin/oauth", (req, res) => {
  if (!ownerAllowed(req)) return void res.status(403).end();
  res.json({
    clientId: process.env.PULSEMIC_DISCORD_CLIENT_ID || "",
    secretSaved: Boolean(process.env.PULSEMIC_DISCORD_CLIENT_SECRET),
  });
});
app.post("/api/admin/oauth", async (req, res) => {
  if (!ownerAllowed(req)) return void res.status(403).end();
  if (savingOauth)
    return void res.status(409).json({ error: "設定保存中，請稍候。" });
  const input = z
    .object({
      clientId: z.string().regex(/^\d{17,20}$/),
      clientSecret: z.string().trim().max(256),
    })
    .parse(req.body);
  const clientSecret =
    input.clientSecret || process.env.PULSEMIC_DISCORD_CLIENT_SECRET;
  if (!clientSecret || clientSecret.length < 16)
    return void res.status(400).json({ error: "請輸入有效的 Client Secret。" });
  savingOauth = true;
  try {
    const directory = join(process.env.LOCALAPPDATA ?? ".", "PulseMic");
    const value = await dpapi(
      Buffer.from(
        JSON.stringify({ clientId: input.clientId, clientSecret }),
      ).toString("base64"),
    );
    await mkdir(directory, { recursive: true });
    const temporary = join(
      directory,
      `oauth.${randomBytes(8).toString("hex")}.tmp`,
    );
    await writeFile(temporary, value, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, join(directory, "oauth.secrets"));
    process.env.PULSEMIC_DISCORD_CLIENT_ID = input.clientId;
    process.env.PULSEMIC_DISCORD_CLIENT_SECRET = clientSecret;
    journal.add("擁有者更新 Discord OAuth 設定");
    res.json({ ok: true });
  } finally {
    savingOauth = false;
  }
});
app.get("/api/admin/operators", (req, res) => {
  if (!ownerAllowed(req)) return void res.status(403).end();
  res.json({ ownerId, users: permissions.list() });
});
app.post("/api/admin/operators", async (req, res) => {
  if (!ownerAllowed(req)) return void res.status(403).end();
  await permissions.save(req.body.users);
  for (const socket of wss.clients) {
    const token = controlTokens.get(socket);
    if (token && !permissions.role(access.profile(token)?.id))
      socket.close(4003, "操作權限已移除");
  }
  journal.add("擁有者更新控制台操作員名單");
  res.json({ ok: true });
});
app.use("/api", (req, res, next) => {
  if (
    [
      "/settings",
      "/validate",
      "/mode",
      "/caster/settings",
      "/caster/validate",
      "/caster/mode",
    ].includes(req.path) &&
    !ownerAllowed(req)
  )
    return void res.status(403).json({ error: "只有擁有者能修改連線設定。" });
  const actions: Record<string, string> = {
    "/panic": "更新全部靜音",
    "/settings": "保存選手 Bot 設定",
    "/caster/settings": "保存主播台 Bot 設定",
    "/validate": "驗證選手連線",
    "/caster/validate": "驗證主播台連線",
    "/mode": "切換選手模式",
    "/caster/mode": "切換主播台模式",
    "/caster/bot": "派遣主播台 Bot",
    "/bots/A": "派遣 Bot A",
    "/bots/B": "派遣 Bot B",
  };
  const action = actions[req.path];
  if (req.method === "POST" && action)
    res.on("finish", () =>
      journal.add(
        `${action} · ${res.statusCode < 400 ? "完成" : "失敗"}`,
        res.statusCode < 400 ? "info" : "warning",
      ),
    );
  next();
});
app.post("/api/output-code", (req, res) =>
  res.json(
    access.issueCode(
      z.enum(["players", "caster"]).default("players").parse(req.body.kind),
    ),
  ),
);
app.post("/api/panic", (req, res) => {
  panicMuted = z.boolean().parse(req.body.muted);
  service.emit("panic", panicMuted);
  caster.emit("panic", panicMuted);
  res.json({ ok: true });
});
const memberMix = z.object({
  volume: z.number().min(0).max(200),
  muted: z.boolean(),
});
const mixSchema = z.object({
  master: z.number().min(0).max(100),
  muted: z.boolean(),
  solo: z.enum(["A", "B"]).nullable(),
  lanes: z.object({ A: memberMix, B: memberMix }),
  members: z
    .record(z.string().max(100), memberMix)
    .refine((value) => Object.keys(value).length <= 2000),
});
app.post("/api/mix", (req, res) => {
  outputMix = mixSchema.parse(req.body);
  service.emit("mix", outputMix);
  res.json({ ok: true });
});
app.post("/api/caster/mix", (req, res) => {
  casterMix = mixSchema.refine((mix) => mix.solo !== "B").parse(req.body);
  caster.emit("mix", casterMix);
  res.json({ ok: true });
});
app.get("/api/state", (_, res) => res.json(service.state));
const commandSchema = z.object({
  action: z.enum(["open", "close", "switch"]),
  source: z.enum(["A", "B"]).optional(),
});
app.post("/api/bots/:id", async (req, res) => {
  const id = z.enum(["A", "B"]).parse(req.params.id);
  const input = commandSchema.parse(req.body);
  await service.command(id, input.action, input.source);
  res.json({ ok: true });
});
app.post("/api/settings", async (req, res) => {
  if (!ownerAllowed(req))
    return void res.status(403).json({ error: "只有擁有者能設定 Bot 憑證。" });
  await service.validate(req.body);
  res.json({ ok: true });
});
app.post("/api/validate", async (_, res) => {
  await service.validate();
  res.json({ ok: true });
});
app.post("/api/mode", async (req, res) => {
  await service.mode(z.enum(["live", "demo"]).parse(req.body.mode));
  res.json({ ok: true });
});
app.get("/api/caster/state", (_, res) => res.json(caster.state));
app.post("/api/caster/bot", async (req, res) => {
  await caster.command("A", z.enum(["open", "close"]).parse(req.body.action));
  res.json({ ok: true });
});
app.post("/api/caster/settings", async (req, res) => {
  if (!ownerAllowed(req))
    return void res.status(403).json({ error: "只有擁有者能設定 Bot 憑證。" });
  const input = z
    .object({
      guildId: z.string().regex(/^\d{17,20}$/),
      channelId: z.string().regex(/^\d{17,20}$/),
      token: z.string().trim().max(256),
    })
    .parse(req.body);
  await caster.validate({
    guildId: input.guildId,
    channels: { A: input.channelId, B: input.channelId },
    tokens: { A: input.token, B: "" },
  });
  res.json({ ok: true });
});
app.post("/api/caster/validate", async (_, res) => {
  await caster.validate();
  res.json({ ok: true });
});
app.post("/api/caster/mode", async (req, res) => {
  await caster.mode(z.enum(["live", "demo"]).parse(req.body.mode));
  res.json({ ok: true });
});
app.use("/api", (_, res) =>
  res.status(404).json({ error: "找不到本機操作。" }),
);
app.use((req, res, next) => {
  if (["/console", "/admin"].includes(req.path) && !controllerAllowed(req))
    return void res.redirect("/");
  if (req.path === "/admin" && !ownerAllowed(req))
    return void res.status(403).send("只有擁有者能進入專屬後台。");
  next();
});
if (dev) {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    root,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(resolve(root, "dist/client")));
  app.get("/{*path}", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (["/console", "/admin"].includes(req.path) && !controllerAllowed(req))
      return void res.redirect("/");
    if (req.path === "/admin" && !ownerAllowed(req))
      return void res.status(403).send("只有擁有者能進入專屬後台。");
    // The fixed index can live under the ignored .local preview directory.
    res.sendFile(resolve(root, "dist/client/index.html"), {
      dotfiles: "allow",
    });
  });
}
app.use(
  (
    error: unknown,
    _: express.Request,
    res: express.Response,
    __: express.NextFunction,
  ) => {
    const message =
      error instanceof z.ZodError
        ? "設定格式錯誤，請確認所有 Discord ID 與來源欄位。"
        : error instanceof ControlError
          ? error.message
          : "本機操作失敗，請重新整理並重試。";
    res.status(400).json({ error: message });
  },
);
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
let controller: WebSocket | undefined;
const controlTokens = new Map<WebSocket, string>();
server.on("upgrade", (req, socket, head) => {
  const token = req.headers["sec-websocket-protocol"] ?? "";
  if (
    (req.url === "/output-stream" || req.url === "/caster-output-stream") &&
    originAllowed(req.headers.origin, req.headers.host) &&
    access.claimOutput(
      token,
      req.url === "/caster-output-stream" ? "caster" : "players",
    )
  ) {
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, {
        output: true,
        caster: req.url === "/caster-output-stream",
        token,
        public: !local(req.headers.host),
      }),
    );
    return;
  }
  if (
    req.url !== "/control" ||
    !originAllowed(req.headers.origin, req.headers.host) ||
    !(
      controllerAllowed(req) &&
      validSession(token, cookie(req, "__Host-pulsemic"))
    )
  ) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) =>
    wss.emit("connection", ws, {
      output: false,
      token,
      public: !local(req.headers.host),
    }),
  );
});
wss.on(
  "connection",
  (
    socket: WebSocket,
    context: {
      output: boolean;
      caster?: boolean;
      token: string;
      public?: boolean;
    },
  ) => {
    if (!context.output) {
      controller?.close(4001, "另一個控制台已接手");
      controller = socket;
      controlTokens.set(socket, context.token);
    }
    const source = context.caster ? caster : service;
    const media =
      context.output && context.public
        ? new OpusOutput(socket, source)
        : new MediaSession(socket, source);
    const state = () => media.send({ type: "state", state: source.state });
    const casterState = () =>
      media.send({ type: "caster-state", state: caster.state });
    const casterMixEvent = (value: Mix) =>
      media.send({ type: "caster-mix", mix: value });
    state();
    const panic = (muted: boolean) => media.send({ type: "panic", muted });
    panic(panicMuted);
    source.on("panic", panic);
    const mix = (value: Mix) => media.send({ type: "mix", mix: value });
    const currentMix = context.caster ? casterMix : outputMix;
    if (currentMix) mix(currentMix);
    source.on("mix", mix);
    source.on("state", state);
    if (!context.output) {
      casterState();
      if (casterMix) casterMixEvent(casterMix);
      caster.on("state", casterState);
      caster.on("mix", casterMixEvent);
    }
    let alive = true;
    socket.on("pong", () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (
        context.output
          ? !access.outputValid(context.token)
          : !permissions.role(access.profile(context.token)?.id)
      )
        return socket.close(4003, "授權已失效");
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, 15_000);
    socket.on("message", (raw) => {
      void (async () => {
        if (
          !context.output &&
          !permissions.role(access.profile(context.token)?.id)
        ) {
          socket.close(4003, "操作授權失效");
          return;
        }
        const message = z
          .discriminatedUnion("type", [
            z.object({ type: z.literal("monitor"), enabled: z.boolean() }),
            z.object({
              type: z.literal("answer"),
              sdp: z.string().max(250000),
              generation: z.number().int(),
            }),
          ])
          .parse(JSON.parse(raw.toString()));
        if (
          context.public &&
          !context.output &&
          message.type === "monitor" &&
          message.enabled
        )
          throw new Error("Use output page");
        if (message.type === "monitor") await media.monitor(message.enabled);
        else await media.answer(message.sdp, message.generation);
      })().catch(() =>
        media.send({
          type: "error",
          message: "音訊操作失敗，請停止並重新開始監聽。",
        }),
      );
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      clearInterval(heartbeat);
      controlTokens.delete(socket);
      media.close();
      if (context.output) access.revokeOutput(context.token);
      source.off("panic", panic);
      source.off("state", state);
      source.off("mix", mix);
      caster.off("state", casterState);
      caster.off("mix", casterMixEvent);
      if (controller === socket) controller = undefined;
    });
  },
);
server.on("error", () => {
  console.error("PulseMic 無法啟動：請檢查本機連接埠是否已被使用。");
  process.exitCode = 1;
  service.close();
  caster.close();
});
journal.add("PulseMic 服務啟動");
for (const [label, source, lanes] of [
  ["選手", service, ["A", "B"]],
  ["主播台", caster, ["A"]],
] as const) {
  const previous = new Map<string, string>();
  source.on("state", () => {
    for (const id of lanes) {
      const lane = source.state.lanes[id];
      const key = `${source.state.mode}:${lane.botOnline}:${lane.status}:${lane.channelId}`;
      if (previous.get(id) !== key) {
        previous.set(id, key);
        journal.add(
          `${label} ${id} · ${source.state.mode === "demo" ? "示範" : "真實"} · ${{ unknown: "待確認", idle: "待命", connecting: "切換中", listening: "正在收聽", disconnecting: "退出中", reconnecting: "恢復連線中", error: "連線失敗" }[lane.status]} · Discord ${lane.botOnline ? "在線" : "離線"}`,
          lane.status === "error" ? "warning" : "info",
        );
      }
    }
  });
}
const sampleStatus = () =>
  void statusMonitor
    .sample(components())
    .catch(() => journal.add("狀態歷史保存失敗", "warning"));
const statusTimer = setInterval(sampleStatus, 60_000);
statusTimer.unref();
server.listen(port, "127.0.0.1", () => {
  sampleStatus();
  console.log(`PulseMic 控制台 http://localhost:${port}（只供本機）`);
  void service.start();
  void caster.start();
});
function shutdown() {
  service.close();
  caster.close();
  for (const client of wss.clients) client.close();
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
