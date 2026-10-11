# User and event matching data

Approved by the user on 11 October 2026: extend both sides of matching throughout storage, frontend, backend, extraction and embeddings. Preserve the configured model and ranking weights. Separate relevance from explicit eligibility.

## Canonical contract

- `Person`: existing `bio`, `skills`, `interests`, `roles`, `preferences.goals/kinds/formats/level` remain authoritative. Add optional `learningSkills: string[]`, `country: string`, `preferences.maxPrice: {amount: number, currency: string} | null`, and private optional `birth_date: string | null` (ISO date). Existing `birth_year` remains supported; do not infer seniority from student status or age.
- `EventKind`: hackathon, conference, meetup, workshop, festival. Keep all legacy kinds.
- `GEventsEvent`: add optional `matchingVersion: 2`, `topics: string[]`, `country: string`, `languages: string[]`, `price: {amount: number, currency: string} | null`. Existing description/title/format/dates/deadline/status remain canonical.
- `audience.skills` describes skills practiced/useful, never an automatic prerequisite. Add optional `audience.taughtSkills: string[]`. Existing audience goals/roles/levels describe relevance; empty levels means all levels, not unknown seniority.
- Optional `eligibility`: `requiredSkills: string[]`, `seniorities: (Junior|Mid|Senior)[]`, `statuses: (Student|Employed|Freelancer)[]`, `minAge/maxAge: number|null`, `minBirthYear/maxBirthYear: number|null`. Every property optional for compatibility; missing/empty means no restriction. Numeric birth-year bounds follow normal ascending order. Explicit eligibility is enforced at registration/team admission and semantic/structured recommendations. Missing required facts cannot count as eligible. A birth year alone can establish age only away from birthday boundary ambiguity; exact date resolves it. Date is private and never included in semantic narratives.
- Preferences and roles are included in user embedding narratives, with learned skills separate from desired learning skills. Event narratives describe what people learn/build/discuss, topics, relevant roles and goals, rather than treating all attendees as already skilled.
- Python v3 event records use `criteria_version: 2`, `format: online|in_person|hybrid|null`, `topics`, `taught_skills`, `required_skills`, `goals`, `roles`, `levels`, `seniorities`, `statuses`, `min_age`, `max_age`, conventional `min_birth_year`/`max_birth_year`, plus canonical dates. Existing unversioned reversed years are converted explicitly, including one-sided bounds. Unknown format stays null when source text is silent.
- Extraction never clips the event taxonomy to skills found in existing CVs. Extract only stated facts, preserve unknowns, and distinguish skills taught from prerequisites.

## Storage and rollout

Normalize old records on read; migrate using revision-guarded transactions and an explicit matchingVersion marker. Preserve canonical profile data and private attachments. Increment the narrative recipe so old vectors are excluded and new durable jobs can regenerate from current sources. Keep source revision/hash freshness and model identity safeguards. Migration supports dry-run, explicit project/workspace and readback; no destructive collection replacement.

## Verification

Cover beginner learning, distinct prerequisites, goals/interests-only edits changing embedding sources, remote/hybrid/unknown, student/seniority separation, age boundaries, reversed/one-sided legacy years, workshop taxonomy, round-trip persistence/private fields, server-side admission, stale jobs/indexes, browser create/edit and onboarding/profile forms at 1440/390px. Run Node/Python suites, TypeScript/build and production browser fixtures. Report live deployment/readback separately from fixture verification.
