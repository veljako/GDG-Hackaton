import { chromium } from "@playwright/test";
import fs from "node:fs";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.GEVENTS_CHROMIUM ??
    process.env.GDEV_CHROMIUM ??
    "C:/Users/urosd/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe",
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.goto("http://localhost:5180");
await page.waitForSelector("h1");
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: "artifacts/home-desktop.png", fullPage: true });
console.log("Title", await page.title(), "errors", errors);
await page.getByRole("button", { name: "Open demo controls" }).click();
await page.getByLabel("Demo person", { exact: true }).waitFor();
console.log("Dialog", await page.locator("md-dialog").innerText());
await page.screenshot({ path: "artifacts/dialog-desktop.png" });
await page.getByRole("button", { name: "Done", exact: true }).click();
await page.goto("http://localhost:5180/#/teams/team-4");
await page.getByRole("heading", { name: "Team 4", exact: true }).waitFor();
await page.screenshot({ path: "artifacts/team-desktop.png", fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.goto("http://localhost:5180");
await page.getByRole("heading", { name: /Hey, Luka/ }).waitFor();
await page.screenshot({ path: "artifacts/home-mobile.png", fullPage: true });
const overflow = await page.evaluate(() => ({
  width: innerWidth,
  scroll: document.documentElement.scrollWidth,
}));
console.log("Mobile overflow", overflow, "errors", errors);
fs.writeFileSync(
  "artifacts/inspection.json",
  JSON.stringify({ errors, overflow }, null, 2),
);
await browser.close();
