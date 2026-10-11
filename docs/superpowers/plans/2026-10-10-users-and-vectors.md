# Firebase users and vectors implementation plan

**Goal:** Persist the requested user fields and provide Firestore vector storage for users and hackathons.

**Architecture:** Canonical users are mapped to existing Person API types. A separate server repository handles supplied native vectors; authenticated profile writes continue through the existing API.

**Tech stack:** TypeScript, Firebase Admin, Firestore, Zod, Vitest.

## Tasks

- [x] Add failing regression cases to `server/firestore-repository.test.ts` for canonical users and preserved schema-2 migration. Run `npm.cmd run test -- server/firestore-repository.test.ts`.
- [x] Implement `server/users.ts`, optional profile fields in `src/types.ts` and `server/schema.ts`, and schema-3 mapping in `server/repository.ts`. Keep old people documents as recovery data and refuse ambiguous overlaps.
- [x] Add failing vector repository tests in `server/embeddings.test.ts`: native vector writes, source/hash guards, validation, model isolation, user/hackathon routing and stale-result removal.
- [x] Implement `server/embeddings.ts` with `source`, `upsert` and `nearest` methods. Inputs must name a model and contain 1–2048 finite components; reject zero cosine vectors.
- [x] Implement trusted `server/manage-embeddings.ts` CLI and `server/vector-indexes.ts` index generator. Require explicit project/source/dimensions and validate before cloud access. No automatic embedding generation.
- [x] Document collection layout, migration, CLI usage and credential/index activation in `docs/firebase-vectors.md`, update Firebase guides and README.
- [x] Run focused tests, TypeScript, then `npm.cmd run check`; verify CLI dry-run/index generation. Check cloud credential availability without revealing credentials. Record any live activation blocker.

Execute inline in this session under the user's explicit instruction to make the change. Git commits are unavailable because `C:\GDG` is not a Git repository.

## Verification evidence

- npm.cmd run check: 96 tests across 14 files passed, server/frontend TypeScript passed, production build passed.
- Vector CLI: explicit 768-dimension index preview passed; supplied fixture dry-run passed with cloudAccess false. 768 was a verification example, not a selected production dimension.
- Firebase CLI target-project index read failed: Failed to authenticate. No cloud migration, vector write or index deployment was performed.
- Production activation remains pending backend ADC/IAM, valid Firebase CLI login, model/dimension selection and deployment of the updated backend.
