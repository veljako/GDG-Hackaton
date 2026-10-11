import { chromium, expect } from "@playwright/test";
import { tsImport } from "tsx/esm/api";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const { createApi } = await tsImport("../server/http.ts", import.meta.url);
const { FileRepository } = await tsImport(
  "../server/repository.ts",
  import.meta.url,
);
const directory = await mkdtemp(join(tmpdir(), "gevents-filters-"));
const server = createApi({
  mode: "demo",
  repository: new FileRepository(join(directory, "state.json")),
  publicConfig: null,
  staticDirectory: resolve("dist"),
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const cached =
  "C:/Users/urosd/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe";
let browser;
const errors = [],
  checks = [];
const pass = (message) => {
  checks.push(message);
  console.log("PASS", message);
};
mkdirSync("artifacts/filters", { recursive: true });

async function actor(width = 1440, mode = "attendee", theme = "light") {
  const context = await browser.newContext({
    viewport: { width, height: width < 700 ? 844 : 1000 },
    reducedMotion: "reduce",
  });
  const response = await context.request.post(`${base}/api/demo-session`, {
    data: { personId: "luka", mode },
  });
  expect(response.ok()).toBe(true);
  const { token } = await response.json();
  await context.addInitScript(
    ({ token, mode, theme }) => {
      sessionStorage.setItem("gevents-api-session", token);
      sessionStorage.setItem("gevents-view", mode);
      localStorage.setItem("gevents-theme", theme);
    },
    { token, mode, theme },
  );
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return page;
}
async function visit(page, route) {
  await page.goto(`${base}/#${route}`);
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".intro-screen")).toHaveCount(0);
  if (
    route.startsWith("/events?") &&
    (await page.locator(".filter-disclosure").getAttribute("aria-expanded")) ===
      "false"
  ) {
    await page.locator(".filter-disclosure").click();
  }
}
async function fits(page, popup = false) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  expect(
    await page
      .locator(".main-content")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
  if (popup) {
    const box = await page.locator(".filter-popup:popover-open").boundingBox();
    const viewport = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(11);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 11);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 3);
  }
}

try {
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(cached) ? { executablePath: cached } : {}),
  });
  const page = await actor();
  await visit(page, "/events");
  const disclosure = page.getByRole("button", { name: "Filters", exact: true });
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await disclosure.click();
  const kind = page.getByRole("combobox", { name: "Event type", exact: true });
  await kind.click();
  await expect(page.getByRole("listbox", { name: "Event type" })).toBeVisible();
  await page.getByRole("option", { name: "Conference", exact: true }).click();
  await expect(page).toHaveURL(/kind=conference/);
  await expect(page.locator(".event-card")).toHaveCount(1);
  await expect(kind).toBeFocused();
  await page.reload();
  await expect(kind).toContainText("Conference");
  await page.getByRole("button", { name: /^Filters/ }).click();
  await expect(kind).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Remove Type filter" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove Type filter" }).click();
  await expect(page).not.toHaveURL(/kind=/);
  pass(
    "Custom selection filters results, survives reload, and can be removed while collapsed",
  );

  await visit(
    page,
    "/events?kind=conference&topic=Research&city=Belgrade&format=Hybrid&from=2026-10-25&to=2026-10-30&available=1&q=business",
  );
  await expect(
    page.getByRole("heading", { name: "Business & Research Forum" }),
  ).toBeVisible();
  await expect(page.locator(".event-card")).toHaveCount(1);
  await expect(
    page.getByRole("combobox", { name: "Format", exact: true }),
  ).toContainText("Hybrid");
  await expect(
    page.getByRole("button", { name: "Available places only", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  pass(
    "Text, type, topic, city, format, dates, and capacity combine correctly",
  );

  await kind.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("option", { name: "All types", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("option").last()).toBeFocused();
  await page.keyboard.press("w");
  await expect(
    page.getByRole("option", { name: "Workshop", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(kind).toContainText("Workshop");
  await expect(kind).toBeFocused();
  await kind.click();
  await page.keyboard.press("Escape");
  await expect(kind).toHaveAttribute("aria-expanded", "false");
  await expect(kind).toBeFocused();
  await kind.click();
  await page.getByRole("heading", { name: "Find your next thing." }).click();
  await expect(kind).toHaveAttribute("aria-expanded", "false");
  await kind.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab");
  await expect(kind).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("combobox", { name: "Topic", exact: true }),
  ).toBeFocused();
  pass(
    "Dropdown keyboard navigation, type-ahead, focus return, Escape, and outside dismissal",
  );

  await visit(page, "/events?from=2026-10-25&to=2026-10-30");
  const to = page.getByRole("button", { name: "To date", exact: true });
  await to.click();
  const calendar = page.getByRole("dialog", { name: "Choose to date" });
  await expect(
    calendar.getByRole("button", { name: "24 October 2026", exact: true }),
  ).toBeDisabled();
  await expect(
    calendar.getByRole("button", { name: "30 October 2026", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/to=2026-10-29/);
  await expect(to).toBeFocused();
  await to.click();
  await calendar.getByRole("button", { name: "Next month" }).click();
  await expect(calendar.locator("strong")).toHaveText("November 2026");
  await page.keyboard.press("PageUp");
  await expect(calendar.locator("strong")).toHaveText("October 2026");
  await calendar.getByRole("button", { name: "Clear date" }).click();
  await expect(page).not.toHaveURL(/to=/);
  pass(
    "Calendar respects lower bounds, moves months and dates by keyboard, and clears values",
  );
  await visit(page, "/events?from=2026-10-30&to=2026-10-25");
  await expect(to).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#event-date-error")).toBeVisible();
  await to.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "31 October 2026", exact: true })
    .click();
  await expect(page.locator("#event-date-error")).toHaveCount(0);
  pass(
    "Invalid ranges are announced and can be corrected through the calendar",
  );

  await visit(page, "/events?from=bad%22date&to=2026-10-30");
  await page.getByRole("button", { name: "From date", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Choose from date" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.activeElement?.dataset.date),
  ).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await page.keyboard.press("Escape");
  await to.click();
  await expect(
    page.getByRole("dialog", { name: "Choose to date" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  pass("Malformed date parameters cannot break either calendar");

  await visit(page, "/events?view=for-you&kind=conference&q=business");
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(page).toHaveURL(/\/events\?view=for-you$/);
  const available = page.getByRole("button", {
    name: "Available places only",
    exact: true,
  });
  const past = page.getByRole("button", { name: "Past events", exact: true });
  await available.click();
  await past.click();
  await expect(page).toHaveURL(/available=1.*past=1/);
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(page).toHaveURL(/\/events\?view=for-you$/);
  pass("Quick successive filters and clear-all preserve the For you view");

  await visit(page, "/people");
  await page
    .getByRole("button", { name: "Accepted participants", exact: true })
    .click();
  const peopleEvent = page.getByRole("combobox", {
    name: "People hackathon filter",
  });
  await peopleEvent.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.getByRole("option").last().click();
  await expect(peopleEvent).toHaveAttribute("aria-expanded", "false");
  pass("People event filter uses the shared custom dropdown");

  const org = await actor(1440, "organizer");
  await visit(org, "/organizer");
  const managing = org.getByRole("combobox", {
    name: "Manage event",
    exact: true,
  });
  await managing.click();
  await org
    .getByRole("option", { name: "Business & Research Forum", exact: true })
    .click();
  await expect(managing).toContainText("Business & Research Forum");
  await org
    .getByRole("button", { name: "Event overview", exact: true })
    .click();
  await expect(
    org.getByRole("heading", {
      name: "Business & Research Forum",
      exact: true,
    }),
  ).toBeVisible();
  pass("Organizer uses the shared dropdown and switches the managed event");

  // Direct entry catches CSS that would otherwise load only after visiting Events.
  for (const [route, filter] of [
    ["/teams", "Meet the teams"],
    ["/activity", "Applications"],
    ["/people", "Mentors"],
  ]) {
    const direct = await actor();
    await visit(direct, route);
    const chip = direct.getByRole("button", { name: filter, exact: true });
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(
      await chip.evaluate((element) => getComputedStyle(element).minHeight),
    ).toBe("44px");
    expect(await chip.locator("svg").count()).toBe(1);
    await direct.context().close();
  }
  pass(
    "Shared filter chips work and retain styling on direct entry to Teams, Activity, and People",
  );

  for (const width of [1440, 390, 320]) {
    for (const theme of ["light", "dark"]) {
      const visual = await actor(width, "attendee", theme);
      await visit(visual, "/events?kind=conference&from=2026-10-25");
      await fits(visual);
      await visual.locator(".event-search-panel").screenshot({
        path: `artifacts/filters/${theme}-${width}-filters.png`,
      });
      await visual
        .getByRole("combobox", { name: "Event type", exact: true })
        .click();
      await fits(visual, true);
      await visual.screenshot({
        path: `artifacts/filters/${theme}-${width}-dropdown.png`,
      });
      await visual.keyboard.press("Escape");
      await visual
        .getByRole("button", { name: "From date", exact: true })
        .click();
      await fits(visual, true);
      await visual.screenshot({
        path: `artifacts/filters/${theme}-${width}-calendar.png`,
      });
      await visual.context().close();
    }
  }
  pass(
    "Light/dark dropdowns and calendars fit 1440px, 390px, and 320px viewports",
  );
  expect(errors).toEqual([]);
  pass("No browser page errors");
  writeFileSync(
    "artifacts/filters/verification.json",
    JSON.stringify({ checks, errors }, null, 2),
  );
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  if (
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !basename(directory).startsWith("gevents-filters-")
  )
    throw new Error("Unexpected temporary verification directory");
  await rm(directory, { recursive: true, force: true });
}
