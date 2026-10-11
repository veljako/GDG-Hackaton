import fs from "node:fs/promises";
import path from "node:path";

process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.resolve(
  ".runtime/pitch-tour/browsers",
);
const { chromium, expect } = await import("@playwright/test");

const base = process.env.GEVENTS_URL ?? "http://127.0.0.1:5201";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw new Error(
    "Use an isolated local fictional demo for tour verification.",
  );
const output = path.resolve(".runtime/pitch-tour");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.GEVENTS_CHROMIUM ??
    "C:/Users/urosd/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe",
});
const errors = [];
const checks = [];
const expected = [
  "welcome",
  "profile",
  "roles",
  "recommendations",
  "reasons",
  "search",
  "team",
  "organizer",
  "review",
  "activity",
];
const shots = path.resolve("presentation/assets");
await fs.mkdir(shots, { recursive: true });
async function snapshot(page) {
  return page.evaluate(async () => {
    const token = sessionStorage.getItem("gevents-api-session");
    const response = await fetch("/api/state?mode=organizer", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { state } = await response.json();
    return JSON.stringify({
      people: state.people,
      events: state.events,
      applications: state.applications,
      teams: state.teams,
      invitations: state.invitations,
      eventInvitations: state.eventInvitations,
    });
  });
}
async function inspectStep(page, id, width, height) {
  await expect(
    page.locator(
      `.guided-tour[data-tour-step="${id}"][data-tour-ready="true"]`,
    ),
  ).toBeVisible();
  await expect(page.locator(".tour-outline")).toBeVisible();
  const geometry = await page.locator(".tour-caption").boundingBox();
  if (
    !geometry ||
    geometry.x < 0 ||
    geometry.y < 0 ||
    geometry.x + geometry.width > width + 1 ||
    geometry.y + geometry.height > height + 1
  )
    throw new Error(`Caption outside ${width}x${height} at ${id}`);
  expect(
    await page.locator(".app-shell").evaluate((element) => element.inert),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator(".tour-notice")).toHaveCount(0);
}
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base + "/#/events?kind=conference");
    await expect(
      page.getByRole("button", { name: "Start guided tour" }),
    ).toBeVisible();
    await expect(page.locator(".intro-screen")).toHaveCount(0);
    const before = await snapshot(page);
    await page.getByRole("button", { name: "Start guided tour" }).click();
    for (const id of expected) {
      await inspectStep(page, id, width, height);
      if (width === 1440)
        await page.screenshot({ path: path.join(shots, `tour-${id}.png`) });
      else if (["welcome", "roles", "recommendations", "review"].includes(id))
        await page.screenshot({ path: path.join(output, `mobile-${id}.png`) });
      if (id === "reasons")
        await expect(page.locator(".match-reasons").first()).toHaveAttribute(
          "open",
          "",
        );
      if (id === "review") {
        const target = await page
          .locator('[data-tour="organizer-review"]')
          .boundingBox();
        const outline = await page.locator(".tour-outline").boundingBox();
        expect(Math.abs(outline.y - Math.max(8, target.y - 8))).toBeLessThan(2);
      }
      await page
        .getByRole("button", {
          name: id === "activity" ? "Finish" : "Next",
          exact: true,
        })
        .click();
    }
    await expect(page.locator(".guided-tour")).toHaveCount(0);
    await expect(page).toHaveURL(base + "/#/events?kind=conference");
    expect(
      await page.locator(".app-shell").evaluate((element) => element.inert),
    ).toBe(false);
    await expect(
      page.getByRole("button", { name: "Start guided tour" }),
    ).toBeFocused();
    expect(await snapshot(page)).toBe(before);
    checks.push(
      `${width}x${height}: all ten measured spotlights, controls, route/focus restore, no canonical changes`,
    );
    await page.getByRole("button", { name: "Start guided tour" }).click();
    await inspectStep(page, "welcome", width, height);
    await page.keyboard.press("Shift+Tab");
    await expect(
      page.getByRole("button", { name: "Next", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Close guided tour" }),
    ).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await inspectStep(page, "profile", width, height);
    await page.keyboard.press("ArrowLeft");
    await inspectStep(page, "welcome", width, height);
    await page.getByRole("button", { name: "Play tour automatically" }).click();
    await page.getByRole("button", { name: "Pause tour playback" }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".guided-tour")).toHaveCount(0);
    checks.push(
      `${width}x${height}: keyboard focus trap, arrows, playback pause and Escape`,
    );
    await page.goto(base + "/#/?tour=1");
    await inspectStep(page, "welcome", width, height);
    await page.setViewportSize({
      width: width === 1440 ? 1100 : 375,
      height: height - 60,
    });
    await expect(page.locator(".tour-caption")).toBeVisible();
    await page.getByRole("button", { name: "Close guided tour" }).click();
    await expect(page).toHaveURL(base + "/#/");
    checks.push(
      `${width}x${height}: URL entry after launch, resize and cleaned exit URL`,
    );
    await context.close();
  }
  if (process.argv.includes("--record")) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      recordVideo: {
        dir: path.join(output, "raw-video"),
        size: { width: 1440, height: 900 },
      },
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base + "/#/?tour=1");
    await inspectStep(page, "welcome", 1440, 900);
    await page.getByRole("button", { name: "Play tour automatically" }).click();
    for (const id of expected) {
      await expect(
        page.locator(
          `.guided-tour[data-tour-step="${id}"][data-tour-ready="true"]`,
        ),
      ).toBeVisible({ timeout: 25000 });
    }
    await expect(page.locator(".guided-tour")).toHaveCount(0, {
      timeout: 20000,
    });
    const video = page.video();
    await context.close();
    await video.saveAs(path.join(output, "GEvents-Walkthrough.webm"));
    checks.push(
      "Actual app recording includes existing brand launch and complete automatic tour",
    );
  }
  expect(errors).toEqual([]);
  await fs.writeFile(
    path.join(output, "verification.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}
