# Google semantic matching — proposed design

Status: proposed for review; no application or cloud changes made.

## Goal

Provide CV-to-event recommendations, teammate discovery, and natural-language event search using Gemma models, Google services, and one Firestore database. Gemma is a project requirement and must perform substantive inference in the delivered product. Preserve existing structured requirements and explainable recommendations.

## Current project evidence

- `server/embeddings.ts` stores native Firestore vectors and performs cosine nearest-neighbor searches. It accepts users and hackathons, validates model/dimensions, and rejects stale sources.
- `firestore.indexes.json` contains no indexes. Deployed indexes and live vector searches have not been verified.
- `src/discovery.ts` and `server/service.ts` implement structured, tag-based event recommendations.
- `extractor_cv/vector_store.py` uses Chroma. `extractor_cv/search_engine.py` combines candidate vector retrieval with explicit eligibility filters.
- The CV pipeline is not triggered by website uploads, as documented in `extractor_cv/README.md`. Private CV proposals and version-checked profile confirmation already have a storage contract.
- The checkout has existing uncommitted CV pipeline and backend changes. Implementation must preserve those changes and verify their ownership before editing overlapping files.

## Approaches

1. Recommended: keep Gemma generation and Google's self-hosted `google/embeddinggemma-300m` model, replacing Chroma with Firestore. Reuse the existing `/generate` integration and `/embed` route, with explicit model identities and immutable revisions. Host production inference on Google infrastructure; select the serving configuration after measuring model memory and latency.
2. Alternative: use Gemma generation for CV/event extraction and query interpretation, with a managed Google embedding model. This still uses Gemma substantively, but creates an additional model-service dependency and replaces the existing embedding adapter. It is not the selected approach.

Both approaches can serve the same product features. Model and ranking quality must be evaluated; changing storage alone does not improve relevance.

## Proposed services

- Firebase Authentication for verified account identity.
- Firestore for profiles, events, private CV proposals, vectors, and processing state.
- Cloud Storage for private CV files, using the existing storage abstraction.
- `google/embeddinggemma-300m` for 768-dimensional normalized vectors, reusing `extractor_cv/gemma_embed_route.py` and `GemmaServerEmbeddings`. This is the existing Google Gemma-family embedding model, rather than a generative model used as an improvised vector encoder. Pin its model revision; upgrading to another model requires a separate evaluated index.
- An explicitly configured instruction-tuned Gemma generation model for extracting CV fields and event requirements, and interpreting natural-language matching requests. Reuse the current text extraction and `/generate` flow. Require a verified runtime model identity rather than silently accepting the first model available. Validate outputs against schemas; extracted proposals still require user confirmation. Confirmed structured profile information is the initial input to shared matching; raw CV text is not exposed through matching responses.
- Cloud Run for API/worker execution, with authenticated Cloud Tasks for durable processing jobs. Model inference is a separate capacity-managed service on Google infrastructure, with serving size chosen from measured requirements. Local development exercises the same service boundaries with test adapters.

References: https://firebase.google.com/docs/firestore/vector-search, https://ai.google.dev/gemma/docs/embeddinggemma/model_card, and https://ai.google.dev/gemma/docs/core/model_card_3.

## Data and processing flow

1. A verified user uploads a CV to private storage. The API records a processing job bound to the user's UID and attachment revision.
2. The worker calls Gemma to extract proposed skills, experience, education, and interests from bounded CV text. The user reviews and confirms supported fields through the existing version-checked contract.
3. A profile or published-event change queues embedding work. Workers reload current source records; event jobs cover business, study, and science events, including hackathons.
4. Deterministic narrative builders select matching fields and exclude account identifiers, contact details, and raw files. Input must fit the model's token limit; do not rely on character limits alone or silent truncation.
5. Generate an embedding with a fixed model, dimension, task convention, and narrative recipe. Store those identifiers, a matching-source fingerprint, and the native vector in Firestore.
6. Before committing, verify that the source and attachment revision still match. Unchanged matching content reuses its embedding. Retries cannot overwrite newer data; model failures leave the job retryable without switching models.
7. Deleted, unpublished, inaccessible, or stale entities are excluded at read time. Attachment replacement/removal invalidates related private extraction work and any vectors derived from it.

Reuse `userEmbeddings`. Generalize the event embedding repository to every supported event type and use `eventEmbeddings` for new processing. Preserve existing `hackathonEmbeddings` during a deliberate compatibility transition; do not silently mix old model spaces or delete old indexes.

## Three product queries

### Recommended events

Build a retrieval query from the user's interests, skills, and stated goals. Retrieve relevant published events, then apply current registration, capacity, date, format, and user preference requirements. Combine semantic relevance with the existing structured fit evidence.

### Candidates and teammates

Build a query describing the desired participant from the event requirements, or the missing roles and skills from the team. Retrieve matching user documents. Enforce explicit eligibility and required-skill constraints. Rank teammates by contribution to missing team capabilities, rather than similarity to existing members alone. Candidate access follows authenticated product permissions.

### Natural-language event search

Gemma interprets explicitly stated intent and constraints in the user's search text into a validated query proposal. It must not invent eligibility constraints; explicit UI choices override interpreted fields. EmbeddingGemma embeds the semantic query against event descriptions. Date, city, format, and availability remain reliable structured filters rather than approximate semantic suggestions. If generation is unavailable, direct embedding search with explicit UI filters remains available when the embedding service is healthy.

Stored searchable narratives use EmbeddingGemma's document encoding; query narratives use its query encoding through the existing route. Persist the model revision/task/recipe contract so incompatible representations cannot be mixed. Test these task choices on actual matching examples before enabling them.

## Filtering and ranking

Use Firestore metadata prefilters where supported, with explicit composite vector indexes for the implemented query shapes. Revalidate all required eligibility conditions against authoritative source records. Postfilters may shrink the candidate set; use bounded oversampling and measure filtered retrieval recall rather than claiming complete top-N coverage.

Do not assign arbitrary permanent semantic/structured weights. Tune the combination against labelled examples. Similarity is not an admission probability. Initial result explanations should cite verifiable shared goals, skills, and missing-role coverage; model-generated explanations are optional follow-up work.

If semantic services are temporarily unavailable, retain structured recommendations and report processing/search state honestly. Do not substitute another embedding model into the same index.

## Implementation order

1. Verify Google project access, region, service identities, inference endpoints, and existing Firestore indexes without modifying production data. Verify Gemma generation model identity and the pinned EmbeddingGemma revision. Integrate the existing embedding adapter with Firestore storage, preserving current source/version checks.
2. Connect profile/event processing and generalized event vectors. Backfill into the new model/recipe space; validate counts, stale handling, and cloud query execution before switching consumers.
3. Connect authenticated natural-language search and event recommendations to the website. Keep the existing structured path as an explicit fallback.
4. Connect reviewed CV processing and team/candidate matching, including complementary roles and attachment-removal lifecycle.
5. Retire Chroma and non-Google production embedding providers only after consumers use the Firestore path and verification passes.

## Acceptance checks

- Unit/integration tests cover task/dimension contracts, unchanged-input reuse, stale jobs, source removal, authorization, and hard eligibility rules.
- Live inference verification records the generation model identity and pinned EmbeddingGemma revision. A product demonstration must exercise a real Gemma-powered CV extraction or query interpretation and an EmbeddingGemma-powered search. Mocks, branding, or a configured but unused endpoint do not establish Gemma integration.
- An evaluation set contains at least 20 labelled English/Serbian matching queries with paraphrases, exclusions, missing metadata, and complementary teammate requirements. Compare top-5 relevance with the current structured baseline and record misses.
- No hard eligibility violation is returned in the evaluation set. Semantic quality improvement is measured, not assumed.
- Real cloud verification confirms index readiness, vector write/readback, and nearest-neighbor execution separately from mocked tests.
- Browser verification covers upload/review states, recommendations, search filters, and candidate results at desktop and phone widths.
- Record embedding API calls, query latency, and Firestore reads on the evaluation set to identify unnecessary repeated work before rollout.

## Decisions proposed for approval

Use Gemma for CV/event extraction and natural-language query interpretation, and `google/embeddinggemma-300m` at 768 dimensions for semantic retrieval. Firestore is the only production database. Deliver searchable events and recommendations first, then reviewed CV and complementary teammate matching through the same pipeline. Live enablement requires verified backend credentials, running model services, and index readiness; this document does not assert any of these are already configured.
