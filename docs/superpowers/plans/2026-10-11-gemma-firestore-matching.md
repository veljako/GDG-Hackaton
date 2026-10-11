# Gemma and Firestore matching implementation plan

> For agentic workers: use subagent-driven-development with task-scoped tests and final integration review.

Goal: make Gemma extraction, EmbeddingGemma semantic search, and Firestore storage accessible through the authenticated website, then evaluate generated CVs.

Architecture: a private Python matching worker owns model calls and vector storage; the existing Node API owns Firebase identity, application eligibility and browser access. Node sends authoritative application records to the worker; browser input never selects an actor identity or index namespace. Production vectors use Firestore. Chroma remains available only for explicit legacy/offline compatibility while migration is verified.

Global constraints: preserve existing dirty work; do not commit unrelated files. Gemma generation and pinned google/embeddinggemma-300m embeddings are required. No OpenAI or other provider fallback in production. One Firestore database. No real CV data in public responses. Synthetic evaluation must label mocked inference separately from live inference. Existing explicit eligibility and revision protection remain binding. Report unavailable cloud/model infrastructure honestly and finish all independently testable work.

## Task 1 — Firestore matching store

Owner: Python storage implementer. Files: new `extractor_cv/firestore_vector_store.py`, its tests; modify `pipeline.py`, `search_engine.py`, and lazy imports in `vector_store.py` only if needed. Do not edit embeddings.py or HTTP worker files.

Implement `FirestoreMatchmakingStore(embeddings, db=None, workspace='gdevPilots/main', namespace='gemma-v1')` with the public methods consumed by current pipeline: upsert_candidate(s), candidate_source_hash, delete_candidate, query_candidates, upsert_event, event_source_hash, get_event. Add `query_events(vector,k,where=None)` and `get_candidate(id)`. Use native google.cloud.firestore_v1.vector.Vector and cosine find_nearest; userEmbeddings and eventEmbeddings, with model/dimensions/recipe/namespace filters and index instructions. Store private selected payload, metadata and revisions; no raw CV text or filenames. Preserve explicit update tokens, id validation, race/removal protection, cache reuse and <=256 vector batches. Optional canonical source updated_at/storage-path markers must be checked transactionally before writes, against users/events records. Filter deleted/stale canonical sources at search time. Pure dataset/test records without markers can use isolated evaluation workspaces.

Write failing tests first with a faithful Firestore transaction/query double; verify native serialization, cosine query, filters, caching, stale update/removal, metadata limits, invalid inputs, and all event kinds. Add `storage_backend` to configure_store; default firestore for production/gemma and explicit chroma for local compatibility. Keep callers that explicitly choose local/in-memory backend functioning and test them.

## Task 2 — Authenticated website integration

Owner: Node/frontend implementer. Files: new server/matching-client.ts and tests; server/index.ts, server/http.ts, src/backend.ts, relevant Events/Profile/Team pages. Do not edit Python files or existing server/embeddings.ts.

Private worker HTTP contract: POST `/v1/matching`, Authorization Bearer `GEMMA_WORKER_TOKEN`. JSON `{operation,actor_id,context,input}`. operation is search_events, recommend_events, team_candidates, extract_cv, confirm_cv, remove_cv. context is an authoritative backend snapshot {people,events,teams,applications}; actor_id comes exclusively from the authenticated session. input for extract_cv contains pdf_base64, storage_path; confirm_cv contains confirmed_fields, expected_profile_updated_at, expected_extraction_hash. Other inputs: query, filters, limit, event_id, team_id as appropriate. Worker returns `{results,proposal?,extraction_hash?,model?,source?,warnings?}`. Search/recommend result objects `{eventId,similarity,reasons}`; team results `{personId,similarity,reasons}`. CV proposal uses current profile field mapping and expected review tokens.

Enable client only when GEMMA_WORKER_URL and token configured; bound HTTP timeouts and response size, sanitize service errors. Add authenticated routes `/api/matching/search`, `/recommendations`, `/team`, `/cv/extract`, `/cv/proposal`, `/cv/confirm` using the existing ownership rules. Read CV bytes from CvStorage server-side. Private proposal stores returned to owner only; reject mismatched attachment/profile tokens. Removal/replacement must invalidate old worker data; do not falsely claim extraction completed or delete newly attached CV on stale operation. Apply authoritative registration/status/date/capacity/filter constraints after semantic retrieval, and restrict candidate/team visibility to legitimate event/team access. Preserve structured recommendations as explicit fallback when worker unavailable. Frontend exposes actual semantic results, loading/failure states and CV review/confirmation, without changing broad visual design. Avoid synchronous semantic calls on every two-second poll.

Write route/client tests first covering denied unauthenticated access, actor spoofing, service outage, authoritative eligibility, and CV revision checks; then implement. Run targeted tests and server typecheck/build.

## Task 3 — Private worker and generated-CV evaluation

Owner: primary agent. Files: new extractor_cv/matching_worker.py, synthetic evaluation script/tests, model identity guards as needed, deployment docs and sample env (no secrets).

Implement the Task 2 worker protocol using Task 1 storage, current extraction/normalization, EmbeddingGemma and Gemma query interpretation. Validate actor/context/input and private worker token; input bound and schema validation, no fallback to alternate embedding models. Generate deterministic randomized fictional English/Serbian CV PDFs and ground truth profiles, run extraction and matching, compare extracted fields and expected exclusions/top matches, and write JSON plus human-readable report. Support explicit offline protocol tests and explicit live model/Firebase tests in a unique disposable workspace. Never present offline model stubs as live results.

## Task 4 — Review and verification

Run Python suite, Node check/build, synthetic report and available live endpoints; review cross-component payloads, model identity, task encoding, canonical-source freshness, authorization, and frontend rendering. Fix important review findings. Report exact test counts and which integration boundaries were actually exercised. Leave deployment secrets out of source control.
