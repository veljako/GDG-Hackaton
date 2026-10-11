import { describe, it, expect } from "vitest";
import { createSeedState } from "./seed";
import { recommendEvent, recommendationsFor, searchEvents } from "./discovery";
import type { GEventsEvent, Person } from "./types";

const seed = () => createSeedState();
describe("explainable event discovery", () => {
  it("requires subject or skill relevance even when generic preferences agree", () => {
    const state = seed();
    const event: GEventsEvent = {
      ...state.events[0],
      id: "generic",
      date: "2099-01-01",
      endDate: "2099-01-01",
      deadline: "2099-01-01",
      status: "open" as const,
      topics: [],
      tags: [],
      audience: {
        skills: [],
        goals: ["Learning" as const],
        roles: ["Participant" as const],
        levels: [],
      },
    };
    state.events = [event];
    const person: Person = {
      ...state.people[0],
      interests: ["Biology"],
      skills: ["Microscopy"],
      learningSkills: [],
      roles: ["Participant" as const],
      preferences: {
        goals: ["Learning" as const],
        kinds: [event.kind!],
        formats: [event.format!],
        level: "Beginner" as const,
        notify: false,
        location: "",
      },
    };
    expect(recommendEvent(event, person).score).toBe(100);
    expect(recommendationsFor(state, person)).toEqual([]);
    event.audience = { ...event.audience!, skills: ["Microscopy"] };
    expect(recommendationsFor(state, person).map((r) => r.eventId)).toEqual([
      "generic",
    ]);
  });
  it("ranks shared topics and goals with concrete reasons", () => {
    const s = seed();
    const e = {
      ...s.events[0],
      kind: "meetup" as const,
      tags: ["Web apps"],
      audience: {
        skills: ["React"],
        goals: ["Learning" as const],
        roles: [],
        levels: [],
      },
    };
    const p = {
      ...s.people[0],
      preferences: {
        goals: ["Learning" as const],
        kinds: ["meetup" as const],
        formats: ["In person" as const],
        location: "Belgrade",
        level: "Intermediate" as const,
        notify: true,
      },
    };
    const match = recommendEvent(e, p);
    expect(match.score).toBe(100);
    expect(match.evidence).toBeGreaterThanOrEqual(2);
    expect(match.reasons.join(" ")).toContain("Web apps");
    expect(match.reasons.join(" ")).toContain("Learning");
  });
  it("does not manufacture a score for an empty profile", () => {
    const s = seed();
    const p = {
      ...s.people[0],
      interests: [],
      skills: [],
      roles: [],
      city: "",
      preferences: undefined,
    };
    expect(recommendEvent(s.events[0], p).score).toBeNull();
  });
  it("combines search terms with type, topic, city, format, dates and availability", () => {
    const s = seed();
    s.events[0] = {
      ...s.events[0],
      kind: "conference",
      tags: ["Research"],
      title: "Open science conference",
      date: "2026-10-20",
      deadline: "2026-10-19",
      endDate: "2026-10-20",
    };
    const filters = {
      q: "SCIENCE open",
      kind: "conference",
      topic: "research",
      city: "belgrade",
      format: "In person",
      from: "2026-10-18",
      to: "2026-10-22",
      available: true,
    };
    expect(searchEvents(s, filters, "2026-10-10").map((e) => e.id)).toEqual([
      s.events[0].id,
    ]);
    s.events[0].capacity = 1;
    expect(searchEvents(s, filters, "2026-10-10")).toHaveLength(0);
  });
  it("excludes drafts and closed dates from discovery recommendations", () => {
    const s = seed();
    s.events[0].status = "draft";
    expect(
      searchEvents(s, {}, "2026-10-10").some((e) => e.id === s.events[0].id),
    ).toBe(false);
    expect(searchEvents(s, { available: true }, "2027-01-01")).toHaveLength(0);
  });
});
