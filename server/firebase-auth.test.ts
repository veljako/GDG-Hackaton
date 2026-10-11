import { afterEach, expect, it } from "vitest";
import type { Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileRepository } from "./repository";
import { createApi } from "./http";
const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections();
          s.close(() => resolve());
        }),
    ),
  );
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
it("Firebase mode derives identity and organizer rights from verified tokens, never demo controls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gevents-firebase-auth-"));
  dirs.push(dir);
  const repo = new FileRepository(join(dir, "state.json"));
  const server = createApi({
    repository: repo,
    mode: "firebase",
    publicConfig: {},
    organizerUids: new Set(["organizer-uid"]),
    authenticate: async (token) => {
      if (token === "valid-attendee")
        return {
          uid: "real-uid",
          name: "Real User",
          email: "real@example.com",
          emailVerified: true,
        };
      if (token === "valid-organizer")
        return { uid: "organizer-uid", name: "Organizer" };
      throw Error("Invalid token");
    },
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No port");
  const base = `http://127.0.0.1:${address.port}`;
  const get = (token: string) =>
    fetch(base + "/api/state?mode=organizer", {
      headers: { Authorization: "Bearer " + token },
    });
  expect((await get("forged")).status).toBe(401);
  const attendee = await (await get("valid-attendee")).json();
  expect(attendee.state.currentPersonId).toBe("real-uid");
  expect(attendee.state.mode).toBe("attendee");
  expect(attendee.organizer).toBe(false);
  expect(
    attendee.state.people.find((p: { id: string }) => p.id === "real-uid"),
  ).toMatchObject({
    email: "real@example.com",
    email_verified: true,
    first_name: "",
    last_name: "",
    education: [],
    work_experience: [],
    cv_document: null,
    created_at: expect.any(String),
    updated_at: expect.any(String),
  });
  expect((await get("valid-organizer")).status).toBe(200);
  const organizer = await (await get("valid-organizer")).json();
  expect(organizer.organizer).toBe(true);
  expect(organizer.state.mode).toBe("organizer");
  expect(
    organizer.state.people.find((p: { id: string }) => p.id === "real-uid"),
  ).not.toHaveProperty("email");
  expect(
    (await repo.read()).people.filter((p) => p.id === "real-uid"),
  ).toHaveLength(1);
  expect(
    (
      await fetch(base + "/api/demo-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId: "luka", mode: "organizer" }),
      })
    ).status,
  ).toBe(404);
  const malicious = await fetch(base + "/api/actions?mode=organizer", {
    method: "POST",
    headers: {
      Authorization: "Bearer valid-attendee",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "REVIEW_APPLICATION",
      applicationId: attendee.state.applications[0].id,
      status: "accepted",
    }),
  });
  expect(malicious.status).toBe(400);
  const reset = await fetch(base + "/api/actions?mode=organizer", {
    method: "POST",
    headers: {
      Authorization: "Bearer valid-organizer",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "RESET" }),
  });
  expect(reset.status).toBe(400);
});
