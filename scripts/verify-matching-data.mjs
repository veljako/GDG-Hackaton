// Mutating persistence checks for a dedicated local demo only. No Firebase writes.
import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
const base = process.env.GEVENTS_URL ?? "http://127.0.0.1:5194";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname))
  throw Error("Matching persistence checks require a dedicated local demo.");
const cached =
  "C:/Users/urosd/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe";
const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(cached) ? { executablePath: cached } : {}),
});
const checks = [],
  errors = [];
fs.mkdirSync(".runtime/matching-data", { recursive: true });
async function actor(personId, mode, width) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    reducedMotion: "reduce",
  });
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
  const state = async () =>
    (
      await (
        await context.request.get(base + "/api/state", {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).json()
    ).state;
  return { context, page, state };
}
async function overflow(page, width) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(width);
}
async function save(page, dialog, name) {
  const response = page.waitForResponse(
    (r) => r.url().includes("/api/actions") && r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name, exact: true }).click();
  expect((await (await response).json()).error).toBeUndefined();
  await expect(dialog).not.toBeVisible();
}
try {
  for (const width of [1440, 390]) {
    const org = await actor("mila", "organizer", width);
    const user = await actor("luka", "attendee", width);
    try {
      await org.page.goto(base + "/#/organizer");
      await org.page
        .getByRole("button", { name: "Create event", exact: true })
        .click();
      const dialog = org.page.locator("md-dialog");
      await dialog
        .getByLabel("Event type", { exact: true })
        .selectOption("workshop");
      const title = `Matching workshop ${width} ${Date.now()}`;
      for (const [label, value] of [
        ["Event name", title],
        ["Theme", "Beginner AI"],
        [
          "Description",
          "An introductory workshop teaching Python for climate research.",
        ],
        ["Venue", "Learning lab"],
        ["Event topics", "AI, Climate"],
        ["Country", "Serbia"],
        ["Event languages", "English, Serbian"],
        ["Ticket price", "25"],
        ["Price currency", "EUR"],
        ["Skills practiced", "Collaboration"],
        ["Skills taught", "Python"],
        ["Prerequisite skills", "Reading"],
        ["Minimum age", "16"],
        ["Maximum age", "100"],
        ["Earliest birth year", "1900"],
        ["Latest birth year", "2010"],
      ])
        await dialog.getByLabel(label, { exact: true }).fill(value);
      await dialog.getByLabel("Format", { exact: true }).selectOption("Hybrid");
      await dialog.getByLabel("Learning", { exact: true }).check();
      await dialog.locator('input[name="seniorities"][value="Junior"]').check();
      await dialog.locator('input[name="statuses"][value="Student"]').check();
      await dialog
        .getByLabel("Earliest birth year", { exact: true })
        .fill("2011");
      await dialog
        .getByRole("button", { name: "Create event", exact: true })
        .click();
      await expect(dialog.getByRole("alert")).toContainText("must not exceed");
      await dialog
        .getByLabel("Earliest birth year", { exact: true })
        .fill("1900");
      await overflow(org.page, width);
      await org.page.screenshot({
        path: `.runtime/matching-data/organizer-${width}.png`,
        fullPage: true,
      });
      const response = org.page.waitForResponse(
        (r) =>
          r.url().includes("/api/actions") && r.request().method() === "POST",
      );
      await dialog
        .getByRole("button", { name: "Create event", exact: true })
        .click();
      const result = await (await response).json();
      expect(result.error).toBeUndefined();
      const id = result.createdId;
      let event = (await org.state()).events.find((e) => e.id === id);
      expect(event).toMatchObject({
        matchingVersion: 2,
        kind: "workshop",
        format: "Hybrid",
        topics: ["AI", "Climate"],
        country: "Serbia",
        languages: ["English", "Serbian"],
        price: { amount: 25, currency: "EUR" },
        audience: {
          skills: ["Collaboration"],
          taughtSkills: ["Python"],
          goals: ["Learning"],
          levels: [],
        },
        eligibility: {
          requiredSkills: ["Reading"],
          seniorities: ["Junior"],
          statuses: ["Student"],
          minAge: 16,
          maxAge: 100,
          minBirthYear: 1900,
          maxBirthYear: 2010,
        },
      });
      await org.page
        .getByRole("button", { name: "Edit event", exact: true })
        .click();
      await expect(
        dialog.getByLabel("Skills taught", { exact: true }),
      ).toHaveValue("Python");
      await expect(
        dialog.getByLabel("Earliest birth year", { exact: true }),
      ).toHaveValue("1900");
      await dialog
        .getByLabel("Skills taught", { exact: true })
        .fill("Python, Data visualization");
      await dialog.getByLabel("Ticket price", { exact: true }).fill("");
      await dialog.getByLabel("Minimum age", { exact: true }).fill("");
      await save(org.page, dialog, "Save changes");
      event = (await org.state()).events.find((e) => e.id === id);
      expect(event.price).toBeNull();
      expect(event.eligibility.minAge).toBeNull();
      expect(event.audience.taughtSkills).toEqual([
        "Python",
        "Data visualization",
      ]);
      await user.page.goto(base + `/#/events/${id}`);
      await expect(
        user.page.getByRole("heading", { name: "Skills taught", exact: true }),
      ).toBeVisible();
      await expect(
        user.page.getByText("Prerequisite skills: Reading", { exact: true }),
      ).toBeVisible();
      await overflow(user.page, width);
      await user.page.screenshot({
        path: `.runtime/matching-data/detail-${width}.png`,
        fullPage: true,
      });
      await user.page
        .getByRole("button", { name: "Register for event", exact: true })
        .click();
      const admission = user.page.locator("md-dialog");
      await expect(
        admission.getByRole("button", {
          name: /Send application|Confirm registration/,
        }),
      ).toBeDisabled();
      await expect(
        admission.getByText("Required skill: Reading.", { exact: true }),
      ).toBeVisible();
      await admission
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await user.page.goto(base + "/#/profile");
      await user.page
        .getByRole("button", { name: "Edit profile", exact: true })
        .click();
      const profile = user.page.locator("md-dialog");
      for (const [label, value] of [
        ["First name", "Luka"],
        ["Last name", "Petrović"],
        ["Skills you want to learn", "Python, Research"],
        ["Country", "Serbia"],
        ["Exact birth date", "2000-06-15"],
        ["Maximum event budget", "0"],
        ["Budget currency", "EUR"],
      ])
        await profile.getByLabel(label, { exact: true }).fill(value);
      await overflow(user.page, width);
      await user.page.screenshot({
        path: `.runtime/matching-data/profile-${width}.png`,
        fullPage: true,
      });
      await save(user.page, profile, "Save profile");
      let person = (await user.state()).people.find((p) => p.id === "luka");
      expect(person).toMatchObject({
        learningSkills: ["Python", "Research"],
        country: "Serbia",
        birth_date: "2000-06-15",
        birth_year: 2000,
        preferences: { maxPrice: { amount: 0, currency: "EUR" } },
      });
      await user.page
        .getByRole("button", { name: "Edit profile", exact: true })
        .click();
      await expect(
        profile.getByLabel("Skills you want to learn", { exact: true }),
      ).toHaveValue("Python, Research");
      await profile
        .getByLabel("Maximum event budget", { exact: true })
        .fill("");
      await profile.getByLabel("Exact birth date", { exact: true }).fill("");
      await save(user.page, profile, "Save profile");
      person = (await user.state()).people.find((p) => p.id === "luka");
      expect(person.birth_date).toBeNull();
      expect(person.preferences.maxPrice).toBeNull();
      checks.push(
        `${width}px event create/edit round-trip, blank numeric nulls, profile learning/date/budget, details, no overflow`,
      );
      console.log("PASS", checks.at(-1));
    } finally {
      await org.context.close();
      await user.context.close();
    }
  }
  expect(errors).toEqual([]);
  fs.mkdirSync(".runtime/matching-data", { recursive: true });
  fs.writeFileSync(
    ".runtime/matching-data/browser-verification.json",
    JSON.stringify(
      { base, checks, errors, verifiedAt: new Date().toISOString() },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
