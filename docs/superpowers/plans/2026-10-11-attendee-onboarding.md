# Attendee Onboarding Implementation Plan

**Goal:** Deliver mandatory PDF upload, extraction, editable review, and confirmed matching for newly registered attendees.

**Architecture:** Reuse Firebase authentication and existing CV extraction. A server-owned onboarding marker gates new accounts; separate private drafts preserve edits without changing canonical revisions. Atomically complete the profile under extraction and draft guards, then queue matching.

**Tech stack:** React/TypeScript, existing CSS tokens, Zod, Node API, Firestore transactions, Python matching worker, Vitest and Playwright.

## Constraints

Preserve email/password and Google, legacy/demo accounts, organization behavior, current matching models and ranking, private CVs, PDF/5 MiB/20-page limits, theme tokens, and account identity authority. No production user creation in verification.

## Tasks

- [x] Define shared onboarding metadata/draft/profile contracts and test missing-value validation and source binding. Add strict server field allowlists.
- [x] Test account gating, private discovery, draft persistence, corrected-field completion, extraction/draft conflict rejection and replay safety. Implement repository drafts and atomic completion plus authenticated endpoints. Run Vitest with the existing WASM Rollup preload.
- [x] Build custom signup and onboarding forms with account/CV/review/interests progress. Upload automatically extracts; review fields are editable; save drafts and resume; finish adopts the returned snapshot. Verify desktop and phone flows with intercepted Firebase/extraction contracts.
- [x] Test and implement worker candidate suppression for unfinished accounts, including stale queued jobs and current candidate reads. Keep legacy users eligible and event jobs operational.
- [x] Run full Node checks, the full Python suite, browser verification, and review changes for authorization, stale-write safety and form recovery. Save screenshots and report the concrete outcome and any live-service limits.

## Interfaces

`Person.onboarding?: { version: 1; status: 'required' | 'completed'; completed_at: string | null }` is private and server-owned; missing metadata denotes a legacy account.

`OnboardingDraft` contains `version`, `cv_path`, `extraction_hash`, `expected_profile_updated_at`, editable `profile`, and `step: 'review' | 'interests'`.

`GET /api/onboarding/draft` returns `{ draft }`. `POST /api/onboarding/draft` accepts `{ profile, step, expected_extraction_hash, expected_profile_updated_at, expected_draft_version }`, returning `{ draft }`. `POST /api/onboarding/complete` accepts the same envelope, returning `{ state, organizer, message, matching_sync }`. First draft saves use null draft version; subsequent saves/completion use the last server version. Completion requires a saved draft and current proposal; review corrections do not need to equal model output.

Frontend uses existing `uploadCv`, `semanticMatching('cv/extract'|'cv/proposal')`, authentication, and a context snapshot refresh helper. Backend retains the legacy immutable `cv/confirm` endpoint.

Candidate workers skip users whose explicit onboarding status is required at dispatch, job execution and readback. Their input retains only the minimal private gate marker; drafts never enter matching requests.
