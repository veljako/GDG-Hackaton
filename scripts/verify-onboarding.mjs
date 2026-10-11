// Isolated UI fixtures: this does not create Firebase users or invoke Gemma.
import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
const base = process.env.GEVENTS_URL ?? "http://127.0.0.1:5180";
const cached =
  "C:/Users/urosd/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe";
const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(cached) ? { executablePath: cached } : {}),
});
const errors = [];
fs.mkdirSync(".runtime/onboarding", { recursive: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    let person = {
      id: "fixture",
      name: "Alex Review",
      first_name: "Alex",
      last_name: "Review",
      email: "alex@example.test",
      title: "",
      city: "",
      school: "",
      bio: "",
      skills: [],
      interests: [],
      roles: [],
      experience: "",
      color: "blue",
      avatar: "AR",
      lookingForTeam: false,
      linkedin: "",
      kaggle: "",
      updated_at: null,
      onboarding: { version: 1, status: "required", completed_at: null },
    };
    let draft = null;
    let extracted = false;
    let failExtraction = true;
    let completed = false;
    const snapshot = () => ({
      state: {
        version: 1,
        people: [person],
        events: [],
        teams: [],
        applications: [],
        invitations: [],
        connections: [],
        notifications: [],
        currentPersonId: "fixture",
        mode: "attendee",
      },
      organizer: false,
    });
    const proposal = {
      proposal: {
        first_name: "Alex",
        last_name: "Review",
        title: "Student developer",
        city: "Belgrade",
        bio: "I build community tools.",
        skills: ["TypeScript"],
        education: [],
        work_experience: [],
      },
      extraction_hash: "fixture-hash",
      expected_profile_updated_at: null,
      results: [],
    };
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace("/api/", "");
      const method = route.request().method();
      let status = 200;
      let result;
      if (path === "config") result = { mode: "demo", firebase: null };
      else if (path === "demo-session")
        result = { ...snapshot(), token: "fixture-session" };
      else if (path === "state") result = snapshot();
      else if (path === "cv") {
        person = {
          ...person,
          cv_document: {
            storage_path: "private/fixture/cv.pdf",
            filename: "background.pdf",
            content_type: "application/pdf",
            size_bytes: 100,
            uploaded_at: new Date().toISOString(),
            extraction_status: "not_started",
            extracted_at: null,
          },
        };
        result = { ...snapshot(), message: "CV saved." };
      } else if (path === "matching/cv/proposal") {
        status = extracted ? 200 : 404;
        result = extracted ? proposal : { error: "No extraction yet." };
      } else if (path === "matching/cv/extract") {
        if (failExtraction) {
          failExtraction = false;
          status = 409;
          result = {
            error: "Your CV changed during extraction. Retry extraction.",
          };
        } else {
          extracted = true;
          result = proposal;
        }
      } else if (path === "onboarding/draft" && method === "GET")
        result = { draft };
      else if (path === "onboarding/draft") {
        const input = route.request().postDataJSON();
        expect(input.expected_draft_version).toBe(draft?.version ?? null);
        draft = {
          version: (draft?.version ?? 0) + 1,
          cv_path: person.cv_document.storage_path,
          extraction_hash: input.expected_extraction_hash,
          expected_profile_updated_at: input.expected_profile_updated_at,
          profile: input.profile,
          step: input.step,
        };
        result = { draft };
      } else if (path === "onboarding/complete") {
        const input = route.request().postDataJSON();
        expect(input.expected_draft_version).toBe(draft.version);
        expect(input.profile.title).toBe("Corrected project role");
        expect(input.profile.skills).toEqual([]);
        expect(input.profile.learningSkills).toEqual(["Python", "Research"]);
        person = {
          ...person,
          ...input.profile,
          onboarding: {
            version: 1,
            status: "completed",
            completed_at: new Date().toISOString(),
            matching_sync: "pending",
          },
        };
        completed = true;
        draft = null;
        result = {
          ...snapshot(),
          message: "Profile saved.",
          matching_sync: "unavailable",
        };
        // The canonical commit can appear in polling before matching delivery responds.
        await new Promise((resolve) => setTimeout(resolve, 3500));
      } else if (path === "onboarding/retry-matching") {
        person.onboarding.matching_sync = "queued";
        result = { ...snapshot(), matching_sync: "queued" };
      } else {
        status = 404;
        result = { error: `Unknown fixture ${path}` };
      }
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(result),
      });
    });
    await page.goto(`${base}/#/people`);
    await expect(
      page.getByRole("heading", { name: "Bring your background" }),
    ).toBeVisible();
    await page.screenshot({
      path: `.runtime/onboarding/upload-${width}.png`,
      fullPage: true,
    });
    await expect(page.getByRole("button", { name: /Skip/ })).toHaveCount(0);
    await page.locator("input[type=file]").setInputFiles({
      name: "background.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 fixture"),
    });
    await expect(page.getByRole("alert")).toContainText(
      "CV changed during extraction",
    );
    await page.getByRole("button", { name: "Retry extraction" }).click();
    await expect(
      page.getByRole("heading", { name: "Make this profile yours" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save progress", exact: true }),
    ).toBeEnabled();
    await page
      .getByLabel("Headline or current role")
      .fill("Corrected project role");
    await page.getByLabel("Skills, separated by commas").fill("");
    await page.locator('input[name="learningSkills"]').fill("Python");
    await page.locator('input[name="country"]').fill("Serbia");
    await page.locator('input[name="birth_date"]').fill("2000-06-15");
    await page
      .getByRole("button", { name: "Add education", exact: true })
      .click();
    await page
      .getByLabel("institution", { exact: true })
      .fill("Example university");
    await page
      .getByRole("button", { name: "Save progress", exact: true })
      .click();
    await expect(page.getByRole("status").last()).toContainText("saved");
    await page.reload();
    await expect(page.getByLabel("Headline or current role")).toHaveValue(
      "Corrected project role",
    );
    await expect(page.getByLabel("institution", { exact: true })).toHaveValue(
      "Example university",
    );
    await expect(page.locator('input[name="country"]')).toHaveValue("Serbia");
    await expect(page.locator('input[name="birth_date"]')).toHaveValue(
      "2000-06-15",
    );
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(
      page.getByRole("heading", { name: "What brings you here?" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Finish setup", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("highlighted");
    await page
      .getByLabel("Topics and interests, separated by commas")
      .fill("AI, Climate");
    await page.locator('input[name="learningSkills"]').fill("Python, Research");
    await page.locator('input[name="budgetCurrency"]').fill("USD");
    await page.locator('input[name="maxPrice"]').fill("25");
    for (const name of ["Learning", "workshop", "Online", "Participant"])
      await page.getByRole("button", { name, exact: true }).click();
    await page.evaluate(
      () => (document.documentElement.dataset.theme = "dark"),
    );
    const size = await page.evaluate(() => ({
      view: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(size.scroll).toBeLessThanOrEqual(size.view);
    await page.screenshot({
      path: `.runtime/onboarding/interests-${width}-dark.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Back to review" }).click();
    await page.evaluate(
      () => (document.documentElement.dataset.theme = "light"),
    );
    await page.screenshot({
      path: `.runtime/onboarding/review-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page
      .getByRole("button", { name: "Finish setup", exact: true })
      .click();
    await expect(page.locator(".ob-shell")).toHaveCount(0);
    await expect(page.locator(".home-page")).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Profile matching status" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Retry matching", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Profile matching status" }),
    ).toHaveCount(0);
    expect(completed).toBe(true);
    expect(person.learningSkills).toEqual(["Python", "Research"]);
    expect(person.country).toBe("Serbia");
    expect(person.birth_date).toBe("2000-06-15");
    expect(person.birth_year).toBe(2000);
    expect(person.preferences.maxPrice).toEqual({
      amount: 25,
      currency: "USD",
    });
    console.log(
      `PASS ${width}px: mandatory gate, extraction retry, editable structured review, saved resume, validation, interests, completion outage, dark theme, overflow`,
    );
    await context.close();
  }
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/config", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          mode: "firebase",
          firebase: {
            apiKey: "fixture-api-key",
            authDomain: "fixture.invalid",
            projectId: "fixture-project",
            appId: "1:123:web:fixture",
          },
        }),
      }),
    );
    await page.goto(base);
    await expect(
      page.getByRole("list", { name: "Setup progress" }),
    ).toHaveCount(0);
    await expect(page.locator(".registration-hint")).toHaveCount(0);
    await expect(page.locator(".ob-google img")).toBeVisible();
    expect(
      await page
        .locator(".ob-google img")
        .evaluate((image) => image.complete && image.naturalWidth > 0),
    ).toBe(true);
    await page.screenshot({
      path: `.runtime/onboarding/login-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "New here? Create an account" })
      .click();
    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toBeEnabled();
    await expect(page.getByLabel("First name", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Last name", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
      "minlength",
      "8",
    );
    await expect(
      page.getByRole("list", { name: "Setup progress" }),
    ).toBeVisible();
    await page.screenshot({
      path: `.runtime/onboarding/account-${width}.png`,
      fullPage: true,
    });
    const size = await page.evaluate(() => ({
      view: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(size.scroll).toBeLessThanOrEqual(size.view);
    await page
      .getByRole("radio", { name: /Host with an organization/ })
      .check();
    await expect(
      page.getByRole("list", { name: "Setup progress" }),
    ).toContainText("Organization");
    await expect(
      page.getByRole("list", { name: "Setup progress" }),
    ).not.toContainText("Your CV");
    await expect(
      page.getByText("A PDF up to 5 MiB and 20 pages is required.", {
        exact: false,
      }),
    ).toHaveCount(0);
    await page.screenshot({
      path: `.runtime/onboarding/organization-signup-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Already have an account? Sign in" })
      .click();
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expect(
      page.getByRole("list", { name: "Setup progress" }),
    ).toHaveCount(0);
    await expect(page.locator(".ob-google")).toHaveCount(0);
    console.log(
      `PASS ${width}px: account form, email/Google controls, password requirement, overflow (no Firebase account created)`,
    );
    await context.close();
  }
  expect(errors).toEqual([]);
} finally {
  await browser.close();
}
