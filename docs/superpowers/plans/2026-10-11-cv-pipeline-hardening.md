# CV Pipeline Hardening Implementation Plan

> **For agentic workers:** Use systematic-debugging and test-driven-development for each defect. Independent database and extraction tasks use dispatching-parallel-agents; the primary worker integrates and requests a final review.

**Goal:** Correct the reviewed pipeline and database-safety defects without wiring uploads or a frontend confirmation flow.

**Architecture:** Retain extraction → Chroma → metadata/cosine search. Require explicit canonical user identity and upload revision for writes to an existing Firebase user; keep proposed extraction private. Persist an embedding-index contract and reject unexpected model changes instead of silently switching a live corpus.

**Tech Stack:** Python 3.12+, unittest, Chroma/LangChain, Firebase Admin, pypdf/pdfium/Tesseract; existing TypeScript backend tests.

## Global constraints

- No frontend integration, deployed changes, live database cleanup, real CV/model requests, or pushes in this task.
- Preserve names, roles, contact, CV attachment and confirmed profile fields during unconfirmed extraction.
- Default dataset identities are collision-resistant opaque IDs. Trusted account processing passes the UID explicitly; invalid IDs are rejected, never rewritten.
- Firebase user extraction requires an existing user and its expected current CV storage path. Store raw text/provenance in `cvExtractions/{uid}`, not `users/{uid}`.
- Strict matching excludes missing data for an explicit constraint; unconstrained events acquire no invented age restriction.
- Tests replace network/cloud boundaries; persistent Chroma tests use a local temporary directory.

## Task 1: Identity and test runtime (primary)

Files: `extractor_cv/contracts.py`, `extractor_cv/tests/test_contracts.py`, `extractor_cv/requirements.txt`, `.github/workflows/ci.yml`.

- [x] Add failing tests that reject slash/overlength IDs and preserve supplied IDs exactly.
- [x] Implement `validate_id(value: str) -> str` using `[A-Za-z0-9_-]{1,128}`. Dataset IDs use full SHA256 of canonical file identity/record identity, with a `dataset-` prefix.
- [x] Install dependencies in ignored `.runtime/cv-pipeline-venv`, then run unittest discovery against actual modules.

## Task 2: Firebase safety (database worker)

Files: `extractor_cv/firebase_store.py`, `extractor_cv/tests/test_firebase_store.py`.

- [x] Reproduce raw-data leakage in mapped user documents, sparse-update erasure, invalid/sanitized ID collisions, unsupported education keys and stale writes with a transaction double.
- [x] Require explicit `user_id` and `expected_storage_path` for `upsert_user`; compare identity and current attachment within a transaction. Write proposals/raw text privately and preserve the public profile.
- [x] Provide explicit reviewed-field application with schema-compatible fields, plus revision-checked private extraction deletion. Clean legacy private fields only inside authorized writes; do not execute any live cleanup.
- [x] Keep event writes from rewriting an existing published event without an expected version; reject missing/unsupported event kind and keep imports as drafts.

## Task 3: Extraction and criteria (extraction worker)

Files: `extractor_cv/extractor.py`, `extractor_cv/extractors.py`, `extractor_cv/event_candidate_finder.py`, `extractor_cv/tests/test_extraction.py`, `extractor_cv/tests/test_event_criteria.py`.

- [x] Write failing tests for scanned PDF OCR, byte/page/text limits, timed OCR, malformed JSON isolation, collision-resistant IDs, birth-year validation, negated remote/skills and unrequested hackathon ages.
- [x] Bound files/pages/text before generation; add scanned-page rendering/OCR fallback and bounded transient-request retries with sanitized errors.
- [x] Preserve explicit candidate IDs, derive dataset IDs safely, and yield per-file JSON failures without aborting subsequent files.
- [x] Correct negative/context-sensitive criteria normalization, one-sided age criteria and current-year conversion; never invent a hackathon age restriction.

## Task 4: Embeddings, index and lifecycle (primary)

Files: `extractor_cv/embeddings.py`, `extractor_cv/vector_store.py`, `extractor_cv/search_engine.py`, `extractor_cv/pipeline.py`, `extractor_cv/gemma_embed_route.py`, `extractor_cv/candidate_matcher.py`, `extractor_cv/demo.py`, focused tests.

- [x] Write failing tests for nonfinite/wrong-dimension/wrong-model vectors, Cyrillic fallback, restart index switching, failed embedding preservation, per-record failure isolation and deletion.
- [x] Make backend selection explicit (`gemma`, `openai`, `local`) with no automatic model fallback. Validate model, revision and vector dimensions/norm, and version the local input recipe.
- [x] Pin persistent index identity/dimension; reject a mismatch without hiding/replacing the corpus. Remove raw text/provenance from vector payloads, cache unchanged sources, add batched candidate upserts and source-checked delete/invalidation.
- [x] Query top-k without fetching the entire matching population; fix open birth-year bounds and canonical Serbian locations. Consolidate the alternative matcher through a tested canonical adapter.
- [x] Separate pure preparation from external writes, isolate per-record ingestion errors, and prevent a failed Firebase write from leaving a newly indexed candidate reported as synchronized.
- [x] Bound embedding route inputs/concurrency and report the actual model/revision/dimension.

## Task 5: Existing-data privacy guard, documentation and verification (primary)

Files: `server/service.ts`, `server/users.test.ts`, `extractor_cv/README.md`, CI and focused tests.

- [x] Add a failing backend privacy regression for imported raw fields, then explicitly allow public-profile fields so previously imported data cannot leak.
- [x] Document UID/revision, private proposals, explicit backend/index migration, local test commands and removal lifecycle. Explain that uploads remain unconnected.
- [x] Run all Python regression tests, existing `npm.cmd run check`, deployment checks and `git diff --check`.
- [x] Request fresh read-only review, resolve substantive findings, verify the final diff and report remaining deployment/runtime limitations.

## Completion evidence

- Final Python regression run: 166 tests passed, using real local Chroma 1.5.9, pinned pypdf 6.20.0/PDFium and the Firebase Admin SDK with synthetic transaction doubles. Model inference, cloud writes and OCR subprocess calls were replaced at their external boundaries.
- Windows verification used the approved bundled NumPy/Pydantic native runtime alongside the installed pipeline packages because newly downloaded native DLLs were blocked by Application Control. No security policy was disabled. The CI job uses the normal Python 3.12 installation and requirements.
- `npm.cmd run check` passed: 112 tests across 17 files, backend type checking, and production type checking/build. The deployment helper suite passed 7 tests. Final `git diff --check` passed.
- Fresh independent review found additional proposal-version and PDF form-accounting defects. These were reproduced, fixed and covered by regression tests; the final scoped review found no remaining critical or important blocker.
- Changes remain local and uncommitted on `feat/cv-firebase-matchmaking`. No frontend upload worker, deployment, live database cleanup, model request, commit or push was performed. Existing indexes require an explicit rebuild in a new directory before activating the new index contract.
