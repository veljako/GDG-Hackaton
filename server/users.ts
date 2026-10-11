import type { Person } from "../src/types";
import { normalizePerson } from "../src/user-profile";

const publicFields = [
  "id",
  "name",
  "first_name",
  "last_name",
  "title",
  "city",
  "school",
  "bio",
  "skills",
  "interests",
  "roles",
  "experience",
  "color",
  "avatar",
  "lookingForTeam",
  "linkedin",
  "kaggle",
  "cv",
  "status",
  "birth_year",
  "experience_level",
  "education",
  "work_experience",
  "languages",
] as const satisfies readonly (keyof Person)[];
const personFields = [
  ...publicFields,
  "preferences",
  "email",
  "email_verified",
  "phone",
  "cv_document",
  "created_at",
  "updated_at",
  "onboarding",
] as const satisfies readonly (keyof Person)[];

/** Unknown imported fields never become API profile fields or get persisted again. */
function pickPerson(person: Person, fields: readonly (keyof Person)[]): Person {
  return Object.fromEntries(
    fields.filter((key) => key in person).map((key) => [key, person[key]]),
  ) as Person;
}
export function publicPerson(person: Person): Person {
  return pickPerson(person, publicFields);
}

/** Canonical Firestore user document; the API retains existing Person names. */
export type UserDocument = Omit<
  Person,
  "id" | "city" | "bio" | "status" | "birth_year" | "experience_level"
> & {
  user_id: string;
  location: string;
  general_description: string;
  status: NonNullable<Person["status"]> | null;
  birth_year: number | null;
  experience_level: NonNullable<Person["experience_level"]> | null;
};

export function toUserDocument(person: Person): UserDocument {
  const { id, city, bio, status, birth_year, experience_level, ...rest } =
    pickPerson(normalizePerson(person), personFields);
  return {
    ...rest,
    user_id: id,
    location: city,
    general_description: bio,
    status: status ?? null,
    birth_year: birth_year ?? null,
    experience_level: experience_level ?? null,
  };
}

export function fromUserDocument(
  record: UserDocument,
  documentId: string,
): Person {
  if (record.user_id !== documentId)
    throw Error(`User ID does not match its document: ${documentId}`);
  const {
    user_id,
    location,
    general_description,
    status,
    birth_year,
    experience_level,
    ...rest
  } = record;
  return normalizePerson(
    pickPerson(
      {
        ...rest,
        id: user_id,
        city: location,
        bio: general_description,
        ...(status == null ? {} : { status }),
        ...(birth_year == null ? {} : { birth_year }),
        ...(experience_level == null ? {} : { experience_level }),
      },
      personFields,
    ),
  );
}
