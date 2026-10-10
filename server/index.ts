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
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MediaSession } from "./media.js";
import { validHost, validOrigin, validSession } from "./security.js";
import { ControlError } from "./errors.js";
import { Access } from "./access.js";
import { OpusOutput } from "./output.js";
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
const session = randomBytes(32).toString("hex");
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
const access = new Access();
let outputMix: Mix | undefined;
let casterMix: Mix | undefined;
let panicMuted = false;
const publicOrigin = "https://mic.pulse-studio.live";
const publicHost = "mic.pulse-studio.live";
const allowedUser = "1456945476933914626";
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
) =>
  !local(req.headers.host) &&
  access.controllerValid(cookie(req, "__Host-pulsemic"));
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
app.get("/api/access", (_, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    loginReady: Boolean(
      process.env.PULSEMIC_DISCORD_CLIENT_ID &&
        process.env.PULSEMIC_DISCORD_CLIENT_SECRET,
    ),
  });
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
    const user = (await profile.json()) as { id?: string };
    if (user.id !== allowedUser) return void res.redirect("/?login=denied");
    res.cookie("__Host-pulsemic", access.controller(), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 8 * 60 * 60_000,
    });
    res.redirect("/console");
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
  if (!local(req.headers.host) && !controllerAllowed(req))
    return void res.status(401).json({ error: "請登入指定的 Discord 帳號。" });
  res.json({
    session: local(req.headers.host) ? session : cookie(req, "__Host-pulsemic"),
  });
});
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (
    !(
      controllerAllowed(req) &&
      validSession(
        req.headers["x-pulsemic-session"] as string | undefined,
        cookie(req, "__Host-pulsemic"),
      )
    ) &&
    !(
      local(req.headers.host) &&
      validSession(
        req.headers["x-pulsemic-session"] as string | undefined,
        session,
      )
    )
  )
    return void res
      .status(403)
      .json({ error: "本機操作驗證失敗，請重新整理頁面。" });
  if (
    req.method !== "GET" &&
    !originAllowed(req.headers.origin, req.headers.host)
  )
    return void res.status(403).end();
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
  if (!local(req.headers.host))
    return void res.status(403).json({ error: "Bot 憑證只能在本機設定。" });
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
  if (!local(req.headers.host))
    return void res.status(403).json({ error: "Bot 憑證只能在本機設定。" });
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
    if (
      req.path === "/console" &&
      !local(req.headers.host) &&
      !controllerAllowed(req)
    )
      return void res.redirect("/");
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
    !(local(req.headers.host)
      ? validSession(token, session)
      : controllerAllowed(req) &&
        validSession(token, cookie(req, "__Host-pulsemic")))
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
          : context.public && !access.controllerValid(context.token)
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
server.listen(port, "127.0.0.1", () => {
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
