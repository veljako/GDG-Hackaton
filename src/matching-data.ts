import type { Eligibility, GEventsEvent, Person, Role } from "./types";

const key = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

/** Upgrade the historical extractor convention once; new bounds are numerically ascending. */
export function normalizeEvent(event: GEventsEvent): GEventsEvent {
  const legacy = event as GEventsEvent & {
    criteria_version?: number;
    min_birth_year?: number | null;
    max_birth_year?: number | null;
    min_age?: number | null;
    max_age?: number | null;
    remote?: boolean | null;
    seniority?: string | null;
  };
  const {
    min_birth_year,
    max_birth_year,
    min_age,
    max_age,
    remote,
    seniority,
    criteria_version: _version,
    ...rest
  } = legacy;
  const eligibility: Eligibility = { ...(event.eligibility ?? {}) };
  const conventional =
    legacy.criteria_version === 2 || event.matchingVersion === 2;
  if (
    eligibility.minBirthYear === undefined &&
    (min_birth_year != null || max_birth_year != null)
  )
    eligibility.minBirthYear = conventional
      ? (min_birth_year ?? null)
      : (max_birth_year ?? null);
  if (
    eligibility.maxBirthYear === undefined &&
    (min_birth_year != null || max_birth_year != null)
  )
    eligibility.maxBirthYear = conventional
      ? (max_birth_year ?? null)
      : (min_birth_year ?? null);
  if (eligibility.minAge === undefined && min_age != null)
    eligibility.minAge = min_age;
  if (eligibility.maxAge === undefined && max_age != null)
    eligibility.maxAge = max_age;
  if (
    seniority &&
    !eligibility.seniorities?.length &&
    !eligibility.statuses?.length
  ) {
    const level = key(seniority);
    if (level === "student") eligibility.statuses = ["Student"];
    else if (/junior|intern/.test(level)) eligibility.seniorities = ["Junior"];
    else if (/mid|intermediate/.test(level)) eligibility.seniorities = ["Mid"];
    else if (/senior/.test(level)) eligibility.seniorities = ["Senior"];
  }
  return {
    ...rest,
    matchingVersion: 2,
    kind: event.kind ?? "hackathon",
    topics: event.topics ?? [...event.tags],
    country: event.country ?? "",
    languages: event.languages ?? [],
    price: event.price ?? null,
    eligibility,
    // Only upgrade a legacy true flag that conflicts with the former in-person default.
    format:
      event.matchingVersion !== 2 &&
      remote === true &&
      event.format === "In person"
        ? "Hybrid"
        : event.format,
    ...(event.audience
      ? {
          audience: {
            ...event.audience,
            taughtSkills: event.audience.taughtSkills ?? [],
          },
        }
      : {}),
  };
}

export type EligibilityResult = {
  eligible: boolean;
  unknown: boolean;
  reasons: string[];
};

/** Audience skills/roles/levels are preferences. Only explicit eligibility excludes attendees. */
export function eventEligibility(
  event: GEventsEvent,
  person: Person,
  _role?: Role,
): EligibilityResult {
  const rules = normalizeEvent(event).eligibility!;
  const reasons: string[] = [];
  let unknown = false;
  const missing = (reason: string) => {
    unknown = true;
    reasons.push(reason);
  };
  for (const skill of rules.requiredSkills ?? [])
    if (!person.skills.some((value) => key(value) === key(skill)))
      reasons.push(`Required skill: ${skill}.`);
  if (rules.seniorities?.length) {
    if (!person.experience_level)
      missing(
        "Add your professional seniority to check this event's requirement.",
      );
    else if (!rules.seniorities.includes(person.experience_level))
      reasons.push(`Required seniority: ${rules.seniorities.join(" or ")}.`);
  }
  if (rules.statuses?.length) {
    if (!person.status)
      missing("Add your current status to check this event's requirement.");
    else if (!rules.statuses.includes(person.status))
      reasons.push(`Required status: ${rules.statuses.join(" or ")}.`);
  }
  const birthDate = person.birth_date;
  const validDate =
    birthDate &&
    /^\d{4}-\d{2}-\d{2}$/.test(birthDate) &&
    Number.isFinite(Date.parse(birthDate)) &&
    new Date(birthDate).toISOString().slice(0, 10) === birthDate;
  const year = validDate ? Number(birthDate.slice(0, 4)) : person.birth_year;
  if (rules.minBirthYear != null || rules.maxBirthYear != null) {
    if (year == null)
      missing("Add your birth year to check this event's eligibility.");
    else {
      if (rules.minBirthYear != null && year < rules.minBirthYear)
        reasons.push(`Birth year must be ${rules.minBirthYear} or later.`);
      if (rules.maxBirthYear != null && year > rules.maxBirthYear)
        reasons.push(`Birth year must be ${rules.maxBirthYear} or earlier.`);
    }
  }
  if (rules.minAge != null || rules.maxAge != null) {
    const at = event.date;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(at) ||
      !Number.isFinite(Date.parse(at)) ||
      new Date(at).toISOString().slice(0, 10) !== at
    )
      missing(
        "The organizer must set the event date to check age eligibility.",
      );
    else if (year == null)
      missing(
        "Add your birth date to check age eligibility at the event date.",
      );
    else {
      const high = Number(at.slice(0, 4)) - year;
      const low = at.slice(5) === "12-31" ? high : high - 1;
      const age = validDate
        ? high - Number(at.slice(5) < birthDate.slice(5))
        : null;
      // With year alone, age is in [high-1, high]; never silently accept the boundary.
      if (rules.minAge != null) {
        if ((age ?? high) < rules.minAge)
          reasons.push(`Minimum age at the event: ${rules.minAge}.`);
        else if (age == null && low < rules.minAge)
          missing(
            "Add your exact birth date to verify the minimum age at the event.",
          );
      }
      if (rules.maxAge != null) {
        if ((age ?? low) > rules.maxAge)
          reasons.push(`Maximum age at the event: ${rules.maxAge}.`);
        else if (age == null && high > rules.maxAge)
          missing(
            "Add your exact birth date to verify the maximum age at the event.",
          );
      }
    }
  }
  return { eligible: reasons.length === 0, unknown, reasons };
}

/** Cross-field checks also run after partial profile/event updates are merged. */
export function matchingProfileError(
  person: Pick<Person, "birth_date" | "birth_year">,
): string | undefined {
  if (
    person.birth_date &&
    person.birth_year != null &&
    Number(person.birth_date.slice(0, 4)) !== person.birth_year
  )
    return "Birth date and birth year must agree.";
}

export function matchingEventError(
  event: Pick<GEventsEvent, "eligibility">,
): string | undefined {
  const rules = event.eligibility;
  if (!rules) return;
  for (const [low, high, label] of [
    [rules.minAge, rules.maxAge, "age"],
    [rules.minBirthYear, rules.maxBirthYear, "birth year"],
  ] as const) {
    if (low != null && high != null && low > high)
      return `Minimum ${label} must not exceed maximum ${label}.`;
  }
}
