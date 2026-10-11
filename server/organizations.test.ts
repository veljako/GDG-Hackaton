import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { Firestore } from "firebase-admin/firestore";
import {
  FileOrganizationStore,
  FirestoreOrganizationStore,
  type OrganizationStore,
} from "./organizations";
import { FileRepository } from "./repository";
import { createApi } from "./http";
import { createSeedState } from "../src/seed";
import { execute, view, type Session } from "./service";
import type { OrganizationSnapshot } from "../src/organizations";

const dirs: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  vi.useRealTimers();
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
const input = {
  name: "Science Lab",
  city: "Belgrade",
  website: "https://example.com",
  description: "Research and building",
};
async function fileStore() {
  const dir = await mkdtemp(join(tmpdir(), "gevents-organizations-"));
  dirs.push(dir);
  const path = join(dir, "organizations.json");
  return { store: new FileOrganizationStore(path), path, dir };
}

// Serialized transaction double checks read-before-write and rollbacks. Production
// Firestore supplies the equivalent atomicity with automatic conflict retries.
function firestore() {
  const records = new Map<string, Record<string, unknown>>();
  let queue: Promise<unknown> = Promise.resolve();
  const doc = (path: string) => ({ path, id: path.split("/").at(-1)! });
  const collection = (path: string) => ({
    path,
    where: (field: string, _op: string, value: unknown) => ({
      path,
      field,
      value,
    }),
  });
  const snapshot = (ref: ReturnType<typeof doc>) => ({
    exists: records.has(ref.path),
    id: ref.id,
    data: () => structuredClone(records.get(ref.path)),
    get: (field: string) => records.get(ref.path)?.[field],
  });
  const db = {
    doc,
    collection,
    runTransaction: (fn: (tx: unknown) => Promise<unknown>) => {
      const job = queue.then(async () => {
        const writes: (() => void)[] = [];
        const result = await fn({
          get: async (ref: {
            path: string;
            id?: string;
            field?: string;
            value?: unknown;
          }) => {
            if (writes.length) throw Error("Read after write");
            if (ref.id) return snapshot(ref as ReturnType<typeof doc>);
            return {
              docs: [...records.entries()]
                .filter(
                  ([path, value]) =>
                    path.startsWith(ref.path + "/") &&
                    (!ref.field || value[ref.field] === ref.value),
                )
                .map(([path]) => snapshot(doc(path))),
            };
          },
          set: (ref: ReturnType<typeof doc>, value: Record<string, unknown>) =>
            writes.push(() => records.set(ref.path, structuredClone(value))),
        });
        writes.forEach((fn) => fn());
        return result;
      });
      queue = job.catch(() => undefined);
      return job;
    },
  } as unknown as Firestore;
  return { store: new FirestoreOrganizationStore(db), records };
}

describe.each(["file", "firestore"] as const)(
  "%s organization authority",
  (kind) => {
    async function fixture(): Promise<{
      store: OrganizationStore;
      raw: () => Promise<string>;
    }> {
      if (kind === "file") {
        const f = await fileStore();
        return { store: f.store, raw: () => readFile(f.path, "utf8") };
      }
      const f = firestore();
      return {
        store: f.store,
        raw: async () => JSON.stringify([...f.records]),
      };
    }
    it("creates an admin atomically and scopes organization/member visibility", async () => {
      const { store } = await fixture();
      const first = await store.create("owner", input);
      const other = await store.create("outsider", { ...input, name: "Other" });
      expect(first.memberships).toHaveLength(1);
      expect(first.memberships[0]).toMatchObject({
        personId: "owner",
        role: "admin",
        organizationId: first.organizations[0].id,
      });
      expect((await store.snapshot("owner")).organizations).toHaveLength(1);
      await expect(
        store.members("outsider", first.organizations[0].id),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        store.invite(
          "owner",
          other.organizations[0].id,
          "a@example.com",
          "admin",
        ),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("hashes tokens, binds verified email and rejects expired, invalid and consumed invites", async () => {
      const { store, raw } = await fixture();
      const org = (await store.create("owner", input)).organizations[0];
      const invite = await store.invite(
        "owner",
        org.id,
        "Member@Example.com",
        "member",
      );
      expect(await raw()).not.toContain(invite.token);
      await expect(
        store.join("member", "wrong@example.com", true, invite.token),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        store.join("member", invite.email, false, invite.token),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        store.join("member", null, true, invite.token),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        store.join("member", invite.email, true, "f".repeat(64)),
      ).rejects.toMatchObject({ status: 400 });
      const joined = await store.join(
        "member",
        invite.email,
        true,
        invite.token,
      );
      expect(joined.memberships[0].role).toBe("member");
      expect(
        (await store.join("member", invite.email, true, invite.token))
          .memberships,
      ).toHaveLength(1);
      await expect(
        store.join("different-uid", invite.email, true, invite.token),
      ).rejects.toMatchObject({ status: 409 });
      const expiring = await store.invite(
        "owner",
        org.id,
        "expired@example.com",
        "member",
      );
      vi.useFakeTimers();
      vi.setSystemTime(Date.parse(expiring.expires_at));
      await expect(
        store.join("expired", expiring.email, true, expiring.token),
      ).rejects.toMatchObject({ status: 400 });
    });
    it("allows only one UID to redeem concurrently and only admin-issued invitations can promote existing members", async () => {
      const { store } = await fixture();
      const org = (await store.create("owner", input)).organizations[0];
      const invite = await store.invite(
        "owner",
        org.id,
        "member@example.com",
        "member",
      );
      const results = await Promise.allSettled([
        store.join("uid-a", invite.email, true, invite.token),
        store.join("uid-b", invite.email, true, invite.token),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const winner = results[0].status === "fulfilled" ? "uid-a" : "uid-b";
      const elevate = await store.invite(
        "owner",
        org.id,
        invite.email,
        "admin",
      );
      expect(
        (await store.join(winner, invite.email, true, elevate.token))
          .memberships[0].role,
      ).toBe("admin");
      const noDowngrade = await store.invite(
        "owner",
        org.id,
        invite.email,
        "member",
      );
      expect(
        (await store.join(winner, invite.email, true, noDowngrade.token))
          .memberships[0].role,
      ).toBe("admin");
      expect(await store.members(winner, org.id)).toHaveLength(2);
    });
  },
);

function organizationSession(
  personId: string,
  role: "admin" | "member",
  org = "org-science",
): Session {
  return {
    personId,
    organizer: true,
    legacyOrganizer: false,
    mode: "organizer",
    demo: false,
    organizations: [{ ...input, id: org, created_at: "today" }],
    memberships: [
      {
        id: `membership-${personId}`,
        personId,
        organizationId: org,
        role,
        joined_at: "today",
      },
    ],
  };
}
function eventInput(organizationId = "org-science") {
  const {
    id: _id,
    publishedAt: _published,
    ...event
  } = createSeedState().events[0];
  return {
    ...event,
    organizationId,
    organizer: "Forged organizer",
    status: "open" as const,
    date: "2027-01-10",
    endDate: "2027-01-11",
    deadline: "2027-01-09",
  };
}
describe("organization event management", () => {
  it("scopes legacy organizer snapshots to unowned and joined organization events, with applications restricted by admin role", () => {
    const state = createSeedState();
    const ownEvent = {
      ...state.events[0],
      id: "own-draft",
      organizationId: "org-science",
      createdBy: "luka",
      status: "draft" as const,
    };
    const foreignEvent = {
      ...ownEvent,
      id: "foreign-draft",
      organizationId: "org-other",
      title: "Private other-org draft",
    };
    state.events.push(ownEvent, foreignEvent);
    state.applications.push(
      {
        ...state.applications[0],
        id: "own-private",
        eventId: ownEvent.id,
        personId: "mila",
        motivation: "Own organization review",
      },
      {
        ...state.applications[0],
        id: "own-personal",
        eventId: ownEvent.id,
        personId: "luka",
        motivation: "Own application",
      },
      {
        ...state.applications[0],
        id: "foreign-private",
        eventId: foreignEvent.id,
        motivation: "Private foreign motivation",
      },
    );
    const admin = {
      ...organizationSession("luka", "admin"),
      legacyOrganizer: true,
    };
    const adminView = view(state, admin);
    expect(adminView.events.some((e) => e.id === ownEvent.id)).toBe(true);
    expect(adminView.events.some((e) => e.id === state.events[0].id)).toBe(
      true,
    );
    expect(adminView.events.some((e) => e.id === foreignEvent.id)).toBe(false);
    expect(
      adminView.applications.find((a) => a.id === "own-private")?.motivation,
    ).toBe("Own organization review");
    expect(adminView.applications.some((a) => a.id === "foreign-private")).toBe(
      false,
    );
    expect(
      adminView.applications.some((a) => a.id === state.applications[0].id),
    ).toBe(true);
    const memberView = view(state, {
      ...admin,
      memberships: organizationSession("luka", "member").memberships,
    });
    expect(memberView.applications.some((a) => a.id === "own-private")).toBe(
      false,
    );
    expect(
      memberView.applications.find((a) => a.id === "own-personal")?.motivation,
    ).toBe("Own application");
    expect(
      memberView.applications.some((a) => a.id === state.applications[0].id),
    ).toBe(true);
    const noMembership = view(state, {
      ...admin,
      memberships: [],
      organizations: [],
    });
    expect(noMembership.events.some((e) => e.organizationId)).toBe(false);
    expect(
      noMembership.applications.some(
        (a) => a.id === "own-private" || a.id === "foreign-private",
      ),
    ).toBe(false);
  });
  it("publishes once with normal recommendation notices and stamps direct admin publication", () => {
    const state = createSeedState();
    const person = state.people.find((p) => p.id === "mila")!;
    person.skills = ["React"];
    person.interests = ["Web apps"];
    person.preferences = {
      goals: ["Learning"],
      kinds: ["meetup"],
      formats: ["In person"],
      location: "Belgrade",
      notify: true,
    };
    const event = {
      ...eventInput(),
      kind: "meetup",
      tags: ["Web apps"],
      format: "In person",
      location: "Belgrade",
      audience: {
        skills: ["React"],
        goals: ["Learning"],
        roles: [],
        levels: [],
      },
    };
    const member = organizationSession("luka", "member");
    const created = execute(state, member, { type: "CREATE_EVENT", event });
    const id = created.createdId!;
    const notices = (s: typeof state) =>
      s.notifications.filter(
        (n) => n.eventId === id && n.personId === person.id,
      );
    expect(notices(created.state)).toEqual([]);
    const submitted = execute(created.state, member, {
      type: "SUBMIT_EVENT_FOR_APPROVAL",
      eventId: id,
    });
    expect(notices(submitted.state)).toEqual([]);
    const admin = organizationSession("mila", "admin");
    const approved = execute(submitted.state, admin, {
      type: "REVIEW_EVENT_PUBLICATION",
      eventId: id,
      decision: "approve",
    });
    expect(notices(approved.state)).toHaveLength(1);
    const edited = execute(approved.state, admin, {
      type: "UPDATE_EVENT",
      eventId: id,
      changes: { title: "Updated event" },
    });
    expect(notices(edited.state)).toHaveLength(1);
    const draft = execute(edited.state, admin, {
      type: "CREATE_EVENT",
      event: { ...event, status: "draft" },
    });
    const direct = execute(draft.state, admin, {
      type: "UPDATE_EVENT",
      eventId: draft.createdId,
      changes: { status: "open" },
    });
    expect(
      direct.state.events.find((e) => e.id === draft.createdId),
    ).toMatchObject({
      status: "open",
      publicationStatus: "approved",
      publishedAt: expect.any(String),
    });
  });
  it("lets pending members create canonical drafts, submit, and receive admin approval without bypassing attendee CV gating", () => {
    const state = createSeedState();
    state.people.find((p) => p.id === "luka")!.onboarding = {
      version: 1,
      status: "required",
      completed_at: null,
    };
    const member = organizationSession("luka", "member");
    const created = execute(state, member, {
      type: "CREATE_EVENT",
      event: eventInput(),
    });
    expect(created.error).toBeUndefined();
    const id = created.createdId!;
    expect(created.state.events.find((e) => e.id === id)).toMatchObject({
      organizer: input.name,
      organizationId: "org-science",
      createdBy: "luka",
      publicationStatus: "draft",
      status: "draft",
    });
    expect(
      execute(
        created.state,
        { ...member, mode: "attendee" },
        {
          type: "SUBMIT_APPLICATION",
          eventId: state.events[0].id,
          personId: "luka",
          role: "Participant",
          motivation: "Join",
        },
      ).error,
    ).toContain("profile setup");
    expect(
      execute(created.state, member, {
        type: "UPDATE_EVENT",
        eventId: id,
        changes: { status: "open" },
      }).error,
    ).toBeTruthy();
    const submitted = execute(created.state, member, {
      type: "SUBMIT_EVENT_FOR_APPROVAL",
      eventId: id,
    });
    expect(
      submitted.state.events.find((e) => e.id === id)?.publicationStatus,
    ).toBe("pending");
    expect(
      execute(submitted.state, member, {
        type: "UPDATE_EVENT",
        eventId: id,
        changes: { title: "Sneaky edit" },
      }).error,
    ).toBeTruthy();
    expect(
      execute(submitted.state, member, {
        type: "REVIEW_EVENT_PUBLICATION",
        eventId: id,
        decision: "approve",
      }).error,
    ).toBeTruthy();
    const approved = execute(
      submitted.state,
      organizationSession("mila", "admin"),
      { type: "REVIEW_EVENT_PUBLICATION", eventId: id, decision: "approve" },
    );
    expect(approved.error).toBeUndefined();
    expect(approved.state.events.find((e) => e.id === id)).toMatchObject({
      status: "open",
      publicationStatus: "approved",
      publishedAt: expect.any(String),
    });
    expect(
      view(submitted.state, { ...member, mode: "attendee" }).events.some(
        (e) => e.id === id,
      ),
    ).toBe(false);
    expect(
      view(approved.state, organizationSession("mila", "admin", "org-other"))
        .events,
    ).toEqual([]);
  });
  it("rejects forged metadata, ownership transfers, cross-org events and non-admin application review", () => {
    const member = organizationSession("luka", "member");
    const state = createSeedState();
    for (const forged of [
      { createdBy: "mila" },
      { publicationStatus: "approved" },
      { publishedAt: "today" },
    ])
      expect(
        execute(state, member, {
          type: "CREATE_EVENT",
          event: { ...eventInput(), ...forged },
        }).error,
      ).toBeTruthy();
    expect(
      execute(state, member, {
        type: "CREATE_EVENT",
        event: eventInput("org-other"),
      }).error,
    ).toBeTruthy();
    const created = execute(state, member, {
      type: "CREATE_EVENT",
      event: eventInput(),
    });
    const id = created.createdId!;
    for (const changes of [
      { organizationId: "org-other" },
      { createdBy: "mila" },
      { publicationStatus: "approved" },
    ])
      expect(
        execute(created.state, member, {
          type: "UPDATE_EVENT",
          eventId: id,
          changes,
        }).error,
      ).toBeTruthy();
    expect(
      execute(created.state, organizationSession("mila", "member"), {
        type: "UPDATE_EVENT",
        eventId: id,
        changes: { title: "Other member" },
      }).error,
    ).toBeTruthy();
    expect(
      execute(
        created.state,
        organizationSession("mila", "admin", "org-other"),
        { type: "REVIEW_EVENT_PUBLICATION", eventId: id, decision: "approve" },
      ).error,
    ).toBeTruthy();
    const application = {
      ...state.applications[0],
      id: "app-org",
      eventId: id,
    };
    created.state.applications.push(application);
    expect(
      execute(created.state, member, {
        type: "REVIEW_APPLICATION",
        applicationId: application.id,
        status: "accepted",
      }).error,
    ).toBeTruthy();
    expect(
      execute(
        created.state,
        organizationSession("mila", "admin", "org-other"),
        {
          type: "REVIEW_APPLICATION",
          applicationId: application.id,
          status: "accepted",
        },
      ).error,
    ).toBeTruthy();
    expect(
      execute(created.state, organizationSession("mila", "admin"), {
        type: "REVIEW_APPLICATION",
        applicationId: application.id,
        status: "accepted",
      }).error,
    ).toBeUndefined();
    const legacy = {
      ...member,
      memberships: [],
      organizations: [],
      legacyOrganizer: true,
    };
    expect(
      execute(state, legacy, {
        type: "UPDATE_EVENT",
        eventId: state.events[0].id,
        changes: { title: "Legacy edit" },
      }).error,
    ).toBeUndefined();
    expect(
      execute(created.state, legacy, {
        type: "UPDATE_EVENT",
        eventId: id,
        changes: { title: "Legacy attack" },
      }).error,
    ).toBeTruthy();
  });
  it("returns a rejected submission to an editable draft and admins can edit other members' drafts", () => {
    const member = organizationSession("luka", "member");
    const created = execute(createSeedState(), member, {
      type: "CREATE_EVENT",
      event: eventInput(),
    });
    const id = created.createdId!;
    const submitted = execute(created.state, member, {
      type: "SUBMIT_EVENT_FOR_APPROVAL",
      eventId: id,
    });
    const admin = organizationSession("mila", "admin");
    expect(
      execute(submitted.state, admin, {
        type: "UPDATE_EVENT",
        eventId: id,
        changes: { title: "Admin adjustment" },
      }).error,
    ).toBeUndefined();
    const rejected = execute(submitted.state, admin, {
      type: "REVIEW_EVENT_PUBLICATION",
      eventId: id,
      decision: "reject",
    });
    expect(rejected.state.events.find((e) => e.id === id)).toMatchObject({
      status: "draft",
      publicationStatus: "draft",
    });
    expect(
      execute(rejected.state, member, {
        type: "UPDATE_EVENT",
        eventId: id,
        changes: { title: "Revised" },
      }).error,
    ).toBeUndefined();
  });
});

it("organization HTTP routes derive identity and fresh membership from tokens while preserving pending attendee gating", async () => {
  const { store, dir } = await fileStore();
  const repository = new FileRepository(join(dir, "state.json"));
  const calls: { actor: string; state: unknown }[] = [];
  const server = createApi({
    mode: "firebase",
    publicConfig: {},
    repository,
    organizationStore: store,
    authenticate: async (token) => {
      if (!["owner", "member", "unverified", "other"].includes(token))
        throw Error();
      return {
        uid: token,
        name: token,
        email:
          token === "unverified"
            ? "member@example.com"
            : `${token}@example.com`,
        emailVerified: token !== "unverified",
      };
    },
    matchingClient: {
      call: async (_operation, actor, state) => {
        calls.push({ actor, state });
        return { results: [] };
      },
    },
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No port");
  const base = `http://127.0.0.1:${address.port}`;
  const request = (path: string, token = "owner", value?: unknown) =>
    fetch(base + path, {
      method: value === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(value === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
  expect((await request("/api/organizations", "bad")).status).toBe(401);
  expect(
    (
      await request("/api/organizations", "owner", {
        ...input,
        personId: "other",
        role: "admin",
      })
    ).status,
  ).toBe(400);
  for (const changes of [
    { city: " " },
    { description: "" },
    { name: "x".repeat(101) },
    { description: "x".repeat(1001) },
    { website: "https://name:password@example.com" },
    { website: "javascript:alert(1)" },
  ])
    expect(
      (await request("/api/organizations", "owner", { ...input, ...changes }))
        .status,
    ).toBe(400);
  const orgs: OrganizationSnapshot = await (
    await request("/api/organizations", "owner", input)
  ).json();
  const orgId = orgs.organizations[0].id;
  const invitation = (
    await (
      await request(`/api/organizations/${orgId}/invitations`, "owner", {
        email: "member@example.com",
        role: "member",
      })
    ).json()
  ).invitation;
  expect(
    (
      await request("/api/organizations/join", "unverified", {
        token: invitation.token,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request("/api/organizations/join", "other", {
        token: invitation.token,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request("/api/organizations/join", "member", {
        token: invitation.token,
      })
    ).status,
  ).toBe(200);
  expect(
    (await request(`/api/organizations/${orgId}/members`, "member")).status,
  ).toBe(403);
  expect(
    (
      await request(`/api/organizations/${orgId}/invitations`, "member", {
        email: "other@example.com",
        role: "admin",
      })
    ).status,
  ).toBe(403);
  const snapshot = await (
    await request("/api/state?mode=organizer", "member")
  ).json();
  expect(snapshot).toMatchObject({
    organizer: true,
    memberships: [{ role: "member", personId: "member" }],
    state: { mode: "organizer", events: [] },
  });
  const created = await (
    await request("/api/actions?mode=organizer", "member", {
      type: "CREATE_EVENT",
      event: eventInput(orgId),
    })
  ).json();
  expect(created.error).toBeUndefined();
  expect(calls.some((c) => c.actor === "member")).toBe(true);
  const id = created.createdId;
  expect(
    (
      await request("/api/actions?mode=organizer", "member", {
        type: "SUBMIT_EVENT_FOR_APPROVAL",
        eventId: id,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await request("/api/actions?mode=organizer", "member", {
        type: "REVIEW_EVENT_PUBLICATION",
        eventId: id,
        decision: "approve",
      })
    ).status,
  ).toBe(400);
  const approved = await request("/api/actions?mode=organizer", "owner", {
    type: "REVIEW_EVENT_PUBLICATION",
    eventId: id,
    decision: "approve",
  });
  expect(approved.status).toBe(200);
  expect(calls.some((c) => c.actor === "owner")).toBe(true);
  expect(
    (
      await request("/api/actions", "member", {
        type: "SUBMIT_APPLICATION",
        eventId: id,
        personId: "member",
        role: "Participant",
        motivation: "Join",
      })
    ).status,
  ).toBe(400);
  const people = (
    await (await request(`/api/organizations/${orgId}/members`)).json()
  ).members;
  expect(people).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        personId: "member",
        email: "member@example.com",
      }),
    ]),
  );
  const current = (await repository.read()).people.find(
    (p) => p.id === "member",
  )!;
  expect(current.onboarding?.status).toBe("required");
});

it("GET state scopes configured legacy organizers to unowned events and their own organization", async () => {
  const { store, dir } = await fileStore();
  const own = (await store.create("legacy-uid", input)).organizations[0];
  const other = (
    await store.create("other-uid", { ...input, name: "Private organization" })
  ).organizations[0];
  const repository = new FileRepository(join(dir, "state.json"));
  await repository.update((state) => {
    state.events.push(
      {
        ...state.events[0],
        id: "own-org-draft",
        organizationId: own.id,
        createdBy: "legacy-uid",
        status: "draft",
      },
      {
        ...state.events[0],
        id: "other-org-draft",
        organizationId: other.id,
        createdBy: "other-uid",
        status: "draft",
        title: "Private draft title",
      },
    );
    state.applications.push(
      {
        ...state.applications[0],
        id: "own-org-application",
        eventId: "own-org-draft",
        motivation: "Own private motivation",
      },
      {
        ...state.applications[0],
        id: "other-org-application",
        eventId: "other-org-draft",
        motivation: "Other private motivation",
      },
    );
    return { state };
  });
  const server = createApi({
    mode: "firebase",
    publicConfig: {},
    repository,
    organizationStore: store,
    organizerUids: new Set(["legacy-uid"]),
    authenticate: async (token) => {
      if (token !== "legacy") throw Error();
      return {
        uid: "legacy-uid",
        email: "legacy@example.com",
        emailVerified: true,
      };
    },
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No port");
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/state?mode=organizer`,
    { headers: { Authorization: "Bearer legacy" } },
  );
  expect(response.status).toBe(200);
  const snapshot = await response.json();
  expect(snapshot.organizer).toBe(true);
  expect(snapshot.state.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "own-org-draft" }),
      expect.objectContaining({ id: createSeedState().events[0].id }),
    ]),
  );
  expect(
    snapshot.state.events.some(
      (e: { id: string }) => e.id === "other-org-draft",
    ),
  ).toBe(false);
  expect(snapshot.state.applications).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "own-org-application",
        motivation: "Own private motivation",
      }),
      expect.objectContaining({ id: createSeedState().applications[0].id }),
    ]),
  );
  expect(
    snapshot.state.applications.some(
      (a: { id: string }) => a.id === "other-org-application",
    ),
  ).toBe(false);
  expect(JSON.stringify(snapshot)).not.toContain("Other private motivation");
  expect(JSON.stringify(snapshot)).not.toContain("Private draft title");
});
