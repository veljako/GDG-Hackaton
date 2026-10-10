import type { DemoState, GEventsEvent, Person, Recommendation } from "./types";
import { normalizePerson } from "./user-profile";

export const eventKinds = [
  "hackathon",
  "conference",
  "meetup",
  "festival",
] as const;
export const goals = [
  "Learning",
  "Networking",
  "Building",
  "Career",
  "Research",
] as const;
export const levels = ["Beginner", "Intermediate", "Advanced"] as const;
export const formats = ["In person", "Hybrid", "Online"] as const;
export const kindLabel = (event: Pick<GEventsEvent, "kind">) => {
  const kind = event.kind ?? "hackathon";
  return kind[0].toUpperCase() + kind.slice(1);
};
export const hasTeams = (event: GEventsEvent) =>
  (event.kind ?? "hackathon") === "hackathon";
export const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
export const todayISO = () => new Date().toISOString().slice(0, 10);
export const registrationOpen = (event: GEventsEvent, today = todayISO()) =>
  event.status === "open" && event.endDate >= today && event.deadline >= today;

export function recommendEvent(
  event: GEventsEvent,
  person: Person,
): Recommendation {
  const pref = person.preferences;
  const rows: { weight: number; match: number; reason: string }[] = [];
  const overlap = (
    wanted: string[],
    actual: string[],
    weight: number,
    label: string,
  ) => {
    if (!wanted.length || !actual.length) return;
    const unique = [...new Set(wanted.map(normalize))];
    const shared = unique.filter((x) => actual.some((y) => normalize(y) === x));
    rows.push({
      weight,
      match: shared.length / unique.length,
      reason: shared.length
        ? `${label}: ${wanted.find((x) => normalize(x) === shared[0])}`
        : "",
    });
  };
  overlap(event.tags, person.interests, 35, "Topic");
  overlap(event.audience?.goals ?? [], pref?.goals ?? [], 25, "Goal");
  overlap(event.audience?.skills ?? [], person.skills, 20, "Skill");
  // Role and level share one evidence category rather than multiplying confidence.
  const fit: { weight: number; match: number; reason: string }[] = [];
  const start = rows.length;
  overlap(event.audience?.roles ?? [], person.roles, 5, "Role");
  overlap(
    event.audience?.levels ?? [],
    pref?.level ? [pref.level] : [],
    5,
    "Experience",
  );
  fit.push(...rows.splice(start));
  if (fit.length)
    rows.push({
      weight: 10,
      match: fit.reduce((n, r) => n + r.match, 0) / fit.length,
      reason: fit.find((r) => r.reason)?.reason ?? "",
    });
  const location = pref?.location || person.city;
  const logistics: number[] = [];
  const reasons: string[] = [];
  if (pref?.formats.length) {
    const ok = pref.formats.includes(event.format);
    logistics.push(Number(ok));
    if (ok) reasons.push(`Format: ${event.format}`);
  }
  if (location && event.format !== "Online") {
    const ok = normalize(location) === normalize(event.location);
    logistics.push(Number(ok));
    if (ok) reasons.push(`Location: ${event.location}`);
  }
  if (pref?.kinds.length) {
    const ok = pref.kinds.includes(event.kind ?? "hackathon");
    logistics.push(Number(ok));
    if (ok) reasons.push(`Type: ${kindLabel(event)}`);
  }
  if (logistics.length)
    rows.push({
      weight: 10,
      match: logistics.reduce((a, b) => a + b, 0) / logistics.length,
      reason: reasons[0] ?? "",
    });
  const evidence = rows.filter((r) => r.match > 0).length;
  const total = rows.reduce((n, r) => n + r.weight, 0);
  return {
    eventId: event.id,
    score:
      rows.length < 2
        ? null
        : Math.round(
            (rows.reduce((n, r) => n + r.weight * r.match, 0) / total) * 100,
          ),
    evidence,
    reasons: rows
      .filter((r) => r.reason)
      .map((r) => r.reason)
      .slice(0, 3),
  };
}

export function recommendationsFor(
  state: DemoState,
  person: Person,
  today = todayISO(),
): Recommendation[] {
  return state.events
    .filter(
      (e) =>
        registrationOpen(e, today) &&
        !state.applications.some(
          (a) => a.eventId === e.id && a.personId === person.id,
        ),
    )
    .map((e) => recommendEvent(e, person))
    .filter((r) => r.score !== null && r.score >= 60 && r.evidence >= 2)
    .sort(
      (a, b) =>
        (b.score ?? 0) - (a.score ?? 0) || a.eventId.localeCompare(b.eventId),
    );
}

export type SearchFilters = {
  q?: string;
  kind?: string;
  topic?: string;
  city?: string;
  format?: string;
  from?: string;
  to?: string;
  available?: boolean;
  past?: boolean;
};
export function searchEvents(
  state: DemoState,
  filters: SearchFilters,
  today = todayISO(),
): GEventsEvent[] {
  const terms = normalize(filters.q ?? "")
    .split(/\s+/)
    .filter(Boolean);
  return state.events
    .filter((e) => {
      const haystack = normalize(
        `${e.title} ${e.organizer} ${e.description} ${e.theme} ${e.location} ${e.tags.join(" ")}`,
      );
      const places = state.applications.filter(
        (a) => a.eventId === e.id && a.status !== "rejected",
      ).length;
      const past = e.status === "past" || e.endDate < today;
      return (
        e.status !== "draft" &&
        (filters.past ? past : !past) &&
        terms.every((t) => haystack.includes(t)) &&
        (!filters.kind || (e.kind ?? "hackathon") === filters.kind) &&
        (!filters.topic ||
          e.tags.some((t) => normalize(t) === normalize(filters.topic!))) &&
        (!filters.city ||
          normalize(e.location).includes(normalize(filters.city))) &&
        (!filters.format || e.format === filters.format) &&
        (!filters.from || e.endDate >= filters.from) &&
        (!filters.to || e.date <= filters.to) &&
        (!filters.available ||
          (registrationOpen(e, today) && places < e.capacity))
      );
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/** Existing records retain their data; only new optional defaults are supplied. */
export function normalizeState(state: DemoState): DemoState {
  return {
    ...state,
    people: state.people.map(normalizePerson),
    events: state.events.map((e) => ({
      ...e,
      kind: e.kind ?? "hackathon",
      registration: e.registration ?? "review",
      ...(e.publishedAt
        ? {}
        : e.status !== "draft"
          ? { publishedAt: "legacy" }
          : {}),
    })),
  };
}
