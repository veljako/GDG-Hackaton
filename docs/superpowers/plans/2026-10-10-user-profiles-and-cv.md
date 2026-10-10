# User database and CV implementation

- [x] Add regression tests for user defaults, explicit names, background validation and private fields.
- [x] Extend profile types, API validation, canonical Firestore mapping, trusted dataset imports and backwards-compatible normalization.
- [x] Add server-owned email/verification and timestamps, signup name parts and editable basic profile fields.
- [x] Add private local/Cloud Storage CV adapters, authenticated PDF upload/download/remove endpoints and metadata rollback/cleanup.
- [x] Wire actual CV persistence into the profile with save/error feedback and authenticated downloads.
- [x] Verify full suite/build, storage failure cases and desktop/mobile profile workflows.
- [x] Document the canonical user record, Cloud Storage configuration and deployment status.

## Evidence

- `npm.cmd run check`: 107 tests in 16 files passed; server/frontend TypeScript and production build passed.
- `scripts/verify-user-db.mjs`: 1440px/390px profile save/reload and private CV upload/download/removal passed without page errors or horizontal overflow.
- `scripts/verify-registration.mjs`: intercepted Firebase signup, failure/retry, saved explicit name parts and exactly one account passed at 1440px/390px.
- Existing demo preview refreshed after capturing its full fictional workspace (12 profiles, 7 events, 7 teams). Local and public API config show demo mode; the new CV route responds with the expected authenticated missing-file message.
- Cloud writes/storage provisioning were not performed: backend ADC and credential-file environment are absent; browser inventory contains no signed-in Firebase session.

The user explicitly requested implementation now. Work executes inline without further design approval. C:\GDG has no Git repository; preserve existing local work. Firebase activation cannot proceed from this machine until authorized backend credentials exist.
