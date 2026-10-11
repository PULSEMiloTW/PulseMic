import { test, expect } from "@playwright/test";
test("owner backend, operator desk and anonymous status have distinct server permissions", async ({
  page,
  browser,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "專屬後台", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Caster Desk Bot Token")).toHaveValue("");
  await expect(page.getByLabel("OAuth Client Secret")).toHaveValue("");
  await expect(page.locator(".sidebar-bottom")).toContainText("測試擁有者");
  const auth = await (await request.get("/api/session")).json();
  const headers = {
    "X-PulseMic-Session": auth.session,
    Origin: "http://localhost:3211",
  };
  await expect(
    page.getByLabel("可進入控制台的 Discord User ID（每行一位）"),
  ).toHaveValue("123456789012345678");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: ".local/qa/admin-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".desk-settings")
      .evaluate((e) => getComputedStyle(e).animationName),
  ).toBe("none");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".local/qa/admin-mobile.png", fullPage: true });
  const operator = await browser.newContext({
    storageState: ".local/browser-test/operator.json",
  });
  const desk = await operator.newPage();
  await desk.goto("/console");
  await expect(desk.getByRole("heading", { name: "語音控制台" })).toBeVisible();
  await expect(desk.locator(".sidebar-bottom")).toContainText("測試操作員");
  await expect(
    desk.getByRole("link", { name: "專屬後台", exact: true }),
  ).toHaveCount(0);
  await expect(desk.locator("#settings")).toHaveCount(0);
  await expect(
    desk.getByRole("button", { name: "產生授權碼", exact: true }),
  ).toHaveCount(0);
  await expect(
    desk.getByRole("link", { name: "開啟選手雙路輸出 ↗", exact: true }),
  ).toHaveAttribute("target", "_blank");
  const operatorAuth = await (
    await operator.request.get("/api/session")
  ).json();
  const opHeaders = {
    "X-PulseMic-Session": operatorAuth.session,
    Origin: "http://localhost:3211",
  };
  for (const route of [
    "/api/settings",
    "/api/caster/settings",
    "/api/mode",
    "/api/admin/operators",
    "/api/admin/oauth",
  ])
    expect(
      (
        await operator.request.post(route, { headers: opHeaders, data: {} })
      ).status(),
    ).toBe(403);
  expect((await operator.request.get("/admin")).status()).toBe(403);
  expect(
    (
      await operator.request.get("/api/admin/oauth", { headers: opHeaders })
    ).status(),
  ).toBe(403);
  await expect(desk.getByText("本機服務已連線", { exact: true })).toBeVisible();
  await request.post("/api/admin/operators", { headers, data: { users: [] } });
  await expect(desk.getByText("本機服務未連線", { exact: true })).toBeVisible();
  expect((await operator.request.get("/api/session")).status()).toBe(401);
  await request.post("/api/admin/operators", {
    headers,
    data: { users: ["123456789012345678"] },
  });
  await operator.close();
  const anonymous = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  expect((await anonymous.request.get("/api/session")).status()).toBe(401);
  expect(
    (await anonymous.request.get("/console", { maxRedirects: 0 })).status(),
  ).toBe(302);
  expect(
    (await anonymous.request.get("/admin", { maxRedirects: 0 })).status(),
  ).toBe(302);
  const status = await anonymous.newPage();
  await status.goto("/status");
  await expect(
    status.getByRole("heading", { name: "服務元件", exact: true }),
  ).toBeVisible();
  const report = await (await anonymous.request.get("/api/status")).json();
  expect(report.components).toHaveLength(5);
  expect(JSON.stringify(report)).not.toMatch(
    /1456945476933914626|guildId|channelId|token|avatar|secret/i,
  );
  await status.screenshot({
    path: ".local/qa/status-desktop.png",
    fullPage: true,
  });
  await status.setViewportSize({ width: 390, height: 844 });
  expect(
    await status.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await status.screenshot({
    path: ".local/qa/status-mobile.png",
    fullPage: true,
  });
  await anonymous.close();
  expect(errors).toEqual([]);
});

test("Discord callback assigns owner/operator roles and rejects non-allowlisted identity", async ({
  request,
}) => {
  for (const [code, redirect] of [
    ["owner", "/admin"],
    ["operator", "/console"],
    ["denied", "/?login=denied"],
  ]) {
    const headers = { Host: "mic.pulse-studio.live", Cookie: "" };
    const begin = await request.get("/auth/discord", {
      headers,
      maxRedirects: 0,
    });
    expect(begin.status()).toBe(302);
    const state = new URL(begin.headers().location).searchParams.get("state")!;
    const callback = await request.get(
      `/auth/discord/callback?state=${state}&code=${code}`,
      {
        headers: {
          Host: "mic.pulse-studio.live",
          Cookie: `__Host-pulsemic-state=${state}`,
        },
        maxRedirects: 0,
      },
    );
    expect(callback.headers().location).toBe(redirect);
    if (code !== "denied") {
      const cookie = callback
        .headersArray()
        .find(
          (header) =>
            header.name.toLowerCase() === "set-cookie" &&
            header.value.startsWith("__Host-pulsemic="),
        )!
        .value.split(";")[0];
      const identity = await request.get("/api/identity", {
        headers: { Host: "mic.pulse-studio.live", Cookie: cookie },
      });
      expect(identity.status()).toBe(200);
      expect((await identity.json()).role).toBe(
        code === "owner" ? "owner" : "operator",
      );
      expect((await identity.json()).name).toBe("Discord 測試名稱");
      expect((await identity.json()).avatar).toContain(
        "cdn.discordapp.com/avatars/",
      );
    }
  }
});
