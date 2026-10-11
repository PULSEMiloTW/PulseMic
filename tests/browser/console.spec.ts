import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

test("desktop console: explicit demo, independent source choices, duplicate handover, mix persistence", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/console");
  await expect(page.getByText("本機服務已連線", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "專屬後台", exact: true }).click();
  await page.getByRole("button", { name: "進入示範模式" }).click();
  await page.getByRole("link", { name: "音控台", exact: true }).click();
  await expect(page.locator(".lane-a .demo-tag")).toHaveText("示範音源");
  const laneA = page.locator(".lane-a").first();
  const laneB = page.locator(".lane-b").first();
  await laneA.getByRole("button", { name: "Channel B 琥珀隊選手語音" }).click();
  await expect(
    laneA.getByText("正在切換至 琥珀隊選手語音…", { exact: true }),
  ).toBeVisible();
  await expect(
    laneA.getByRole("heading", { name: "琥珀隊選手語音" }),
  ).toBeVisible();
  await expect(
    laneA.getByText("機器人 A · 來源 Channel B", { exact: true }),
  ).toBeVisible();
  await expect(laneA.getByText("正在收聽", { exact: true })).toBeVisible();
  await laneB.getByRole("button", { name: "Channel B 琥珀隊選手語音" }).click();
  await expect(
    laneB.getByText("同頻道備援 · 由 A 路播放一份音訊"),
  ).toBeVisible();
  const session = (await (await request.get("/api/session")).json()).session;
  const code = (
    await (
      await request.post("/api/output-code", {
        headers: {
          "X-PulseMic-Session": session,
          Origin: "http://localhost:3211",
        },
        data: {},
      })
    ).json()
  ).code;
  const output = await page.context().newPage();
  await output.goto("/output");
  await output.getByLabel("一次性授權碼").fill(code);
  await output.getByRole("button", { name: "驗證並進入" }).click();
  await expect(
    output.getByText("本機服務已連線", { exact: true }),
  ).toBeVisible();
  const outputA = output.locator(".lane-a").first();
  const outputB = output.locator(".lane-b").first();
  await output.getByRole("button", { name: "開始監聽", exact: true }).click();
  await output.getByRole("button", { name: "播放示範測試音" }).click();
  await expect
    .poll(async () =>
      outputA.locator(".meter").first().getAttribute("data-active"),
    )
    .toBe("true");
  expect(
    await outputB.locator(".meter").first().getAttribute("data-active"),
  ).not.toBe("true");
  const member = outputA.getByRole("slider", {
    name: "A 路 隊長 demo-B-0 音量",
    exact: true,
  });
  await member.fill("150");
  await expect(member).toHaveValue("150");
  await outputA
    .getByRole("button", { name: "靜音 A 路 隊長 demo-B-0", exact: true })
    .click();
  await expect
    .poll(async () =>
      outputA.locator(".meter").first().getAttribute("data-active"),
    )
    .toBe("false");
  await outputA
    .getByRole("button", { name: "取消靜音 A 路 隊長 demo-B-0", exact: true })
    .click();
  await mkdir(resolve(".local/qa"), { recursive: true });
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    scrollTo(0, 0);
  });
  await page.screenshot({
    path: resolve(".local/qa/desktop.png"),
    fullPage: true,
  });
  await laneA.getByRole("button", { name: "關閉語音", exact: true }).click();
  await expect(
    laneA.getByRole("heading", { name: "尚未收聽頻道" }),
  ).toBeVisible();
  await expect(laneB.getByText("由 B 路播放 · 獨立成員音源")).toBeVisible();
  await expect
    .poll(async () =>
      outputB.locator(".meter").first().getAttribute("data-active"),
    )
    .toBe("true");
  await output.getByRole("button", { name: "停止監聽", exact: true }).click();
  await expect(laneB.getByText("正在收聽", { exact: true })).toBeVisible();
  await page.waitForTimeout(250);
  await page.reload();
  await expect(page.getByText("本機服務已連線", { exact: true })).toBeVisible();
  await laneA.getByRole("button", { name: "開啟語音", exact: true }).click();
  await expect(
    laneA.getByRole("slider", { name: "A 路 隊長 demo-B-0 音量", exact: true }),
  ).toHaveValue("150");
  await expect(
    page.getByRole("button", { name: "開始監聽", exact: true }),
  ).toBeHidden();
  expect(errors).toEqual([]);
});

test("narrow console has stacked lanes, keyboard focus and no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/console");
  await expect(page.getByText("本機服務已連線", { exact: true })).toBeVisible();
  const laneA = page.locator(".lane-a").first();
  const laneB = page.locator(".lane-b").first();
  await laneA.getByRole("button", { name: "Channel A 藍隊選手語音" }).click();
  await laneB.getByRole("button", { name: "Channel B 琥珀隊選手語音" }).click();
  await expect(laneB.getByText("正在收聽", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const a = await laneA.boundingBox();
  const b = await laneB.boundingBox();
  expect(b!.y).toBeGreaterThan(a!.y + a!.height);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    scrollTo(0, 0);
  });
  await page.screenshot({
    path: resolve(".local/qa/narrow.png"),
    fullPage: true,
  });
  await page.keyboard.press("Tab");
  await page.getByRole("link", { name: "音控台", exact: true }).focus();
  expect(
    await page
      .getByRole("link", { name: "音控台", exact: true })
      .evaluate((element) => getComputedStyle(element).outlineStyle),
  ).toBe("solid");
  await page.getByRole("button", { name: "全部靜音", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "全部已靜音 · 取消" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "全部已靜音 · 取消" }).click();
  await expect(page.locator(".recent")).toBeVisible();
});

test("long channel names wrap without overflow at 320px", async ({ page }) => {
  const longName =
    "決賽藍隊選手語音頻道・教練與候補選手協作溝通專用ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  await page.routeWebSocket("**/control", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      const parsed = JSON.parse(String(message));
      if (parsed.type === "state") {
        parsed.state.guildName = longName;
        for (const id of ["A", "B"]) {
          parsed.state.sources[id].name = longName;
          if (parsed.state.lanes[id].channelName)
            parsed.state.lanes[id].channelName = longName;
          if (parsed.state.lanes[id].targetName)
            parsed.state.lanes[id].targetName = longName;
        }
      }
      socket.send(JSON.stringify(parsed));
    });
  });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/console");
  await expect(page.getByText("本機服務已連線", { exact: true })).toBeVisible();
  await expect(
    page.locator(".lane-a").first().getByRole("heading", { name: longName }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: resolve(".local/qa/long-name.png"),
    fullPage: true,
  });
});

test("another controller takes over and old panel never shows stale listening channels", async ({
  page,
  context,
}) => {
  await page.goto("/console");
  await expect(page.getByText("本機服務已連線", { exact: true })).toBeVisible();
  await expect(
    page.locator(".lane-a").first().getByText("正在收聽", { exact: true }),
  ).toBeVisible();
  const replacement = await context.newPage();
  await replacement.goto("/console");
  await expect(
    replacement.getByText("本機服務已連線", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("另一個控制台已接手。請關閉其他控制台並重新整理。"),
  ).toBeVisible();
  await expect(
    page
      .locator(".lane-a")
      .first()
      .getByRole("heading", { name: "頻道狀態待確認" }),
  ).toBeVisible();
  await expect(
    page.locator(".lane-a").first().getByText("正在收聽", { exact: true }),
  ).toHaveCount(0);
  await replacement.close();
});

test("settings stays local, has empty tokens and actual resolved names; no public origin access", async ({
  page,
  request,
}) => {
  await page.goto("/admin");
  await expect(page.getByText("本機服務已連線", { exact: true })).toBeVisible();
  await expect(page.getByLabel("機器人 A Token", { exact: false })).toHaveValue(
    "",
  );
  await expect(page.locator(".verified")).toContainText("Channel A");
  await expect(page.locator(".verified")).toContainText("藍隊選手語音");
  await page
    .getByLabel("伺服器 ID", { exact: true })
    .fill("123456789012345678");
  await page.locator("#settings summary").click();
  await page.locator("#settings summary").click();
  await expect(page.getByLabel("伺服器 ID", { exact: true })).toHaveValue(
    "123456789012345678",
  );
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    scrollTo(0, 0);
  });
  await page.screenshot({
    path: resolve(".local/qa/settings.png"),
    fullPage: true,
  });
  const forbidden = await request.post("/api/mode", {
    headers: { Origin: "https://evil.example" },
    data: { mode: "demo" },
  });
  expect(forbidden.status()).toBe(403);
  const unauthorized = await request.get("/api/state");
  expect(unauthorized.status()).toBe(403);
});
