import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
const base =
  process.env.GEVENTS_URL ?? process.env.GDEV_URL ?? "http://127.0.0.1:5194";
const readOnly =
  (process.env.GEVENTS_EVENTS_READONLY ?? process.env.GDEV_EVENTS_READONLY) ===
  "1";
const cached =
  "C:/Users/urosd/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe";
const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(cached) ? { executablePath: cached } : {}),
});
const checks = [],
  errors = [],
  contexts = [];
const pass = (name) => {
  checks.push(name);
  console.log("PASS", name);
};
async function actor(personId = "luka", mode = "attendee", mobile = false) {
  const context = await browser.newContext({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  contexts.push(context);
  const response = await context.request.post(base + "/api/demo-session", {
    data: { personId, mode },
  });
  expect(response.ok()).toBe(true);
  const { token } = await response.json();
  await context.addInitScript(
    ({ token, mode }) => {
      sessionStorage.setItem("gevents-api-session", token);
      sessionStorage.setItem("gevents-view", mode);
    },
    { token, mode },
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return { page, token, context };
}
async function command(actor, action, mode = "attendee") {
  const response = await actor.context.request.post(
    base + "/api/actions?mode=" + mode,
    { data: action, headers: { Authorization: "Bearer " + actor.token } },
  );
  expect(response.ok()).toBe(true);
  const result = await response.json();
  expect(result.error).toBeUndefined();
  return result;
}
async function snapshot(actor) {
  const r = await actor.context.request.get(base + "/api/state", {
    headers: { Authorization: "Bearer " + actor.token },
  });
  return (await r.json()).state;
}
try {
  if (!readOnly && !["127.0.0.1", "localhost"].includes(new URL(base).hostname))
    throw new Error(
      "Mutating checks require a dedicated local demo. Use GEVENTS_EVENTS_READONLY=1 for public verification.",
    );
  if (!readOnly) {
    const resetter = await actor("luka", "organizer");
    await command(resetter, { type: "RESET" }, "organizer");
  }
  const a = await actor();
  await a.page.goto(base + "/#/events?view=for-you");
  await expect(
    a.page.getByRole("heading", { name: "Open Science & Web Meetup" }),
  ).toBeVisible();
  await expect(a.page.getByText("Why this fits you").first()).toBeVisible();
  pass("Profile-based suggestions explain their reasons");
  await a.page.goto(
    base +
      "/#/events?kind=conference&topic=Research&city=Belgrade&format=Hybrid&from=2026-10-25&to=2026-10-30&available=1&q=business",
  );
  await expect(
    a.page.getByRole("heading", { name: "Business & Research Forum" }),
  ).toBeVisible();
  await expect(a.page.locator(".event-card")).toHaveCount(1);
  await a.page.reload();
  await expect(
    a.page.getByRole("combobox", { name: "Event type", exact: true }),
  ).toHaveAttribute("data-value", "conference");
  pass("Advanced filters combine and persist after reload");
  await a.page.goto(base + "/#/events/open-science-meetup");
  await expect(
    a.page.getByText("Individual attendance", { exact: true }),
  ).toBeVisible();
  await expect(
    a.page.getByRole("button", { name: "Teams", exact: true }),
  ).toHaveCount(0);
  pass("Individual event detail omits team controls");
  await a.page.goto(base + "/#/hackathons/gdg-belgrade");
  await expect(
    a.page.getByRole("heading", {
      name: "GDG Belgrade Hackathon",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    a.page.getByRole("button", { name: "Teams", exact: true }),
  ).toBeVisible();
  pass("Legacy hackathon route and team controls remain available");
  const mobile = await actor("luka", "attendee", true);
  await mobile.page.goto(base + "/#/events?kind=festival");
  await expect(
    mobile.page.getByRole("heading", { name: "Science & Learning Festival" }),
  ).toBeVisible();
  expect(
    await mobile.page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  fs.mkdirSync("artifacts/events", { recursive: true });
  await mobile.page.screenshot({
    path: "artifacts/events/mobile.png",
    fullPage: true,
  });
  await a.page.goto(base + "/#/events?view=for-you");
  await a.page.screenshot({
    path: "artifacts/events/desktop.png",
    fullPage: true,
  });
  pass("Public event discovery fits 390px and desktop");
  if (!readOnly) {
    await a.page.goto(base + "/#/events/open-science-meetup");
    await a.page
      .getByRole("button", { name: "Register for event", exact: true })
      .click();
    const dialog = a.page.locator("md-dialog");
    await expect(dialog.getByLabel("How are you joining?")).toHaveCount(0);
    await dialog
      .getByLabel("What would you like to learn or explore?")
      .fill("I want to learn about open science and accessible research.");
    const saved = a.page.waitForResponse(
      (r) =>
        r.url().includes("/api/actions") && r.request().method() === "POST",
    );
    await dialog
      .getByRole("button", { name: "Confirm registration", exact: true })
      .click();
    expect((await saved).ok()).toBe(true);
    expect(
      (await snapshot(a)).applications.find(
        (x) => x.personId === "luka" && x.eventId === "open-science-meetup",
      )?.status,
    ).toBe("accepted");
    pass("Meetup registration confirms through the server");
    await a.page.goto(base + "/#/profile");
    await a.page
      .getByRole("button", { name: "Edit profile", exact: true })
      .click();
    await dialog.getByLabel("Research", { exact: true }).check();
    await dialog
      .getByLabel("Experience level", { exact: true })
      .selectOption("Advanced");
    const profileSaved = a.page.waitForResponse(
      (r) =>
        r.url().includes("/api/actions") && r.request().method() === "POST",
    );
    await dialog.getByLabel("First name", { exact: true }).fill("Luka");
    await dialog.getByLabel("Last name", { exact: true }).fill("Petrović");
    await dialog
      .getByRole("button", { name: "Save profile", exact: true })
      .click();
    await profileSaved;
    expect(
      (await snapshot(a)).people.find((x) => x.id === "luka").preferences.level,
    ).toBe("Advanced");
    pass("Private discovery preferences persist from the profile form");
    const org = await actor("mila", "organizer");
    await org.page.goto(base + "/#/organizer");
    await org.page
      .getByRole("button", { name: "Create event", exact: true })
      .click();
    const editor = org.page.locator("md-dialog");
    await editor
      .getByLabel("Event type", { exact: true })
      .selectOption("meetup");
    await expect(editor.getByLabel("Minimum team")).toHaveCount(0);
    await editor
      .getByLabel("Registration", { exact: true })
      .selectOption("automatic");
    await editor
      .getByLabel("Format", { exact: true })
      .selectOption("In person");
    await editor.getByLabel("Event name").fill("New Research Web Meetup");
    await editor
      .getByLabel("Theme", { exact: true })
      .fill("Web apps for research");
    await editor
      .getByLabel("Description", { exact: true })
      .fill(
        "Fictional verification event: learning about accessible research tools.",
      );
    await editor
      .getByLabel("Venue", { exact: true })
      .fill("Fictional university lab");
    await editor.getByLabel("Event topics", { exact: true }).fill("Web apps");
    await editor.getByLabel("Skills practiced", { exact: true }).fill("React");
    await editor.getByLabel("Learning", { exact: true }).check();
    const createdResponse = org.page.waitForResponse(
      (r) =>
        r.url().includes("/api/actions") && r.request().method() === "POST",
    );
    await editor
      .getByRole("button", { name: "Create event", exact: true })
      .click();
    const created = await (await createdResponse).json();
    expect(created.error).toBeUndefined();
    await a.page.goto(base + "/#/events?view=for-you");
    await a.page.reload();
    await expect(
      a.page.getByRole("heading", { name: "New Research Web Meetup" }),
    ).toBeVisible();
    const s = await snapshot(a);
    expect(
      s.notifications.filter(
        (n) => n.eventId === created.createdId && n.personId === "luka",
      ),
    ).toHaveLength(1);
    await a.page.getByRole("button", { name: /^Notifications/ }).click();
    await expect(
      a.page.locator("md-dialog").getByRole("button", {
        name: /A new event for you New Research Web Meetup/,
      }),
    ).toBeVisible();
    await a.page
      .locator("md-dialog")
      .getByRole("button", { name: "Done", exact: true })
      .click();
    const unrelated = await actor("teo");
    expect(
      (await snapshot(unrelated)).notifications.some(
        (n) => n.eventId === created.createdId,
      ),
    ).toBe(false);
    pass(
      "Organizer publishes meetup; matching user receives notice across sessions",
    );
    await command(
      org,
      {
        type: "UPDATE_EVENT",
        eventId: created.createdId,
        changes: { theme: "Updated research program" },
      },
      "organizer",
    );
    expect(
      (await snapshot(a)).notifications.filter(
        (n) => n.eventId === created.createdId,
      ),
    ).toHaveLength(1);
    pass("Editing a published event does not repeat the notice");
  }
  expect(errors).toEqual([]);
  pass("No browser runtime errors");
  fs.writeFileSync(
    readOnly
      ? "artifacts/events/public-verification.json"
      : "artifacts/events/verification.json",
    JSON.stringify(
      { base, readOnly, checks, errors, verifiedAt: new Date().toISOString() },
      null,
      2,
    ),
  );
} finally {
  await Promise.all(contexts.map((c) => c.close()));
  await browser.close();
}
