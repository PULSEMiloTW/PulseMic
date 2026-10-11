import { test, expect } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`desk pages are separate at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      const text = message.text();
      // Existing bundled font data URLs are blocked by the production font CSP.
      if (message.type() === "error" && !(text.startsWith("Loading the font 'data:font/") && text.includes("font-src 'self'"))) errors.push(text);
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/console");
    const nav = page.getByRole("navigation", { name: "控制台區域" });
    await expect(nav.getByRole("link")).toHaveText([
      "音控台", "輸出頁", "運行日誌", "系統狀態", "專屬後台",
    ]);
    await expect(page.locator(".mixer-grid")).toBeVisible();
    await expect(page.locator("#outputs, #logs")).toHaveCount(0);
    await nav.getByRole("link", { name: "輸出頁", exact: true }).click();
    await expect(page.locator("#outputs")).toBeVisible();
    await expect(page.locator(".mixer-grid, #logs")).toHaveCount(0);
    await nav.getByRole("link", { name: "運行日誌", exact: true }).click();
    await expect(page.locator("#logs")).toBeVisible();
    await expect(page.locator(".mixer-grid, #outputs")).toHaveCount(0);
    await page.reload();
    await expect(nav.getByRole("link", { name: "運行日誌", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("#logs")).toBeVisible();
    await page.screenshot({ path: `.local/qa/logs-${width}.png`, fullPage: true });
    await page.goBack();
    await expect(page.locator("#outputs")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.local/qa/outputs-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}
