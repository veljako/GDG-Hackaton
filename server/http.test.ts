import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { FileRepository } from "./repository";
import { createApi } from "./http";
import { execute } from "./service";

const dirs: string[] = [];
const servers: Server[] = [];
async function setup(allowedOrigins?: Set<string>) {
  const dir = await mkdtemp(join(tmpdir(), "gevents-api-"));
  dirs.push(dir);
  const filename = join(dir, "state.json");
  const repository = new FileRepository(filename);
  const server = createApi({ repository, mode: "demo", publicConfig: null, allowedOrigins });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No port");
  const base = `http://127.0.0.1:${address.port}`;
  async function request(
    path: string,
    token?: string,
    data?: unknown,
    extraHeaders: Record<string, string> = {},
  ) {
    return fetch(base + path, {
      method: data ? "POST" : "GET",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body: data ? JSON.stringify(data) : undefined,
    });
  }
  async function login(personId: string, mode = "attendee") {
    return (
      await (
        await request("/api/demo-session", undefined, { personId, mode })
      ).json()
    ).token as string;
  }
  return { request, login, repository, filename, base };
}
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
describe("HTTP backend and persistence", () => {
  it("allows a trusted Firebase frontend to preflight and call the authenticated API", async () => {
    const origin = "https://gdg-hackathon-d0b85.web.app";
    const { base, request, login } = await setup(new Set([origin]));
    const preflight = await fetch(base + "/api/actions", {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
    expect(preflight.headers.get("access-control-allow-headers")).toContain("Authorization");
    const anonymous = await request("/api/state", undefined, undefined, { Origin: origin });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("access-control-allow-origin")).toBe(origin);
    const token = await login("luka");
    const state = await request("/api/state", token, undefined, { Origin: origin });
    expect(state.status).toBe(200);
    expect(state.headers.get("access-control-allow-origin")).toBe(origin);
    const mutation = await request("/api/actions", token, { type: "UPDATE_PROFILE", personId: "luka", changes: { bio: "separate backend" } }, { Origin: origin });
    expect(mutation.status).toBe(200);
  });

  it("rejects untrusted preflights and unsupported methods and headers", async () => {
    const origin = "https://gdg-hackathon-d0b85.web.app";
    const { base } = await setup(new Set([origin]));
    const cases: Record<string, string>[] = [
      { Origin: "https://untrusted.example", "Access-Control-Request-Method": "POST" },
      { Origin: origin, "Access-Control-Request-Method": "DELETE" },
      { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-admin" },
    ];
    for (const headers of cases) {
      const response = await fetch(base + "/api/actions", { method: "OPTIONS", headers });
      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  it("requires authentication and rejects forged identities and cross-origin mutations", async () => {
    const { request, login } = await setup();
    expect((await request("/api/state")).status).toBe(401);
    const token = await login("luka");
    expect(
      (
        await request(
          "/api/actions",
          token,
          {
            type: "UPDATE_PROFILE",
            personId: "luka",
            changes: { bio: "cross origin" },
          },
          { Origin: "https://untrusted.example" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/api/actions", token, {
          type: "UPDATE_PROFILE",
          personId: "mila",
          changes: { bio: "forged" },
        })
      ).status,
    ).toBe(400);
    expect(
      (await request("/api/actions", "forged", { type: "RESET" })).status,
    ).toBe(401);
    expect(
      (
        await request("/api/demo-session", undefined, {
          personId: "missing",
          mode: "attendee",
        })
      ).status,
    ).toBe(400);
  });
  it("shares invitation, pending admission and approval across independent sessions", async () => {
    const { request, login, filename } = await setup();
    const luka = await login("luka");
    const zarko = await login("zarko");
    const organizer = await login("luka", "organizer");
    let response = await request("/api/actions", luka, {
      type: "INVITE_PERSON",
      teamId: "team-4",
      personId: "zarko",
      fromId: "luka",
    });
    expect(response.status).toBe(200);
    let state = (await (await request("/api/state", zarko)).json()).state;
    const invitation = state.invitations.find(
      (i: { personId: string; teamId: string }) =>
        i.personId === "zarko" && i.teamId === "team-4",
    );
    response = await request("/api/actions", zarko, {
      type: "RESPOND_INVITATION",
      invitationId: invitation.id,
      response: "accepted",
    });
    expect(response.status).toBe(200);
    state = (await (await request("/api/state", organizer)).json()).state;
    const application = state.applications.find(
      (a: { personId: string; eventId: string }) =>
        a.personId === "zarko" && a.eventId === "gdg-belgrade",
    );
    expect(application.status).toBe("pending");
    expect(
      (
        await request("/api/actions", luka, {
          type: "REVIEW_APPLICATION",
          applicationId: application.id,
          status: "accepted",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/api/actions", organizer, {
          type: "REVIEW_APPLICATION",
          applicationId: application.id,
          status: "accepted",
        })
      ).status,
    ).toBe(200);
    const reopened = new FileRepository(filename);
    expect(
      (await reopened.read()).applications.find((a) => a.id === application.id)!
        .status,
    ).toBe("accepted");
    expect((await reopened.read()).mode).toBe("attendee");
  });
  it("serializes concurrent reservations for the last team place", async () => {
    const { repository } = await setup();
    await repository.update((state) => {
      state.events.find((e) => e.id === "gdg-belgrade")!.maxTeamSize = 3;
      return { state };
    });
    const session = {
      personId: "luka",
      organizer: false,
      mode: "attendee" as const,
      demo: true,
    };
    const results = await Promise.all(
      ["zarko", "ana"].map((personId) =>
        repository.update((state) =>
          execute(state, session, {
            type: "INVITE_PERSON",
            teamId: "team-4",
            personId,
            fromId: "luka",
          }),
        ),
      ),
    );
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(
      (await repository.read()).invitations.filter(
        (i) => i.teamId === "team-4" && i.status === "pending",
      ),
    ).toHaveLength(1);
  });
});
