# Attendee onboarding with mandatory CV and editable review

Status: approved for implementation by the user; implemented and verified locally. See `docs/onboarding.md` for delivered behavior and validation.

## Requested outcome

An attendee creates an account with email/password or Google, uploads a CV or equivalent background document, reviews the extracted profile, corrects errors and fills missing matching information, and explicitly finishes onboarding. Only the confirmed profile is then sent to the existing matching pipeline. Match the current GEvents design. Organization onboarding is deferred.

## Current integration points

- `src/components/RegistrationForm.tsx`, `src/backend.ts`, and `src/store.tsx` already support Firebase email/password and Google authentication.
- `POST /api/cv` privately stores a PDF of up to 5 MiB. A stored filename alone is not an attachment. The extractor currently accepts PDFs through the website, with a 20-page parsing limit.
- `POST /api/matching/cv/extract` generates a private proposal; `GET /api/matching/cv/proposal` reloads it. Both bind the proposal to the account, attachment, and canonical profile revision.
- `POST /api/matching/cv/confirm` currently accepts only unchanged values from the extraction. Its checkbox UI cannot correct a field or fill a missing one.
- CV uploads and ordinary profile edits currently call `queueMatchingSync`. Candidate processing therefore needs to respect an explicit onboarding gate.
- The extraction schema has nullable values. It does not establish that every field must contain a value. Matching narratives currently consume role/headline, education, skills, description, status, and seniority; location and birth year also support eligibility filters.

## Approaches considered

1. **Dedicated, resumable onboarding wizard — recommended.** Reuse authentication, private PDF storage, Gemma extraction, and the existing matching worker. Add a custom frontend and an atomic completion contract. This directly enforces the requested order and supports interruption/retry.
2. **Expand the existing profile page.** Smaller UI change, but upload and review stay disconnected from signup, and the normal app would still need a gate around that page.
3. **One long registration form.** Fewer navigation steps, but a poor fit for slow extraction, correction of structured records, and phone use. Recovery is harder to explain.

## User flow and visual design

Use a full-page onboarding layout with four actual steps: Account, Your CV, Review profile, Your interests. Extraction is a live processing state within Your CV, rather than a separate form step. Completion happens on the final screen.

Reuse the brand mark, Manrope headings, Roboto body text, and theme tokens from `src/bold.css`: canvas `#f4f5fa`, ink `#171923`, blue `#3255ff`, coral `#ff745e`, mint `#82efc5`, and yellow `#ffdb39`. Use the matching dark-theme variables. Keep forms on a quiet surface with the existing corner shapes, line colors, and button styling. A single geometric illustration in the desktop introduction area supplies the app's identity.

Desktop: a narrow introduction/progress column beside a wider, left-aligned form. Phone: brand and compact step progress above one form column; remove the decorative illustration, keep labels and errors visible, and ensure the action area does not obscure fields. Controls have visible keyboard focus, usable touch targets, semantic labels, and reduced-motion support. No simulated progress percentage or artificial loading delay.

### Account

Offer Google and email/password account creation with the existing password reset and sign-in paths. Explain before account creation that a CV/background document is required next. Keep passwords exclusively in Firebase Auth. Account email is read-only during review and comes from authenticated claims.

### Your CV

Use a custom upload area with a file-picker button and desktop drag/drop. State the actual limits: PDF, up to 5 MiB and 20 pages. Accept a CV, resume, or PDF background summary describing studies, projects, skills, and experience; a formal employment history is not required. Formats such as DOCX or image uploads need separate parser/storage support and are outside this initial design.

There is no Skip action. An actual stored document is mandatory. After upload, begin extraction automatically and show honest states: Uploading your CV, Reading your CV, and Preparing your profile. If upload succeeds but extraction fails, retain the document and offer Retry extraction or Replace document. Failure never advances the user into a supposedly reviewed profile. Users can sign out and resume later.

### Review profile

Prefill editable fields from the private extraction, with account names as a fallback. Show small source hints such as From your CV and Needed for matching where useful. An extracted value is always a proposal. Correcting a value must not require accepting an incorrect original first.

Group fields into About you, Skills, and Education and experience. Use labeled text fields, descriptions, editable skill chips, bounded select controls, and add/remove forms for education and work records. Do not expose raw JSON or a checkbox dump of every property. Preserve structured records and distinguish a missing field from an explicitly empty history.

Required usable profile information: first name, last name, headline/current role, city/location, short description, and at least one skill. A person starting out may use their student/project role and skills they are learning. Do not require a school, employer, or past job.

Ask the user to review current status, birth year, and experience level because the existing pipeline uses them for eligibility. Permit an explicit unknown/not-provided choice, persisted as null, rather than inventing values. Explain that missing eligibility information can prevent matching to events with corresponding restrictions. Use the current supported status and seniority values; do not silently translate Beginner into Junior or infer a birth year from graduation dates.

Phone, languages, education/work records, school/organization, and external profile links remain optional. Education and employment entries use the existing date/order and field-length validation. The current extractor does not propose every optional field; allow the user to add those manually without expanding the extraction model in this feature.

### Your interests and finish

Use custom multi-select controls for topics/interests, goals (Learning, Networking, Building, Career, Research), preferred event kinds, and formats. Ask how the person wants to participate using existing Participant/Mentor/Speaker/Judge roles, and whether they are looking for a team. Require at least one interest, goal, event kind, format, and role. Keep recommendation notifications an explicit opt-in.

Include a compact editable summary and the action Finish setup. Clicking it saves the complete reviewed profile, records server-owned completion, and queues the existing matching pipeline. After a successful profile commit, open Home. If indexing is pending or unavailable, show that the profile was saved and recommendations are still being prepared; do not force the person to create the account or review the CV again.

## State, persistence, and authorization

Create new Firebase attendee accounts with private server-owned onboarding metadata: version, required/completed status, and completion timestamp. Determine the frontend gate from this authoritative state, never a browser flag. An unfinished attendee sees onboarding after refresh, sign-out/sign-in, or a direct application link.

Keep existing real profiles, imported dataset users, demo fixtures, and the organizer flow working. Existing profiles are explicitly treated as legacy accounts at migration; do not claim their extraction was reviewed. The mandatory flow applies to newly created attendee accounts and accounts already marked as requiring onboarding. Organization account creation and organizer permissions remain outside this work.

Store resumable drafts in a separate private `onboardingDrafts/{uid}` collection below the existing workspace, with an equivalent demo repository implementation. Bind a draft to the attachment path, extraction hash, and expected canonical profile revision. Draft writes do not change canonical profile `updated_at`, overwrite the approved profile, or enqueue matching. Keep drafts and onboarding internals out of public people views and ordinary matching context.

Add authenticated draft load/save and onboarding completion endpoints. Resolve identity from the Firebase session. Validate field allowlists and limits on the server. Reject client-owned UID, account email/verification, storage paths, completion timestamps, or organizer claims. Hide unfinished new attendees from community/candidate discovery.

Completion is a dedicated atomic contract, not several frontend writes. It accepts the user's corrected profile, preferences, draft revision, expected profile revision, and extraction hash. Verify attachment ownership/current path, a successful extraction for that attachment, and the unchanged source revision. In the same transaction, save the validated profile, mark the attachment extraction completed, record onboarding completion, and clear the draft. Repeated completion requests must be safe and must not repeat an obsolete overwrite.

Retain the existing immutable extraction confirmation contract for existing consumers. The new completion contract distinguishes the original machine proposal from user-authored corrections and manually added fields. Private extraction provenance remains private; the canonical reviewed profile is the matching source. The worker acknowledgement must support this distinction without insisting corrected fields equal the original proposal.

Suppress candidate indexing for pending onboarding accounts at both dispatch and worker processing, including unrelated queue syncs. Revalidate completion when running queued candidate jobs and when returning candidate matches. Continue processing event jobs normally. After successful completion, enqueue the confirmed canonical revision using the current model, dimension, narrative recipe, and stale-write checks. Do not change ranking or replace the established extraction/embedding models.

## Recovery and document lifecycle

- Invalid file: explain the format/size/page limit and keep the upload step usable.
- Extraction unavailable or unreadable: retain the upload, show a retry/replace action, and never claim extraction succeeded.
- Incomplete extraction: show the editable review with missing required fields highlighted. Unknown eligibility values are explicit choices.
- Refresh during review: reload the private draft and current proposal without re-extracting a valid document. A different account cannot receive the previous account's draft.
- Draft/profile/attachment conflict: preserve visible user edits, explain that the source changed, and reload/reconcile deliberately. Never silently overwrite a newer profile.
- CV replacement during onboarding: invalidate the old extraction and draft binding before allowing completion. Start extraction of the new attachment.
- CV removal before completion: return to mandatory upload. After onboarding, retain the existing ability to remove a private CV; completion represents the reviewed profile, and any attachment-derived stale work is still invalidated.
- Pipeline outage after commit: preserve completed onboarding and report processing state honestly; use the existing durable job/retry mechanism.

## Verification and delivery

Test server-enforced completion order, attempted skip/direct-link bypass, owner-only draft access, corrected/missing-field acceptance, unsupported field rejection, stale attachment/profile/draft conflicts, duplicate completion, and suppression of incomplete-user indexing/candidate discovery. Preserve existing signup, CV storage, extraction, and matching tests.

Exercise browser flows at desktop and 390px phone widths: email and Google signup contracts, upload, extraction wait/failure/retry, editable review, missing-field validation, interests, finish, refresh/resume, and completion with indexing unavailable. Check keyboard navigation, focus after step changes, light/dark themes, reduced motion, and horizontal overflow.

Run the repository checks plus relevant Python matching tests. Browser fixtures must be distinguishable from live Firebase/Gemma verification. Verify the deployed flow separately before reporting public readiness. Deliver a focused feature branch and a reviewable working flow; do not publish directly to master.
