# Firebase registration implementation plan

**Goal:** Firebase collections for the mock dataset and real-user account registration; onboarding follows later.
**Architecture:** Existing API and Firebase Admin authorization; browser Firebase Auth; explicit transactional seed import.
**Tech stack:** React, TypeScript, Firebase Auth/Admin, Firestore, Vitest, Playwright.

## Constraints

- No onboarding implementation or inferred preferences.
- No fake Firebase Auth users; real profiles use verified UIDs.
- Preserve existing data; import into empty workspaces only.
- No credential publication; no Google account access without authorization.
- This folder has no Git repository, so no commits/worktrees are available.

## Tasks

- [x] Add failing persistence/import tests for entity collections, consistent reads, legacy conversion, refusal to overwrite and invalid references.
- [x] Implement collection persistence and a validated, dry-run-by-default CLI importing seed or JSON with explicit project verification.
- [x] Add failing registration tests; implement Firebase email/password signup, login, reset, readable errors and profile creation retry. Update login gate with accessible fields and loading feedback.
- [x] Update setup/dataset docs, generate reviewable dataset, run all checks and desktop/mobile browser verification.
- [ ] Activate Firebase/import only when Google account access and backend credentials are available; otherwise report the exact remaining setup.

Local validation: full test suite, backend type checks and production build pass; 1440px and 390px registration checks pass with Firebase responses intercepted. Dry-run import validates 43 related records. Live activation is pending Google account authorization and backend ADC; no cloud writes have occurred.
