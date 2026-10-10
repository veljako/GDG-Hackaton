import { describe, expect, it } from "vitest";
import {
  admissionFor,
  isConnected,
  memberState,
  teamStatus,
  transition,
} from "./domain";
import { createSeedState } from "./seed";
import type { Action, DemoState, Hackathon, Role } from "./types";

function apply(state: DemoState, action: Action): DemoState {
  const result = transition(state, action);
  expect(result.error).toBeUndefined();
  return result.state;
}
const team = (s: DemoState, id = "team-4") => s.teams.find((t) => t.id === id)!;
const as = (s: DemoState, personId: string) =>
  apply(s, { type: "SET_PERSON", personId });
const organize = (s: DemoState) =>
  apply(s, { type: "SET_MODE", mode: "organizer" });
function invite(
  s: DemoState,
  personId: string,
  teamId = "team-4",
  fromId = s.currentPersonId,
) {
  return apply(s, { type: "INVITE_PERSON", teamId, personId, fromId });
}

describe("fictional starting state", () => {
  it("starts Luka on a confirmed GDG team with room and an outsider to review", () => {
    const s = createSeedState();
    expect(s.people).toHaveLength(12);
    expect(s.events).toHaveLength(7);
    expect(s.teams).toHaveLength(4);
    expect(s.currentPersonId).toBe("luka");
    expect(s.mode).toBe("attendee");
    expect(team(s).memberIds).toEqual(["luka", "mila"]);
    expect(teamStatus(s, team(s))).toBe("confirmed");
    expect(admissionFor(s, "gdg-belgrade", "zarko")?.status).toBe("pending");
    expect(
      s.invitations.filter(
        (i) => i.teamId === "team-4" && i.status === "pending",
      ),
    ).toHaveLength(0);
    expect(s.people.every((p) => p.avatar === `/avatars/${p.id}.jpg`)).toBe(
      true,
    );
  });
  it("returns independent fresh seeds", () => {
    const first = createSeedState();
    first.people[0].skills.push("mutated");
    expect(createSeedState().people[0].skills).not.toContain("mutated");
  });
});

describe("invitation and admission independence", () => {
  it("lets a non-captain invite an outsider and keeps the team confirmed while pending", () => {
    let s = invite(as(createSeedState(), "mila"), "teo");
    const invitation = s.invitations.find(
      (i) => i.teamId === "team-4" && i.personId === "teo",
    )!;
    expect(team(s).memberIds).not.toContain("teo");
    s = apply(as(s, "teo"), {
      type: "RESPOND_INVITATION",
      invitationId: invitation.id,
      response: "accepted",
    });
    expect(team(s).memberIds).toContain("teo");
    expect(admissionFor(s, "gdg-belgrade", "teo")?.status).toBe("pending");
    expect(memberState(s, team(s), "teo")).toBe("pending");
    expect(teamStatus(s, team(s))).toBe("confirmed");
    const app = admissionFor(s, "gdg-belgrade", "teo")!;
    s = apply(organize(s), {
      type: "REVIEW_APPLICATION",
      applicationId: app.id,
      status: "accepted",
    });
    expect(memberState(s, team(s), "teo")).toBe("accepted");
  });
  it("joins an already accepted invitee without another application", () => {
    let s = invite(createSeedState(), "marko");
    const invitation = s.invitations.find(
      (i) => i.personId === "marko" && i.teamId === "team-4",
    )!;
    const count = s.applications.length;
    s = apply(as(s, "marko"), {
      type: "RESPOND_INVITATION",
      invitationId: invitation.id,
      response: "accepted",
    });
    expect(memberState(s, team(s), "marko")).toBe("accepted");
    expect(s.applications).toHaveLength(count);
    expect(admissionFor(s, "gdg-belgrade", "marko")?.teamId).toBe("team-4");
  });
  it("accepting Luka’s seeded Gemini invitation submits his event application", () => {
    const s = createSeedState();
    const invitation = s.invitations.find(
      (i) => i.personId === "luka" && i.status === "pending",
    )!;
    const next = apply(s, {
      type: "RESPOND_INVITATION",
      invitationId: invitation.id,
      response: "accepted",
    });
    expect(admissionFor(next, "gemini-lab", "luka")?.status).toBe("pending");
    expect(team(next, "sunday-builders").memberIds).toContain("luka");
  });
  it("reserves pending invitation seats and frees them on decline", () => {
    let s = invite(invite(createSeedState(), "teo"), "zarko");
    expect(
      transition(s, {
        type: "INVITE_PERSON",
        teamId: "team-4",
        personId: "marko",
        fromId: "luka",
      }).error,
    ).toMatch(/full|seat|capacity/i);
    const i = s.invitations.find(
      (i) => i.personId === "teo" && i.teamId === "team-4",
    )!;
    s = apply(as(s, "teo"), {
      type: "RESPOND_INVITATION",
      invitationId: i.id,
      response: "declined",
    });
    expect(
      invite(as(s, "luka"), "marko").invitations.some(
        (i) => i.personId === "marko" && i.status === "pending",
      ),
    ).toBe(true);
  });
  it("rejects duplicate invites and invitations to someone on another event team", () => {
    const s = invite(createSeedState(), "teo");
    expect(
      transition(s, {
        type: "INVITE_PERSON",
        teamId: "team-4",
        personId: "teo",
        fromId: "luka",
      }).error,
    ).toMatch(/already|invitation/i);
    expect(
      transition(createSeedState(), {
        type: "INVITE_PERSON",
        teamId: "team-4",
        personId: "ana",
        fromId: "luka",
      }).error,
    ).toMatch(/team/i);
  });
  it("requires the invite recipient to respond and a current member to invite", () => {
    const s = invite(createSeedState(), "teo");
    const i = s.invitations.find((i) => i.personId === "teo")!;
    expect(
      transition(s, {
        type: "RESPOND_INVITATION",
        invitationId: i.id,
        response: "accepted",
      }).error,
    ).toBeTruthy();
    expect(
      transition(as(createSeedState(), "teo"), {
        type: "INVITE_PERSON",
        teamId: "team-4",
        personId: "marko",
        fromId: "teo",
      }).error,
    ).toBeTruthy();
  });
  it("retains rejected admission when a person accepts a team invitation", () => {
    let s = createSeedState();
    s = apply(organize(s), {
      type: "REVIEW_APPLICATION",
      applicationId: admissionFor(s, "gdg-belgrade", "zarko")!.id,
      status: "rejected",
    });
    s = invite(apply(s, { type: "SET_MODE", mode: "attendee" }), "zarko");
    const i = s.invitations.find((i) => i.personId === "zarko")!;
    s = apply(as(s, "zarko"), {
      type: "RESPOND_INVITATION",
      invitationId: i.id,
      response: "accepted",
    });
    expect(memberState(s, team(s), "zarko")).toBe("rejected");
  });
});

describe("applications and event capacity", () => {
  const submit = (s: DemoState, eventId = "design-sprint") =>
    transition(s, {
      type: "SUBMIT_APPLICATION",
      eventId,
      personId: s.currentPersonId,
      role: "Participant",
      motivation: "Build a useful community tool.",
    });
  it("submits a solo application once without mutating the input", () => {
    const s = createSeedState();
    const snapshot = JSON.stringify(s);
    const result = submit(s);
    expect(result.error).toBeUndefined();
    expect(admissionFor(result.state, "design-sprint", "luka")?.status).toBe(
      "pending",
    );
    expect(JSON.stringify(s)).toBe(snapshot);
    expect(submit(result.state).error).toMatch(/already|application/i);
  });
  it("blocks closed-event applications and unknown ids without throwing", () => {
    const s = createSeedState();
    expect(submit(s, "build-2025").error).toMatch(/open|closed|past/i);
    expect(submit(s, "missing").error).toBeTruthy();
    expect(
      transition(s, { type: "SET_PERSON", personId: "missing" }).error,
    ).toBeTruthy();
  });
  it("reserves event places for pending applicants", () => {
    const s = createSeedState();
    s.events.find((e) => e.id === "design-sprint")!.capacity = 1;
    const first = submit(s).state;
    expect(submit(as(first, "teo")).error).toMatch(/full|capacity|place/i);
  });
  it("withdraws own pending application and allows a fresh application", () => {
    let s = submit(createSeedState()).state;
    const id = admissionFor(s, "design-sprint", "luka")!.id;
    expect(
      transition(as(s, "teo"), {
        type: "WITHDRAW_APPLICATION",
        applicationId: id,
      }).error,
    ).toBeTruthy();
    s = apply(s, { type: "WITHDRAW_APPLICATION", applicationId: id });
    expect(admissionFor(s, "design-sprint", "luka")).toBeUndefined();
    expect(submit(s).error).toBeUndefined();
  });
  it("requires organizer mode for decisions and permits revised decisions", () => {
    const s = createSeedState();
    const id = admissionFor(s, "gdg-belgrade", "zarko")!.id;
    expect(
      transition(s, {
        type: "REVIEW_APPLICATION",
        applicationId: id,
        status: "accepted",
      }).error,
    ).toBeTruthy();
    const rejected = apply(organize(s), {
      type: "REVIEW_APPLICATION",
      applicationId: id,
      status: "rejected",
    });
    const accepted = apply(rejected, {
      type: "REVIEW_APPLICATION",
      applicationId: id,
      status: "accepted",
    });
    expect(admissionFor(accepted, "gdg-belgrade", "zarko")?.status).toBe(
      "accepted",
    );
  });
  it("does not accept a previously rejected applicant into a full event", () => {
    let s = organize(createSeedState());
    const id = admissionFor(s, "gdg-belgrade", "zarko")!.id;
    s = apply(s, {
      type: "REVIEW_APPLICATION",
      applicationId: id,
      status: "rejected",
    });
    s.events.find((e) => e.id === "gdg-belgrade")!.capacity =
      s.applications.filter(
        (a) => a.eventId === "gdg-belgrade" && a.status !== "rejected",
      ).length;
    expect(
      transition(s, {
        type: "REVIEW_APPLICATION",
        applicationId: id,
        status: "accepted",
      }).error,
    ).toMatch(/full|capacity|place/i);
  });
  it("cannot submit for another actor or associate with a team without membership", () => {
    const s = createSeedState();
    expect(
      transition(s, {
        type: "SUBMIT_APPLICATION",
        eventId: "design-sprint",
        personId: "teo",
        role: "Participant",
        motivation: "",
      }).error,
    ).toBeTruthy();
    expect(
      transition(as(s, "teo"), {
        type: "SUBMIT_APPLICATION",
        eventId: "gdg-belgrade",
        personId: "teo",
        teamId: "team-4",
        role: "Participant",
        motivation: "",
      }).error,
    ).toBeTruthy();
  });
});

describe("teams and fresh consent", () => {
  it("creates a forming team for an accepted solo applicant and rejects a second team", () => {
    const s = as(createSeedState(), "marko");
    const action: Action = {
      type: "CREATE_TEAM",
      eventId: "gdg-belgrade",
      name: "Good tools",
      description: "For communities",
      skills: ["React"],
      personId: "marko",
    };
    const result = transition(s, action);
    expect(result.error).toBeUndefined();
    expect(teamStatus(result.state, team(result.state, result.createdId))).toBe(
      "forming",
    );
    expect(transition(result.state, action).error).toMatch(/team/i);
  });
  it("creates a pending application with a new outsider team", () => {
    const s = as(createSeedState(), "teo");
    const result = transition(s, {
      type: "CREATE_TEAM",
      eventId: "design-sprint",
      name: "Teo builds",
      description: "",
      skills: [],
      personId: "teo",
    });
    expect(result.error).toBeUndefined();
    expect(admissionFor(result.state, "design-sprint", "teo")?.teamId).toBe(
      result.createdId,
    );
    expect(teamStatus(result.state, team(result.state, result.createdId))).toBe(
      "pending",
    );
  });
  it("reuses an archived team for a fresh event with invitations, preserving history", () => {
    const s = createSeedState();
    const result = transition(s, {
      type: "REUSE_TEAM",
      teamId: "weekend-merge",
      eventId: "design-sprint",
      personId: "luka",
    });
    expect(result.error).toBeUndefined();
    expect(team(result.state, result.createdId).memberIds).toEqual(["luka"]);
    expect(
      result.state.invitations
        .filter((i) => i.teamId === result.createdId)
        .map((i) => i.personId)
        .sort(),
    ).toEqual(["ana", "marko"]);
    expect(team(result.state, "weekend-merge")).toEqual(
      team(s, "weekend-merge"),
    );
  });
  it("rejects reuse into the same event or a team too large for the destination", () => {
    const s = createSeedState();
    expect(
      transition(s, {
        type: "REUSE_TEAM",
        teamId: "team-4",
        eventId: "gdg-belgrade",
        personId: "luka",
      }).error,
    ).toBeTruthy();
    s.events.find((e) => e.id === "design-sprint")!.maxTeamSize = 2;
    expect(
      transition(s, {
        type: "REUSE_TEAM",
        teamId: "weekend-merge",
        eventId: "design-sprint",
        personId: "luka",
      }).error,
    ).toMatch(/size|capacity|place/i);
  });
  it("lets a member leave, detaches the application, and transfers captain responsibility", () => {
    const s = apply(createSeedState(), {
      type: "REMOVE_MEMBER",
      teamId: "team-4",
      personId: "luka",
      actorId: "luka",
    });
    expect(team(s).memberIds).toEqual(["mila"]);
    expect(team(s).captainId).toBe("mila");
    expect(admissionFor(s, "gdg-belgrade", "luka")?.teamId).toBeUndefined();
    expect(teamStatus(s, team(s))).toBe("forming");
  });
  it("blocks arbitrary removal and archived team modification", () => {
    const s = createSeedState();
    expect(
      transition(as(s, "teo"), {
        type: "REMOVE_MEMBER",
        teamId: "team-4",
        personId: "mila",
        actorId: "teo",
      }).error,
    ).toBeTruthy();
    expect(
      transition(s, {
        type: "INVITE_PERSON",
        teamId: "weekend-merge",
        personId: "teo",
        fromId: "luka",
      }).error,
    ).toBeTruthy();
  });
});

describe("atomic applications when creating or reusing a team", () => {
  it("creates exactly one pending application with a custom role and motivation", () => {
    const s = as(createSeedState(), "teo");
    const before = JSON.stringify(s);
    const result = transition(s, {
      type: "CREATE_TEAM",
      eventId: "design-sprint",
      name: "Thoughtful Tools",
      description: "A small community prototype.",
      skills: ["Flutter"],
      personId: "teo",
      role: "Speaker",
      motivation:
        "  I want to share what I learned from my first mobile app.  ",
    });
    expect(result.error).toBeUndefined();
    expect(result.createdId).toBeDefined();
    expect(result.state.applications).toHaveLength(s.applications.length + 1);
    const matching = result.state.applications.filter(
      (a) => a.eventId === "design-sprint" && a.personId === "teo",
    );
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({
      status: "pending",
      teamId: result.createdId,
      role: "Speaker",
      motivation: "I want to share what I learned from my first mobile app.",
    });
    expect(team(result.state, result.createdId).memberIds).toEqual(["teo"]);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("reuses a team with exactly one custom pending application and fresh invitations", () => {
    const s = createSeedState();
    const result = transition(s, {
      type: "REUSE_TEAM",
      teamId: "weekend-merge",
      eventId: "design-sprint",
      personId: "luka",
      role: "Mentor",
      motivation: "  I would like to mentor our old crew as we build again.  ",
    });
    expect(result.error).toBeUndefined();
    expect(result.createdId).toBeDefined();
    expect(result.state.applications).toHaveLength(s.applications.length + 1);
    const matching = result.state.applications.filter(
      (a) => a.eventId === "design-sprint" && a.personId === "luka",
    );
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({
      status: "pending",
      teamId: result.createdId,
      role: "Mentor",
      motivation: "I would like to mentor our old crew as we build again.",
    });
    expect(
      result.state.applications.filter(
        (a) =>
          a.eventId === "design-sprint" &&
          ["marko", "ana"].includes(a.personId),
      ),
    ).toHaveLength(0);
    expect(
      result.state.invitations
        .filter((i) => i.teamId === result.createdId && i.status === "pending")
        .map((i) => i.personId)
        .sort(),
    ).toEqual(["ana", "marko"]);
    expect(team(result.state, "weekend-merge")).toEqual(
      team(s, "weekend-merge"),
    );
  });

  it("retains existing accepted admission when creating a team with custom application content", () => {
    const s = as(createSeedState(), "marko");
    const admission = admissionFor(s, "gdg-belgrade", "marko")!;
    const result = transition(s, {
      type: "CREATE_TEAM",
      eventId: "gdg-belgrade",
      name: "API Friends",
      description: "Useful backend tools.",
      skills: ["Python"],
      personId: "marko",
      role: "Mentor",
      motivation: "I can help new teams build a reliable API.",
    });
    expect(result.error).toBeUndefined();
    expect(result.state.applications).toHaveLength(s.applications.length);
    expect(
      result.state.applications.filter(
        (a) => a.eventId === "gdg-belgrade" && a.personId === "marko",
      ),
    ).toHaveLength(1);
    expect(admissionFor(result.state, "gdg-belgrade", "marko")).toMatchObject({
      id: admission.id,
      status: "accepted",
      submittedAt: admission.submittedAt,
      teamId: result.createdId,
      role: "Mentor",
      motivation: "I can help new teams build a reliable API.",
    });
    expect(admissionFor(s, "gdg-belgrade", "marko")).toEqual(admission);
    expect(admission.teamId).toBeUndefined();
  });

  it.each(["CREATE_TEAM", "REUSE_TEAM"] as const)(
    "rejects an invalid custom role atomically for %s",
    (type) => {
      const s = createSeedState();
      const snapshot = JSON.stringify(s);
      const common = {
        eventId: "design-sprint",
        personId: "luka",
        role: "Sponsor" as Role,
        motivation: "A custom motivation that should not be saved.",
      };
      const action: Action =
        type === "CREATE_TEAM"
          ? {
              type,
              ...common,
              name: "Invalid role team",
              description: "",
              skills: [],
            }
          : { type, ...common, teamId: "weekend-merge" };
      const result = transition(s, action);
      expect(result.error).toMatch(/role/i);
      expect(result.createdId).toBeUndefined();
      expect(result.state).toBe(s);
      expect(JSON.stringify(s)).toBe(snapshot);
      expect(
        admissionFor(result.state, "design-sprint", "luka"),
      ).toBeUndefined();
    },
  );
});

describe("event and profile editing", () => {
  it("creates and edits events only for organizers", () => {
    const s = createSeedState();
    const { id: _id, ...event } = s.events[0];
    const action: Action = {
      type: "CREATE_EVENT",
      event: { ...event, title: "New community hack" },
    };
    expect(transition(s, action).error).toBeTruthy();
    const created = transition(organize(s), action);
    expect(created.error).toBeUndefined();
    const edited = apply(created.state, {
      type: "UPDATE_EVENT",
      eventId: created.createdId!,
      changes: { title: "Edited hack" },
    });
    expect(edited.events.find((e) => e.id === created.createdId)?.title).toBe(
      "Edited hack",
    );
  });
  it("validates bounds, dates, immutable ids and occupied team capacity", () => {
    const s = organize(createSeedState());
    const changes: Partial<Hackathon>[] = [
      { minTeamSize: 5 },
      { capacity: 0 },
      { date: "bad date" },
      { id: "other" },
      { maxTeamSize: 1 },
    ];
    changes.forEach((change) =>
      expect(
        transition(s, {
          type: "UPDATE_EVENT",
          eventId: "gdg-belgrade",
          changes: change,
        }).error,
      ).toBeTruthy(),
    );
  });
  it("edits only the current profile and preserves identity", () => {
    const s = createSeedState();
    const result = transition(s, {
      type: "UPDATE_PROFILE",
      personId: "luka",
      changes: {
        bio: "I build useful tools.",
        skills: ["React", "TypeScript"],
        cv: "luka-cv.pdf",
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.state.people.find((p) => p.id === "luka")?.cv).toBe(
      "luka-cv.pdf",
    );
    expect(
      transition(s, {
        type: "UPDATE_PROFILE",
        personId: "mila",
        changes: { bio: "changed" },
      }).error,
    ).toBeTruthy();
    expect(
      transition(s, {
        type: "UPDATE_PROFILE",
        personId: "luka",
        changes: { id: "new-id" },
      }).error,
    ).toBeTruthy();
  });
});

describe("local social and notices", () => {
  it("normalizes connections and toggles in either direction", () => {
    let s = apply(createSeedState(), {
      type: "TOGGLE_CONNECTION",
      personId: "luka",
      otherId: "teo",
    });
    expect(s.connections).toContain("luka:teo");
    expect(isConnected(s, "teo", "luka")).toBe(true);
    s = apply(as(s, "teo"), {
      type: "TOGGLE_CONNECTION",
      personId: "teo",
      otherId: "luka",
    });
    expect(isConnected(s, "luka", "teo")).toBe(false);
    expect(
      transition(s, {
        type: "TOGGLE_CONNECTION",
        personId: "teo",
        otherId: "teo",
      }).error,
    ).toBeTruthy();
  });
  it("marks only the actor notices read and reset restores initial state", () => {
    const s = invite(createSeedState(), "teo");
    const next = apply(s, {
      type: "MARK_NOTIFICATIONS_READ",
      personId: "luka",
    });
    expect(
      next.notifications
        .filter((n) => n.personId === "luka")
        .every((n) => n.read),
    ).toBe(true);
    expect(next.notifications.find((n) => n.personId === "teo")?.read).toBe(
      false,
    );
    expect(apply(next, { type: "RESET" })).toEqual(createSeedState());
  });
  it("returns the unchanged state on invalid actions", () => {
    const s = createSeedState();
    const snapshot = JSON.stringify(s);
    const result = transition(s, {
      type: "INVITE_PERSON",
      teamId: "missing",
      personId: "missing",
      fromId: "missing",
    });
    expect(result.error).toBeTruthy();
    expect(result.state).toBe(s);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe("reservation consistency and malformed edits", () => {
  it("lets any team member cancel a pending invite and release its place", () => {
    let s = invite(invite(createSeedState(), "teo"), "zarko");
    const i = s.invitations.find((i) => i.personId === "teo")!;
    expect(
      transition(as(s, "marko"), {
        type: "CANCEL_INVITATION",
        invitationId: i.id,
        actorId: "marko",
      }).error,
    ).toBeTruthy();
    s = apply(as(s, "mila"), {
      type: "CANCEL_INVITATION",
      invitationId: i.id,
      actorId: "mila",
    });
    expect(
      s.invitations.find((candidate) => candidate.id === i.id)?.status,
    ).toBe("declined");
    expect(
      s.notifications.some(
        (n) => n.personId === "teo" && /cancel/i.test(n.title),
      ),
    ).toBe(true);
    expect(
      invite(as(s, "luka"), "marko").invitations.some(
        (i) => i.personId === "marko" && i.status === "pending",
      ),
    ).toBe(true);
    expect(
      transition(s, {
        type: "CANCEL_INVITATION",
        invitationId: i.id,
        actorId: "mila",
      }).error,
    ).toBeTruthy();
  });
  it("blocks outsider acceptance into a full event without consuming the invitation", () => {
    let s = invite(createSeedState(), "teo");
    s.events.find((e) => e.id === "gdg-belgrade")!.capacity =
      s.applications.filter(
        (a) => a.eventId === "gdg-belgrade" && a.status !== "rejected",
      ).length;
    s = as(s, "teo");
    const invitation = s.invitations.find((i) => i.personId === "teo")!;
    const result = transition(s, {
      type: "RESPOND_INVITATION",
      invitationId: invitation.id,
      response: "accepted",
    });
    expect(result.error).toMatch(/full|place/i);
    expect(
      result.state.invitations.find((i) => i.id === invitation.id)?.status,
    ).toBe("pending");
    expect(team(result.state).memberIds).not.toContain("teo");
    expect(admissionFor(result.state, "gdg-belgrade", "teo")).toBeUndefined();
  });
  it("releases competing invitations when a person joins one event team", () => {
    let s = invite(createSeedState(), "teo");
    s = invite(as(s, "ana"), "teo", "byte-club");
    const invitation = s.invitations.find(
      (i) => i.personId === "teo" && i.teamId === "team-4",
    )!;
    s = apply(as(s, "teo"), {
      type: "RESPOND_INVITATION",
      invitationId: invitation.id,
      response: "accepted",
    });
    expect(
      s.invitations.find(
        (i) => i.personId === "teo" && i.teamId === "byte-club",
      )?.status,
    ).toBe("declined");
    expect(
      s.teams.filter(
        (t) => t.eventId === "gdg-belgrade" && t.memberIds.includes("teo"),
      ),
    ).toHaveLength(1);
  });
  it("removes pending membership when its application is withdrawn", () => {
    let s = invite(createSeedState(), "teo");
    const invitation = s.invitations.find((i) => i.personId === "teo")!;
    s = apply(as(s, "teo"), {
      type: "RESPOND_INVITATION",
      invitationId: invitation.id,
      response: "accepted",
    });
    s = apply(s, {
      type: "WITHDRAW_APPLICATION",
      applicationId: admissionFor(s, "gdg-belgrade", "teo")!.id,
    });
    expect(team(s).memberIds).not.toContain("teo");
    expect(admissionFor(s, "gdg-belgrade", "teo")).toBeUndefined();
    expect(teamStatus(s, team(s))).toBe("confirmed");
  });
  it("recomputes confirmed team status when organizer revises a member decision", () => {
    const s = organize(createSeedState());
    const result = apply(s, {
      type: "REVIEW_APPLICATION",
      applicationId: admissionFor(s, "gdg-belgrade", "mila")!.id,
      status: "rejected",
    });
    expect(teamStatus(result, team(result))).toBe("forming");
    expect(team(result).memberIds).toContain("mila");
    expect(memberState(result, team(result), "mila")).toBe("rejected");
  });
  it("cannot lower maximum team size below reserved seats", () => {
    const s = organize(invite(invite(createSeedState(), "teo"), "zarko"));
    expect(
      transition(s, {
        type: "UPDATE_EVENT",
        eventId: "gdg-belgrade",
        changes: { maxTeamSize: 3 },
      }).error,
    ).toMatch(/reserved|size|place/i);
  });
  it("rejects undefined required edits without throwing", () => {
    const s = createSeedState();
    expect(
      transition(s, {
        type: "UPDATE_PROFILE",
        personId: "luka",
        changes: { name: undefined },
      }).error,
    ).toBeTruthy();
    expect(
      transition(organize(s), {
        type: "UPDATE_EVENT",
        eventId: "gdg-belgrade",
        changes: { title: undefined },
      }).error,
    ).toBeTruthy();
  });
  it("rejects calendar dates that only parse by rolling into another month", () => {
    const s = organize(createSeedState());
    expect(
      transition(s, {
        type: "UPDATE_EVENT",
        eventId: "gdg-belgrade",
        changes: { deadline: "2026-02-31" },
      }).error,
    ).toBeTruthy();
  });
  it("produces deterministic results for the same state and action", () => {
    const s = createSeedState();
    const action: Action = {
      type: "INVITE_PERSON",
      teamId: "team-4",
      personId: "teo",
      fromId: "luka",
    };
    expect(transition(s, action)).toEqual(transition(s, action));
  });
});
