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
  await page.getByRole("button", { name: "已有授權碼" }).click();
  await expect(page.getByLabel("一次性授權碼")).toBeVisible();
  expect(errors).toEqual([]);
});

test("login animation moves decoration, pauses without shifting layout, and respects reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "使用 Discord 登入" })).toBeVisible();
  const decoration = page.locator(".login-art");
  const orbit = page.locator(".login-orbit");
  const first = await orbit.evaluate(e => getComputedStyle(e).transform);
  await expect.poll(() => orbit.evaluate(e => getComputedStyle(e).transform)).not.toBe(first);
  const box = await decoration.boundingBox();
  await page.getByRole("button", { name: "暫停動畫" }).click();
  await expect(page.getByRole("button", { name: "繼續動畫" })).toHaveAttribute("aria-pressed", "true");
  expect(await orbit.evaluate(e => getComputedStyle(e).animationPlayState)).toBe("paused");
  const paused = await orbit.evaluate(e => getComputedStyle(e).transform);
  // Sample multiple rendered frames: the paused transform and layout must stay fixed.
  expect(await orbit.evaluate(e => new Promise<string>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(getComputedStyle(e).transform)))))).toBe(paused);
  expect(await decoration.boundingBox()).toEqual(box);
  await page.screenshot({ path: ".local/qa/login-motion-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "繼續動畫" }).click();
  expect(await orbit.evaluate(e => getComputedStyle(e).animationPlayState)).toBe("running");
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const selector of [".login-orbit", ".login-art > img", ".source-a", ".source-b", ".source-c", ".login-content"]) {
    expect(await page.locator(selector).evaluate(e => getComputedStyle(e).animationName)).toBe("none");
  }
  await expect(page.getByRole("button", { name: "暫停動畫" })).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(decoration).toBeHidden();
  await page.screenshot({ path: ".local/qa/login-motion-mobile.png", fullPage: true });
});


test("page titles use PulseMic branding", async ({ page }) => {
  for (const route of ["/", "/console", "/admin", "/output", "/caster-output", "/status"]) {
    await page.goto(route);
    await expect(page).toHaveTitle(route === "/status" ? "PulseMic Status" : "PulseMic");
  }
});
