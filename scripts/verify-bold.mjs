import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import { chooseFilter } from "./filter-test-utils.mjs";

const base =
  process.env.GEVENTS_URL ?? process.env.GDEV_URL ?? "http://127.0.0.1:5191";
const executablePath =
  process.env.GEVENTS_CHROMIUM ??
  process.env.GDEV_CHROMIUM ??
  "C:/Users/urosd/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe";
fs.mkdirSync("artifacts/bold-design", { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath });
const checks = [],
  errors = [];
const record = (check) => {
  checks.push(check);
  console.log("PASS", check);
};
const routes = [
  "/",
  "/events",
  "/people",
  "/teams",
  "/profile",
  "/activity",
  "/events/gdg-belgrade",
  "/teams/team-4",
];
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      colorScheme: theme,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    for (const [width, height] of [
      [1440, 900],
      [1366, 768],
      [1024, 768],
      [768, 1024],
      [390, 844],
      [360, 800],
    ]) {
      await page.setViewportSize({ width, height });
      for (const route of routes) {
        await page.goto(`${base}/#${route}`, { waitUntil: "networkidle" });
        await expect(page.locator("main h1")).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const geometry = await page.evaluate(() => {
          const main = document.querySelector("main");
          return {
            width: innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            mainHeight: main.clientHeight,
            contentHeight: main.scrollHeight,
            outerHeight: document.documentElement.scrollHeight,
          };
        });
        expect(
          geometry.scrollWidth,
          `${theme} ${width} ${route}: horizontal overflow`,
        ).toBeLessThanOrEqual(width);
        if (route === "/" && width >= 1024)
          expect(
            geometry.contentHeight,
            `Home must fit ${width}x${height}`,
          ).toBeLessThanOrEqual(geometry.mainHeight + 1);
        if (width >= 1200 && ["/events", "/people", "/teams"].includes(route))
          expect(
            geometry.contentHeight,
            `${route} must fit ${width}x${height}`,
          ).toBeLessThanOrEqual(geometry.mainHeight + 1);
        if (width >= 761)
          expect(geometry.outerHeight).toBeLessThanOrEqual(height);
        if ([1440, 390].includes(width))
          await page.screenshot({
            path: `artifacts/bold-design/${theme}-${width}-${route === "/" ? "home" : route.slice(1).replaceAll("/", "-")}.png`,
            fullPage: width < 761,
          });
      }
      record(
        `${theme}: ${width}x${height}, eight routes, no horizontal overflow, desktop fit`,
      );
    }
    await context.close();
  }
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  record(
    "Theme toggle works both ways, persists after reload, and overrides the system preference",
  );
  await page.goto(`${base}/#/people`, { waitUntil: "networkidle" });
  const first = await page.locator(".person-card-name").first().innerText();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  expect(await page.locator(".person-card-name").first().innerText()).not.toBe(
    first,
  );
  await page.getByLabel("Search community profiles").fill("Mila");
  await expect(page.locator(".person-card")).toHaveCount(1);
  await expect(page.locator(".person-card-name")).toContainText("Mila");
  await page.locator(".person-card-name").click();
  await expect(page.locator("md-dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  record("Community pagination, search reset and profile dialog work");
  await page.goto(`${base}/#/events`, { waitUntil: "networkidle" });
  await expect(page.locator(".event-card")).toHaveCount(4);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.locator(".pagination")).toContainText("Page 2");
  await page.getByLabel("Search events", { exact: true }).fill("Gemini");
  await expect(page.locator(".event-card")).toHaveCount(1);
  await expect(page.locator(".card-title-button")).toContainText("Gemini");
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Event type", exact: true }),
  ).toBeVisible();
  await chooseFilter(page, "Event type", "conference");
  await expect(page.locator(".event-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(page.locator(".event-card")).toHaveCount(4);
  record("Event pagination, search and expandable filters work");
  await page.goto(base, { waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "Open team space", exact: true })
    .click();
  await expect(page.locator("h1")).toHaveText("Team 4");
  await page
    .getByText("Member details and team controls", { exact: true })
    .click();
  await expect(page.locator(".team-member-row")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Open demo controls", exact: true })
    .click();
  await expect(page.locator("md-dialog")).toBeVisible();
  await expect(page.getByLabel("Demo person", { exact: true })).toBeVisible();
  await page
    .locator("md-dialog")
    .getByRole("button", { name: "Done", exact: true })
    .click();
  record("Team navigation and account controls remain usable");
  await page.goto(`${base}/#/profile`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await expect(page.locator("md-dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByText("Sample profile imports", { exact: true }).click();
  await page
    .getByRole("button", { name: "Preview LinkedIn sample", exact: true })
    .click();
  await expect(page.locator("md-dialog")).toContainText(
    "Review LinkedIn sample",
  );
  await page
    .getByRole("button", { name: "Keep my profile", exact: true })
    .click();
  record("Profile editing and collapsed sample imports remain accessible");
  await page
    .getByRole("button", { name: "Organizer workspace", exact: true })
    .click();
  await expect(page.locator("main h1")).toBeVisible();
  await page.screenshot({ path: "artifacts/bold-design/organizer-light.png" });
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.screenshot({ path: "artifacts/bold-design/organizer-dark.png" });
  record("Organizer workspace renders in both themes");
  await context.close();
  const automatic = await browser.newContext({ colorScheme: "light" });
  const automaticPage = await automatic.newPage();
  await automaticPage.goto(base, { waitUntil: "networkidle" });
  await automaticPage.emulateMedia({ colorScheme: "dark" });
  await expect(automaticPage.locator("html")).toHaveAttribute(
    "data-theme",
    "dark",
  );
  await automatic.close();
  record("Fresh sessions follow changes to the system color scheme");
  expect(errors).toEqual([]);
  fs.writeFileSync(
    "artifacts/bold-design/verification.json",
    JSON.stringify(
      { base, checks, errors, verifiedAt: new Date().toISOString() },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
