// Run after npm run build: node --import tsx scripts/verify-event-auto-invite.mjs
import { chromium, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createApi } from "../server/http.ts";
import { FileRepository } from "../server/repository.ts";
import { createSeedState } from "../src/seed.ts";

const directory = await mkdtemp(join(tmpdir(), "gevents-auto-invite-browser-"));
const output = resolve(".runtime/event-auto-invite-verification");
await mkdir(output, { recursive: true });
const repository = new FileRepository(join(directory, "state.json"));
const seed = createSeedState();
for (const person of seed.people) {
  person.skills = ["React"];
  person.interests = ["Web apps"];
  person.preferences = {
    goals: ["Learning"],
    kinds: ["meetup"],
    formats: ["Online"],
    location: "Belgrade",
    notify: true,
  };
}
await repository.update(() => ({ state: seed }));
const server = createApi({
  repository,
  mode: "demo",
  publicConfig: null,
  staticDirectory: resolve("dist"),
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const cached =
  "C:/Users/urosd/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe";
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(cached) ? { executablePath: cached } : {}),
});
const errors = [],
  checks = [];
const pass = (name) => {
  checks.push(name);
  console.log("PASS", name);
};
async function actor(personId, mode = "attendee", width = 1440) {
  const context = await browser.newContext({
    viewport: { width, height: width === 390 ? 844 : 1000 },
    reducedMotion: "reduce",
  });
  const login = await context.request.post(`${base}/api/demo-session`, {
    data: { personId, mode },
  });
  expect(login.ok()).toBe(true);
  const { token } = await login.json();
  await context.addInitScript(
    ({ token, mode }) => {
      sessionStorage.setItem("gevents-api-session", token);
      sessionStorage.setItem("gevents-view", mode);
    },
    { token, mode },
  );
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  return { context, page, token };
}
async function noOverflow(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}
try {
  const organizer = await actor("luka", "organizer");
  await organizer.page.goto(`${base}/#/organizer`);
  await organizer.page.waitForLoadState("networkidle");
  await organizer.page
    .getByRole("button", { name: "Create event", exact: true })
    .click();
  const form = organizer.page.locator("#event-form");
  await expect(form).toBeVisible();
  await expect(
    form.getByRole("checkbox", {
      name: "Automatically invite suitable people",
    }),
  ).not.toBeChecked();
  await expect(
    form.getByRole("spinbutton", { name: "Number of people to invite" }),
  ).toHaveCount(0);
  await form
    .getByRole("combobox", { name: "Event type", exact: true })
    .selectOption("meetup");
  await form
    .getByRole("combobox", { name: "Registration", exact: true })
    .selectOption("review");
  await form
    .getByRole("textbox", { name: "Event name", exact: true })
    .fill("P0 auto-invite browser test");
  await form
    .getByRole("textbox", { name: "Theme", exact: true })
    .fill("Web apps");
  await form
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Learn React and build web apps together.");
  await form.getByLabel("Starts", { exact: true }).fill("2099-10-11");
  await form.getByLabel("Ends", { exact: true }).fill("2099-10-11");
  await form.getByLabel("Apply by", { exact: true }).fill("2099-10-10");
  await form
    .getByRole("textbox", { name: "Venue", exact: true })
    .fill("Online classroom");
  await form
    .getByRole("combobox", { name: "Format", exact: true })
    .selectOption("Online");
  await form
    .getByRole("textbox", { name: "Event topics", exact: true })
    .fill("Web apps");
  await form
    .getByRole("textbox", { name: "Skills practiced", exact: true })
    .fill("React");
  await form.getByRole("checkbox", { name: "Learning", exact: true }).check();
  await form
    .getByRole("checkbox", { name: "Automatically invite suitable people" })
    .check();
  await form
    .getByRole("spinbutton", { name: "Number of people to invite" })
    .fill("2");
  await organizer.page.screenshot({
    path: join(output, "creation-1440.png"),
    fullPage: true,
  });
  await organizer.page
    .getByRole("button", { name: "Create event", exact: true })
    .last()
    .click();
  await expect(form).toHaveCount(0);
  const results = organizer.page.getByRole("region", {
    name: "Automatic event invitations",
  });
  await expect(
    results.getByText("2 of 2 requested invitations sent.", { exact: true }),
  ).toBeVisible();
  await expect(
    results.getByText("Awaiting reply", { exact: true }),
  ).toHaveCount(2);
  const state = await repository.read();
  const event = state.events.find(
    (e) => e.title === "P0 auto-invite browser test",
  );
  const invitations = state.eventInvitations.filter(
    (i) => i.eventId === event.id,
  );
  expect(invitations).toHaveLength(2);
  pass(
    "Organizer creates event and automatically sends the selected count of invitations",
  );
  await organizer.page.screenshot({
    path: join(output, "organizer-1440.png"),
    fullPage: true,
  });
  await noOverflow(organizer.page);
  const recipient = await actor(invitations[0].personId);
  await recipient.page.goto(`${base}/#/activity`);
  const card = recipient.page
    .locator(".activity-invite-card")
    .filter({ hasText: event.title });
  await expect(
    card.getByText("Event invitation", { exact: true }),
  ).toBeVisible();
  await expect(card.getByText(/Why you were invited:/)).toBeVisible();
  await expect(
    recipient.page
      .locator(".activity-invite-card")
      .filter({ hasText: event.title }),
  ).toHaveCount(1);
  const forbidden = await recipient.context.request.post(
    `${base}/api/actions`,
    {
      headers: { Authorization: `Bearer ${recipient.token}` },
      data: {
        type: "RESPOND_EVENT_INVITATION",
        invitationId: invitations[1].id,
        response: "accepted",
      },
    },
  );
  expect(forbidden.status()).toBe(400);
  await card
    .getByRole("button", { name: "Accept and apply", exact: true })
    .click();
  await expect(card).toHaveCount(0);
  const accepted = await repository.read();
  expect(
    accepted.eventInvitations.find((i) => i.id === invitations[0].id).status,
  ).toBe("accepted");
  expect(
    accepted.applications.find(
      (a) => a.eventId === event.id && a.personId === invitations[0].personId,
    )?.status,
  ).toBe("pending");
  pass(
    "Independent attendee can accept only their own invitation and enters organizer review",
  );
  const mobile = await actor(invitations[1].personId, "attendee", 390);
  await mobile.page.goto(`${base}/#/activity`);
  await mobile.page.waitForLoadState("networkidle");
  const mobileCard = mobile.page
    .locator(".activity-invite-card")
    .filter({ hasText: event.title });
  await expect(
    mobileCard.getByRole("button", { name: "Decline", exact: true }),
  ).toBeVisible();
  await mobile.page.screenshot({
    path: join(output, "invitation-390.png"),
    fullPage: true,
  });
  await noOverflow(mobile.page);
  await mobileCard
    .getByRole("button", { name: "Decline", exact: true })
    .click();
  await expect(mobileCard).toHaveCount(0);
  const declined = await repository.read();
  expect(
    declined.eventInvitations.find((i) => i.id === invitations[1].id).status,
  ).toBe("declined");
  expect(
    declined.applications.some(
      (a) => a.eventId === event.id && a.personId === invitations[1].personId,
    ),
  ).toBe(false);
  pass(
    "Mobile attendee sees match reasons and declines without creating an application",
  );
  await organizer.page.reload();
  await organizer.page.getByRole("combobox", { name: "Manage event", exact: true }).click();
  await organizer.page.getByRole("option", { name: event.title, exact: true }).click();
  await expect(
    results.getByText("Invitation accepted", { exact: true }),
  ).toBeVisible();
  await expect(results.getByText("Declined", { exact: true })).toBeVisible();
  await organizer.page
    .getByRole("button", { name: "Edit event", exact: true })
    .click();
  await expect(
    form.getByRole("checkbox", {
      name: "Automatically invite suitable people",
    }),
  ).toBeDisabled();
  await expect(
    form.getByRole("spinbutton", { name: "Number of people to invite" }),
  ).toBeDisabled();
  await organizer.page
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  pass(
    "Organizer sees recipient responses and publication locks settings against duplicate outreach",
  );
  await organizer.page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(organizer.page);
  await organizer.page.screenshot({
    path: join(output, "organizer-390.png"),
    fullPage: true,
  });
  await organizer.page
    .getByRole("button", { name: "Create event", exact: true })
    .click();
  await expect(form).toBeVisible();
  await form
    .getByRole("checkbox", { name: "Automatically invite suitable people" })
    .check();
  await expect(
    form.getByRole("spinbutton", { name: "Number of people to invite" }),
  ).toBeVisible();
  await noOverflow(organizer.page);
  await organizer.page.screenshot({
    path: join(output, "creation-390.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  pass(
    "Creation, invitation and organizer results render at 1440px and 390px without overflow or page errors",
  );
  await writeFile(
    join(output, "report.json"),
    JSON.stringify({ checks, errors, screenshots: output }, null, 2),
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
