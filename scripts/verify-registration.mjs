import { chromium, expect } from "@playwright/test";
import { createSeedState } from "../src/seed.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

// Isolated browser contract check. Firebase responses are intercepted;
// this does not create a cloud user or claim live Firebase connectivity.
const base =
  process.env.GEVENTS_URL ?? process.env.GDEV_URL ?? "http://127.0.0.1:5290";
const cached =
  "C:/Users/urosd/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe";
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(cached) ? { executablePath: cached } : {}),
});
const checks = [];
const errors = [];
await mkdir("artifacts/registration", { recursive: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    let registrations = 0;
    let savedNames = false;
    let stateRequests = 0;
    const now = Math.floor(Date.now() / 1000);
    const token =
      [
        { alg: "RS256", typ: "JWT" },
        {
          aud: "demo-gevents",
          iss: "https://securetoken.google.com/demo-gevents",
          sub: "real-user",
          user_id: "real-user",
          iat: now,
          exp: now + 3600,
          auth_time: now,
          email: "builder@example.com",
          firebase: { sign_in_provider: "password", identities: {} },
        },
      ]
        .map((value) =>
          Buffer.from(JSON.stringify(value)).toString("base64url"),
        )
        .join(".") + ".signature";
    await page.route(
      "https://identitytoolkit.googleapis.com/**",
      async (route) => {
        const url = route.request().url();
        if (url.includes("accounts:signUp")) registrations++;
        await route.fulfill({
          json: {
            localId: "real-user",
            email: "builder@example.com",
            displayName: "Builder",
            idToken: token,
            refreshToken: "test-refresh-token",
            expiresIn: "3600",
            users: [
              {
                localId: "real-user",
                email: "builder@example.com",
                displayName: "Builder",
                providerUserInfo: [
                  { providerId: "password", email: "builder@example.com" },
                ],
              },
            ],
          },
        });
      },
    );
    await page.route("https://securetoken.googleapis.com/**", (route) =>
      route.fulfill({
        json: {
          access_token: token,
          id_token: token,
          token_type: "Bearer",
          refresh_token: "test-refresh-token",
          expires_in: "3600",
          user_id: "real-user",
          project_id: "demo-gevents",
        },
      }),
    );
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/config")
        return route.fulfill({
          json: {
            mode: "firebase",
            firebase: {
              apiKey: "local-test-key",
              authDomain: "demo-gevents.firebaseapp.com",
              projectId: "demo-gevents",
              appId: "local-test-app",
            },
          },
        });
      if (path === "/api/state") {
        stateRequests++;
        expect(route.request().headers().authorization).toBe("Bearer " + token);
        if (stateRequests === 1)
          return route.fulfill({
            status: 500,
            json: { error: "Test storage temporarily unavailable" },
          });
        const state = createSeedState();
        state.currentPersonId = "real-user";
        state.people.push({
          ...state.people[0],
          id: "real-user",
          name: "Builder",
          ...(savedNames ? { first_name: "Builder", last_name: "Tester" } : {}),
          skills: [],
          interests: [],
          bio: "",
          preferences: undefined,
        });
        return route.fulfill({ json: { state, organizer: false } });
      }
      if (path === "/api/actions") {
        expect(route.request().headers().authorization).toBe("Bearer " + token);
        const action = route.request().postDataJSON();
        expect(action.changes).toEqual({
          first_name: "Builder",
          last_name: "Tester",
        });
        const state = createSeedState();
        state.currentPersonId = "real-user";
        state.people.push({
          ...state.people[0],
          id: "real-user",
          name: "Builder",
          first_name: "Builder",
          last_name: "Tester",
          skills: [],
          interests: [],
          bio: "",
          preferences: undefined,
        });
        savedNames = true;
        return route.fulfill({ json: { state, organizer: false } });
      }
      return route.fulfill({
        status: 404,
        json: { error: "Unexpected test API request" },
      });
    });
    await page.goto(base);
    await page
      .getByRole("button", { name: "New here? Create an account" })
      .click();
    await page.getByLabel("First name", { exact: true }).fill("Builder");
    await page.getByLabel("Last name", { exact: true }).fill("Tester");
    await page
      .getByLabel("Email address", { exact: true })
      .fill("builder@example.com");
    await page
      .getByLabel("Password", { exact: true })
      .fill("test-password-only");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `artifacts/registration/signup-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Finish signing in" }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toContainText(
      "Test storage temporarily unavailable",
    );
    await page.getByRole("button", { name: "Retry connection" }).click();
    await expect(
      page.getByRole("heading", { name: "Hey, Builder" }),
    ).toBeVisible();
    expect(registrations).toBe(1);
    expect(stateRequests).toBe(2);
    expect(savedNames).toBe(true);
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("gevents-pending-registration-names"),
      ),
    ).toBeNull();
    await expect(
      page.getByRole("button", { name: "Open demo controls" }),
    ).toHaveCount(0);
    checks.push(
      `${width}px: registration, API failure and retry, one Auth account, no demo controls, no overflow`,
    );
    await context.close();
  }
  expect(errors).toEqual([]);
  await writeFile(
    "artifacts/registration/verification.json",
    JSON.stringify(
      {
        firebase: "intercepted responses; no live cloud access",
        checks,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}
