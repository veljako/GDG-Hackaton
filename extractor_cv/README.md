# CV pipeline

The Python pipeline extracts **unconfirmed proposals** and builds a private matching index. The website's private worker now supports explicit CV extraction, saved-proposal review, confirmed-field updates, semantic search and matching refresh jobs. Uploading a PDF stores it privately; the user starts extraction and reviews fields before confirmation. See [Gemma matching runtime](../docs/gemma-matching.md) for the current website integration and Firestore setup. The local Chroma lifecycle below describes the optional legacy test/standalone adapter; production matching uses native Firestore vectors.

## Setup and verification

Use Python 3.12 in a virtual environment:

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r extractor_cv/requirements.txt
.venv/Scripts/python.exe -m unittest discover -s extractor_cv/tests -v
```

The tests use synthetic records and real local Chroma/PDF parsing. Cloud transactions, OCR subprocess calls, and model inference are replaced at their external boundaries. No credentials, model download, GPU, or real CVs are needed for the tests. Production OCR needs Tesseract installed on the worker, including the language packs it uses.

`GEMMA_GENERATE_URL` defaults to `http://127.0.0.1:8000/generate`. The generation server must support the existing `/generate` JSON API. Configure `GEMMA_EMBED_URL` separately if the embedding route is hosted elsewhere.

Embedding selection is explicit: `CV_EMBEDDING_BACKEND=gemma` (default), `openai`, or `local`. Gemma requires `GEMMA_EMBED_REVISION`, an immutable 40-character Hugging Face commit, on both client and server. Its `/embed` response must report that revision, model `google/embeddinggemma-300m`, and 768 dimensions. The route in `gemma_embed_route.py` requires the server's separately installed SentenceTransformers runtime and model access. OpenAI requires `OPENAI_API_KEY`; the local backend is lexical and supports Unicode. A service outage never opens an alternate model's index.

## Database boundaries

Dataset identities are opaque `dataset-<sha256>` values; they cannot address application accounts. Authenticated callers must pass the exact trusted UID. IDs are validated and preserved; filenames and slug sanitization never determine an account ID.

```python
from extractors import extract_cv_info
from pipeline import add_user_to_firebase

proposal = extract_cv_info(local_file, candidate_id=authenticated_uid)
add_user_to_firebase(
    proposal,
    user_id=authenticated_uid,
    expected_storage_path=current_attachment_storage_path,
)
```

This transaction requires an existing `gdevPilots/main/users/{uid}` whose `user_id` and `cv_document.storage_path` match. It writes raw text and proposed fields to **`gdevPilots/main/cvExtractions/{uid}`**, with an `extraction_hash`. It does not create accounts or automatically update public profile fields. Legacy `cv_text`, `source`, and `candidate_id` fields are removed from that user's public record during this authorized transaction. The API also discards unknown imported fields when decoding or publishing profiles. Firestore rules deny direct client access to all collections; access uses the authenticated backend.

Replacing a private proposal for the same attachment also requires `proposal['expected_extraction_hash']` from the current private extraction. Identical reimports preserve the saved proposal and its review version. The low-level `save_cv_text` helper follows the same rule: pass `expected_extraction_hash` when changing the saved text; unchanged text preserves the proposal. Raw-text replacement creates a new hash and clears the old proposed fields.

To confirm a saved proposal, provide `confirmed_fields`, plus `proposal['expected_profile_updated_at']` from the reviewed public profile and `proposal['expected_extraction_hash']` from the reviewed private extraction. Both tokens and the full saved proposal must still match. Only supported public fields can be confirmed. Missing/empty fields leave existing values intact. Edits should be saved as a new private proposal and reviewed again. Confirm first/last name parts explicitly; the display name is derived from the confirmed parts and the existing profile. Account identity, attachment paths, email, roles, and timestamps cannot be confirmation targets. Extracted education uses the application's public schema without the internal `kind` field. The old `process_and_save_confirmed_cv` stub raises `NotImplementedError` and directs callers to this explicit confirmation API.

The Firebase project/workspace can be configured with `FIREBASE_PROJECT_ID` and `FIREBASE_WORKSPACE`. Authentication uses Application Default Credentials. Dataset `demo.py --firebase` is rejected before opening any store; sync must use explicit account/attachment bindings.

## Index revisions and lifecycle

`MatchmakingStore` persists a per-namespace manifest covering model, dimensions, and narrative recipe. Changing any of these, or opening a legacy collection without a manifest, fails closed. Build a replacement index in a **new directory**, validate its counts and matching behavior, then switch the worker configuration. Existing indexes are preserved; no automatic deletion or migration is performed.

Chroma stores only matching fields and their narrative, without raw CV text, names, filenames, or source paths. A hashed revision covers matching content, raw CV content, and the explicit attachment revision. Identical reimports reuse existing vectors. Replacement requires the current `candidate_source_hash(uid)` as `expected_source_hash`; the version is checked again after embedding. Batches reject duplicate IDs, validate all returned vectors, and write only after embedding succeeds. Callers must not automatically reload a token and overwrite after a conflict: reload and review the changed record.

For the standalone legacy adapter, attachment removal/replacement uses `delete_user_extraction(uid, expected_storage_path)` **before** clearing/changing the attachment record and `store.delete_candidate(uid, expected_source_hash=reviewed_index_hash)`. Both fail on stale versions. If the vector has not been created yet, `delete_candidate(uid, expected_source_hash=None)` cancels an in-flight first embedding. Persisted removal markers protect against stale writes. The current website instead commits canonical attachment changes first, then notifies the private worker with the old path; a matching proposal is removed without deleting a replacement. Profile matching refresh uses durable jobs and canonical revision checks in the same Firestore database.

`ingest_records` uses bounded batches and returns a status for every record. One malformed CV does not stop subsequent records. When explicit Firebase bindings are supplied, a failed private proposal write prevents that record's index write. An index failure leaves its private proposal available to retry and returns `failed`; it is never reported as indexed. A shared embedding-service outage stops further embedding attempts in that ingestion run. Version conflicts are returned without automatically retrying with a fresh token. Database and model response contents are omitted from failure results. Backend profile and event edits advance their revision even within the same millisecond, so pipeline writes can detect those edits.

## Matching and resource limits

Explicit age, seniority, and on-site city requirements exclude candidates with missing eligibility data. No age range is invented for hackathons. For the existing event schema, `min_birth_year` means the latest eligible birth year (minimum age); `max_birth_year` means the earliest eligible year (maximum age). Either bound may stand alone. City aliases normalize Serbian Latin/Cyrillic spellings. Negated skills and online registration wording do not become positive skill/remote requirements.

CV processing is limited to 5 MiB, 20 PDF pages, 20,000 extracted characters, 4096 pixels per image side, and 16 million pixels. PDF content streams are limited to 128 KiB each and 2 MiB cumulatively before text parsing or rendering. Scoped decompression limits, form nesting limits, cycle detection, and invocation accounting cover nested/reused content. Scanned PDF pages use bounded rendering and OCR with a 20-second timeout. Generation responses stream with a 1 MiB body limit, bounded attempts, and sanitized errors; embedding responses have a 2 MiB limit. Embedding requests accept at most 64 texts, 12,000 characters each, and 48,000 total characters; inference is limited to one concurrent request per process. Vector write batches are capped at 256 records and queries at 1,000 results. Nearest-neighbor search does not fetch all filtered candidate IDs before querying. The legacy Serbian matcher delegates to the same index and eligibility logic.

For a dataset-only embedding run:

```powershell
python extractor_cv/demo.py --backend local --in-memory --max-pdfs-per-source 0 --top-n 5
```

`--backend local` controls embeddings only: `demo.py` still calls the generation endpoint to extract its event description. To run fully offline, supply already normalized event dictionaries directly to `pipeline.find_best_matches`.
