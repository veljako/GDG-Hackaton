import { it, expect } from "vitest";
import { createSeedState } from "./seed";
import { transition } from "./domain";

it("automatically confirms individual meetup registration", () => {
  const s = createSeedState();
  s.events[1] = {
    ...s.events[1],
    kind: "meetup",
    registration: "automatic",
    minTeamSize: 1,
    maxTeamSize: 1,
  };
  const result = transition(s, {
    type: "SUBMIT_APPLICATION",
    eventId: s.events[1].id,
    personId: "luka",
    role: "Participant",
    motivation: "Learning with researchers.",
  });
  expect(result.error).toBeUndefined();
  expect(
    result.state.applications.find(
      (a) => a.personId === "luka" && a.eventId === s.events[1].id,
    )?.status,
  ).toBe("accepted");
});
it("rejects creating and reusing a team for non-hackathon events", () => {
  const s = createSeedState();
  s.events[1] = { ...s.events[1], kind: "conference" };
  expect(
    transition(s, {
      type: "CREATE_TEAM",
      eventId: s.events[1].id,
      personId: "luka",
      name: "Research team",
      description: "",
      skills: [],
    }).error,
  ).toMatch(/individual/i);
  expect(
    transition(s, {
      type: "REUSE_TEAM",
      eventId: s.events[1].id,
      personId: "luka",
      teamId: "build-2025-team",
    }).error,
  ).toMatch(/individual/i);
});
it("does not change an existing team event into individual attendance", () => {
  const s = createSeedState();
  s.mode = "organizer";
  expect(
    transition(s, {
      type: "UPDATE_EVENT",
      eventId: s.events[0].id,
      changes: { kind: "meetup" },
    }).error,
  ).toMatch(/teams/i);
});
