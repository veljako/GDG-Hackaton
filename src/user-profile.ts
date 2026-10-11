import type { Person } from "./types";

// Keep old display names intact. A full name cannot reliably be split into parts.
export function normalizePerson(person: Person): Person {
  return {
    ...person,
    learningSkills: person.learningSkills ?? [],
    country: person.country ?? "",
    birth_date: person.birth_date ?? null,
    first_name: person.first_name ?? "",
    last_name: person.last_name ?? "",
    email: person.email ?? null,
    email_verified: person.email_verified ?? false,
    phone: person.phone ?? "",
    education: person.education ?? [],
    work_experience: person.work_experience ?? [],
    languages: person.languages ?? [],
    cv_document: person.cv_document ?? null,
    created_at: person.created_at ?? null,
    updated_at: person.updated_at ?? null,
  };
}
