const labels: Record<string, string> = {
  first_name: "First name",
  last_name: "Last name",
  name: "Name",
  title: "Headline",
  bio: "About you",
  city: "City",
  school: "School",
  skills: "Skills",
  interests: "Interests",
  education: "Education",
  work_experience: "Work experience",
  experience: "Experience",
  languages: "Languages",
  phone: "Phone",
  status: "Current status",
  birth_year: "Birth year",
  experience_level: "Experience level",
  roles: "Event roles",
  linkedin: "LinkedIn",
  kaggle: "Kaggle",
};
export const cvFieldLabel = (key: string) =>
  labels[key] ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
export function cvReviewValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value))
    return value
      .map(cvReviewValue)
      .filter(Boolean)
      .join(
        value.some((v) => typeof v === "object" && v !== null) ? "\n" : ", ",
      );
  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    const heading = [
      row.institution ?? row.company,
      row.degree ?? row.position,
      row.field,
      row.location,
    ]
      .map(cvReviewValue)
      .filter(Boolean)
      .join(" · ");
    const dates = [row.start_date, row.end_date]
      .map(cvReviewValue)
      .filter(Boolean)
      .join(" – ");
    return [heading, dates, cvReviewValue(row.description)]
      .filter(Boolean)
      .join(" — ");
  }
  return "";
}
export const reviewableCvFields = (proposal: Record<string, unknown>) =>
  Object.entries(proposal).filter(
    ([, value]) => cvReviewValue(value).length > 0,
  );
export const matchingSourceLabel = (source?: string) =>
  source?.startsWith("structured")
    ? "Profile and event filters"
    : "Matched by meaning";
