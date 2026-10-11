# Attendee onboarding

New Firebase attendee accounts follow Account → Your CV → Review profile → Your interests. Existing accounts without an explicit onboarding marker, dataset users, demo profiles, and configured organizers retain their current flow.

Upload is mandatory: a PDF CV, resume, or background summary, up to 5 MiB and 20 pages. The upload remains private. Gemma automatically proposes fields; the person corrects them and supplies missing information in custom forms matching GEvents' light/dark design. Education, work history, languages, phone, and profile links are editable but optional. Save progress and Save and continue preserve a private draft across refresh/sign-in; unsaved edits are clearly labeled.

Completion requires names, a headline, location, description, a skill, an interest, event roles, goals, event types, and formats. Status, seniority and birth year can be explicitly unknown. Beginners do not need past employment or a formal CV: a PDF background summary works. Account identity, email, timestamps, file paths, and completion are server-owned.

## Data and pipeline handoff

- Private `users/{uid}.onboarding` metadata gates new accounts. Pending accounts cannot participate or appear in community/candidate discovery.
- Private `onboardingDrafts/{uid}` stores the review separately from the approved profile. Saves compare draft version, attachment, extraction hash, and canonical revision.
- `POST /api/onboarding/complete` validates the corrected profile and atomically saves it, marks extraction reviewed, clears the draft, and records a pending matching handoff under those same guards. The legacy immutable CV confirmation route remains compatible.
- The pipeline indexes the confirmed canonical profile. Python dispatch, queued-job freshness, and candidate reads reject unfinished accounts. Models and ranking are unchanged.
- A durable pending matching marker survives delivery failure and API restart. The API retries immediately on startup and every 30 seconds while a matching worker is configured. Home shows the pending state with an owner-only Retry matching action. Idempotent worker jobs and revision checks prevent duplicate or stale updates.
- Replacing a CV invalidates the old source binding. Extraction conflicts can be retried without leaving the review locked. The provider handles completion observed through polling, including a delayed completion response.

Endpoints: `GET/POST /api/onboarding/draft`, `POST /api/onboarding/complete`, and `POST /api/onboarding/retry-matching`. All require authenticated ownership; clients cannot supply a different user ID.

## Verification on 11 October 2026

149 Node tests and 234 Python tests pass. Server/frontend TypeScript checks and the production build pass. Production browser fixtures pass at 1440px and 390px for account controls, mandatory upload, extraction conflict/retry, editable structured records, save/resume, validation, dark theme, reduced motion, overflow, a delayed completion/polling race, Home navigation, and matching outage/retry. Existing Firebase registration/recovery browser contracts also pass at both widths.

These checks use isolated fixtures and transaction doubles; they do not create Firebase accounts or claim live Firebase/Gemma onboarding was exercised. Activate by deploying the frontend, restarting/updating the Node API, and updating the Python worker together. Existing model/storage configuration is still required. No cloud deployment was performed for this change.

```powershell
$env:NODE_OPTIONS='--require=C:\GDG\.runtime\preload-rollup.cjs'
npm.cmd run check
$env:GEVENTS_URL='http://127.0.0.1:5292'
node scripts/verify-onboarding.mjs
node scripts/verify-registration.mjs
& 'C:\Users\urosd\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' scripts/python-project.py -m unittest discover -s extractor_cv/tests
```

Screenshots are saved in `.runtime/onboarding/` (account, upload, review, and interests at desktop/phone widths). The Rollup WASM preload avoids the workstation's existing native-module application-control restriction; it does not change dependencies or system security settings.
