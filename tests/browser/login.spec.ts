import { test, expect } from "@playwright/test";

test("PulseMic login preserves separate Discord and output entries across viewport sizes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "進入你的導播台" })).toBeVisible();
  await expect(page.getByRole("link", { name: "使用 Discord 登入" })).toHaveAttribute("href", "/auth/discord");
  await expect(page.getByRole("link", { name: "選手音源" })).toHaveAttribute("href", "/output");
  await expect(page.getByRole("link", { name: "主播台音源" })).toHaveAttribute("href", "/caster-output");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("link", { name: "使用 Discord 登入" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.local/qa/login-${width}.png`, fullPage: true });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await page.locator(".login-discord").evaluate(e => getComputedStyle(e).transitionDuration)).toBe("0s");
  await page.goto("/?login=denied");
  await expect(page.getByRole("alert")).toContainText("未被指定");
  await page.goto("/caster-output");
  await expect(page.getByLabel("一次性授權碼")).toBeVisible();
  expect(errors).toEqual([]);
});
