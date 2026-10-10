import { chromium, expect } from "@playwright/test";
import fs from "node:fs";

const base =
  process.env.GEVENTS_URL ?? process.env.GDEV_URL ?? "http://localhost:5180";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.GEVENTS_CHROMIUM ??
    process.env.GDEV_CHROMIUM ??
    "C:/Users/urosd/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe",
});
const checks = [];
const errors = [];
const record = (check) => {
  checks.push(check);
  console.log("PASS", check);
};

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  let releaseBoot;
  const bootGate = new Promise((resolve) => {
    releaseBoot = resolve;
  });
  await page.route("**/assets/index-*.js", async (route) => {
    await bootGate;
    await route.continue();
  });
  await page.goto(base, { waitUntil: "commit" });
  await expect(page.locator(".boot-screen")).toBeVisible();
  await expect(page.locator(".boot-shapes i")).toHaveCount(4);
  record(
    "Initial HTML loader is visible before the application bundle arrives",
  );
  releaseBoot();
  await expect(
    page.getByRole("heading", { name: "Hey, Luka" }),
  ).toBeVisible();
  await expect(page.locator(".boot-screen")).toHaveCount(0);

  let releasePage;
  const pageGate = new Promise((resolve) => {
    releasePage = resolve;
  });
  await page.route("**/assets/People-*.js", async (route) => {
    await pageGate;
    await route.continue();
  });
  await page
    .locator(".main-nav")
    .getByRole("link", { name: "Community" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Loading your community",
  );
  const animation = await page
    .locator(".loading-shapes i")
    .first()
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(animation).toBe("shape-hop");
  await page.screenshot({ path: "artifacts/loading-desktop.png" });
  record("Real lazy page requests display the animated four-color loader");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".loading-shapes i")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  record("Reduced-motion preference keeps loader shapes still");
  releasePage();
  await expect(page.locator(".page-loader")).toHaveCount(0);
  await expect(page.locator("main h1")).toBeVisible();
  record("Loaded page replaces the fallback without an artificial timer");

  await page
    .locator(".main-nav")
    .getByRole("link", { name: "Home", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Hey, Luka" }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  for (const width of [1440, 1024, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(scrollWidth, `${width}px overflow`).toBeLessThanOrEqual(width);
    await expect(
      page.getByRole("button", { name: "Explore hackathons" }),
    ).toBeVisible();
  }
  record(
    "Home remains usable without horizontal overflow at five desktop/tablet/mobile sizes",
  );
  expect(
    await page
      .locator(".community-backdrop")
      .evaluate((el) => getComputedStyle(el).pointerEvents),
  ).toBe("none");
  record("Background geometry never intercepts clicks");
  expect(errors).toEqual([]);
  record("No JavaScript errors");
  fs.writeFileSync(
    "artifacts/playful-verification.json",
    JSON.stringify({ checks, errors }, null, 2),
  );
} finally {
  await browser.close();
}
