import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("caster desk has a separate stream, scoped code, mixer and shared emergency mute", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "專屬後台", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Caster Desk Bot Token")).toHaveValue("");
  await expect(page.locator(".mixer-grid .lane")).toHaveCount(0);
  await expect(page.getByLabel("機器人 A Token", { exact: false })).toHaveValue(
    "",
  );
  await expect(page.getByLabel("機器人 B Token", { exact: false })).toHaveValue(
    "",
  );
  await expect(
    page.getByText(
      "第三個獨立 Bot；不占用選手 A/B。設定變更前請先退出主播台語音。",
      { exact: true },
    ),
  ).toHaveCount(0);
  const session = (await (await request.get("/api/session")).json()).session;
  const headers = {
    "X-PulseMic-Session": session,
    Origin: "http://localhost:3211",
  };
  await request.post("/api/caster/mode", { headers, data: { mode: "live" } });
  await page.getByRole("button", { name: "演練主播台介面" }).click();
  await page.getByRole("link", { name: "音控台", exact: true }).click();
  await expect(page.locator(".mixer-grid .lane")).toHaveCount(3);
  await page.getByRole("button", { name: "開啟主播台語音" }).click();
  await expect(
    page.getByText("正在切換至 主播台語音（示範）…", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".caster-mixer")
      .getByRole("heading", { name: "主播台語音（示範）" }),
  ).toBeVisible();
  await expect(page.locator(".caster-mixer .member")).toHaveCount(3);
  const code = (
    await (
      await request.post("/api/output-code", {
        headers,
        data: { kind: "caster" },
      })
    ).json()
  ).code;
  expect(
    (
      await request.post("/auth/output", {
        headers: { Origin: "http://localhost:3211" },
        data: { code, kind: "players" },
      })
    ).status(),
  ).toBe(403);
  const output = await page.context().newPage();
  await output.addInitScript(() => {
    const gains: GainNode[] = [];
    (window as unknown as { testGains: GainNode[] }).testGains = gains;
    const createGain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () {
      const node = createGain.call(this);
      gains.push(node);
      return node;
    };
  });
  await output.goto("/caster-output");
  await output.getByLabel("一次性授權碼").fill(code);
  await output.getByRole("button", { name: "驗證並進入" }).click();
  await expect(
    output.getByRole("heading", { name: "Caster Desk 主播台輸出" }),
  ).toBeVisible();
  await expect(output.locator(".lane")).toHaveCount(1);
  await expect(
    output.getByText("PulseMic Caster Desk · 主播台來源", { exact: true }),
  ).toBeVisible();
  await expect(output.getByRole("button", { name: "開啟語音" })).toBeHidden();
  await output.getByRole("button", { name: "開始監聽", exact: true }).click();
  await output.getByRole("button", { name: "播放示範測試音" }).click();
  await expect
    .poll(() => output.locator(".meter").first().getAttribute("data-active"))
    .toBe("true");
  await page
    .getByRole("slider", { name: "主播台音量", exact: true })
    .fill("175");
  await expect(
    output.getByRole("slider", { name: "主播台音量", exact: true }),
  ).toHaveValue("175");
  await page.getByRole("button", { name: "全部靜音", exact: true }).click();
  await expect
    .poll(() =>
      output.evaluate(
        () =>
          (window as unknown as { testGains: GainNode[] }).testGains[0].gain
            .value,
      ),
    )
    .toBeLessThan(0.001);
  await page
    .getByRole("button", { name: "全部已靜音 · 取消", exact: true })
    .click();
  await expect
    .poll(() => output.locator(".meter").first().getAttribute("data-active"))
    .toBe("true");
  const players = await (await request.get("/api/state", { headers })).json();
  expect(JSON.stringify(players)).not.toContain("demo-caster-");
  await mkdir(".local/qa", { recursive: true });
  await page.screenshot({
    path: ".local/qa/caster-desktop.png",
    fullPage: true,
  });
  await output.screenshot({
    path: ".local/qa/caster-output-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: ".local/qa/caster-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 800 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await output.reload();
  await expect(output.getByLabel("一次性授權碼")).toBeVisible();
  await page.getByRole("button", { name: "關閉主播台語音" }).click();
  await expect(
    page
      .locator(".caster-mixer")
      .getByRole("heading", { name: "尚未收聽頻道" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
