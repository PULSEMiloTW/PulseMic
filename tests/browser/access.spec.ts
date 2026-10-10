import { test, expect, type APIRequestContext } from "@playwright/test";
import type { Snapshot } from "../../shared/types";
import { mkdir } from "node:fs/promises";
import { WebSocket } from "ws";

async function issue(request: APIRequestContext) {
  const session = (await (await request.get("/api/session")).json()).session;
  const response = await request.post("/api/output-code", {
    headers: { "X-PulseMic-Session": session, Origin: "http://localhost:3211" },
    data: {},
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).code as string;
}
test("public APIs deny anonymous access even with the local session secret", async ({
  request,
}) => {
  const secret = (await (await request.get("/api/session")).json()).session;
  const headers = {
    Host: "mic.pulse-studio.live",
    "X-PulseMic-Session": secret,
    Origin: "https://mic.pulse-studio.live",
  };
  expect((await request.get("/api/session", { headers })).status()).toBe(401);
  expect((await request.get("/api/state", { headers })).status()).toBe(403);
  expect(
    (await request.post("/api/output-code", { headers, data: {} })).status(),
  ).toBe(403);
  const console = await request.get("/console", { headers, maxRedirects: 0 });
  expect(console.status()).toBe(302);
  expect(console.headers().location).toBe("/");
});
test("separate output page consumes code once and refresh requires a new code", async ({
  page,
  request,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/console");
  await expect(page.getByText("本機服務已連線", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "開始監聽", exact: true }),
  ).toBeHidden();
  const output = await context.newPage();
  await output.goto("/output");
  await mkdir(".local/qa", { recursive: true });
  await output.screenshot({ path: ".local/qa/output-login-desktop.png" });
  await output.getByLabel("一次性授權碼").fill(await issue(request));
  await output.getByRole("button", { name: "驗證並進入" }).click();
  await expect(
    output.getByText("本機服務已連線", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("本機服務已連線", { exact: true })).toBeVisible();
  await expect(
    output.getByRole("button", { name: "產生一次性授權碼" }),
  ).toHaveCount(0);
  await expect(output.getByRole("button", { name: "開啟語音" })).toBeHidden();
  await output.getByRole("button", { name: "開始監聽", exact: true }).click();
  await expect(
    output.getByRole("button", { name: "停止監聽", exact: true }),
  ).toBeVisible();
  await output.reload();
  await expect(output.getByLabel("一次性授權碼")).toBeVisible();
  await expect(output.getByLabel("一次性授權碼")).toHaveValue("");
  await output.setViewportSize({ width: 390, height: 844 });
  await output.screenshot({ path: ".local/qa/output-login-narrow.png" });
  expect(
    await output.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});
test("remote Opus transport decodes two independent member streams in Edge", async ({
  page,
  request,
}) => {
  const session = (await (await request.get("/api/session")).json()).session;
  const state: Snapshot = await (
    await request.get("/api/state", {
      headers: { "X-PulseMic-Session": session },
    })
  ).json();
  state.mode = "live";
  state.lanes.A = {
    ...state.lanes.A,
    status: "listening",
    channelId: "123456789012345678",
    channelName: "封包測試頻道",
    playbackLane: "A",
    members: [
      {
        id: "111111111111111111",
        name: "測試成員一",
        avatar: "",
        speaking: false,
      },
      {
        id: "222222222222222222",
        name: "測試成員二",
        avatar: "",
        speaking: false,
      },
    ],
  };
  state.lanes.B = {
    ...state.lanes.B,
    status: "idle",
    members: [],
    playbackLane: null,
  };
  await page.addInitScript(() => {
    const Original = window.AudioDecoder;
    const counters = { decoders: 0, frames: 0 };
    Object.assign(window, { codecCounters: counters });
    window.AudioDecoder = class extends Original {
      constructor(init: AudioDecoderInit) {
        counters.decoders++;
        super({
          ...init,
          output: (data) => {
            counters.frames++;
            init.output(data);
          },
        });
      }
    };
  });
  await page.routeWebSocket("**/output-stream", (socket) => {
    socket.send(JSON.stringify({ type: "state", state }));
    let timer: ReturnType<typeof setInterval>;
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type !== "monitor") return;
      clearInterval(timer);
      socket.send(JSON.stringify({ type: "audio-reset" }));
      if (message.enabled)
        timer = setInterval(() => {
          for (const userId of state.lanes.A.members.map((member) => member.id))
            socket.send(
              JSON.stringify({
                type: "opus",
                lane: "A",
                userId,
                payload: "+P/+",
                generation: 1,
              }),
            );
        }, 20);
    });
    socket.onClose(() => clearInterval(timer));
  });
  await page.goto("/output");
  await page.getByLabel("一次性授權碼").fill(await issue(request));
  await page.getByRole("button", { name: "驗證並進入" }).click();
  await expect(
    page.getByRole("heading", { name: "封包測試頻道" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "開始監聽", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { codecCounters: { frames: number } })
            .codecCounters.frames,
      ),
    )
    .toBeGreaterThan(5);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { codecCounters: { decoders: number } })
          .codecCounters.decoders,
    ),
  ).toBe(2);
  await page.getByRole("button", { name: "停止監聽", exact: true }).click();
});
test("output code reuse and cross-origin redemption are rejected", async ({
  request,
}) => {
  const code = await issue(request);
  const data = { code };
  const headers = { Origin: "http://localhost:3211" };
  expect(
    (
      await request.post("/auth/output", {
        headers: { Origin: "https://other.example" },
        data,
      })
    ).status(),
  ).toBe(403);
  expect((await request.post("/auth/output", { headers, data })).status()).toBe(
    200,
  );
  expect((await request.post("/auth/output", { headers, data })).status()).toBe(
    403,
  );
});

test("public output grant permits only output socket, never controller APIs", async ({
  request,
}) => {
  const code = await issue(request);
  const token = (
    await (
      await request.post("/auth/output", {
        headers: {
          Host: "mic.pulse-studio.live",
          Origin: "https://mic.pulse-studio.live",
        },
        data: { code },
      })
    ).json()
  ).token;
  expect(
    (
      await request.post("/api/bots/A", {
        headers: {
          Host: "mic.pulse-studio.live",
          Origin: "https://mic.pulse-studio.live",
          "X-PulseMic-Session": token,
        },
        data: { action: "open" },
      })
    ).status(),
  ).toBe(403);
  const headers = {
    Host: "mic.pulse-studio.live",
    Origin: "https://mic.pulse-studio.live",
  };
  await new Promise<void>((resolve, reject) => {
    const denied = new WebSocket("ws://127.0.0.1:3211/control", token, {
      headers,
    });
    denied.on("open", () => {
      denied.close();
      reject(new Error("Output grant unexpectedly controls Bots"));
    });
    denied.on("error", () => resolve());
  });
  await new Promise<void>((resolve, reject) => {
    const output = new WebSocket("ws://127.0.0.1:3211/output-stream", token, {
      headers,
    });
    const timeout = setTimeout(() => {
      output.terminate();
      reject(new Error("Output timed out"));
    }, 3000);
    output.on("error", reject);
    output.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "state")
        output.send(JSON.stringify({ type: "monitor", enabled: true }));
      if (message.type === "error") {
        output.close();
        clearTimeout(timeout);
        reject(new Error(message.message));
      }
      if (message.type === "audio-reset") {
        output.close();
        clearTimeout(timeout);
        resolve();
      }
    });
  });
});
