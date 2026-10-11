import { expect, it } from "vitest";
import { createSeedState } from "../src/seed";
import { validateDataset, importDataset } from "./dataset";
import type { Repository } from "./repository";

it("validates samples and strips session-specific identity and recommendations", () => {
  const state = validateDataset(createSeedState());
  expect(state.currentPersonId).toBe("");
  expect(state.mode).toBe("attendee");
  expect(state.recommendations).toBeUndefined();
  expect(state.events.length).toBeGreaterThan(0);
});

it("rejects duplicate IDs, invalid document paths, malformed fields and broken references", () => {
  const duplicate = createSeedState();
  duplicate.people.push(duplicate.people[0]);
  expect(() => validateDataset(duplicate)).toThrow(/duplicate/i);
  const path = createSeedState();
  path.events[0].id = "invalid/path";
  expect(() => validateDataset(path)).toThrow();
  const broken = createSeedState();
  broken.teams[0].eventId = "missing";
  expect(() => validateDataset(broken)).toThrow(/reference/i);
  const malformed = createSeedState();
  malformed.people[0].skills = [4] as unknown as string[];
  expect(() => validateDataset(malformed)).toThrow();
});

it("refuses to import into a workspace with a real profile", async () => {
  const seed = validateDataset(createSeedState());
  const existing = {
    ...seed,
    people: [seed.people[0]],
    events: [],
    teams: [],
    applications: [],
    invitations: [],
    notifications: [],
    connections: [],
  };
  const repo: Repository = {
    read: async () => existing,
    update: async (fn) => fn(structuredClone(existing)),
  };
  await expect(importDataset(repo, seed)).rejects.toThrow(/empty/i);
});

it("rejects inconsistent private birth dates and published events without an attendance format", () => {
  const profile = createSeedState();
  profile.people[0].birth_date = "2000-01-01";
  profile.people[0].birth_year = 2001;
  expect(() => validateDataset(profile)).toThrow(/birth date and birth year/i);
  const events = createSeedState();
  events.events[0].format = null;
  events.events[0].status = "open";
  expect(() => validateDataset(events)).toThrow(/format/i);
  events.events[0].status = "draft";
  expect(validateDataset(events).events[0].format).toBeNull();
});
