import { describe, expect, it } from "vitest";
import { createSeedState } from "../src/seed";
import { execute, view } from "./service";

const attendee = {
  personId: "luka",
  organizer: false,
  mode: "attendee" as const,
  demo: true,
};
describe("server authority", () => {
  it("cannot gain organizer privileges with a client mode", () => {
    const state = createSeedState();
    expect(
      execute(state, attendee, { type: "SET_MODE", mode: "organizer" }).error,
    ).toBeTruthy();
    expect(
      execute(state, attendee, {
        type: "REVIEW_APPLICATION",
        applicationId: state.applications[0].id,
        status: "accepted",
      }).error,
    ).toBeTruthy();
  });
  it("rejects impersonation and unknown fields", () => {
    const state = createSeedState();
    expect(
      execute(state, attendee, {
        type: "UPDATE_PROFILE",
        personId: "mila",
        changes: { bio: "changed" },
      }).error,
    ).toBeTruthy();
    expect(
      execute(state, attendee, {
        type: "UPDATE_PROFILE",
        personId: "luka",
        changes: { id: "mila" },
      }).error,
    ).toBeTruthy();
    expect(
      execute(state, attendee, {
        type: "INVITE_PERSON",
        teamId: "team-4",
        personId: "zarko",
        fromId: "mila",
      }).error,
    ).toBeTruthy();
    expect(execute(state, attendee, { type: "RESET" }).error).toBeTruthy();
  });
  it("does not send other users private data", () => {
    const state = createSeedState();
    state.people.find((p) => p.id === "mila")!.cv = "private.pdf";
    const result = view(state, attendee);
    expect(result.notifications.every((n) => n.personId === "luka")).toBe(true);
    expect(
      result.invitations.every(
        (i) =>
          i.personId === "luka" ||
          state.teams.some(
            (t) => t.id === i.teamId && t.memberIds.includes("luka"),
          ),
      ),
    ).toBe(true);
    expect(
      result.applications
        .filter((a) => a.personId !== "luka")
        .every((a) => a.motivation === ""),
    ).toBe(true);
    expect(result.people.find((p) => p.id === "mila")!.cv).toBeUndefined();
    expect(result.connections.every((c) => c.split(":").includes("luka"))).toBe(
      true,
    );
    expect(state.people.find((p) => p.id === "mila")!.cv).toBe("private.pdf");
  });
  it("preserves invitation versus admission and enforces recipient identity", () => {
    let state = createSeedState();
    let result = execute(state, attendee, {
      type: "INVITE_PERSON",
      teamId: "team-4",
      personId: "zarko",
      fromId: "luka",
    });
    expect(result.error).toBeUndefined();
    state = result.state;
    const invitation = state.invitations.find(
      (i) => i.personId === "zarko" && i.teamId === "team-4",
    )!;
    expect(
      execute(state, attendee, {
        type: "RESPOND_INVITATION",
        invitationId: invitation.id,
        response: "accepted",
      }).error,
    ).toBeTruthy();
    result = execute(
      state,
      { ...attendee, personId: "zarko" },
      {
        type: "RESPOND_INVITATION",
        invitationId: invitation.id,
        response: "accepted",
      },
    );
    expect(result.error).toBeUndefined();
    expect(
      result.state.applications.find(
        (a) => a.personId === "zarko" && a.eventId === "gdg-belgrade",
      )!.status,
    ).toBe("pending");
  });
  it("rejects malformed and oversized profile fields", () => {
    const state = createSeedState();
    for (const changes of [
      { roles: ["Admin"] },
      { name: "" },
      { bio: "a".repeat(10001) },
      { skills: [42] },
    ]) {
      expect(
        execute(state, attendee, {
          type: "UPDATE_PROFILE",
          personId: "luka",
          changes,
        }).error,
      ).toBeTruthy();
    }
    expect(execute(state, attendee, null).error).toBeTruthy();
  });
});
