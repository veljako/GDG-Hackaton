import { describe, expect, it } from "vitest";
import { eventSchema, profileSchema } from "../server/schema";
import { createSeedState } from "./seed";
import {
  normalizeState,
  recommendEvent,
  recommendationsFor,
  searchEvents,
} from "./discovery";
import {
  toUserDocument,
  fromUserDocument,
  publicPerson,
} from "../server/users";
import { execute } from "../server/service";
import { eventEligibility, normalizeEvent } from "./matching-data";

const seed = () => createSeedState();
describe("matching data across the canonical contract", () => {
  it("accepts workshop topics, teaching, explicit requirements and optional logistics", () => {
    const { id: _id, publishedAt: _published, ...base } = seed().events[0];
    const event = {
      ...base,
      matchingVersion: 2,
      kind: "workshop",
      topics: ["AI"],
      country: "Serbia",
      languages: ["English"],
      price: { amount: 0, currency: "EUR" },
      audience: {
        skills: [],
        taughtSkills: ["Python"],
        roles: ["Participant"],
        goals: ["Learning"],
        levels: [],
      },
      eligibility: {
        requiredSkills: [],
        seniorities: [],
        statuses: ["Student"],
        minAge: 18,
        maxAge: null,
        minBirthYear: 2000,
        maxBirthYear: 2008,
      },
    };
    expect(eventSchema.safeParse(event).success).toBe(true);
    expect(
      profileSchema.safeParse({
        learningSkills: ["Python"],
        country: "Serbia",
        birth_date: "2000-03-10",
        preferences: {
          goals: ["Learning"],
          kinds: ["workshop"],
          formats: ["Online"],
          location: "",
          notify: false,
          maxPrice: { amount: 10, currency: "EUR" },
        },
      }).success,
    ).toBe(true);
  });
  it("round-trips learner data and keeps exact birth dates private", () => {
    const person = {
      ...seed().people[0],
      learningSkills: ["Python"],
      country: "Serbia",
      birth_date: "2000-03-10",
    };
    const saved = toUserDocument(person);
    expect(fromUserDocument(saved, person.id)).toMatchObject({
      learningSkills: ["Python"],
      country: "Serbia",
      birth_date: "2000-03-10",
    });
    expect(publicPerson(person)).not.toHaveProperty("birth_date");
  });
  it("matches a beginner's learning interests without requiring existing skills", () => {
    const state = seed();
    const event = {
      ...state.events[0],
      topics: ["AI"],
      tags: ["Unrelated"],
      audience: {
        skills: [],
        taughtSkills: ["Python"],
        roles: [],
        levels: [],
        goals: ["Learning" as const],
      },
    };
    const person = {
      ...state.people[0],
      city: "",
      skills: [],
      interests: ["AI"],
      learningSkills: ["Python"],
      preferences: {
        goals: ["Learning" as const],
        kinds: [],
        formats: [],
        location: "",
        notify: false,
      },
    };
    const result = recommendEvent(event, person);
    expect(result.score).toBe(100);
    expect(result.reasons.join(" ")).toContain("Learning skill: Python");
    expect(
      searchEvents(
        { ...state, events: [event] },
        { topic: "AI" },
        "2026-10-10",
      ),
    ).toHaveLength(1);
  });
  it("enforces explicit prerequisites at admission without inferring them from practiced skills", () => {
    const state = seed();
    state.currentPersonId = "luka";
    state.applications = [];
    state.teams = [];
    const event = state.events[0];
    Object.assign(event, {
      date: "2099-10-20",
      endDate: "2099-10-20",
      deadline: "2099-10-19",
      eligibility: { requiredSkills: ["Rust"] },
      audience: {
        skills: ["Python"],
        taughtSkills: ["Rust"],
        goals: [],
        roles: [],
        levels: [],
      },
    });
    const action = {
      type: "SUBMIT_APPLICATION" as const,
      eventId: event.id,
      personId: "luka",
      role: "Participant" as const,
      motivation: "",
    };
    const session = {
      personId: "luka",
      organizer: false,
      mode: "attendee" as const,
      demo: true,
    };
    expect(execute(state, session, action).error).toContain("Rust");
    Object.assign(event, { eligibility: { requiredSkills: [] } });
    expect(execute(state, session, action).error).toBeUndefined();
  });
  it("does not recommend events with unmet explicit eligibility", () => {
    const state = seed();
    state.applications = [];
    Object.assign(state.events[0], {
      tags: state.people[0].interests,
      audience: {
        skills: state.people[0].skills,
        goals: ["Learning"],
        roles: ["Participant"],
        levels: ["Intermediate"],
      },
    });
    expect(
      recommendationsFor(state, state.people[0], "2026-10-10").some(
        (r) => r.eventId === state.events[0].id,
      ),
    ).toBe(true);
    Object.assign(state.events[0], {
      eligibility: { requiredSkills: ["Rust"] },
    });
    expect(
      recommendationsFor(state, state.people[0], "2026-10-10").some(
        (r) => r.eventId === state.events[0].id,
      ),
    ).toBe(false);
  });
  it("converts legacy reversed birth-year bounds exactly once", () => {
    const state = seed();
    Object.assign(state.events[0], {
      min_birth_year: 2008,
      max_birth_year: 2000,
      remote: true,
    });
    const first = normalizeState(state);
    expect(first.events[0]).toMatchObject({
      matchingVersion: 2,
      eligibility: { minBirthYear: 2000, maxBirthYear: 2008 },
      format: "Hybrid",
    });
    expect(normalizeState(first).events[0]).toEqual(first.events[0]);
  });
  it("preserves one-sided legacy bounds and conventional versioned bounds", () => {
    const base = seed().events[0];
    expect(
      normalizeEvent({ ...base, ...{ min_birth_year: 2008 } }).eligibility,
    ).toEqual({ minBirthYear: null, maxBirthYear: 2008 });
    expect(
      normalizeEvent({ ...base, ...{ max_birth_year: 2000 } }).eligibility,
    ).toEqual({ minBirthYear: 2000, maxBirthYear: null });
    expect(
      normalizeEvent({
        ...base,
        ...{ criteria_version: 2, min_birth_year: 2000, max_birth_year: 2008 },
      }).eligibility,
    ).toEqual({ minBirthYear: 2000, maxBirthYear: 2008 });
  });
  it("keeps student status independent of seniority", () => {
    const event = {
      ...seed().events[0],
      eligibility: {
        statuses: ["Student" as const],
        seniorities: ["Senior" as const],
      },
    };
    expect(
      eventEligibility(event, {
        ...seed().people[0],
        status: "Student",
        experience_level: "Senior",
      }).eligible,
    ).toBe(true);
    expect(
      eventEligibility(event, {
        ...seed().people[0],
        status: "Student",
        experience_level: null,
      }),
    ).toMatchObject({ eligible: false, unknown: true });
  });
  it("checks age at the event date and does not guess an ambiguous birthday", () => {
    const event = {
      ...seed().events[0],
      date: "2026-10-11",
      eligibility: { minAge: 18, maxAge: 25 },
    };
    const person = { ...seed().people[0], birth_year: 2008 };
    expect(eventEligibility(event, person)).toMatchObject({
      eligible: false,
      unknown: true,
    });
    expect(
      eventEligibility(event, { ...person, birth_date: "2008-10-12" }).eligible,
    ).toBe(false);
    expect(
      eventEligibility(event, { ...person, birth_date: "2008-10-11" }).eligible,
    ).toBe(true);
    expect(
      eventEligibility(event, { ...person, birth_year: 2006 }),
    ).toMatchObject({ eligible: true, unknown: false });
    expect(
      eventEligibility({ ...event, date: "2026-12-31" }, person),
    ).toMatchObject({ eligible: true, unknown: false });
  });
  it("rejects malformed eligibility, currencies and future birth dates", () => {
    for (const eligibility of [
      { minAge: 26, maxAge: 18 },
      { minBirthYear: 2008, maxBirthYear: 2000 },
      { minAge: -1 },
      { requiredSkills: [3] },
    ])
      expect(eventSchema.shape.eligibility.safeParse(eligibility).success).toBe(
        false,
      );
    expect(profileSchema.safeParse({ birth_date: "2000-02-30" }).success).toBe(
      false,
    );
    expect(profileSchema.safeParse({ birth_date: "2099-01-01" }).success).toBe(
      false,
    );
    expect(
      profileSchema.safeParse({
        preferences: {
          goals: [],
          kinds: [],
          formats: [],
          location: "",
          notify: false,
          maxPrice: { amount: 10, currency: "eur" },
        },
      }).success,
    ).toBe(false);
  });
  it("checks cross-field birth year consistency after a partial update", () => {
    const state = seed();
    Object.assign(state.people[0], {
      birth_date: "2000-03-10",
      birth_year: 2000,
    });
    const result = execute(
      state,
      {
        personId: state.people[0].id,
        organizer: false,
        mode: "attendee",
        demo: true,
      },
      {
        type: "UPDATE_PROFILE",
        personId: state.people[0].id,
        changes: { birth_year: 2001 },
      },
    );
    expect(result.error).toContain("must agree");
    expect(result.state).toBe(state);
  });
  it("rechecks eligibility when approving an existing pending application", () => {
    const state = seed();
    const app = state.applications.find((a) => a.status === "pending")!;
    state.events.find((e) => e.id === app.eventId)!.eligibility = {
      requiredSkills: ["Rust"],
    };
    const result = execute(
      state,
      {
        personId: state.people[0].id,
        organizer: true,
        mode: "organizer",
        demo: true,
      },
      { type: "REVIEW_APPLICATION", applicationId: app.id, status: "accepted" },
    );
    expect(result.error).toContain("Rust");
    expect(result.state).toBe(state);
  });
  it("rechecks an invited pending applicant before admitting them to a team", () => {
    const state = seed(),
      invite = state.invitations[0],
      team = state.teams.find((t) => t.id === invite.teamId)!;
    const event = state.events.find((e) => e.id === team.eventId)!;
    event.eligibility = { requiredSkills: ["Rust"] };
    state.applications.push({
      id: "pending-invite",
      eventId: event.id,
      personId: invite.personId,
      status: "pending",
      role: "Participant",
      motivation: "",
      submittedAt: "2026-10-10",
    });
    const result = execute(
      state,
      {
        personId: invite.personId,
        organizer: false,
        mode: "attendee",
        demo: true,
      },
      {
        type: "RESPOND_INVITATION",
        invitationId: invite.id,
        response: "accepted",
      },
    );
    expect(result.error).toContain("Rust");
    expect(result.state).toBe(state);
  });
  it("preserves unknown attendance in an imported draft and requires a format to publish", () => {
    const { id: _id, publishedAt: _published, ...base } = seed().events[0];
    expect(
      eventSchema.safeParse({ ...base, status: "draft", format: null }).success,
    ).toBe(true);
    const state = seed();
    state.events[0] = {
      ...state.events[0],
      status: "draft",
      format: null,
    } as (typeof state.events)[number];
    const session = {
      personId: state.people[0].id,
      organizer: true,
      mode: "organizer" as const,
      demo: true,
    };
    expect(
      execute(state, session, {
        type: "UPDATE_EVENT",
        eventId: state.events[0].id,
        changes: { status: "open" },
      }).error,
    ).toContain("format");
    expect(
      execute(state, session, {
        type: "UPDATE_EVENT",
        eventId: state.events[0].id,
        changes: { status: "open", format: "Online" },
      }).error,
    ).toBeUndefined();
  });
});
