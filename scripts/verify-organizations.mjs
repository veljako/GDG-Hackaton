// Isolated browser fixtures; no accounts, cloud writes or invitation emails.
import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import { chooseFilter } from "./filter-test-utils.mjs";
const base = process.env.GEVENTS_URL ?? "http://127.0.0.1:5193";
const cached =
  "C:/Users/urosd/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe";
const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(cached) ? { executablePath: cached } : {}),
});
const errors = [];
fs.mkdirSync(".runtime/organizations", { recursive: true });
const person = {
  id: "fixture",
  name: "Alex Host",
  email: "alex@example.test",
  email_verified: true,
  title: "",
  city: "Belgrade",
  school: "",
  bio: "",
  skills: [],
  interests: [],
  roles: [],
  experience: "",
  color: "blue",
  avatar: "AH",
  lookingForTeam: false,
  linkedin: "",
  kaggle: "",
  onboarding: { version: 1, status: "required", completed_at: null },
};
const organization = {
  id: "org-fixture",
  name: "Science Society",
  website: "https://example.test",
  city: "Belgrade",
  description: "A community for research.",
  created_at: new Date().toISOString(),
};
const member = (role) => ({
  id: "member-fixture",
  organizationId: organization.id,
  personId: person.id,
  role,
  joined_at: new Date().toISOString(),
});
const event = (id, createdBy = person.id) => ({
  id,
  organizationId: organization.id,
  createdBy,
  publicationStatus: "draft",
  title: id === "own-draft" ? "Research Day" : "Colleague Draft",
  organizer: organization.name,
  kind: "meetup",
  registration: "review",
  date: "2027-05-01",
  endDate: "2027-05-01",
  deadline: "2027-04-25",
  location: "Belgrade",
  venue: "Science Hall",
  description: "Meet researchers and share ideas.",
  theme: "Science",
  tags: ["Research"],
  color: "blue",
  format: "In person",
  capacity: 60,
  minTeamSize: 1,
  maxTeamSize: 1,
  status: "draft",
  schedule: [],
});
async function existingAccountHostIntent(width) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const idToken = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ sub: person.id, aud: "fixture-project", iat: now, exp: now + 3600, email: person.email, email_verified: true })}.fixture-signature`;
  const authCalls = [];
  await page.route("https://identitytoolkit.googleapis.com/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    authCalls.push(path);
    if (path.endsWith("accounts:signInWithPassword"))
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          localId: person.id,
          email: person.email,
          displayName: person.name,
          idToken,
          refreshToken: "fixture-refresh",
          expiresIn: "3600",
          registered: true,
        }),
      });
    if (path.endsWith("accounts:lookup"))
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          users: [
            {
              localId: person.id,
              email: person.email,
              emailVerified: true,
              displayName: person.name,
              providerUserInfo: [
                {
                  providerId: "password",
                  email: person.email,
                  federatedId: person.email,
                },
              ],
            },
          ],
        }),
      });
    return route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: { message: "UNEXPECTED_FIXTURE_AUTH_REQUEST" },
      }),
    });
  });
  const emptyState = {
    version: 1,
    people: [person],
    events: [],
    teams: [],
    applications: [],
    invitations: [],
    connections: [],
    notifications: [],
    currentPersonId: person.id,
    mode: "attendee",
  };
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/", "");
    const result =
      path === "config"
        ? {
            mode: "firebase",
            firebase: {
              apiKey: "fixture-api-key",
              authDomain: "fixture.invalid",
              projectId: "fixture-project",
              appId: "1:123:web:fixture",
            },
          }
        : path === "organizations"
          ? { organizations: [], memberships: [] }
          : {
              state: emptyState,
              organizer: false,
              organizations: [],
              memberships: [],
            };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.goto(`${base}/#/`);
  await page
    .getByRole("button", { name: "Register your organization" })
    .click();
  await page
    .getByRole("button", { name: "Already have an account? Sign in" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your organization starts here" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Email address" }).fill(person.email);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Make room for your next event." }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("gevents-organization-intent"),
    ),
  ).toBe(person.id);
  expect(
    authCalls.filter((path) => path.endsWith("accounts:signInWithPassword")),
  ).toHaveLength(1);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Make room for your next event." }),
  ).toBeVisible();
  await context.close();
}
async function fixture(
  width,
  role = "member",
  joined = true,
  invite = "",
  resume = false,
) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    reducedMotion: "reduce",
  });
  if (resume)
    await context.addInitScript(() =>
      sessionStorage.setItem("gevents-organization-intent", "fixture"),
    );
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  let organizations = joined ? [organization] : [];
  let memberships = joined ? [member(role)] : [];
  let events = joined
    ? [event("own-draft"), event("other-draft", "colleague")]
    : [];
  let mode = "attendee";
  const calls = [];
  const snapshot = () => ({
    organizer: memberships.length > 0,
    organizations,
    memberships,
    state: {
      version: 1,
      people: [person],
      events: mode === "organizer" ? events : [],
      teams: [],
      applications: [],
      invitations: [],
      connections: [],
      notifications: [],
      currentPersonId: person.id,
      mode,
    },
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname.replace("/api/", ""),
      method = route.request().method();
    const body = method === "POST" ? route.request().postDataJSON() : null;
    calls.push({ path, body });
    let result,
      status = 200;
    if (path === "config") result = { mode: "demo", firebase: null };
    else if (path === "demo-session") {
      mode = body.mode;
      result = { ...snapshot(), token: "fixture-token" };
    } else if (path === "onboarding/draft") result = { draft: null };
    else if (path === "state") {
      mode = url.searchParams.get("mode") ?? mode;
      result = snapshot();
    } else if (path === "organizations" && method === "GET")
      result = { organizations, memberships };
    else if (path === "organizations" && method === "POST") {
      organizations = [{ ...organization, ...body }];
      memberships = [member("admin")];
      result = { organizations, memberships };
    } else if (path === "organizations/join") {
      expect(body.token).toBe("fixture-invite-token");
      organizations = [organization];
      memberships = [member("member")];
      events = [event("own-draft")];
      result = { organizations, memberships };
    } else if (path.endsWith("/members")) {
      expect(memberships[0].role).toBe("admin");
      result = {
        members: [
          { ...member("admin"), name: person.name, email: person.email },
        ],
      };
    } else if (path.endsWith("/invitations"))
      result = {
        invitation: {
          ...body,
          organizationId: organization.id,
          token: "fixture-invite-token",
          expires_at: "2027-01-01T12:00:00Z",
        },
      };
    else if (path === "actions") {
      const current = events.find((e) => e.id === body.eventId);
      if (body.type === "SUBMIT_EVENT_FOR_APPROVAL") {
        expect(current.createdBy).toBe(person.id);
        current.publicationStatus = "pending";
      }
      if (body.type === "REVIEW_EVENT_PUBLICATION") {
        expect(memberships[0].role).toBe("admin");
        current.publicationStatus =
          body.decision === "approve" ? "approved" : "draft";
        current.status = body.decision === "approve" ? "open" : "draft";
      }
      if (body.type === "CREATE_EVENT") {
        expect(body.event.organizationId).toBe(organization.id);
        expect(body.event.status).toBe("draft");
        expect(body.event).not.toHaveProperty("createdBy");
        events.push({
          ...body.event,
          id: "created-fixture",
          createdBy: person.id,
          publicationStatus: "draft",
        });
      }
      result = {
        ...snapshot(),
        createdId: body.type === "CREATE_EVENT" ? "created-fixture" : undefined,
      };
    } else {
      status = 404;
      result = { error: `Unhandled fixture route: ${path}` };
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.goto(
    `${base}/#/${invite ? "organizations?invite=fixture-invite-token" : ""}`,
  );
  return { context, page, calls, events };
}
try {
  for (const width of [1440, 390]) {
    await existingAccountHostIntent(width);
    const authContext = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: "reduce",
    });
    const authPage = await authContext.newPage();
    authPage.on("pageerror", (e) => errors.push(e.message));
    await authPage.route("**/api/config", (route) =>
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
    await authPage.goto(`${base}/#/organizations?invite=fixture-invite-token`);
    await authPage
      .getByRole("button", { name: "New here? Create an account" })
      .click();
    await expect(
      authPage.getByRole("radio", { name: /Host with an organization/ }),
    ).toBeChecked();
    await expect(authPage.getByText("Your CV", { exact: true })).toHaveCount(0);
    await authContext.close();
    const resume = await fixture(width, "admin", true, "", true);
    await expect(
      resume.page.getByRole("heading", {
        name: "Make room for your next event.",
      }),
    ).toBeVisible();
    await resume.page.reload();
    await expect(
      resume.page.getByRole("heading", { name: "Organization members" }),
    ).toBeVisible();
    await resume.context.close();
    person.email_verified = false;
    const unverified = await fixture(
      width,
      "member",
      false,
      "fixture-invite-token",
    );
    await expect(
      unverified.page.getByRole("heading", {
        name: "Verify your email to join",
      }),
    ).toBeVisible();
    await expect(
      unverified.page.getByRole("button", {
        name: "Join organization",
        exact: true,
      }),
    ).toBeDisabled();
    await unverified.page
      .getByRole("button", { name: "I’ve verified my email" })
      .click();
    await expect(
      unverified.page.getByText("Your email is not verified yet.", {
        exact: false,
      }),
    ).toBeVisible();
    await unverified.context.close();
    person.email_verified = true;
    const create = await fixture(width, "admin", false);
    await create.page
      .getByRole("button", { name: "Host an event with your organization" })
      .click();
    await expect(
      create.page.getByRole("heading", {
        name: "Make room for your next event.",
      }),
    ).toBeVisible();
    await create.page
      .getByRole("textbox", { name: "Organization name" })
      .fill("Science Society");
    await create.page
      .getByRole("textbox", { name: "Website (optional)" })
      .fill("https://example.test");
    await create.page
      .getByRole("textbox", { name: "City", exact: true })
      .fill("Belgrade");
    await create.page
      .getByRole("textbox", { name: "About your organization" })
      .fill("A community for research.");
    await create.page.screenshot({
      path: `.runtime/organizations/create-${width}.png`,
      fullPage: true,
    });
    await create.page
      .getByRole("button", { name: "Create organization", exact: true })
      .click();
    await expect(
      create.page.getByRole("heading", {
        name: "Your first event starts here",
      }),
    ).toBeVisible();
    await create.page.reload();
    await expect(
      create.page.getByRole("heading", {
        name: "Your first event starts here",
      }),
    ).toBeVisible();
    await create.page
      .locator("#main-content")
      .getByRole("button", { name: "Organizations", exact: true })
      .click();
    await expect(
      create.page.getByRole("heading", { name: "Organization members" }),
    ).toBeVisible();
    await create.page
      .getByRole("textbox", { name: "Colleague’s email" })
      .fill("colleague@example.test");
    await create.page
      .getByRole("button", { name: "Create invitation", exact: true })
      .click();
    await expect(
      create.page.getByRole("textbox", { name: "Invitation link" }),
    ).toHaveValue(/#\/organizations\?invite=fixture-invite-token/);
    await expect(
      create.page.getByText("No invitation email is sent.", { exact: false }),
    ).toBeVisible();
    await create.page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        configurable: true,
      }),
    );
    await create.page
      .getByRole("button", { name: "Copy invitation link" })
      .click();
    await expect(
      create.page.getByText("Select and copy the invitation link above.", {
        exact: true,
      }),
    ).toBeVisible();
    await create.page.evaluate(
      () => (document.documentElement.dataset.theme = "dark"),
    );
    await create.page.screenshot({
      path: `.runtime/organizations/admin-dark-${width}.png`,
      fullPage: true,
    });
    expect(
      await create.page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await create.context.close();
    const join = await fixture(width, "member", false, "fixture-invite-token");
    await expect(
      join.page.getByRole("textbox", { name: "Invitation token" }),
    ).toHaveValue("fixture-invite-token");
    await expect(
      join.page.getByText("Review your details", { exact: true }),
    ).toHaveCount(0);
    await join.page
      .getByRole("button", { name: "Join organization", exact: true })
      .click();
    await expect(
      join.page.getByRole("heading", { name: "Bring good people together." }),
    ).toBeVisible();
    await expect(
      join.page.getByRole("button", { name: "Approve and publish" }),
    ).toHaveCount(0);
    await join.page
      .getByRole("button", { name: "Submit for approval" })
      .click();
    await expect(
      join.page.getByText("Awaiting admin approval", { exact: true }),
    ).toBeVisible();
    await expect(
      join.page.getByRole("button", { name: "Edit event", exact: true }),
    ).toBeDisabled();
    await join.page.screenshot({
      path: `.runtime/organizations/member-pending-${width}.png`,
      fullPage: true,
    });
    await join.context.close();
    const permissions = await fixture(width, "member", true);
    await permissions.page
      .getByRole("button", { name: "Host an event with your organization" })
      .click();
    await permissions.page
      .getByRole("button", { name: "Open organizer workspace" })
      .click();
    await expect(
      permissions.page.getByRole("heading", {
        name: "Application review is managed by admins",
      }),
    ).toBeVisible();
    await chooseFilter(permissions.page, "Manage event", "other-draft");
    await expect(
      permissions.page.getByRole("button", { name: "Edit event", exact: true }),
    ).toBeDisabled();
    await expect(
      permissions.page.getByRole("button", { name: "Submit for approval" }),
    ).toHaveCount(0);
    expect(permissions.calls.some((c) => c.path.endsWith("/members"))).toBe(
      false,
    );
    await permissions.page
      .getByRole("button", { name: "Create event", exact: true })
      .click();
    await expect(
      permissions.page.getByLabel("Hosting organization"),
    ).toHaveValue(organization.id);
    await expect(
      permissions.page.getByRole("textbox", { name: "Organizer", exact: true }),
    ).toHaveAttribute("readonly", "");
    await permissions.page
      .getByRole("textbox", { name: "Event name" })
      .fill("New Draft");
    await permissions.page
      .getByLabel("Format", { exact: true })
      .selectOption("In person");
    await permissions.page
      .getByRole("textbox", { name: "Theme", exact: true })
      .fill("Research");
    await permissions.page
      .getByRole("textbox", { name: "Description", exact: true })
      .fill("Research and science together");
    await permissions.page
      .getByRole("textbox", { name: "Venue", exact: true })
      .fill("Science Hall");
    await permissions.page
      .getByRole("button", { name: "Create event", exact: true })
      .last()
      .click();
    await expect(
      permissions.page.getByRole("combobox", {
        name: "Manage event",
        exact: true,
      }),
    ).toHaveAttribute("data-value", "created-fixture");
    expect(permissions.calls.some((c) => c.body?.type === "CREATE_EVENT")).toBe(
      true,
    );
    await permissions.context.close();
    const admin = await fixture(width, "admin", true);
    admin.events[0].publicationStatus = "pending";
    await admin.page
      .getByRole("button", { name: "Host an event with your organization" })
      .click();
    await admin.page
      .getByRole("button", { name: "Open organizer workspace" })
      .click();
    await admin.page
      .getByRole("button", { name: "Approve and publish" })
      .click();
    await expect(
      admin.page.getByText("Approved", { exact: true }),
    ).toBeVisible();
    await expect(
      admin.page.getByText("Applications open", { exact: true }),
    ).toBeVisible();
    await admin.page.getByRole("button", { name: "Attend events" }).click();
    await expect(
      admin.page.getByRole("heading", { name: "Bring your background" }),
    ).toBeVisible();
    await admin.context.close();
  }
  expect(errors).toEqual([]);
  console.log(
    "Organization browser fixtures passed at desktop/mobile: create, reload, invitations, direct join, member drafting/submission, admin approval, permissions and attendee CV gating.",
  );
} finally {
  await browser.close();
}
