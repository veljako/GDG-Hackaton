import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
const base =
  process.env.GEVENTS_URL ?? process.env.GDEV_URL ?? "http://localhost:5180";
const cached =
  "C:/Users/urosd/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe";
const browser = await chromium.launch({
  headless: true,
  ...((process.env.GEVENTS_CHROMIUM ?? process.env.GDEV_CHROMIUM) ||
  fs.existsSync(cached)
    ? {
        executablePath:
          process.env.GEVENTS_CHROMIUM ?? process.env.GDEV_CHROMIUM ?? cached,
      }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
const checks = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const state = async () => {
  await expect(page.locator(".backend-saving")).toHaveCount(0);
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
};
const record = (name) => {
  checks.push(name);
  console.log("PASS", name);
};
const goto = async (path) => {
  await page.goto(`${base}/#${path}`);
  await page.locator("main h1, main .empty-state").first().waitFor();
};
const dialog = () => page.locator("md-dialog");
async function switchView(personId, mode) {
  await page
    .getByRole("button", { name: "Open demo controls", exact: true })
    .click();
  if (personId)
    await page
      .getByLabel("Demo person", { exact: true })
      .selectOption(personId);
  if (mode)
    await dialog()
      .getByRole("button", {
        name:
          mode === "organizer"
            ? "Organizer Host and review applications"
            : "Attendee Find events and teammates",
        exact: true,
      })
      .click();
  await dialog().getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog()).toHaveCount(0);
}
async function reviewApplicant(personName, eventId) {
  await switchView(undefined, "organizer");
  await page.getByLabel("Manage event").selectOption(eventId);
  await page
    .locator(".application-row")
    .filter({ hasText: personName })
    .click();
  await dialog()
    .getByRole("button", { name: "Accept applicant", exact: true })
    .click();
  await expect(dialog()).toHaveCount(0);
}
async function noOverflow(label) {
  const size = await page.evaluate(() => ({
    view: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(size.scroll, `${label}: horizontal overflow`).toBeLessThanOrEqual(
    size.view,
  );
}
try {
  expect((await (await fetch(base + "/api/config")).json()).mode).toBe("demo");
  const resetSession = await (
    await fetch(base + "/api/demo-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId: "luka", mode: "organizer" }),
    })
  ).json();
  const resetResponse = await fetch(base + "/api/actions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + resetSession.token,
    },
    body: JSON.stringify({ type: "RESET" }),
  });
  expect(resetResponse.status).toBe(200);
  await page.goto(base);
  await page.getByRole("heading", { name: "Hey, Luka" }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.title()).toBe("Home · GEvents");
  record("Correct GEvents app served");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe(
    "main-content",
  );
  expect(new URL(page.url()).hash).not.toBe("#main-content");
  record("Keyboard skip link keeps route and focuses content");
  await page.getByRole("button", { name: "Notifications, 2 unread" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog()).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Notifications, 2 unread" }),
  ).toBeFocused();
  record("Dialog Escape dismisses and restores focus");
  await goto("/teams/team-4");
  await page
    .getByRole("button", { name: "Invite a teammate", exact: true })
    .click();
  await dialog().getByLabel("Find an invitee").fill("Žarko");
  await dialog().locator(".invite-choice").filter({ hasText: "Žarko" }).click();
  await dialog()
    .getByRole("button", { name: "Send invitation", exact: true })
    .click();
  await expect(page.locator(".team-space-top")).toContainText("Confirmed team");
  let snapshot = await state();
  expect(
    snapshot.invitations.some(
      (i) =>
        i.teamId === "team-4" &&
        i.personId === "zarko" &&
        i.status === "pending",
    ),
  ).toBe(true);
  record("Any teammate can invite outsider; confirmed team stays confirmed");
  await switchView("zarko");
  await goto("/activity");
  await page
    .getByRole("button", { name: "Accept invitation", exact: true })
    .click();
  snapshot = await state();
  expect(snapshot.teams.find((t) => t.id === "team-4").memberIds).toContain(
    "zarko",
  );
  expect(
    snapshot.applications.find(
      (a) => a.personId === "zarko" && a.eventId === "gdg-belgrade",
    ).status,
  ).toBe("pending");
  record("Outsider accepts invitation and remains pending");
  await reviewApplicant("Žarko Nikolić", "gdg-belgrade");
  snapshot = await state();
  expect(
    snapshot.applications.find(
      (a) => a.personId === "zarko" && a.eventId === "gdg-belgrade",
    ).status,
  ).toBe("accepted");
  record("Organizer admission confirms new member");
  await switchView("luka", "attendee");
  await goto("/hackathons");
  await page.getByText("Advanced filters", { exact: true }).click();
  await page
    .getByLabel("Event type", { exact: true })
    .selectOption("hackathon");
  await page.getByLabel("Format", { exact: true }).selectOption("Online");
  await expect(page.locator(".event-card")).toHaveCount(1);
  await expect(page.locator(".event-card")).toContainText("Design for Good");
  record("Discovery filters actual event data");
  await page
    .getByRole("button", { name: "View Design for Good Sprint", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Apply to hackathon", exact: true })
    .click();
  await dialog().getByLabel("I'd like to join as").selectOption("Speaker");
  await dialog()
    .getByLabel("What would you like to build or contribute?")
    .fill(
      "I would love to share accessible frontend techniques and build something useful.",
    );
  await dialog()
    .getByRole("button", { name: "Send application", exact: true })
    .click();
  snapshot = await state();
  expect(
    snapshot.applications.find(
      (a) => a.personId === "luka" && a.eventId === "design-sprint",
    ),
  ).toMatchObject({ role: "Speaker", status: "pending" });
  record("Solo application submits selected role and motivation");
  await page.reload();
  expect(
    (await state()).applications.some(
      (a) => a.personId === "luka" && a.eventId === "design-sprint",
    ),
  ).toBe(true);
  record("Shared server state persists across refresh");
  await reviewApplicant("Luka Petrović", "design-sprint");
  await switchView("luka", "attendee");
  await goto("/teams");
  await page
    .getByRole("button", { name: "Create a team", exact: true })
    .click();
  await dialog()
    .getByLabel("Hackathon", { exact: true })
    .selectOption("design-sprint");
  await dialog()
    .getByLabel("Team name", { exact: true })
    .fill("Good Design Crew");
  await dialog()
    .getByLabel("What brings you together?")
    .fill("Thoughtful community tools, together.");
  await dialog()
    .getByLabel("Skills you're looking for")
    .fill("Accessibility, Python");
  await dialog()
    .getByRole("button", { name: "Create team", exact: true })
    .click();
  snapshot = await state();
  const newTeam = snapshot.teams.find((t) => t.name === "Good Design Crew");
  expect(newTeam.memberIds).toEqual(["luka"]);
  expect(
    snapshot.applications.filter(
      (a) => a.personId === "luka" && a.eventId === "design-sprint",
    ),
  ).toHaveLength(1);
  record("New team associates existing accepted admission without duplicate");
  await page
    .getByRole("button", { name: "Invite a teammate", exact: true })
    .click();
  await dialog().getByLabel("Find an invitee").fill("Marko");
  await dialog().locator(".invite-choice").filter({ hasText: "Marko" }).click();
  await dialog()
    .getByRole("button", { name: "Send invitation", exact: true })
    .click();
  await switchView("marko");
  await goto("/activity");
  await page
    .getByRole("button", { name: "Accept and apply", exact: true })
    .click();
  snapshot = await state();
  expect(
    snapshot.applications.find(
      (a) => a.personId === "marko" && a.eventId === "design-sprint",
    ).status,
  ).toBe("pending");
  record("New outsider accept creates individual application");
  await reviewApplicant("Marko Ilić", "design-sprint");
  await switchView("luka", "attendee");
  await goto(`/teams/${newTeam.id}`);
  await expect(page.locator(".team-space-top")).toContainText("Confirmed team");
  record("Team reaches confirmed state after minimum accepted members");
  await goto("/teams");
  await page
    .getByRole("button", { name: "Previous teams", exact: true })
    .click();
  await page.getByRole("button", { name: "Reunite", exact: true }).click();
  await dialog()
    .getByLabel("Hackathon", { exact: true })
    .selectOption("gemini-lab");
  await dialog()
    .getByRole("button", { name: "Reunite team", exact: true })
    .click();
  snapshot = await state();
  const reused = snapshot.teams.find(
    (t) => t.name === "Weekend Merge" && t.eventId === "gemini-lab",
  );
  expect(reused.memberIds).toEqual(["luka"]);
  expect(
    snapshot.invitations
      .filter((i) => i.teamId === reused.id && i.status === "pending")
      .map((i) => i.personId)
      .sort(),
  ).toEqual(["ana", "marko"]);
  record("Previous team reuse sends fresh invitations, never silently enrolls");
  await goto("/people");
  await page.getByLabel("Search community profiles").fill("Teo");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  expect((await state()).connections).toContain("luka:teo");
  record("Connections update and persist");
  await goto("/profile");
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await dialog().getByLabel("First name", { exact: true }).fill("Luka");
  await dialog().getByLabel("Last name", { exact: true }).fill("Petrović");
  await dialog()
    .getByLabel("Headline", { exact: true })
    .fill("Frontend builder · demo verified");
  await dialog()
    .getByRole("button", { name: "Save profile", exact: true })
    .click();
  await expect(page.locator(".own-profile")).toContainText(
    "Frontend builder · demo verified",
  );
  await page.reload();
  await expect(page.locator(".own-profile")).toContainText(
    "Frontend builder · demo verified",
  );
  record("Profile edits persist across refresh");
  await page.getByText("Sample profile imports", { exact: true }).click();
  await page
    .getByRole("button", { name: "Preview Kaggle sample", exact: true })
    .click();
  await expect(dialog()).toContainText("Fictional data");
  await dialog()
    .getByRole("button", { name: "Apply sample changes", exact: true })
    .click();
  expect((await state()).people.find((p) => p.id === "luka").skills).toContain(
    "Data visualization",
  );
  record("Fictional import requires preview and explicit apply");
  await page.getByLabel("Attach CV file").setInputFiles({
    name: "local-resume.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"),
  });
  await expect(
    page.getByRole("button", { name: "Download your CV", exact: true }),
  ).toBeVisible();
  expect((await state()).people.find((p) => p.id === "luka").cv).toBe(
    "local-resume.pdf",
  );
  await page.getByRole("button", { name: "Remove CV attachment" }).click();
  await expect(
    page.getByRole("button", { name: "Download your CV", exact: true }),
  ).toHaveCount(0);
  expect((await state()).people.find((p) => p.id === "luka").cv).toBeFalsy();
  record("CV flow privately stores a PDF and supports removal");
  await goto("/hackathons/design-sprint");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Add to calendar", exact: true })
    .click();
  const download = await downloadPromise;
  const ics = fs.readFileSync(await download.path(), "utf8");
  expect(ics).toContain("DTSTART;VALUE=DATE:20261024");
  expect(ics).toContain("DTEND;VALUE=DATE:20261026");
  record("Multi-day calendar export includes inclusive end day");
  await switchView(undefined, "organizer");
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  await dialog().getByLabel("Event name").fill("Community Build Day");
  await dialog().getByLabel("Theme", { exact: true }).fill("Community tools");
  await dialog()
    .getByLabel("Description", { exact: true })
    .fill("Build a useful little thing with good people.");
  await dialog().getByLabel("Venue", { exact: true }).fill("Demo studio");
  await dialog()
    .getByRole("button", { name: "Create event", exact: true })
    .click();
  snapshot = await state();
  const createdEvent = snapshot.events.find(
    (e) => e.title === "Community Build Day",
  );
  expect(createdEvent.status).toBe("open");
  record("Organizer creates discoverable hackathon");
  await page.getByLabel("Manage event").selectOption("gdg-belgrade");
  await page.getByRole("button", { name: "Edit event", exact: true }).click();
  await dialog()
    .getByLabel("Applications", { exact: true })
    .selectOption("past");
  await dialog()
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await switchView("luka", "attendee");
  await goto("/teams");
  await expect(
    page.locator(".team-card").filter({ hasText: "Team 4" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Previous teams", exact: true })
    .click();
  await expect(
    page.locator(".team-card").filter({ hasText: "Team 4" }),
  ).toBeVisible();
  await goto("/teams/team-4");
  await expect(
    page.getByRole("button", { name: "Invite a teammate", exact: true }),
  ).toHaveCount(0);
  record("Past event teams enter reusable history and hide invalid actions");
  await switchView("teo", "attendee");
  await goto(`/hackathons/${createdEvent.id}`);
  await page
    .getByRole("button", { name: "Apply to hackathon", exact: true })
    .click();
  await dialog().getByLabel("How are you joining?").selectOption("new");
  await dialog().getByLabel("Team name", { exact: true }).fill("Fresh Start");
  await dialog().getByLabel("I'd like to join as").selectOption("Mentor");
  await dialog()
    .getByLabel("What would you like to build or contribute?")
    .fill("I want to help a small team build a beautiful mobile prototype.");
  await dialog()
    .getByRole("button", { name: "Send application", exact: true })
    .click();
  snapshot = await state();
  const combined = snapshot.applications.filter(
    (a) => a.personId === "teo" && a.eventId === createdEvent.id,
  );
  expect(combined).toHaveLength(1);
  expect(combined[0]).toMatchObject({ role: "Mentor", status: "pending" });
  expect(combined[0].teamId).toBeTruthy();
  record("Apply with new team is atomic and keeps selected role");
  await page
    .getByRole("button", { name: "Withdraw application", exact: true })
    .click();
  await dialog()
    .getByRole("button", { name: "Withdraw application", exact: true })
    .click();
  expect(
    (await state()).applications.some(
      (a) => a.personId === "teo" && a.eventId === createdEvent.id,
    ),
  ).toBe(false);
  record("Withdraw releases application and pending team membership");
  await switchView("luka", "organizer");
  await page
    .getByRole("button", { name: "Open demo controls", exact: true })
    .click();
  await dialog()
    .getByRole("button", { name: "Reset demo", exact: true })
    .click();
  await dialog()
    .getByRole("button", { name: "Reset demo", exact: true })
    .click();
  snapshot = await state();
  expect(snapshot.currentPersonId).toBe("luka");
  expect(snapshot.teams).toHaveLength(4);
  record("Reset restores original fictional seed");
  await switchView("luka", "attendee");
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
    timeout: 6000,
  });
  // Inspect every principal screen at desktop and phone size using the fresh seed.
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const [route, name] of [
      ["/", "home"],
      ["/hackathons", "hackathons"],
      ["/hackathons/gdg-belgrade", "event"],
      ["/teams", "teams"],
      ["/teams/team-4", "team"],
      ["/people", "people"],
      ["/activity", "activity"],
      ["/profile", "profile"],
    ]) {
      await goto(route);
      await noOverflow(`${width} ${route}`);
      await page.screenshot({
        path: `artifacts/${name}-${width}.png`,
        fullPage: true,
      });
    }
    await switchView(undefined, "organizer");
    await goto("/organizer");
    await noOverflow(`${width} organizer`);
    await page.screenshot({
      path: `artifacts/organizer-${width}.png`,
      fullPage: true,
    });
    await switchView(undefined, "attendee");
  }
  record(
    "Nine principal screens at 1440px and 390px have no horizontal overflow",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await goto("/profile");
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await noOverflow("phone modal");
  await page.screenshot({ path: "artifacts/modal-390.png" });
  await page.keyboard.press("Escape");
  await expect(dialog()).toHaveCount(0);
  record("Phone form dialog fits viewport and dismisses by keyboard");
  await goto("/does-not-exist");
  await expect(
    page.getByRole("heading", { name: "Let's get you back to your people" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to home", exact: true }).click();
  record("Unknown routes offer working recovery");
  const motionContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "no-preference",
  });
  const motionPage = await motionContext.newPage();
  motionPage.on("pageerror", (e) => errors.push(e.message));
  motionPage.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await motionPage.goto(`${base}/#/teams/team-4`);
  await motionPage.locator(".team-node").first().waitFor();
  await expect
    .poll(async () =>
      motionPage
        .locator(".team-node")
        .evaluateAll((nodes) =>
          nodes.every((node) => Number(getComputedStyle(node).opacity) === 1),
        ),
    )
    .toBe(true);
  await motionPage
    .getByRole("button", { name: "Invite a teammate", exact: true })
    .click();
  await motionPage
    .locator("md-dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(motionPage.locator("md-dialog")).toHaveCount(0);
  await motionContext.close();
  record(
    "Normal-motion team entrance and dialog interactions finish correctly",
  );
  expect(errors).toEqual([]);
  record("No browser exceptions or console errors across full workflow");
  fs.writeFileSync(
    "artifacts/verification.json",
    JSON.stringify(
      { base, checks, errors, verifiedAt: new Date().toISOString() },
      null,
      2,
    ),
  );
} catch (error) {
  await page.screenshot({
    path: "artifacts/verification-failure.png",
    fullPage: true,
  });
  console.error("FAILED", error);
  console.log("Errors", errors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
