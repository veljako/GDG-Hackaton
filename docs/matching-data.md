# User and event matching

The update connects canonical records, onboarding, profile and organizer forms, APIs, extraction, durable embedding jobs and both vector stores. The existing embedding model and ranking weights are preserved.

## Fields and behavior

Users retain acquired skills, interests, roles and preferences. They can add skills they want to learn, country, an optional maximum price with currency, and an optional private birth date. Beginners can finish onboarding using a learning skill without claiming an acquired skill. Birth date and birth year must agree; exact birth dates are excluded from public profiles, training exports and embedding narratives.

Events have topics, descriptions, useful/practiced skills, taught skills, relevant goals, roles and audience levels. Optional country, languages and price support logistics. Workshops join the existing event kinds. Attendance format is explicit when publishing; extraction can preserve an unknown format in a draft.

Only explicit eligibility restricts attendance: required skills, professional seniorities, person statuses, and age/birth-year bounds. Student status is independent of seniority. Taught or practiced skills never become prerequisites automatically. Age is evaluated on the event date; an ambiguous birth year requires an exact birth date. Recommendations and new admissions check eligibility on the server. Browsing still shows events so attendees can inspect requirements. Existing accepted admissions are preserved.

## Compatibility and embedding rollout

Canonical events use `matchingVersion: 2`. Extracted criteria use `criteria_version: 2`, with numerically ascending birth-year bounds. Unversioned reversed bounds are converted explicitly, including one-sided bounds. Normalization is idempotent and preserves unrelated data.

The embedding recipe is `matching-narrative-v3`. Profile and event source hashes include the relevant new fields. Durable jobs store their model/recipe contract and reject old or stale payloads; vector queries exclude old recipes. Event extraction keeps stated topics and skills even if absent from existing CVs. Only explicit, source-grounded ISO dates are extracted; missing end/deadline placeholders for new drafts default to the start date. Updating an existing imported event preserves its established schedule.

## Migration

From `C:\GDG`, using the configured application credentials:

```powershell
# Scan and report, without writes.
npm.cmd run firebase:migrate-matching -- --project gdg-hackathon-d0b85

# Apply additive patches, check revisions, read back, and queue reindexing.
npm.cmd run firebase:migrate-matching -- --project gdg-hackathon-d0b85 --apply
```

The default workspace is `gdevPilots/main`; `--workspace` selects another explicit pilot. Per-record transactions reject concurrent changes. Revision changes preserve private attachments and safely rebase unchanged onboarding drafts and extraction bindings. A durable migration marker retains pending reindexing when worker delivery fails. Rerun the apply command to retry; `reindex: queued` confirms handoff, not completed embeddings. The worker must acknowledge the v3 recipe before that marker is cleared.

## Verified on 11 October 2026

- 187 Node tests and 260 Python tests passed. Server/frontend TypeScript checks and the production build passed.
- Production browser checks passed at 1440px and 390px: event create/edit and persistence, nullable bounds, profile learning skills/date/budget, eligibility feedback, and onboarding review/resume/completion. Existing event and organization flows also passed during integration.
- Final code review found no remaining Critical or Important issues. The local API and Python worker were restarted. The local origin and public preview served the current build and rendered account controls at both widths, without creating live accounts.
- Nine worker indexes were already READY. Three missing generic vector indexes were created through the Firestore Admin API without deleting existing indexes; their first readback was CREATING.
- **Live data migration and v3 re-embedding are blocked:** the configured project's dry-run failed with Firestore resource-exhausted code 8 before migration was applied. No live migration/readback or completed re-embedding is claimed. Retry the documented dry-run and apply commands after provider quota becomes available.

Browser evidence is in `.runtime/matching-data/`, `.runtime/onboarding/` and `.runtime/onboarding-host/verification.json`. Index readback is in `.runtime/matching-index-readiness.json`. No permanent Firebase Hosting release, Git push or merge was performed.
