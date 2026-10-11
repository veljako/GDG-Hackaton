import { expect, it } from "vitest";
import { profileSchema } from "./schema";
import { toUserDocument, fromUserDocument } from "./users";
import { createSeedState } from "../src/seed";
import { execute, view } from "./service";

it("stores explicit names and structured CV-derived background without guessing legacy names", () => {
  const person = createSeedState().people[0];
  const legacyName = person.name;
  const record = toUserDocument(person);
  expect(record).toMatchObject({
    first_name: "",
    last_name: "",
    email: null,
    email_verified: false,
    phone: "",
    education: [],
    work_experience: [],
    languages: [],
    cv_document: null,
    created_at: null,
    updated_at: null,
  });
  expect(fromUserDocument(record, person.id).name).toBe(legacyName);
  const legacy = { ...record };
  delete legacy.first_name;
  delete legacy.last_name;
  delete legacy.education;
  delete legacy.cv_document;
  expect(fromUserDocument(legacy, person.id)).toMatchObject({
    name: legacyName,
    first_name: "",
    last_name: "",
    education: [],
    cv_document: null,
  });
  const changes = {
    first_name: "  Ana Marija  ",
    last_name: "  Petrović  ",
    phone: "+381601234567",
    education: [
      {
        institution: "University of Belgrade",
        degree: "BSc",
        field: "Computer science",
        start_date: "2020-09",
        end_date: "2024-06",
        description: "",
      },
    ],
    work_experience: [
      {
        company: "Example",
        position: "Developer",
        location: "Belgrade",
        start_date: "2024-07",
        end_date: null,
        description: "Built web apps",
      },
    ],
    languages: ["Serbian", "English"],
  };
  expect(profileSchema.safeParse(changes).success).toBe(true);
  const result = execute(
    createSeedState(),
    { personId: person.id, organizer: false, mode: "attendee", demo: true },
    { type: "UPDATE_PROFILE", personId: person.id, changes },
  );
  expect(result.error).toBeUndefined();
  expect(result.state.people.find((p) => p.id === person.id)).toMatchObject({
    first_name: "Ana Marija",
    last_name: "Petrović",
    name: "Ana Marija Petrović",
    updated_at: expect.any(String),
    education: changes.education,
    work_experience: changes.work_experience,
  });
});

it("rejects invalid background and client-forged identity, timestamps or CV paths", () => {
  for (const changes of [
    { first_name: " " },
    { last_name: "a".repeat(101) },
    { email: "forged@example.com" },
    { email_verified: true },
    { created_at: "now" },
    { updated_at: "now" },
    { cv_document: { storage_path: "someone-else/cv.pdf" } },
    { education: [{ institution: "X", start_date: "2025-20" }] },
    { languages: Array(51).fill("English") },
  ]) {
    expect(profileSchema.safeParse(changes).success).toBe(false);
  }
});

it("keeps email, phone and stored CV metadata private even from organizer views", () => {
  const state = createSeedState();
  Object.assign(
    state.people.find((p) => p.id === "mila")!,
    {
      email: "private@example.com",
      email_verified: true,
      phone: "+3811234",
      cv_document: { storage_path: "private/path", filename: "cv.pdf" },
      created_at: "private-date",
    },
  );
  for (const organizer of [false, true]) {
    const result = view(state, {
      personId: "luka",
      organizer,
      mode: organizer ? "organizer" : "attendee",
      demo: true,
    });
    const other = result.people.find((p) => p.id === "mila")!;
    for (const field of [
      "email",
      "email_verified",
      "phone",
      "cv_document",
      "created_at",
    ])
      expect(other).not.toHaveProperty(field);
  }
  expect(
    view(state, {
      personId: "mila",
      organizer: false,
      mode: "attendee",
      demo: true,
    }).people.find((p) => p.id === "mila"),
  ).toHaveProperty("email", "private@example.com");
});

it("accepts structured user metadata and allows clearing unknown values", () => {
  expect(
    profileSchema.safeParse({
      status: "Freelancer",
      birth_year: 1998,
      experience_level: "Senior",
    }).success,
  ).toBe(true);
  expect(
    profileSchema.safeParse({
      status: null,
      birth_year: null,
      experience_level: null,
    }).success,
  ).toBe(true);
});
it("drops legacy extraction secrets and unknown imported fields at the database boundary", () => {
  const state = createSeedState();
  const person = state.people.find((p) => p.id === "mila")!;
  const record = Object.assign(toUserDocument(person), {
    cv_text: "PRIVATE CV CONTENT",
    source: "C:/private/path",
    candidate_id: "legacy-id",
    future_extraction_secret: "PRIVATE FUTURE FIELD",
  });
  const decoded = fromUserDocument(record, person.id);
  for (const field of ["cv_text", "source", "candidate_id", "future_extraction_secret"])
    expect(decoded).not.toHaveProperty(field);
  Object.assign(person, record);
  for (const organizer of [false, true]) {
    const other = view(state, {
      personId: "luka", organizer, mode: organizer ? "organizer" : "attendee", demo: true,
    }).people.find((p) => p.id === "mila")!;
    expect(other.name).toBe(person.name);
    for (const field of ["cv_text", "source", "candidate_id", "future_extraction_secret"])
      expect(other).not.toHaveProperty(field);
  }
});
it("rejects invented categories, fractional years and future years", () => {
  for (const changes of [
    { status: "Unknown" },
    { experience_level: "Expert" },
    { birth_year: 2000.5 },
    { birth_year: new Date().getUTCFullYear() + 1 },
    { birth_year: 1800 },
  ]) {
    expect(profileSchema.safeParse(changes).success).toBe(false);
  }
});
