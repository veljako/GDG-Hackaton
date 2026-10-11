# User and Event Matching Implementation Plan

> **For agentic workers:** Use subagent-driven-development for implementation and requesting-code-review for the final review. Independent frontend and Python tasks may run in parallel after the canonical contract is fixed.

**Goal:** Connect approved user and event matching fields throughout canonical storage, forms, extraction, embeddings and eligibility.

**Architecture:** Extend existing optional fields and shared normalization rather than replacing records. Keep relevance scoring separate from an eligibility helper used by recommendations and admission. Version Python narratives and legacy criteria explicitly.

**Tech Stack:** TypeScript/React/Zod, Node, Python, Firestore, EmbeddingGemma.

## Global Constraints

Preserve configured model and ranking weights. Keep birth date private. Preserve old unversioned reversed-year data using explicit conversion. No prerequisite inference from skills practiced or taught. Existing working branch is feat/attendee-onboarding; preserve untracked output/. No automatic public publishing or collection replacement.

### Task 1: Canonical data, persistence and eligibility (root)

- [x] Add failing schema, normalization, eligibility and registration tests to `src/matching-data.test.ts` and server tests. Test conventional and legacy bounds, an AI learner with no prerequisite, age ambiguity, and private birth-date persistence.
- [x] Extend `src/types.ts`, `server/schema.ts`, `src/user-profile.ts`, `src/onboarding.ts`, `server/users.ts`; add `src/matching-data.ts` exposing `normalizeEvent`, `eventEligibility`, and shared types. Wire `src/discovery.ts`, `src/domain.ts`, server service/dataset/training and migration CLI.
- [x] Run `npm.cmd test`, `npm.cmd run server:check` and targeted browser validation after integration.

### Task 2: Python extraction, narratives, jobs and vector storage (Python agent)

- [x] Add failing behavioral tests before extending extraction, normalization, event/CV dicts and matching adapters.
- [x] Extend `extractor_cv/extractors.py`, `event_candidate_finder.py`, `vector_store.py`, `firestore_vector_store.py`, `firebase_store.py`, `search_engine.py`, `matching_worker.py`, `matching_jobs.py` and related tests. Preserve legacy criteria conversion and revision guards; extend source allowlists and recipe namespace together.
- [x] Run bundled Python through `scripts/python-project.py -m unittest discover -s extractor_cv/tests`; report exact failures and limitations.

### Task 3: Forms and event presentation (frontend agent)

- [x] Extend `src/pages/Organizer.tsx`, `Profile.tsx`, `src/components/Onboarding.tsx`, event details/cards and relevant browser fixtures. Use canonical contract in the design document; root owns types/schema/discovery/normalization.
- [x] Offer clearly labeled topics, skills practiced, skills taught, explicit eligibility, country, languages and optional price; no new mandatory onboarding fields. Preserve existing design and draft/edit behavior.
- [x] Validate desktop/mobile create/edit/profile/onboarding and no overflow, meaningful accessible labels and inline errors.

### Task 4: Integration, migration, review and verification (root/reviewer)

- [x] Review every changed allowlist and event taxonomy across import/export, frontend, backend, extraction, jobs/indexes.
- [x] Run full Node/Python suites, TypeScript/build and production browser fixtures. Address fresh review findings.
- [x] Attempt migration dry-run against verified Firebase configuration and record provider evidence. Deploy additive missing vector indexes without replacing data.
- [ ] Apply the record migration, read back changes and re-embed live data after Firestore quota is available.
- [x] Update docs with verified outcome and any remaining external limitation.

## Live provider limitation

The migration dry-run failed with Firestore code 8 (quota exhausted), before any data migration. Apply/readback and v3 re-embedding remain pending. Three missing generic indexes were created; nine worker indexes are ready. See docs/matching-data.md for verification and retry commands.
