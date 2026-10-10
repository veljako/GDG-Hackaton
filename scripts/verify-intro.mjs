import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import { spawn } from "node:child_process";

const base =
  process.env.GEVENTS_URL ?? process.env.GDEV_URL ?? "http://127.0.0.1:5191";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.GEVENTS_CHROMIUM ??
    process.env.GDEV_CHROMIUM ??
    "C:/Users/urosd/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe",
});
const directory = "artifacts/launch-intro";
fs.mkdirSync(directory, { recursive: true });
const checks = [],
  errors = [];
const record = (check) => {
  checks.push(check);
  console.log("PASS", check);
};
const watch = (page) => {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
};
async function recordAnimation(page, output) {
  const session = await page.context().newCDPSession(page);
  const frames = [];
  session.on("Page.screencastFrame", (frame) => {
    frames.push({
      data: Buffer.from(frame.data, "base64"),
      time: frame.metadata.timestamp,
    });
    void session.send("Page.screencastFrameAck", {
      sessionId: frame.sessionId,
    });
  });
  await session.send("Page.startScreencast", {
    format: "jpeg",
    quality: 90,
    everyNthFrame: 1,
  });
  return async () => {
    await session.send("Page.stopScreencast");
    await session.detach();
    if (!frames.length) throw new Error("No animation frames were captured");
    const encoder = spawn(
      "C:/Users/urosd/AppData/Local/ms-playwright/ffmpeg-1011/ffmpeg-win64.exe",
      [
        "-y",
        "-f",
        "image2pipe",
        "-c:v",
        "mjpeg",
        "-framerate",
        "30",
        "-i",
        "pipe:0",
        "-an",
        "-c:v",
        "vp8",
        "-deadline",
        "realtime",
        "-crf",
        "10",
        "-b:v",
        "1M",
        output,
      ],
      { stdio: ["pipe", "ignore", "pipe"], windowsHide: true },
    );
    let log = "";
    encoder.stderr.on("data", (chunk) => {
      log += chunk;
    });
    const done = new Promise((resolve, reject) => {
      encoder.on("error", reject);
      encoder.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(log)),
      );
      encoder.stdin.on("error", reject);
    });
    let index = 0;
    const duration = frames.at(-1).time - frames[0].time + 0.3;
    for (let t = 0; t < duration; t += 1 / 30) {
      while (
        index + 1 < frames.length &&
        frames[index + 1].time - frames[0].time <= t
      )
        index++;
      encoder.stdin.write(frames[index].data);
    }
    encoder.stdin.end();
    await done;
  };
}
try {
  for (const [width, height, theme] of [
    [1440, 900, "light"],
    [1440, 900, "dark"],
    [390, 844, "light"],
    [390, 844, "dark"],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: theme,
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();
    watch(page);
    await page.clock.install({ time: new Date("2026-10-10T12:00:00Z") });
    await page.clock.pauseAt(new Date("2026-10-10T12:00:01Z"));
    await page.goto(base, { waitUntil: "networkidle" });
    await expect(page.locator(".intro-screen")).toBeVisible();
    await expect(page.locator(".intro-app")).toHaveAttribute("inert", "");
    await expect(page.locator(".intro-particle")).toHaveCount(32);
    await expect(page.locator(".intro-logo-piece")).toHaveCount(4);
    expect(
      await page.locator(".intro-mark clipPath path").getAttribute("d"),
    ).toBe(
      fs
        .readFileSync("public/favicon.svg", "utf8")
        .match(/<clipPath[^>]*>\s*<path d="([^"]+)"/)[1],
    );
    await page.evaluate(() => {
      window.introAnimations = document
        .querySelector(".intro-screen")
        .getAnimations({ subtree: true });
      window.introAnimations.forEach((animation) => animation.pause());
    });
    for (const time of [600, 1250, 1900, 2400, 2850]) {
      await page.evaluate(
        (time) =>
          window.introAnimations.forEach((animation) => {
            animation.currentTime = time;
          }),
        time,
      );
      await page.screenshot({
        path: `${directory}/${theme}-${width}-${time}.png`,
      });
    }
    const final = await page.evaluate(() => ({
      transforms: [...document.querySelectorAll(".intro-logo-piece")].map(
        (piece) => getComputedStyle(piece).transform,
      ),
      wordmark: getComputedStyle(document.querySelector(".intro-wordmark"))
        .opacity,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(
      final.transforms.every(
        (transform) => transform === "matrix(1, 0, 0, 1, 0, 0)",
      ),
    ).toBe(true);
    expect(final.wordmark).toBe("1");
    expect(final.scrollWidth).toBeLessThanOrEqual(width);
    await page.getByRole("button", { name: "Skip intro" }).click();
    await expect(page.locator(".intro-screen")).toHaveCount(0);
    await expect(page.locator(".intro-app")).not.toHaveAttribute("inert", "");
    record(
      `${theme}, ${width}px: composed shapes, exact logo assembly, wordmark, no overflow`,
    );
    await context.close();
  }

  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();
    watch(page);
    const finishRecording = await recordAnimation(
      page,
      `${directory}/intro-${width}.webm`,
    );
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".intro-screen")).toBeVisible();
    const start = Date.now();
    await expect(page.locator(".intro-screen")).toHaveCount(0, {
      timeout: 4500,
    });
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(4200);
    await expect(page.locator("main h1")).toBeVisible();
    await finishRecording();
    const nav = page.locator(width < 761 ? ".mobile-nav" : ".main-nav");
    await nav.getByRole("link", { name: "Events", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Find your next thing." }),
    ).toBeVisible();
    await expect(page.locator(".intro-screen")).toHaveCount(0);
    await nav.getByRole("link", { name: "Home", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Hey, Luka" }),
    ).toBeVisible();
    await expect(page.locator(".intro-screen")).toHaveCount(0);
    await context.close();
    record(
      `${width}px: intro finishes automatically (${duration}ms), route navigation never replays it`,
    );
  }

  const context = await browser.newContext({ reducedMotion: "no-preference" });
  const page = await context.newPage();
  watch(page);
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Skip intro" }).click();
  await expect(page.locator(".intro-screen")).toHaveCount(0);
  await expect(page.locator("#main-content")).toBeFocused();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".intro-screen")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Skip intro" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".intro-screen")).toHaveCount(0);
  await expect(page.locator("#main-content")).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  record(
    "Reload starts a fresh intro; click/Escape skip it and restore focus and scrolling",
  );
  await context.close();

  const slow = await browser.newContext({ reducedMotion: "no-preference" });
  const slowPage = await slow.newPage();
  watch(slowPage);
  let releaseConfig;
  const configHeld = new Promise((resolve) => {
    releaseConfig = resolve;
  });
  await slowPage.route("**/api/config", async (route) => {
    await configHeld;
    await route.continue();
  });
  await slowPage.goto(base, { waitUntil: "domcontentloaded" });
  await slowPage.getByRole("button", { name: "Skip intro" }).click();
  await expect(slowPage.locator(".intro-app")).toBeFocused();
  releaseConfig();
  await expect(slowPage.locator("#main-content")).toBeFocused({
    timeout: 15000,
  });
  await slow.close();
  record(
    "Skipping before the API loads preserves focus and hands it to the ready page",
  );

  const reduced = await browser.newContext({
    reducedMotion: "reduce",
    colorScheme: "dark",
  });
  const reducedPage = await reduced.newPage();
  watch(reducedPage);
  await reducedPage.goto(base, { waitUntil: "domcontentloaded" });
  await expect(reducedPage.locator(".intro-screen")).toHaveCount(0, {
    timeout: 1500,
  });
  await expect(reducedPage.locator("main h1")).toBeVisible();
  await expect(reducedPage.locator("html")).toHaveAttribute(
    "data-theme",
    "dark",
  );
  record("Reduced motion uses a short static-logo fade, then releases the app");
  await reduced.close();
  expect(errors).toEqual([]);
  fs.writeFileSync(
    `${directory}/verification.json`,
    JSON.stringify(
      { base, checks, errors, verifiedAt: new Date().toISOString() },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
