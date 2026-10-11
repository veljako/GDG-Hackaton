import type { Hackathon } from "../types";
export function MatchingEventDetails({ event }: { event: Hackathon }) {
  const eligibility = event.eligibility;
  const criteria = [
    eligibility?.requiredSkills?.length
      ? `Prerequisite skills: ${eligibility.requiredSkills.join(", ")}`
      : "",
    eligibility?.seniorities?.length
      ? `Professional seniority: ${eligibility.seniorities.join(", ")}`
      : "",
    eligibility?.statuses?.length
      ? `Current status: ${eligibility.statuses.join(", ")}`
      : "",
    eligibility?.minAge != null ? `Minimum age: ${eligibility.minAge}` : "",
    eligibility?.maxAge != null ? `Maximum age: ${eligibility.maxAge}` : "",
    eligibility?.minBirthYear != null
      ? `Earliest birth year: ${eligibility.minBirthYear}`
      : "",
    eligibility?.maxBirthYear != null
      ? `Latest birth year: ${eligibility.maxBirthYear}`
      : "",
  ].filter(Boolean);
  return (
    <>
      {!!event.topics?.length && (
        <>
          <h3>Topics</h3>
          <p>{event.topics.join(", ")}</p>
        </>
      )}
      {!!event.country && (
        <>
          <h3>Country</h3>
          <p>{event.country}</p>
        </>
      )}
      {!!event.languages?.length && (
        <>
          <h3>Event languages</h3>
          <p>{event.languages.join(", ")}</p>
        </>
      )}
      {!!event.audience?.skills.length && (
        <>
          <h3>Skills practiced</h3>
          <p>{event.audience.skills.join(", ")}</p>
        </>
      )}
      {!!event.audience?.taughtSkills?.length && (
        <>
          <h3>Skills taught</h3>
          <p>{event.audience.taughtSkills.join(", ")}</p>
        </>
      )}
      {event.audience && (
        <>
          <h3>Who will benefit?</h3>
          <p>
            {[
              event.audience.goals.join(", "),
              event.audience.roles.join(", "),
              event.audience.levels.length
                ? event.audience.levels.join(", ")
                : "All experience levels",
            ]
              .filter(Boolean)
              .join(" · ")}
            . These describe relevance, not admission requirements.
          </p>
        </>
      )}
      <h3>Eligibility requirements</h3>
      {criteria.length ? (
        <>
          <ul>
            {criteria.map((value) => (
              <li key={value}>{value}</li>
            ))}
          </ul>
          <p>
            These are explicit admission requirements. Skills practiced and
            taught are separate from prerequisites.
          </p>
        </>
      ) : (
        <p>No explicit eligibility restrictions.</p>
      )}
    </>
  );
}
