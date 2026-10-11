import fs from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const base = process.env.GEVENTS_URL ?? "http://127.0.0.1:5201";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw new Error("Use the isolated local demo for entry verification.");
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.GEVENTS_CHROMIUM ??
    "C:/Users/urosd/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe",
});
const checks = [];
const errors = [];
try {
  for (const [width, height] of [
    [1366, 768],
    [1920, 1080],
    [1280, 720],
    [390, 844],
  ]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const health = await context.request.get(base + "/api/health");
    expect(await health.json()).toMatchObject({ ok: true, mode: "demo" });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    for (const suffix of ["/", "/#/?tour=1", "/?tour=1#/events"]) {
      console.log(`Checking ${width}x${height} entry ${suffix}`);
      await page.goto(base + suffix);
      await expect(
        page.locator(
          '.guided-tour[data-tour-step="welcome"][data-tour-ready="true"]',
        ),
      ).toBeVisible({ timeout: 15000 });
      await page.getByRole("button", { name: "Close guided tour" }).click();
      await expect(page.locator(".guided-tour")).toHaveCount(0);
      expect(new URL(page.url()).searchParams.has("tour")).toBe(false);
      await expect(
        page.getByRole("button", { name: "Start guided tour" }),
      ).toBeEnabled();
      await page.getByRole("button", { name: "Start guided tour" }).click();
      await expect(
        page.locator('.guided-tour[data-tour-ready="true"]'),
      ).toBeVisible();
      await page.getByRole("button", { name: "Close guided tour" }).click();
      await expect(page.locator(".guided-tour")).toHaveCount(0);
    }
    await page.goto(base + "/#/events?kind=conference");
    await expect(page.locator(".intro-screen")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Start guided tour" }),
    ).toBeEnabled();
    await expect(page.locator(".guided-tour")).toHaveCount(0);
    await page.getByRole("button", { name: "Start guided tour" }).click();
    await expect(
      page.locator('.guided-tour[data-tour-ready="true"]'),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close guided tour" }).click();
    await expect(page).toHaveURL(base + "/#/events?kind=conference");
    if (width > 600) {
      await expect(page.locator(".tour-trigger-label")).toBeVisible();
      await page.screenshot({
        path: `.runtime/pitch-tour/desktop-entry-${width}.png`,
      });
    }
    checks.push({
      width,
      height,
      entries: 3,
      manualStart: true,
      deepLinkRestored: true,
    });
    await context.close();
  }
  expect(errors).toEqual([]);
  const result = { checks, errors, verifiedAt: new Date().toISOString() };
  await fs.writeFile(
    ".runtime/pitch-tour/entry-verification.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
