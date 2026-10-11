import type { Person, Preferences } from "./types";

export type ReviewedProfile = {
  first_name: string;
  last_name: string;
  title: string;
  city: string;
  country: string;
  school: string;
  bio: string;
  skills: string[];
  learningSkills: string[];
  interests: string[];
  roles: Person["roles"];
  experience: string;
  status: NonNullable<Person["status"]> | null;
  birth_year: number | null;
  birth_date: string | null;
  experience_level: NonNullable<Person["experience_level"]> | null;
  education: NonNullable<Person["education"]>;
  work_experience: NonNullable<Person["work_experience"]>;
  languages: string[];
  phone: string;
  linkedin: string;
  kaggle: string;
  lookingForTeam: boolean;
  preferences: Preferences;
};
export type OnboardingDraft = {
  version: number;
  cv_path: string;
  extraction_hash: string;
  expected_profile_updated_at: string | null;
  profile: Partial<ReviewedProfile>;
  step: "review" | "interests";
};
export type OnboardingInput = {
  profile: Partial<ReviewedProfile>;
  step: OnboardingDraft["step"];
  expected_extraction_hash: string;
  expected_profile_updated_at: string | null;
  expected_draft_version: number | null;
};
export const requiresOnboarding = (person: Pick<Person, "onboarding">) =>
  person.onboarding?.status === "required";

export function initialReviewedProfile(
  person: Person,
  proposal: Record<string, unknown> = {},
): ReviewedProfile {
  const profile: ReviewedProfile = {
    first_name: person.first_name ?? "",
    last_name: person.last_name ?? "",
    title: person.title === "Community member" ? "" : person.title,
    city: person.city,
    country: person.country ?? "",
    school: person.school,
    bio: person.bio,
    skills: [...person.skills],
    learningSkills: [...(person.learningSkills ?? [])],
    interests: [...person.interests],
    roles: [...person.roles],
    experience: person.experience,
    status: person.status ?? null,
    birth_year: person.birth_year ?? null,
    birth_date: person.birth_date ?? null,
    experience_level: person.experience_level ?? null,
    education: structuredClone(person.education ?? []),
    work_experience: structuredClone(person.work_experience ?? []),
    languages: [...(person.languages ?? [])],
    phone: person.phone ?? "",
    linkedin: person.linkedin,
    kaggle: person.kaggle,
    lookingForTeam: person.lookingForTeam,
    preferences: structuredClone(
      person.preferences ?? {
        goals: [],
        kinds: [],
        formats: [],
        location: "",
        notify: false,
      },
    ),
  };
  for (const key of Object.keys(profile) as (keyof ReviewedProfile)[]) {
    const value = proposal[key];
    // The server validates proposal types. Keep account/private fields out of the editable object.
    if (
      value !== undefined &&
      value !== null &&
      value !== "" &&
      (!Array.isArray(value) || value.length)
    )
      (profile as unknown as Record<string, unknown>)[key] =
        structuredClone(value);
  }
  return profile;
}
const useful = (values: unknown) =>
  Array.isArray(values) &&
  values.some((v) => typeof v === "string" && v.trim());
export function onboardingMissingFields(
  profile: Partial<ReviewedProfile>,
): string[] {
  const missing: string[] = [];
  for (const [key, label] of [
    ["first_name", "First name"],
    ["last_name", "Last name"],
    ["title", "Headline"],
    ["city", "City"],
    ["bio", "About you"],
  ] as const)
    if (!profile[key]?.trim()) missing.push(label);
  if (!useful(profile.skills) && !useful(profile.learningSkills)) missing.push("Skills");
  if (!useful(profile.interests)) missing.push("Interests");
  if (!useful(profile.roles)) missing.push("Event roles");
  if (!useful(profile.preferences?.goals)) missing.push("Goals");
  if (!useful(profile.preferences?.kinds)) missing.push("Event types");
  if (!useful(profile.preferences?.formats)) missing.push("Event formats");
  return missing;
}
