import { expect, it } from "vitest";
import { createSeedState } from "./seed";
import {
  initialReviewedProfile,
  onboardingMissingFields,
  requiresOnboarding,
} from "./onboarding";

it("gates only explicitly unfinished accounts and preserves legacy access", () => {
  const person = createSeedState().people[0];
  expect(requiresOnboarding(person)).toBe(false);
  expect(
    requiresOnboarding({
      ...person,
      onboarding: { version: 1, status: "required", completed_at: null },
    }),
  ).toBe(true);
  expect(
    requiresOnboarding({
      ...person,
      onboarding: { version: 1, status: "completed", completed_at: "today" },
    }),
  ).toBe(false);
});

it("requires useful matching details while allowing unknown eligibility and empty employment history", () => {
  const profile = initialReviewedProfile(createSeedState().people[0], {
    first_name: "Ada",
    last_name: "Lovelace",
  });
  Object.assign(profile, {
    title: "Student",
    bio: "Building my first research project.",
    city: "Belgrade",
    skills: ["Python"],
    interests: ["Research"],
    status: null,
    birth_year: null,
    experience_level: null,
    education: [],
    work_experience: [],
    preferences: {
      goals: ["Learning"],
      kinds: ["hackathon"],
      formats: ["Online"],
      location: "",
      notify: false,
    },
    roles: ["Participant"],
  });
  expect(onboardingMissingFields(profile)).toEqual([]);
  expect(onboardingMissingFields({...profile,skills:[],learningSkills:["Python"]})).toEqual([]);
  expect(
    onboardingMissingFields({ ...profile, skills: ["  "], interests: [] }),
  ).toEqual(expect.arrayContaining(["Skills", "Interests"]));
});

it("does not import account identity or private metadata from extraction", () => {
  const me = createSeedState().people[0];
  const profile = initialReviewedProfile(me, {
    id: "forged",
    email: "forged@example.com",
    onboarding: { status: "completed" },
    cv_document: { storage_path: "other" },
    first_name: "Ada",
    skills: ["Python"],
  });
  expect(profile).toMatchObject({ first_name: "Ada", skills: ["Python"] });
  expect(profile).not.toHaveProperty("id");
  expect(profile).not.toHaveProperty("email");
  expect(profile).not.toHaveProperty("onboarding");
  expect(profile).not.toHaveProperty("cv_document");
});
