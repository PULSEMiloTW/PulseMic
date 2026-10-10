import express from "express";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import { ControlService } from "./service.js";
import { WindowsSettingsStore } from "./store.js";
import { MediaSession } from "./media.js";
import { validHost, validOrigin, validSession } from "./security.js";
import { ControlError } from "./errors.js";

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
const service = new ControlService(new WindowsSettingsStore());
app.use((req, res, next) => {
  if (!validHost(req.headers.host, port)) return void res.status(403).end();
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  if (!dev)
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' https://cdn.discordapp.com https://media.discordapp.net; connect-src 'self' ws://localhost:* ws://127.0.0.1:*; media-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
    );
  next();
});
app.get("/api/health", (_, res) =>
  res.json({ app: "PulseMic", version: "0.1.0" }),
);
app.get("/api/session", (req, res) => {
  if (req.headers["sec-fetch-site"] === "cross-site")
    return void res.status(403).end();
  res.setHeader("Cache-Control", "no-store");
  res.json({ session });
});
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (
    !validSession(
      req.headers["x-pulsemic-session"] as string | undefined,
      session,
    )
  )
    return void res
      .status(403)
      .json({ error: "本機操作驗證失敗，請重新整理頁面。" });
  if (
    req.method !== "GET" &&
    !validOrigin(req.headers.origin, req.headers.host, port)
  )
    return void res.status(403).end();
  next();
});
app.use(express.json({ limit: "8kb" }));
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
  app.get("/{*path}", (_, res) =>
    res.sendFile(resolve(root, "dist/client/index.html")),
  );
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
  if (
    req.url !== "/control" ||
    !validOrigin(req.headers.origin, req.headers.host, port) ||
    !validSession(req.headers["sec-websocket-protocol"], session)
  ) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
});
wss.on("connection", (socket) => {
  controller?.close(4001, "另一個控制台已接手");
  controller = socket;
  const media = new MediaSession(socket, service);
  const state = () => media.send({ type: "state", state: service.state });
  state();
  service.on("state", state);
  let alive = true;
  socket.on("pong", () => {
    alive = true;
  });
  const heartbeat = setInterval(() => {
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
    service.off("state", state);
    if (controller === socket) controller = undefined;
  });
});
server.on("error", () => {
  console.error("PulseMic 無法啟動：請檢查本機連接埠是否已被使用。");
  process.exitCode = 1;
  service.close();
});
server.listen(port, "127.0.0.1", () => {
  console.log(`PulseMic 控制台 http://localhost:${port}（只供本機）`);
  void service.start();
});
function shutdown() {
  service.close();
  controller?.close();
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
