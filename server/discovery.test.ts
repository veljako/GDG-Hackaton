import { describe, it, expect } from "vitest";
import { createSeedState } from "../src/seed";
import { execute, view } from "./service";

const org = {
  personId: "luka",
  organizer: true,
  mode: "organizer" as const,
  demo: true,
};
const attendee = { ...org, organizer: false, mode: "attendee" as const };
function fixture() {
  const s = createSeedState();
  s.people[0].preferences = {
    goals: ["Learning"],
    kinds: ["meetup"],
    formats: ["In person"],
    location: "Belgrade",
    level: "Intermediate",
    notify: true,
  };
  const { id: _id, ...e } = s.events[0];
  return {
    s,
    e: {
      ...e,
      date: "2099-10-11",
      deadline: "2099-10-10",
      endDate: "2099-10-11",
      kind: "meetup" as const,
      registration: "automatic" as const,
      tags: ["Web apps"],
      audience: {
        skills: ["React"],
        goals: ["Learning" as const],
        roles: [],
        levels: [],
      },
      minTeamSize: 1,
      maxTeamSize: 1,
    },
  };
}
describe("event publication and session privacy", () => {
  it("does not create a new admission through an invitation after the deadline", () => {
    const { s } = fixture();
    const invited = execute(s, attendee, {
      type: "INVITE_PERSON",
      teamId: "team-4",
      personId: "teo",
      fromId: "luka",
    });
    expect(invited.error).toBeUndefined();
    const invitation = invited.state.invitations.find(
      (i) => i.personId === "teo",
    )!;
    invited.state.events[0].deadline = "2000-01-01";
    const response = execute(
      invited.state,
      { ...attendee, personId: "teo" },
      {
        type: "RESPOND_INVITATION",
        invitationId: invitation.id,
        response: "accepted",
      },
    );
    expect(response.error).toMatch(/closed/i);
    expect(response.state.applications.some((a) => a.personId === "teo")).toBe(
      false,
    );
  });
  it("preserves publication history when a legacy open event is drafted and reopened", () => {
    const { s, e } = fixture();
    s.events.push({ ...e, id: "legacy-open" });
    const drafted = execute(s, org, {
      type: "UPDATE_EVENT",
      eventId: "legacy-open",
      changes: { status: "draft" },
    });
    const reopened = execute(drafted.state, org, {
      type: "UPDATE_EVENT",
      eventId: "legacy-open",
      changes: { status: "open" },
    });
    expect(reopened.error).toBeUndefined();
    expect(
      reopened.state.notifications.filter((n) => n.eventId === "legacy-open"),
    ).toHaveLength(0);
  });
  it("rejects expired registration even when status is still open", () => {
    const { s, e } = fixture();
    s.events.push({
      ...e,
      id: "expired",
      date: "2000-01-02",
      endDate: "2000-01-02",
      deadline: "2000-01-01",
    });
    const result = execute(s, attendee, {
      type: "SUBMIT_APPLICATION",
      eventId: "expired",
      personId: "luka",
      role: "Participant",
      motivation: "A past meetup.",
    });
    expect(result.error).toMatch(/closed/i);
    expect(result.state.applications.some((a) => a.eventId === "expired")).toBe(
      false,
    );
  });
  it("notifies relevant opted-in users once, with a reason", () => {
    const { s, e } = fixture();
    const result = execute(s, org, { type: "CREATE_EVENT", event: e });
    expect(result.error).toBeUndefined();
    const notices = result.state.notifications.filter(
      (n) => n.eventId === result.createdId && n.personId === "luka",
    );
    expect(notices).toHaveLength(1);
    expect(notices[0].body).toContain("Web apps");
    const updated = execute(result.state, org, {
      type: "UPDATE_EVENT",
      eventId: result.createdId,
      changes: { theme: "Updated theme" },
    });
    expect(
      updated.state.notifications.filter(
        (n) => n.eventId === result.createdId && n.personId === "luka",
      ),
    ).toHaveLength(1);
  });
  it("does not notify drafts or users who opted out", () => {
    const { s, e } = fixture();
    const draft = execute(s, org, {
      type: "CREATE_EVENT",
      event: { ...e, status: "draft" },
    });
    expect(draft.error).toBeUndefined();
    expect(
      draft.state.notifications.some((n) => n.eventId === draft.createdId),
    ).toBe(false);
    const published = execute(draft.state, org, {
      type: "UPDATE_EVENT",
      eventId: draft.createdId,
      changes: { status: "open" },
    });
    expect(
      published.state.notifications.some(
        (n) => n.eventId === draft.createdId && n.personId === "luka",
      ),
    ).toBe(true);
    s.people[0].preferences!.notify = false;
    const off = execute(s, org, { type: "CREATE_EVENT", event: e });
    expect(
      off.state.notifications.some(
        (n) => n.eventId === off.createdId && n.personId === "luka",
      ),
    ).toBe(false);
  });
  it("keeps preferences private even in organizer view and returns only own recommendations", () => {
    const { s, e } = fixture();
    s.people[1].preferences = { ...s.people[0].preferences! };
    const saved = execute(s, org, { type: "CREATE_EVENT", event: e }).state;
    for (const session of [org, attendee]) {
      const v = view(saved, session);
      expect(
        v.people.find((p) => p.id === "mila")!.preferences,
      ).toBeUndefined();
      expect(v.people[0].preferences?.notify).toBe(true);
      expect(
        v.recommendations?.some((r) => r.eventId === saved.events.at(-1)!.id),
      ).toBe(true);
    }
  });
});
