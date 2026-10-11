import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSeedState } from "../src/seed";
import type { DemoState, Hackathon } from "../src/types";
import { execute, view, type Session } from "./service";
import { FileRepository } from "./repository";
import { validateDataset } from "./dataset";

const org: Session = {
  personId: "luka",
  organizer: true,
  mode: "organizer",
  demo: true,
};
const attendee = (personId: string): Session => ({
  ...org,
  personId,
  organizer: false,
  mode: "attendee",
});
function fixture() {
  const state = createSeedState();
  const template = state.people[0];
  state.people = [
    "luka",
    "best",
    "second",
    "third",
    "off",
    "unfinished",
    "unrelated",
    "ineligible",
  ].map((id) => ({
    ...structuredClone(template),
    id,
    name: id,
    skills: ["React"],
    interests: ["Web apps"],
    roles: ["Participant" as const],
    preferences: {
      goals: ["Learning" as const],
      kinds: ["meetup" as const],
      formats: ["Online" as const],
      location: "Belgrade",
      notify: id !== "off",
    },
    ...(id === "unfinished"
      ? {
          onboarding: {
            version: 1 as const,
            status: "required" as const,
            completed_at: null,
          },
        }
      : {}),
  }));
  state.people.find((p) => p.id === "second")!.preferences!.goals = ["Career"];
  state.people.find((p) => p.id === "third")!.skills = [];
  const unrelated = state.people.find((p) => p.id === "unrelated")!;
  unrelated.skills = [];
  unrelated.interests = ["Cooking"];
  state.people.find((p) => p.id === "ineligible")!.skills = ["Python"];
  state.events = [];
  state.teams = [];
  state.applications = [];
  state.invitations = [];
  state.notifications = [];
  state.connections = [];
  const { id: _id, publishedAt: _pub, ...base } = createSeedState().events[0];
  const event = {
    ...base,
    title: "Auto invite test",
    status: "open" as const,
    date: "2099-10-11",
    endDate: "2099-10-11",
    deadline: "2099-10-10",
    kind: "meetup" as const,
    format: "Online" as const,
    registration: "review" as const,
    minTeamSize: 1,
    maxTeamSize: 1,
    capacity: 10,
    topics: ["Web apps"],
    tags: ["Web apps"],
    eligibility: { requiredSkills: ["React"] },
    audience: {
      skills: ["React"],
      goals: ["Learning" as const],
      roles: [],
      levels: [],
    },
    autoInviteCount: 2,
  };
  return { state, event };
}
function publish(overrides: Partial<Hackathon> = {}) {
  const { state, event } = fixture();
  const result = execute(state, org, {
    type: "CREATE_EVENT",
    event: { ...event, ...overrides },
  });
  expect(result.error).toBeUndefined();
  return result;
}
function respond(
  state: DemoState,
  personId: string,
  response: "accepted" | "declined" = "accepted",
) {
  const invitation = state.eventInvitations!.find(
    (i) => i.personId === personId,
  )!;
  return execute(state, attendee(personId), {
    type: "RESPOND_EVENT_INVITATION",
    invitationId: invitation.id,
    response,
  });
}
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("organizer event auto-invitations", () => {
  it("invites the requested highest ranked suitable opted-in completed profiles", () => {
    const result = publish();
    expect(result.state.eventInvitations?.map((i) => i.personId)).toEqual([
      "best",
      "second",
    ]);
    expect(result.state.eventInvitations?.[0]).toMatchObject({
      eventId: result.createdId,
      fromId: "luka",
      status: "pending",
    });
    expect(result.state.eventInvitations?.[0].reasons.length).toBeGreaterThan(
      0,
    );
    expect(
      result.state.notifications.filter(
        (n) => n.title === "An event invitation",
      ),
    ).toHaveLength(2);
    expect(result.state.applications).toHaveLength(0);
    expect(result.message).toMatch(/2 of 2/i);
  });
  it("reports a shortfall without filling with unsuitable or opted-out people", () => {
    const result = publish({ autoInviteCount: 8 });
    expect(result.state.eventInvitations?.map((i) => i.personId)).toEqual([
      "best",
      "second",
    ]);
    expect(result.message).toMatch(/2 of 8/i);
  });
  it("does nothing when disabled", () => {
    expect(
      publish({ autoInviteCount: 0 }).state.eventInvitations ?? [],
    ).toHaveLength(0);
  });
  it("waits for publication and never resends on edits or reopening", () => {
    const draft = publish({ status: "draft" });
    expect(draft.state.eventInvitations ?? []).toHaveLength(0);
    const open = execute(draft.state, org, {
      type: "UPDATE_EVENT",
      eventId: draft.createdId,
      changes: { status: "open" },
    });
    expect(open.state.eventInvitations).toHaveLength(2);
    const edit = execute(open.state, org, {
      type: "UPDATE_EVENT",
      eventId: draft.createdId,
      changes: { theme: "Changed", status: "draft" },
    });
    const reopen = execute(edit.state, org, {
      type: "UPDATE_EVENT",
      eventId: draft.createdId,
      changes: { status: "open" },
    });
    expect(reopen.state.eventInvitations).toHaveLength(2);
  });
  it("rejects changing the outreach count after publication", () => {
    const result = publish();
    expect(
      execute(result.state, org, {
        type: "UPDATE_EVENT",
        eventId: result.createdId,
        changes: { autoInviteCount: 5 },
      }).error,
    ).toMatch(/publication|published/i);
  });
  it.each([-1, 1.5, 11, 5001])(
    "rejects an invalid count %s",
    (autoInviteCount) => {
      const { state, event } = fixture();
      expect(
        execute(state, org, {
          type: "CREATE_EVENT",
          event: { ...event, autoInviteCount },
        }).error,
      ).toBeDefined();
    },
  );
  it("respects occupied places and excludes applicants before ranking", () => {
    const draft = publish({ status: "draft", capacity: 2 });
    draft.state.applications.push({
      id: "existing",
      eventId: draft.createdId!,
      personId: "best",
      status: "pending",
      role: "Participant",
      motivation: "",
      submittedAt: "",
    });
    const result = execute(draft.state, org, {
      type: "UPDATE_EVENT",
      eventId: draft.createdId,
      changes: { status: "open" },
    });
    expect(result.state.eventInvitations?.map((i) => i.personId)).toEqual([
      "second",
    ]);
  });
  it("supports organization admin approval and excludes the event creator", () => {
    const { state, event } = fixture();
    const common = {
      ...org,
      legacyOrganizer: false,
      organizations: [
        {
          id: "lab",
          name: "Lab",
          city: "",
          website: "",
          description: "",
          created_at: "",
        },
      ],
    };
    const member = {
      ...common,
      personId: "best",
      memberships: [
        {
          id: "member",
          organizationId: "lab",
          personId: "best",
          role: "member" as const,
          joined_at: "",
        },
      ],
    };
    const admin = {
      ...common,
      memberships: [
        {
          id: "admin",
          organizationId: "lab",
          personId: "luka",
          role: "admin" as const,
          joined_at: "",
        },
      ],
    };
    const draft = execute(state, member, {
      type: "CREATE_EVENT",
      event: { ...event, organizationId: "lab" },
    });
    expect(draft.error).toBeUndefined();
    expect(draft.state.eventInvitations ?? []).toHaveLength(0);
    expect(
      execute(draft.state, member, {
        type: "REVIEW_EVENT_PUBLICATION",
        eventId: draft.createdId,
        decision: "approve",
      }).error,
    ).toBeDefined();
    const result = execute(draft.state, admin, {
      type: "REVIEW_EVENT_PUBLICATION",
      eventId: draft.createdId,
      decision: "approve",
    });
    expect(result.error).toBeUndefined();
    expect(result.state.eventInvitations?.map((i) => i.personId)).toEqual([
      "second",
    ]);
    expect(view(result.state, member).eventInvitations ?? []).toHaveLength(0);
    expect(view(result.state, admin).eventInvitations).toHaveLength(1);
  });
  it("does not publish invitations for expired registration", () => {
    const result = publish({
      date: "2000-01-02",
      endDate: "2000-01-02",
      deadline: "2000-01-01",
    });
    expect(result.state.eventInvitations ?? []).toHaveLength(0);
  });
  it("shows recipient-only invites and never exposes another recipient's reasons", () => {
    const result = publish();
    expect(
      view(result.state, attendee("best")).eventInvitations?.map(
        (i) => i.personId,
      ),
    ).toEqual(["best"]);
    expect(
      view(result.state, attendee("off")).eventInvitations ?? [],
    ).toHaveLength(0);
    expect(view(result.state, org).eventInvitations).toHaveLength(2);
  });
  it("allows recipient acceptance through normal review rules", () => {
    const result = respond(publish().state, "best");
    expect(result.error).toBeUndefined();
    expect(result.state.applications).toHaveLength(1);
    expect(result.state.applications[0]).toMatchObject({
      personId: "best",
      status: "pending",
      role: "Participant",
    });
    expect(result.state.teams).toHaveLength(0);
    expect(
      result.state.eventInvitations?.find((i) => i.personId === "best")?.status,
    ).toBe("accepted");
    expect(respond(result.state, "best").error).toMatch(/answered/i);
  });
  it("confirms immediately only for automatic individual registration", () => {
    expect(
      respond(publish({ registration: "automatic" }).state, "best").state
        .applications[0]?.status,
    ).toBe("accepted");
    expect(
      respond(
        publish({
          kind: "hackathon",
          minTeamSize: 2,
          maxTeamSize: 4,
          registration: "automatic",
        }).state,
        "best",
      ).state.applications[0]?.status,
    ).toBe("pending");
  });
  it("declines without admission and rejects another person responding", () => {
    const initial = publish().state;
    const invite = initial.eventInvitations![0];
    expect(
      execute(initial, attendee("off"), {
        type: "RESPOND_EVENT_INVITATION",
        invitationId: invite.id,
        response: "declined",
      }).error,
    ).toMatch(/own|recipient/i);
    const result = respond(initial, "best", "declined");
    expect(result.error).toBeUndefined();
    expect(result.state.applications).toHaveLength(0);
    expect(result.state.eventInvitations![0].status).toBe("declined");
  });
  it.each(["deadline", "eligibility", "capacity"])(
    "rechecks %s at acceptance and preserves pending invitations on failure",
    (changed) => {
      const result = publish();
      const e = result.state.events[0];
      if (changed === "deadline") e.deadline = "2000-01-01";
      if (changed === "eligibility")
        e.eligibility = { requiredSkills: ["Python"] };
      if (changed === "capacity") {
        e.capacity = 1;
        result.state.applications.push({
          id: "full",
          eventId: e.id,
          personId: "third",
          role: "Participant",
          status: "accepted",
          motivation: "",
          submittedAt: "",
        });
      }
      const response = respond(result.state, "best");
      expect(response.error).toBeDefined();
      expect(response.state.eventInvitations![0].status).toBe("pending");
      expect(
        response.state.applications.some((a) => a.personId === "best"),
      ).toBe(false);
      expect(respond(result.state, "best", "declined").error).toBeUndefined();
    },
  );
  it("does not duplicate existing applications when an invitee applies first", () => {
    const result = publish();
    const applied = execute(result.state, attendee("best"), {
      type: "SUBMIT_APPLICATION",
      eventId: result.createdId,
      personId: "best",
      role: "Participant",
      motivation: "Already applied",
    });
    expect(applied.error).toBeUndefined();
    const accepted = respond(applied.state, "best");
    expect(accepted.error).toBeUndefined();
    expect(accepted.state.applications).toHaveLength(1);
  });
  it("persists invitations and accepts them in a fresh repository instance", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gevents-event-invites-"));
    dirs.push(dir);
    const filename = join(dir, "state.json");
    const saved = publish();
    const repo = new FileRepository(filename);
    await repo.update(() => saved);
    const next = new FileRepository(filename);
    const restored = await next.read();
    expect(restored.eventInvitations).toHaveLength(2);
    const accepted = await next.update((state) => respond(state, "best"));
    expect(accepted.error).toBeUndefined();
    expect(
      (await new FileRepository(filename).read()).eventInvitations![0].status,
    ).toBe("accepted");
    const exported = await next.read();
    exported.people.forEach((p) => {
      delete p.onboarding;
    });
    exported.events.forEach((e) => {
      Reflect.deleteProperty(e, "updated_at");
    });
    expect(validateDataset(exported).eventInvitations).toHaveLength(2);
  });
  it("serializes competing acceptances so the last place is never oversubscribed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gevents-event-capacity-"));
    dirs.push(dir);
    const repo = new FileRepository(join(dir, "state.json"));
    const initial = publish({ capacity: 2 });
    initial.state.events[0].capacity = 1;
    await repo.update(() => initial);
    const responses = await Promise.all(
      ["best", "second"].map((personId) =>
        repo.update((state) => respond(state, personId)),
      ),
    );
    expect(responses.filter((r) => !r.error)).toHaveLength(1);
    expect(responses.filter((r) => r.error)).toHaveLength(1);
    expect((await repo.read()).applications).toHaveLength(1);
  });
});
