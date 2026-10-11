import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import { chooseFilter } from "./filter-test-utils.mjs";
const base =
  process.env.GEVENTS_URL ?? process.env.GDEV_URL ?? "http://127.0.0.1:5191";
const cached =
  "C:/Users/urosd/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe";
const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(cached) ? { executablePath: cached } : {}),
});
const errors = [];
const checks = [];
const contexts = [];
const record = (name) => {
  checks.push(name);
  console.log("PASS", name);
};
async function actor(personId, mode = "attendee", mobile = false) {
  const context = await browser.newContext({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  contexts.push(context);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole("heading", { name: "Hey, Luka" }).waitFor();
  await page
    .getByRole("button", { name: "Open demo controls", exact: true })
    .click();
  const dialog = page.locator("md-dialog");
  if (personId !== "luka") {
    const pending = page.waitForResponse(
      (r) =>
        r.url().includes("/api/demo-session") &&
        r.request().method() === "POST",
    );
    await page
      .getByLabel("Demo person", { exact: true })
      .selectOption(personId);
    await pending;
    await expect(page.locator(".backend-saving")).toHaveCount(0);
  }
  if (mode === "organizer") {
    const pending = page.waitForResponse(
      (r) =>
        r.url().includes("/api/demo-session") &&
        r.request().method() === "POST",
    );
    await dialog
      .getByRole("button", {
        name: "Organizer Host and review applications",
        exact: true,
      })
      .click();
    await pending;
    await expect(page.locator(".backend-saving")).toHaveCount(0);
  }
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  return page;
}
async function state(page) {
  return page.evaluate(
    async () =>
      (
        await (
          await fetch(
            "/api/state?mode=" +
              (sessionStorage.getItem("gevents-view") ?? "attendee"),
            {
              headers: {
                Authorization:
                  "Bearer " + sessionStorage.getItem("gevents-api-session"),
              },
            },
          )
        ).json()
      ).state,
  );
}
async function actionClick(page, locator) {
  const pending = page.waitForResponse(
    (r) => r.url().includes("/api/actions") && r.request().method() === "POST",
  );
  await locator.click();
  const response = await pending;
  expect(response.status()).toBe(200);
  await expect(page.locator(".backend-saving")).toHaveCount(0);
}
try {
  expect((await (await fetch(base + "/api/config")).json()).mode).toBe("demo");
  // Reset only the explicit target demo; callers should use a dedicated local data file.
  const login = await (
    await fetch(base + "/api/demo-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId: "luka", mode: "organizer" }),
    })
  ).json();
  const reset = await fetch(base + "/api/actions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + login.token,
    },
    body: JSON.stringify({ type: "RESET" }),
  });
  expect(reset.status).toBe(200);
  const luka = await actor("luka");
  const zarko = await actor("zarko", "attendee", true);
  const organizer = await actor("luka", "organizer");
  await luka.goto(base + "/#/teams/team-4");
  await luka
    .getByRole("button", { name: "Invite a teammate", exact: true })
    .click();
  await luka.getByLabel("Find an invitee").fill("Žarko");
  await luka.locator(".invite-choice").filter({ hasText: "Žarko" }).click();
  await actionClick(
    luka,
    luka
      .locator("md-dialog")
      .getByRole("button", { name: "Send invitation", exact: true }),
  );
  await expect(luka.locator("md-dialog")).toHaveCount(0);
  await zarko.goto(base + "/#/activity");
  await expect(
    zarko.getByRole("button", { name: "Accept invitation", exact: true }),
  ).toBeVisible();
  record("Invitation appears in a separate mobile browser session");
  await actionClick(
    zarko,
    zarko.getByRole("button", { name: "Accept invitation", exact: true }),
  );
  await expect
    .poll(async () =>
      (await state(luka)).teams
        .find((t) => t.id === "team-4")
        .memberIds.includes("zarko"),
    )
    .toBe(true);
  expect(
    (await state(zarko)).applications.find(
      (a) => a.personId === "zarko" && a.eventId === "gdg-belgrade",
    ).status,
  ).toBe("pending");
  await expect(luka.locator("main")).toContainText("Žarko");
  record(
    "Acceptance synchronizes across browsers while admission stays pending",
  );
  await chooseFilter(organizer, "Manage event", "gdg-belgrade");
  await expect(
    organizer.locator(".application-row").filter({ hasText: "Žarko Nikolić" }),
  ).toBeVisible();
  await organizer
    .locator(".application-row")
    .filter({ hasText: "Žarko Nikolić" })
    .click();
  await actionClick(
    organizer,
    organizer
      .locator("md-dialog")
      .getByRole("button", { name: "Accept applicant", exact: true }),
  );
  await expect
    .poll(
      async () =>
        (await state(zarko)).applications.find(
          (a) => a.personId === "zarko" && a.eventId === "gdg-belgrade",
        ).status,
    )
    .toBe("accepted");
  await expect(zarko.locator("main")).toContainText("Accepted");
  record("Organizer approval reaches the attendee without manual refresh");
  await luka.goto(base + "/#/profile");
  await luka.getByRole("button", { name: "Edit profile", exact: true }).click();
  await luka.getByLabel("First name", { exact: true }).fill("Luka");
  await luka.getByLabel("Last name", { exact: true }).fill("Petrović");
  await luka
    .getByLabel("Headline", { exact: true })
    .fill("Backend-connected builder");
  await actionClick(
    luka,
    luka
      .locator("md-dialog")
      .getByRole("button", { name: "Save profile", exact: true }),
  );
  await luka.reload();
  await expect(luka.locator(".own-profile")).toContainText(
    "Backend-connected builder",
  );
  expect(
    await luka.evaluate(() => localStorage.getItem("gevents-demo-v1")),
  ).toBeNull();
  record("Profile persists on the server without a browser-state copy");
  await luka.getByRole("button", { name: "Edit profile", exact: true }).click();
  await luka.getByLabel("Headline", { exact: true }).fill("Must not be saved");
  await luka.route("**/api/actions*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Verification: backend unavailable" }),
    }),
  );
  const failed = luka.waitForResponse((r) => r.url().includes("/api/actions"));
  await luka
    .locator("md-dialog")
    .getByRole("button", { name: "Save profile", exact: true })
    .click();
  await failed;
  await expect(luka.locator("md-dialog")).toBeVisible();
  expect((await state(luka)).people.find((p) => p.id === "luka").title).toBe(
    "Backend-connected builder",
  );
  await luka.unroute("**/api/actions*");
  await luka
    .locator("md-dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  record("Failed save keeps the form open and does not invent success");
  const olderSnapshot = await state(luka);
  let stateRequests = 0;
  let releaseRetry;
  const heldRetry = new Promise((resolve) => {
    releaseRetry = resolve;
  });
  await luka.route("**/api/state*", async (route) => {
    stateRequests++;
    if (stateRequests === 1)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Verification: refresh unavailable" }),
      });
    if (stateRequests === 2) {
      releaseRetry(route);
      return;
    }
    return route.continue();
  });
  await expect(luka.locator(".backend-status")).toContainText(
    "Verification: refresh unavailable",
  );
  await luka
    .locator(".backend-status")
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  const retryRoute = await heldRetry;
  await luka.getByRole("button", { name: "Edit profile", exact: true }).click();
  await luka
    .getByLabel("Headline", { exact: true })
    .fill("Saved after a delayed retry");
  await actionClick(
    luka,
    luka
      .locator("md-dialog")
      .getByRole("button", { name: "Save profile", exact: true }),
  );
  const oldResponse = luka.waitForResponse((r) =>
    r.url().includes("/api/state"),
  );
  await retryRoute.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ state: olderSnapshot, organizer: false }),
  });
  await (await oldResponse).finished();
  await luka.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await expect(luka.locator(".own-profile")).toContainText(
    "Saved after a delayed retry",
  );
  await luka.unroute("**/api/state*");
  record("A delayed retry cannot overwrite a newer saved profile");
  for (const page of [luka, zarko]) {
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  fs.mkdirSync("artifacts", { recursive: true });
  await luka.screenshot({
    path: "artifacts/backend-desktop.png",
    fullPage: true,
  });
  await zarko.screenshot({
    path: "artifacts/backend-mobile.png",
    fullPage: true,
  });
  record("Desktop and mobile have no horizontal overflow");
  // Exercise first-launch UI separately; this does not claim a live Firebase test.
  const empty = await browser.newContext();
  contexts.push(empty);
  const emptyPage = await empty.newPage();
  emptyPage.on("pageerror", (e) => errors.push(e.message));
  const seed = await state(luka);
  const blank = {
    ...seed,
    people: [seed.people.find((p) => p.id === "luka")],
    events: [],
    teams: [],
    applications: [],
    invitations: [],
    connections: [],
    notifications: [],
    mode: "organizer",
  };
  await empty.route("**/api/demo-session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        token: "empty-ui-test",
        state: blank,
        organizer: true,
      }),
    }),
  );
  await empty.route("**/api/state*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ state: blank, organizer: true }),
    }),
  );
  await emptyPage.goto(base + "/#/organizer");
  await expect(
    emptyPage.getByRole("heading", {
      name: "Your first event starts here",
    }),
  ).toBeVisible();
  await emptyPage
    .getByRole("button", { name: "Create event", exact: true })
    .click();
  await expect(emptyPage.locator("md-dialog")).toBeVisible();
  record("An empty workspace can open the first-event form");
  expect(errors).toEqual([]);
  fs.writeFileSync(
    "artifacts/backend-verification.json",
    JSON.stringify(
      {
        base,
        checks,
        errors,
        cloudFirebaseTested: false,
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
} catch (error) {
  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync(
    "artifacts/backend-verification-failure.json",
    JSON.stringify({ checks, errors, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  await Promise.all(contexts.map((c) => c.close()));
  await browser.close();
}
