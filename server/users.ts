import type { Person } from "../src/types";
import { normalizePerson } from "../src/user-profile";

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
    normalizePerson(person);
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
  return normalizePerson({
    ...rest,
    id: user_id,
    city: location,
    bio: general_description,
    ...(status == null ? {} : { status }),
    ...(birth_year == null ? {} : { birth_year }),
    ...(experience_level == null ? {} : { experience_level }),
  });
}
