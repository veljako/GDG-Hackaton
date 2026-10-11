// Run with: node --import tsx scripts/verify-no-suitable-event.mjs
// Isolated loopback API, in-memory fictional profiles, no Firebase or live service.
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createApi } from "../server/http.ts";
import { createSeedState } from "../src/seed.ts";

const state = createSeedState();
state.events = state.events.slice(0, 2).map((event, index) => ({
  ...event,
  id: index ? "web" : "ai",
  title: index ? "Web development workshop" : "Machine learning workshop",
  date: "2099-01-01",
  endDate: "2099-01-01",
  deadline: "2099-01-01",
  status: "open",
  publicationStatus: "approved",
  kind: "workshop",
  format: "Online",
  topics: [index ? "Web apps" : "Machine learning"],
  tags: [index ? "Web apps" : "Machine learning"],
  eligibility: {},
  audience: {
    skills: [index ? "React" : "Python"],
    taughtSkills: [],
    goals: ["Learning"],
    roles: ["Participant"],
    levels: [],
  },
}));
for (const key of [
  "teams",
  "applications",
  "invitations",
  "notifications",
  "connections",
])
  state[key] = [];
state.people = state.people
  .filter((person) => ["luka", "marko"].includes(person.id))
  .map((person) => ({
    ...person,
    interests: [person.id === "luka" ? "Biology" : "Machine learning"],
    skills: [person.id === "luka" ? "Microscopy" : "Python"],
    learningSkills: [],
    preferences: {
      goals: ["Learning"],
      kinds: ["workshop"],
      formats: ["Online"],
      location: "",
      level: "Beginner",
      notify: false,
    },
  }));
const server = createApi({
  mode: "demo",
  publicConfig: null,
  staticDirectory: resolve("dist"),
  repository: {
    read: async () => structuredClone(state),
    update: async () => {
      throw new Error("Read-only browser fixture");
    },
  },
  matchingClient: {
    call: async (operation, actor) => ({
      model: "browser-fixture-only",
      results: state.events.map((event) => ({
        eventId: event.id,
        similarity:
          operation === "recommend_events" &&
          actor === "marko" &&
          event.id === "ai"
            ? 0.63
            : 0.3,
        reasons: ["Local browser fixture"],
      })),
    }),
  },
});
await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
const base = `http://127.0.0.1:${server.address().port}`;
const output = resolve(".runtime/no-suitable-event-browser");
await mkdir(output, { recursive: true });
const executablePath =
  "C:/Users/urosd/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe";
let browser;
const errors = [],
  checks = [];
try {
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(executablePath) ? { executablePath } : {}),
  });
  for (const width of [1440, 390]) {
    for (const personId of ["luka", "marko"]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        reducedMotion: "reduce",
      });
      await context.route("**/*", (route) =>
        new URL(route.request().url()).origin === base
          ? route.continue()
          : route.abort(),
      );
      const login = await context.request.post(`${base}/api/demo-session`, {
        data: { personId, mode: "attendee" },
      });
      expect(login.ok()).toBe(true);
      const { token } = await login.json();
      await context.addInitScript((token) => {
        sessionStorage.setItem("gevents-api-session", token);
        sessionStorage.setItem("gevents-view", "attendee");
      }, token);
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${base}/#/`);
      const picks = page.locator(".home-picks");
      await expect(
        picks.getByText("Picked for you", { exact: true }),
      ).toBeVisible();
      await expect(picks.locator(".event-card")).toHaveCount(
        personId === "luka" ? 0 : 1,
      );
      if (personId === "luka") {
        await expect(
          picks.getByText("No suitable event right now", { exact: true }),
        ).toBeVisible();
        await page.screenshot({
          path: `${output}/home-empty-${width}.png`,
          fullPage: true,
        });
        await picks.getByRole("button", { name: "Explore all events" }).click();
        await expect(page.locator(".event-card")).toHaveCount(2);
      }
      checks.push(
        `${width}/${personId}: home picks never pad unrelated events`,
      );
      await page.goto(`${base}/#/events?view=for-you`);
      await expect(page.locator(".event-card")).toHaveCount(
        personId === "luka" ? 0 : 1,
      );
      const responsePromise = page.waitForResponse((response) =>
        response.url().includes("/api/matching/recommendations"),
      );
      await page
        .getByRole("button", { name: "Find semantic recommendations" })
        .click();
      const response = await responsePromise;
      expect(response.ok()).toBe(true);
      const matching = await response.json();
      expect(matching.source).toBe("semantic");
      expect(matching.outcome).toBe(
        personId === "luka" ? "no_suitable_event" : "matched",
      );
      await expect(page.locator(".event-card")).toHaveCount(
        personId === "luka" ? 0 : 1,
      );
      if (personId === "luka") {
        await expect(
          page
            .getByRole("status")
            .filter({ hasText: "No suitable event right now" }),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "No suitable event right now" }),
        ).toBeVisible();
        await page.screenshot({
          path: `${output}/for-you-empty-${width}.png`,
          fullPage: true,
        });
      } else {
        await expect(
          page.getByRole("heading", { name: "Machine learning workshop" }),
        ).toBeVisible();
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      checks.push(
        `${width}/${personId}: semantic outcome and rendered recommendations agree`,
      );
      await page
        .getByRole("button", { name: "All events", exact: true })
        .click();
      await expect(page.locator(".event-card")).toHaveCount(2);
      await page.getByRole("button", { name: "Find semantic matches" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "2 matches" }),
      ).toBeVisible();
      await expect(page.locator(".event-card")).toHaveCount(2);
      checks.push(
        `${width}/${personId}: all-event browsing and semantic search retain weak results`,
      );
      await context.close();
    }
  }
  expect(errors).toEqual([]);
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        checks,
        errors,
        firebase: "unused",
        semanticScores: "Browser fixtures; real model evaluation is separate",
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS ${checks.length} desktop/mobile browser checks; no page errors; Firebase unused.`,
  );
} finally {
  await browser?.close();
  await new Promise((closed) => server.close(closed));
}
